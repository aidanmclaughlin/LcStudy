from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

import chess


class SessionStatus(Enum):
    PLAYING = "playing"
    FINISHED = "finished"
    PAUSED = "paused"


class GameResult(Enum):
    FINISHED = "finished"
    RESIGNED = "resigned"
    DRAW = "draw"


@dataclass
class MoveAttempt:
    move_uci: str
    is_correct: bool
    attempt_number: int
    timestamp: float


@dataclass
class GameMove:
    move_uci: str
    san_notation: str
    attempts: List[MoveAttempt]
    final_attempt_count: int
    is_human_move: bool
    analysis_snapshot: Optional["AnalysisLine"] = None


@dataclass
class GameSession:
    id: str
    board: chess.Board
    status: SessionStatus
    player_color: chess.Color
    maia_level: int
    score_total: float
    move_index: int
    history: List[GameMove]
    flip: bool

    current_move_attempts: int = 0

    # Precomputed game tracking (when using pregenerated Leela vs Maia games)
    precomputed_game_id: Optional[str] = None
    precomputed_ply_index: int = 0


@dataclass
class GameHistoryEntry:
    date: str
    average_retries: float
    total_moves: int
    maia_level: int
    result: GameResult
    session_id: Optional[str] = None


@dataclass
class EngineConfigRemoved:  # deprecated placeholder (use lcstudy.engines.EngineConfig)
    pass


@dataclass
class PlayerStatistics:
    total_games: int
    average_attempts_per_move: float
    total_moves: int
    win_rate: float
    average_game_length: int
    improvement_trend: float


@dataclass
class AnalysisLine:
    multipv: int
    move: str
    cp: Optional[int]
    mate: Optional[int]
    wdl: Optional[int]
    nps: Optional[int]
    nodes: Optional[int]
    depth: Optional[int]
    seldepth: Optional[int]
