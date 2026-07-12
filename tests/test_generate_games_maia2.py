import io
from pathlib import Path

import chess
import pytest

from tools import build_lichess_opening_tree as tree_builder
from tools import generate_games_maia2 as generator


class _FixedRng:
    def random(self) -> float:
        return 0.0


class _OpeningSampler:
    source = "test-openings"
    speed = "rapid"
    backoff_policy = "test-exact"
    sampled_games = None
    since = "2024-07"
    until = "2026-06"

    def sample_move(self, *args):
        raise AssertionError("Lichess should not move on Leela's turn")


def test_leela_positions_use_original_fen_path() -> None:
    class Engine:
        def get_policy_analysis(self, board, budget):
            move = chess.Move.from_uci("d2d4")
            analysis = [{"u": move.uci(), "s": board.san(move), "p": 100, "a": 100}]
            return move, analysis

    class Sampler:
        game_type = "rapid"

        def sample_move(self, *args):
            raise AssertionError("Maia should not move on the first ply")

    pgn, plies, _ = generator.generate_game_maia2(
        Engine(),
        Sampler(),
        _OpeningSampler(),
        "BT4-it332",
        generator.SearchBudget(nodes=200),
        1500,
        _FixedRng(),
        max_plies=1,
    )

    assert plies == 1
    assert "1. d4" in pgn
    assert '[LcStudyLeelaLifecycle "fresh-per-game"]' in pgn


def test_each_game_gets_a_fresh_leela_process(monkeypatch) -> None:
    engines = []

    class Engine:
        def __init__(self, *args, **kwargs):
            self.quit_called = False
            engines.append(self)

        def quit(self):
            self.quit_called = True

    monkeypatch.setattr(generator, "UciEngine", Engine)
    monkeypatch.setattr(
        generator,
        "generate_game_maia2",
        lambda engine, *args, **kwargs: (str(id(engine)), 1, "*"),
    )

    args = (
        "lc0",
        Path("BT4-it332.pb.gz"),
        "cuda",
        None,
        object(),
        object(),
        "BT4-it332",
        generator.SearchBudget(nodes=200),
        1500,
        _FixedRng(),
    )
    first = generator.generate_game_with_fresh_leela(*args)
    second = generator.generate_game_with_fresh_leela(*args)

    assert first[0] != second[0]
    assert len(engines) == 2
    assert all(engine.quit_called for engine in engines)


def test_lichess_rating_groups_contain_maia_rating() -> None:
    assert generator.lichess_rating_group(1000) == 1000
    assert generator.lichess_rating_group(1199) == 1000
    assert generator.lichess_rating_group(1200) == 1200
    assert generator.lichess_rating_group(2199) == 2000


@pytest.mark.parametrize(
    ("color_roll", "max_plies", "expected_opening", "expected_maia"),
    [
        (1.0, 11, [0, 2, 4, 6, 8], [10]),
        (0.0, 12, [1, 3, 5, 7, 9], [11]),
    ],
)
def test_opponent_uses_lichess_through_ply_ten_then_maia(
    color_roll, max_plies, expected_opening, expected_maia
) -> None:
    opening_plies = []
    maia_plies = []

    class Rng:
        def random(self):
            return color_roll

    class Engine:
        def get_policy_analysis(self, board, budget):
            move = next(iter(board.legal_moves))
            analysis = [{"u": move.uci(), "s": board.san(move), "p": 100, "a": 100}]
            return move, analysis

    class OpeningSampler:
        source = "lichess-rated-rapid-dump"
        speed = "rapid"
        backoff_policy = generator.OPENING_BACKOFF_POLICY
        sampled_games = 2_000_000
        since = "2026-06"
        until = "2026-06"

        def sample_move(self, board, san_history, elo_self, rng):
            opening_plies.append(board.ply())
            assert len(san_history) == board.ply()
            return next(iter(board.legal_moves))

    class MaiaSampler:
        game_type = "rapid"

        def sample_move(self, board, elo_self, elo_oppo, rng):
            maia_plies.append(board.ply())
            return next(iter(board.legal_moves))

    pgn, plies, _ = generator.generate_game_maia2(
        Engine(),
        MaiaSampler(),
        OpeningSampler(),
        "BT4-it332",
        generator.SearchBudget(nodes=200),
        1500,
        Rng(),
        max_plies=max_plies,
    )

    assert plies == max_plies
    assert opening_plies == expected_opening
    assert maia_plies == expected_maia
    assert '[LcStudyOpeningSource "lichess-rated-rapid-dump"]' in pgn
    assert f'[LcStudyOpeningBackoff "{generator.OPENING_BACKOFF_POLICY}"]' in pgn
    assert '[LcStudyOpeningRatingGroup "1400"]' in pgn
    assert '[LcStudyOpeningGames "2000000"]' in pgn


