from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import chess
import chess.pgn


@dataclass
class PrecomputedGame:
    id: str
    moves_uci: List[str]
    leela_color: chess.Color  # Color that Leela played in this game


class PrecomputedRepository:
    """Load and serve precomputed Leela vs Maia games.

    Games are stored as PGN files with a single mainline. We parse them into
    UCI move lists and serve expected moves by game id and ply index.
    """

    def __init__(
        self, seeds_dir: Optional[Path] = None, user_dir: Optional[Path] = None
    ):
        if seeds_dir is None:
            # Package static PGNs live under src/lcstudy/static/pgn
            # This file is at src/lcstudy/repositories/precomputed_repository.py
            # so package_dir = parent.parent
            package_dir = Path(__file__).resolve().parent.parent
            seeds_dir = package_dir / "static" / "pgn"
        self._seeds_dir = seeds_dir
        # User-generated (background) games directory

        try:
            from ..config import get_settings

            settings = get_settings()
            user_dir = settings.data_dir / "precomputed" / "games"
        except Exception:
            if user_dir is None:
                user_dir = Path.home() / ".lcstudy" / "precomputed" / "games"
        self._user_dir = user_dir
        self._games: Dict[str, PrecomputedGame] = {}
        self._paths: Dict[str, Path] = {}
        self._ids: List[str] = []
        self._lock = threading.Lock()
        self._rr_index = 0
        self._loaded_paths = set()
        self._load_all()

    def _load_path(self, p: Path) -> None:
        try:
            with open(p, "r", encoding="utf-8") as f:
                game = chess.pgn.read_game(f)
            if game is None:
                return
            board = game.board()
            moves: List[str] = []
            for mv in game.mainline_moves():
                moves.append(mv.uci())
                board.push(mv)

            # Skip empty games (no moves)
            if not moves:
                return

            gid = p.stem
            if gid not in self._games:
                # Determine which color Leela (the player) played
                white_player = game.headers.get("White", "")
                black_player = game.headers.get("Black", "")

                # Look for "PLAYER" marker in headers to identify Leela's color
                if "PLAYER" in white_player:
                    leela_color = chess.WHITE
                elif "PLAYER" in black_player:
                    leela_color = chess.BLACK
                else:
                    # Fallback: assume Leela is mentioned in the header
                    leela_color = (
                        chess.WHITE if "Leela" in white_player else chess.BLACK
                    )

                self._games[gid] = PrecomputedGame(
                    id=gid, moves_uci=moves, leela_color=leela_color
                )
                self._ids.append(gid)
                self._paths[gid] = p
            self._loaded_paths.add(p)
        except Exception:
            pass

    def _load_all(self) -> None:
        # Load seeds
        if self._seeds_dir.exists():
            for p in sorted(self._seeds_dir.glob("*.pgn")):
                if p not in self._loaded_paths:
                    self._load_path(p)
        # Load user-generated games
        if self._user_dir and self._user_dir.exists():
            for p in sorted(self._user_dir.glob("*.pgn")):
                if p not in self._loaded_paths:
                    self._load_path(p)

    def has_games(self) -> bool:
        return bool(self._ids)

    def assign_game(self) -> Optional[str]:
        """Return a game id using round-robin selection."""
        with self._lock:
            self._load_all()
            if not self._ids:
                return None
            gid = self._ids[self._rr_index % len(self._ids)]
            self._rr_index += 1
            return gid

    def get_expected(self, gid: str, ply_index: int) -> Optional[str]:
        g = self._games.get(gid)
        if not g:
            return None
        if 0 <= ply_index < len(g.moves_uci):
            return g.moves_uci[ply_index]
        return None

    def get_reply(self, gid: str, ply_index: int) -> Optional[str]:
        """Return the opponent reply following the expected move at ply_index."""
        g = self._games.get(gid)
        if not g:
            return None
        idx = ply_index + 1
        if 0 <= idx < len(g.moves_uci):
            return g.moves_uci[idx]
        return None

    def game_length(self, gid: str) -> int:
        g = self._games.get(gid)
        return len(g.moves_uci) if g else 0

    def get_leela_color(self, gid: str) -> Optional[chess.Color]:
        """Return the color that Leela played in this game."""
        g = self._games.get(gid)
        return g.leela_color if g else None

    def consume_game(self, gid: str) -> bool:
        """Remove a game from memory and delete its file if it is user-generated.

        Returns True if the game was present and removed.
        """
        with self._lock:
            if gid not in self._games:
                return False
            try:
                self._ids.remove(gid)
            except ValueError:
                pass
            self._games.pop(gid, None)
            p = self._paths.pop(gid, None)
            try:
                if p and self._user_dir and p.is_file() and self._user_dir in p.parents:
                    # Best effort delete; ignore errors
                    p.unlink()  # type: ignore[arg-type]
            except Exception:
                pass
            return True
