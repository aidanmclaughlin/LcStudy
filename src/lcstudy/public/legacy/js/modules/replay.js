/**
 * Replay of missed moves once a game ends.
 *
 * Every move scored below REPLAY_ACCURACY_THRESHOLD is remembered with the
 * position it was played from. When the game ends, New game stays locked
 * until each of those positions has been replayed with Leela's move. A wrong
 * move marks Leela's move on the board, and it still has to be played.
 *
 * A pending replay is kept in localStorage, so a reload or a closed tab
 * reopens it instead of skipping it.
 *
 * @module replay
 */

import {
  getLastMoveHighlights,
  getLiveFen,
  getMoveAccuracies,
  getMoveHistory,
  getPgnMoves,
  isBoardFlipped,
  setCurrentFen,
  setHistoryLimit,
  setLastMoveHighlight,
  setLastMoveHighlights,
  setLiveFen,
  setMoveAccuracies,
  setMoveHistory,
  setPgnMoves,
  updateSessionCache
} from './state.js';
import {
  clearMoveHint,
  clearSelection,
  finishActiveAnimations,
  setFlip,
  showMoveHint,
  updateBoardAfterMove,
  updateBoardFromFen
} from './board.js';
import { celebrateSuccess, clearAccuracyBursts, flashBoard, showCompletionOverlay } from './effects.js';
import { hapticError, hapticSuccess } from './haptics.js';
import { navigateToMove } from './history.js';
import { updatePgnDisplay } from './pgn.js';
import { scheduleChartsUpdate } from './charts.js';

const STORAGE_KEY = 'lcstudy_pending_replay';
const STORAGE_VERSION = 1;

/** Pause on a correct move before the next position appears */
const NEXT_POSITION_DELAY_MS = 650;

/** Missed moves of the current game: {ply, fen, highlights, best, played, accuracy} */
let mistakes = [];

/** How many of them have been replayed with Leela's move */
let replayed = 0;

/** Set when the game ends: {title, fen, highlights} of the game-over position */
let gameOver = null;

/** Chess.js instance for the position being replayed; null when none is on the board */
let replayEngine = null;

/** True from a correct move until the next position appears */
let advancing = false;

/**
 * Forget the previous game's misses when a new game starts.
 */
export function resetReplay() {
  mistakes = [];
  replayed = 0;
  gameOver = null;
  replayEngine = null;
  advancing = false;
}

/**
 * Remember a move scored below the replay threshold.
 * @param {{ply: number, fen: string, highlights: Object, best: {uci: string, san: string}, played: string, accuracy: number}} mistake
 */
export function recordMistake(mistake) {
  if (mistake?.fen && mistake.best?.uci) mistakes.push(mistake);
}

/** Whether the finished game still has missed moves to replay. */
export function hasPendingReplay() {
  return gameOver !== null && replayed < mistakes.length;
}

/** Whether a missed move is on the board waiting for Leela's move. */
export function isReplayActive() {
  return replayEngine !== null;
}

/**
 * Lock New game behind the replay when the game ended with misses. Call
 * before the game-over panel opens so it focuses the right action.
 * @param {string} title - Game-over panel title ("Checkmate" or "Game over")
 */
export function prepareReplay(title) {
  gameOver = { title, fen: getLiveFen(), highlights: getLastMoveHighlights() };
  renderGameOverActions();
  storeReplay();
}

/**
 * Put the first missed move back on the board.
 */
export function startReplay() {
  if (!hasPendingReplay() || isReplayActive()) return;

  try {
    finishActiveAnimations();
    clearAccuracyBursts();
    setPanelReplaying(true);
    showMistake();
  } catch (error) {
    abandonReplay(error);
  }
}

/**
 * Handle a move played during the replay. Only Leela's move continues; any
 * other legal move shakes the board and marks Leela's move until it is played.
 * @param {string} moveUci - UCI move string (e.g. 'e2e4')
 */
