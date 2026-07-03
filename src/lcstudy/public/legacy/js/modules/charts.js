/**
 * Chart.js initialization and updates.
 * @module charts
 */

import { CHART_SCALE_OPTIONS, CHART_TOOLTIP_OPTIONS } from './constants.js';
import {
  getAccuracyChart,
  setAccuracyChart,
  getMoveAccuracyChart,
  setMoveAccuracyChart,
  getMoveAccuracies,
  getGameHistory,
  getMoveHistory,
  getCurrentMoveIndex,
  getIsReviewingMoves
} from './state.js';

let lastAccuracyChartSignature = '';
let lastMoveChartSignature = '';
const chartHeadingCounts = {};
const GM_ACCURACY_TARGET = 90;
const GM_ACCURACY_CEILING = 95;
const GM_ACCURACY_EXPONENT = 0.5;
const PROJECTION_PRIOR_FLOOR = 65;
const PROJECTION_PRIOR_OFFSET = 750;
const PROJECTION_FLOOR_SIGMA = 8;
const PROJECTION_LOG_OFFSET_SIGMA = 1.25;
const PROJECTION_OBSERVATION_SIGMA = 10;
let lastGoalSignature = '';
let lastGoalProjection = null;

/**
 * Initialize both Chart.js charts.
 * Must be called after Chart.js is loaded.
 */
export function initializeCharts() {
  if (typeof window === 'undefined' || typeof window.Chart === 'undefined') {
    console.error('Chart.js is not available yet. Skipping chart initialization.');
    return;
  }

  initAccuracyChart();
  initMoveAccuracyChart();
}

/**
 * Initialize the cumulative accuracy chart.
 */
function initAccuracyChart() {
  const ctx = document.getElementById('accuracy-chart')?.getContext('2d');
  if (!ctx) return;

  const chart = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Overall Accuracy',
          data: [],
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.08)',
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { left: 2, right: 10, top: 10, bottom: 2 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...CHART_TOOLTIP_OPTIONS,
          callbacks: {
            label: function(context) {
              return `Overall: ${context.formattedValue}%`;
            }
          }
        }
      },
      scales: {
        y: {
          ...CHART_SCALE_OPTIONS,
          min: 0,
          ticks: {
            ...CHART_SCALE_OPTIONS.ticks,
            maxTicksLimit: 5,
            callback: function(value) {
              return `${value.toFixed(0)}%`;
            }
          }
        },
        x: { display: false }
      }
    }
  });

  setAccuracyChart(chart);
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
        label: 'Move Accuracy',
        data: [],
        backgroundColor: '#22c55e',
        borderColor: 'transparent',
        borderWidth: 0,
        borderRadius: 4,
        maxBarThickness: 32,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { left: 2, right: 10, top: 10, bottom: 2 }
      },
      plugins: {
        legend: { display: false },
        tooltip: CHART_TOOLTIP_OPTIONS
      },
      scales: {
        y: {
          ...CHART_SCALE_OPTIONS,
          min: 0,
          max: 100,
          ticks: {
            ...CHART_SCALE_OPTIONS.ticks,
            maxTicksLimit: 5,
            callback: function(value) {
              return `${value.toFixed(0)}%`;
            }
          }
        },
        x: { display: false }
      }
    }
  });

  setMoveAccuracyChart(chart);
}

/**
 * Update both charts with current data.
 */
