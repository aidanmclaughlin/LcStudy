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
          label: 'Game Accuracy',
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
          label: 'Current Game',
          data: [],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.15)',
          borderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#22c55e',
          pointBorderColor: '#15803d',
          pointBorderWidth: 2,
          fill: false,
          tension: 0
        },
        {
          label: 'Overall Accuracy',
          data: [],
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.08)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0.3
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
                const dataset = context.chart.data.datasets[0] || {};
                const minIdx = dataset.customMinIndex;
                if (minIdx !== undefined && minIdx !== null && index === minIdx) {
                  return `Best: ${value}`;
                }
                return `Game: ${value}`;
              } else if (datasetIndex === 1) {
                return `Now: ${value}`;
              } else if (datasetIndex === 2) {
                return `Overall: ${value}`;
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
 * Update the accuracy chart with cumulative averages and current game.
 */
function updateAccuracyChart() {
  const chart = getAccuracyChart();
  if (!chart) return;

  const cumulativeAccuracies = getCumulativeAccuracies();
  const moveAccuracies = getMoveAccuracies();
  const gameHistory = getGameHistory();

  const labels = [];
  const historicalData = [];
  const currentGameData = [];
  const cumulativeData = [];

  // Per-point styling for best historical highlight
  const pointBgColors = [];
  const pointBdColors = [];
  const pointRadii = [];
  const pointHoverRadii = [];
  const pointBorderWidths = [];

  // Add historical data points
  for (let i = 0; i < cumulativeAccuracies.length; i++) {
    labels.push('');
    historicalData.push(gameHistory[i]?.average_accuracy ?? null);
    currentGameData.push(null);
    cumulativeData.push(cumulativeAccuracies[i]);
    pointBgColors.push('#8b5cf6');
    pointBdColors.push('#8b5cf6');
    pointRadii.push(0);
    pointHoverRadii.push(0);
    pointBorderWidths.push(0);
  }

  // Add current game point
  if (moveAccuracies.length > 0) {
    const currentGameAvg = moveAccuracies.reduce((sum, value) => sum + value, 0) / moveAccuracies.length;
    labels.push('');
    historicalData.push(null);
    currentGameData.push(currentGameAvg);
    cumulativeData.push(null);
    pointBgColors.push('#8b5cf6');
    pointBdColors.push('#8b5cf6');
    pointRadii.push(0);
    pointHoverRadii.push(0);
    pointBorderWidths.push(0);
  }

  // Find and highlight maximum historical value
  let bestIdxForTooltip = null;
  if (cumulativeAccuracies.length > 0) {
    let maxVal = cumulativeAccuracies[0];
    let bestIdx = 0;

    for (let i = 1; i < cumulativeAccuracies.length; i++) {
      if (cumulativeAccuracies[i] > maxVal) {
        maxVal = cumulativeAccuracies[i];
        bestIdx = i;
      }
    }

    // Apply green styling to best point
    pointBgColors[bestIdx] = '#10b981';
    pointBdColors[bestIdx] = '#ffffff';
    pointRadii[bestIdx] = 5;
    pointHoverRadii[bestIdx] = 7;
    pointBorderWidths[bestIdx] = 2;
    bestIdxForTooltip = bestIdx;
  }

  // Update chart data
  chart.data.labels = labels;
  chart.data.datasets[0].data = historicalData;
  chart.data.datasets[1].data = currentGameData;
  chart.data.datasets[2].data = cumulativeData;
  chart.data.datasets[0].pointBackgroundColor = pointBgColors;
  chart.data.datasets[0].pointBorderColor = pointBdColors;
  chart.data.datasets[0].pointRadius = pointRadii;
  chart.data.datasets[0].pointHoverRadius = pointHoverRadii;
  chart.data.datasets[0].pointBorderWidth = pointBorderWidths;
  chart.data.datasets[0].customMinIndex = bestIdxForTooltip;

  // Dynamically adjust Y axis to data range
  const yVals = [
    ...cumulativeAccuracies,
    ...gameHistory.map(game => game.average_accuracy)
  ].filter(v => typeof v === 'number' && !isNaN(v));
  if (moveAccuracies.length > 0) {
    const currentGameAvg = moveAccuracies.reduce((sum, value) => sum + value, 0) / moveAccuracies.length;
    if (!isNaN(currentGameAvg)) yVals.push(currentGameAvg);
  }

  if (yVals.length > 0) {
    const minY = Math.min(...yVals);
    const maxY = Math.max(...yVals);
    const pad = 4;
    chart.options.scales.y.min = Math.max(0, minY - pad);
    chart.options.scales.y.max = Math.min(100, maxY + pad);
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
  if (moveAccuracies.length === 0) return;

  const moveHistory = getMoveHistory();
  const currentMoveIndex = getCurrentMoveIndex();
  const isReviewingMoves = getIsReviewingMoves();

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
  chart.update('none');
}

/**
 * Update the statistics display.
 */
export function updateStatistics() {
  const currentAverageElement = document.getElementById('avg-accuracy');
  if (!currentAverageElement) return;

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
  const prev = parseFloat(currentAverageElement.textContent || '0') || 0;
  const next = parseFloat(tenGameAccuracy.toFixed(1));

  if (next !== prev) {
    currentAverageElement.textContent = `${next.toFixed(1)}%`;
    currentAverageElement.classList.add('num-bounce');
    setTimeout(() => currentAverageElement.classList.remove('num-bounce'), 260);
  }

  const moveElement = document.getElementById('move-accuracy-summary');
  if (moveElement) {
    moveElement.textContent = `Game avg ${avgAccuracy.toFixed(1)}%`;
  }
}
