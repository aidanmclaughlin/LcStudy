// Full v2 corpus deployment (a3ce615): policy-ratio and search-based grades are not comparable.
export const SEARCH_GRADING_STARTED_AT = '2026-07-05T07:39:27Z';

// Retry until found (571e246): earlier games had exactly one try per move.
export const RETRIES_STARTED_AT = '2026-10-03T05:35:39Z';

/** Rolling averages and headline accuracy cover at most this many games. */
export const ACCURACY_WINDOW = 100;

export function buildCurrentScoringAccuracy(history, windowSize = ACCURACY_WINDOW) {
  const startedAt = Date.parse(SEARCH_GRADING_STARTED_AT);
  return buildRollingAccuracy(history.map(game => (
    new Date(game.playedAt).getTime() >= startedAt ? game.accuracy : null
  )), windowSize);
}

/**
 * One point per scored game: its own accuracy (score) and the rolling average
 * (accuracy) of up to `windowSize` scored games ending there, so the line
 * starts at the first game. Game numbers are kept when scores are missing.
 */
export function buildRollingAccuracy(accuracies, windowSize = ACCURACY_WINDOW) {
  if (!Number.isInteger(windowSize) || windowSize < 1) throw new RangeError('Invalid accuracy window');
  const points = [], window = [];
  let sum = 0;
  accuracies.forEach((score, index) => {
    if (!Number.isFinite(score) || score < 0 || score > 100) return;
    window.push(score);
    sum += score;
    if (window.length > windowSize) sum -= window.shift();
    points.push({ game: index + 1, score, accuracy: sum / window.length, games: window.length });
  });
  return points;
}

/** The average of the latest scored games (up to `windowSize`, each weighted equally) and how many it covers. */
export function recentAccuracy(history, windowSize = ACCURACY_WINDOW) {
  const scores = [];
  for (let i = history.length - 1; i >= 0 && scores.length < windowSize; i--) {
    const { accuracy } = history[i];
    if (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100) scores.push(accuracy);
  }
  return {
    accuracy: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    games: scores.length
  };
}

/** Round tick spacing (1, 2, 2.5, or 5 times a power of ten) giving about `targetTicks` intervals. */
export function niceStep(span, targetTicks = 4) {
  const raw = span > 0 && Number.isFinite(span) ? span / Math.max(1, targetTicks) : 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** Axis bounds snapped outward to round ticks, so axes never end on values like 83.2%. */
export function niceScale(low, high, { targetTicks = 4, floor = -Infinity, ceiling = Infinity, minSpan = 0 } = {}) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) [low, high] = [0, 1];
  if (high - low < minSpan) {
    const middle = (low + high) / 2;
    [low, high] = [middle - minSpan / 2, middle + minSpan / 2];
  }
  low = Math.max(floor, low);
  high = Math.min(ceiling, high);
  const step = niceStep(high - low, targetTicks);
  const round = value => Number(value.toFixed(10));
  const min = round(Math.max(floor, Math.floor(low / step) * step));
  const max = round(Math.min(ceiling, Math.ceil(high / step) * step));
  const ticks = [];
  for (let index = 0; min + index * step <= max + step / 1e6; index++) ticks.push(round(min + index * step));
  return { min, max, step, ticks };
}
