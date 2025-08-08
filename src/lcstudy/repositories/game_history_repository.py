from __future__ import annotations

import json
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import List

from ..domain.models import GameHistoryEntry
from ..exceptions import DataError, SerializationError


class GameHistoryRepository(ABC):
    @abstractmethod
    def save_game(self, *args, **kwargs) -> str:
        pass

    @abstractmethod
    def get_all_games(self) -> List[dict]:
        pass

    @abstractmethod
    def clear_history(self) -> None:
        pass

    @abstractmethod
    def get_statistics(self) -> dict:
        pass


class JsonGameHistoryRepository(GameHistoryRepository):
    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.file_path.parent.mkdir(parents=True, exist_ok=True)

    def save_game(self, *args, **kwargs) -> str:
        try:
            # Support both structured dataclass and individual fields
            entry_dict: dict
            if args and isinstance(args[0], GameHistoryEntry):
                entry: GameHistoryEntry = args[0]
                entry_dict = {
                    "date": entry.date,
                    "average_retries": float(entry.average_retries),
                    "total_moves": int(entry.total_moves),
                    "maia_level": int(entry.maia_level),
                    "result": (
                        entry.result.value
                        if hasattr(entry.result, "value")
                        else str(entry.result)
                    ),
                    "session_id": entry.session_id,
                }
            else:
                average_retries: float = float(
                    kwargs.get("average_retries", args[0] if len(args) > 0 else 0)
                )
                total_moves: int = int(
                    kwargs.get("total_moves", args[1] if len(args) > 1 else 0)
                )
                maia_level: int = int(
                    kwargs.get("maia_level", args[2] if len(args) > 2 else 1500)
                )
                result: str = str(
                    kwargs.get("result", args[3] if len(args) > 3 else "unknown")
                )
                entry_dict = {
                    "date": datetime.now().isoformat(),
                    "average_retries": average_retries,
                    "total_moves": total_moves,
                    "maia_level": maia_level,
                    "result": result,
                }
            history = self._load_history()

            history.append(entry_dict)
            self._save_history(history)
            return entry_dict["date"]

        except Exception as e:
            raise DataError(f"Failed to save game history: {e}")

    def get_all_games(self) -> List[dict]:
        try:
            return self._load_history()
        except Exception as e:
            raise DataError(f"Failed to load game history: {e}")

    def clear_history(self) -> None:
        try:
            self._save_history([])
        except Exception as e:
            raise DataError(f"Failed to clear game history: {e}")

    def get_statistics(self) -> dict:
        try:
            games = self.get_all_games()

            if not games:
                return {
                    "total_games": 0,
                    "average_retries": 0.0,
                    "average_moves": 0.0,
                    "completion_rate": 0.0,
                }

            total_games = len(games)
            total_retries = sum(game["average_retries"] for game in games)
            total_moves = sum(game["total_moves"] for game in games)
            completed_games = sum(1 for game in games if game["result"] == "finished")

            return {
                "total_games": total_games,
                "average_retries": total_retries / total_games,
                "average_moves": total_moves / total_games,
                "completion_rate": completed_games / total_games * 100.0,
            }

        except Exception as e:
            raise DataError(f"Failed to calculate statistics: {e}")

    def _load_history(self) -> List[dict]:
        if not self.file_path.exists():
            return []

        try:
            with open(self.file_path, "r") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except json.JSONDecodeError as e:
            raise SerializationError(f"Invalid JSON in history file: {e}")
        except Exception as e:
            raise DataError(f"Failed to read history file: {e}")

    def _save_history(self, history: List[dict]) -> None:
        try:
            with open(self.file_path, "w") as f:
                json.dump(history, f, indent=2)
        except Exception as e:
            raise DataError(f"Failed to write history file: {e}")
