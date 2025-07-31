import pytest
from pydantic import ValidationError

from src.lcstudy.domain.validation import (
    SessionCreateRequest, 
    MoveRequest, 
    PlayerColor
)

def test_session_create_request_valid():
    request = SessionCreateRequest(
        maia_level=1500,
        player_color=PlayerColor.WHITE,
        custom_fen=None
    )
    
    assert request.maia_level == 1500
    assert request.player_color == PlayerColor.WHITE
    assert request.custom_fen is None

def test_session_create_request_invalid_level():
    with pytest.raises(ValidationError) as exc_info:
        SessionCreateRequest(
            maia_level=1000,
            player_color=PlayerColor.WHITE
        )
    
    assert "Input should be greater than or equal to 1100" in str(exc_info.value)

def test_session_create_request_invalid_level_range():
    with pytest.raises(ValidationError):
        SessionCreateRequest(
            maia_level=2000,
            player_color=PlayerColor.WHITE
        )

def test_move_request_valid():
    request = MoveRequest(
        move="e2e4",
        client_validated=False
    )
    
    assert request.move == "e2e4"
    assert request.client_validated is False

def test_move_request_invalid_length():
    with pytest.raises(ValidationError):
        MoveRequest(move="e2")

def test_move_request_too_long():
    with pytest.raises(ValidationError):
        MoveRequest(move="e2e4q1")

def test_move_request_case_normalization():
    request = MoveRequest(move="E2E4")
    assert request.move == "e2e4"