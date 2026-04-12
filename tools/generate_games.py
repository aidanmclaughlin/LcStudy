#!/usr/bin/env python3
"""
Generate Leela vs Maia training games for LcStudy.

Usage:
    python tools/generate_games.py --count 100

Requirements:
    pip install chess

You'll also need:
    - lc0 binary (install via brew install lc0)
    - Leela network (~/.lcstudy/nets/BT4-it332.pb.gz)
    - Maia networks (~/.lcstudy/nets/maia-1100.pb.gz through maia-1900.pb.gz)
"""

import argparse
import base64
from dataclasses import dataclass
import json
import random
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

try:
    import chess
    import chess.pgn
except ImportError:
    print("Missing dependency. Install with: pip install chess")
    sys.exit(1)


# =============================================================================
# Configuration
# =============================================================================

NETS_DIR = Path.home() / ".lcstudy" / "nets"
OUTPUT_DIR = Path(__file__).parent.parent / "src" / "lcstudy" / "data" / "pgn"
APPLE_SILICON_CONFIG = Path(__file__).parent / "lc0-apple-silicon.config"

MAIA_LEVELS = [1100, 1300, 1500, 1700, 1900]

DEFAULT_LEELA_NET = "BT4-it332"
DEFAULT_LEELA_MOVETIME_MS = 5_000
DEFAULT_MAIA_NODES = 1
MAX_PLIES = 300


# =============================================================================
# UCI Engine (Direct subprocess, no python-chess engine module)
# =============================================================================

@dataclass(frozen=True)
class SearchBudget:
    movetime_ms: Optional[int] = None
    nodes: Optional[int] = None

    def command(self) -> str:
        if self.movetime_ms is not None:
            return f"go movetime {self.movetime_ms}"
        if self.nodes is not None:
            return f"go nodes {self.nodes}"
        raise ValueError("SearchBudget must define movetime_ms or nodes")

    def label(self) -> str:
        if self.movetime_ms is not None:
            return f"{self.movetime_ms}ms"
        return f"{self.nodes} nodes"


class UciEngine:
    """Simple synchronous UCI engine wrapper using subprocess."""

    def __init__(
        self,
        lc0_path: str,
        weights: Path,
        backend: Optional[str] = None,
        multipv: int = 1,
        config: Optional[Path] = None,
    ):
        command = [lc0_path, f"--weights={weights}"]
        if config:
            command.append(f"--config={config}")
        if backend:
            command.append(f"--backend={backend}")

        self.proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1
        )
        self._send("uci")
        self._wait_for("uciok")
        self._send(f"setoption name MultiPV value {multipv}")
        if multipv > 1:
            self._send("setoption name VerboseMoveStats value true")
        self._send("isready")
        self._wait_for("readyok")

    def _send(self, cmd: str):
        self.proc.stdin.write(cmd + "\n")
        self.proc.stdin.flush()

    def _wait_for(self, expected: str) -> list[str]:
        lines = []
        while True:
            line = self.proc.stdout.readline().strip()
            if line == "" and self.proc.poll() is not None:
                raise RuntimeError(f"lc0 exited before {expected}")
            lines.append(line)
            if line.startswith(expected):
                return lines

    def get_best_move(self, board: chess.Board, budget: SearchBudget) -> chess.Move:
        """Get the best move for the position."""
        self._send(f"position fen {board.fen()}")
        self._send(budget.command())

        while True:
            line = self.proc.stdout.readline().strip()
            if line == "" and self.proc.poll() is not None:
                raise RuntimeError("lc0 exited before bestmove")
            if line.startswith("bestmove"):
                match = re.match(r"bestmove\s+(\S+)", line)
                if match:
                    return chess.Move.from_uci(match.group(1))
                raise ValueError(f"Could not parse bestmove: {line}")

    def get_policy_analysis(
        self,
        board: chess.Board,
        budget: SearchBudget,
    ) -> tuple[chess.Move, list[dict[str, object]]]:
        """Get LC0 policy data for every legal move in the position."""
        legal_moves = list(board.legal_moves)
        legal_uci = {move.uci() for move in legal_moves}
        policy_by_move: dict[str, float] = {}
        best_move = None

        self._send(f"position fen {board.fen()}")
        self._send(budget.command())

        while True:
            line = self.proc.stdout.readline().strip()
            if line == "" and self.proc.poll() is not None:
                raise RuntimeError(f"lc0 exited before policy analysis completed for {board.fen()}")

            if line.startswith("info string"):
                move_match = re.match(r"info string\s+([a-h][1-8][a-h][1-8][qrbn]?)\s+\(", line)
                policy_match = re.search(r"\(P:\s*([0-9.]+)%\)", line)
                if move_match and policy_match:
                    move_uci = normalize_engine_uci(move_match.group(1), legal_uci)
                    if move_uci in legal_uci:
                        policy_by_move[move_uci] = float(policy_match.group(1))

            if line.startswith("bestmove"):
                match = re.match(r"bestmove\s+(\S+)", line)
                if match:
                    best_move = chess.Move.from_uci(match.group(1))
                    break
                raise ValueError(f"Could not parse bestmove: {line}")

        missing = sorted(legal_uci - set(policy_by_move))
        if missing:
            raise ValueError(
                f"LC0 analysis missing legal moves for {board.fen()}: {', '.join(missing[:8])}"
            )

        best_policy = max(policy_by_move.values())
        analysis = []
        for move in legal_moves:
            policy = policy_by_move[move.uci()]
            accuracy = (policy / best_policy) * 100 if best_policy > 0 else 0
            analysis.append({
                "u": move.uci(),
                "s": board.san(move),
                "p": round(policy, 2),
                "a": round(accuracy, 2),
            })

        analysis.sort(key=lambda item: item["a"], reverse=True)
        return best_move, analysis

    def quit(self):
        try:
            self._send("quit")
            self.proc.wait(timeout=2)
        except Exception:
            self.proc.kill()


