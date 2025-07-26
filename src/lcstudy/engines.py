from __future__ import annotations

import asyncio
import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

import chess
import chess.engine


def home_dir() -> Path:
    d = os.environ.get("LCSTUDY_HOME")
    if d:
        return Path(d).expanduser()
    # Default to ~/.lcstudy
    return Path.home() / ".lcstudy"


def bin_dir() -> Path:
    return home_dir() / "bin"


def nets_dir() -> Path:
    return home_dir() / "nets"


def ensure_dirs() -> None:
    bin_dir().mkdir(parents=True, exist_ok=True)
    nets_dir().mkdir(parents=True, exist_ok=True)


def default_backend() -> Optional[str]:
    sysname = platform.system().lower()
    machine = platform.machine().lower()
    if sysname == "darwin":
        # Prefer Metal on macOS for Apple Silicon and Intel (if present)
        return "metal"
    if sysname == "linux":
        # Let lc0 pick; users can override to opencl/cuda depending on setup
        return None
    if sysname == "windows":
        return None
    return None


def find_lc0() -> Optional[Path]:
    # 1) Look for system lc0
    p = shutil.which("lc0")
    if p:
        return Path(p)
    # 2) Look in our bin
    cand = bin_dir() / "lc0"
    if cand.exists():
        return cand
    # 3) On Windows
    cand_exe = bin_dir() / "lc0.exe"
    if cand_exe.exists():
        return cand_exe
    return None


@dataclass
class EngineConfig:
    exe: Path
    weights: Optional[Path] = None
    threads: int = max(os.cpu_count() or 2, 2)
    backend: Optional[str] = default_backend()

    def to_options(self) -> dict[str, object]:
        opts: dict[str, object] = {
            "Threads": self.threads,
        }
        if self.backend:
            # lc0 uses Backend option name
            opts["Backend"] = self.backend
        if self.weights:
            # lc0 accepts either WeightsFile or Weights depending on version
            opts["WeightsFile"] = str(self.weights)
            opts["Weights"] = str(self.weights)
        return opts


class Lc0Engine:
    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.engine: Optional[chess.engine.SimpleEngine] = None

    def __enter__(self) -> "Lc0Engine":
        self.open()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def open(self) -> None:
        if self.engine is not None:
            return
        self.engine = chess.engine.SimpleEngine.popen_uci(str(self.cfg.exe))
        # Configure options
        try:
            self.engine.configure(self.cfg.to_options())
        except chess.engine.EngineError:
            # Some options may not exist in some builds; ignore
            pass

    def close(self) -> None:
        if self.engine is not None:
            try:
                self.engine.quit()
            finally:
                self.engine = None

    def analyse(
        self,
        board: chess.Board,
        *,
        seconds: Optional[float] = None,
        nodes: Optional[int] = None,
        depth: Optional[int] = None,
        multipv: int = 1,
    ) -> list[chess.engine.InfoDict]:
        if self.engine is None:
            raise RuntimeError("Engine not open")
        limit = chess.engine.Limit(time=seconds, nodes=nodes, depth=depth)
        info = self.engine.analyse(board, limit, multipv=multipv)
        if isinstance(info, dict):
            return [info]
        return info

    def bestmove(
        self,
        board: chess.Board,
        *,
        seconds: Optional[float] = None,
        nodes: Optional[int] = None,
        depth: Optional[int] = None,
    ) -> chess.Move:
        if self.engine is None:
            raise RuntimeError("Engine not open")
        limit = chess.engine.Limit(time=seconds, nodes=nodes, depth=depth)
        result = self.engine.play(board, limit)
        return result.move


def pv_to_san(board: chess.Board, pv: Iterable[chess.Move]) -> str:
    b = board.copy(stack=False)
    parts: list[str] = []
    for mv in pv:
        parts.append(b.san(mv))
        b.push(mv)
    return " ".join(parts)