def test_dump_tree_filters_to_rated_rapid_and_samples_counts(tmp_path) -> None:
    pgn = """[Event "Rated Rapid game"]
[Site "https://lichess.org/rapidone"]
[Date "2026.06.01"]
[UTCDate "2026.06.01"]
[WhiteElo "1500"]
[BlackElo "1500"]

1. e4?! { [%clk 0:10:00] } 1... e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7!? 1-0

[Event "Rated Rapid game"]
[Site "https://lichess.org/rapidtwo"]
[Date "2026.06.01"]
[UTCDate "2026.06.01"]
[WhiteElo "1450"]
[BlackElo "1550"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 0-1

[Event "Rated Blitz game"]
[Site "https://lichess.org/blitz"]
[Date "2026.06.01"]
[UTCDate "2026.06.01"]
[WhiteElo "1500"]
[BlackElo "1500"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 1/2-1/2

"""
    payload = tree_builder.build_tree(
        io.StringIO(pgn),
        source_month="2026-06",
        source_url="https://database.lichess.org/test.pgn.zst",
        progress_every=0,
    )
    metadata = payload["metadata"]
    assert metadata["format_version"] == generator.OPENING_TREE_FORMAT_VERSION
    assert metadata["sampled_games"] == 2
    assert metadata["rapid_games_seen"] == 2
    assert "e4" in payload["roots"][1400]
    assert "e4?!" not in payload["roots"][1400]
    assert tree_builder.extract_san_moves("1. e4 ?! e5") == ["e4", "e5"]

    path = tmp_path / "openings.pkl.gz"
    tree_builder.write_tree(payload, path)
    sampler = generator.LichessOpeningTreeSampler(path)
    board = chess.Board()
    first = sampler.sample_move(board, [], 1500, _FixedRng())
    assert first.uci() == "e2e4"
    board.push(first)
    second = sampler.sample_move(board, ["e4"], 1500, _FixedRng())
    assert second.uci() == "e7e5"

    annotated_line = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O"]
    board = chess.Board()
    for san in annotated_line:
        move = board.parse_san(san)
        board.push(move)
    annotated_candidate = sampler.sample_move(
        board,
        annotated_line,
        1500,
        _FixedRng(),
    )
    assert board.san(annotated_candidate) == "Be7"

    sparse = chess.Board()
    sparse.push_san("d4")
    candidates, source = generator.opening_tree_legal_candidates(
        sparse,
        payload["roots"],
        payload["backoffs"],
        1400,
        ["d4"],
    )
    assert source == "suffix-0-rating"
    assert {sparse.san(move) for move, _count in candidates} == {"e5", "c5"}
    backed_off = sampler.sample_move(
        sparse,
        ["d4"],
        1500,
        _FixedRng(),
    )
    assert sparse.san(backed_off) == "e5"

    payload["metadata"]["format_version"] = 1
    old_path = tmp_path / "old-openings.pkl.gz"
    tree_builder.write_tree(payload, old_path)
    with pytest.raises(RuntimeError, match="Unsupported opening tree format"):
        generator.LichessOpeningTreeSampler(old_path)
