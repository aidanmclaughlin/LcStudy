import tempfile
from pathlib import Path

import chess

from src.lcstudy.domain.models import GameSession, SessionStatus
from src.lcstudy.repositories.game_history_repository import \
    JsonGameHistoryRepository
from src.lcstudy.repositories.session_repository import \
    InMemorySessionRepository


def test_in_memory_session_repository():
    repo = InMemorySessionRepository()

    session = GameSession(
        id="test_session",
        board=chess.Board(),
        status=SessionStatus.PLAYING,
        player_color=chess.WHITE,
        maia_level=1500,
        score_total=0.0,
        move_index=0,
        history=[],
        flip=False,
    )

    repo.create(session)

    retrieved = repo.get("test_session")
    assert retrieved is not None
    assert retrieved.id == "test_session"
    assert retrieved.maia_level == 1500

    sessions = repo.get_all_sessions()
    assert len(sessions) == 1

    repo.delete("test_session")
    assert repo.get("test_session") is None


def test_json_game_history_repository():
    with tempfile.TemporaryDirectory() as temp_dir:
        history_file = Path(temp_dir) / "test_history.json"
        repo = JsonGameHistoryRepository(history_file)

        from datetime import datetime

        from src.lcstudy.domain.models import GameHistoryEntry, GameResult

        entry = GameHistoryEntry(
            date=datetime.now().isoformat(),
            average_retries=2.5,
            total_moves=20,
            maia_level=1500,
            result=GameResult.FINISHED,
            session_id="test_session",
        )

        game_id = repo.save_game(entry)
        assert game_id is not None

        games = repo.get_all_games()
        assert len(games) == 1
        assert games[0]["average_retries"] == 2.5
        assert games[0]["total_moves"] == 20
        assert games[0]["maia_level"] == 1500
        assert games[0]["result"] == "finished"

        stats = repo.get_statistics()
        assert stats["total_games"] == 1
        assert stats["average_retries"] == 2.5
