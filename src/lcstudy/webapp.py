from __future__ import annotations
from pathlib import Path

import chess
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .config.logging import setup_logging, get_logger
from .repositories.session_repository import InMemorySessionRepository
from .repositories.game_history_repository import JsonGameHistoryRepository
from .services.game_service import GameService
from .services.engine_service import EngineService
from .services.analysis_service import AnalysisService
from .domain.models import GameSession as NewGameSession, SessionStatus, GameResult
from .domain.validation import SessionCreateRequest, MoveRequest, SessionStateResponse, AnalysisResponse
from .exceptions import SessionNotFoundError, IllegalMoveError, GameFinishedError

setup_logging()
logger = get_logger('webapp')

# Add console logging for debugging
import logging
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
console_handler.setFormatter(formatter)
logging.getLogger('lcstudy').addHandler(console_handler)


app = FastAPI(title="LcStudy")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

settings = get_settings()
session_repo = InMemorySessionRepository()
history_repo = JsonGameHistoryRepository(settings.data_dir / "game_history.json")
engine_service = EngineService()
game_service = GameService(session_repo, history_repo, engine_service)
analysis_service = AnalysisService(engine_service)

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down services...")
    analysis_service.shutdown_all()
    engine_service.shutdown_all()
    logger.info("Services shut down successfully")


















def html_index() -> str:
    template_path = Path(__file__).parent / "templates" / "index.html"
    return template_path.read_text()


















@app.get("/")
def index() -> HTMLResponse:
    return HTMLResponse(html_index(), media_type="text/html; charset=utf-8")


@app.get("/api/game-history")
def api_get_game_history() -> JSONResponse:
    try:
        history = history_repo.get_all_games()
        return JSONResponse({"history": history})
    except Exception as e:
        logger.warning("Failed to load game history: %s", e)
        return JSONResponse({"history": []})


@app.post("/api/game-history")
def api_save_game_history(payload: dict) -> JSONResponse:
    try:
        average_retries = float(payload.get("average_retries", 0))
        total_moves = int(payload.get("total_moves", 0))
        maia_level = int(payload.get("maia_level", 1500))
        result = str(payload.get("result", "unknown"))
        
        game_id = history_repo.save_game(average_retries, total_moves, maia_level, result)
        return JSONResponse({"success": True, "game_id": game_id})
    except Exception as e:
        logger.warning("Failed to save game history: %s", e)
        return JSONResponse({"success": False, "error": str(e)})


@app.post("/api/session/{sid}/check-move")
def api_session_check_move(sid: str, payload: dict) -> JSONResponse:
    try:
        move_request = MoveRequest(**payload)
        session = session_repo.get_session(sid)
        if not session:
            raise HTTPException(404, "Session not found")
        
        legal, needs_promotion = game_service.check_move_validity(session, move_request.move)
        return JSONResponse({"legal": legal, "needs_promotion": needs_promotion})
    except SessionNotFoundError:
        raise HTTPException(404, "Session not found")
    except Exception as e:
        return JSONResponse({"legal": False, "needs_promotion": False})


@app.post("/api/session/new")
def api_session_new(payload: dict) -> JSONResponse:
    try:
        logger.info("Creating new session...")
        session_request = SessionCreateRequest(**payload)
        logger.info(f"Session request: maia_level={session_request.maia_level}, player_color={session_request.player_color}")
        
        session = game_service.create_session(
            maia_level=session_request.maia_level,
            player_color=chess.WHITE if session_request.player_color == "white" else chess.BLACK,
            custom_fen=session_request.custom_fen
        )
        # If player chose black, let the engine (Maia) make the first white move
        try:
            if session.player_color == chess.BLACK and session.board.turn == chess.WHITE:
                maia_first = game_service.make_maia_move(session)
                if maia_first:
                    logger.info(f"Maia made first move: {maia_first}")
        except Exception as e:
            logger.warning(f"Failed to make Maia first move: {e}")
        
        logger.info(f"Session created: {session.id} with Maia {session.maia_level}")
        print(f"✅ New game started with Maia {session.maia_level} (session: {session.id})")
        
        return JSONResponse({
            "id": session.id,
            "flip": session.flip,
            "fen": session.board.fen()
        })
    except Exception as e:
        logger.error(f"Failed to create session: {e}")
        print(f"❌ Failed to create session: {e}")
        raise HTTPException(500, "Failed to create session")


