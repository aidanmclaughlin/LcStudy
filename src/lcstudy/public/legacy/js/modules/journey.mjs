/** Matched, equally game-weighted speed/accuracy windows. No elapsed-time substitution. */
export function buildAccuracyJourney(history, windowSize = 25, limit = 100) {
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

export function createJourneyChartConfig(journey, compact = false) {
  const { points, frontier } = journey;
  const latest = points.at(-1);
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 100;
  const padX = Math.max((maxX - minX) * 0.08, 0.2);
  const padY = Math.max((maxY - minY) * 0.08, 0.5);
  return {
    type: 'scatter',
    data: { datasets: [
      { label: 'Latest', data: latest ? [latest] : [], pointRadius: compact ? 4 : 6,
        pointHoverRadius: 8, backgroundColor: '#f4be65', borderColor: '#171b1e', borderWidth: 2 },
      { label: 'Observed frontier', data: frontier, showLine: true, stepped: 'after',
        borderColor: '#60cdb1', backgroundColor: '#60cdb1', borderWidth: 1.5,
        borderDash: [4, 4], pointStyle: 'rectRot', pointRadius: compact ? 2 : 3, pointHoverRadius: 6 },
      { label: 'Journey', data: points, showLine: true, borderColor: '#7da5cf',
        backgroundColor: '#7da5cf', borderWidth: compact ? 1.5 : 2, tension: 0,
        pointRadius: points.length === 1 ? 3 : 0, pointHoverRadius: 5,
        segment: { borderDash: context => context.p1.raw.game - context.p0.raw.game > 1 ? [2, 5] : undefined } },
      { label: 'Start', data: points.length > 1 ? [points[0]] : [], pointRadius: 3,
        backgroundColor: '#171b1e', borderColor: '#7da5cf', borderWidth: 2 }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      layout: { padding: { top: 8, right: 12, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false, backgroundColor: '#20262a', titleColor: '#f0f3f5', bodyColor: '#dce4e8',
          callbacks: {
            title: items => {
              const point = items[0]?.raw;
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
