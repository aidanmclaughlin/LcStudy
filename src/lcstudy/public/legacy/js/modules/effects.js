/**
 * Visual effects and animations.
 * @module effects
 */

import { CONFETTI_COLORS, CELEBRATION_COLORS } from './constants.js';
import { getCorrectStreak } from './state.js';
import { playSuccessChime } from './audio.js';

function accuracyTone(accuracy) {
  if (accuracy >= 90) {
    return { color: '#22c55e', glow: 'rgba(34, 197, 94, 0.58)' };
  }

  if (accuracy >= 65) {
    return { color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.58)' };
  }

  return { color: '#ef4444', glow: 'rgba(239, 68, 68, 0.62)' };
}

/**
 * Flash the board with a colored outline effect.
 * @param {'success' | 'wrong' | 'illegal'} result - Type of feedback to show
 * @param {number} intensity - 0..1 intensity for wrong feedback
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
  const clampedIntensity = Math.max(0, Math.min(1, Number(intensity) || 0));
  const force = Math.pow(clampedIntensity, 1.35);
  const duration = className === 'board-shake' ? 240 + force * 520 : 300;

  boardEl.style.setProperty('--shake-distance', `${2 + force * 30}px`);
  boardEl.style.setProperty('--shake-y', `${force * 4.8}px`);
  boardEl.style.setProperty('--shake-twist', `${force * 1.4}deg`);
  boardEl.style.setProperty('--shake-duration', `${duration}ms`);

  // Remove existing classes and force reflow
  boardEl.classList.remove('board-flash-green', 'board-shake', 'board-flash-gray');
  boardEl.offsetHeight; // Force reflow

  boardEl.classList.add(className);

  setTimeout(() => {
    boardEl.classList.remove(className);
  }, duration);

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

    document.body.appendChild(particle);

    setTimeout(() => {
      try { document.body.removeChild(particle); } catch (e) {}
    }, 700);
  }
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
 * Show/update the streak pill display.
 */
export function showStreakPill() {
  const pill = document.getElementById('streak-pill');
  if (!pill) return;

  const streak = getCorrectStreak();

  if (streak >= 2) {
    pill.textContent = `Streak x${streak}`;
    pill.classList.add('show', 'streak-pop');
    setTimeout(() => pill.classList.remove('streak-pop'), 320);
  } else {
    pill.classList.remove('show');
  }
}

/**
 * Full celebration effect for a correct move.
 * Combines pulse, confetti, sound, and haptics.
 * @param {string} toSquare - Destination square of the move
 */
export function celebrateSuccess(toSquare) {
  successPulseAtSquare(toSquare);

  const el = document.querySelector(`[data-square="${toSquare}"]`);
  if (el) {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    createConfettiBurst(centerX, centerY, 16);
  }

  playSuccessChime();

  // 7% chance of jackpot shimmer with extra confetti
  if (Math.random() < 0.07) {
    shimmerJackpot();
    if (el) {
      const rect = el.getBoundingClientRect();
      createConfettiBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 24);
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
}

/**
 * Create full-screen falling confetti for game completion.
 * @param {number} [count=150] - Number of confetti pieces
 */
export function createCelebrationConfetti(count = 150) {
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

    document.body.appendChild(confetti);

    setTimeout(() => {
      if (confetti.parentNode) {
        confetti.parentNode.removeChild(confetti);
      }
    }, 4000);
  }
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
  const tone = accuracyTone(numeric);

  burst.className = 'accuracy-burst';
  burst.textContent = `${numeric.toFixed(0)}%`;
  burst.style.setProperty('--accuracy-burst-x', `${rect.left + rect.width / 2}px`);
  burst.style.setProperty('--accuracy-burst-y', `${rect.top + rect.height / 2}px`);
  burst.style.setProperty('--accuracy-burst-color', tone.color);
  burst.style.setProperty('--accuracy-burst-glow', tone.glow);

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

  if (!result) {
    feedbackElement.textContent = 'Pick move';
    feedbackElement.style.color = '#94a3b8';
    feedbackElement.classList.add('stat-value--muted');
    return;
  }

  if (result.illegal) {
    feedbackElement.textContent = 'Illegal move';
    feedbackElement.style.color = '#94a3b8';
    feedbackElement.classList.add('stat-value--muted');
    return;
  }

  if (result.bestMoveSan || result.bestMoveUci) {
    feedbackElement.textContent = `Best: ${result.bestMoveSan || result.bestMoveUci}`;
    feedbackElement.style.color = '#f59e0b';
    feedbackElement.classList.remove('stat-value--muted');
    return;
  }

  const accuracy = Number(result.accuracy || 0);
  const tone = accuracyTone(accuracy);

  feedbackElement.textContent = `${accuracy.toFixed(1)}%`;
  feedbackElement.style.color = tone.color;
  feedbackElement.classList.remove('stat-value--muted');
}
