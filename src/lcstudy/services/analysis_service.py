from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Dict, List, Optional

from ..config.logging import get_logger
from ..domain.models import GameSession
from ..engines import info_to_lines
from ..services.engine_service import EngineService

logger = get_logger("analysis_service")


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
        logger.debug(f"Starting analysis for session {session.id} with {nodes} nodes")
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
                daemon=True,
            )
            self._active_analyses[session.id] = thread
            thread.start()
            logger.debug(f"Analysis thread started for session {session.id}")

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

    def _run_analysis(
        self, session: GameSession, nodes: int, stop_event: threading.Event
    ) -> None:
        logger.debug(f"Running analysis for session {session.id}")
        try:
            logger.debug("Getting Leela engine...")
            leela_engine = self.engine_service.get_leela_engine(session.id)
            logger.debug("Got Leela engine, starting analysis...")

            # Stream incremental analysis updates for real-time node tracking
            board_copy = session.board.copy()
            with leela_engine.analyze_stream(board_copy, nodes) as ctx:
                for info in ctx:
                    if stop_event.is_set():
                        # Ensure the engine is asked to stop before breaking
                        try:
                            ctx.stop()
                        except Exception:
                            pass
                        break
                    infos = [info]
                    lines = info_to_lines(infos, board_copy.turn)
                    latest_nodes = int(info.get("nodes", 0) or 0)
                    logger.debug(
                        "Analysis update for %s: nodes=%s depth=%s best=%s",
                        session.id,
                        latest_nodes,
                        info.get("depth"),
                        lines[0]["move"] if lines else None,
                    )
                    result = AnalysisResult(
                        session_id=session.id,
                        position_fen=session.board.fen(),
                        nodes=latest_nodes,
                        best_move=lines[0]["move"] if lines else None,
                        lines=lines,
                        is_complete=False,
                    )
                    with self._lock:
                        self._results[session.id] = result
            # Final snapshot as complete
            final_result = self._results.get(session.id)
            if final_result:
                with self._lock:
                    self._results[session.id] = AnalysisResult(
                        session_id=final_result.session_id,
                        position_fen=final_result.position_fen,
                        nodes=final_result.nodes,
                        best_move=final_result.best_move,
                        lines=final_result.lines,
                        is_complete=True,
                    )
            logger.info(f"Analysis completed for session {session.id}")

        except Exception as e:
            logger.error(f"Analysis failed for session {session.id}: {e}")
            with self._lock:
                self._results[session.id] = AnalysisResult(
                    session_id=session.id,
                    position_fen=session.board.fen(),
                    nodes=0,
                    best_move=None,
                    lines=[],
                    is_complete=True,
                )

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
