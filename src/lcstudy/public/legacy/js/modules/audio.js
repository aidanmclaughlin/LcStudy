/**
 * Audio system for sound effects.
 * @module audio
 */

import { getAudioContext, setAudioContext, isSoundEnabled } from './state.js';

/**
 * Get or create the Web Audio API context.
 * @returns {AudioContext|null} The audio context or null if unavailable
 */
export function ensureAudioContext() {
  let ctx = getAudioContext();
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      ctx = new AudioContextClass();
      setAudioContext(ctx);
    }
  }
  return ctx;
}

/**
 * Unlock audio context after user interaction.
 * Required by browsers that suspend audio until user gesture.
 */
export function unlockAudio() {
  try {
    const ctx = ensureAudioContext();
    if (ctx && ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }
  } catch (e) {
    // Silently fail - audio is optional
  }
}

/**
 * Play a two-tone success chime.
 * Uses Web Audio API oscillators for a pleasant ding sound.
 */
export function playSuccessChime() {
  if (!isSoundEnabled()) return;

  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    if (ctx.state !== 'running') {
      try { ctx.resume(); } catch (e) {}
    }

    const now = ctx.currentTime;

    // First tone: 880Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // Second tone: 1320Hz (E6) - delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.12);
    gain2.gain.setValueAtTime(0.0001, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.15, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.34);
  } catch (e) {
    // Silently fail - audio is optional
  }
}

/**
 * Trigger haptic feedback on supported devices.
 * Uses the Vibration API for a short buzz pattern.
 */
export function vibrateSuccess() {
  if (navigator.vibrate) {
    try {
      navigator.vibrate([18, 10, 18]);
    } catch (e) {
      // Silently fail - vibration is optional
    }
  }
}

/**
 * Initialize audio unlock listeners on common user interactions.
 * Should be called once during app bootstrap.
 */
export function initAudioUnlockListeners() {
  const events = ['pointerdown', 'keydown', 'touchstart', 'click'];
  const options = { once: true, passive: true };

  events.forEach(event => {
    try {
      window.addEventListener(event, unlockAudio, options);
    } catch (e) {
      // Silently fail
    }
  });
}
