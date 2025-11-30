/**
 * Chart.js initialization and updates.
 * @module charts
 */

import { CHART_SCALE_OPTIONS, CHART_TOOLTIP_OPTIONS } from './constants.js';
import {
  getAccuracyChart,
  setAccuracyChart,
  getAttemptsChart,
  setAttemptsChart,
  getGameAttempts,
  getTotalAttempts,
  getCumulativeAverages,
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
  initAttemptsChart();
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
          label: 'Average Retries',
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
              const value = context.formattedValue;

              if (datasetIndex === 0) {
                const dataset = context.chart.data.datasets[0] || {};
                const minIdx = dataset.customMinIndex;
                if (minIdx !== undefined && minIdx !== null && index === minIdx) {
                  return `Best: ${value}`;
                }
                return `Avg: ${value}`;
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
              return value.toFixed(1);
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
 * Initialize the attempts per move chart (bar chart).
 */
function initAttemptsChart() {
  const ctx = document.getElementById('attempts-chart')?.getContext('2d');
  if (!ctx) return;

  const chart = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Attempts',
        data: [],
        backgroundColor: '#f59e0b',
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
          ticks: {
            ...CHART_SCALE_OPTIONS.ticks,
            stepSize: 1,
            maxTicksLimit: 6
          }
        },
        x: { display: false }
      }
    }
  });

  setAttemptsChart(chart);
}

/**
 * Update both charts with current data.
 */
export function updateCharts() {
  updateAccuracyChart();
  updateAttemptsChart();
}

/**
 * Update the accuracy chart with cumulative averages and current game.
 */
function updateAccuracyChart() {
  const chart = getAccuracyChart();
  if (!chart) return;

  const cumulativeAverages = getCumulativeAverages();
  const gameAttempts = getGameAttempts();
  const totalAttempts = getTotalAttempts();

  const labels = [];
  const historicalData = [];
  const currentGameData = [];

  // Per-point styling for minimum highlight
  const pointBgColors = [];
  const pointBdColors = [];
  const pointRadii = [];
  const pointHoverRadii = [];
  const pointBorderWidths = [];

  // Add historical data points
  for (let i = 0; i < cumulativeAverages.length; i++) {
    labels.push('');
    historicalData.push(cumulativeAverages[i]);
    currentGameData.push(null);
    pointBgColors.push('#8b5cf6');
    pointBdColors.push('#8b5cf6');
    pointRadii.push(0);
    pointHoverRadii.push(0);
    pointBorderWidths.push(0);
  }

  // Add current game point
  if (gameAttempts.length > 0) {
    const currentGameAvg = totalAttempts / gameAttempts.length;
    labels.push('');
    historicalData.push(null);
    currentGameData.push(currentGameAvg);
    pointBgColors.push('#8b5cf6');
    pointBdColors.push('#8b5cf6');
    pointRadii.push(0);
    pointHoverRadii.push(0);
    pointBorderWidths.push(0);
  }

  // Find and highlight minimum historical value
  let minIdxForTooltip = null;
  if (cumulativeAverages.length > 0) {
    let minVal = cumulativeAverages[0];
    let minIdx = 0;

    for (let i = 1; i < cumulativeAverages.length; i++) {
      if (cumulativeAverages[i] < minVal) {
        minVal = cumulativeAverages[i];
        minIdx = i;
      }
    }

    // Apply red styling to minimum point
    pointBgColors[minIdx] = '#e11d48';
    pointBdColors[minIdx] = '#ffffff';
    pointRadii[minIdx] = 5;
    pointHoverRadii[minIdx] = 7;
    pointBorderWidths[minIdx] = 2;
    minIdxForTooltip = minIdx;
  }

  // Update chart data
  chart.data.labels = labels;
  chart.data.datasets[0].data = historicalData;
  chart.data.datasets[1].data = currentGameData;
  chart.data.datasets[0].pointBackgroundColor = pointBgColors;
  chart.data.datasets[0].pointBorderColor = pointBdColors;
  chart.data.datasets[0].pointRadius = pointRadii;
  chart.data.datasets[0].pointHoverRadius = pointHoverRadii;
  chart.data.datasets[0].pointBorderWidth = pointBorderWidths;
  chart.data.datasets[0].customMinIndex = minIdxForTooltip;

  // Dynamically adjust Y axis to data range
  const yVals = cumulativeAverages.filter(v => typeof v === 'number' && !isNaN(v));
  if (gameAttempts.length > 0) {
    const currentGameAvg = totalAttempts / gameAttempts.length;
    if (!isNaN(currentGameAvg)) yVals.push(currentGameAvg);
  }

  if (yVals.length > 0) {
    const minY = Math.min(...yVals);
    const maxY = Math.max(...yVals);
    const pad = 0.2;
    chart.options.scales.y.min = minY - pad;
    chart.options.scales.y.max = maxY + pad;
  }

  chart.update('none');
}

/**
 * Update the attempts bar chart.
 */
function updateAttemptsChart() {
  const chart = getAttemptsChart();
  if (!chart) return;

  const gameAttempts = getGameAttempts();
  if (gameAttempts.length === 0) return;

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

  // Generate colors (green for current, amber for others)
  const colors = gameAttempts.map((_, index) => {
    const isCurrentMove = isReviewingMoves && currentUserMoveIndex === index;
    return isCurrentMove ? '#10b981' : '#f59e0b';
  });

  const borderColors = colors.map(color =>
    color === '#10b981' ? '#059669' : '#d97706'
  );

  chart.data.labels = gameAttempts.map(() => '');
  chart.data.datasets[0].data = gameAttempts;
  chart.data.datasets[0].backgroundColor = colors;
  chart.data.datasets[0].borderColor = borderColors;

  chart.update('none');
}

/**
 * Reset the attempts chart for a new game.
 */
export function resetAttemptsChart() {
  const chart = getAttemptsChart();
  if (!chart) return;

  chart.data.labels = [];
  chart.data.datasets[0].data = [];
  chart.update('none');
}

/**
 * Update the statistics display.
 */
export function updateStatistics() {
  const currentAverageElement = document.getElementById('avg-attempts');
  if (!currentAverageElement) return;

  const gameAttempts = getGameAttempts();
  const totalAttempts = getTotalAttempts();

  const avgAttempts = gameAttempts.length > 0 ? (totalAttempts / gameAttempts.length) : 0;
  const prev = parseFloat(currentAverageElement.textContent || '0') || 0;
  const next = parseFloat(avgAttempts.toFixed(1));

  if (next !== prev) {
    currentAverageElement.textContent = next.toFixed(1);
    currentAverageElement.classList.add('num-bounce');
    setTimeout(() => currentAverageElement.classList.remove('num-bounce'), 260);
  }
}
