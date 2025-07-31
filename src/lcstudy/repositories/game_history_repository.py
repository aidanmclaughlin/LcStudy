from __future__ import annotations
from abc import ABC, abstractmethod
from typing import List, Optional
import json
from pathlib import Path
from datetime import datetime
from ..domain.models import GameHistoryEntry, GameResult
from ..exceptions import DataError, SerializationError

class GameHistoryRepository(ABC):
    @abstractmethod
    def save_game(self, average_retries: float, total_moves: int, maia_level: int, result: str) -> str:
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
    
    def save_game(self, average_retries: float, total_moves: int, maia_level: int, result: str) -> str:
        try:
            history = self._load_history()
            
            entry_dict = {
                "date": datetime.now().isoformat(),
                "average_retries": average_retries,
                "total_moves": total_moves,
                "maia_level": maia_level,
                "result": result
            }
            
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
                    "completion_rate": 0.0
                }
            
            total_games = len(games)
            total_retries = sum(game["average_retries"] for game in games)
            total_moves = sum(game["total_moves"] for game in games)
            completed_games = sum(1 for game in games if game["result"] == "finished")
            
            return {
                "total_games": total_games,
                "average_retries": total_retries / total_games,
                "average_moves": total_moves / total_games,
                "completion_rate": completed_games / total_games * 100.0
            }
            
        except Exception as e:
            raise DataError(f"Failed to calculate statistics: {e}")
    
    def _load_history(self) -> List[dict]:
        if not self.file_path.exists():
            return []
        
        try:
            with open(self.file_path, 'r') as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except json.JSONDecodeError as e:
            raise SerializationError(f"Invalid JSON in history file: {e}")
        except Exception as e:
            raise DataError(f"Failed to read history file: {e}")
    
    def _save_history(self, history: List[dict]) -> None:
        try:
            with open(self.file_path, 'w') as f:
                json.dump(history, f, indent=2)
        except Exception as e:
            raise DataError(f"Failed to write history file: {e}")