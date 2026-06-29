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
import {
  createDirectHapticControl,
  hapticSelect,
  isDirectHapticControl
} from './haptics.js';

/** Callback for when a move is submitted */
let onMoveSubmit = null;
let pointerStart = null;
let suppressedClick = null;
let boardElement = null;
let boardInputEnabled = false;
let dragPreview = null;

const boardsWithListeners = new WeakSet();
const squareEls = new Map();
const pieceElsBySquare = new Map();
const activeHighlightSquares = new Set();
const activeHintSquares = new Set();
const DRAG_START_THRESHOLD_PX = 5;
const SYNTHETIC_CLICK_SUPPRESSION_MS = 900;

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

export function setBoardInputEnabled(enabled) {
  boardInputEnabled = Boolean(enabled);
  const boardEl = getBoardElement();

  if (boardEl) {
    boardEl.classList.toggle('is-loading', !boardInputEnabled);
    boardEl.setAttribute('aria-busy', String(!boardInputEnabled));
  }

  if (!boardInputEnabled) {
    pointerStart = null;
    suppressedClick = null;
    clearDragPreview();
    clearSelection();
  }
}

function getBoardElement() {
  if (boardElement?.isConnected) return boardElement;

  boardElement = document.getElementById('board');
  return boardElement;
}

function getEventSquare(event) {
  const boardEl = getBoardElement();
  const squareEl = event.target?.closest?.('.square');

  return squareEl && boardEl?.contains(squareEl) ? squareEl : null;
}

function addBoardEventListeners(boardEl) {
  if (boardsWithListeners.has(boardEl)) return;

  boardEl.addEventListener('click', handleSquareClick);
  boardEl.addEventListener('pointerdown', handlePointerDown);
  boardEl.addEventListener('pointermove', handlePointerMove);
  boardEl.addEventListener('pointerup', handlePointerUp);
  boardEl.addEventListener('pointercancel', handlePointerCancel);
  boardsWithListeners.add(boardEl);
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
  const boardEl = getBoardElement();
  if (!boardEl) return;

  boardEl.innerHTML = '';
  squareEls.clear();
  pieceElsBySquare.clear();
  activeHighlightSquares.clear();
  activeHintSquares.clear();
  clearDragPreview();
  addBoardEventListeners(boardEl);

  for (let rank = 8; rank >= 1; rank--) {
    for (let file = 0; file < 8; file++) {
      const square = String.fromCharCode(97 + file) + rank;
      const squareEl = document.createElement('div');
      const isLight = (rank + file) % 2 !== 0;

      squareEl.className = `square ${isLight ? 'light' : 'dark'}`;
      squareEl.dataset.square = square;

      const directHapticControl = createDirectHapticControl();
      if (directHapticControl) squareEl.appendChild(directHapticControl);

      squareEls.set(square, squareEl);
      boardEl.appendChild(squareEl);
    }
  }
}

function createPieceElement(pieceCode, flipped) {
  const pieceEl = document.createElement('div');

  pieceEl.className = 'piece';
  pieceEl.style.backgroundImage = `url(${getPieceImageUrl(pieceCode)})`;
  pieceEl.dataset.piece = pieceCode;
  pieceEl.classList.toggle('flipped', flipped);

  return pieceEl;
}

/**
 * Update the board display from a FEN position.
 * @param {string} fen - FEN string
 */
