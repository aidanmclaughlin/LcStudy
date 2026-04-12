/**
 * Chessboard rendering and interaction.
 * @module board
 */

import { getPieceImageUrl } from './constants.js';
import {
  getCurrentFen,
  setCurrentFen,
  isBoardFlipped,
  setBoardFlipped,
  getSelectedSquare,
  setSelectedSquare,
  getBoardObserver,
  setBoardObserver,
  isRebuilding,
  setIsRebuildingBoard,
  getIsReviewingMoves
} from './state.js';
import { unlockAudio } from './audio.js';
import { hapticSelect } from './haptics.js';

/** Callback for when a move is submitted */
let onMoveSubmit = null;
let pointerStart = null;
let suppressedClick = null;

/**
 * Set the callback for move submission.
 * @param {function(string): void} callback - Called with UCI move string
 */
export function setMoveSubmitCallback(callback) {
  onMoveSubmit = callback;
}

/**
 * Parse FEN notation into a position map.
 * @param {string} fen - FEN string
 * @returns {Object<string, string>} Map of square to piece code
 */
export function parseFen(fen) {
  const position = {};
  const [board] = fen.split(' ');
  const ranks = board.split('/');

  for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
    const rank = 8 - rankIndex;
    const rankData = ranks[rankIndex];
    let file = 0;

    for (const char of rankData) {
      if (char >= '1' && char <= '8') {
        file += parseInt(char, 10);
      } else {
        const square = String.fromCharCode(97 + file) + rank;
        const color = char === char.toUpperCase() ? 'w' : 'b';
        const piece = char.toUpperCase();
        position[square] = color + piece;
        file++;
      }
    }
  }

  return position;
}

/**
 * Create the board HTML structure.
 */
export function createBoardHtml() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  boardEl.innerHTML = '';

  for (let rank = 8; rank >= 1; rank--) {
    for (let file = 0; file < 8; file++) {
      const square = String.fromCharCode(97 + file) + rank;
      const squareEl = document.createElement('div');
      const isLight = (rank + file) % 2 !== 0;

      squareEl.className = `square ${isLight ? 'light' : 'dark'}`;
      squareEl.dataset.square = square;
      squareEl.addEventListener('click', handleSquareClick);
      squareEl.addEventListener('pointerdown', handlePointerDown);
      squareEl.addEventListener('pointerup', handlePointerUp);
      squareEl.addEventListener('pointercancel', handlePointerCancel);

      boardEl.appendChild(squareEl);
    }
  }
}

/**
 * Update the board display from a FEN position.
 * @param {string} fen - FEN string
 */
export function updateBoardFromFen(fen) {
  // Remove existing pieces
  document.querySelectorAll('.piece').forEach(p => p.remove());

  const position = parseFen(fen);
  const flipped = isBoardFlipped();

  for (const [square, piece] of Object.entries(position)) {
    const pieceEl = document.createElement('div');
    pieceEl.className = 'piece';
    pieceEl.style.backgroundImage = `url(${getPieceImageUrl(piece)})`;
    pieceEl.dataset.piece = piece;

    if (flipped) {
      pieceEl.classList.add('flipped');
    }

    const squareEl = document.querySelector(`[data-square="${square}"]`);
    if (squareEl) {
      squareEl.appendChild(pieceEl);
    }
  }
}

/**
 * Set the board flip state (for playing as black).
 * @param {boolean} flip - Whether to flip the board
 */
export function setFlip(flip) {
  const board = document.getElementById('board');
  if (!board) return;

  setBoardFlipped(flip);

  if (flip) {
    board.style.transform = 'rotate(180deg)';
    board.style.setProperty('--board-rotation', '180deg');
  } else {
    board.style.transform = 'none';
    board.style.setProperty('--board-rotation', '0deg');
  }
}

/**
 * Clear the current square selection.
 */
export function clearSelection() {
  document.querySelectorAll('.square.selected').forEach(sq => {
    sq.classList.remove('selected');
  });
  setSelectedSquare(null);
}

function getPlayerPieceOnSquare(squareEl) {
  const piece = squareEl?.querySelector('.piece');
  if (!piece) return null;

  const playerColor = isBoardFlipped() ? 'b' : 'w';
  const pieceCode = piece.dataset.piece || '';

  return pieceCode.startsWith(playerColor) ? piece : null;
}

