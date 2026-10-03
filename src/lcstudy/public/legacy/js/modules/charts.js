/**
 * Chart.js initialization and updates.
 * @module charts
 */

import { recentAccuracy } from './journey.mjs';
import { CHART_SCALE_OPTIONS, CHART_TOOLTIP_OPTIONS, ACCURACY_COLORS } from './constants.js';
import { updateMoveFeedback } from './effects.js';
import {
  getMoveAccuracyChart,
  setMoveAccuracyChart,
  getTryScores,
  getGameAccuracy,
  getGameHistory,
  getMoveHistory,
  getCurrentMoveIndex,
  getIsReviewingMoves
} from './state.js';

let lastMoveChartSignature = '';

/**
 * Initialize the in-game move chart.
 * Must be called after Chart.js is loaded.
 */
export function initializeCharts() {
  if (typeof window === 'undefined' || typeof window.Chart === 'undefined') {
    console.error('Chart.js is not available yet. Skipping chart initialization.');
    return;
  }

  initMoveAccuracyChart();
}

/**
 * Initialize the accuracy per move chart (bar chart).
 */
function initMoveAccuracyChart() {
  const ctx = document.getElementById('move-accuracy-chart')?.getContext('2d');
  if (!ctx) return;

  const chart = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Move accuracy',
        data: [],
        backgroundColor: ACCURACY_COLORS.good,
        borderWidth: 0,
        borderRadius: 3,
        // Square bottoms sit on the baseline; a 0% move still shows as a stub.
        borderSkipped: 'start',
        minBarLength: 3,
        barPercentage: 0.78,
        categoryPercentage: 0.9,
        maxBarThickness: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      layout: {
        padding: { left: 0, right: 0, top: 2, bottom: 0 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...CHART_TOOLTIP_OPTIONS,
          displayColors: false,
          callbacks: {
            title: items => items[0].label,
            label: item => `${Number(item.raw).toFixed(1)}% accuracy`
          }
        }
      },
      scales: {
        y: {
          ...CHART_SCALE_OPTIONS,
          min: 0,
          max: 100,
          // Gridlines at 0, 50, and 100% only; no axis labels, so the bars
          // start on the same edge as the panel title.
          ticks: { display: false, stepSize: 50 }
        },
        x: { display: false }
      }
    }
  });

  setMoveAccuracyChart(chart);
}

/**
 * Update in-game progress independently of chart initialization.
 */
export function updateCharts() {
  updateMoveAccuracyChart();
}

let chartsUpdateScheduled = false;

/**
 * Coalesced, deferred chart + stats refresh.
 * Keeps Chart.js work off the move-handling hot path: many calls in one
 * frame collapse into a single update on the next animation frame.
 */
export function scheduleChartsUpdate() {
  if (chartsUpdateScheduled) return;
  chartsUpdateScheduled = true;

  const run = () => {
    chartsUpdateScheduled = false;
    updateCharts();
    updateStatistics();
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.setTimeout(run, 0));
  } else {
    setTimeout(run, 0);
  }
}

/**
 * Update the accuracy bar chart: one bar per try, so the bars average to the
 * game's accuracy.
 */
function updateMoveAccuracyChart() {
  const chart = getMoveAccuracyChart();
  if (!chart) return;

  const tries = getTryScores();

  const moveHistory = getMoveHistory();
  const currentMoveIndex = getCurrentMoveIndex();
  const isReviewingMoves = getIsReviewingMoves();
  const nextSignature = [
    tries.length,
    tries.at(-1)?.accuracy ?? '',
    isReviewingMoves ? currentMoveIndex : -1
  ].join('|');

  if (nextSignature === lastMoveChartSignature) return;
  lastMoveChartSignature = nextSignature;

  // Calculate which user move is currently being reviewed
  let currentUserMoveIndex = -1;
  if (isReviewingMoves && currentMoveIndex >= 0) {
    let userMoveCount = 0;
    for (let i = 0; i <= currentMoveIndex && i < moveHistory.length; i++) {
      if (moveHistory[i].isUserMove) {
        if (i === currentMoveIndex) {
          currentUserMoveIndex = userMoveCount;
        }
        userMoveCount++;
      }
    }
  }

  // Color by accuracy band; while reviewing one of your moves, the other moves' bars dim.
  const colors = tries.map(({ move, accuracy }) => {
    const color = accuracy >= 90 ? ACCURACY_COLORS.good : accuracy >= 65 ? ACCURACY_COLORS.ok : ACCURACY_COLORS.bad;
    const dimmed = isReviewingMoves && currentUserMoveIndex !== -1 && currentUserMoveIndex !== move;
    return dimmed ? `${color}4d` : color;
  });

  // Tooltip titles: "Move 3", or "Move 3 · try 2" for a move that took more than one.
  const triesPerMove = new Map();
  tries.forEach(({ move }) => triesPerMove.set(move, (triesPerMove.get(move) || 0) + 1));
  const seen = new Map();
  chart.data.labels = tries.map(({ move }) => {
    const attempt = (seen.get(move) || 0) + 1;
    seen.set(move, attempt);
    return triesPerMove.get(move) > 1 ? `Move ${move + 1} · try ${attempt}` : `Move ${move + 1}`;
  });
  chart.data.datasets[0].data = tries.map(({ accuracy }) => accuracy);
  chart.data.datasets[0].backgroundColor = colors;

  chart.update('none');
}

/**
 * Reset the move accuracy chart for a new game.
 */
export function resetMoveAccuracyChart() {
  const chart = getMoveAccuracyChart();
  if (!chart) return;

  chart.data.labels = [];
  chart.data.datasets[0].data = [];
  lastMoveChartSignature = '';
  chart.update('none');
}

/**
 * Update the accuracy summary: the 100-game average and this game, both
 * across every try.
 */
export function updateStatistics() {
  const baseline = recentAccuracy(getGameHistory().map(game => ({ accuracy: game.average_accuracy })));
  const gameAccuracy = getGameAccuracy();

  updateMetric('avg-accuracy', baseline, 'Accuracy across every try, averaged over your latest 100 scored games');
  updateMetric('current-accuracy', gameAccuracy, 'Accuracy across every try in this game');
  updateComparison('accuracy-comparison', gameAccuracy, baseline);

  if (gameAccuracy === null) {
    const moveElement = document.getElementById('move-feedback');
    if (moveElement && moveElement.textContent !== 'Loading') updateMoveFeedback(null);
  }
}

function updateMetric(id, value, title) {
  const element = document.getElementById(id);
  if (!element) return;
  const text = value === null ? '--' : `${value.toFixed(1)}%`;
  if (element.textContent !== text) element.textContent = text;
  element.title = title;
}

function updateComparison(id, current, baseline) {
  const element = document.getElementById(id);
  if (!element) return;
  const delta = current === null || baseline === null
    ? 0 : Number(current.toFixed(1)) - Number(baseline.toFixed(1));
  if (delta === 0) {
    delete element.dataset.direction;
    delete element.dataset.tone;
    element.setAttribute('aria-hidden', 'true');
    element.removeAttribute('aria-label');
    element.removeAttribute('title');
    return;
  }
  element.dataset.direction = delta > 0 ? 'up' : 'down';
  element.dataset.tone = delta > 0 ? 'better' : 'worse';
  const description = `Current game: ${current.toFixed(1)}%, ${Math.abs(delta).toFixed(1)} percentage points ${delta > 0 ? 'higher' : 'lower'} than your 100-game average`;
  element.title = description;
  element.setAttribute('aria-label', description);
  element.setAttribute('aria-hidden', 'false');
}
