// Full v2 corpus deployment (a3ce615): policy-ratio and search-based grades are not comparable.
export const SEARCH_GRADING_STARTED_AT = '2026-07-05T07:39:27Z';

export function buildCurrentScoringAccuracy(history, windowSize = 100) {
  const startedAt = Date.parse(SEARCH_GRADING_STARTED_AT);
  return buildRollingAccuracy(history.map(game => (
    new Date(game.playedAt).getTime() >= startedAt ? game.accuracy : null
  )), windowSize);
}

/** Full windows of scored games, preserving game numbers when scores are missing. */
export function buildRollingAccuracy(accuracies, windowSize = 100) {
  if (!Number.isInteger(windowSize) || windowSize < 1) throw new RangeError('Invalid accuracy window');
  const points = [], window = [];
  let sum = 0;
  accuracies.forEach((accuracy, index) => {
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) return;
    window.push(accuracy);
    sum += accuracy;
    if (window.length > windowSize) sum -= window.shift();
    if (window.length === windowSize) points.push({ game: index + 1, accuracy: sum / windowSize });
  });
  return points;
}

/** The latest scored games' accuracy, each game weighted equally; null until there are enough. */
export function recentAccuracy(history, windowSize = 100) {
  const games = [];
  for (let i = history.length - 1; i >= 0 && games.length < windowSize; i--) {
    const { accuracy } = history[i];
    if (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100) games.push(accuracy);
  }
  if (games.length < windowSize) return null;
  return games.reduce((sum, accuracy) => sum + accuracy, 0) / windowSize;
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
