#!/usr/bin/env python3
"""
Generate Leela vs Maia-2 training games for LcStudy.

Leela's side matches generate_games.py: a fresh lc0 process per game, FEN-only
position feeding, a fixed node budget, and v2 analysis on every prompt.

The opponent's first five moves come from the exact count-weighted continuation
distribution of recent rated Lichess rapid games in its rating cohort. Maia-2
(CSSLab, NeurIPS 2024) takes over from ply 11, where its training support begins,
and samples from its predicted human distribution (temperature 1, tiny tail
floor). Leela's side is unchanged from the original corpus at every ply.

Requires the maia2 venv:  .venv-maia2 at the repo root (see README).

Usage:
    .venv-maia2/bin/python tools/generate_games_maia2.py \
        --opening-tree ~/.lcstudy/openings/lichess-rapid-2026-06.pkl.gz \
        --count 3000 --workers 3
"""

import argparse
from collections import Counter
import gzip
import os
import pickle
import platform
import random
import sys
import threading
import time
from pathlib import Path
from typing import Optional

try:
    import chess
    import chess.pgn
except ImportError:
    print("Missing dependency. Install with: pip install chess")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent))
from generate_games import (  # noqa: E402
    APPLE_SILICON_CONFIG,
    DEFAULT_LEELA_NET,
    DEFAULT_LEELA_NODES,
    GRADING_TAU,
    MAX_PLIES,
    SearchBudget,
    UciEngine,
    encode_analysis,
    find_lc0,
    find_network,
    load_existing_move_keys,
    move_sequence_key,
    network_name,
)

OUTPUT_DIR = Path(__file__).parent.parent / "src" / "lcstudy" / "data" / "pgn"

# Maia-2 Elo buckets are 100-wide from 1100 to 2000 with open ends; sampling
# one rating per bucket range gives uniform exposure across all buckets.
ELO_BUCKET_RANGES = (
    [(1000, 1099)] + [(lo, lo + 99) for lo in range(1100, 2000, 100)] + [(2000, 2199)]
)

# Leela's effective rating for Maia-2's opponent conditioning (>=2000 bucket).
LEELA_OPPONENT_ELO = 2200

# Moves below this predicted probability are dropped before sampling.
TAIL_FLOOR = 0.005

# Maia-2 was trained only from ply 11 onward. Before then, the opponent samples
# the empirical continuation distribution from recent rated Lichess rapid games.
OPENING_PLIES = 10
OPENING_TREE_FORMAT_VERSION = 3
OPENING_BACKOFF_SUFFIX = 3
OPENING_BACKOFF_POLICY = "exact-all-suffix-three-to-ply"
LICHESS_RATING_GROUPS = (0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500)


class OpeningSupportError(RuntimeError):
    """The empirical opening source has no continuation for a Leela line."""


def lichess_rating_group(elo: int) -> int:
    """Map an exact Maia rating to the explorer's containing rating group."""
    return max(group for group in LICHESS_RATING_GROUPS if group <= elo)


def _tree_counts_for_history(
    root: dict[str, list[object]],
    san_history: list[str],
) -> Optional[dict[str, int]]:
    node = root
    for san in san_history:
        entry = node.get(san)
        if (
            not isinstance(entry, list)
            or len(entry) != 2
            or not isinstance(entry[1], dict)
        ):
            return None
        node = entry[1]
    counts = {
        san: int(entry[0])
        for san, entry in node.items()
        if isinstance(entry, list) and entry and int(entry[0]) > 0
    }
    return counts or None


def _legal_candidates(
    board: chess.Board,
    counts: Optional[dict[str, int]],
) -> list[tuple[chess.Move, int]]:
    if not counts:
        return []
    by_move: Counter[chess.Move] = Counter()
    for san, count in counts.items():
        try:
            move = board.parse_san(san)
        except ValueError:
            continue
        by_move[move] += count
    return list(by_move.items())


