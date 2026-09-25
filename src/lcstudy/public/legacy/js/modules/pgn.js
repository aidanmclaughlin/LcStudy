/**
 * Move list and review controls.
 * @module pgn
 */

import {
  getPgnMoves,
  getIsReviewingMoves,
  getCurrentMoveIndex
} from './state.js';

let scrollListenerAttached = false;

/**
 * Render the move list, keeping the reviewed move (or the latest move) in view.
 */
export function updatePgnDisplay() {
  const pgnElement = document.getElementById('move-list');
  const pgnContainer = document.getElementById('pgn-moves');

  if (!pgnElement || !pgnContainer) return;

  const pgnMoves = getPgnMoves();
  const currentIndex = getIsReviewingMoves() ? getCurrentMoveIndex() : -1;
  updateReviewControls(pgnMoves.length, currentIndex);

  if (pgnMoves.length === 0) {
    pgnElement.innerHTML = '<span class="pgn-empty">No moves yet</span>';
    pgnContainer.classList.remove('is-clipped');
    return;
  }

  const token = (ply) => (
    `<span class="pgn-move${ply === currentIndex ? ' is-current' : ''}" data-ply="${ply}">${escapeHtml(pgnMoves[ply])}</span>`
  );

  let html = '';
  for (let ply = 0; ply < pgnMoves.length; ply += 2) {
    html += `<span class="pgn-pair"><span class="pgn-num">${ply / 2 + 1}.</span>${token(ply)}${ply + 1 < pgnMoves.length ? token(ply + 1) : ''}</span>`;
  }
  pgnElement.innerHTML = html;

  const current = currentIndex >= 0 ? pgnElement.querySelector('.is-current') : null;
  if (current) {
    // Scroll only the list, never the page.
    const box = pgnContainer.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.top < box.top) pgnContainer.scrollTop -= box.top - item.top + 2;
    else if (item.bottom > box.bottom) pgnContainer.scrollTop += item.bottom - box.bottom + 2;
  } else {
    pgnContainer.scrollTop = pgnContainer.scrollHeight;
  }

  if (!scrollListenerAttached) {
    scrollListenerAttached = true;
    pgnContainer.addEventListener('scroll', () => updateClipMask(pgnContainer), { passive: true });
    // Layout changes (rotation, resizing) keep the live list pinned to the latest move.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        if (!getIsReviewingMoves()) pgnContainer.scrollTop = pgnContainer.scrollHeight;
        updateClipMask(pgnContainer);
      }).observe(pgnContainer);
    }
  }
  updateClipMask(pgnContainer);
}

/** Fade the top edge when earlier moves are scrolled out of view. */
function updateClipMask(container) {
  container.classList.toggle('is-clipped', container.scrollTop > 1);
}

function updateReviewControls(total, currentIndex) {
  const reviewing = currentIndex >= 0;
  const prev = document.getElementById('review-prev');
  const next = document.getElementById('review-next');
  const exit = document.getElementById('review-exit');

  if (prev) prev.disabled = total === 0 || currentIndex === 0;
  if (next) next.disabled = !reviewing;
  if (exit) exit.hidden = !reviewing;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