# =============================================================================
# Utilities
# =============================================================================

def find_lc0() -> str:
    for path in [
        Path.home() / ".lcstudy" / "bin" / "lc0",
        Path("/opt/homebrew/bin/lc0"),
        Path("/usr/local/bin/lc0"),
    ]:
        if path.exists():
            return str(path)

    result = subprocess.run(["which", "lc0"], capture_output=True, text=True)
    if result.returncode == 0:
        return result.stdout.strip()

    raise FileNotFoundError("lc0 not found")


def find_network(name: str) -> Path:
    for ext in [".pb.gz", ".pb"]:
        path = NETS_DIR / f"{name}{ext}"
        if path.exists():
            return path
    raise FileNotFoundError(f"Network '{name}' not found")


def network_name(path: Path) -> str:
    name = path.name
    for suffix in [".pb.gz", ".pb"]:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return path.stem


def normalize_engine_uci(raw_uci: str, legal_uci: set[str]) -> str:
    """Normalize LC0's internal castling move encoding to standard UCI."""
    if raw_uci in legal_uci:
        return raw_uci

    castle_map = {
        "e1h1": "e1g1",
        "e1a1": "e1c1",
        "e8h8": "e8g8",
        "e8a8": "e8c8",
    }
    castled = castle_map.get(raw_uci)
    if castled in legal_uci:
        return castled

    return raw_uci


