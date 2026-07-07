#!/usr/bin/env python3
"""
Re-analyze existing LcStudy PGNs with search statistics (v2 blobs).

Replays each game's recorded mainline and re-searches every Leela position at
a fixed node budget, recording per legal move:
  p - raw network policy prior (%)
  n - search visit share (%)
  q - value in [-1, 1] from the side to move: search Q when the move was
      visited, otherwise the net's one-node value estimate V
  a - partial credit 0-100: win% loss vs the RECORDED played move, mapped
      through a = 100 * exp(-loss / TAU); the played move is pinned at 100.

The recorded mainline (the moves the user predicts) is never changed — only
the analysis comments are rewritten. Files already carrying v2 blobs are
skipped, so the tool is idempotent and restartable.

Positions are fed to lc0 as `position startpos moves ...` so consecutive
prompts in a game reuse the search tree, and the NN cache absorbs the heavy
opening overlap across games.

Usage:
    caffeinate -i python3 tools/reanalyze_games.py              # full corpus
    python3 tools/reanalyze_games.py --limit 2 --workers 1      # smoke test
"""

import argparse
import base64
import gzip
import io
import json
import math
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

try:
    import chess
    import chess.pgn
except ImportError:
    print("Missing dependency. Install with: pip install chess")
    sys.exit(1)

NETS_DIR = Path.home() / ".lcstudy" / "nets"
PGN_DIR = Path(__file__).parent.parent / "src" / "lcstudy" / "data" / "pgn"
APPLE_SILICON_CONFIG = Path(__file__).parent / "lc0-apple-silicon.config"

TAU = 10.0  # win% loss that costs a factor e of partial credit

_print_lock = threading.Lock()


def log(msg: str):
    with _print_lock:
        print(msg, flush=True)


def find_lc0() -> str:
    for path in [
        Path.home() / ".lcstudy" / "bin" / "lc0",
        Path("/opt/homebrew/bin/lc0"),
        Path("/usr/local/bin/lc0"),
    ]:
        if path.exists():
            return str(path)
    result = subprocess.run(["which", "lc0"], capture_output=True, text=True)
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    raise FileNotFoundError("lc0 not found")


def decode_blob(comment: str) -> Optional[dict]:
    m = re.search(r"\[%lcstudy\s+([A-Za-z0-9_-]+)\]", comment)
    if not m:
        return None
    raw = m.group(1).replace("-", "+").replace("_", "/")
    raw += "=" * (-len(raw) % 4)
    return json.loads(base64.b64decode(raw))


def encode_blob(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return f"[%lcstudy {encoded}]"


def normalize_engine_uci(raw_uci: str, legal_uci: set) -> str:
    if raw_uci in legal_uci:
        return raw_uci
    castle_map = {"e1h1": "e1g1", "e1a1": "e1c1", "e8h8": "e8g8", "e8a8": "e8c8"}
    castled = castle_map.get(raw_uci)
    if castled in legal_uci:
        return castled
    return raw_uci


class UciEngine:
    """Synchronous UCI wrapper collecting verbose move stats (P, N, Q, V)."""

    def __init__(self, lc0_path: str, weights: Path, config: Optional[Path]):
        command = [lc0_path, f"--weights={weights}"]
        if config and config.exists():
            command.append(f"--config={config}")
        self.proc = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
        )
        self._send("uci")
        self._wait_for("uciok")
        self._send("setoption name MultiPV value 500")
        self._send("setoption name VerboseMoveStats value true")
        self._send("isready")
        self._wait_for("readyok")

    def _send(self, cmd: str):
        self.proc.stdin.write(cmd + "\n")
        self.proc.stdin.flush()

    def _readline(self) -> str:
        line = self.proc.stdout.readline()
        if not line and self.proc.poll() is not None:
            raise RuntimeError(f"lc0 exited (rc={self.proc.returncode})")
        return line.strip()

    def _wait_for(self, expected: str):
        while True:
            if self._readline().startswith(expected):
                return

    def analyze(self, board: chess.Board, move_history: list, nodes: int) -> dict:
        """Search the position; return {uci: {p, n, q, v}} for every legal move."""
        legal_uci = {m.uci() for m in board.legal_moves}
        stats = {}

        if move_history:
            self._send(f"position startpos moves {' '.join(move_history)}")
        else:
            self._send("position startpos")
        self._send(f"go nodes {nodes}")

        while True:
            line = self._readline()

            if line.startswith("info string"):
                mv = re.match(r"info string\s+([a-h][1-8][a-h][1-8][qrbn]?)\s", line)
                p_m = re.search(r"\(P:\s*([0-9.]+)%\)", line)
                n_m = re.search(r"N:\s*(\d+)", line)
                q_m = re.search(r"\(Q:\s*(-?[0-9.]+)\)", line)
                v_m = re.search(r"\(V:\s*(-?[0-9.]+)\)", line)
                if mv and p_m:
                    uci = normalize_engine_uci(mv.group(1), legal_uci)
                    if uci in legal_uci:
                        stats[uci] = {
                            "p": float(p_m.group(1)),
                            "n": int(n_m.group(1)) if n_m else 0,
                            "q": float(q_m.group(1)) if q_m else None,
                            "v": float(v_m.group(1)) if v_m else None,
                        }

            if line.startswith("bestmove"):
                break

        missing = sorted(legal_uci - set(stats))
        if missing:
            raise ValueError(f"missing legal moves in verbose stats: {missing[:6]}")
        return stats

    def quit(self):
        try:
            self._send("quit")
            self.proc.wait(timeout=2)
        except Exception:
            self.proc.kill()


