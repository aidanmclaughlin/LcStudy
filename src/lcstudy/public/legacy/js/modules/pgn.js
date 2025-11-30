/**
 * PGN move display.
 * @module pgn
 */

import {
  getPgnMoves,
  getIsReviewingMoves,
  getCurrentMoveIndex
} from './state.js';

/**
 * Update the PGN move list display.
 */
export function updatePgnDisplay() {
  const pgnElement = document.getElementById('move-list');
  const pgnContainer = document.getElementById('pgn-moves');

  if (!pgnElement || !pgnContainer) return;

  const pgnMoves = getPgnMoves();

  if (pgnMoves.length === 0) {
    pgnElement.innerHTML = '<span class="meta">Game not started</span>';
    return;
  }

  const isReviewing = getIsReviewingMoves();
  const currentIndex = getCurrentMoveIndex();

  let html = '';

  for (let i = 0; i < pgnMoves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const whiteMove = pgnMoves[i] || '';
    const blackMove = pgnMoves[i + 1] || '';

    // Check if this move is currently highlighted
    const isWhiteHighlighted = isReviewing && currentIndex === i;
    const isBlackHighlighted = isReviewing && currentIndex === i + 1;

    html += `<span style="color: #f8fafc; font-weight: 600;">${moveNum}.</span> `;

    // White move
    if (whiteMove) {
      if (isWhiteHighlighted) {
        html += `<span style="background-color: #10b981; color: #000; padding: 2px 4px; border-radius: 3px;">${whiteMove}</span>`;
      } else {
        html += whiteMove;
      }
    }

    // Black move
    if (blackMove) {
      html += ' ';
      if (isBlackHighlighted) {
        html += `<span style="background-color: #10b981; color: #000; padding: 2px 4px; border-radius: 3px;">${blackMove}</span>`;
      } else {
        html += blackMove;
      }
    }

    html += ' ';
  }

  pgnElement.innerHTML = html;

  // Scroll to show latest moves
  pgnContainer.scrollLeft = pgnContainer.scrollWidth;
}
