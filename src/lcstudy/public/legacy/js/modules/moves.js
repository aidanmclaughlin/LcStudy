/**
 * Move validation, submission, and round management.
 * @module moves
 */

import { ATTEMPT_LIMIT } from './constants.js';
import {
  getSessionId,
  getSessionCache,
  updateSessionCache,
  getChessEngine,
  getCurrentFen,
  setCurrentFen,
  setLiveFen,
  getCurrentMoveAttempts,
  setCurrentMoveAttempts,
  getCorrectStreak,
  setCorrectStreak,
  pushGameAttempt,
  addToTotalAttempts,
  incrementMoveCounter,
  pushPgnMove,
  pushMoveHistory,
  getTotalAttempts,
  getMoveCounter
} from './state.js';
import { updateBoardFromFen } from './board.js';
import { flashBoard, celebrateSuccess, showStreakPill, updateAttemptsRemaining } from './effects.js';
import { updateCharts, updateStatistics } from './charts.js';
import { updatePgnDisplay } from './pgn.js';
import { saveCompletedGame, loadGameHistory } from './api.js';

/** Callback to start a new game */
let onGameComplete = null;

/**
 * Set the callback for when a game completes.
 * @param {function(): Promise<void>} callback
 */
export function setGameCompleteCallback(callback) {
  onGameComplete = callback;
}

/**
 * Coerce a value to a valid non-negative integer index.
 * @param {*} value - Value to coerce
 * @returns {number} Valid index
 */
export function coerceIndex(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  return Math.floor(numeric);
}

/**
 * Get the current round being played.
 * @returns {Object|null} Current round or null
 */
export function getCurrentRound() {
  const sessionCache = getSessionCache();
  const roundIndex = coerceIndex(sessionCache.roundIndex);
  return sessionCache.rounds[roundIndex] || null;
}

/**
 * Determine if a move index belongs to the player.
 * @param {number} index - Move index (0-indexed ply)
 * @returns {boolean} True if this is a player move
 */
export function isPlayerMove(index) {
  if (typeof index !== 'number' || index < 0) return false;

  const sessionCache = getSessionCache();
  const playerColor = sessionCache.flip ? 'b' : 'w';
  const isWhitePly = index % 2 === 0;

  return playerColor === 'w' ? isWhitePly : !isWhitePly;
}

/**
 * Get the player's color.
 * @returns {'w' | 'b'} Player color
 */
export function getPlayerColor() {
  const sessionCache = getSessionCache();
  return sessionCache.flip ? 'b' : 'w';
}

/**
 * Build rounds array from moves array.
 * Groups player moves with their Maia replies.
 * @param {Array} moves - Array of move objects
 * @returns {Array} Array of round objects
 */
export function buildRoundsFromMoves(moves) {
  if (!Array.isArray(moves)) return [];

  const sessionCache = getSessionCache();
  const playerIsWhite = !sessionCache.flip;
  const rounds = [];

  for (let idx = 0; idx < moves.length; idx++) {
    const isPlayer = playerIsWhite ? idx % 2 === 0 : idx % 2 === 1;
    if (!isPlayer) continue;

    const playerMove = moves[idx];
    const replyIndex = idx + 1 < moves.length ? idx + 1 : null;
    const replyMove = replyIndex !== null ? moves[replyIndex] : undefined;

    rounds.push({
      player: playerMove,
      reply: replyMove,
      playerIndex: idx,
      replyIndex: replyIndex
    });
  }

  return rounds;
}

/**
 * Update round index based on current ply.
 */
export function updateRoundIndexFromCurrentIndex() {
  const sessionCache = getSessionCache();

  if (!Array.isArray(sessionCache.rounds)) {
    updateSessionCache({ roundIndex: 0 });
    return;
  }

  const currentPly = coerceIndex(sessionCache.currentIndex);
  let completed = 0;

  for (const round of sessionCache.rounds) {
    if (round && typeof round.playerIndex === 'number' && round.playerIndex < currentPly) {
      completed++;
    }
  }

  updateSessionCache({ roundIndex: completed });
}

/**
 * Get the expected player move for the current position.
 * @returns {Object|null} Expected move info or null
 */
export function getExpectedPlayerMove() {
  const sessionCache = getSessionCache();

  if (!Array.isArray(sessionCache.rounds)) return null;

  const roundIndex = coerceIndex(sessionCache.roundIndex);
  const round = sessionCache.rounds[roundIndex];

  if (!round || !round.player) return null;

  return {
    index: typeof round.playerIndex === 'number' ? round.playerIndex : roundIndex,
    move: round.player,
    roundIndex,
    round
  };
}

/**
 * Apply a move to the board and update state.
 * @param {Object} moveDef - Move definition {uci, san}
 * @param {boolean} isUserMove - Whether this was the user's move
 * @returns {Object|null} Chess.js move result or null
 */
