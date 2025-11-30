/**
 * Visual effects and animations.
 * @module effects
 */

import { CONFETTI_COLORS, CELEBRATION_COLORS } from './constants.js';
import { getCorrectStreak } from './state.js';
import { playSuccessChime, vibrateSuccess } from './audio.js';

/**
 * Flash the board with a colored outline effect.
 * @param {'success' | 'wrong' | 'illegal'} result - Type of feedback to show
 */
export function flashBoard(result) {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  const classMap = {
    success: 'board-flash-green',
    wrong: 'board-shake',
    illegal: 'board-flash-gray'
  };

  const className = classMap[result] || 'board-shake';
  const duration = className === 'board-shake' ? 400 : 300;

  // Remove existing classes and force reflow
  boardEl.classList.remove('board-flash-green', 'board-shake', 'board-flash-gray');
  boardEl.offsetHeight; // Force reflow

  boardEl.classList.add(className);

  setTimeout(() => {
    boardEl.classList.remove(className);
  }, duration);
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
  vibrateSuccess();

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
 * Update the attempts remaining display.
 * @param {number} remaining - Number of attempts left
 */
export function updateAttemptsRemaining(remaining) {
  const attemptsElement = document.getElementById('attempts-remaining');
  if (!attemptsElement) return;

  if (remaining === 0) {
    attemptsElement.textContent = 'auto-play';
    attemptsElement.style.color = '#dc2626';
  } else if (remaining <= 3) {
    attemptsElement.textContent = `${remaining} left`;
    attemptsElement.style.color = '#ef4444';
  } else {
    attemptsElement.textContent = `${remaining} left`;
    attemptsElement.style.color = '#f59e0b';
  }
}
