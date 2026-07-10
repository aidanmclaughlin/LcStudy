from pathlib import Path

import chess

from tools import generate_games_maia2 as generator


class _FixedRng:
    def random(self) -> float:
        return 0.0


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
        lambda engine, *args: (str(id(engine)), 1, "*"),
    )

    args = (
        "lc0",
        Path("BT4-it332.pb.gz"),
        "cuda",
        None,
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
