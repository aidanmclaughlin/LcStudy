from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, List, Dict
from enum import Enum
import threading
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
class AnalysisLine:
    multipv: int
    move: Optional[str]
    cp: Optional[int]
    mate: Optional[int]
    wdl: Optional[List[float]]
    nps: Optional[int]
    nodes: Optional[int]
    depth: Optional[int]
    seldepth: Optional[int]

@dataclass
class EngineAnalysis:
    position_fen: str
    lines: List[AnalysisLine]
    nodes: int
    depth: int
    is_analyzing: bool
    analysis_time: float

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
    analysis_snapshot: Optional[EngineAnalysis]

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
    
    multipv: int = 5
    leela_nodes: int = 2000
    maia_nodes: int = 150
    leela_weights: Optional[str] = None
    maia_weights: Optional[str] = None
    
    continuous_analysis_thread: Optional[threading.Thread] = None
    stop_analysis_event: threading.Event = field(default_factory=threading.Event)
    current_analysis_nodes: int = 0
    current_best_move: Optional[str] = None
    current_best_lines: List[AnalysisLine] = field(default_factory=list)
    analysis_position_fen: Optional[str] = None
    snapshotted_best_move: Optional[str] = None
    position_start_time: float = 0.0
    current_move_attempts: int = 0
    
    leela_lock: threading.Lock = field(default_factory=threading.Lock)
    maia_lock: threading.Lock = field(default_factory=threading.Lock)
    last_lines: List[Dict] = field(default_factory=list)

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
