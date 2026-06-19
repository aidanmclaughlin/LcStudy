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
  getCumulativeAccuracies,
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
 * Initialize the accuracy/average chart (line chart).
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
        },
        {
          label: 'Current Overall',
          data: [],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.15)',
          borderWidth: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointBackgroundColor: '#22c55e',
          pointBorderColor: '#15803d',
          pointBorderWidth: 0,
          fill: false,
          tension: 0
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
              const datasetIndex = context.datasetIndex;
              const index = context.dataIndex;
              const value = `${context.formattedValue}%`;

              if (datasetIndex === 0) {
                return `Overall: ${value}`;
              } else if (datasetIndex === 1) {
                return `Now: ${value}`;
              }
              return value;
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

/**
 * Update the accuracy chart with cumulative overall averages.
 */
function updateAccuracyChart() {
  const chart = getAccuracyChart();
  if (!chart) return;

  const cumulativeAccuracies = getCumulativeAccuracies();
  const moveAccuracies = getMoveAccuracies();
  const gameHistory = getGameHistory();
  updateAccuracyGoalCount(gameHistory, moveAccuracies);

  const visibleStartIndex = findLowestAccuracyIndex(cumulativeAccuracies);
  const visibleCumulative = cumulativeAccuracies.slice(visibleStartIndex);
  const includeCurrentGame = moveAccuracies.length > 0 && !isCurrentGameAlreadySaved(gameHistory, moveAccuracies);
  const currentOverallAvg = includeCurrentGame
    ? calculateCurrentOverallAccuracy(gameHistory, moveAccuracies)
    : null;
  const nextSignature = [
    visibleStartIndex,
    visibleCumulative.length,
    visibleCumulative.at(-1) ?? '',
    currentOverallAvg ?? '',
    gameHistory.length
  ].join('|');

  if (nextSignature === lastAccuracyChartSignature) return;
  lastAccuracyChartSignature = nextSignature;

  const labels = [];
  const cumulativeData = [];
  const currentGameData = [];

  const pointBgColors = [];
  const pointBdColors = [];
  const pointRadii = [];
  const pointHoverRadii = [];
  const pointBorderWidths = [];

  // Add historical data points
  for (let i = 0; i < visibleCumulative.length; i++) {
    labels.push('');
    cumulativeData.push(visibleCumulative[i]);
    currentGameData.push(null);
    pointBgColors.push('#8b5cf6');
    pointBdColors.push('#8b5cf6');
    pointRadii.push(0);
    pointHoverRadii.push(0);
    pointBorderWidths.push(0);
  }

  // Add current game point
  if (currentOverallAvg !== null) {
    labels.push('');
    cumulativeData.push(null);
    currentGameData.push(currentOverallAvg);
    pointBgColors.push('#8b5cf6');
    pointBdColors.push('#8b5cf6');
    pointRadii.push(0);
    pointHoverRadii.push(0);
    pointBorderWidths.push(0);
  }

  // Update chart data
  chart.data.labels = labels;
  chart.data.datasets[0].data = cumulativeData;
  chart.data.datasets[1].data = currentGameData;
  chart.data.datasets[0].pointBackgroundColor = pointBgColors;
  chart.data.datasets[0].pointBorderColor = pointBdColors;
  chart.data.datasets[0].pointRadius = pointRadii;
  chart.data.datasets[0].pointHoverRadius = pointHoverRadii;
  chart.data.datasets[0].pointBorderWidth = pointBorderWidths;
  chart.data.datasets[0].customMinIndex = null;

  // Dynamically adjust Y axis to data range
  const yVals = [
    ...visibleCumulative
  ].filter(v => typeof v === 'number' && !isNaN(v));
  if (currentOverallAvg !== null) {
    if (!isNaN(currentOverallAvg)) yVals.push(currentOverallAvg);
  }

  if (yVals.length > 0) {
    const minY = Math.min(...yVals);
    const maxY = Math.max(...yVals);
    const pad = 4;
    let axisMin = Math.max(0, minY);
    let axisMax = Math.min(100, maxY + pad);

    if (axisMax <= axisMin) {
      axisMin = Math.max(0, axisMin - pad);
      axisMax = Math.min(100, Math.max(axisMax, axisMin + pad));
    }

    chart.options.scales.y.min = axisMin;
    chart.options.scales.y.max = axisMax;
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
    const numeric = Number(accuracy || 0);
    if (!Number.isFinite(numeric)) continue;

    totalMoves += 1;
    totalAccuracy += numeric;
  }

  return totalMoves > 0 ? totalAccuracy / totalMoves : 0;
}

