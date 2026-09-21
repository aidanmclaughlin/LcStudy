/** Active practice and prompt clocks share pause reasons, including Stats and review. */
let gameActive = false;
let promptActive = false;
let lastTick = 0;
let gameElapsed = 0;
let promptElapsed = 0;
let moveTimesMs = [];
const pauses = new Set();
const now = () => performance.now();

function tick() {
  const time = now();
  const elapsed = Math.max(0, time - lastTick);
  if (pauses.size === 0) {
    if (gameActive) gameElapsed += elapsed;
    if (promptActive) promptElapsed += elapsed;
  }
  lastTick = time;
}

export function setClockPaused(reason, paused) {
  tick();
  if (paused) pauses.add(reason);
  else pauses.delete(reason);
}

export function isStatsOpen() { return pauses.has('stats'); }

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    setClockPaused('hidden', document.visibilityState === 'hidden');
  });
  window.addEventListener('lcstudy:stats-visibility', event => {
    setClockPaused('stats', event.detail.open);
  });
}

export function startGameClock() {
  lastTick = now();
  gameActive = true;
  promptActive = false;
  gameElapsed = 0;
  promptElapsed = 0;
  moveTimesMs = [];
  pauses.delete('review');
  setClockPaused('hidden', document.visibilityState === 'hidden');
  setClockPaused('stats', Boolean(document.getElementById('stats-dialog')?.open));
}

export function endGameClock() {
  tick();
  gameActive = false;
  promptActive = false;
}

export function promptBegin() {
  if (!gameActive || promptActive) return;
  tick();
  promptActive = true;
  promptElapsed = 0;
}

export function promptSubmit() {
  if (!promptActive) return null;
  tick();
  const elapsed = Math.round(promptElapsed);
  moveTimesMs.push(elapsed);
  promptActive = false;
  return elapsed;
}

export function getGameDurationMs() { tick(); return Math.round(gameElapsed); }
export function getMoveTimesMs() { return [...moveTimesMs]; }
export function getThinkTimeMs() { return moveTimesMs.reduce((sum, value) => sum + value, 0); }
export function getLiveThinkTimeMs() {
  tick();
  return getThinkTimeMs() + (promptActive ? promptElapsed : 0);
}
export function isPromptActive() { return promptActive; }
