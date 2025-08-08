from unittest.mock import Mock

import chess

from src.lcstudy.domain.models import GameSession, SessionStatus
from src.lcstudy.services.game_service import GameService


def test_create_session():
    session_repo = Mock()
    history_repo = Mock()
    game_service = GameService(session_repo, history_repo)

    session = game_service.create_session(
        maia_level=1500, player_color=chess.WHITE, custom_fen=None
    )

    assert session.maia_level == 1500
    assert session.player_color == chess.WHITE
    assert session.status == SessionStatus.PLAYING
    assert not session.flip
    session_repo.save_session.assert_called_once()


def test_check_move_validity():
    session_repo = Mock()
    history_repo = Mock()
    game_service = GameService(session_repo, history_repo)

    session = GameSession(
        id="test",
        board=chess.Board(),
        status=SessionStatus.PLAYING,
        player_color=chess.WHITE,
        maia_level=1500,
        score_total=0.0,
        move_index=0,
        history=[],
        flip=False,
    )

    legal, needs_promotion = game_service.check_move_validity(session, "e2e4")
    assert legal is True
    assert needs_promotion is False

    legal, needs_promotion = game_service.check_move_validity(session, "e2e5")
    assert legal is False
    assert needs_promotion is False


def test_make_move():
    session_repo = Mock()
    history_repo = Mock()
    game_service = GameService(session_repo, history_repo)

    session = GameSession(
        id="test",
        board=chess.Board(),
        status=SessionStatus.PLAYING,
        player_color=chess.WHITE,
        maia_level=1500,
        score_total=0.0,
        move_index=0,
        history=[],
        flip=False,
    )

    result = game_service.make_move(session, "e2e4", client_validated=True)

    assert result.correct is True
    assert result.player_move == "e2e4"
    assert session.move_index == 1
    assert session.score_total == 1.0
    session_repo.save_session.assert_called_once()


def test_make_maia_move():
    session_repo = Mock()
    history_repo = Mock()
    game_service = GameService(session_repo, history_repo)

    session = GameSession(
        id="test",
        board=chess.Board(),
        status=SessionStatus.PLAYING,
        player_color=chess.WHITE,
        maia_level=1500,
        score_total=0.0,
        move_index=0,
        history=[],
        flip=False,
    )

    maia_move = game_service.make_maia_move(session)

    assert maia_move is not None
    assert len(maia_move) in [4, 5]
    assert session.move_index == 1
    session_repo.save_session.assert_called_once()
