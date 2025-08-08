import chess

from src.lcstudy.domain.models import (AnalysisLine, GameMove, GameSession,
                                       SessionStatus)


def test_game_session_creation():
    board = chess.Board()
    session = GameSession(
        id="test_session",
        board=board,
        status=SessionStatus.PLAYING,
        player_color=chess.WHITE,
        maia_level=1500,
        score_total=0.0,
        move_index=0,
        history=[],
        flip=False,
    )

    assert session.id == "test_session"
    assert session.status == SessionStatus.PLAYING
    assert session.player_color == chess.WHITE
    assert session.maia_level == 1500
    assert session.score_total == 0.0
    assert len(session.history) == 0


def test_analysis_line_creation():
    line = AnalysisLine(
        multipv=1,
        move="e2e4",
        cp=25,
        mate=None,
        wdl=None,
        nps=1000,
        nodes=2000,
        depth=10,
        seldepth=12,
    )

    assert line.multipv == 1
    assert line.move == "e2e4"
    assert line.cp == 25
    assert line.nodes == 2000


def test_game_move_creation():
    move = GameMove(
        move_uci="e2e4",
        san_notation="e4",
        attempts=[],
        final_attempt_count=1,
        is_human_move=True,
        analysis_snapshot=None,
    )

    assert move.move_uci == "e2e4"
    assert move.san_notation == "e4"
    assert move.is_human_move is True
    assert move.final_attempt_count == 1
