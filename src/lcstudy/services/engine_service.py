from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from typing import Dict, List

import chess
import chess.engine

from ..config import get_settings
from ..config.logging import get_logger
from ..engines import (EngineConfig, Lc0Engine, find_lc0, info_to_lines,
                       nets_dir)
from ..exceptions import EngineAnalysisError, EngineNotFoundError

logger = get_logger("engine_service")


class EngineInterface(ABC):
    @abstractmethod
    def analyze(self, board: chess.Board, nodes: int) -> List[dict]:
        pass

    @abstractmethod
    def get_best_move(self, board: chess.Board, nodes: int) -> chess.Move:
        pass

    @abstractmethod
    def close(self):
        pass


class LeelaEngine(EngineInterface):
    def __init__(self, config: EngineConfig):
        logger.info(f"Initializing LeelaEngine with config: {config}")
        self.config = config
        try:
            self.engine = Lc0Engine(config)
            logger.info("Lc0Engine object created, opening engine...")
            self.engine.open()
            logger.info("Engine opened successfully")
        except Exception as e:
            logger.error(f"Failed to initialize LeelaEngine: {e}")
            raise
        self._lock = threading.Lock()

    def analyze(self, board: chess.Board, nodes: int) -> List[dict]:
        logger.debug(
            f"Starting analysis with {nodes} nodes for position: {board.fen()}"
        )
        with self._lock:
            try:
                logger.debug("Calling engine.analyse...")
                infos = self.engine.analyse(board, nodes=nodes)
                logger.debug(
                    f"Engine returned {len(infos) if isinstance(infos, list) else 1} analysis result(s)"
                )

                if not isinstance(infos, list):
                    infos = [infos]

                # Use the existing info_to_lines function
                lines = info_to_lines(infos, board.turn)
                logger.debug(f"Converted to {len(lines)} analysis lines")
                logger.debug(f"First line: {lines[0] if lines else 'No lines'}")
                return lines
            except Exception as e:
                logger.error(f"Leela analysis failed: {e}")
                raise EngineAnalysisError(f"Leela analysis failed: {e}")

    def analyze_stream(self, board: chess.Board, nodes: int):
        """Yield incremental analysis info dicts from the engine until done.

        This provides real-time updates suitable for polling from the UI.
        """
        if self.engine.engine is None:
            raise EngineAnalysisError("Engine process not started")
        limit = chess.engine.Limit(nodes=nodes)
        # We intentionally do not hold the lock across the entire stream
        # acquisition to avoid deadlocks on stop. The caller manages lifecycle
        # and interruption.
        return self.engine.engine.analysis(board, limit)

    def get_best_move(self, board: chess.Board, nodes: int) -> chess.Move:
        logger.debug(
            f"Getting best move with {nodes} nodes for position: {board.fen()}"
        )
        with self._lock:
            try:
                move = self.engine.bestmove(board, nodes=nodes)
                logger.debug(f"Engine returned best move: {move.uci()}")
                return move
            except Exception as e:
                logger.error(f"Leela bestmove failed: {e}")
                raise EngineAnalysisError(f"Leela bestmove failed: {e}")

    def close(self):
        if self.engine:
            self.engine.close()


class EngineService:
    def __init__(self):
        self.settings = get_settings()
        self._leela_engines: Dict[str, LeelaEngine] = {}
        self._maia_engines: Dict[int, LeelaEngine] = {}
        self._engine_lock = threading.Lock()

    def get_leela_engine(self, session_id: str) -> LeelaEngine:
        with self._engine_lock:
            if session_id not in self._leela_engines:
                logger.info(f"Creating new Leela engine for session {session_id}")
                try:
                    config = self._create_leela_config()
                    logger.info(
                        f"Leela config: exe={config.exe}, weights={config.weights}"
                    )
                    self._leela_engines[session_id] = LeelaEngine(config)
                    logger.info(
                        f"Leela engine created successfully for session {session_id}"
                    )
                except Exception as e:
                    logger.error(
                        f"Failed to create Leela engine for session {session_id}: {e}"
                    )
                    raise
            else:
                logger.debug(f"Reusing existing Leela engine for session {session_id}")
            return self._leela_engines[session_id]

    def get_maia_engine(self, level: int) -> LeelaEngine:
        with self._engine_lock:
            if level not in self._maia_engines:
                logger.info(f"Creating new Maia engine for level {level}")
                try:
                    config = self._create_maia_config(level)
                    logger.info(
                        f"Maia config: exe={config.exe}, weights={config.weights}"
                    )
                    self._maia_engines[level] = LeelaEngine(config)
                    logger.info(f"Maia engine created successfully for level {level}")
                except Exception as e:
                    logger.error(f"Failed to create Maia engine for level {level}: {e}")
                    raise
            else:
                logger.debug(f"Reusing existing Maia engine for level {level}")
            return self._maia_engines[level]

    def cleanup_session_engines(self, session_id: str):
        with self._engine_lock:
            if session_id in self._leela_engines:
                self._leela_engines[session_id].close()
                del self._leela_engines[session_id]

    def shutdown_all(self):
        with self._engine_lock:
            for engine in self._leela_engines.values():
                engine.close()
            for engine in self._maia_engines.values():
                engine.close()
            self._leela_engines.clear()
            self._maia_engines.clear()

    def _create_leela_config(self) -> EngineConfig:
        logger.info("Creating Leela configuration...")

        lc0_path = find_lc0()
        logger.info(f"lc0 path search result: {lc0_path}")
        if not lc0_path:
            logger.error("lc0 executable not found in PATH or standard locations")
            raise EngineNotFoundError("lc0 executable not found")

        nets = nets_dir()
        logger.info(f"Networks directory: {nets}")
        best_net = nets / "lczero-best.pb.gz"
        logger.info(f"Looking for Leela network at: {best_net}")

        if not best_net.exists():
            logger.error(f"Leela network file not found: {best_net}")
            logger.info(
                f"Available files in {nets}: {list(nets.glob('*.pb.gz')) if nets.exists() else 'Directory does not exist'}"
            )
            raise EngineNotFoundError("Leela network not found")

        config = EngineConfig(
            exe=lc0_path,
            weights=best_net,
            threads=self.settings.engine.default_threads,
            backend=self.settings.engine.backend,
        )
        logger.info(f"Leela config created: {config}")
        return config

    def _create_maia_config(self, level: int) -> EngineConfig:
        logger.info(f"Creating Maia configuration for level {level}...")

        lc0_path = find_lc0()
        logger.info(f"lc0 path search result: {lc0_path}")
        if not lc0_path:
            logger.error("lc0 executable not found in PATH or standard locations")
            raise EngineNotFoundError("lc0 executable not found")

        nets = nets_dir()
        logger.info(f"Networks directory: {nets}")
        maia_net = nets / f"maia-{level}.pb.gz"
        logger.info(f"Looking for Maia network at: {maia_net}")

        if not maia_net.exists():
            logger.error(f"Maia {level} network file not found: {maia_net}")
            logger.info(
                f"Available files in {nets}: {list(nets.glob('*.pb.gz')) if nets.exists() else 'Directory does not exist'}"
            )
            raise EngineNotFoundError(f"Maia {level} network not found")

        config = EngineConfig(
            exe=lc0_path,
            weights=maia_net,
            threads=self.settings.engine.default_threads,
            backend=self.settings.engine.backend,
        )
        logger.info(f"Maia config created: {config}")
        return config