export function submitReplayMove(moveUci) {
  if (!isReplayActive() || advancing) return;

  const mistake = mistakes[replayed];
  const expected = mistake.best.uci.toLowerCase();
  let normalized = moveUci.toLowerCase();

  // A bare pawn push promotes to Leela's piece, as in the game.
  if (expected.length === 5 && normalized.length === 4) normalized += expected[4];

  const legal = replayEngine.moves({ verbose: true }).some((move) => {
    const uci = `${move.from}${move.to}${move.promotion || ''}`;
    return uci === normalized || (normalized.length === 4 && uci.startsWith(normalized));
  });

  if (!legal) {
    flashBoard('illegal', 0.15);
    hapticError();
    return;
  }

  if (normalized !== expected) {
    flashBoard('wrong', 0.5);
    hapticError();
    showMoveHint(expected.slice(0, 2), expected.slice(2, 4), true);
    renderPrompt(`Leela played ${mistake.best.san}. Play it to continue.`);
    return;
  }

  advancing = true;
  const from = expected.slice(0, 2);
  const to = expected.slice(2, 4);
  const moveResult = replayEngine.move({ from, to, promotion: expected[4] });
  const fenAfter = replayEngine.fen();

  setCurrentFen(fenAfter);
  setLiveFen(fenAfter);
  setLastMoveHighlight(true, { from, to });
  clearMoveHint();
  updateBoardAfterMove({ from, to, moveResult });
  flashBoard('success');
  celebrateSuccess(to);
  hapticSuccess();
  renderPrompt(`Correct: ${mistake.best.san}.`);

  window.setTimeout(() => {
    advancing = false;
    replayed += 1;
    storeReplay();

    try {
      if (replayed < mistakes.length) showMistake();
      else finishReplay();
    } catch (error) {
      abandonReplay(error);
    }
  }, NEXT_POSITION_DELAY_MS);
}

/**
 * Reopen a finished game whose missed moves were never replayed (after a
 * reload or a closed tab), with its board, moves, and game-over panel.
 * @returns {boolean} Whether a pending replay was restored
 */
export function restorePendingReplay() {
  const saved = readStoredReplay();

  if (saved) {
    try {
      mistakes = saved.mistakes;
      replayed = saved.replayed;
      gameOver = saved.gameOver;
      setMoveAccuracies(saved.accuracies);
      setPgnMoves(saved.pgnMoves);
      setMoveHistory(saved.moveHistory);
      updateSessionCache({ flip: saved.flip });
      setFlip(saved.flip);
      showFinalPosition();
      scheduleChartsUpdate();
      renderGameOverActions();
      showCompletionOverlay(gameOver.title);
      return true;
    } catch (error) {
      // A new game starts instead; never lock New game behind a broken replay.
      console.error('Could not restore the pending replay', error);
      resetReplay();
    }
  }

  clearStoredReplay();
  return false;
}

/**
 * Show the next missed move as it looked when it was played, with the moves
 * before it as the reviewable history.
 */
function showMistake() {
  const mistake = mistakes[replayed];

  navigateToMove(-1);
  replayEngine = new window.Chess(mistake.fen);
  setHistoryLimit(mistake.ply);
  setCurrentFen(mistake.fen);
  setLiveFen(mistake.fen);
  setLastMoveHighlights(normalizeHighlights(mistake.highlights));
  clearMoveHint();
  clearSelection();
  updateBoardFromFen(mistake.fen);
  updatePgnDisplay();
  renderPrompt(`You played ${mistake.played} (${Number(mistake.accuracy).toFixed(1)}%). Find Leela's move.`);
}

/**
 * Return to the game-over position with New game unlocked.
 */
function finishReplay() {
  replayEngine = null;
  storeReplay();
  setPanelReplaying(false);
  renderGameOverActions();
  showCompletionOverlay(gameOver.title);

  navigateToMove(-1);
  showFinalPosition();
}

/**
 * Never leave New game locked behind a replay that cannot run.
 * @param {Error} error - What went wrong
 */
function abandonReplay(error) {
  console.error('Missed-move replay failed; unlocking New game', error);
  replayed = mistakes.length;
  advancing = false;
  finishReplay();
}

