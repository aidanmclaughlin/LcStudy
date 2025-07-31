from __future__ import annotations
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from enum import Enum

class PlayerColor(str, Enum):
    WHITE = "white"
    BLACK = "black"

class SessionCreateRequest(BaseModel):
    maia_level: int = Field(ge=1100, le=1900)
    player_color: Optional[PlayerColor] = None
    custom_fen: Optional[str] = None
    
    @validator('maia_level')
    def validate_maia_level(cls, v):
        valid_levels = [1100, 1300, 1500, 1700, 1900]
        if v not in valid_levels:
            raise ValueError(f'maia_level must be one of {valid_levels}')
        return v

class MoveRequest(BaseModel):
    move: str = Field(min_length=4, max_length=5)
    client_validated: bool = False
    
    @validator('move')
    def validate_move_format(cls, v):
        if len(v) not in [4, 5]:
            raise ValueError('move must be 4 or 5 characters (UCI format)')
        return v.lower()

class GameHistoryEntry(BaseModel):
    average_retries: float = Field(ge=0)
    total_moves: int = Field(ge=1)
    maia_level: int = Field(ge=1100, le=1900)
    result: str


class SessionStateResponse(BaseModel):
    id: str
    fen: str
    turn: str
    score_total: float
    guesses: int
    ply: int
    status: str
    flip: bool