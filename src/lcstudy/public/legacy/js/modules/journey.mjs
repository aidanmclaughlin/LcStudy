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

/** Home baselines share the latest scored games and weight each game equally. */
export function recentPerformance(history, windowSize = 100) {
  const games = [];
  for (let i = history.length - 1; i >= 0 && games.length < windowSize; i--) {
    const game = history[i];
    if (Number.isFinite(game.accuracy) && game.accuracy >= 0 && game.accuracy <= 100) games.push(game);
  }
  if (games.length < windowSize) return { accuracy: null, secondsPerMove: null };
  const timed = games.every(game => Number.isFinite(game.totalMoves) && game.totalMoves > 0 &&
    Number.isFinite(game.thinkTimeMs) && game.thinkTimeMs > 0);
  return {
    accuracy: games.reduce((sum, game) => sum + game.accuracy, 0) / windowSize,
    secondsPerMove: timed ? games.reduce((sum, game) => sum + game.thinkTimeMs / game.totalMoves / 1000, 0) / windowSize : null
  };
}

/** Matched, equally game-weighted speed/accuracy windows. No elapsed-time substitution. */
export function buildAccuracyJourney(history, windowSize = 100, limit = 100) {
  const windows = [];
  let run = [];
  let timedGames = 0;
  for (let index = 0; index < history.length; index++) {
    const { accuracy, totalMoves, thinkTimeMs } = history[index];
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100 ||
        !Number.isFinite(totalMoves) || totalMoves <= 0 ||
        !Number.isFinite(thinkTimeMs) || thinkTimeMs <= 0) {
      run = [];
      continue;
    }
    timedGames++;
    run.push({ accuracy, seconds: thinkTimeMs / totalMoves / 1000, game: index + 1 });
    if (run.length > windowSize) run.shift();
    if (run.length === windowSize || index === history.length - 1) {
      windows.push({
        x: run.reduce((sum, item) => sum + item.seconds, 0) / run.length,
        y: run.reduce((sum, item) => sum + item.accuracy, 0) / run.length,
        game: index + 1, startGame: run[0].game, games: run.length,
        provisional: run.length < windowSize
      });
    }
  }
  const points = windows.slice(-limit);
  const frontier = paretoFrontier(points.filter(point => !point.provisional));
  return { points, frontier, timedGames, totalGames: history.length, windowSize };
}

/** Lower time and higher accuracy dominate; exact ties keep the newest window. */
export function paretoFrontier(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || b.y - a.y || b.game - a.game);
  let bestAccuracy = -Infinity;
  return sorted.filter(point => {
    if (point.y <= bestAccuracy) return false;
    bestAccuracy = point.y;
    return true;
  });
}

/** Live coordinates use the same submitted moves for accuracy and thinking time. */
export function buildCurrentGamePoint(accuracies, moveTimesMs) {
  if (!accuracies.length || accuracies.length !== moveTimesMs.length ||
      accuracies.some(value => !Number.isFinite(value) || value < 0 || value > 100) ||
      moveTimesMs.some(value => !Number.isFinite(value) || value < 0)) return null;
  const thinkTimeMs = moveTimesMs.reduce((sum, value) => sum + value, 0);
  if (thinkTimeMs <= 0) return null;
  return {
    x: thinkTimeMs / accuracies.length / 1000,
    y: accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length,
    moves: accuracies.length, currentGame: true
  };
}

export function journeyColor(progress) {
  const t = Math.max(0, Math.min(1, progress));
  const older = [101, 127, 153], newer = [244, 190, 101];
  return `rgb(${older.map((channel, index) => Math.round(channel + (newer[index] - channel) * t)).join(', ')})`;
}

/** Space direction cues through time, excluding gaps and overlapping screen positions. */
export function journeyArrows(points, pixels, compact = false) {
  if (points.length < 2) return [];
  const span = points.at(-1).game - points[0].game;
  if (span <= 0) return [];
  const candidates = [];
  for (let index = 1; index < points.length; index++) {
    const from = pixels[index - 1], to = pixels[index];
    if (!from || !to || points[index].game - points[index - 1].game !== 1) continue;
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1) continue;
    candidates.push({
      x: (from.x + to.x) / 2, y: (from.y + to.y) / 2,
      dx: dx / length, dy: dy / length,
      progress: ((points[index - 1].game + points[index].game) / 2 - points[0].game) / span
    });
  }
  const arrows = [];
  const count = Math.min(compact ? 3 : 5, candidates.length);
  for (let index = 0; index < count; index++) {
    const target = (index + 0.5) / count;
    let closest = null;
    for (const candidate of candidates) {
      if (arrows.some(arrow => Math.hypot(arrow.x - candidate.x, arrow.y - candidate.y) < 28)) continue;
      if (!closest || Math.abs(candidate.progress - target) < Math.abs(closest.progress - target)) closest = candidate;
    }
    if (closest) arrows.push(closest);
  }
  return arrows;
}