export function applyMoveToBoard(moveDef, isUserMove) {
  const chessEngine = getChessEngine();
  if (!chessEngine || !moveDef) return null;

  const norm = moveDef.uci.toLowerCase();
  const from = norm.slice(0, 2);
  const to = norm.slice(2, 4);
  const promotion = norm.length > 4 ? norm.slice(4) : undefined;

  const moveResult = chessEngine.move({ from, to, promotion });

  if (!moveResult) {
    console.warn('applyMoveToBoard failed', { moveDef, isUserMove, fen: chessEngine.fen(), norm });
    return null;
  }

  const fenAfter = chessEngine.fen();
  setCurrentFen(fenAfter);
  setLiveFen(fenAfter);
  updateBoardFromFen(fenAfter);

  const san = moveResult.san || moveDef.san || moveDef.uci;
  pushMoveHistory(fenAfter, san, isUserMove);
  pushPgnMove(san);

  return moveResult;
}

/**
 * Handle Maia's reply move after player moves.
 * @param {Object} round - Current round object
 * @returns {Object|null} Chess.js move result or null
 */
export function handleMaiaReply(round) {
  if (!round || !round.reply) return null;
  return applyMoveToBoard(round.reply, false);
}

/**
 * Complete the expected move (correct or auto-played).
 * @param {Object} expectedInfo - Expected move info
 * @param {number} attemptsForMove - Number of attempts used
 * @param {boolean} isAutoPlay - Whether this was auto-played
 * @returns {Promise<boolean>} Success
 */
export async function completeExpectedMove(expectedInfo, attemptsForMove, isAutoPlay) {
  const moveResult = applyMoveToBoard(expectedInfo.move, true);

  if (!moveResult) {
    console.warn('Move application failed', expectedInfo.move);
    flashBoard('wrong');
    return false;
  }

  if (isAutoPlay) {
    flashBoard('illegal');
    setCorrectStreak(0);
  } else {
    flashBoard('success');
    setCorrectStreak(getCorrectStreak() + 1);

    if (expectedInfo.move && typeof expectedInfo.move.uci === 'string') {
      const targetSquare = expectedInfo.move.uci.slice(2, 4);
      celebrateSuccess(targetSquare);
    }
  }

  showStreakPill();
  setCurrentMoveAttempts(0);
  pushGameAttempt(attemptsForMove);
  addToTotalAttempts(attemptsForMove);
  incrementMoveCounter();
  updateAttemptsRemaining(ATTEMPT_LIMIT);

  const sessionCache = getSessionCache();
  updateSessionCache({ currentIndex: expectedInfo.index + 1 });

  // Handle Maia's reply
  const round = expectedInfo.round;
  if (round && round.reply) {
    const replyResult = handleMaiaReply(round);
    if (!replyResult) {
      console.warn('Failed to apply Maia reply', round.reply);
    } else {
      const replyIndex = typeof round.replyIndex === 'number' ? round.replyIndex : expectedInfo.index;
      const newIndex = Math.max(sessionCache.currentIndex, replyIndex + 1);
      updateSessionCache({ currentIndex: newIndex });
    }
  }

  updateSessionCache({ roundIndex: coerceIndex(expectedInfo.roundIndex) + 1 });
  updateRoundIndexFromCurrentIndex();

  updateCharts();
  updateStatistics(getTotalAttempts(), getMoveCounter());
  updatePgnDisplay();

  // Check if game is complete
  const updatedCache = getSessionCache();
  if (updatedCache.currentIndex >= updatedCache.moves.length) {
    await saveCompletedGame('finished');
    await loadGameHistory();

    if (onGameComplete) {
      setTimeout(async () => {
        await onGameComplete();
      }, 2500);
    }
  }

  return true;
}

/**
 * Submit a move attempt.
 * @param {string} moveUci - UCI move string (e.g., 'e2e4')
 */
export async function submitMove(moveUci) {
  const sessionId = getSessionId();
  const sessionCache = getSessionCache();

  if (!sessionId || !sessionCache.moves.length) return;

  const expectedInfo = getExpectedPlayerMove();
  if (!expectedInfo) {
    console.warn('No expected move remaining');
    return;
  }

  let normalized = moveUci.toLowerCase();
  const expectedUci = expectedInfo.move.uci.toLowerCase();

  // Auto-add promotion if missing
  if (expectedUci.length === 5 && normalized.length === 4) {
    normalized += expectedUci[4];
  }

  console.debug('submitMove', {
    input: moveUci,
    normalized,
    expected: expectedUci,
    expectedIndex: expectedInfo.index,
    currentIndex: sessionCache.currentIndex,
    flip: sessionCache.flip,
    movesLength: sessionCache.moves.length,
    roundIndex: sessionCache.roundIndex
  });

  const attemptsForMove = getCurrentMoveAttempts() + 1;

  if (normalized !== expectedUci) {
    // Wrong move
    setCurrentMoveAttempts(attemptsForMove);
    console.warn('Incorrect move', normalized, 'expected', expectedUci);
    flashBoard('wrong');
    updateAttemptsRemaining(Math.max(0, ATTEMPT_LIMIT - attemptsForMove));
    setCorrectStreak(0);
    showStreakPill();
    updateBoardFromFen(getCurrentFen());

    // Auto-play if out of attempts
    if (attemptsForMove >= ATTEMPT_LIMIT) {
      console.info('Auto-playing move after reaching attempt limit', expectedInfo.move);
      await completeExpectedMove(expectedInfo, ATTEMPT_LIMIT, true);
    }
    return;
  }

  // Correct move
  await completeExpectedMove(expectedInfo, attemptsForMove, false);
}
