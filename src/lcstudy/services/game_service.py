from __future__ import annotations
from typing import Optional, List, Tuple
from dataclasses import dataclass
import uuid
import time
import chess
import chess.pgn
from datetime import datetime

from ..domain.models import GameSession, SessionStatus, GameMove, MoveAttempt, GameResult, GameHistoryEntry
from ..repositories.session_repository import SessionRepository
from ..repositories.game_history_repository import GameHistoryRepository
from ..exceptions import SessionNotFoundError, IllegalMoveError, GameFinishedError
from ..config import get_settings
from .engine_service import EngineService

@dataclass
class MoveResult:
    player_move: str
    correct: bool
    message: str
    leela_move: Optional[str] = None
    maia_move: Optional[str] = None
    score_hint: Optional[float] = None
    attempts: Optional[int] = None

class GameService:
    def __init__(
        self, 
        session_repo: SessionRepository,
        history_repo: GameHistoryRepository,
        engine_service: Optional[EngineService] = None,
    ):
        self.session_repo = session_repo
        self.history_repo = history_repo
        self.settings = get_settings()
        self.engine_service = engine_service
    
    def create_session(
        self,
        maia_level: int,
        player_color: chess.Color,
        custom_fen: Optional[str] = None
    ) -> GameSession:
        session_id = str(uuid.uuid4())
        
        board = chess.Board()
        if custom_fen:
            try:
                board = chess.Board(custom_fen)
            except ValueError:
                board = chess.Board()
        
        flip = player_color == chess.BLACK
        
        session = GameSession(
            id=session_id,
            board=board,
            status=SessionStatus.PLAYING,
            player_color=player_color,
            maia_level=maia_level,
            score_total=0.0,
            move_index=0,
            history=[],
            flip=flip
        )
        
        self.session_repo.save_session(session)
        
        
        return session
    
    def get_session(self, session_id: str) -> Optional[GameSession]:
        return self.session_repo.get_session(session_id)
    
    def check_move_validity(self, session: GameSession, move_str: str) -> Tuple[bool, bool]:
        if not move_str:
            return False, False
        
        try:
            mv = chess.Move.from_uci(move_str)
            if mv in session.board.legal_moves:
                return True, False
            
            if len(move_str) == 4:
                from_square = chess.parse_square(move_str[:2])
                to_square = chess.parse_square(move_str[2:4])
                piece = session.board.piece_at(from_square)
                
                if (piece and piece.piece_type == chess.PAWN and 
                    ((piece.color == chess.WHITE and chess.square_rank(to_square) == 7) or
                     (piece.color == chess.BLACK and chess.square_rank(to_square) == 0))):
                    
                    for promotion in [chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT]:
                        test_move = chess.Move(from_square, to_square, promotion=promotion)
                        if test_move in session.board.legal_moves:
                            return False, True
            
            return False, False
        except Exception:
            return False, False
    
    def make_move(self, session: GameSession, move_str: str, client_validated: bool = False) -> MoveResult:
        if session.status != SessionStatus.PLAYING:
            raise GameFinishedError("Game is already finished")
        
        try:
            mv = chess.Move.from_uci(move_str)
        except ValueError:
            raise IllegalMoveError("Invalid move format")

        # Must be user's turn to make a guess
        if session.board.turn != session.player_color:
            raise IllegalMoveError("Not your turn")

        if mv not in session.board.legal_moves:
            raise IllegalMoveError("Illegal move in current position")

        # If the client has already validated correctness (tests), just apply it
        if client_validated:
            session.board.push(mv)
            session.move_index += 1
            session.score_total += 1.0
            if session.board.is_game_over():
                session.status = SessionStatus.FINISHED
            self.session_repo.save_session(session)
            return MoveResult(
                player_move=move_str,
                correct=True,
                message="Move accepted",
                leela_move=move_str,
                maia_move=None,
                attempts=1,
            )

        # Compute Leela's expected best move for this position
        expected_move_uci: Optional[str] = None
        if self.engine_service is not None:
            try:
                leela = self.engine_service.get_leela_engine(session.id)
                best = leela.get_best_move(session.board, nodes=session.leela_nodes)
                expected_move_uci = best.uci() if best else None
            except Exception:
                expected_move_uci = None

        # If engine is not available, we cannot meaningfully grade; treat as incorrect
        if expected_move_uci is None:
            session.current_move_attempts += 1
            self.session_repo.save_session(session)
            return MoveResult(
                player_move=move_str,
                correct=False,
                message="Engine unavailable to validate move",
                attempts=session.current_move_attempts,
            )

        # Evaluate guess correctness
        if move_str != expected_move_uci:
            session.current_move_attempts += 1
            self.session_repo.save_session(session)
            return MoveResult(
                player_move=move_str,
                correct=False,
                message="Not the top move. Try again.",
                attempts=session.current_move_attempts,
            )

        # Correct guess: apply the expected move
        session.board.push(chess.Move.from_uci(expected_move_uci))
        session.move_index += 1
        session.score_total += 1.0
        attempts_used = session.current_move_attempts + 1
        session.current_move_attempts = 0

        if session.board.is_game_over():
            session.status = SessionStatus.FINISHED

        self.session_repo.save_session(session)
        return MoveResult(
            player_move=move_str,
            correct=True,
            message="Correct",
            leela_move=expected_move_uci,
            maia_move=None,
            attempts=attempts_used,
        )

    def make_maia_move(self, session: GameSession) -> Optional[str]:
        """Make a single reply move for the opponent (Maia) and persist it.

        Prefer the Maia engine via EngineService when available; otherwise
        fall back to the first legal move so tests and offline usage still work.
        """
        if session.status != SessionStatus.PLAYING:
            return None

        if session.board.is_game_over():
            session.status = SessionStatus.FINISHED
            self.session_repo.save_session(session)
            return None

        move = None
        # Prefer real Maia via engine when available
        if self.engine_service is not None:
            try:
                engine = self.engine_service.get_maia_engine(session.maia_level)
                mv_obj = engine.get_best_move(session.board, nodes=session.maia_nodes)
                move = mv_obj
            except Exception:
                move = None
        # Fallback to a deterministic first legal move
        if move is None:
            try:
                move = next(iter(session.board.legal_moves), None)
            except Exception:
                move = None

        if move is None:
            session.status = SessionStatus.FINISHED
            self.session_repo.save_session(session)
            return None

        session.board.push(move)
        session.move_index += 1
        # Do not change score_total here; score_total is for user attempts

        if session.board.is_game_over():
            session.status = SessionStatus.FINISHED

        self.session_repo.save_session(session)
        return move.uci()
    
    
    def export_pgn(self, session: GameSession) -> str:
        game = chess.pgn.Game()
        game.headers["Event"] = "LcStudy"
        game.headers["Site"] = "Local"
        game.headers["White"] = "You (Leela)"
        game.headers["Black"] = f"Maia {session.maia_level}"
        game.headers["Date"] = time.strftime("%Y.%m.%d")
        
        node = game
        tmp = chess.Board()
        for mv in session.board.move_stack:
            node = node.add_variation(mv)
            tmp.push(mv)
        game.headers["Result"] = tmp.result(claim_draw=True) if tmp.is_game_over() else "*"
        
        exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
        return game.accept(exporter)
    
    def cleanup_expired_sessions(self) -> int:
        return self.session_repo.cleanup_expired(self.settings.session.default_timeout)
