/**
 * LcStudy - Chess Training Application
 * Entry point and bootstrap.
 *
 * @module main
 */

import { MAIA_LEVELS, STARTING_FEN, PIECE_IMAGES } from './modules/constants.js';
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
  getMoveAccuracies,
  setSoundEnabled
} from './modules/state.js';
import { loadDependencies, ensureChartJs } from './modules/loaders.js';
import { initBoard, setBoardInputEnabled, setFlip, setReviewingIndicator, updateBoardFromFen, setMoveSubmitCallback } from './modules/board.js';
import { initializeCharts, resetMoveAccuracyChart, scheduleChartsUpdate } from './modules/charts.js';
import { initAudioUnlockListeners, unlockAudio } from './modules/audio.js';
import { initializeHaptics } from './modules/haptics.js';
import { hideCompletionOverlay, updateMoveFeedback } from './modules/effects.js';
import { updatePgnDisplay } from './modules/pgn.js';
import { loadGameHistory, createSession, saveCompletedGame } from './modules/api.js';
import {
  submitMove,
  buildRoundsFromMoves,
  updateRoundIndexFromCurrentIndex,
  coerceIndex,
  applyMoveToBoard,
  isPlayerMove,
  clearPendingCompletedGame,
  isGameSaved,
  markGameSaved
} from './modules/moves.js';
import { initKeyboardNavigation, initMoveReviewButtons, navigateToMove } from './modules/history.js';
import { startGameClock, endGameClock, promptBegin } from './modules/timeclock.js';
import { refreshCoach, applyCoachBudget, startCoachTicker } from './modules/coach.js';

const DEBUG_LOGS = typeof window !== 'undefined' && Boolean(window.LCSTUDY_DEBUG);
let activeGameLoadId = 0;

/** In-flight request for the next game, started while the current one is played */
let prefetchedSessionPromise = null;

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

function pickMaiaLevel() {
  return MAIA_LEVELS[Math.floor(Math.random() * MAIA_LEVELS.length)];
}

/**
 * Start fetching the next session in the background so "New Game" is instant.
 * @param {string|null} excludeGameId - The game currently being played
 */
function prefetchNextSession(excludeGameId) {
  prefetchedSessionPromise = createSession(pickMaiaLevel(), excludeGameId)
    .catch((error) => {
      if (DEBUG_LOGS) console.debug('Session prefetch failed', error);
      return null;
    });
}

/**
 * Persist an abandoned game (≥5 scored moves) before its state is reset.
 */
function saveAbandonedGameIfNeeded() {
  if (isGameSaved()) return;
  if (getMoveAccuracies().length < 5) return;

  markGameSaved();
  endGameClock();
  saveCompletedGame('incomplete');
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

  saveAbandonedGameIfNeeded();

  const maiaLevel = pickMaiaLevel();
  window.currentMaiaLevel = maiaLevel;

  // Use the prefetched session when available; fall back to a live request.
  let data = null;
  try {
    if (prefetchedSessionPromise) {
      data = await prefetchedSessionPromise;
      prefetchedSessionPromise = null;
    }
    if (!data) {
      data = await createSession(maiaLevel);
    }
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
  scheduleChartsUpdate();
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

  // Think-time coach: apply the budget and start the clock on the first prompt
  applyCoachBudget();
  startGameClock();
  promptBegin();

  // Warm the next game while this one is played
  prefetchNextSession(sessionCache.gameId);

  // Set up audio unlock listeners
  initAudioUnlockListeners();
}

/**
 * Decode piece SVGs before they are first needed so the first moves never
 * flash empty squares.
 */
function warmPieceImages() {
  const warm = () => {
    Object.values(PIECE_IMAGES).forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm, { timeout: 2000 });
  } else {
    window.setTimeout(warm, 300);
  }
}

/**
 * Bootstrap the application.
 */
async function bootstrap() {
  try {
    // Load what the first move needs (chess.js only — charts come later)
    await loadDependencies();

    // Initialize UI
    initBoard();
    initializeHaptics();
    setBoardInputEnabled(false);
    startCoachTicker();

    // Set up move submission callback
    setMoveSubmitCallback(submitMove);

    // Charts initialize in the background; gameplay never waits on them.
    ensureChartJs()
      .then(() => {
        initializeCharts();
        scheduleChartsUpdate();
      })
      .catch((err) => console.warn('Charts unavailable', err));

    // Coach suggestion, history, and the first game load in parallel.
    refreshCoach();
    warmPieceImages();
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

// Persist abandoned games when the tab goes away (keepalive request).
window.addEventListener('pagehide', () => {
  saveAbandonedGameIfNeeded();
});

// =============================================================================
// Bootstrap
// =============================================================================

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  void bootstrap();
}
