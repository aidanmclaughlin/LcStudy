/**
 * Move history navigation.
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

/**
 * Navigate to a specific position in move history.
 * @param {number} targetIndex - Target index (-1 = live position)
 */
export function navigateToMove(targetIndex) {
  const moveHistory = getMoveHistory();
  const maxIndex = moveHistory.length - 1;
  const currentIndex = getCurrentMoveIndex();

  console.log(`Navigate: current=${currentIndex}, target=${targetIndex}, maxIndex=${maxIndex}`);

  // Handle navigation from live position
  if (currentIndex === -1) {
    if (targetIndex === -2) {
      // Left arrow from live: go to most recent move
      targetIndex = maxIndex;
    } else if (targetIndex === 0) {
      // Right arrow from live: stay at live
      return;
    }
  }

  // Clamp to valid range
  if (targetIndex < 0 && targetIndex !== -1) {
    targetIndex = 0;
  } else if (targetIndex > maxIndex) {
    targetIndex = -1;
  }

  if (targetIndex === currentIndex) {
    console.log('No change needed');
    return;
  }

  console.log(`Moving to index ${targetIndex}`);
  setCurrentMoveIndex(targetIndex);
  setIsReviewingMoves(targetIndex !== -1);

  if (targetIndex !== -1) {
    // Show historical position
    const move = moveHistory[targetIndex];
    console.log(`Showing historical move ${targetIndex}: ${move.san}`);
    updateBoardFromFen(move.fen);
  } else {
    // Return to live position
    console.log('Returning to live position');
    updateBoardFromFen(getLiveFen());
  }

  updateNavigationUI();
  clearSelection();
}

/**
 * Update UI elements to reflect navigation state.
 */
function updateNavigationUI() {
  const isReviewing = getIsReviewingMoves();
  const currentIndex = getCurrentMoveIndex();
  const moveHistory = getMoveHistory();

  setReviewingIndicator(isReviewing);

  if (isReviewing) {
    const move = moveHistory[currentIndex];
    console.log(`Reviewing move ${currentIndex + 1}/${moveHistory.length}: ${move.san}`);
  } else {
    console.log('Back to live position');
  }

  updateCharts();
  updatePgnDisplay();
}

/**
 * Handle keyboard navigation events.
 * @param {KeyboardEvent} event - Keyboard event
 */
export function handleKeyPress(event) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    return;
  }

  event.preventDefault();

  const currentIndex = getCurrentMoveIndex();

  if (event.key === 'ArrowLeft') {
    navigateToMove(currentIndex - 1);
  } else if (event.key === 'ArrowRight') {
    navigateToMove(currentIndex + 1);
  }
}

/**
 * Initialize keyboard navigation listener.
 */
export function initKeyboardNavigation() {
  document.addEventListener('keydown', handleKeyPress);
}