def info_to_lines(
    infos: Iterable[chess.engine.InfoDict], pov: chess.Color
) -> list[dict]:
    lines: list[dict] = []
    for idx, info in enumerate(infos, start=1):
        move = None
        if pv := info.get("pv"):
            move = pv[0]
        score = info.get("score")
        cp: Optional[int] = None
        mate: Optional[int] = None
        if score is not None:
            pov_score = score.pov(pov)
            if pov_score.is_mate():
                mate = pov_score.mate()
            else:
                cp = pov_score.score()
        nps = info.get("nps")
        nodes = info.get("nodes")
        depth = info.get("depth")
        seldepth = info.get("seldepth")
        lines.append(
            {
                "multipv": idx,
                "move": move.uci() if isinstance(move, chess.Move) else None,
                "cp": cp,
                "mate": mate,
                "nps": nps,
                "nodes": nodes,
                "depth": depth,
                "seldepth": seldepth,
            }
        )
    return lines


def info_to_lines_san(
    board: chess.Board, infos: Iterable[chess.engine.InfoDict], pov: chess.Color
) -> list[dict]:
    lines: list[dict] = []
    for idx, info in enumerate(infos, start=1):
        pv = info.get("pv")
        move = pv[0] if pv else None
        score = info.get("score")
        cp = mate = None
        if score is not None:
            pov_score = score.pov(pov)
            if pov_score.is_mate():
                mate = pov_score.mate()
            else:
                cp = pov_score.score()
        san_line = pv_to_san(board, pv) if pv else ""
        lines.append(
            {
                "multipv": idx,
                "move": move.uci() if isinstance(move, chess.Move) else None,
                "san": san_line,
                "cp": cp,
                "mate": mate,
            }
        )
    return lines


def pick_from_multipv(
    infos: list[chess.engine.InfoDict],
    pov: chess.Color,
    temperature: float = 1.0,
) -> chess.Move:
    # Softmax over cp scores (converted to centipawns from pov)
    import math

    moves: list[chess.Move] = []
    scores: list[float] = []
    best_cp = None

    for info in infos:
        pv = info.get("pv")
        if not pv:
            continue
        move = pv[0]
        score = info.get("score")
        if score is None:
            continue
        pov_score = score.pov(pov)
        if pov_score.is_mate():
            # If a mate line exists, prefer it deterministically
            return move
        cp = float(pov_score.score())
        if best_cp is None or cp > best_cp:
            best_cp = cp
        moves.append(move)
        scores.append(cp)

    if not moves:
        # Fallback: choose the first pv move
        for info in infos:
            pv = info.get("pv")
            if pv:
                return pv[0]
        raise RuntimeError("No move found in infos")

    if temperature <= 1e-6:
        return moves[scores.index(max(scores))]

    # Normalize scores relative to best to stabilize exponentials
    max_cp = max(scores)
    logits = [(s - max_cp) / max(temperature, 1e-6) for s in scores]
    exps = [math.exp(l) for l in logits]
    total = sum(exps)
    if total <= 0:
        return moves[scores.index(max(scores))]
    probs = [e / total for e in exps]

    import random

    r = random.random()
    c = 0.0
    for mv, p in zip(moves, probs):
        c += p
        if r <= c:
            return mv
    return moves[-1]


def score_similarity(
    best_cp: Optional[int],
    chosen_cp: Optional[int],
    rank: Optional[int],
    max_rank: int,
) -> float:
    # Simple scoring: 1.0 for exact best move, else discount by cp delta and rank
    if rank == 1:
        return 1.0
    # If no evals, fallback on rank-based scoring
    if best_cp is None or chosen_cp is None:
        if rank is None:
            return 0.0
        return max(0.0, 1.0 - (rank - 1) / max(max_rank - 1, 1))
    delta = float(best_cp - chosen_cp)
    # Convert to [0,1] using exp decay per 100 cp
    import math

    base = math.exp(-max(0.0, delta) / 100.0)
    if rank is not None and max_rank > 1:
        base *= max(0.6, 1.0 - 0.1 * (rank - 1))
    return max(0.0, min(1.0, base))