export function updateCharts() {
  updateAccuracyChart();
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
 * Update the chart with cumulative weighted accuracy over completed games.
 */
function updateAccuracyChart() {
  const chart = getAccuracyChart();
  if (!chart) return;

  const moveAccuracies = getMoveAccuracies();
  const gameHistory = getGameHistory();
  const currentEstimate = calculateCurrentGoalEstimate(gameHistory, moveAccuracies);
  updateAccuracyGoalCount(gameHistory, currentEstimate);
  updateChartCount('accuracy-chart-count', gameHistory.length, 'game');

  const cumulativeAccuracies = calculateCumulativeAccuracies(gameHistory);
  const visibleStartIndex = findLowestAccuracyIndex(cumulativeAccuracies);
  const visibleCumulative = cumulativeAccuracies.slice(visibleStartIndex);
  const includeCurrentGame = moveAccuracies.length > 0 && !isCurrentGameAlreadySaved(gameHistory, moveAccuracies);
  const currentOverall = includeCurrentGame
    ? calculateCurrentOverallAccuracy(gameHistory, moveAccuracies)
    : null;
  const nextSignature = [
    visibleStartIndex,
    visibleCumulative.length,
    visibleCumulative.at(-1) ?? '',
    currentOverall ?? '',
    gameHistory.length
  ].join('|');

  if (nextSignature === lastAccuracyChartSignature) return;
  lastAccuracyChartSignature = nextSignature;

  const labels = visibleCumulative.map((_, index) => `Game ${visibleStartIndex + index + 1}`);
  const values = visibleCumulative.slice();
  if (currentOverall !== null) {
    labels.push(`Current game (${gameHistory.length + 1})`);
    values.push(currentOverall);
  }

  chart.data.labels = labels;
  chart.data.datasets[0].data = values;

  if (values.length > 0) {
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const padding = 4;
    chart.options.scales.y.min = Math.max(0, minimum);
    chart.options.scales.y.max = Math.min(100, Math.max(maximum + padding, minimum + padding));
  }

  chart.update('none');
}

/**
 * Update the accuracy per move bar chart.
 */
function updateMoveAccuracyChart() {
  const chart = getMoveAccuracyChart();
  if (!chart) return;

  const moveAccuracies = getMoveAccuracies();
  updateChartCount('move-chart-count', moveAccuracies.length, 'move');

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

  // Generate colors by accuracy band.
  const colors = moveAccuracies.map((accuracy, index) => {
    const isCurrentMove = isReviewingMoves && currentUserMoveIndex === index;
    if (isCurrentMove) return '#60a5fa';
    return accuracy >= 90 ? '#22c55e' : accuracy >= 65 ? '#f59e0b' : '#ef4444';
  });

  const borderColors = colors.map(color =>
    color === '#60a5fa' ? '#2563eb' : color
  );

  chart.data.labels = moveAccuracies.map(() => '');
  chart.data.datasets[0].data = moveAccuracies;
  chart.data.datasets[0].backgroundColor = colors;
  chart.data.datasets[0].borderColor = borderColors;

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
  updateChartCount('move-chart-count', 0, 'move');
  chart.update('none');
}

/**
 * Update the statistics display.
 */
export function updateStatistics() {
  const allTimeElement = document.getElementById('all-time-accuracy');
  const tenGameElement = document.getElementById('avg-accuracy');
  const gameAccuracyElement = document.getElementById('game-accuracy');
  const moveElement = document.getElementById('move-feedback');

  const moveAccuracies = getMoveAccuracies();
  const gameHistory = getGameHistory();

  const avgAccuracy = moveAccuracies.length > 0
    ? moveAccuracies.reduce((sum, value) => sum + value, 0) / moveAccuracies.length
    : 0;
  const recentGames = gameHistory
    .slice(-10)
    .map(game => game.average_accuracy)
    .filter(value => typeof value === 'number' && !isNaN(value));
  const tenGameAccuracy = recentGames.length > 0
    ? recentGames.reduce((sum, value) => sum + value, 0) / recentGames.length
    : 0;
  const allTimeAccuracy = calculateWeightedGameAccuracy(gameHistory);

  updateStatNumber(allTimeElement, allTimeAccuracy);
  updateStatNumber(tenGameElement, tenGameAccuracy);
  updateStatNumber(gameAccuracyElement, avgAccuracy);

  if (moveElement && moveAccuracies.length === 0) {
    moveElement.textContent = 'Pick move';
    moveElement.style.color = '#94a3b8';
    moveElement.classList.add('stat-value--muted');
  }
}

function calculateWeightedGameAccuracy(gameHistory) {
  let totalMoves = 0;
  let totalAccuracy = 0;

  for (const game of gameHistory) {
    const moves = Number(game.total_moves || 0);
    const accuracy = Number(game.average_accuracy || 0);
    if (!Number.isFinite(moves) || !Number.isFinite(accuracy) || moves <= 0) continue;

    totalMoves += moves;
    totalAccuracy += accuracy * moves;
  }

  return totalMoves > 0 ? totalAccuracy / totalMoves : 0;
}

function calculateCumulativeAccuracies(gameHistory) {
  const cumulative = [];
  let totalMoves = 0;
  let totalAccuracy = 0;

  for (const game of gameHistory) {
    const moves = Number(game.total_moves || 0);
    const accuracy = Number(game.average_accuracy || 0);
    if (!Number.isFinite(moves) || !Number.isFinite(accuracy) || moves <= 0) continue;

    totalMoves += moves;
    totalAccuracy += accuracy * moves;
    cumulative.push(totalAccuracy / totalMoves);
  }

  return cumulative;
}

function calculateCurrentOverallAccuracy(gameHistory, moveAccuracies) {
  let totalMoves = 0;
  let totalAccuracy = 0;

  for (const game of gameHistory) {
    const moves = Number(game.total_moves || 0);
    const accuracy = Number(game.average_accuracy || 0);
    if (!Number.isFinite(moves) || !Number.isFinite(accuracy) || moves <= 0) continue;

    totalMoves += moves;
    totalAccuracy += accuracy * moves;
  }

  for (const accuracy of moveAccuracies) {
    const numeric = Number(accuracy);
    if (!Number.isFinite(numeric)) continue;

    totalMoves += 1;
    totalAccuracy += numeric;
  }

  return totalMoves > 0 ? totalAccuracy / totalMoves : null;
}

function findLowestAccuracyIndex(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;

  let lowestIndex = 0;
  let lowestValue = Infinity;

  for (let index = 0; index < values.length; index++) {
    const value = Number(values[index]);
    if (Number.isFinite(value) && value < lowestValue) {
      lowestValue = value;
      lowestIndex = index;
    }
  }

  return lowestIndex;
}

function isCurrentGameAlreadySaved(gameHistory, moveAccuracies) {
  const lastGame = Array.isArray(gameHistory) ? gameHistory.at(-1) : null;
  const history = Array.isArray(lastGame?.accuracy_history) ? lastGame.accuracy_history : null;

  if (!history || history.length !== moveAccuracies.length) return false;

  return history.every((value, index) => Number(value) === Number(moveAccuracies[index]));
}

function updateChartCount(id, count, singular) {
  const next = `${count} ${count === 1 ? singular : `${singular}s`}`;
  let element = chartHeadingCounts[id];

  if (!element) {
    element = document.getElementById(id);
    chartHeadingCounts[id] = element;
  }

  if (element && element.textContent !== next) {
    element.textContent = next;
  }
}

export function calculateCurrentGoalEstimate(gameHistory, moveAccuracies) {
  const completedGames = Array.isArray(gameHistory) ? gameHistory.length : 0;
  const projectedAccuracies = getProjectedGameAccuracies(gameHistory, moveAccuracies);
  const projection = projectAccuracyGoal(gameHistory, moveAccuracies);
  const averageDurationMs = calculateAverageGameDurationMs(gameHistory);

  return calculateGoalEstimate(projectedAccuracies, completedGames, averageDurationMs, projection);
}

function calculateGoalEstimate(accuracies, completedGames, averageDurationMs, projection) {
  const rollingGoalReached = isRollingAccuracyGoalReached(accuracies);
  const minimumFutureGames = minimumFutureGamesForRollingTarget(accuracies);
  const targetGames = projection
    ? resolveTargetGames(completedGames, projection.targetGame, rollingGoalReached, minimumFutureGames)
    : completedGames;
  const remainingGames = Math.max(0, targetGames - completedGames);
  const hoursLeftMs = projection && averageDurationMs !== null
    ? remainingGames * averageDurationMs
    : null;

  return {
    projection,
    completedGames,
    targetGames,
    remainingGames,
    averageDurationMs,
    hoursLeftMs,
    minimumFutureGames,
  };
}

function updateAccuracyGoalCount(gameHistory, estimate) {
  const completedGames = Array.isArray(gameHistory) ? gameHistory.length : 0;
  const next = estimate.projection
    ? `${formatGameCount(completedGames)} played / ${formatHoursLeft(estimate.hoursLeftMs)} left`
    : `${formatGameCount(completedGames)} played / --h left`;
  let element = chartHeadingCounts['hours-left-count'];

  if (!element) {
    element = document.getElementById('hours-left-count');
    chartHeadingCounts['hours-left-count'] = element;
  }

  if (element) {
    if (element.textContent !== next) {
      element.textContent = next;
    }
    element.title = estimate.projection
      ? buildHoursLeftTitle(
          completedGames,
          estimate.targetGames,
          estimate.remainingGames,
          estimate.averageDurationMs,
          estimate.hoursLeftMs,
          estimate.minimumFutureGames
        )
      : `Complete one timed game to estimate hours left to ${GM_ACCURACY_TARGET}%`;
  }
}

function resolveTargetGames(completedGames, rawTargetGame, rollingGoalReached, minimumFutureGames) {
  if (rollingGoalReached) return completedGames;

  const projectedTargetGames = Number.isFinite(rawTargetGame)
    ? Math.round(rawTargetGame)
    : completedGames;
  const lowerBoundTargetGames = Number.isFinite(minimumFutureGames)
    ? completedGames + minimumFutureGames
    : completedGames + 1;

  return Math.max(projectedTargetGames, lowerBoundTargetGames);
}

function buildHoursLeftTitle(completedGames, targetGames, remainingGames, averageDurationMs, hoursLeft, minimumFutureGames) {
  if (averageDurationMs === null || hoursLeft === null) {
    return `${formatGameCount(completedGames)} played; play one timed game to estimate hours left to ${GM_ACCURACY_TARGET}%`;
  }

  const parts = [
    `Power-law estimate from ${formatGameCount(completedGames)} ${completedGames === 1 ? 'game' : 'games'}`,
    `${formatGameCount(completedGames)} played`,
    `${formatGameCount(targetGames)} target games`,
    `${formatGameCount(remainingGames)} estimated remaining`,
    `${formatGameLength(averageDurationMs)} avg game length`,
    `${formatHoursLeft(hoursLeft)} left to ${GM_ACCURACY_TARGET}%`
  ];

  if (Number.isFinite(minimumFutureGames) && minimumFutureGames > 0) {
    parts.push(`${formatGameCount(minimumFutureGames)} game rolling-window minimum`);
  }

  return parts.join(', ');
}

function projectAccuracyGoal(gameHistory, moveAccuracies) {
  const accuracies = getProjectedGameAccuracies(gameHistory, moveAccuracies);
  if (accuracies.length === 0) return null;

  const signature = accuracies
    .map((accuracy) => Number(accuracy || 0).toFixed(2))
    .join('|');
  if (signature === lastGoalSignature) return lastGoalProjection;

  lastGoalSignature = signature;
  lastGoalProjection = projectAccuracyGoalFromAccuracies(accuracies);

  return lastGoalProjection;
}

function projectAccuracyGoalFromAccuracies(accuracies) {
  if (!Array.isArray(accuracies) || accuracies.length === 0) return null;

  const points = accuracies.map((accuracy, index) => ({
    x: index + 1,
    y: Number(accuracy)
  })).filter((point) => Number.isFinite(point.y));
  if (points.length === 0) return null;

  const fit = fitBoundedLearningCurve(points);
  const targetGame = solveBoundedTargetGame(fit);
  return Number.isFinite(targetGame) ? { ...fit, targetGame } : null;
}

function getProjectedGameAccuracies(gameHistory, moveAccuracies) {
  const accuracies = Array.isArray(gameHistory)
    ? gameHistory
        .map((game) => Number(game.average_accuracy))
        .filter((accuracy) => Number.isFinite(accuracy))
    : [];

  if (
    Array.isArray(moveAccuracies)
    && moveAccuracies.length > 0
    && !isCurrentGameAlreadySaved(gameHistory, moveAccuracies)
  ) {
    const currentGameAccuracy = moveAccuracies.reduce((sum, value) => sum + Number(value || 0), 0) / moveAccuracies.length;
    if (Number.isFinite(currentGameAccuracy)) {
      accuracies.push(currentGameAccuracy);
    }
  }

  return accuracies;
}

function isRollingAccuracyGoalReached(accuracies) {
  if (!Array.isArray(accuracies) || accuracies.length < 10) return false;
  return average(accuracies.slice(-10)) >= GM_ACCURACY_TARGET;
}

function minimumFutureGamesForRollingTarget(accuracies) {
  if (!Array.isArray(accuracies) || accuracies.length === 0) return null;
  if (accuracies.length < 10) return 10 - accuracies.length;
  const lastTen = accuracies.slice(-10);
  if (average(lastTen) >= GM_ACCURACY_TARGET) return 0;

  for (let futureGames = 1; futureGames <= 10; futureGames++) {
    const futureWindow = [
      ...lastTen.slice(futureGames),
      ...Array(futureGames).fill(100)
    ];

    if (average(futureWindow) >= GM_ACCURACY_TARGET) {
      return futureGames;
    }
  }

  return 10;
}

function fitBoundedLearningCurve(points) {
  let best = null;
  const decayFactors = new Float64Array(points.length);
  const observationPrecision = 1 / (PROJECTION_OBSERVATION_SIGMA ** 2);
  const floorPriorPrecision = 1 / (PROJECTION_FLOOR_SIGMA ** 2);
  const priorLogOffset = Math.log(PROJECTION_PRIOR_OFFSET);

  for (let logOffset = Math.log(20); logOffset <= Math.log(20000); logOffset += 0.025) {
    const offset = Math.exp(logOffset);
    let floorNumerator = PROJECTION_PRIOR_FLOOR * floorPriorPrecision;
    let floorDenominator = floorPriorPrecision;

    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const decay = Math.pow(offset / (point.x + offset), GM_ACCURACY_EXPONENT);
      decayFactors[index] = decay;
      floorNumerator += decay * (point.y - GM_ACCURACY_CEILING * (1 - decay)) * observationPrecision;
      floorDenominator += decay * decay * observationPrecision;
    }

    const floor = Math.max(45, Math.min(80, floorNumerator / floorDenominator));
    // Priors identify the curve early; independent game results steadily outweigh them.
    let error = ((floor - PROJECTION_PRIOR_FLOOR) / PROJECTION_FLOOR_SIGMA) ** 2
      + ((logOffset - priorLogOffset) / PROJECTION_LOG_OFFSET_SIGMA) ** 2;

    for (let index = 0; index < points.length; index++) {
      const decay = decayFactors[index];
      const prediction = GM_ACCURACY_CEILING * (1 - decay) + floor * decay;
      const residual = points[index].y - prediction;
      error += residual * residual * observationPrecision;
    }

    if (!best || error < best.error) {
      best = { floor, offset, error };
    }
  }

  return best || { floor: PROJECTION_PRIOR_FLOOR, offset: PROJECTION_PRIOR_OFFSET, error: 0 };
}

