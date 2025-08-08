from __future__ import annotations

import argparse
import random
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import List, Any, cast

import chess
import chess.pgn

from ..config import get_settings
from ..config.logging import get_logger, setup_logging
from ..controllers.deps import get_engine_service
from ..engines import pick_from_multipv


class TerminalUI:
    def __init__(self, total_games: int, leela_nodes: int, out_dir: Path):
        self.total_games = total_games
        self.leela_nodes = leela_nodes
        self.out_dir = out_dir
        self.hide_cursor()

    def hide_cursor(self) -> None:
        try:
            print("\033[?25l", end="")
        except Exception:
            pass

    def show_cursor(self) -> None:
        try:
            print("\033[?25h", end="")
        except Exception:
            pass

    def clear(self) -> None:
        print("\033[2J\033[H", end="")

    def progress_bar(self, current: int, total: int, width: int = 30) -> str:
        total = max(total, 1)
        done = int(width * current / total)
        return "[" + "#" * done + "-" * (width - done) + f"] {current}/{total}"

    def render(
        self,
        *,
        game_index: int,
        board: chess.Board,
        last_san: str,
        last_uci: str,
        plies: int,
        maia_level: int,
        saved_file: str | None = None,
    ) -> None:
        cols = shutil.get_terminal_size((80, 24)).columns
        self.clear()
        header = f"LcStudy Seed Generator | out={self.out_dir} | Leela nodes={self.leela_nodes}"
        print(header[:cols])
        print(self.progress_bar(game_index - 1, self.total_games))
        print(
            f"Generating game {game_index}/{self.total_games}  (plies={plies}, Maia {maia_level})"
        )
        print()
        # Board area
        print(board)
        print()
        if last_san:
            print(f"Last move: {last_san} [{last_uci}]")
        if saved_file:
            print(f"Saved: {saved_file}")
        sys.stdout.flush()

    def close(self) -> None:
        self.show_cursor()


def generate_game(
    out_dir: Path,
    *,
    leela_nodes: int = 300_000,
    # Internals (not exposed via CLI)
    maia_nodes: int = 1,
    maia_level: int = 1500,
    maia_temperature: float = 0.5,
    maia_multipv: int = 4,
    max_plies: int = 240,
    show_board: bool = True,
    board_every: int = 1,
    ui: TerminalUI | None = None,
    game_index: int = 1,
) -> Path:
    """Generate one Leela vs Maia game and write it to out_dir; return the file path."""
    log = get_logger("seedgen")
    eng = get_engine_service()

    board = chess.Board()
    leela = eng.get_leela_engine(f"seed-{uuid.uuid4().hex[:6]}")
    maia = eng.get_maia_engine(maia_level)

    game = chess.pgn.Game()
    game.headers["Event"] = "LcStudy Training Game"

    # Coin flip to determine Leela's color (50/50 split)
    leela_is_white = random.random() < 0.5

    if leela_is_white:
        game.headers["White"] = "Leela (PLAYER)"
        game.headers["Black"] = f"Maia {maia_level} (AUTO)"
        player_engine = leela
        opponent_engine = maia
        player_nodes = leela_nodes
        opponent_nodes = maia_nodes
    else:
        game.headers["White"] = f"Maia {maia_level} (AUTO)"
        game.headers["Black"] = "Leela (PLAYER)"
        player_engine = leela
        opponent_engine = maia
        player_nodes = leela_nodes
        opponent_nodes = maia_nodes

    game.headers["Site"] = "LcStudy"
    game.headers["Result"] = "*"
    node: Any = cast(Any, game)

    if ui:
        ui.render(
            game_index=game_index,
            board=board,
            last_san="",
            last_uci="",
            plies=0,
            maia_level=maia_level,
        )
    elif show_board:
        leela_color = "White" if leela_is_white else "Black"
        maia_color = "Black" if leela_is_white else "White"
        print(
            f"\n=== New game: Leela ({leela_color}) vs Maia {maia_level} ({maia_color}) ==="
        )
        print(board)
        sys.stdout.flush()

    plies = 0
    while not board.is_game_over() and plies < max_plies:
        try:
            # Determine which engine plays based on current turn and color assignment
            if (board.turn == chess.WHITE and leela_is_white) or (
                board.turn == chess.BLACK and not leela_is_white
            ):
                # Leela's turn
                mv = player_engine.get_best_move(board, nodes=player_nodes)
                san = board.san(mv)
            else:
                # Maia's turn
                # Decay temperature after 10 full moves
                fullmove = board.fullmove_number
                # Linear decay to 0 by move 11
                decay_factor = max(0.0, (10 - (fullmove - 1)) / 10)
                temp_eff = maia_temperature * decay_factor
                if temp_eff > 1e-6 and maia_multipv > 1:
                    infos = opponent_engine.engine.analyse(board, nodes=opponent_nodes, multipv=maia_multipv)
                    mv = pick_from_multipv(infos, board.turn, temperature=temp_eff)
                    try:
                        san = board.san(mv)
                    except Exception:
                        san = mv.uci()
                else:
                    mv = opponent_engine.get_best_move(board, nodes=opponent_nodes)
                    san = board.san(mv)
        except Exception as e:
            log.error("Engine move failed at ply %d: %s", plies, e)
            break
        # Apply move then optionally show updated board
        board.push(mv)
        if ui:
            mover = "W" if (not board.turn) else "B"
            ui.render(
                game_index=game_index,
                board=board,
                last_san=f"{mover} {san}",
                last_uci=mv.uci(),
                plies=plies + 1,
                maia_level=maia_level,
            )
        elif show_board and (board_every <= 1 or (plies % board_every == 0)):
            mover = "W" if (not board.turn) else "B"  # side who just moved
            print(f"\nPly {plies+1} ({mover}) played: {san} [{mv.uci()}]")
            print(board)
            sys.stdout.flush()
        node = node.add_variation(mv)
        plies += 1

    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"seed_{int(time.time())}_{uuid.uuid4().hex[:8]}.pgn"
    out_path = out_dir / name
    with open(out_path, "w", encoding="utf-8") as f:
        exporter = chess.pgn.StringExporter(
            headers=True, variations=False, comments=False
        )
        f.write(game.accept(exporter))
    if ui:
        ui.render(
            game_index=game_index,
            board=board,
            last_san="",
            last_uci="",
            plies=plies,
            maia_level=maia_level,
            saved_file=out_path.name,
        )
    log.info("Wrote %s (plies=%d)", out_path, plies)
    return out_path