def encode_analysis(best_move: chess.Move, analysis: list[dict[str, object]]) -> str:
    """Encode LC0 analysis as a compact PGN-safe comment."""
    payload = {
        "v": 1,
        "best": best_move.uci(),
        "moves": analysis,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return f"[%lcstudy {encoded}]"


# =============================================================================
# Game Generation
# =============================================================================

def generate_game(
    lc0_path: str,
    leela_net: Path,
    maia_net: Path,
    maia_level: int,
    leela_budget: SearchBudget,
    maia_budget: SearchBudget,
    leela_backend: Optional[str],
    leela_config: Optional[Path],
    maia_backend: Optional[str],
    max_plies: int = MAX_PLIES,
) -> tuple[str, int, str]:
    """Generate a single game with LC0 policy analysis on every player move."""

    board = chess.Board()
    game = chess.pgn.Game()

    leela_is_white = random.random() < 0.5

    game.headers["Event"] = "LcStudy Training Game"
    game.headers["Site"] = "LcStudy"
    game.headers["White"] = "Leela (PLAYER)" if leela_is_white else f"Maia {maia_level} (AUTO)"
    game.headers["Black"] = f"Maia {maia_level} (AUTO)" if leela_is_white else "Leela (PLAYER)"
    game.headers["Result"] = "*"
    game.headers["LcStudyLeelaNet"] = network_name(leela_net)
    game.headers["LcStudyLeelaSearch"] = leela_budget.label()
    game.headers["LcStudyMaiaSearch"] = maia_budget.label()

    node = game
    plies = 0
    maia_engine = None
    leela_engine = None

    try:
        maia_engine = UciEngine(lc0_path, maia_net, backend=maia_backend, multipv=1)
        leela_engine = UciEngine(
            lc0_path,
            leela_net,
            backend=leela_backend,
            multipv=500,
            config=leela_config,
        )

        while not board.is_game_over() and plies < max_plies:
            is_leela_turn = (board.turn == chess.WHITE) == leela_is_white

            if is_leela_turn:
                move, analysis = leela_engine.get_policy_analysis(board, leela_budget)
            else:
                move = maia_engine.get_best_move(board, maia_budget)
                analysis = None

            board.push(move)
            node = node.add_variation(move)
            if analysis is not None:
                node.comment = encode_analysis(move, analysis)
            plies += 1

        # Set result
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

    finally:
        if leela_engine:
            leela_engine.quit()
        if maia_engine:
            maia_engine.quit()


def main():
    parser = argparse.ArgumentParser(description="Generate Leela vs Maia games")
    parser.add_argument("--count", "-n", type=int, default=10)
    parser.add_argument("--output", "-o", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--max-plies", type=int, default=MAX_PLIES)
    parser.add_argument("--leela-net", default=DEFAULT_LEELA_NET)
    parser.add_argument("--leela-movetime-ms", type=int, default=DEFAULT_LEELA_MOVETIME_MS)
    parser.add_argument("--maia-nodes", type=int, default=DEFAULT_MAIA_NODES)
    parser.add_argument("--leela-backend", default=None)
    parser.add_argument("--maia-backend", default="blas")
    parser.add_argument("--leela-config", type=Path, default=APPLE_SILICON_CONFIG)
    parser.add_argument("--no-leela-config", action="store_true")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--replace-output", action="store_true")
    parser.add_argument("--require-result", action="store_true")
    args = parser.parse_args()

    if args.count < 1:
        print("Error: --count must be at least 1")
        return 1
    if args.leela_movetime_ms < 1:
        print("Error: --leela-movetime-ms must be positive")
        return 1
    if args.maia_nodes < 1:
        print("Error: --maia-nodes must be positive")
        return 1
    if args.seed is not None:
        random.seed(args.seed)

    leela_budget = SearchBudget(movetime_ms=args.leela_movetime_ms)
    maia_budget = SearchBudget(nodes=args.maia_nodes)
    leela_config = None if args.no_leela_config else args.leela_config

    print("Checking setup...")

    try:
        lc0_path = find_lc0()
        print(f"  lc0: {lc0_path}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return 1

    try:
        leela_net = find_network(args.leela_net)
        print(f"  Leela: {leela_net.name}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return 1

    available_maia = [l for l in MAIA_LEVELS if (NETS_DIR / f"maia-{l}.pb.gz").exists()]
    if not available_maia:
        print(f"Error: No Maia networks in {NETS_DIR}")
        return 1
    print(f"  Maia: {available_maia}")

    args.output.mkdir(parents=True, exist_ok=True)
    existing = len(list(args.output.glob("*.pgn")))
    print(f"  Output: {args.output.name}/ ({existing} existing)")
    print(f"  Leela search: {leela_budget.label()}/move")
    print(f"  Maia search: {maia_budget.label()}/move")

    write_dir = args.output
    if args.replace_output:
        write_dir = args.output / f".new-{int(time.time())}"
        if write_dir.exists():
            shutil.rmtree(write_dir)
        write_dir.mkdir(parents=True)

    print(f"\nGenerating {args.count} games...\n")

    start = time.time()
    success = 0
    total_plies = 0

    attempts = 0
    max_attempts = max(args.count * 4, args.count + 5)
    batch_id = f"seed_{args.seed}" if args.seed is not None else f"seed_{int(time.time())}"

    while success < args.count and attempts < max_attempts:
        attempts += 1
        level = random.choice(available_maia)
        maia_net = find_network(f"maia-{level}")

        try:
            pgn, plies, result = generate_game(
                lc0_path,
                leela_net,
                maia_net,
                level,
                leela_budget,
                maia_budget,
                args.leela_backend,
                leela_config,
                args.maia_backend,
                args.max_plies,
            )
            if args.require_result and result == "*":
                raise ValueError(f"Game reached {plies} plies without a result")

            fname = f"{batch_id}_{success + 1:04d}.pgn"
            (write_dir / fname).write_text(pgn)

            success += 1
            total_plies += plies
            color = "W" if "PLAYER" in pgn.split("[White")[1].split("]")[0] else "B"
            print(f"  [{success}/{args.count}] {fname} - L={color}, M={level}, {plies}p")

        except Exception as e:
            print(f"  [ERROR] {attempts}: {e}")
            time.sleep(0.5)

    elapsed = time.time() - start
    avg = total_plies / success if success else 0

    if args.replace_output:
        if success != args.count:
            shutil.rmtree(write_dir)
            print("Replacement aborted; existing PGNs were left unchanged.")
            return 1
        for old_file in args.output.glob("*.pgn"):
            old_file.unlink()
        for new_file in sorted(write_dir.glob("*.pgn")):
            new_file.replace(args.output / new_file.name)
        shutil.rmtree(write_dir)
        print("Replaced existing PGNs with the new generated set.")

    print(f"\nDone! {success}/{args.count} in {elapsed:.0f}s ({avg:.0f} avg plies)")
    if success != args.count:
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
