/**
 * Think-time coach UI.
 *
 * Fetches the suggested think budget from /api/v1/coach, shows it next to a
 * live think clock, and keeps the display ticking while a prompt is active.
 * The budget shown at game start is echoed back in the completion payload so
 * the model can compare suggested vs actual.
 *
 * @module coach
 */

import { getLiveThinkTimeMs } from './timeclock.js';

let nextSuggestion = null;
let appliedBudgetMs = null;
let appliedPerMoveMs = null;
let awaitingApply = false;
let tickerId = 0;
let lastClockText = '';

const els = {};

function el(id) {
  if (!els[id] || !els[id].isConnected) {
    els[id] = document.getElementById(id);
  }
  return els[id];
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function binsTooltip(suggestion) {
  if (!suggestion?.bins?.length) return '';

  const lines = suggestion.bins.map((bin) => {
    const rate = Number.isFinite(bin.rate_mean)
      ? `${bin.rate_mean >= 0 ? '+' : ''}${bin.rate_mean.toFixed(2)}±${bin.rate_sd.toFixed(2)} pts/hr`
      : '—';
    return `${bin.minutes}m: ${rate}, ${bin.games} games, P(best) ${(bin.p_best * 100).toFixed(0)}%`;
  });

  lines.push(`tempo effect ~${Number(suggestion.beta || 0).toFixed(1)} pts per doubling of think time`);
  return lines.join('\n');
}

/**
 * Fetch a fresh suggestion. Called at bootstrap and after each saved game.
 */
export async function refreshCoach() {
  try {
    const res = await fetch('/api/v1/coach', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!res.ok) return;

    nextSuggestion = await res.json();

    if (awaitingApply) {
      applyCoachBudget();
    } else {
      renderStatus();
    }
  } catch (e) {
    console.warn('Coach fetch failed', e);
  }
}

/**
 * Apply the latest suggestion as the budget for the game now starting.
 * @returns {number|null} The applied budget in ms, if available
 */
export function applyCoachBudget() {
  if (!nextSuggestion) {
    awaitingApply = true;
    renderStatus();
    return null;
  }

  awaitingApply = false;
  appliedBudgetMs = Number(nextSuggestion.suggested_think_ms) || null;
  appliedPerMoveMs = Number(nextSuggestion.per_move_ms) || null;
  renderStatus();
  return appliedBudgetMs;
}

/** The budget shown for the current game (echoed in the save payload). */
export function getSuggestedThinkMs() {
  return appliedBudgetMs;
}

function renderStatus() {
  const statusEl = el('coach-status');
  const budgetEl = el('coach-budget');
  const paceEl = el('coach-pace');
  const noteEl = el('coach-note');
  const panel = el('coach-panel');

  if (statusEl) {
    statusEl.textContent = nextSuggestion ? nextSuggestion.status : 'loading';
  }

  if (budgetEl) {
    budgetEl.textContent = appliedBudgetMs ? formatClock(appliedBudgetMs) : '--:--';
  }

  if (paceEl) {
    paceEl.textContent = appliedPerMoveMs
      ? `~${Math.round(appliedPerMoveMs / 1000)}s/move`
      : '';
  }

  if (noteEl) {
    noteEl.textContent = nextSuggestion ? nextSuggestion.note : 'Loading coach…';
  }

  if (panel && nextSuggestion) {
    panel.title = binsTooltip(nextSuggestion);
  }
}

function tick() {
  const clockEl = el('coach-clock');
  const fillEl = el('coach-bar-fill');
  if (!clockEl) return;

  const liveMs = getLiveThinkTimeMs();
  const text = formatClock(liveMs);

  if (text !== lastClockText) {
    lastClockText = text;
    clockEl.textContent = text;
  }

  if (fillEl && appliedBudgetMs) {
    const ratio = liveMs / appliedBudgetMs;
    fillEl.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
    fillEl.classList.toggle('is-warm', ratio >= 0.8 && ratio <= 1.1);
    fillEl.classList.toggle('is-over', ratio > 1.1);
  } else if (fillEl) {
    fillEl.style.width = '0%';
    fillEl.classList.remove('is-warm', 'is-over');
  }
}

/** Start the 500ms display ticker (idempotent). */
export function startCoachTicker() {
  if (tickerId) return;
  tickerId = window.setInterval(tick, 500);
  renderStatus();
}