export function updateBoardFromFen(fen) {
  const position = parseFen(fen);
  const flipped = isBoardFlipped();
  const occupiedSquares = new Set(Object.keys(position));

  for (const [square, pieceEl] of Array.from(pieceElsBySquare.entries())) {
    if (!occupiedSquares.has(square)) {
      pieceEl.remove();
      pieceElsBySquare.delete(square);
    }
  }

  for (const [square, piece] of Object.entries(position)) {
    const squareEl = squareEls.get(square);
    if (!squareEl) continue;

    let pieceEl = pieceElsBySquare.get(square);

    if (!pieceEl) {
      pieceEl = createPieceElement(piece, flipped);
      squareEl.appendChild(pieceEl);
      pieceElsBySquare.set(square, pieceEl);
      continue;
    }

    updatePieceElement(pieceEl, piece);
    pieceEl.classList.toggle('flipped', flipped);

    if (pieceEl.parentElement !== squareEl) {
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
  const piece = pieceElsBySquare.get(square);

  if (piece) {
    piece.remove();
    pieceElsBySquare.delete(square);
  }
}

function moveRookForCastle(color, kingside) {
  const rank = color === 'w' ? '1' : '8';
  const rookFrom = `${kingside ? 'h' : 'a'}${rank}`;
  const rookTo = `${kingside ? 'f' : 'd'}${rank}`;
  const toEl = squareEls.get(rookTo);
  const rook = pieceElsBySquare.get(rookFrom);

  if (!rook || !toEl) return;

  removePieceOn(rookTo);
  toEl.appendChild(rook);
  pieceElsBySquare.delete(rookFrom);
  pieceElsBySquare.set(rookTo, rook);
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
  const toEl = squareEls.get(to);
  const piece = pieceElsBySquare.get(from);

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
  pieceElsBySquare.delete(from);
  pieceElsBySquare.set(to, piece);
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
  const board = getBoardElement();
  if (!board) return;

  setBoardFlipped(flip);
  pieceElsBySquare.forEach((pieceEl) => {
    pieceEl.classList.toggle('flipped', flip);
  });

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
  const selectedSquare = getSelectedSquare();
  squareEls.get(selectedSquare)?.classList.remove('selected');
  setSelectedSquare(null);
}

function clearLastMoveHighlights() {
  activeHighlightSquares.forEach((square) => {
    squareEls.get(square)?.classList.remove(...LAST_MOVE_CLASSES);
  });
  activeHighlightSquares.clear();
}

function applyMoveHighlight(role, move) {
  if (!move?.from || !move?.to) return;

  const roleClass = role === 'user' ? 'last-user-move' : 'last-opponent-move';
  const fromClass = role === 'user' ? 'last-user-move-from' : 'last-opponent-move-from';
  const toClass = role === 'user' ? 'last-user-move-to' : 'last-opponent-move-to';

  const fromEl = squareEls.get(move.from);
  const toEl = squareEls.get(move.to);

  if (fromEl) {
    fromEl.classList.add(roleClass, fromClass);
    activeHighlightSquares.add(move.from);
  }

  if (toEl) {
    toEl.classList.add(roleClass, toClass);
    activeHighlightSquares.add(move.to);
  }
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
  activeHintSquares.forEach((square) => {
    squareEls.get(square)?.classList.remove(...MOVE_HINT_CLASSES);
  });
  activeHintSquares.clear();

  const fromEl = squareEls.get(fromSquare);
  const toEl = squareEls.get(toSquare);

  if (fromEl) {
    fromEl.classList.add('move-hint', 'move-hint-from');
    activeHintSquares.add(fromSquare);
  }

  if (toEl) {
    toEl.classList.add('move-hint', 'move-hint-to');
    activeHintSquares.add(toSquare);
  }

  window.setTimeout(() => {
    fromEl?.classList.remove(...MOVE_HINT_CLASSES);
    toEl?.classList.remove(...MOVE_HINT_CLASSES);
    activeHintSquares.delete(fromSquare);
    activeHintSquares.delete(toSquare);
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
  if (!boardInputEnabled) return false;

  clearSelection();

  if (onMoveSubmit) {
    onMoveSubmit(fromSquare + toSquare);
    return true;
  }

  return false;
}

function beginDragPreview(start) {
  const piece = start.piece;
  if (!piece || dragPreview) return;

  const rect = piece.getBoundingClientRect();
  const ghost = document.createElement('div');
  const ghostPiece = document.createElement('div');

  ghost.className = 'drag-ghost';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.transform = 'translate3d(0, 0, 0)';

  ghostPiece.className = 'drag-ghost-piece';
  ghostPiece.style.backgroundImage = piece.style.backgroundImage;
  ghost.appendChild(ghostPiece);

  piece.classList.add('is-dragging-source');
  document.body.appendChild(ghost);

  dragPreview = {
    element: ghost,
    sourcePiece: piece,
    startX: start.x,
    startY: start.y,
    nextX: start.x,
    nextY: start.y,
    frame: 0
  };
}

function moveDragPreview(clientX, clientY) {
  if (!dragPreview) return;

  dragPreview.nextX = clientX;
  dragPreview.nextY = clientY;

  if (dragPreview.frame) return;

  dragPreview.frame = window.requestAnimationFrame(() => {
    if (!dragPreview) return;

    const dx = dragPreview.nextX - dragPreview.startX;
    const dy = dragPreview.nextY - dragPreview.startY;
    dragPreview.element.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    dragPreview.frame = 0;
  });
}

function clearDragPreview() {
  if (!dragPreview) return;

  if (dragPreview.frame) {
    window.cancelAnimationFrame(dragPreview.frame);
  }

  dragPreview.sourcePiece?.classList.remove('is-dragging-source');
  dragPreview.element.remove();
  dragPreview = null;
}

function releasePointerCapture(event) {
  const boardEl = getBoardElement();
  if (!boardEl?.hasPointerCapture?.(event.pointerId)) return;

  try { boardEl.releasePointerCapture(event.pointerId); } catch (e) {}
}

function shouldSuppressClick(square) {
  if (!suppressedClick) return false;

  if (Date.now() >= suppressedClick.until) {
    suppressedClick = null;
    return false;
  }

  if (suppressedClick.squares?.has?.(square)) return true;
  return suppressedClick.square === square;
}

/**
 * Handle click on a square.
 * @param {Event} event - Click event
 */
function handleSquareClick(event) {
  if (!boardInputEnabled) return;

  const squareEl = getEventSquare(event);
  if (!squareEl) return;

  const square = squareEl.dataset.square;
  const directHaptic = isDirectHapticControl(event.target);
  if (shouldSuppressClick(square)) {
    if (directHaptic) return;
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
    if (getPlayerPieceOnSquare(squareEl)) {
      setSelectedSquare(square);
      squareEl.classList.add('selected');
      if (!directHaptic) hapticSelect();
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
  if (!boardInputEnabled) return;
  if (getIsReviewingMoves()) return;

  const squareEl = getEventSquare(event);
  if (!squareEl) return;

  const selectedSq = getSelectedSquare();
  const piece = getPlayerPieceOnSquare(squareEl);
  if (!piece && !selectedSq) return;

  const directHaptic = isDirectHapticControl(event.target);
  if (!directHaptic) {
    event.preventDefault();
    try { getBoardElement()?.setPointerCapture?.(event.pointerId); } catch (e) {}
  }

  pointerStart = {
    square: squareEl.dataset.square,
    hadPlayerPiece: Boolean(piece),
    piece,
    directHaptic,
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId
  };
}

function handlePointerMove(event) {
  if (!boardInputEnabled) return;
  if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;

  const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  if (!pointerStart.directHaptic) event.preventDefault();

  if (!dragPreview && pointerStart.hadPlayerPiece && distance >= DRAG_START_THRESHOLD_PX) {
    beginDragPreview(pointerStart);
  }

  moveDragPreview(event.clientX, event.clientY);
}

function handlePointerUp(event) {
  if (!boardInputEnabled) return;
  if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;

  const start = pointerStart;
  pointerStart = null;
  releasePointerCapture(event);

  const dragged = Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_START_THRESHOLD_PX;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const targetSquare = target?.closest?.('.square')?.dataset?.square;
  clearDragPreview();
  if (!targetSquare) return;

  const directHaptic = start.directHaptic || isDirectHapticControl(event.target);
  if (!directHaptic) event.preventDefault();
  event.stopPropagation();
  suppressedClick = {
    squares: new Set([start.square, targetSquare]),
    until: Date.now() + SYNTHETIC_CLICK_SUPPRESSION_MS
  };

  const selectedSq = getSelectedSquare();

  if (dragged) {
    if (start.hadPlayerPiece && targetSquare !== start.square) {
      if (!directHaptic) hapticSelect();
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
    const squareEl = squareEls.get(start.square);
    setSelectedSquare(start.square);
    squareEl?.classList.add('selected');
    if (!directHaptic) hapticSelect();
  }
}

function handlePointerCancel(event) {
  if (!boardInputEnabled) return;
  releasePointerCapture(event);
  pointerStart = null;
  clearDragPreview();
}

/**
 * Animate a piece moving between squares.
 * @param {string} fromSquare - Source square
 * @param {string} toSquare - Destination square
 * @param {function(): void} commitMove - Paint the final board position before removing the ghost
 */
export function animateMove(fromSquare, toSquare, commitMove = null) {
  const toEl = squareEls.get(toSquare);
  const piece = pieceElsBySquare.get(fromSquare);

  if (!piece || !toEl) return Promise.resolve(false);

  const fromRect = piece.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  const ghostPiece = document.createElement('div');
  const existingPiece = pieceElsBySquare.get(toSquare);
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
  const boardEl = getBoardElement();
  if (!boardEl) return;

  createBoardHtml();
  updateBoardFromFen(getCurrentFen());
  setBoardInputEnabled(boardInputEnabled);

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
  const boardEl = getBoardElement();
  if (!boardEl) return;

  const completionOverlay = document.getElementById('completion-overlay');

  if (reviewing) {
    boardEl.classList.add('reviewing-moves');
    if (completionOverlay?.classList.contains('is-visible')) {
      completionOverlay.hidden = true;
      completionOverlay.setAttribute('aria-hidden', 'true');
      completionOverlay.setAttribute('inert', '');
    }
  } else {
    boardEl.classList.remove('reviewing-moves');
    if (completionOverlay?.classList.contains('is-visible')) {
      completionOverlay.hidden = false;
      completionOverlay.setAttribute('aria-hidden', 'false');
      completionOverlay.removeAttribute('inert');
    }
  }
}