function submitSelectedMove(fromSquare, toSquare) {
  if (!fromSquare || !toSquare || fromSquare === toSquare) return false;

  clearSelection();

  if (onMoveSubmit) {
    onMoveSubmit(fromSquare + toSquare);
    return true;
  }

  return false;
}

/**
 * Handle click on a square.
 * @param {Event} event - Click event
 */
function handleSquareClick(event) {
  const square = event.currentTarget.dataset.square;
  if (
    suppressedClick &&
    Date.now() < suppressedClick.until &&
    suppressedClick.square === square
  ) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  suppressedClick = null;

  // Unlock audio on user interaction
  try { unlockAudio(); } catch (e) {}

  // Don't allow moves while reviewing history
  if (getIsReviewingMoves()) {
    return;
  }

  const selectedSq = getSelectedSquare();

  if (selectedSq === null) {
    // No selection - try to select a piece
    if (getPlayerPieceOnSquare(event.currentTarget)) {
      setSelectedSquare(square);
      event.currentTarget.classList.add('selected');
      hapticSelect();
    }
  } else {
    // Already have selection
    if (selectedSq === square) {
      // Clicked same square - deselect
      clearSelection();
    } else {
      // Clicked different square - submit move
      submitSelectedMove(selectedSq, square);
    }
  }
}

function handlePointerDown(event) {
  if (getIsReviewingMoves()) return;

  const piece = getPlayerPieceOnSquare(event.currentTarget);
  if (!piece) return;

  pointerStart = {
    square: event.currentTarget.dataset.square,
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId
  };
}

function handlePointerUp(event) {
  if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;

  const start = pointerStart;
  pointerStart = null;

  const dragged = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8;
  if (!dragged) return;

  const target = document.elementFromPoint(event.clientX, event.clientY);
  const targetSquare = target?.closest?.('.square')?.dataset?.square;
  if (!targetSquare || targetSquare === start.square) return;

  event.preventDefault();
  event.stopPropagation();
  suppressedClick = { square: targetSquare, until: Date.now() + 250 };

  hapticSelect();
  submitSelectedMove(start.square, targetSquare);
}

function handlePointerCancel() {
  pointerStart = null;
}

/**
 * Animate a piece moving between squares.
 * @param {string} fromSquare - Source square
 * @param {string} toSquare - Destination square
 */
export function animateMove(fromSquare, toSquare) {
  const fromEl = document.querySelector(`[data-square="${fromSquare}"]`);
  const toEl = document.querySelector(`[data-square="${toSquare}"]`);
  const piece = fromEl?.querySelector('.piece');

  if (piece && toEl) {
    // Remove any existing piece on destination
    const existingPiece = toEl.querySelector('.piece');
    if (existingPiece) {
      existingPiece.remove();
    }

    toEl.appendChild(piece);
    piece.classList.add('animate');
    piece.classList.remove('animate');
  }
}

/**
 * Revert board to current FEN (after invalid move).
 */
export function revertBoard() {
  updateBoardFromFen(getCurrentFen());
}

/**
 * Initialize the board element.
 */
export function initBoard() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  createBoardHtml();
  updateBoardFromFen(getCurrentFen());

  // Disconnect existing observer
  const existingObserver = getBoardObserver();
  if (existingObserver) {
    try { existingObserver.disconnect(); } catch (e) {}
  }

  // Set up observer to rebuild board if it gets cleared
  const observer = new MutationObserver(() => {
    if (isRebuilding()) return;

    if (!boardEl.hasChildNodes()) {
      try {
        setIsRebuildingBoard(true);
        createBoardHtml();
        updateBoardFromFen(getCurrentFen());
      } finally {
        setIsRebuildingBoard(false);
      }
    }
  });

  try {
    observer.observe(boardEl, { childList: true });
  } catch (e) {}

  setBoardObserver(observer);
}

/**
 * Update the reviewing moves indicator on the board.
 * @param {boolean} reviewing - Whether in review mode
 */
export function setReviewingIndicator(reviewing) {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  if (reviewing) {
    boardEl.classList.add('reviewing-moves');
  } else {
    boardEl.classList.remove('reviewing-moves');
  }
}
