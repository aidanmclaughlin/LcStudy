from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from .deps import get_history_repository

router = APIRouter(prefix="/api/v1", tags=["history"])


@router.get("/game-history")
def api_get_game_history(repo=Depends(get_history_repository)) -> JSONResponse:
    history = repo.get_all_games()
    return JSONResponse({"history": history})


@router.post("/game-history")
def api_save_game_history(
    payload: dict, repo=Depends(get_history_repository)
) -> JSONResponse:
    try:
        game_id = repo.save_game(**payload)
        return JSONResponse({"success": True, "game_id": game_id})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)})


@router.get("/stats")
def api_stats(repo=Depends(get_history_repository)) -> JSONResponse:
    stats = repo.get_statistics()
    return JSONResponse(stats)