def opening_tree_legal_candidates(
    board: chess.Board,
    roots: dict[int, dict[str, list[object]]],
    backoffs: dict[int, list[dict[tuple[str, ...], dict[str, int]]]],
    rating_group: int,
    san_history: list[str],
) -> tuple[list[tuple[chess.Move, int]], str]:
    """Use the longest supported current-human context for this position."""
    root = roots.get(rating_group)
    if isinstance(root, dict):
        candidates = _legal_candidates(
            board,
            _tree_counts_for_history(root, san_history),
        )
        if candidates:
            return candidates, "exact-rating"

    pooled_exact: Counter[str] = Counter()
    for candidate_root in roots.values():
        counts = _tree_counts_for_history(candidate_root, san_history)
        if counts:
            pooled_exact.update(counts)
    candidates = _legal_candidates(board, dict(pooled_exact))
    if candidates:
        return candidates, "exact-all"

    ply = len(san_history)
    if ply >= OPENING_PLIES:
        raise OpeningSupportError("Opening backoff requested after its ply cutoff")
    max_suffix = min(OPENING_BACKOFF_SUFFIX, ply)
    for suffix_length in range(max_suffix, -1, -1):
        suffix = tuple(san_history[-suffix_length:]) if suffix_length else ()
        group_tables = backoffs.get(rating_group)
        if isinstance(group_tables, list) and ply < len(group_tables):
            candidates = _legal_candidates(
                board,
                group_tables[ply].get(suffix),
            )
            if candidates:
                return candidates, f"suffix-{suffix_length}-rating"

        pooled_backoff: Counter[str] = Counter()
        for tables in backoffs.values():
            if isinstance(tables, list) and ply < len(tables):
                counts = tables[ply].get(suffix)
                if counts:
                    pooled_backoff.update(counts)
        candidates = _legal_candidates(board, dict(pooled_backoff))
        if candidates:
            return candidates, f"suffix-{suffix_length}-all"

    raise OpeningSupportError(
        f"Opening tree has no legal human continuation at ply {ply + 1}: "
        f"{' '.join(san_history)}"
    )


class LichessOpeningTreeSampler:
    """Sample from a reproducible trie built from a public Lichess PGN dump."""

    def __init__(self, path: Path):
        with gzip.open(path, "rb") as handle:
            payload = pickle.load(handle)
        if not isinstance(payload, dict):
            raise RuntimeError("Opening tree payload is invalid")
        metadata = payload.get("metadata")
        roots = payload.get("roots")
        backoffs = payload.get("backoffs")
        if (
            not isinstance(metadata, dict)
            or not isinstance(roots, dict)
            or not isinstance(backoffs, dict)
        ):
            raise RuntimeError("Opening tree is missing metadata, roots, or backoffs")
        if metadata.get("format_version") != OPENING_TREE_FORMAT_VERSION:
            raise RuntimeError("Unsupported opening tree format")
        if metadata.get("speed") != "rapid" or metadata.get("plies") != OPENING_PLIES:
            raise RuntimeError("Opening tree does not contain ten-ply rapid openings")

        self.source = str(metadata.get("source", "lichess-rated-rapid-dump"))
        self.speed = "rapid"
        self.backoff_policy = OPENING_BACKOFF_POLICY
        self.sampled_games = int(metadata.get("sampled_games", 0))
        self.since = self._month(str(metadata.get("first_date", "")))
        self.until = self._month(str(metadata.get("last_date", "")))
        self.source_month = str(metadata.get("source_month", ""))
        self._roots = roots
        self._backoffs = backoffs

    @staticmethod
    def _month(raw_date: str) -> str:
        return raw_date[:7].replace(".", "-") if raw_date else "unknown"

    def check_available(self) -> None:
        for group in (1000, 1200, 1400, 1600, 1800, 2000):
            root = self._roots.get(group)
            backoff = self._backoffs.get(group)
            if (
                not isinstance(root, dict)
                or not root
                or not isinstance(backoff, list)
                or len(backoff) != OPENING_PLIES
            ):
                raise RuntimeError(
                    f"Opening tree has incomplete data for rating group {group}"
                )

    def sample_move(
        self,
        board: chess.Board,
        san_history: list[str],
        elo_self: int,
        rng: random.Random,
    ) -> chess.Move:
        candidates, _source = opening_tree_legal_candidates(
            board,
            self._roots,
            self._backoffs,
            lichess_rating_group(elo_self),
            san_history,
        )

        total = sum(count for _, count in candidates)
        pick = rng.random() * total
        cumulative = 0
        for move, count in candidates:
            cumulative += count
            if pick < cumulative:
                return move
        return candidates[-1][0]


