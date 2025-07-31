from __future__ import annotations
from functools import lru_cache

from ..config import get_settings
from ..repositories.session_repository import InMemorySessionRepository
from ..repositories.game_history_repository import JsonGameHistoryRepository
from ..services.engine_service import EngineService
from ..services.game_service import GameService
from ..services.analysis_service import AnalysisService


@lru_cache(maxsize=1)
def get_session_repository() -> InMemorySessionRepository:
    return InMemorySessionRepository()


@lru_cache(maxsize=1)
def get_history_repository() -> JsonGameHistoryRepository:
    settings = get_settings()
    return JsonGameHistoryRepository(settings.data_dir / "game_history.json")


@lru_cache(maxsize=1)
def get_engine_service() -> EngineService:
    return EngineService()


@lru_cache(maxsize=1)
def get_game_service() -> GameService:
    return GameService(
        get_session_repository(),
        get_history_repository(),
        get_engine_service(),
    )


@lru_cache(maxsize=1)
def get_analysis_service() -> AnalysisService:
    return AnalysisService(get_engine_service())

