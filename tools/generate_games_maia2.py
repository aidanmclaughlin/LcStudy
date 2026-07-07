#!/usr/bin/env python3
"""
Generate Leela vs Maia-2 training games for LcStudy.

Leela's side is unchanged from generate_games.py: lc0 with a fixed node
budget, v2 analysis blobs (P/N/Q + Q-based partial credit) on every prompt.

The opponent is Maia-2 (CSSLab, NeurIPS 2024): one unified human model
conditioned on both players' ratings, trained on Lichess 2013-2023. Each
game samples an opponent rating uniformly across Maia-2's Elo buckets
(~1000-2200) for broad skill exposure, conditions on facing a strong
opponent (Leela), and samples moves from the predicted human distribution
(temperature 1, tiny tail floor) — real trajectory variety at every level,
rather than snapping to the modal move.

Requires the maia2 venv:  .venv-maia2 at the repo root (see README).

Usage:
    .venv-maia2/bin/python tools/generate_games_maia2.py --count 1500 --workers 3
"""

import argparse
import platform
import random
import sys
import threading
import time
from pathlib import Path

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
ELO_BUCKET_RANGES = [(1000, 1099)] + [(lo, lo + 99) for lo in range(1100, 2000, 100)] + [(2000, 2199)]

# Leela's effective rating for Maia-2's opponent conditioning (>=2000 bucket).
LEELA_OPPONENT_ELO = 2200

# Moves below this predicted probability are dropped before sampling.
TAIL_FLOOR = 0.005


class Maia2Sampler:
    """Thread-safe wrapper around a shared Maia-2 model."""

    def __init__(self, game_type: str = "rapid", device: str = "cpu"):
        from maia2 import model as m2model, inference as m2inference

        self._inference = m2inference
        self._model = m2model.from_pretrained(type=game_type, device=device)
        self._prepared = m2inference.prepare()
        self._lock = threading.Lock()
        self.game_type = game_type

    def sample_move(self, board: chess.Board, elo_self: int, elo_oppo: int, rng: random.Random) -> chess.Move:
        with self._lock:
            probs, _win_prob = self._inference.inference_each(
                self._model, self._prepared, board.fen(), elo_self, elo_oppo
            )

        legal_uci = {m.uci() for m in board.legal_moves}
        candidates = [(u, p) for u, p in probs.items() if u in legal_uci and p >= TAIL_FLOOR]
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
    game.headers["LcStudyGrading"] = f"q-wpl-exp{GRADING_TAU:g}"
    # NOTE: chess.js (the app's PGN parser) rejects digits in tag names, so
    # these must stay digit-free ("Maia2" is not a legal tag fragment there).
    game.headers["LcStudyOpponent"] = f"maia2-{sampler.game_type}"
    game.headers["LcStudyOpponentEloSelf"] = str(elo_self)
    game.headers["LcStudyOpponentEloOppo"] = str(LEELA_OPPONENT_ELO)
    game.headers["LcStudyOpponentTailFloor"] = str(TAIL_FLOOR)

    node = game
    plies = 0
    history: list[str] = []

    while not board.is_game_over() and plies < max_plies:
        is_leela_turn = (board.turn == chess.WHITE) == leela_is_white

        if is_leela_turn:
            move, analysis = leela_engine.get_policy_analysis(board, leela_budget, move_history=history)
        else:
            move = sampler.sample_move(board, elo_self, LEELA_OPPONENT_ELO, rng)
            analysis = None

        board.push(move)
        history.append(move.uci())
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
    args = parser.parse_args()

    lc0_path = find_lc0()
    leela_net = find_network(args.leela_net)
    leela_budget = SearchBudget(nodes=args.leela_nodes)
    net_name = network_name(leela_net)

    # The bundled lc0 config selects the Metal backend; only apply it on macOS.
    lc0_config = APPLE_SILICON_CONFIG if platform.system() == "Darwin" else None

    args.output.mkdir(parents=True, exist_ok=True)
    move_keys = load_existing_move_keys(args.output)
    print(f"lc0: {lc0_path}\nnet: {net_name} @ {leela_budget.label()}\n"
          f"opponent: maia2-{args.game_type} elos {ELO_BUCKET_RANGES[0][0]}-{ELO_BUCKET_RANGES[-1][1]}\n"
          f"output: {args.output} ({len(move_keys)} existing lines)\n"
          f"count: {args.count}  workers: {args.workers}", flush=True)

    print("Loading Maia-2...", flush=True)
    sampler = Maia2Sampler(game_type=args.game_type, device=args.device)
    print("Maia-2 ready.", flush=True)

    batch_id = f"maia2_{args.seed if args.seed is not None else int(time.time())}"
    seed_base = args.seed if args.seed is not None else int(time.time())

    lock = threading.Lock()
    state = {"success": 0, "attempts": 0, "plies": 0, "start": time.time()}
    max_attempts = args.count * 4 + 10

    def worker(worker_index: int):
        engine = UciEngine(
            lc0_path, leela_net, backend=args.leela_backend, multipv=500, config=lc0_config
        )
        rng = random.Random(seed_base * 1000 + worker_index)
        try:
            while True:
                with lock:
                    if state["success"] >= args.count or state["attempts"] >= max_attempts:
                        return
                    state["attempts"] += 1

                bucket = rng.choice(ELO_BUCKET_RANGES)
                elo = rng.randint(bucket[0], bucket[1])

                try:
                    pgn, plies, result = generate_game_maia2(
                        engine, sampler, net_name, leela_budget, elo, rng
                    )
                except Exception as e:
                    print(f"[ERROR] worker {worker_index}: {e}", flush=True)
                    engine.quit()
                    engine = UciEngine(
                        lc0_path, leela_net, backend=args.leela_backend, multipv=500,
                        config=lc0_config,
                    )
                    continue

                key = move_sequence_key(pgn)
                with lock:
                    if key in move_keys:
                        print("[SKIP] duplicate line", flush=True)
                        continue
                    if state["success"] >= args.count:
                        return
                    move_keys.add(key)
                    state["success"] += 1
                    state["plies"] += plies
                    n = state["success"]
                    fname = f"{batch_id}_{n:04d}.pgn"
                    (args.output / fname).write_text(pgn + "\n")

                    if n % 25 == 0 or n == args.count:
                        elapsed = time.time() - state["start"]
                        per_game = elapsed / n
                        eta_h = (args.count - n) * per_game / 3600
                        print(f"[{n}/{args.count}] elo={elo} {result} {plies}p "
                              f"({per_game:.0f}s/game, eta={eta_h:.1f}h)", flush=True)
        finally:
            engine.quit()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(args.workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    elapsed = (time.time() - state["start"]) / 60
    avg = state["plies"] / state["success"] if state["success"] else 0
    print(f"DONE {state['success']}/{args.count} games in {elapsed:.0f}m ({avg:.0f} avg plies)", flush=True)
    return 0 if state["success"] == args.count else 1


if __name__ == "__main__":
    sys.exit(main())
