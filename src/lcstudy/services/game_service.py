from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional, Tuple, cast

import chess
import chess.pgn

from ..config import get_settings
from ..config.logging import get_logger
from ..domain.models import GameSession, SessionStatus
from ..exceptions import GameFinishedError, IllegalMoveError
from ..repositories.game_history_repository import GameHistoryRepository
from ..repositories.precomputed_repository import PrecomputedRepository
from ..repositories.session_repository import SessionRepository


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
        precomputed_repo: PrecomputedRepository,
    ):
        self.session_repo = session_repo
        self.history_repo = history_repo
        self.settings = get_settings()
        self.precomputed_repo = precomputed_repo
        self.logger = get_logger("game_service")

    def create_session(
        self,
        maia_level: int,
        player_color: Optional[
            chess.Color
        ] = None,  # Will be overridden by precomputed game
        custom_fen: Optional[str] = None,
    ) -> GameSession:
        session_id = str(uuid.uuid4())

        board = chess.Board()
        if custom_fen:
            try:
                board = chess.Board(custom_fen)
            except ValueError:
                board = chess.Board()

        # Assign a precomputed game and determine player color from it
        actual_player_color = player_color or chess.WHITE  # fallback
        precomputed_game_id = None

        self.logger.info(
            "Creating session: precomputed_repo=%s", self.precomputed_repo is not None
        )
        if self.precomputed_repo:
            has_games = self.precomputed_repo.has_games()
            self.logger.info("Precomputed repo has_games: %s", has_games)
            if has_games:
                gid = self.precomputed_repo.assign_game()
                self.logger.info("Assigned game ID: %s", gid)
                if gid:
                    precomputed_game_id = gid
                    leela_color = self.precomputed_repo.get_leela_color(gid)
                    self.logger.info("Game %s: Leela color=%s", gid, leela_color)
                    if leela_color is not None:
                        # Player always plays as Leela (the strong engine)
                        actual_player_color = leela_color
                        self.logger.info(
                            "Player will play as: %s",
                            "WHITE" if actual_player_color == chess.WHITE else "BLACK",
                        )
        else:
            self.logger.warning("No precomputed repository available")

        flip = actual_player_color == chess.BLACK

        session = GameSession(
            id=session_id,
            board=board,
            status=SessionStatus.PLAYING,
            player_color=actual_player_color,
            maia_level=maia_level,
            score_total=0.0,
            move_index=0,
            history=[],
            flip=flip,
        )

        if precomputed_game_id:
            session.precomputed_game_id = precomputed_game_id
            session.precomputed_ply_index = 0
            self.logger.info(
                "Session %s assigned to precomputed game %s",
                session_id,
                precomputed_game_id,
            )

            # If Leela plays black, Maia (white) should make the first move instantly
            leela_color = self.precomputed_repo.get_leela_color(precomputed_game_id)
            if leela_color == chess.BLACK and session.board.turn == chess.WHITE:
                # Make Maia's opening move from the precomputed game
                maia_move_uci = self.precomputed_repo.get_expected(
                    precomputed_game_id, 0
                )
                self.logger.info("Making Maia opening move: %s", maia_move_uci)
                if maia_move_uci:
                    try:
                        move = chess.Move.from_uci(maia_move_uci)
                        if move in session.board.legal_moves:
                            session.board.push(move)
                            session.precomputed_ply_index = (
                                1  # Next expected move is at ply 1
                            )
                            session.move_index += 1
                            self.logger.info("Maia opening move applied successfully")
                        else:
                            self.logger.warning(
                                "Maia opening move %s not legal", maia_move_uci
                            )
                    except (ValueError, chess.InvalidMoveError) as e:
                        self.logger.warning(
                            "Failed to parse Maia opening move %s: %s", maia_move_uci, e
                        )
        else:
            self.logger.warning(
                "No precomputed game assigned to session %s", session_id
            )

        self.session_repo.save_session(session)

        return session

    def get_session(self, session_id: str) -> Optional[GameSession]:
        return self.session_repo.get_session(session_id)

    def check_move_validity(
        self, session: GameSession, move_str: str
    ) -> Tuple[bool, bool]:
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

                if (
                    piece
                    and piece.piece_type == chess.PAWN
                    and (
                        (
                            piece.color == chess.WHITE
                            and chess.square_rank(to_square) == 7
                        )
                        or (
                            piece.color == chess.BLACK
                            and chess.square_rank(to_square) == 0
                        )
                    )
                ):

                    for promotion in [
                        chess.QUEEN,
                        chess.ROOK,
                        chess.BISHOP,
                        chess.KNIGHT,
                    ]:
                        test_move = chess.Move(
                            from_square, to_square, promotion=promotion
                        )
                        if test_move in session.board.legal_moves:
                            return False, True

            return False, False
        except Exception:
            return False, False

    def make_move(
        self, session: GameSession, move_str: str, client_validated: bool = False
    ) -> MoveResult:
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

        # Precomputed expected move
        expected_move_uci: Optional[str] = None
        if not self.precomputed_repo or not session.precomputed_game_id:
            # No precomputed game available; cannot grade without engine
            session.current_move_attempts += 1
            self.session_repo.save_session(session)
            return MoveResult(
                player_move=move_str,
                correct=False,
                message="No precomputed game available",
                attempts=session.current_move_attempts,
            )
        expected_move_uci = self.precomputed_repo.get_expected(
            session.precomputed_game_id, session.precomputed_ply_index
        )

        # If no next expected move, treat as finished or incorrect
        if expected_move_uci is None:
            session.current_move_attempts += 1
            self.session_repo.save_session(session)
            self.logger.warning(
                "No expected move for game %s at ply %s",
                session.precomputed_game_id,
                session.precomputed_ply_index,
            )
            return MoveResult(
                player_move=move_str,
                correct=False,
                message="No expected move (end of precomputed game)",
                attempts=session.current_move_attempts,
            )

        # Evaluate guess correctness
        if move_str != expected_move_uci:
            session.current_move_attempts += 1

            # Auto-play after 10 failed attempts
            if session.current_move_attempts >= 10:
                # Make the correct move automatically
                session.board.push(chess.Move.from_uci(expected_move_uci))
                session.move_index += 1
                session.score_total += 0.0  # No points for auto-played moves
                session.current_move_attempts = 0
                session.precomputed_ply_index += 1

                if session.board.is_game_over():
                    session.status = SessionStatus.FINISHED
                    # Delete completed game so it's never played again
                    if self.precomputed_repo and session.precomputed_game_id:
                        try:
                            self.precomputed_repo.consume_game(
                                session.precomputed_game_id
                            )
                            self.logger.info(
                                "Consumed auto-played game: %s",
                                session.precomputed_game_id,
                            )
                        except Exception as e:
                            self.logger.warning(
                                "Failed to consume game %s: %s",
                                session.precomputed_game_id,
                                e,
                            )

                self.session_repo.save_session(session)
                result = MoveResult(
                    player_move=expected_move_uci,  # Return the correct move
                    correct=True,
                    message="Auto-played after 10 attempts.",
                    leela_move=expected_move_uci,
                    attempts=10,
                )
                try:
                    self.logger.info(
                        "move.result sid=%s auto-played=%s attempts=%s",
                        session.id,
                        expected_move_uci,
                        10,
                    )
                except Exception:
                    pass
                return result

            # Regular incorrect move handling
            self.session_repo.save_session(session)
            result = MoveResult(
                player_move=move_str,
                correct=False,
                message="Not the top move. Try again.",
                attempts=session.current_move_attempts,
            )
            try:
                self.logger.info(
                    "move.result sid=%s correct=%s attempts=%s",
                    session.id,
                    False,
                    session.current_move_attempts,
                )
            except Exception:
                pass
            return result

        # Correct guess: apply the expected move and advance precomputed index
        session.board.push(chess.Move.from_uci(expected_move_uci))
        session.move_index += 1
        session.score_total += 1.0
        attempts_used = session.current_move_attempts + 1
        session.current_move_attempts = 0
        session.precomputed_ply_index += 1

        if session.board.is_game_over():
            session.status = SessionStatus.FINISHED
            # Delete completed game so it's never played again
            if self.precomputed_repo and session.precomputed_game_id:
                try:
                    self.precomputed_repo.consume_game(session.precomputed_game_id)
                    self.logger.info(
                        "Consumed completed game: %s", session.precomputed_game_id
                    )
                except Exception as e:
                    self.logger.warning(
                        "Failed to consume game %s: %s", session.precomputed_game_id, e
                    )

        self.session_repo.save_session(session)
        result = MoveResult(
            player_move=move_str,
            correct=True,
            message="Correct",
            leela_move=expected_move_uci,
            maia_move=None,
            attempts=attempts_used,
        )
        try:
            self.logger.info(
                "move.result sid=%s correct=%s attempts=%s",
                session.id,
                True,
                attempts_used,
            )
        except Exception:
            pass
        return result

    def make_maia_move(self, session: GameSession) -> Optional[str]:
        """Make a single reply move from the precomputed game and persist it.

        No live engine calls; if no next precomputed move exists, the game is
        marked finished and the precomputed game is consumed from the DB.
        """
        if session.status != SessionStatus.PLAYING:
            return None

        if session.board.is_game_over():
            session.status = SessionStatus.FINISHED
            self.session_repo.save_session(session)
            return None

        move = None
        # Use precomputed next move if available
        if self.precomputed_repo and session.precomputed_game_id:
            expected_next = self.precomputed_repo.get_expected(
                session.precomputed_game_id, session.precomputed_ply_index
            )
            if expected_next:
                move = chess.Move.from_uci(expected_next)

        if move is None:
            # End of precomputed game: finish and consume
            session.status = SessionStatus.FINISHED
            if self.precomputed_repo and session.precomputed_game_id:
                try:
                    self.precomputed_repo.consume_game(session.precomputed_game_id)
                except Exception:
                    pass
                session.precomputed_game_id = None
                session.precomputed_ply_index = 0
            self.session_repo.save_session(session)
            return None

        session.board.push(move)
        session.move_index += 1
        session.precomputed_ply_index += 1
        # Do not change score_total here; score_total is for user attempts

        if session.board.is_game_over():
            session.status = SessionStatus.FINISHED
            # Delete completed game so it's never played again
            if self.precomputed_repo and session.precomputed_game_id:
                try:
                    self.precomputed_repo.consume_game(session.precomputed_game_id)
                    self.logger.info(
                        "Consumed completed game after Maia move: %s",
                        session.precomputed_game_id,
                    )
                except Exception as e:
                    self.logger.warning(
                        "Failed to consume game %s: %s", session.precomputed_game_id, e
                    )
                session.precomputed_game_id = None
                session.precomputed_ply_index = 0

        self.session_repo.save_session(session)
        return move.uci()

    def export_pgn(self, session: GameSession) -> str:
        game = chess.pgn.Game()
        game.headers["Event"] = "LcStudy"
        game.headers["Site"] = "Local"
        game.headers["White"] = "You (Leela)"
        game.headers["Black"] = f"Maia {session.maia_level}"
        game.headers["Date"] = time.strftime("%Y.%m.%d")

        node: Any = cast(Any, game)
        tmp = chess.Board()
        for mv in session.board.move_stack:
            node = node.add_variation(mv)
            tmp.push(mv)
        game.headers["Result"] = (
            tmp.result(claim_draw=True) if tmp.is_game_over() else "*"
        )

        exporter = chess.pgn.StringExporter(
            headers=True, variations=False, comments=False
        )
        return game.accept(exporter)

    def cleanup_expired_sessions(self) -> int:
        return self.session_repo.cleanup_expired(self.settings.session.default_timeout)