function showFinalPosition() {
  setHistoryLimit(null);
  setCurrentFen(gameOver.fen);
  setLiveFen(gameOver.fen);
  setLastMoveHighlights(normalizeHighlights(gameOver.highlights));
  clearMoveHint();
  updateBoardFromFen(gameOver.fen);
  updatePgnDisplay();
}

function normalizeHighlights(highlights) {
  return { user: highlights?.user || null, opponent: highlights?.opponent || null };
}

// =============================================================================
// Game-over panel
// =============================================================================

/**
 * Show Replay while misses are pending, New game once they are done.
 */
function renderGameOverActions() {
  const pending = mistakes.length - replayed;
  const replayButton = document.getElementById('completion-replay');
  const newGameButton = document.getElementById('completion-new');

  if (replayButton) {
    replayButton.hidden = pending === 0;
    replayButton.textContent = `Replay ${pending} ${pending === 1 ? 'move' : 'moves'}`;
  }
  if (newGameButton) newGameButton.hidden = pending > 0;
}

/**
 * Swap the game-over actions for the replay prompt, or back.
 * @param {boolean} replaying - Whether a missed move is on the board
 */
function setPanelReplaying(replaying) {
  const detail = document.getElementById('completion-detail');
  const actions = document.querySelector('#completion-overlay .completion-actions');

  if (detail) detail.hidden = !replaying;
  if (actions) actions.hidden = replaying;
}

/**
 * Progress, move number, and instruction for the missed move on the board.
 * @param {string} detail - Instruction line
 */
function renderPrompt(detail) {
  const mistake = mistakes[replayed];
  const overlay = document.getElementById('completion-overlay');
  if (overlay) overlay.dataset.result = 'replay';

  setText('completion-title', `Replay ${replayed + 1} of ${mistakes.length}`);
  setText('completion-summary', `Move ${mistake.fen.split(' ')[5]}`);
  setText('completion-detail', detail);
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

// =============================================================================
// Persistence
// =============================================================================

/**
 * Keep a pending replay across reloads; drop it once nothing is pending.
 */
function storeReplay() {
  if (!hasPendingReplay()) {
    clearStoredReplay();
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      mistakes,
      replayed,
      gameOver,
      flip: isBoardFlipped(),
      accuracies: getMoveAccuracies(),
      pgnMoves: getPgnMoves(),
      moveHistory: getMoveHistory()
    }));
  } catch (e) {
    // Storage is optional (private mode, quota); the replay still runs.
  }
}

function clearStoredReplay() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

/**
 * The stored replay, or null when there is none or it could not be played
 * back safely (old format, bad positions, or a move that isn't legal).
 * @returns {Object|null}
 */
function readStoredReplay() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (e) {
    return null;
  }
  if (saved?.version !== STORAGE_VERSION) return null;

  const { mistakes: stored, replayed: done, gameOver: end, flip, accuracies, pgnMoves, moveHistory } = saved;
  const valid = Array.isArray(stored) && Number.isInteger(done) && done >= 0 && done < stored.length
    && typeof end?.title === 'string' && isFen(end.fen)
    && typeof flip === 'boolean'
    && Array.isArray(accuracies) && accuracies.every(Number.isFinite)
    && Array.isArray(pgnMoves) && Array.isArray(moveHistory) && pgnMoves.length === moveHistory.length
    && moveHistory.every((entry) => isFen(entry?.fen))
    && stored.every((mistake) => (
      Number.isInteger(mistake?.ply) && mistake.ply >= 0 && mistake.ply <= moveHistory.length
      && typeof mistake.played === 'string' && Number.isFinite(mistake.accuracy)
      && typeof mistake.best?.san === 'string' && isLegalMove(mistake.fen, mistake.best.uci)
    ));

  return valid ? saved : null;
}

// chess.js treats a missing FEN as the starting position, so check the type first.
function isFen(fen) {
  try {
    return typeof fen === 'string' && Boolean(new window.Chess(fen));
  } catch (e) {
    return false;
  }
}

function isLegalMove(fen, uci) {
  if (!isFen(fen) || typeof uci !== 'string') return false;
  return new window.Chess(fen).moves({ verbose: true })
    .some((move) => `${move.from}${move.to}${move.promotion || ''}` === uci.toLowerCase());
}
