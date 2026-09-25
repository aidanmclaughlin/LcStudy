/**
 * Chart.js initialization and updates.
 * @module charts
 */

import { buildCurrentGamePoint, recentPerformance } from './journey.mjs';
import { getMoveTimesMs } from './timeclock.js';
import { CHART_SCALE_OPTIONS, CHART_TOOLTIP_OPTIONS, ACCURACY_COLORS } from './constants.js';
import { updateMoveFeedback } from './effects.js';
import {
  getMoveAccuracyChart,
  setMoveAccuracyChart,
  getMoveAccuracies,
  getGameHistory,
  getMoveHistory,
  getCurrentMoveIndex,
  getIsReviewingMoves
} from './state.js';

let lastCurrentGameSignature = '';
let lastMoveChartSignature = '';
function publishCurrentGame(force = false) {
  const point = buildCurrentGamePoint(getMoveAccuracies(), getMoveTimesMs());
  const signature = JSON.stringify(point);
  if (!force && signature === lastCurrentGameSignature) return;
  lastCurrentGameSignature = signature;
  window.dispatchEvent(new CustomEvent('lcstudy:current-game', { detail: point }));
}

window.addEventListener('lcstudy:stats-visibility', event => {
  if (event.detail?.open) publishCurrentGame(true);
});

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
        padding: { left: 0, right: 2, top: 8, bottom: 0 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...CHART_TOOLTIP_OPTIONS,
          displayColors: false,
          callbacks: {
            title: items => `Move ${items[0].dataIndex + 1}`,
            label: item => `${Number(item.raw).toFixed(1)}% accuracy`
          }
        }
      },
      scales: {
        y: {
          ...CHART_SCALE_OPTIONS,
          min: 0,
          max: 100,
          ticks: {
            ...CHART_SCALE_OPTIONS.ticks,
            stepSize: 50,
            callback: value => `${value}%`
          }
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
  publishCurrentGame();
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
 * Update the accuracy per move bar chart.
 */
function updateMoveAccuracyChart() {
  const chart = getMoveAccuracyChart();
  if (!chart) return;

  const moveAccuracies = getMoveAccuracies();

  const moveHistory = getMoveHistory();
  const currentMoveIndex = getCurrentMoveIndex();
  const isReviewingMoves = getIsReviewingMoves();
  const nextSignature = [
    moveAccuracies.length,
    moveAccuracies.at(-1) ?? '',
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

  // Color by accuracy band; while reviewing one of your moves, the other bars dim.
  const colors = moveAccuracies.map((accuracy, index) => {
    const color = accuracy >= 90 ? ACCURACY_COLORS.good : accuracy >= 65 ? ACCURACY_COLORS.ok : ACCURACY_COLORS.bad;
    const dimmed = isReviewingMoves && currentUserMoveIndex !== -1 && currentUserMoveIndex !== index;
    return dimmed ? `${color}4d` : color;
  });

  chart.data.labels = moveAccuracies.map((_, index) => String(index + 1));
  chart.data.datasets[0].data = moveAccuracies;
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
 * Update the statistics display.
 */
export function updateStatistics() {
  const moveAccuracies = getMoveAccuracies();
  const baseline = recentPerformance(getGameHistory().map(game => ({
    accuracy: game.average_accuracy,
    totalMoves: game.total_moves,
    thinkTimeMs: game.think_time_ms
  })));
  const gameAccuracy = moveAccuracies.length
    ? moveAccuracies.reduce((sum, value) => sum + value, 0) / moveAccuracies.length
    : null;
  const current = buildCurrentGamePoint(moveAccuracies, getMoveTimesMs());

  updateMetric('avg-accuracy', baseline.accuracy, 1, '%',
    'Mean accuracy of your latest 100 scored games');
  updateMetric('avg-move-time', baseline.secondsPerMove, 2, 's',
    'Thinking seconds per move, averaged equally across your latest 100 scored games');
  updateMetric('game-accuracy', gameAccuracy, 1, '%', 'Current game accuracy');
  updateMetric('current-accuracy', gameAccuracy, 1, '%', 'Current game accuracy');
  updateMetric('current-move-time', current?.x ?? null, 2, 's', 'Mean thinking seconds per move in this game');
  updateComparison('accuracy-comparison', gameAccuracy, baseline.accuracy, false, 1);
  updateComparison('pace-comparison', current?.x ?? null, baseline.secondsPerMove, true, 2);

  if (moveAccuracies.length === 0) {
    const moveElement = document.getElementById('move-feedback');
    if (moveElement && moveElement.textContent !== 'Loading') updateMoveFeedback(null);
  }
}

function updateMetric(id, value, digits, unit, title) {
  const element = document.getElementById(id);
  if (!element) return;
  const text = value === null ? '--' : `${value.toFixed(digits)}${unit}`;
  if (element.textContent !== text) element.textContent = text;
  element.title = title;
}

function updateComparison(id, current, baseline, lowerIsBetter, digits) {
  const element = document.getElementById(id);
  if (!element) return;
  const delta = current === null || baseline === null
    ? 0 : Number(current.toFixed(digits)) - Number(baseline.toFixed(digits));
  if (delta === 0) {
    delete element.dataset.direction;
    delete element.dataset.tone;
    element.setAttribute('aria-hidden', 'true');
    element.removeAttribute('aria-label');
    element.removeAttribute('title');
    return;
  }
  element.dataset.direction = delta > 0 ? 'up' : 'down';
  element.dataset.tone = (lowerIsBetter ? delta < 0 : delta > 0) ? 'better' : 'worse';
  const comparison = lowerIsBetter ? (delta < 0 ? 'faster' : 'slower') : (delta > 0 ? 'higher' : 'lower');
  const unit = lowerIsBetter ? 's per move' : ' percentage points';
  const description = `Current game: ${current.toFixed(digits)}${lowerIsBetter ? 's per move' : '%'}, ${Math.abs(delta).toFixed(digits)}${unit} ${comparison} than your 100-game average`;
  element.title = description;
  element.setAttribute('aria-label', description);
  element.setAttribute('aria-hidden', 'false');
}
