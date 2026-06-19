/**
 * LcStudy - Chess Training Application
 * Entry point and bootstrap.
 *
 * @module main
 */

import { MAIA_LEVELS, STARTING_FEN } from './modules/constants.js';
import {
  setSessionId,
  updateSessionCache,
  setChessEngine,
  setCurrentFen,
  setLiveFen,
  resetGameProgress,
  startGameTimer,
  resetMoveHistoryState,
  getSessionCache,
  setSoundEnabled
} from './modules/state.js';
import { loadDependencies } from './modules/loaders.js';
import { initBoard, setBoardInputEnabled, setFlip, setReviewingIndicator, updateBoardFromFen, setMoveSubmitCallback } from './modules/board.js';
import { initializeCharts, resetMoveAccuracyChart, updateCharts, updateStatistics } from './modules/charts.js';
import { initAudioUnlockListeners, unlockAudio } from './modules/audio.js';
import { initializeHaptics } from './modules/haptics.js';
import { hideCompletionOverlay, updateMoveFeedback } from './modules/effects.js';
import { updatePgnDisplay } from './modules/pgn.js';
import { loadGameHistory, createSession } from './modules/api.js';
import {
  submitMove,
  buildRoundsFromMoves,
  updateRoundIndexFromCurrentIndex,
  coerceIndex,
  applyMoveToBoard,
  isPlayerMove,
  clearPendingCompletedGame
} from './modules/moves.js';
import { initKeyboardNavigation, initMoveReviewButtons, navigateToMove } from './modules/history.js';

const DEBUG_LOGS = typeof window !== 'undefined' && Boolean(window.LCSTUDY_DEBUG);
let activeGameLoadId = 0;

/**
 * Initialize sound settings.
 * Sound is always enabled by default.
 */
function initSoundSettings() {
  setSoundEnabled(true);
  try {
    localStorage.removeItem('lcstudy_sound');
  } catch (e) {}
}

/**
 * Start a new game session.
 */
async function startNewGame() {
  const loadId = ++activeGameLoadId;
  setBoardInputEnabled(false);
  updateMoveFeedback({ loading: true });
  hideCompletionOverlay();
  setReviewingIndicator(false);

  // Pick random Maia level
  const maiaLevel = MAIA_LEVELS[Math.floor(Math.random() * MAIA_LEVELS.length)];
  window.currentMaiaLevel = maiaLevel;

  // Create session on server
  let data = null;
  try {
    data = await createSession(maiaLevel);
  } catch (error) {
    if (loadId === activeGameLoadId) {
      updateMoveFeedback({ error: true });
    }
    throw error;
  }

  if (loadId !== activeGameLoadId) return;

  if (!data) {
    updateMoveFeedback({ error: true });
    return;
  }

  clearPendingCompletedGame();

  // Update session state
  setSessionId(data.id);
  updateSessionCache({
    sessionId: data.id,
    gameId: data.game_id,
    moves: Array.isArray(data.moves) ? data.moves : [],
    flip: Boolean(data.flip),
    currentIndex: coerceIndex(data.ply),
    maiaLevel: data.maia_level || maiaLevel,
    rounds: [],
    roundIndex: 0
  });

  const sessionCache = getSessionCache();

  // Build rounds from moves
  sessionCache.rounds = buildRoundsFromMoves(sessionCache.moves);
  updateRoundIndexFromCurrentIndex();

  if (DEBUG_LOGS) {
    console.debug('Session initialized', {
      sessionId: data.id,
      gameId: sessionCache.gameId,
      moves: sessionCache.moves.length,
      currentIndex: sessionCache.currentIndex,
      flip: sessionCache.flip,
      roundIndex: sessionCache.roundIndex,
      totalRounds: sessionCache.rounds.length,
      nextRound: sessionCache.rounds[sessionCache.roundIndex] || null
    });
  }

  // Initialize chess engine
  const startingFen = data.starting_fen || STARTING_FEN;
  const currentFenValue = data.fen || startingFen;

  if (typeof window.Chess !== 'function') {
    console.error('chess.js not available');
    updateMoveFeedback({ error: true });
    return;
  }

  const engine = new window.Chess(startingFen);
  setChessEngine(engine);

  // Set board orientation
  setFlip(sessionCache.flip);

  // Reset game state
  resetGameProgress();
  resetMoveHistoryState();
  resetMoveAccuracyChart();
  updateCharts();
  updateStatistics();
  initSoundSettings();
  setCurrentFen(startingFen);
  setLiveFen(startingFen);
  updateBoardFromFen(startingFen);

  // Apply historical moves
  if (Array.isArray(sessionCache.moves) && sessionCache.moves.length > 0) {
    for (let idx = 0; idx < sessionCache.currentIndex; idx++) {
      const moveDef = sessionCache.moves[idx];
      if (!applyMoveToBoard(moveDef, isPlayerMove(idx))) {
        console.warn('Failed to apply historical move', moveDef);
        break;
      }
    }
  }

  updateRoundIndexFromCurrentIndex();

  // Load current position
  if (currentFenValue) {
    engine.load(currentFenValue);
  }

  const currentFen = engine.fen();
  setCurrentFen(currentFen);
  setLiveFen(currentFen);

  // Update UI
  updateBoardFromFen(currentFen);
  updatePgnDisplay();
  updateMoveFeedback();
  startGameTimer();
  setBoardInputEnabled(true);

  // Set up audio unlock listeners
  initAudioUnlockListeners();
}

/**
 * Bootstrap the application.
 */
async function bootstrap() {
  try {
    // Load dependencies
    await loadDependencies();

    // Initialize UI
    initBoard();
    initializeHaptics();
    setBoardInputEnabled(false);
    initializeCharts();

    // Set up move submission callback
    setMoveSubmitCallback(submitMove);

    // Load history and start the first game in parallel.
    await Promise.all([
      loadGameHistory(),
      startNewGame()
    ]);

    // Set up keyboard navigation
    initKeyboardNavigation();
    initMoveReviewButtons();
  } catch (err) {
    console.error('LcStudy bootstrap failed', err);
  }
}

// =============================================================================
// Event Listeners
// =============================================================================

document.getElementById('completion-new')?.addEventListener('click', async () => {
  try { unlockAudio(); } catch (e) {}
  await startNewGame();
});

document.getElementById('completion-review')?.addEventListener('click', () => {
  navigateToMove(-2);
});

// =============================================================================
// Bootstrap
// =============================================================================

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  void bootstrap();
}
