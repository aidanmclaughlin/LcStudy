/**
 * Backend API communication.
 * @module api
 */

import {
  getSessionId,
  getSessionCache,
  getGameAttempts,
  getTotalAttempts,
  getGameHistory,
  setGameHistory,
  getCumulativeAverages,
  setCumulativeAverages
} from './state.js';
import { updateCharts } from './charts.js';

/**
 * Fetch game history from the server.
 * Updates gameHistory and cumulativeAverages state.
 */
export async function loadGameHistory() {
  try {
    const res = await fetch('/api/v1/game-history');
    const data = await res.json();
    const history = data.history || [];

    setGameHistory(history);

    // Calculate cumulative averages (weighted by total moves)
    const averages = calculateCumulativeAverages(history);
    setCumulativeAverages(averages);

    updateCharts();
  } catch (e) {
    console.log('Failed to load game history:', e);
  }
}

/**
 * Calculate cumulative weighted averages from game history.
 * @param {Array} history - Array of game history entries
 * @returns {number[]} Array of cumulative averages
 */
function calculateCumulativeAverages(history) {
  const averages = [];
  let totalMovesSoFar = 0;
  let totalAttemptsSoFar = 0;

  for (const game of history) {
    const gameMoves = game.total_moves || 0;
    const gameAttempts = game.average_retries * gameMoves;

    totalMovesSoFar += gameMoves;
    totalAttemptsSoFar += gameAttempts;

    const cumulativeAvg = totalMovesSoFar > 0
      ? totalAttemptsSoFar / totalMovesSoFar
      : 0;

    averages.push(cumulativeAvg);
  }

  return averages;
}

/**
 * Save a completed game to the server.
 * @param {'finished' | 'incomplete'} result - Game result
 */
export async function saveCompletedGame(result) {
  const sessionId = getSessionId();
  const gameAttempts = getGameAttempts();

  if (!sessionId || gameAttempts.length === 0) {
    return;
  }

  const sessionCache = getSessionCache();
  const maiaLevel = sessionCache.maiaLevel || window.currentMaiaLevel || 1500;
  const totalMoves = gameAttempts.length;
  const totalAttemptsForGame = getTotalAttempts();
  const attemptHistory = [...gameAttempts];
  const averageRetries = totalMoves > 0 ? totalAttemptsForGame / totalMoves : 0;

  console.debug('saveCompletedGame payload', {
    sessionId,
    totalMoves,
    totalAttemptsForGame,
    attemptHistory
  });

  try {
    const res = await fetch(`/api/v1/session/${sessionId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        total_attempts: totalAttemptsForGame,
        total_moves: totalMoves,
        attempt_history: attemptHistory,
        average_retries: averageRetries,
        maia_level: maiaLevel,
        result: result
      })
    });

    if (!res.ok) {
      console.error('Failed to persist game', res.status, await res.text());
    }
  } catch (e) {
    console.log('Failed to persist game:', e);
  }

  // Update local history
  const gameHistory = getGameHistory();
  gameHistory.push({
    average_retries: averageRetries,
    total_moves: totalMoves,
    maia_level: maiaLevel,
    result: result
  });
  setGameHistory(gameHistory);

  // Recalculate cumulative averages
  const averages = calculateCumulativeAverages(gameHistory);
  setCumulativeAverages(averages);

  updateCharts();
}

/**
 * Create a new game session on the server.
 * @param {number} maiaLevel - Maia difficulty level
 * @returns {Promise<Object|null>} Session data or null on failure
 */
export async function createSession(maiaLevel) {
  const payload = { maia_level: maiaLevel };

  try {
    const res = await fetch('/api/v1/session/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error('Failed to create session', res.status);
      return null;
    }

    const rawBody = await res.text();
    return rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    console.error('Failed to parse session response', err);
    throw err;
  }
}
