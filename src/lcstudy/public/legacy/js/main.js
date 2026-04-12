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
  resetMoveHistoryState,
  getSessionCache,
  setSoundEnabled
} from './modules/state.js';
import { loadDependencies } from './modules/loaders.js';
import { initBoard, setFlip, updateBoardFromFen, setMoveSubmitCallback } from './modules/board.js';
import { initializeCharts, resetMoveAccuracyChart, updateStatistics } from './modules/charts.js';
import { initAudioUnlockListeners, unlockAudio } from './modules/audio.js';
import { updateMoveFeedback } from './modules/effects.js';
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
import { initKeyboardNavigation } from './modules/history.js';

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

function setZenMode(enabled) {
  document.body.classList.toggle('zen-mode', enabled);

  const toggle = document.getElementById('zen-toggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    toggle.setAttribute('aria-label', enabled ? 'Exit zen mode' : 'Enter zen mode');
  }
}

/**
 * Start a new game session.
 */
async function startNewGame() {
  // Pick random Maia level
  const maiaLevel = MAIA_LEVELS[Math.floor(Math.random() * MAIA_LEVELS.length)];
  window.currentMaiaLevel = maiaLevel;

  // Create session on server
  const data = await createSession(maiaLevel);
  if (!data) return;

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

  // Initialize chess engine
  const startingFen = data.starting_fen || STARTING_FEN;
  const currentFenValue = data.fen || startingFen;

  if (typeof window.Chess !== 'function') {
    console.error('chess.js not available');
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
    initializeCharts();

    // Set up move submission callback
    setMoveSubmitCallback(submitMove);

    // Load history and start game
    await loadGameHistory();
    await startNewGame();

    // Set up keyboard navigation
    initKeyboardNavigation();
  } catch (err) {
    console.error('LcStudy bootstrap failed', err);
  }
}

// =============================================================================
// Event Listeners
// =============================================================================

// New game button
document.getElementById('new')?.addEventListener('click', async () => {
  try { unlockAudio(); } catch (e) {}
  await startNewGame();
});

document.getElementById('zen-toggle')?.addEventListener('click', () => {
  setZenMode(!document.body.classList.contains('zen-mode'));
});

document.getElementById('zen-exit')?.addEventListener('click', () => {
  setZenMode(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setZenMode(false);
  }
});

// =============================================================================
// Bootstrap
// =============================================================================

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  void bootstrap();
}
