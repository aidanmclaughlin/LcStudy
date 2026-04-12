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
  getIsReviewingMoves,
  getCurrentMoveIndex,
  getLastMoveHighlights,
  getMoveHighlightsForIndex
} from './state.js';
import { unlockAudio } from './audio.js';
import { hapticSelect } from './haptics.js';

/** Callback for when a move is submitted */
let onMoveSubmit = null;
let pointerStart = null;
let suppressedClick = null;

const LAST_MOVE_CLASSES = [
  'last-user-move',
  'last-user-move-from',
  'last-user-move-to',
  'last-opponent-move',
  'last-opponent-move-from',
  'last-opponent-move-to'
];

const MOVE_HINT_CLASSES = [
  'move-hint',
  'move-hint-from',
  'move-hint-to'
];

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

  applyLastMoveHighlights();
}

function updatePieceElement(pieceEl, pieceCode) {
  pieceEl.dataset.piece = pieceCode;
  pieceEl.style.backgroundImage = `url(${getPieceImageUrl(pieceCode)})`;
}

function removePieceOn(square) {
  document.querySelector(`[data-square="${square}"] .piece`)?.remove();
}

function moveRookForCastle(color, kingside) {
  const rank = color === 'w' ? '1' : '8';
  const rookFrom = `${kingside ? 'h' : 'a'}${rank}`;
  const rookTo = `${kingside ? 'f' : 'd'}${rank}`;
  const fromEl = document.querySelector(`[data-square="${rookFrom}"]`);
  const toEl = document.querySelector(`[data-square="${rookTo}"]`);
  const rook = fromEl?.querySelector('.piece');

  if (!rook || !toEl) return;

  removePieceOn(rookTo);
  toEl.appendChild(rook);
  rook.style.visibility = '';
}

/**
 * Apply one completed legal move to the existing DOM without repainting the board.
 * @param {{from: string, to: string, moveResult: Object}} applied - Applied move details
 * @returns {boolean} Whether the move was applied to the DOM
 */
