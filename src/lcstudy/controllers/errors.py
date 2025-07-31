from __future__ import annotations
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..exceptions import (
    SessionNotFoundError,
    IllegalMoveError,
    GameFinishedError,
    EngineNotFoundError,
    DataError,
)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(SessionNotFoundError)
    async def session_not_found_handler(_: Request, exc: SessionNotFoundError):
        return JSONResponse(status_code=404, content={"error": {"code": "session_not_found", "message": str(exc) or "Session not found"}})

    @app.exception_handler(IllegalMoveError)
    async def illegal_move_handler(_: Request, exc: IllegalMoveError):
        return JSONResponse(status_code=400, content={"error": {"code": "illegal_move", "message": str(exc) or "Illegal move"}})

    @app.exception_handler(GameFinishedError)
    async def game_finished_handler(_: Request, exc: GameFinishedError):
        return JSONResponse(status_code=400, content={"error": {"code": "game_finished", "message": str(exc) or "Game is finished"}})

    @app.exception_handler(EngineNotFoundError)
    async def engine_not_found_handler(_: Request, exc: EngineNotFoundError):
        return JSONResponse(status_code=503, content={"error": {"code": "engine_not_found", "message": str(exc) or "Engine not available"}})

    @app.exception_handler(DataError)
    async def data_error_handler(_: Request, exc: DataError):
        return JSONResponse(status_code=500, content={"error": {"code": "data_error", "message": str(exc) or "Data error"}})