class Maia2Sampler:
    """Thread-safe wrapper around a shared Maia-2 model."""

    def __init__(self, game_type: str = "rapid", device: str = "cpu"):
        from maia2 import model as m2model, inference as m2inference

        self._inference = m2inference
        self._model = m2model.from_pretrained(type=game_type, device=device)
        self._prepared = m2inference.prepare()
        self._lock = threading.Lock()
        self.game_type = game_type

    def sample_move(
        self, board: chess.Board, elo_self: int, elo_oppo: int, rng: random.Random
    ) -> chess.Move:
        with self._lock:
            probs, _win_prob = self._inference.inference_each(
                self._model, self._prepared, board.fen(), elo_self, elo_oppo
            )

        legal_uci = {m.uci() for m in board.legal_moves}
        candidates = [
            (u, p) for u, p in probs.items() if u in legal_uci and p >= TAIL_FLOOR
        ]
        if not candidates:
            candidates = [(u, p) for u, p in probs.items() if u in legal_uci]
        if not candidates:
            # Model returned nothing usable; fall back to a uniform legal move.
            return rng.choice(list(board.legal_moves))

        total = sum(p for _, p in candidates)
        pick = rng.random() * total
        acc = 0.0
        for uci, p in candidates:
            acc += p
            if pick <= acc:
                return chess.Move.from_uci(uci)
        return chess.Move.from_uci(candidates[-1][0])


def generate_game_maia2(
    leela_engine: UciEngine,
    sampler: Maia2Sampler,
    opening_sampler: LichessOpeningTreeSampler,
    leela_net_name: str,
    leela_budget: SearchBudget,
    elo_self: int,
    rng: random.Random,
    max_plies: int = MAX_PLIES,
) -> tuple[str, int, str]:
    board = chess.Board()
    game = chess.pgn.Game()

    leela_is_white = rng.random() < 0.5
    maia_name = f"Maia {elo_self} (MAIA2)"

    game.headers["Event"] = "LcStudy Training Game"
    game.headers["Site"] = "LcStudy"
    game.headers["White"] = "Leela (PLAYER)" if leela_is_white else maia_name
    game.headers["Black"] = maia_name if leela_is_white else "Leela (PLAYER)"
    game.headers["Result"] = "*"
    game.headers["LcStudyLeelaNet"] = leela_net_name
    game.headers["LcStudyLeelaSearch"] = leela_budget.label()
    game.headers["LcStudyLeelaLifecycle"] = "fresh-per-game"
    game.headers["LcStudyGrading"] = f"q-wpl-exp{GRADING_TAU:g}"
    # NOTE: chess.js (the app's PGN parser) rejects digits in tag names, so
    # these must stay digit-free ("Maia2" is not a legal tag fragment there).
    game.headers["LcStudyOpponent"] = f"maia2-{sampler.game_type}"
    game.headers["LcStudyOpponentEloSelf"] = str(elo_self)
    game.headers["LcStudyOpponentEloOppo"] = str(LEELA_OPPONENT_ELO)
    game.headers["LcStudyOpponentTailFloor"] = str(TAIL_FLOOR)
    game.headers["LcStudyOpeningSource"] = opening_sampler.source
    game.headers["LcStudyOpeningSpeed"] = opening_sampler.speed
    game.headers["LcStudyOpeningSince"] = opening_sampler.since
    game.headers["LcStudyOpeningUntil"] = opening_sampler.until
    game.headers["LcStudyOpeningPlies"] = str(OPENING_PLIES)
    game.headers["LcStudyOpeningBackoff"] = opening_sampler.backoff_policy
    game.headers["LcStudyOpeningRatingGroup"] = str(lichess_rating_group(elo_self))
    if opening_sampler.sampled_games is not None:
        game.headers["LcStudyOpeningGames"] = str(opening_sampler.sampled_games)

    node = game
    plies = 0
    san_history: list[str] = []

    while not board.is_game_over() and plies < max_plies:
        is_leela_turn = (board.turn == chess.WHITE) == leela_is_white

        if is_leela_turn:
            move, analysis = leela_engine.get_policy_analysis(board, leela_budget)
        elif plies < OPENING_PLIES:
            move = opening_sampler.sample_move(
                board,
                san_history,
                elo_self,
                rng,
            )
            analysis = None
        else:
            move = sampler.sample_move(board, elo_self, LEELA_OPPONENT_ELO, rng)
            analysis = None

        san = board.san(move)
        board.push(move)
        san_history.append(san)
        node = node.add_variation(move)
        if analysis is not None:
            node.comment = encode_analysis(move, analysis)
        plies += 1

    if board.is_game_over():
        outcome = board.outcome()
        if outcome:
            if outcome.winner is None:
                game.headers["Result"] = "1/2-1/2"
            elif outcome.winner == chess.WHITE:
                game.headers["Result"] = "1-0"
            else:
                game.headers["Result"] = "0-1"

    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=True)
    return game.accept(exporter), plies, game.headers["Result"]