def main(argv: List[str] | None = None, setup_logs: bool = True) -> int:
    parser = argparse.ArgumentParser(
        description="Generate Leela vs Maia seed PGNs (writes to ~/.lcstudy/precomputed/games or static/pgn)"
    )
    parser.add_argument(
        "--count", type=int, default=25, help="Number of games to generate"
    )
    parser.add_argument(
        "-L",
        "--levels",
        type=str,
        help=(
            "Comma-separated Maia levels to sample from (e.g. '1500,1700,2200'). "
            "If omitted, defaults to 1100,1300,1500,1700,1900,2200."
        ),
    )
    parser.add_argument(
        "--leela-nodes",
        type=int,
        default=1000,
        help="Nodes for Leela moves (hardcoded at runtime to 1000)",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run continuously, generating games into the user data directory",
    )
    parser.add_argument(
        "--max-seeds",
        type=int,
        default=25,
        help="Maximum number of seed PGNs to keep in the precomputed directory; in daemon mode generation idles when this cap is reached",
    )
    args = parser.parse_args(argv)

    # Only set up logging if not in daemon mode (background generation)
    if setup_logs and not args.daemon:
        setup_logging()

    log = get_logger("seedgen")
    # Sample Maia levels to create a variety of seeds (can be overridden by CLI)
    default_levels = [1100, 1300, 1500, 1700, 1900, 2200]
    levels = default_levels
    if args.levels:
        try:
            requested = [int(x) for x in args.levels.replace(" ", "").split(",") if x]
        except ValueError:
            log.error("Invalid --levels value: %s", args.levels)
            return 2
        # Validate against supported set
        supported = set(default_levels)
        bad = [x for x in requested if x not in supported]
        if bad:
            log.error(
                "Unsupported Maia levels requested: %s (supported: %s)",
                ", ".join(map(str, bad)),
                ", ".join(map(str, sorted(supported))),
            )
            return 2
        if not requested:
            log.error("--levels provided but no valid levels parsed")
            return 2
        levels = requested

    settings = get_settings()
    # Background/default output: user database
    user_out = settings.data_dir / "precomputed" / "games"
    out_dir = user_out

    if args.daemon:
        # Infinite generator mode
        i = 0
        ui = TerminalUI(total_games=999999, leela_nodes=1000, out_dir=out_dir)
        try:
            while True:
                # Respect cap on number of precomputed games
                try:
                    out_dir.mkdir(parents=True, exist_ok=True)
                except Exception:
                    pass
                try:
                    current = len(list(out_dir.glob("*.pgn")))
                except Exception:
                    current = 0
                if current >= max(0, int(args.max_seeds)):
                    # Idle to save compute and check again later
                    log.info(
                        "Max seeds reached (%d >= %d); idling background generation",
                        current,
                        args.max_seeds,
                    )
                    time.sleep(60.0)
                    continue
                i += 1
                lvl = random.choice(levels)
                try:
                    generate_game(
                        out_dir,
                        leela_nodes=1000,
                        maia_level=lvl,
                        maia_temperature=random.random(),
                        ui=ui,
                        game_index=i,
                    )
                except Exception as e:
                    log.error("Failed to generate game %d: %s", i, e)
                    time.sleep(2.0)
        finally:
            ui.close()
    else:
        ui = TerminalUI(total_games=args.count, leela_nodes=1000, out_dir=out_dir)
        try:
            for i in range(args.count):
                lvl = random.choice(levels)
                try:
                    generate_game(
                        out_dir,
                        leela_nodes=1000,
                        maia_level=lvl,
                        maia_temperature=random.random(),
                        ui=ui,
                        game_index=i + 1,
                    )
                except Exception as e:
                    log.error("Failed to generate game %d: %s", i + 1, e)
                    time.sleep(1.0)
        finally:
            ui.close()
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