export function updateBoardAfterMove(applied) {
  const move = applied?.moveResult;
  if (!move) return false;

  const from = applied.from || move.from;
  const to = applied.to || move.to;
  const fromEl = document.querySelector(`[data-square="${from}"]`);
  const toEl = document.querySelector(`[data-square="${to}"]`);
  const piece = fromEl?.querySelector('.piece');

  if (!piece || !toEl) return false;

  const flags = String(move.flags || '');
  const pieceType = String(move.promotion || move.piece || '').toUpperCase();
  const pieceCode = `${move.color}${pieceType}`;

  if (flags.includes('e')) {
    removePieceOn(`${to[0]}${from[1]}`);
  } else {
    removePieceOn(to);
  }

  updatePieceElement(piece, pieceCode);
  toEl.appendChild(piece);
  piece.style.visibility = '';

  if (flags.includes('k')) {
    moveRookForCastle(move.color, true);
  } else if (flags.includes('q')) {
    moveRookForCastle(move.color, false);
  }

  applyLastMoveHighlights();
  return true;
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

function clearLastMoveHighlights() {
  document.querySelectorAll('.square').forEach(squareEl => {
    squareEl.classList.remove(...LAST_MOVE_CLASSES);
  });
}

function applyMoveHighlight(role, move) {
  if (!move?.from || !move?.to) return;

  const roleClass = role === 'user' ? 'last-user-move' : 'last-opponent-move';
  const fromClass = role === 'user' ? 'last-user-move-from' : 'last-opponent-move-from';
  const toClass = role === 'user' ? 'last-user-move-to' : 'last-opponent-move-to';

  const fromEl = document.querySelector(`[data-square="${move.from}"]`);
  const toEl = document.querySelector(`[data-square="${move.to}"]`);

  fromEl?.classList.add(roleClass, fromClass);
  toEl?.classList.add(roleClass, toClass);
}

/**
 * Apply last user/opponent move highlights to the visible board.
 */
export function applyLastMoveHighlights() {
  clearLastMoveHighlights();

  const highlights = getIsReviewingMoves()
    ? getMoveHighlightsForIndex(getCurrentMoveIndex())
    : getLastMoveHighlights();

  applyMoveHighlight('user', highlights.user);
  applyMoveHighlight('opponent', highlights.opponent);
}

/**
 * Briefly show the move Leela wanted before it is auto-played.
 */
export function showMoveHint(fromSquare, toSquare) {
  document.querySelectorAll('.square').forEach(squareEl => {
    squareEl.classList.remove(...MOVE_HINT_CLASSES);
  });

  const fromEl = document.querySelector(`[data-square="${fromSquare}"]`);
  const toEl = document.querySelector(`[data-square="${toSquare}"]`);

  fromEl?.classList.add('move-hint', 'move-hint-from');
  toEl?.classList.add('move-hint', 'move-hint-to');

  window.setTimeout(() => {
    fromEl?.classList.remove(...MOVE_HINT_CLASSES);
    toEl?.classList.remove(...MOVE_HINT_CLASSES);
  }, 760);
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

  const selectedSq = getSelectedSquare();
  const piece = getPlayerPieceOnSquare(event.currentTarget);
  if (!piece && !selectedSq) return;

  event.preventDefault();

  pointerStart = {
    square: event.currentTarget.dataset.square,
    hadPlayerPiece: Boolean(piece),
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
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const targetSquare = target?.closest?.('.square')?.dataset?.square;
  if (!targetSquare) return;

  event.preventDefault();
  event.stopPropagation();
  suppressedClick = { square: targetSquare, until: Date.now() + 250 };

  const selectedSq = getSelectedSquare();

  if (dragged) {
    if (start.hadPlayerPiece && targetSquare !== start.square) {
      hapticSelect();
      submitSelectedMove(start.square, targetSquare);
    }
    return;
  }

  if (selectedSq) {
    if (selectedSq === targetSquare) {
      clearSelection();
    } else {
      submitSelectedMove(selectedSq, targetSquare);
    }
    return;
  }

  if (start.hadPlayerPiece) {
    const squareEl = document.querySelector(`[data-square="${start.square}"]`);
    setSelectedSquare(start.square);
    squareEl?.classList.add('selected');
    hapticSelect();
  }
}

function handlePointerCancel() {
  pointerStart = null;
}

/**
 * Animate a piece moving between squares.
 * @param {string} fromSquare - Source square
 * @param {string} toSquare - Destination square
 * @param {function(): void} commitMove - Paint the final board position before removing the ghost
 */
export function animateMove(fromSquare, toSquare, commitMove = null) {
  const fromEl = document.querySelector(`[data-square="${fromSquare}"]`);
  const toEl = document.querySelector(`[data-square="${toSquare}"]`);
  const piece = fromEl?.querySelector('.piece');

  if (!piece || !toEl) return Promise.resolve(false);

  const fromRect = piece.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  const ghostPiece = document.createElement('div');
  const existingPiece = toEl.querySelector('.piece');
  const dx = toRect.left + (toRect.width - fromRect.width) / 2 - fromRect.left;
  const dy = toRect.top + (toRect.height - fromRect.height) / 2 - fromRect.top;

  ghost.className = 'move-ghost';
  ghost.style.left = `${fromRect.left}px`;
  ghost.style.top = `${fromRect.top}px`;
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  ghost.style.transform = 'translate(0, 0)';

  ghostPiece.className = 'move-ghost-piece';
  ghostPiece.style.backgroundImage = piece.style.backgroundImage;
  if (piece.classList.contains('flipped')) {
    ghostPiece.classList.add('flipped');
  }
  ghost.appendChild(ghostPiece);

  piece.style.visibility = 'hidden';
  if (existingPiece) existingPiece.style.visibility = 'hidden';
  document.body.appendChild(ghost);

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
    });

    window.setTimeout(() => {
      if (typeof commitMove === 'function') {
        commitMove();
      }
      ghost.remove();
      piece.style.visibility = '';
      if (existingPiece) existingPiece.style.visibility = '';
      resolve(true);
    }, 280);
  });
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
