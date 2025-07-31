from __future__ import annotations
import threading
from typing import Optional, List, Dict
from dataclasses import dataclass

import chess
from ..domain.models import GameSession
from ..services.engine_service import EngineService
from ..config.logging import get_logger

logger = get_logger('analysis_service')

@dataclass
class AnalysisResult:
    session_id: str
    position_fen: str
    nodes: int
    best_move: Optional[str]
    lines: List[dict]
    is_complete: bool

class AnalysisService:
    def __init__(self, engine_service: EngineService):
        self.engine_service = engine_service
        self._active_analyses: Dict[str, threading.Thread] = {}
        self._stop_events: Dict[str, threading.Event] = {}
        self._results: Dict[str, AnalysisResult] = {}
        self._lock = threading.Lock()
    
    def start_analysis(self, session: GameSession, nodes: int = 2000) -> None:
        logger.info(f"Starting analysis for session {session.id} with {nodes} nodes")
        with self._lock:
            self._stop_existing_analysis(session.id)

            # Reuse cached result if FEN matches to avoid rework
            cached = self._results.get(session.id)
            if cached and cached.position_fen == session.board.fen():
                logger.debug("Reusing cached analysis for session %s", session.id)
                return
            
            stop_event = threading.Event()
            self._stop_events[session.id] = stop_event
            
            thread = threading.Thread(
                target=self._run_analysis,
                args=(session, nodes, stop_event),
                daemon=True
            )
            self._active_analyses[session.id] = thread
            thread.start()
            logger.info(f"Analysis thread started for session {session.id}")
    
    def stop_analysis(self, session_id: str) -> None:
        with self._lock:
            self._stop_existing_analysis(session_id)
    
    def get_analysis_result(self, session_id: str) -> Optional[AnalysisResult]:
        with self._lock:
            return self._results.get(session_id)
    
    def is_analyzing(self, session_id: str) -> bool:
        with self._lock:
            return session_id in self._active_analyses
    
    def _stop_existing_analysis(self, session_id: str) -> None:
        if session_id in self._stop_events:
            self._stop_events[session_id].set()
        
        if session_id in self._active_analyses:
            thread = self._active_analyses[session_id]
            if thread.is_alive():
                thread.join(timeout=2.0)
            del self._active_analyses[session_id]
        
        if session_id in self._stop_events:
            del self._stop_events[session_id]
    
    def _heuristic_top_lines(self, board: chess.Board, k: int = 3) -> List[dict]:
        """Very cheap heuristic ranking when engines are unavailable."""
        moves = list(board.legal_moves)
        scored: List[tuple[float, chess.Move]] = []
        for mv in moves:
            score = 0.0
            if board.is_capture(mv):
                score += 100
            board.push(mv)
            if board.is_check():
                score += 50
            fx, fy = chess.square_file(mv.to_square), chess.square_rank(mv.to_square)
            score += (3 - abs(3.5 - fx)) + (3 - abs(3.5 - fy))
            board.pop()
            scored.append((score, mv))
        scored.sort(key=lambda x: x[0], reverse=True)
        out: List[dict] = []
        for i, (_, mv) in enumerate(scored[:k], start=1):
            out.append({
                "multipv": i,
                "move": mv.uci(),
                "cp": None,
                "mate": None,
                "wdl": None,
                "nps": None,
                "nodes": None,
                "depth": None,
                "seldepth": None,
            })
        return out

    def _run_analysis(self, session: GameSession, nodes: int, stop_event: threading.Event) -> None:
        logger.info(f"Running analysis for session {session.id}")
        try:
            logger.debug("Getting Leela engine...")
            leela_engine = self.engine_service.get_leela_engine(session.id)
            logger.debug("Got Leela engine, starting analysis...")

            # Copy board to avoid concurrency issues
            board_copy = session.board.copy()
            lines = leela_engine.analyze(board_copy, nodes)
            logger.info(f"Analysis completed for session {session.id}, got {len(lines)} lines")
            
            result = AnalysisResult(
                session_id=session.id,
                position_fen=session.board.fen(),
                nodes=nodes,
                best_move=lines[0]['move'] if lines else None,
                lines=lines,
                is_complete=True
            )
            
            with self._lock:
                self._results[session.id] = result
            logger.info(f"Analysis result stored for session {session.id}")
        
        except Exception as e:
            logger.error(f"Analysis failed for session {session.id}: {e}")
            # Fallback heuristic lines
            board_copy = session.board.copy()
            lines = self._heuristic_top_lines(board_copy, k=3)
            result = AnalysisResult(
                session_id=session.id,
                position_fen=session.board.fen(),
                nodes=0,
                best_move=lines[0]['move'] if lines else None,
                lines=lines,
                is_complete=True
            )
            
            with self._lock:
                self._results[session.id] = result
        
        finally:
            with self._lock:
                if session.id in self._active_analyses:
                    del self._active_analyses[session.id]
                if session.id in self._stop_events:
                    del self._stop_events[session.id]
    
    def shutdown_all(self) -> None:
        with self._lock:
            for session_id in list(self._active_analyses.keys()):
                self._stop_existing_analysis(session_id)
            self._results.clear()