function findLowestAccuracyIndex(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;

  let lowestIndex = 0;
  let lowestValue = Number(values[0]);

  for (let i = 1; i < values.length; i++) {
    const value = Number(values[i]);
    if (Number.isFinite(value) && value < lowestValue) {
      lowestValue = value;
      lowestIndex = i;
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

function updateAccuracyGoalCount(gameHistory, moveAccuracies) {
  const completedGames = Array.isArray(gameHistory) ? gameHistory.length : 0;
  const projectedAccuracies = getProjectedGameAccuracies(gameHistory, moveAccuracies);
  const projection = projectAccuracyGoal(gameHistory, moveAccuracies);
  const rollingGoalReached = isRollingAccuracyGoalReached(projectedAccuracies);
  const minimumFutureGames = minimumFutureGamesForRollingTarget(projectedAccuracies);
  const targetGames = projection
    ? resolveTargetGames(completedGames, projection.targetGame, rollingGoalReached, minimumFutureGames)
    : completedGames;
  const remainingGames = Math.max(0, targetGames - completedGames);
  const averageDurationMs = calculateAverageGameDurationMs(gameHistory);
  const hoursLeft = projection && averageDurationMs !== null
    ? remainingGames * averageDurationMs
    : null;
  const next = projection
    ? `${formatGameCount(completedGames)} played / ${formatHoursLeft(hoursLeft)} left`
    : `${formatGameCount(completedGames)} played / --h left`;
  let element = chartHeadingCounts['accuracy-chart-count'];

  if (!element) {
    element = document.getElementById('accuracy-chart-count');
    chartHeadingCounts['accuracy-chart-count'] = element;
  }

  if (element) {
    if (element.textContent !== next) {
      element.textContent = next;
    }
    element.title = projection
      ? buildHoursLeftTitle(completedGames, targetGames, remainingGames, averageDurationMs, hoursLeft, minimumFutureGames)
      : `Need 10 completed games to estimate the ${GM_ACCURACY_TARGET}% target`;
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
  if (accuracies.length < 10) return null;

  const signature = accuracies
    .map((accuracy) => Number(accuracy || 0).toFixed(2))
    .join('|');
  if (signature === lastGoalSignature) return lastGoalProjection;

  const points = buildTenGameBlocks(accuracies);
  const fit = fitBoundedLearningCurve(points);
  const targetGame = solveBoundedTargetGame(fit);
  lastGoalSignature = signature;
  lastGoalProjection = Number.isFinite(targetGame)
    ? { ...fit, targetGame }
    : null;

  return lastGoalProjection;
}

function getProjectedGameAccuracies(gameHistory, moveAccuracies) {
  const accuracies = Array.isArray(gameHistory)
    ? gameHistory
        .map((game) => Number(game.average_accuracy))
        .filter((accuracy) => Number.isFinite(accuracy))
    : [];

  if (Array.isArray(moveAccuracies) && moveAccuracies.length > 0) {
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
  if (!Array.isArray(accuracies) || accuracies.length < 10) return null;
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

function buildTenGameBlocks(accuracies) {
  const points = [];

  for (let start = 0; start + 10 <= accuracies.length; start += 10) {
    points.push({
      x: start + 10,
      y: average(accuracies.slice(start, start + 10))
    });
  }

  if (points.at(-1)?.x !== accuracies.length) {
    points.push({
      x: accuracies.length,
      y: average(accuracies.slice(-10))
    });
  }

  return points;
}

function fitBoundedLearningCurve(points) {
  let best = null;
  const decayFactors = new Float64Array(points.length);

  for (let logOffset = Math.log(20); logOffset <= Math.log(20000); logOffset += 0.025) {
    const offset = Math.exp(logOffset);
    let floorNumerator = 0;
    let floorDenominator = 0;

    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const decay = Math.pow(offset / (point.x + offset), GM_ACCURACY_EXPONENT);
      decayFactors[index] = decay;
      floorNumerator += decay * (point.y - GM_ACCURACY_CEILING * (1 - decay));
      floorDenominator += decay * decay;
    }

    const unconstrainedFloor = floorDenominator > 0
      ? floorNumerator / floorDenominator
      : 65;
    const floor = Math.max(55, Math.min(68, unconstrainedFloor));
    let error = 0;

    for (let index = 0; index < points.length; index++) {
      const decay = decayFactors[index];
      const prediction = GM_ACCURACY_CEILING * (1 - decay) + floor * decay;
      const residual = points[index].y - prediction;
      error += residual * residual;
    }

    if (!best || error < best.error) {
      best = { floor, offset, error };
    }
  }

  return best || { floor: 65, offset: 750, error: 0 };
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
  const numeric = Number(durationMs);
  if (!Number.isFinite(numeric)) return '--h';

  const hours = Math.max(0, numeric / 3600000);
  if (hours >= 1000) return `${Math.round(hours).toLocaleString()}h`;
  if (hours >= 10) return `${Math.round(hours)}h`;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  if (hours === 0) return '0h';
  return `${Math.max(0.1, hours).toFixed(1)}h`;
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
