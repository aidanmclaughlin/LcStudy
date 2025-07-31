from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Dict, Optional, List
import threading
import time
from ..domain.models import GameSession
from ..exceptions import SessionNotFoundError, SessionExpiredError

class SessionRepository(ABC):
    @abstractmethod
    def save_session(self, session: GameSession) -> None:
        pass
    
    @abstractmethod
    def get_session(self, session_id: str) -> Optional[GameSession]:
        pass
    
    @abstractmethod
    def delete_session(self, session_id: str) -> None:
        pass
    
    @abstractmethod
    def get_all_sessions(self) -> List[GameSession]:
        pass
    
    @abstractmethod
    def cleanup_expired(self, max_age_seconds: int) -> int:
        pass

class InMemorySessionRepository(SessionRepository):
    def __init__(self):
        self._sessions: Dict[str, GameSession] = {}
        self._access_times: Dict[str, float] = {}
        self._lock = threading.RLock()
    
    def save_session(self, session: GameSession) -> None:
        with self._lock:
            self._sessions[session.id] = session
            self._access_times[session.id] = time.time()
    
    def get_session(self, session_id: str) -> Optional[GameSession]:
        with self._lock:
            if session_id not in self._sessions:
                return None
            
            self._access_times[session_id] = time.time()
            return self._sessions[session_id]
    
    def delete_session(self, session_id: str) -> None:
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                del self._access_times[session_id]
    
    def get_all_sessions(self) -> List[GameSession]:
        with self._lock:
            return list(self._sessions.values())
    
    def cleanup_expired(self, max_age_seconds: int) -> int:
        current_time = time.time()
        expired_sessions = []
        
        with self._lock:
            for session_id, access_time in self._access_times.items():
                if current_time - access_time > max_age_seconds:
                    expired_sessions.append(session_id)
            
            for session_id in expired_sessions:
                del self._sessions[session_id]
                del self._access_times[session_id]
        
        return len(expired_sessions)