@app.get("/api/session/{sid}/analysis")
def api_session_analysis(sid: str) -> JSONResponse:
    try:
        session = session_repo.get_session(sid)
        if not session:
            raise HTTPException(404, "Session not found")
        
        result = analysis_service.get_analysis_result(sid)
        is_analyzing = analysis_service.is_analyzing(sid)
        
        analysis_data = {
            "nodes": result.nodes if result else 0,
            "best_move": result.best_move if result else None,
            "analysis_lines": result.lines if result else [],
            "is_analyzing": is_analyzing,
            "snapshotted_move": None,
            "position_fen": session.board.fen()
        }
        
        return JSONResponse(analysis_data)
    except SessionNotFoundError:
        raise HTTPException(404, "Session not found")


@app.get("/api/session/{sid}/state")
def api_session_state(sid: str) -> JSONResponse:
    try:
        logger.debug(f"Getting state for session {sid}")
        session = session_repo.get_session(sid)
        if not session:
            logger.warning(f"Session {sid} not found")
            raise HTTPException(404, "Session not found")
        
        is_analyzing = analysis_service.is_analyzing(sid)
        logger.debug(f"Session {sid} is_analyzing: {is_analyzing}")
        
        if not is_analyzing:
            logger.info(f"Starting analysis for session {sid}")
            analysis_service.start_analysis(session)
            print(f"🔍 Started analysis for session {sid}")
        
        result = analysis_service.get_analysis_result(sid)
        logger.debug(f"Analysis result for {sid}: {result is not None}")
        
        state_data = {
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
            "analysis_nodes": result.nodes if result else 0
        }
        
        if result and result.nodes > 0:
            print(f"📊 Analysis progress for {sid}: {result.nodes} nodes, {len(result.lines)} lines")
        
        return JSONResponse(state_data)
    except SessionNotFoundError:
        logger.error(f"Session {sid} not found")
        raise HTTPException(404, "Session not found")
    except Exception as e:
        logger.error(f"Error getting state for session {sid}: {e}")
        raise HTTPException(500, "Internal server error")



@app.post("/api/session/{sid}/predict")
def api_session_predict(sid: str, payload: dict) -> JSONResponse:
    try:
        move_request = MoveRequest(**payload)
        session = session_repo.get_session(sid)
        if not session:
            raise HTTPException(404, "Session not found")
        
        result = game_service.make_move(session, move_request.move, move_request.client_validated)
        
        maia_move_played = None
        if result.correct:
            try:
                maia_move_played = game_service.make_maia_move(session)
            except Exception as e:
                logger.warning(f"Failed to make Maia reply move: {e}")
        
        response_data = {
            "your_move": result.player_move,
            "correct": result.correct,
            "message": result.message,
            "total": session.score_total,
            "fen": session.board.fen(),
            "status": session.status.value if hasattr(session.status, 'value') else str(session.status),
        }
        
        if result.leela_move:
            response_data["leela_move"] = result.leela_move
        if maia_move_played:
            response_data["maia_move"] = maia_move_played
        if result.score_hint is not None:
            response_data["score_hint"] = result.score_hint
        if result.attempts is not None:
            response_data["attempts"] = result.attempts
        
        return JSONResponse(response_data)
    except (SessionNotFoundError, IllegalMoveError, GameFinishedError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"Failed to process move: {e}")
        raise HTTPException(500, "Failed to process move")


@app.get("/api/session/{sid}/pgn")
def api_session_pgn(sid: str) -> PlainTextResponse:
    try:
        session = session_repo.get_session(sid)
        if not session:
            raise HTTPException(404, "Session not found")
        
        pgn_text = game_service.export_pgn(session)
        return PlainTextResponse(pgn_text, media_type="text/plain; charset=utf-8")
    except SessionNotFoundError:
        raise HTTPException(404, "Session not found")
