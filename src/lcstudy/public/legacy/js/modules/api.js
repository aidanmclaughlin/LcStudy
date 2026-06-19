/**
 * Backend API communication.
 * @module api
 */

import {
  getSessionId,
  getSessionCache,
  getMoveAccuracies,
  getGameDurationMs,
  getGameHistory,
  setGameHistory
} from './state.js';
import { updateCharts, updateStatistics } from './charts.js';

const DEBUG_LOGS = typeof window !== 'undefined' && Boolean(window.LCSTUDY_DEBUG);

/**
 * Fetch game history from the server.
 * Updates game history and progress displays.
 */
export async function loadGameHistory() {
  try {
    const res = await fetch('/api/v1/game-history', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const data = await res.json();
    const history = data.history || [];

    setGameHistory(history);

    updateCharts();
    updateStatistics();
  } catch (e) {
    console.warn('Failed to load game history:', e);
  }
}

/**
 * Save a completed game to the server.
 * @param {'finished' | 'incomplete'} result - Game result
 */
export async function saveCompletedGame(result) {
  const sessionId = getSessionId();
  const moveAccuracies = getMoveAccuracies();

  if (!sessionId || moveAccuracies.length === 0) {
    return;
  }

  const sessionCache = getSessionCache();
  const maiaLevel = sessionCache.maiaLevel || window.currentMaiaLevel || 1500;
  const totalMoves = moveAccuracies.length;
  const accuracyHistory = [...moveAccuracies];
  const averageAccuracy = totalMoves > 0
    ? accuracyHistory.reduce((sum, value) => sum + value, 0) / totalMoves
    : 0;
  const durationMs = getGameDurationMs();

  if (DEBUG_LOGS) {
    console.debug('saveCompletedGame payload', {
      sessionId,
      totalMoves,
      averageAccuracy,
      durationMs
    });
  }

  try {
    const res = await fetch(`/api/v1/session/${sessionId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        total_moves: totalMoves,
        average_accuracy: averageAccuracy,
        accuracy_history: accuracyHistory,
        maia_level: maiaLevel,
        duration_ms: durationMs,
        result: result
      })
    });

    if (!res.ok) {
      console.error('Failed to persist game', res.status, await res.text());
    }
  } catch (e) {
    console.warn('Failed to persist game:', e);
  }

  // Update local history
  const gameHistory = getGameHistory();
  gameHistory.push({
    average_accuracy: averageAccuracy,
    total_moves: totalMoves,
    accuracy_history: accuracyHistory,
    maia_level: maiaLevel,
    duration_ms: durationMs,
    result: result
  });
  setGameHistory(gameHistory);

  updateCharts();
  updateStatistics();
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
      credentials: 'same-origin',
      cache: 'no-store',
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