function solveBoundedTargetGame(fit) {
  if (!fit || GM_ACCURACY_CEILING <= GM_ACCURACY_TARGET) return Infinity;

  const ratio = (GM_ACCURACY_CEILING - GM_ACCURACY_TARGET) / (GM_ACCURACY_CEILING - fit.floor);
  if (ratio <= 0 || ratio >= 1) return Infinity;

  return fit.offset * (Math.pow(ratio, -1 / GM_ACCURACY_EXPONENT) - 1);
}

function average(values) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function formatGameCount(count) {
  const numeric = Number(count || 0);
  if (!Number.isFinite(numeric)) return '0';
  if (numeric >= 10000) {
    return `${(numeric / 1000).toFixed(1)}k`;
  }
  return Math.round(numeric).toLocaleString();
}

function calculateAverageGameDurationMs(gameHistory) {
  if (!Array.isArray(gameHistory)) return null;

  let count = 0;
  let total = 0;

  for (const game of gameHistory) {
    const duration = Number(game.duration_ms);
    if (!Number.isFinite(duration) || duration <= 0) continue;

    count += 1;
    total += duration;
  }

  return count > 0 ? total / count : null;
}

function formatHoursLeft(durationMs) {
  if (durationMs === null || durationMs === undefined) return '--h';
  const numeric = Number(durationMs);
  if (!Number.isFinite(numeric)) return '--h';

  return formatHoursValue(Math.max(0, numeric / 3600000));
}

