from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
import chess

from ..domain.validation import SessionCreateRequest, MoveRequest
from .deps import get_game_service, get_session_repository, get_analysis_service, get_history_repository

router = APIRouter(tags=["compat"])  # legacy, for backward compatibility


@router.post("/api/session/new")
def compat_session_new(payload: dict, game_service = Depends(get_game_service)) -> JSONResponse:
    # Accept legacy dict payload with same keys
    try:
        req = SessionCreateRequest(**payload)
    except Exception:
        # Provide sensible defaults if the payload is incomplete
        level = payload.get("maia_level")
        try:
            maia_level = int(level) if level is not None else 1500
        except Exception:
            maia_level = 1500
        player_color = payload.get("player_color", "white")
        req = SessionCreateRequest(maia_level=maia_level, player_color=player_color)

    session = game_service.create_session(
        maia_level=req.maia_level,
        player_color=chess.WHITE if req.player_color == "white" else chess.BLACK,
        custom_fen=req.custom_fen,
    )
    try:
        if session.player_color == chess.BLACK and session.board.turn == chess.WHITE:
            game_service.make_maia_move(session)
    except Exception:
        pass
    return JSONResponse({"id": session.id, "flip": session.flip, "fen": session.board.fen()})


@router.get("/api/session/{sid}/analysis")
def compat_session_analysis(sid: str, analysis_service = Depends(get_analysis_service), session_repo = Depends(get_session_repository)) -> JSONResponse:
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    result = analysis_service.get_analysis_result(sid)
    is_analyzing = analysis_service.is_analyzing(sid)
    return JSONResponse({
        "nodes": result.nodes if result else 0,
        "best_move": result.best_move if result else None,
        "analysis_lines": result.lines if result else [],
        "is_analyzing": is_analyzing,
        "snapshotted_move": None,
        "position_fen": session.board.fen(),
    })


@router.get("/api/session/{sid}/state")
def compat_session_state(sid: str, analysis_service = Depends(get_analysis_service), session_repo = Depends(get_session_repository)) -> JSONResponse:
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    result = analysis_service.get_analysis_result(sid)
    if not result or result.position_fen != session.board.fen():
        analysis_service.start_analysis(session, nodes=session.leela_nodes)
    result = analysis_service.get_analysis_result(sid)
    return JSONResponse({
        "id": session.id,
        "fen": session.board.fen(),
        "turn": "white" if session.board.turn else "black",
        "score_total": session.score_total,
        "guesses": len(session.history),
        "ply": session.move_index,
        "status": session.status.value if hasattr(session.status, 'value') else str(session.status),
        "top_lines": result.lines if result else [],
        "flip": session.flip,
        "is_analyzing": analysis_service.is_analyzing(sid),
        "analysis_nodes": result.nodes if result else 0,
    })


@router.post("/api/session/{sid}/check-move")
def compat_session_check_move(sid: str, payload: dict, game_service = Depends(get_game_service), session_repo = Depends(get_session_repository)) -> JSONResponse:
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    try:
        req = MoveRequest(**payload)
        legal, needs_promotion = game_service.check_move_validity(session, req.move)
        return JSONResponse({"legal": legal, "needs_promotion": needs_promotion})
    except Exception:
        return JSONResponse({"legal": False, "needs_promotion": False})


@router.post("/api/session/{sid}/predict")
def compat_session_predict(sid: str, payload: dict, game_service = Depends(get_game_service), session_repo = Depends(get_session_repository)) -> JSONResponse:
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    req = MoveRequest(**payload)
    result = game_service.make_move(session, req.move, req.client_validated)
    maia_move = None
    if result.correct:
        try:
            maia_move = game_service.make_maia_move(session)
        except Exception:
            pass
    data = {
        "your_move": result.player_move,
        "correct": result.correct,
        "message": result.message,
        "total": session.score_total,
        "fen": session.board.fen(),
        "status": session.status.value if hasattr(session.status, 'value') else str(session.status),
        "attempts": result.attempts,
    }
    if result.leela_move:
        data["leela_move"] = result.leela_move
    if maia_move:
        data["maia_move"] = maia_move
    return JSONResponse(data)


@router.get("/api/session/{sid}/pgn")
def compat_session_pgn(sid: str, game_service = Depends(get_game_service), session_repo = Depends(get_session_repository)) -> PlainTextResponse:
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    return PlainTextResponse(game_service.export_pgn(session), media_type="text/plain; charset=utf-8")


@router.get("/api/game-history")
def compat_get_history(repo = Depends(get_history_repository)) -> JSONResponse:
    return JSONResponse({"history": repo.get_all_games()})


@router.post("/api/game-history")
def compat_post_history(payload: dict, repo = Depends(get_history_repository)) -> JSONResponse:
    try:
        gid = repo.save_game(**payload)
        return JSONResponse({"success": True, "game_id": gid})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)})

