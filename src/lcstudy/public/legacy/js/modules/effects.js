/**
 * Visual effects and animations.
 * @module effects
 */

import { CONFETTI_COLORS, CELEBRATION_COLORS } from './constants.js';
import { accuracyColor } from './colors.mjs';
import { playSuccessChime } from './audio.js';
import { getGameAccuracy, getMoveAccuracies } from './state.js';

const BOARD_FLASH_CLASSES = ['board-flash-green', 'board-shake', 'board-flash-gray'];
let boardFlashFrame = 0;
let boardFlashTimer = 0;

export function showCompletionOverlay(result = 'Checkmate') {
  const overlay = document.getElementById('completion-overlay');
  if (!overlay) return;

  const titleEl = document.getElementById('completion-title');
  if (titleEl) titleEl.textContent = result;
  overlay.dataset.result = result === 'Checkmate' ? 'mate' : 'over';

  // The game's accuracy across every try, and how many moves it covered.
  const summaryEl = document.getElementById('completion-summary');
  if (summaryEl) {
    const accuracy = getGameAccuracy();
    const moves = getMoveAccuracies().length;
    summaryEl.textContent = accuracy === null
      ? ''
      : `${accuracy.toFixed(1)}% · ${moves} ${moves === 1 ? 'move' : 'moves'}`;
  }

  overlay.hidden = false;
  overlay.removeAttribute('inert');
  overlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    overlay.classList.add('is-visible');
    // Enter or Space starts the next game straight away.
    if (!document.getElementById('stats-dialog')?.open) {
      document.getElementById('completion-new')?.focus({ preventScroll: true });
    }
  });
}

export function hideCompletionOverlay() {
  const overlay = document.getElementById('completion-overlay');
  if (!overlay) return;

  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('inert', '');

  window.setTimeout(() => {
    if (!overlay.classList.contains('is-visible')) {
      overlay.hidden = true;
    }
  }, 180);
}

/**
 * Shake strength for a move that wasn't Leela's, in proportion to how far
 * below 100% it scored.
 * @param {number} accuracy - Move accuracy percentage
 * @returns {number} 0..1
 */
export function inaccuracyIntensity(accuracy) {
  return Math.max(0, Math.min(1, (100 - Number(accuracy || 0)) / 100));
}

/**
 * Flash the board with a colored outline effect.
 * @param {'success' | 'wrong' | 'illegal'} result - Type of feedback to show
 * @param {number} intensity - 0..1 for wrong feedback; the shake's distance,
 *   tilt, and length grow linearly with it
 */
export function flashBoard(result, intensity = 1) {
  const boardEl = document.getElementById('board');
  if (!boardEl) return 0;

  const classMap = {
    success: 'board-flash-green',
    wrong: 'board-shake',
    illegal: 'board-flash-gray'
  };

  const className = classMap[result] || 'board-shake';
  const force = Math.max(0, Math.min(1, Number(intensity) || 0));
  const duration = className === 'board-shake' ? 240 + force * 520 : 300;

  boardEl.style.setProperty('--shake-distance', `${2 + force * 30}px`);
  boardEl.style.setProperty('--shake-y', `${force * 4.8}px`);
  boardEl.style.setProperty('--shake-twist', `${force * 1.4}deg`);
  boardEl.style.setProperty('--shake-duration', `${duration}ms`);

  const isRestart = BOARD_FLASH_CLASSES.some((name) => boardEl.classList.contains(name));
  if (boardFlashFrame) cancelAnimationFrame(boardFlashFrame);
  if (boardFlashTimer) clearTimeout(boardFlashTimer);
  boardEl.classList.remove(...BOARD_FLASH_CLASSES);

  const startAnimation = () => {
    boardFlashFrame = 0;
    boardEl.classList.add(className);
    boardFlashTimer = window.setTimeout(() => {
      boardFlashTimer = 0;
      boardEl.classList.remove(className);
    }, duration);
  };

  if (isRestart) {
    boardFlashFrame = requestAnimationFrame(() => {
      boardFlashFrame = requestAnimationFrame(startAnimation);
    });
  } else {
    startAnimation();
  }

  return duration;
}

/**
 * Show a pulsing ring effect on a square.
 * @param {string} square - Square identifier (e.g., 'e4')
 */
export function successPulseAtSquare(square) {
  const el = document.querySelector(`[data-square="${square}"]`);
  if (!el) return;

  const hit = document.createElement('div');
  hit.className = 'hit';
  el.appendChild(hit);

  setTimeout(() => {
    try { el.removeChild(hit); } catch (e) {}
  }, 420);
}

/**
 * Create a burst of confetti particles at a point.
 * @param {number} x - X coordinate (viewport)
 * @param {number} y - Y coordinate (viewport)
 * @param {number} [count=16] - Number of particles
 */