function formatHoursValue(hours) {
  if (hours === null || hours === undefined) return '--h';
  const numeric = Number(hours);
  if (!Number.isFinite(numeric)) return '--h';

  const clamped = Math.max(0, numeric);
  if (clamped >= 1000) return `${Math.round(clamped).toLocaleString()}h`;
  if (clamped >= 10) return `${Math.round(clamped)}h`;
  if (clamped >= 1) return `${clamped.toFixed(1)}h`;
  if (clamped === 0) return '0h';
  return `${Math.max(0.1, clamped).toFixed(1)}h`;
}

function formatGameLength(durationMs) {
  const numeric = Number(durationMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return '--';

  const minutes = numeric / 60000;
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h/game`;
  if (minutes >= 10) return `${Math.round(minutes)}m/game`;
  if (minutes >= 1) return `${minutes.toFixed(1)}m/game`;
  return `${Math.max(1, Math.round(numeric / 1000))}s/game`;
}

function updateStatNumber(element, value) {
  if (!element) return;

  const next = Number(value || 0);
  const prev = parseFloat(element.textContent || '0') || 0;

  if (Number(next.toFixed(1)) !== Number(prev.toFixed(1))) {
    element.textContent = `${next.toFixed(1)}%`;
    element.classList.add('num-bounce');
    setTimeout(() => element.classList.remove('num-bounce'), 260);
  }
}
