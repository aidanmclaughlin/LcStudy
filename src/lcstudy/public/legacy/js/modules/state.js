/**
 * Centralized game state management.
 * @module state
 */

import { STARTING_FEN } from './constants.js';

// =============================================================================
// Session State
// =============================================================================

/** Current session ID from the server */
let sessionId = null;

/** Session cache containing game data */
const sessionCache = {
  sessionId: null,
  gameId: null,
  moves: [],
  currentIndex: 0,
  rounds: [],
  roundIndex: 0,
  flip: false,
  maiaLevel: 1500
};

// =============================================================================
// Board State
// =============================================================================

/** Currently selected square (e.g., 'e2') */
let selectedSquare = null;

/** Current board position in FEN notation */
let currentFen = STARTING_FEN;

/** Current side to move ('white' or 'black') */
let currentTurn = 'white';

/** Whether the board is flipped (playing as black) */
let boardIsFlipped = false;

/** MutationObserver for board element */
let boardObserver = null;

/** Flag to prevent recursive board rebuilds */
let isRebuildingBoard = false;

/** Chess.js engine instance */
let chessEngine = null;

// =============================================================================
// Game Progress State
// =============================================================================

/** Accuracy of the first try at each move in the current game: the logged score */
let moveAccuracies = [];

/**
 * The moves tried at each move, in order, as [uci, accuracy] pairs, parallel to
 * moveAccuracies. Logged, never scored. A repeat isn't logged again (it only
 * counts as a try), which keeps the save payload small however much a move is retried.
 */
let moveTries = [];

/** Tries in the current game, repeats included */
let tryCount = 0;

/** Current move number (1-indexed) */
let moveCounter = 1;

/** PGN moves for display */
let pgnMoves = [];

/** Historical games data */
let gameHistory = [];

/** Current correct move streak */
let correctStreak = 0;

// =============================================================================
// Move Navigation State
// =============================================================================

/** Array of {fen, san, isUserMove, from, to} for navigation */
let moveHistory = [];

/** Current position in move history (-1 = live position) */
let currentMoveIndex = -1;

/** Whether user is reviewing past positions */
let isReviewingMoves = false;

/** The actual current game position (not historical) */
let liveFen = STARTING_FEN;

/** Last visible move squares by side for the live position */
let lastMoveHighlights = { user: null, opponent: null };

// =============================================================================
// Chart State
// =============================================================================

/** Chart.js per-move accuracy chart instance */
let moveAccuracyChart = null;

// =============================================================================
// Audio State
// =============================================================================

/** Whether sound effects are enabled */
let soundEnabled = true;

/** Web Audio API context */
let audioContext = null;

// =============================================================================
// Loader State
// =============================================================================

/** Promise for Chart.js loading */
let chartLoaderPromise = null;

/** Promise for chess.js loading */
let chessLoaderPromise = null;

// =============================================================================
// Getters
// =============================================================================

export function getSessionId() { return sessionId; }
export function getSessionCache() { return sessionCache; }
export function getSelectedSquare() { return selectedSquare; }
export function getCurrentFen() { return currentFen; }
export function getCurrentTurn() { return currentTurn; }
export function isBoardFlipped() { return boardIsFlipped; }
export function getBoardObserver() { return boardObserver; }
export function isRebuilding() { return isRebuildingBoard; }
export function getChessEngine() { return chessEngine; }
export function getMoveAccuracies() { return moveAccuracies; }
export function getMoveTries() { return moveTries; }
export function getTryCount() { return tryCount; }
export function getMoveCounter() { return moveCounter; }
export function getPgnMoves() { return pgnMoves; }
export function getGameHistory() { return gameHistory; }
export function getCorrectStreak() { return correctStreak; }
export function getMoveHistory() { return moveHistory; }
export function getCurrentMoveIndex() { return currentMoveIndex; }
export function getIsReviewingMoves() { return isReviewingMoves; }
export function getLiveFen() { return liveFen; }
export function getLastMoveHighlights() { return lastMoveHighlights; }
export function getMoveAccuracyChart() { return moveAccuracyChart; }
export function isSoundEnabled() { return soundEnabled; }
export function getAudioContext() { return audioContext; }
export function getChartLoaderPromise() { return chartLoaderPromise; }
export function getChessLoaderPromise() { return chessLoaderPromise; }

// =============================================================================
// Setters
// =============================================================================

export function setSessionId(id) { sessionId = id; }
export function setSelectedSquare(square) { selectedSquare = square; }
export function setCurrentFen(fen) { currentFen = fen; }
export function setCurrentTurn(turn) { currentTurn = turn; }
export function setBoardFlipped(flipped) { boardIsFlipped = flipped; }
export function setBoardObserver(observer) { boardObserver = observer; }
export function setIsRebuildingBoard(rebuilding) { isRebuildingBoard = rebuilding; }
export function setChessEngine(engine) { chessEngine = engine; }
export function setMoveAccuracies(accuracies) { moveAccuracies = accuracies; }
export function setMoveCounter(counter) { moveCounter = counter; }
export function setPgnMoves(moves) { pgnMoves = moves; }
export function setGameHistory(history) { gameHistory = history; }
export function setCorrectStreak(streak) { correctStreak = streak; }
export function setMoveHistory(history) { moveHistory = history; }
export function setCurrentMoveIndex(index) { currentMoveIndex = index; }
export function setIsReviewingMoves(reviewing) { isReviewingMoves = reviewing; }
export function setLiveFen(fen) { liveFen = fen; }
export function setLastMoveHighlights(highlights) { lastMoveHighlights = highlights; }
export function setMoveAccuracyChart(chart) { moveAccuracyChart = chart; }
export function setSoundEnabled(enabled) { soundEnabled = enabled; }
export function setAudioContext(ctx) { audioContext = ctx; }
export function setChartLoaderPromise(promise) { chartLoaderPromise = promise; }
export function setChessLoaderPromise(promise) { chessLoaderPromise = promise; }

