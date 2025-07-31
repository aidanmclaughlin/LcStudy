from __future__ import annotations
import asyncio
import uuid
from typing import Optional

import chess
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from ..domain.validation import SessionCreateRequest, MoveRequest, SessionStateResponse, AnalysisResponse
from ..exceptions import SessionNotFoundError, IllegalMoveError, GameFinishedError
from .deps import get_session_repository, get_game_service, get_analysis_service

router = APIRouter(prefix="/api/v1/session", tags=["session"])


def _validate_uuid(sid: str) -> None:
    try:
        uuid.UUID(hex=sid.replace("-", ""))
    except Exception:
        raise HTTPException(404, "Session not found")


@router.post("/new")
def api_session_new(payload: SessionCreateRequest, game_service = Depends(get_game_service)) -> JSONResponse:
    session = game_service.create_session(
        maia_level=payload.maia_level,
        player_color=chess.WHITE if payload.player_color == "white" else chess.BLACK,
        custom_fen=payload.custom_fen,
    )
    # If player is black, let Maia move first
    try:
        if session.player_color == chess.BLACK and session.board.turn == chess.WHITE:
            game_service.make_maia_move(session)
    except Exception:
        pass
    return JSONResponse({"id": session.id, "flip": session.flip, "fen": session.board.fen()})


@router.get("/{sid}/analysis", response_model=AnalysisResponse)
def api_session_analysis(sid: str, analysis_service = Depends(get_analysis_service), session_repo = Depends(get_session_repository)):
    _validate_uuid(sid)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")

    result = analysis_service.get_analysis_result(sid)
    is_analyzing = analysis_service.is_analyzing(sid)
    return {
        "nodes": result.nodes if result else 0,
        "best_move": result.best_move if result else None,
        "analysis_lines": result.lines if result else [],
        "is_analyzing": is_analyzing,
        "snapshotted_move": None,
        "position_fen": session.board.fen(),
    }


@router.get("/{sid}/state", response_model=SessionStateResponse)
def api_session_state(sid: str, analysis_service = Depends(get_analysis_service), session_repo = Depends(get_session_repository)):
    _validate_uuid(sid)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")

    # Avoid re-analysis when we already have a result for this position
    result = analysis_service.get_analysis_result(sid)
    if not result or result.position_fen != session.board.fen():
        analysis_service.start_analysis(session, nodes=session.leela_nodes)

    result = analysis_service.get_analysis_result(sid)
    return {
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
    }


@router.post("/{sid}/check-move")
def api_session_check_move(sid: str, payload: MoveRequest, game_service = Depends(get_game_service), session_repo = Depends(get_session_repository)) -> JSONResponse:
    _validate_uuid(sid)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    legal, needs_promotion = game_service.check_move_validity(session, payload.move)
    return JSONResponse({"legal": legal, "needs_promotion": needs_promotion})


@router.post("/{sid}/predict")
def api_session_predict(sid: str, payload: MoveRequest, game_service = Depends(get_game_service), session_repo = Depends(get_session_repository)) -> JSONResponse:
    _validate_uuid(sid)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")

    try:
        result = game_service.make_move(session, payload.move, payload.client_validated)
        maia_move_played: Optional[str] = None
        if result.correct:
            try:
                maia_move_played = game_service.make_maia_move(session)
            except Exception:
                pass
        response = {
            "your_move": result.player_move,
            "correct": result.correct,
            "message": result.message,
            "total": session.score_total,
            "fen": session.board.fen(),
            "status": session.status.value if hasattr(session.status, 'value') else str(session.status),
            "attempts": result.attempts,
        }
        if result.leela_move:
            response["leela_move"] = result.leela_move
        if maia_move_played:
            response["maia_move"] = maia_move_played
        return JSONResponse(response)
    except (SessionNotFoundError, IllegalMoveError, GameFinishedError) as e:
        raise HTTPException(400, str(e))


@router.get("/{sid}/pgn")
def api_session_pgn(sid: str, game_service = Depends(get_game_service), session_repo = Depends(get_session_repository)) -> PlainTextResponse:
    _validate_uuid(sid)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    pgn_text = game_service.export_pgn(session)
    return PlainTextResponse(pgn_text, media_type="text/plain; charset=utf-8")


@router.get("/{sid}/analysis/stream")
async def api_session_analysis_stream(sid: str, analysis_service = Depends(get_analysis_service), session_repo = Depends(get_session_repository)):
    _validate_uuid(sid)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")

    analysis_service.start_analysis(session, nodes=session.leela_nodes)

    async def event_gen():
        # simple polling to stream a single event when ready
        for _ in range(60):  # up to ~30s at 0.5s interval
            result = analysis_service.get_analysis_result(sid)
            if result and result.position_fen == session.board.fen():
                payload = {
                    "nodes": result.nodes,
                    "best_move": result.best_move,
                    "analysis_lines": result.lines,
                }
                data = json.dumps(payload)
                yield f"event: analysis\n"
                yield f"data: {data}\n\n"
                return
            await asyncio.sleep(0.5)
        # timeout event
        yield "event: timeout\ndata: {}\n\n"

    import json
    return StreamingResponse(event_gen(), media_type="text/event-stream")

