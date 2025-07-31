from __future__ import annotations
import asyncio
import uuid
import threading
from typing import Optional

import chess
from fastapi import APIRouter, Depends, HTTPException
import time
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from ..domain.validation import SessionCreateRequest, MoveRequest, SessionStateResponse
from ..exceptions import SessionNotFoundError, IllegalMoveError, GameFinishedError
from .deps import get_session_repository, get_game_service
from ..config.logging import get_logger

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
        player_color=chess.WHITE if payload.player_color == "white" else chess.BLACK if payload.player_color else None,
        custom_fen=payload.custom_fen,
    )
    # If player is black, let Maia move first
    try:
        if session.player_color == chess.BLACK and session.board.turn == chess.WHITE:
            game_service.make_maia_move(session)
    except Exception:
        pass
    # Engines are used in background generation only; no warm-up needed here.
    return JSONResponse({"id": session.id, "flip": session.flip, "fen": session.board.fen()})




@router.get("/{sid}/state", response_model=SessionStateResponse)
def api_session_state(sid: str, session_repo = Depends(get_session_repository)):
    _validate_uuid(sid)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")

    # No analysis needed for precomputed games
    return {
        "id": session.id,
        "fen": session.board.fen(),
        "turn": "white" if session.board.turn else "black",
        "score_total": session.score_total,
        "guesses": len(session.history),
        "ply": session.move_index,
        "status": session.status.value if hasattr(session.status, 'value') else str(session.status),
        "flip": session.flip,
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
    logger = get_logger('predict')
    rid = uuid.uuid4().hex[:8]
    t0 = time.perf_counter()
    logger.info("[%s] predict.start sid=%s move=%s client_validated=%s", rid, sid, payload.move, payload.client_validated)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")

    try:
        t_before = time.perf_counter()
        result = game_service.make_move(session, payload.move, payload.client_validated)
        t_after = time.perf_counter()
        logger.info(
            "[%s] predict.result sid=%s correct=%s attempts=%s service_ms=%.1f",
            rid,
            sid,
            result.correct,
            result.attempts,
            (t_after - t_before) * 1000.0,
        )
        if result.correct:
            # Make Maia's response move immediately (precomputed, so it's fast)
            try:
                maia_move = game_service.make_maia_move(session)
                if maia_move:
                    response["maia_move"] = maia_move
            except Exception:
                pass
        # Get the current FEN after any Maia move
        current_fen = session.board.fen()
        response = {
            "your_move": result.player_move,
            "correct": result.correct,
            "message": result.message,
            "total": session.score_total,
            "fen": current_fen,
            "status": session.status.value if hasattr(session.status, 'value') else str(session.status),
            "attempts": result.attempts,
        }
        if result.leela_move:
            response["leela_move"] = result.leela_move
        total_ms = (time.perf_counter() - t0) * 1000.0
        logger.info("[%s] predict.end sid=%s total_ms=%.1f", rid, sid, total_ms)
        return JSONResponse(response)
    except (SessionNotFoundError, IllegalMoveError, GameFinishedError) as e:
        total_ms = (time.perf_counter() - t0) * 1000.0
        logger.info("[%s] predict.error sid=%s total_ms=%.1f msg=%s", rid, sid, total_ms, str(e))
        raise HTTPException(400, str(e))


@router.get("/{sid}/pgn")
def api_session_pgn(sid: str, game_service = Depends(get_game_service), session_repo = Depends(get_session_repository)) -> PlainTextResponse:
    _validate_uuid(sid)
    session = session_repo.get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    pgn_text = game_service.export_pgn(session)
    return PlainTextResponse(pgn_text, media_type="text/plain; charset=utf-8")