// =============================================================================
// Session Cache Helpers
// =============================================================================

export function updateSessionCache(updates) {
  Object.assign(sessionCache, updates);
}

export function resetSessionCache() {
  sessionCache.sessionId = null;
  sessionCache.gameId = null;
  sessionCache.moves = [];
  sessionCache.currentIndex = 0;
  sessionCache.rounds = [];
  sessionCache.roundIndex = 0;
  sessionCache.flip = false;
  sessionCache.maiaLevel = 1500;
}

// =============================================================================
// Game State Helpers
// =============================================================================

/**
 * Reset all game progress state for a new game.
 */
export function resetGameProgress() {
  moveAccuracies = [];
  moveTries = [];
  tryCount = 0;
  moveCounter = 1;
  pgnMoves = [];
  correctStreak = 0;
}

/**
 * Record the first try at a move.
 * @param {number} accuracy - Accuracy percentage
 */
export function pushMoveScore(accuracy) {
  moveAccuracies.push(accuracy);
  moveTries.push([]);
}

/**
 * Count one try at the latest move, first or retry, and log the move if it
 * hasn't been tried there yet.
 * @param {string} uci - The move tried
 * @param {number} accuracy - Accuracy percentage
 */
export function pushTry(uci, accuracy) {
  tryCount += 1;
  const tries = moveTries.at(-1);
  if (tries && !tries.some(([tried]) => tried === uci)) tries.push([uci, accuracy]);
}

/**
 * The game's accuracy: the mean of the first try at each move.
 * @returns {number|null} Accuracy percentage, or null before the first move
 */
export function getGameAccuracy() {
  if (moveAccuracies.length === 0) return null;
  return moveAccuracies.reduce((sum, accuracy) => sum + accuracy, 0) / moveAccuracies.length;
}

/**
 * Add a move to PGN moves array.
 * @param {string} san - SAN notation of the move
 */
export function pushPgnMove(san) {
  pgnMoves.push(san);
}

/**
 * Increment move counter.
 */
export function incrementMoveCounter() {
  moveCounter += 1;
}

// =============================================================================
// Move History Helpers
// =============================================================================

/**
 * Add a move to the navigation history.
 * @param {string} fen - Position after the move
 * @param {string} san - SAN notation
 * @param {boolean} isUserMove - Whether this was the user's move
 * @param {{from: string, to: string}|null} moveSquares - Move source/destination
 */
export function pushMoveHistory(fen, san, isUserMove, moveSquares = null) {
  const previousHighlights = moveHistory.length > 0
    ? moveHistory[moveHistory.length - 1].highlights
    : { user: null, opponent: null };
  const highlightKey = isUserMove ? 'user' : 'opponent';
  const highlights = {
    user: previousHighlights?.user ? { ...previousHighlights.user } : null,
    opponent: previousHighlights?.opponent ? { ...previousHighlights.opponent } : null
  };

  if (moveSquares?.from && moveSquares?.to) {
    highlights[highlightKey] = {
      from: moveSquares.from,
      to: moveSquares.to
    };
  }

  moveHistory.push({
    fen,
    san,
    isUserMove,
    from: moveSquares?.from || null,
    to: moveSquares?.to || null,
    highlights
  });
}

/**
 * Remember the latest move squares for the live position.
 * @param {boolean} isUserMove - Whether this was the user's move
 * @param {{from: string, to: string}} moveSquares - Move source/destination
 */
export function setLastMoveHighlight(isUserMove, moveSquares) {
  const key = isUserMove ? 'user' : 'opponent';
  lastMoveHighlights = {
    ...lastMoveHighlights,
    [key]: moveSquares
  };
}

/**
 * Get last user/opponent move highlights at a history index.
 * @param {number} targetIndex - Move history index
 * @returns {{user: Object|null, opponent: Object|null}}
 */
export function getMoveHighlightsForIndex(targetIndex) {
  const move = moveHistory[Math.min(targetIndex, moveHistory.length - 1)];
  const highlights = move?.highlights;

  return {
    user: highlights?.user || null,
    opponent: highlights?.opponent || null
  };
}

/**
 * Reset move history for a new game.
 */
export function resetMoveHistoryState() {
  moveHistory = [];
  currentMoveIndex = -1;
  isReviewingMoves = false;
  liveFen = STARTING_FEN;
  lastMoveHighlights = { user: null, opponent: null };
}

/**
 * Update the live FEN position.
 * @param {string} fen - New FEN position
 */
export function updateLiveFen(fen) {
  liveFen = fen;
  if (!isReviewingMoves) {
    currentFen = fen;
  }
}