export function createJourneyChartConfig(journey, compact = false, currentGame = null) {
  const { points, frontier } = journey;
  const latest = points.at(-1);
  const plotted = currentGame ? [...points, currentGame] : points;
  const xs = plotted.map(point => point.x);
  const ys = plotted.map(point => point.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 100;
  const padX = Math.max((maxX - minX) * 0.08, 0.2);
  const padY = Math.max((maxY - minY) * 0.08, 0.5);
  const progressAt = game => points.length > 1 ? (game - points[0].game) / (latest.game - points[0].game) : 1;
  return {
    type: 'scatter',
    plugins: [{
      id: 'journey-direction',
      afterDatasetDraw(chart, { index, meta }) {
        const dataset = chart.data.datasets[index];
        if (dataset.label !== 'Journey') return;
        const arrows = journeyArrows(dataset.data, meta.data, compact);
        const { ctx } = chart;
        const size = compact ? 4 : 6;
        ctx.save();
        ctx.lineWidth = compact ? 1.5 : 2;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const arrow of arrows) {
          const tipX = arrow.x + arrow.dx * size / 2, tipY = arrow.y + arrow.dy * size / 2;
          const backX = tipX - arrow.dx * size, backY = tipY - arrow.dy * size;
          ctx.strokeStyle = journeyColor(arrow.progress);
          ctx.beginPath();
          ctx.moveTo(backX - arrow.dy * size * 0.65, backY + arrow.dx * size * 0.65);
          ctx.lineTo(tipX, tipY);
          ctx.lineTo(backX + arrow.dy * size * 0.65, backY - arrow.dx * size * 0.65);
          ctx.stroke();
        }
        ctx.restore();
      }
    }],
    data: { datasets: [
      { label: 'Current game', data: currentGame ? [currentGame] : [], pointStyle: 'triangle',
        pointRadius: compact ? 6 : 8, pointHoverRadius: 10,
        backgroundColor: '#eba5ac', borderColor: '#171b1e', borderWidth: 2 },
      { label: 'Latest', data: latest ? [latest] : [], pointRadius: compact ? 4 : 6,
        pointHoverRadius: 8, backgroundColor: '#f4be65', borderColor: '#171b1e', borderWidth: 2 },
      { label: 'Observed frontier', data: frontier, showLine: true, stepped: 'after',
        borderColor: '#60cdb1', backgroundColor: '#60cdb1', borderWidth: 1.5,
        borderDash: [4, 4], pointStyle: 'rectRot', pointRadius: compact ? 2 : 3, pointHoverRadius: 6 },
      { label: 'Journey', data: points, showLine: true, borderColor: journeyColor(0),
        backgroundColor: journeyColor(0), borderWidth: compact ? 1.5 : 2, tension: 0,
        borderCapStyle: 'round', borderJoinStyle: 'round',
        pointRadius: points.length === 1 ? 3 : 0, pointHoverRadius: 5,
        segment: {
          borderColor: context => journeyColor(progressAt((context.p0.raw.game + context.p1.raw.game) / 2)),
          borderDash: context => context.p1.raw.game - context.p0.raw.game > 1 ? [2, 5] : undefined
        } },
      { label: 'Start', data: points.length > 1 ? [points[0]] : [], pointRadius: 3,
        backgroundColor: '#171b1e', borderColor: journeyColor(0), borderWidth: 2 }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      datasets: { scatter: { clip: 10 } },
      interaction: { mode: 'nearest', intersect: false },
      layout: { padding: { top: 8, right: 12, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false, backgroundColor: '#20262a', titleColor: '#f0f3f5', bodyColor: '#dce4e8',
          callbacks: {
            title: items => {
              const point = items[0]?.raw;
              if (point?.currentGame) return `Current game / ${point.moves} ${point.moves === 1 ? 'move' : 'moves'}`;
              return point ? `Games ${point.startGame}-${point.game}${point.provisional ? ' (provisional)' : ''}` : '';
            },
            label: context => `${context.raw.y.toFixed(1)}% accuracy / ${context.raw.x.toFixed(2)}s per move`
          }
        }
      },
      scales: {
        x: { type: 'linear', min: Math.max(0, minX - padX), max: maxX + padX,
          title: { display: true, text: compact ? 'Thinking seconds / move' : 'Thinking seconds per move', color: '#9ba9b2', font: { size: compact ? 10 : 12 } },
          grid: { color: 'rgba(170,190,200,0.08)' }, border: { display: false },
          ticks: { color: '#9ba9b2', maxTicksLimit: compact ? 4 : 7, font: { size: compact ? 10 : 12 }, callback: value => `${Number(value.toFixed(2))}s` } },
        y: { min: Math.max(0, minY - padY), max: Math.min(100, maxY + padY),
          title: { display: !compact, text: 'Accuracy', color: '#9ba9b2' },
          grid: { color: 'rgba(170,190,200,0.12)' }, border: { display: false },
          ticks: { color: '#9ba9b2', maxTicksLimit: 5, font: { size: compact ? 10 : 12 }, callback: value => `${Number(value.toFixed(1))}%` } }
      }
    }
  };
}
