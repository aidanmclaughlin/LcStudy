/**
 * Move history navigation.
 * Review previous positions with the arrow keys, the review buttons, or by
 * clicking a move in the move list.
 *
 * @module history
 */

import {
  getMoveHistory,
  getCurrentMoveIndex,
  setCurrentMoveIndex,
  getIsReviewingMoves,
  setIsReviewingMoves,
  getLiveFen
} from './state.js';
import { updateBoardFromFen, clearSelection, setReviewingIndicator } from './board.js';
import { updateCharts } from './charts.js';
import { updatePgnDisplay } from './pgn.js';
import { setClockPaused, isStatsOpen } from './timeclock.js';

/**
 * Navigate to a specific position in move history.
 * @param {number} targetIndex - Position after that ply, -1 for the live
 *   position, or -2 to start reviewing from the latest move
 */
export function navigateToMove(targetIndex) {
  if (isStatsOpen()) return;
  const moveHistory = getMoveHistory();
  if (moveHistory.length === 0) return;
  const maxIndex = moveHistory.length - 1;
  const currentIndex = getCurrentMoveIndex();

  if (targetIndex === -2) {
    targetIndex = maxIndex;
  } else if (targetIndex > maxIndex) {
    targetIndex = -1;
  } else if (targetIndex < -1) {
    targetIndex = 0;
  }

  if (targetIndex === currentIndex) return;

  setCurrentMoveIndex(targetIndex);
  setIsReviewingMoves(targetIndex !== -1);
  setClockPaused('review', targetIndex !== -1);
  updateBoardFromFen(targetIndex === -1 ? getLiveFen() : moveHistory[targetIndex].fen);
  updateNavigationUI();
  clearSelection();
}

/**
 * Step backward or forward one ply. Stepping back from the live position
 * starts review at the latest move; stepping past the latest move returns live.
 * @param {number} delta - -1 or 1
 */
export function stepMove(delta) {
  const currentIndex = getCurrentMoveIndex();

  if (currentIndex === -1) {
    if (delta < 0) navigateToMove(-2);
    return;
  }

  const target = currentIndex + delta;
  if (target < 0) return;
  navigateToMove(target);
}

/**
 * Update UI elements to reflect navigation state.
 */
function updateNavigationUI() {
  setReviewingIndicator(getIsReviewingMoves());
  updateCharts();
  updatePgnDisplay();
}

/**
 * Handle keyboard navigation events.
 * @param {KeyboardEvent} event - Keyboard event
 */
export function handleKeyPress(event) {
  if (isStatsOpen() || event.defaultPrevented || event.target?.closest?.('input, textarea, select, [role="tablist"]')) return;

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    stepMove(event.key === 'ArrowLeft' ? -1 : 1);
  } else if (event.key === 'Escape' && getIsReviewingMoves()) {
    event.preventDefault();
    navigateToMove(-1);
  }
}

/**
 * Initialize keyboard navigation listener.
 */
export function initKeyboardNavigation() {
  document.addEventListener('keydown', handleKeyPress);
}

/**
 * Initialize on-screen move review controls.
 */
export function initMoveReviewButtons() {
  document.getElementById('review-prev')?.addEventListener('click', () => stepMove(-1));
  document.getElementById('review-next')?.addEventListener('click', () => stepMove(1));
  document.getElementById('review-exit')?.addEventListener('click', () => navigateToMove(-1));

  // Clicking a move reviews the position after it; the latest move is the live position.
  document.getElementById('move-list')?.addEventListener('click', (event) => {
    const ply = Number(event.target?.closest?.('[data-ply]')?.dataset.ply);
    if (!Number.isInteger(ply)) return;
    navigateToMove(ply === getMoveHistory().length - 1 ? -1 : ply);
  });

  updatePgnDisplay();
}