def effective_q(stats: dict) -> Optional[float]:
    """Search Q for visited moves; net value estimate V otherwise."""
    if stats["n"] > 0 and stats["q"] is not None:
        return stats["q"]
    return stats["v"]


def win_pct(q: Optional[float], fallback: float) -> float:
    if q is None:
        return fallback
    return 50.0 + 50.0 * max(-1.0, min(1.0, q))


def build_v2_analysis(board: chess.Board, stats: dict, played_uci: str, nodes: int) -> dict:
    total_visits = sum(s["n"] for s in stats.values()) or 1

    qs = [effective_q(s) for s in stats.values()]
    worst_wp = min((win_pct(q, 0.0) for q in qs if q is not None), default=0.0)
    played_wp = win_pct(effective_q(stats[played_uci]), 50.0)

    moves = []
    for move in board.legal_moves:
        uci = move.uci()
        s = stats[uci]
        q = effective_q(s)
        wp = win_pct(q, worst_wp)  # unevaluated moves grade like the worst known move
        loss = max(0.0, played_wp - wp)
        a = 100.0 if uci == played_uci else 100.0 * math.exp(-loss / TAU)
        moves.append({
            "u": uci,
            "s": board.san(move),
            "p": round(s["p"], 2),
            "n": round(100.0 * s["n"] / total_visits, 2),
            "q": round(q, 4) if q is not None else None,
            "a": round(a, 2),
        })

    moves.sort(key=lambda item: item["a"], reverse=True)
    return {"v": 2, "best": played_uci, "nodes": nodes, "moves": moves}


def read_pgn_text(path: Path) -> str:
    if str(path).endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return fh.read()
    return path.read_text()


def write_pgn_text(path: Path, text: str):
    if str(path).endswith(".gz"):
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as fh:
            fh.write(text)
    else:
        path.write_text(text)


def reanalyze_file(path: Path, engine: UciEngine, nodes: int) -> tuple[bool, int]:
    """Returns (changed, prompts). Skips files whose blobs are already v2."""
    text = read_pgn_text(path)
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None:
        raise ValueError("unparsable PGN")

    board = game.board()
    history: list = []
    prompts = 0
    changed = False

    for node in game.mainline():
        payload = decode_blob(node.comment) if node.comment else None
        if payload is not None and payload.get("v") != 2:
            stats = engine.analyze(board, history, nodes)
            node.comment = encode_blob(build_v2_analysis(board, stats, node.move.uci(), nodes))
            prompts += 1
            changed = True
        board.push(node.move)
        history.append(node.move.uci())

    if changed:
        game.headers["LcStudyGrading"] = f"q-wpl-exp{TAU:g}@{nodes}n"
        exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=True)
        write_pgn_text(path, game.accept(exporter) + "\n")

    return changed, prompts


class Progress:
    def __init__(self, total_files: int):
        self.total = total_files
        self.done = 0
        self.skipped = 0
        self.prompts = 0
        self.start = time.time()
        self.lock = threading.Lock()

    def update(self, changed: bool, prompts: int, name: str):
        with self.lock:
            if changed:
                self.done += 1
                self.prompts += prompts
            else:
                self.skipped += 1
            processed = self.done + self.skipped
            if processed % 25 == 0 or processed == self.total:
                elapsed = time.time() - self.start
                rate = self.prompts / elapsed if elapsed > 0 else 0
                remaining_files = self.total - processed
                eta_h = (remaining_files * (elapsed / max(1, processed))) / 3600
                log(f"[{processed}/{self.total}] reanalyzed={self.done} skipped={self.skipped} "
                    f"prompts={self.prompts} rate={rate:.2f}/s eta={eta_h:.1f}h (last: {name})")


def worker(files: list, lc0: str, weights: Path, nodes: int, progress: Progress):
    engine = UciEngine(lc0, weights, APPLE_SILICON_CONFIG)
    try:
        for path in files:
            try:
                changed, prompts = reanalyze_file(path, engine, nodes)
            except Exception as e:
                log(f"[ERROR] {path.name}: {e}")
                engine.quit()
                engine = UciEngine(lc0, weights, APPLE_SILICON_CONFIG)
                continue
            progress.update(changed, prompts, path.name)
    finally:
        engine.quit()


def main():
    parser = argparse.ArgumentParser(description="Re-analyze LcStudy PGNs with v2 search blobs")
    parser.add_argument("--dir", type=Path, default=PGN_DIR)
    parser.add_argument("--nodes", type=int, default=200)
    parser.add_argument("--leela-net", default="BT4-it332")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()

    weights = None
    for ext in (".pb.gz", ".pb"):
        candidate = NETS_DIR / f"{args.leela_net}{ext}"
        if candidate.exists():
            weights = candidate
            break
    if weights is None:
        print(f"Error: net {args.leela_net} not found in {NETS_DIR}")
        return 1

    files = sorted(list(args.dir.glob("*.pgn")) + list(args.dir.glob("*.pgn.gz")))
    if args.limit:
        files = files[: args.limit]

    lc0 = find_lc0()
    log(f"lc0: {lc0}")
    log(f"net: {weights.name}  nodes: {args.nodes}  files: {len(files)}  workers: {args.workers}")

    progress = Progress(len(files))
    shards = [files[i::args.workers] for i in range(args.workers)]

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(worker, shard, lc0, weights, args.nodes, progress)
                   for shard in shards if shard]
        for f in futures:
            f.result()

    elapsed = (time.time() - progress.start) / 60
    log(f"DONE reanalyzed={progress.done} skipped={progress.skipped} "
        f"prompts={progress.prompts} in {elapsed:.0f}m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