export function createConfettiBurst(x, y, count = 16) {
  const fragment = document.createDocumentFragment();
  const particles = [];

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.className = 'confetti-burst';
    particle.style.left = (x - 4) + 'px';
    particle.style.top = (y - 4) + 'px';
    particle.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];

    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 70;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;

    particle.style.setProperty('--dx', dx + 'px');
    particle.style.setProperty('--dy', dy + 'px');

    particles.push(particle);
    fragment.appendChild(particle);
  }

  document.body.appendChild(fragment);
  setTimeout(() => particles.forEach((particle) => particle.remove()), 700);
}

/**
 * Create a gold shimmer sweep effect on the board.
 * Used for "jackpot" moments (7% chance on correct move).
 */
export function shimmerJackpot() {
  const board = document.getElementById('board');
  if (!board) return;

  const overlay = document.createElement('div');
  overlay.className = 'shimmer-overlay';
  board.appendChild(overlay);

  setTimeout(() => {
    try { board.removeChild(overlay); } catch (e) {}
  }, 560);
}

/**
 * Full celebration effect for a correct move.
 * Combines pulse, confetti, sound, and haptics.
 * @param {string} toSquare - Destination square of the move
 */
export function celebrateSuccess(toSquare) {
  successPulseAtSquare(toSquare);

  const el = document.querySelector(`[data-square="${toSquare}"]`);
  let centerX = null;
  let centerY = null;
  if (el) {
    const rect = el.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    createConfettiBurst(centerX, centerY, 16);
  }

  playSuccessChime();

  // 7% chance of jackpot shimmer with extra confetti
  if (Math.random() < 0.07) {
    shimmerJackpot();
    if (centerX !== null && centerY !== null) {
      createConfettiBurst(centerX, centerY, 24);
    }
  }
}

/**
 * Create a larger but short-lived celebration when the mating move lands.
 * @param {string} toSquare - Destination square of the checkmate move
 */
export function celebrateCheckmate(toSquare) {
  const el = document.querySelector(`[data-square="${toSquare}"]`);
  if (el) {
    const rect = el.getBoundingClientRect();
    createConfettiBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 36);
  }

  createCelebrationConfetti(90);
  showCompletionOverlay();
}

/**
 * Create full-screen falling confetti for game completion.
 * @param {number} [count=150] - Number of confetti pieces
 */
export function createCelebrationConfetti(count = 150) {
  const fragment = document.createDocumentFragment();
  const pieces = [];

  for (let i = 0; i < count; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + 'vw';
    confetti.style.backgroundColor = CELEBRATION_COLORS[Math.floor(Math.random() * CELEBRATION_COLORS.length)];

    const size = Math.random() * 10 + 5;
    confetti.style.width = size + 'px';
    confetti.style.height = size + 'px';
    confetti.style.animationDelay = Math.random() * 0.5 + 's';
    confetti.style.animationDuration = Math.random() * 2 + 2 + 's';

    pieces.push(confetti);
    fragment.appendChild(confetti);
  }

  document.body.appendChild(fragment);
  setTimeout(() => pieces.forEach((confetti) => confetti.remove()), 4000);
}

/**
 * Clear any visible move accuracy burst.
 */
export function clearAccuracyBursts() {
  document.querySelectorAll('.accuracy-burst').forEach((burst) => {
    try { burst.remove(); } catch (e) {}
  });
}

/**
 * Show a large accuracy percentage over the board after a scored move.
 * @param {number} accuracy - Move accuracy percentage
 */
export function showAccuracyBurst(accuracy) {
  const board = document.getElementById('board');
  if (!board) return;

  clearAccuracyBursts();

  const numeric = Math.max(0, Math.min(100, Number(accuracy) || 0));
  const rect = board.getBoundingClientRect();
  const burst = document.createElement('div');
  const color = accuracyColor(numeric);

  burst.className = 'accuracy-burst';
  burst.textContent = `${numeric.toFixed(0)}%`;
  burst.style.setProperty('--accuracy-burst-x', `${rect.left + rect.width / 2}px`);
  burst.style.setProperty('--accuracy-burst-y', `${rect.top + rect.height / 2}px`);
  burst.style.setProperty('--accuracy-burst-color', color);
  burst.style.setProperty('--accuracy-burst-glow', `${color}99`);

  document.body.appendChild(burst);

  setTimeout(() => {
    try { burst.remove(); } catch (e) {}
  }, 1240);
}

/**
 * Update the move feedback display.
 * @param {Object} result - Move score result
 */
export function updateMoveFeedback(result = null) {
  const feedbackElement = document.getElementById('move-feedback');
  if (!feedbackElement) return;

  const show = (text, tone) => {
    feedbackElement.textContent = text;
    feedbackElement.dataset.tone = tone;
  };

  if (!result) return show('--', 'muted');
  if (result.loading) return show('Loading', 'muted');
  if (result.error) return show('Retry', 'error');
  if (result.illegal) return show('Illegal move', 'muted');

  const accuracy = Number(result.accuracy || 0);
  feedbackElement.style.setProperty('--accuracy-color', accuracyColor(accuracy));
  show(`${accuracy.toFixed(1)}%`, 'accuracy');
}
