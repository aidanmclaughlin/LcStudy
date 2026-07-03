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
import { getMoveTimesMs, getThinkTimeMs } from './timeclock.js';
import { getSuggestedThinkMs, refreshCoach } from './coach.js';
import { scheduleChartsUpdate } from './charts.js';

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
    scheduleChartsUpdate();
  } catch (e) {
    console.warn('Failed to load game history:', e);
  }
}

/**
 * Save a completed game to the server.
 * Fire-and-forget with keepalive so the request survives tab closes; the
 * local history is updated immediately either way.
 * @param {'finished' | 'incomplete'} result - Game result
 */
export function saveCompletedGame(result) {
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
  const thinkTimeMs = getThinkTimeMs();
  const moveTimesMs = getMoveTimesMs();
  const suggestedThinkMs = getSuggestedThinkMs();

  if (DEBUG_LOGS) {
    console.debug('saveCompletedGame payload', {
      sessionId,
      totalMoves,
      averageAccuracy,
      durationMs,
      thinkTimeMs
    });
  }

  const payload = {
    total_moves: totalMoves,
    average_accuracy: averageAccuracy,
    accuracy_history: accuracyHistory,
    maia_level: maiaLevel,
    duration_ms: durationMs,
    think_time_ms: thinkTimeMs,
    move_times_ms: moveTimesMs,
    suggested_think_ms: suggestedThinkMs,
    result: result
  };

  fetch(`/api/v1/session/${sessionId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    keepalive: true,
    body: JSON.stringify(payload)
  }).then((res) => {
    if (!res.ok) {
      console.error('Failed to persist game', res.status);
    }
    // New data → fresh suggestion for the next game.
    refreshCoach();
  }).catch((e) => {
    console.warn('Failed to persist game:', e);
  });

  // Update local history immediately.
  const gameHistory = getGameHistory();
  gameHistory.push({
    average_accuracy: averageAccuracy,
    total_moves: totalMoves,
    accuracy_history: accuracyHistory,
    maia_level: maiaLevel,
    duration_ms: durationMs,
    think_time_ms: thinkTimeMs,
    suggested_think_ms: suggestedThinkMs,
    result: result
  });
  setGameHistory(gameHistory);
  scheduleChartsUpdate();
}

/**
 * Create a new game session on the server.
 * @param {number} maiaLevel - Maia difficulty level
 * @param {string|null} excludeGameId - Game to avoid picking (current game)
 * @returns {Promise<Object|null>} Session data or null on failure
 */
export async function createSession(maiaLevel, excludeGameId = null) {
  const payload = { maia_level: maiaLevel, exclude_game_id: excludeGameId };

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
