/**
 * Think-time measurement.
 *
 * Measures deliberation time per prompt: the clock runs from the moment a
 * position is ready for input until the guess is submitted, pauses while the
 * tab is hidden, and excludes move-playback dead time (animations, reveals).
 * Recorded silently with each game (think_time_ms / move_times_ms) so pace
 * can be analyzed offline; no UI depends on it.
 *
 * @module timeclock
 */

let gameActive = false;
let promptActive = false;
let promptStartedAtMs = 0;
let hiddenAccumMs = 0;
let hiddenSinceMs = null;
let moveTimesMs = [];

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!promptActive) return;

    if (document.visibilityState === 'hidden') {
      hiddenSinceMs = now();
    } else if (hiddenSinceMs !== null) {
      hiddenAccumMs += now() - hiddenSinceMs;
      hiddenSinceMs = null;
    }
  });
}

/** Reset the clock for a new game. */
export function startGameClock() {
  gameActive = true;
  promptActive = false;
  moveTimesMs = [];
  hiddenAccumMs = 0;
  hiddenSinceMs = null;
}

/** Stop the clock at game end. */
export function endGameClock() {
  gameActive = false;
  promptActive = false;
  hiddenSinceMs = null;
}

/** Start timing a prompt (position ready, user to move). */
export function promptBegin() {
  if (!gameActive || promptActive) return;

  promptActive = true;
  promptStartedAtMs = now();
  hiddenAccumMs = 0;
  hiddenSinceMs = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    ? promptStartedAtMs
    : null;
}

/**
 * Stop timing the current prompt and record the elapsed think time.
 * @returns {number|null} Elapsed ms, or null if no prompt was active
 */
export function promptSubmit() {
  if (!promptActive) return null;

  let hidden = hiddenAccumMs;
  if (hiddenSinceMs !== null) {
    hidden += now() - hiddenSinceMs;
    hiddenSinceMs = null;
  }

  const elapsed = Math.max(0, Math.round(now() - promptStartedAtMs - hidden));
  moveTimesMs.push(elapsed);
  promptActive = false;

  return elapsed;
}

/** Per-move think times recorded so far this game. */
export function getMoveTimesMs() {
  return [...moveTimesMs];
}

/** Total recorded think time this game (completed prompts only). */
export function getThinkTimeMs() {
  return moveTimesMs.reduce((sum, value) => sum + value, 0);
}

/**
 * Total think time including the live prompt, for ticking displays.
 * @returns {number} Milliseconds
 */
export function getLiveThinkTimeMs() {
  let total = getThinkTimeMs();

  if (promptActive) {
    let hidden = hiddenAccumMs;
    if (hiddenSinceMs !== null) {
      hidden += now() - hiddenSinceMs;
    }
    total += Math.max(0, now() - promptStartedAtMs - hidden);
  }

  return total;
}

/** Whether a prompt is currently being timed. */
export function isPromptActive() {
  return promptActive;
}