def generate_game_with_fresh_leela(
    lc0_path: str,
    leela_net: Path,
    leela_backend: Optional[str],
    leela_config: Optional[Path],
    sampler: Maia2Sampler,
    opening_sampler: LichessOpeningTreeSampler,
    leela_net_name: str,
    leela_budget: SearchBudget,
    elo_self: int,
    rng: random.Random,
    max_plies: int = MAX_PLIES,
) -> tuple[str, int, str]:
    """Match the original corpus by isolating Leela state to one game."""
    engine = UciEngine(
        lc0_path,
        leela_net,
        backend=leela_backend,
        multipv=500,
        config=leela_config,
    )
    try:
        return generate_game_maia2(
            engine,
            sampler,
            opening_sampler,
            leela_net_name,
            leela_budget,
            elo_self,
            rng,
            max_plies=max_plies,
        )
    finally:
        engine.quit()


def main():
    parser = argparse.ArgumentParser(description="Generate Leela vs Maia-2 games")
    parser.add_argument("--count", "-n", type=int, default=10)
    parser.add_argument("--output", "-o", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--leela-net", default=DEFAULT_LEELA_NET)
    parser.add_argument("--leela-nodes", type=int, default=DEFAULT_LEELA_NODES)
    parser.add_argument("--leela-backend", default=None)
    parser.add_argument("--game-type", default="rapid", choices=["rapid", "blitz"])
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument(
        "--max-plies",
        type=int,
        default=MAX_PLIES,
        help="generation cutoff; use 10 for an opening-coverage stress test",
    )
    parser.add_argument(
        "--opening-tree",
        type=Path,
        required=True,
        help="Count-weighted trie built from a public Lichess rapid PGN dump",
    )
    args = parser.parse_args()

    lc0_path = find_lc0()
    leela_net = find_network(args.leela_net)
    leela_budget = SearchBudget(nodes=args.leela_nodes)
    net_name = network_name(leela_net)

    # The bundled lc0 config selects the Metal backend; only apply it on macOS.
    lc0_config = APPLE_SILICON_CONFIG if platform.system() == "Darwin" else None

    opening_sampler = LichessOpeningTreeSampler(args.opening_tree)

    print("Checking Lichess opening source...", flush=True)
    opening_sampler.check_available()
    print("Lichess opening source ready.", flush=True)

    args.output.mkdir(parents=True, exist_ok=True)
    move_keys = load_existing_move_keys(args.output)
    print(
        f"lc0: {lc0_path}\nnet: {net_name} @ {leela_budget.label()}\n"
        f"opponent: maia2-{args.game_type} elos {ELO_BUCKET_RANGES[0][0]}-{ELO_BUCKET_RANGES[-1][1]}\n"
        f"opening: {opening_sampler.source} {opening_sampler.speed} "
        f"{opening_sampler.since}..{opening_sampler.until}, opponent plies < {OPENING_PLIES}\n"
        f"output: {args.output} ({len(move_keys)} existing lines)\n"
        f"count: {args.count}  workers: {args.workers}",
        flush=True,
    )

    print("Loading Maia-2...", flush=True)
    sampler = Maia2Sampler(game_type=args.game_type, device=args.device)
    print("Maia-2 ready.", flush=True)

    batch_id = (
        f"lichess_maia2_{args.seed if args.seed is not None else int(time.time())}"
    )
    seed_base = args.seed if args.seed is not None else int(time.time())

    lock = threading.Lock()
    state = {
        "success": 0,
        "attempts": 0,
        "plies": 0,
        "start": time.time(),
        "fatal_error": None,
    }
    max_attempts = args.count * 4 + 10

    def worker(worker_index: int):
        rng = random.Random(seed_base * 1000 + worker_index)
        while True:
            with lock:
                if (
                    state["success"] >= args.count
                    or state["attempts"] >= max_attempts
                    or state["fatal_error"] is not None
                ):
                    return
                state["attempts"] += 1

            bucket = rng.choice(ELO_BUCKET_RANGES)
            elo = rng.randint(bucket[0], bucket[1])

            try:
                pgn, plies, result = generate_game_with_fresh_leela(
                    lc0_path,
                    leela_net,
                    args.leela_backend,
                    lc0_config,
                    sampler,
                    opening_sampler,
                    net_name,
                    leela_budget,
                    elo,
                    rng,
                    args.max_plies,
                )
            except OpeningSupportError as e:
                with lock:
                    state["fatal_error"] = str(e)
                print(f"[FATAL] {e}", flush=True)
                return
            except Exception as e:
                print(f"[ERROR] worker {worker_index}: {e}", flush=True)
                continue

            key = move_sequence_key(pgn)
            with lock:
                if key in move_keys:
                    print("[SKIP] duplicate line", flush=True)
                    continue
                if state["success"] >= args.count:
                    return
                n = state["success"] + 1
                fname = f"{batch_id}_{n:04d}.pgn.gz"
                output_path = args.output / fname
                temporary_path = output_path.with_suffix(output_path.suffix + ".tmp")
                try:
                    with gzip.open(temporary_path, "wt", encoding="utf-8") as fh:
                        fh.write(pgn + "\n")
                    os.replace(temporary_path, output_path)
                except OSError as exc:
                    temporary_path.unlink(missing_ok=True)
                    state["fatal_error"] = f"Could not save {fname}: {exc}"
                    print(f"[FATAL] {state['fatal_error']}", flush=True)
                    return

                move_keys.add(key)
                state["success"] = n
                state["plies"] += plies

                if n % 25 == 0 or n == args.count:
                    elapsed = time.time() - state["start"]
                    per_game = elapsed / n
                    eta_h = (args.count - n) * per_game / 3600
                    print(
                        f"[{n}/{args.count}] elo={elo} {result} {plies}p "
                        f"({per_game:.0f}s/game, eta={eta_h:.1f}h)",
                        flush=True,
                    )

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(args.workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    elapsed = (time.time() - state["start"]) / 60
    avg = state["plies"] / state["success"] if state["success"] else 0
    print(
        f"DONE {state['success']}/{args.count} games in {elapsed:.0f}m "
        f"({state['attempts']} attempts, "
        f"{avg:.0f} avg plies)",
        flush=True,
    )
    if state["fatal_error"] is not None:
        print(f"Generation stopped: {state['fatal_error']}", flush=True)
    return 0 if state["success"] == args.count and state["fatal_error"] is None else 1


if __name__ == "__main__":
    sys.exit(main())
