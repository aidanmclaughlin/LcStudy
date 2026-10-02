const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const { Chess } = require('chess.js');
process.loadEnvFile(path.join(__dirname, '.env.local'));

const STORAGE_KEY = 'lcstudy_pending_replay';
const START = new Chess().fen();
const WHITE_GAME = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O', 'd6', 'Nc3', 'O-O', 'Be3', 'a6'];

/** Leela's move scores 100%, listed alternatives score as given, any other legal move is unscored (0%). */
function buildMoves(sans, alternatives = {}) {
  const game = new Chess();
  return sans.map((san, ply) => {
    const before = new Chess(game.fen());
    const move = game.move(san);
    const uci = move.from + move.to + (move.promotion || '');
    const analysis = [{ uci, san: move.san, accuracy: 100, policy: 1, best: true }];
    for (const [altSan, accuracy] of alternatives[ply] || []) {
      const alt = before.move(altSan);
      before.undo();
      analysis.push({ uci: alt.from + alt.to + (alt.promotion || ''), san: alt.san, accuracy, policy: accuracy / 100, best: false });
    }
    return { uci, san: move.san, analysis };
  });
}

function fenAfter(sans, plies) {
  const game = new Chess();
  sans.slice(0, plies).forEach(san => game.move(san));
  return game.fen();
}

function placement(fen) {
  return Object.fromEntries(new Chess(fen).board().flat().filter(Boolean)
    .map(piece => [piece.square, piece.color + piece.type.toUpperCase()]));
}

async function setup(page, context, session, history = []) {
  const userId = '00000000-0000-4000-8000-000000000098';
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET, token: { sub: userId, userId, name: 'Replay test' } });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, url: 'http://127.0.0.1:3110', httpOnly: true, sameSite: 'Lax' }]);
  const calls = { sessions: 0, saves: 0 };
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/new')) {
      calls.sessions++;
      return route.fulfill({ json: { maia_level: 1500, starting_fen: START, ...session, id: `replay-${calls.sessions}` } });
    }
    if (url.pathname.endsWith('/complete')) { calls.saves++; return route.fulfill({ json: { success: true } }); }
    if (url.pathname.endsWith('/game-history')) return route.fulfill({ json: { history } });
    return route.abort();
  });
  await open(page);
  return calls;
}

async function open(page, reload = false) {
  if (reload) await page.reload();
  else await page.goto('/');
  await expect(page.locator('#board')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(async () => (await import('/legacy/js/modules/state.js')).setSoundEnabled(false));
}

async function play(page, uci) {
  await page.locator(`[data-square="${uci.slice(0, 2)}"]`).click();
  await page.locator(`[data-square="${uci.slice(2, 4)}"]`).click();
}

/** Play the move for `ply` and wait for Maia's reply (or the end of the game). */
async function playTurn(page, uci, ply, totalPlies) {
  await play(page, uci);
  await expect.poll(() => page.evaluate(async () => (
    (await import('/legacy/js/modules/state.js')).getSessionCache().currentIndex
  ))).toBe(Math.min(ply + 2, totalPlies));
}

function boardPlacement(page) {
  return page.locator('#board .piece').evaluateAll(pieces => Object.fromEntries(
    pieces.map(piece => [piece.parentElement.dataset.square, piece.dataset.piece])
  ));
}

function pieceAt(page, square) {
  return page.evaluate(name => document.querySelector(`[data-square="${name}"] .piece`)?.dataset.piece || null, square);
}

function storedReplay(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

/** 99 recent games (current scoring) whose moves put the 25th percentile at 80%. */
function historyWithBarAt80() {
  return Array.from({ length: 99 }, (_, i) => {
    const score = i < 49 ? 80 : 95;
    return {
      date: '2026-09-01T00:00:00.000Z', average_accuracy: score, total_moves: 20,
      accuracy_history: Array(20).fill(score), maia_level: 1500, result: 'finished',
    };
  });
}

test('moves under your 25th percentile must be replayed until found, even across a reload', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const moves = buildMoves(WHITE_GAME, { 0: [['d4', 70]], 4: [['Bb5', 75]], 6: [['h3', 79.9]], 8: [['c3', 80]] });
  const calls = await setup(page, context, { game_id: 'replay-white', fen: START, flip: false, moves, ply: 0 }, historyWithBarAt80());

  // With the history the bar is 80%: b3 (unscored), Bb5, and h3 fall under it; c3 sits on it.
  // This game alone would put the bar at 77.45%, which would spare h3.
  for (const [ply, uci] of [[0, 'b2b3'], [2, 'g1f3'], [4, 'f1b5'], [6, 'h2h3'], [8, 'c2c3'], [10, 'b1c3'], [12, 'c1e3']]) {
    await playTurn(page, uci, ply, moves.length);
  }

  const panel = page.locator('#completion-overlay');
  const title = page.locator('#completion-title');
  const summary = page.locator('#completion-summary');
  const detail = page.locator('#completion-detail');
  const replayButton = page.locator('#completion-replay');
  const newGameButton = page.locator('#completion-new');

  await expect(panel).toBeVisible();
  await expect(title).toHaveText('Game over');
  await expect(summary).toHaveText('76.4% · 7 moves');
  await expect(detail).toHaveText('Moves under 80.0% (your 25th percentile) get replayed.');
  await expect(replayButton).toHaveText('Replay 3 moves');
  await expect(replayButton).toBeFocused();
  await expect(newGameButton).toBeHidden();
  await expect.poll(() => calls.saves).toBe(1);
  expect((await storedReplay(page)).mistakes.map(mistake => mistake.ply)).toEqual([0, 4, 6]);

  // New game stays locked even when triggered directly.
  await page.evaluate(() => document.getElementById('completion-new').click());
  await page.waitForTimeout(300);
  expect(calls.sessions).toBe(2);
  await expect(replayButton).toBeVisible();

  // Enter takes the focused primary action: the first miss, from the starting position.
  await page.keyboard.press('Enter');
  await expect(title).toHaveText('Replay 1 of 3');
  await expect(summary).toHaveText('Move 1');
  await expect(detail).toHaveText("You played b3 (0.0%). Find Leela's move.");
  await expect(page.locator('.completion-actions')).toBeHidden();
  expect(await boardPlacement(page)).toEqual(placement(START));
  await expect(page.locator('#move-list')).toHaveText('No moves yet');
  await expect(page.locator('#board .last-user-move, #board .last-opponent-move')).toHaveCount(0);

  // An illegal move changes nothing. A wrong one shows only its own score, never the answer.
  await play(page, 'g1g3');
  await page.waitForTimeout(200);
  await expect(detail).toHaveText("You played b3 (0.0%). Find Leela's move.");
  expect(await pieceAt(page, 'g1')).toBe('wN');
  await play(page, 'd2d4');
  await expect(detail).toHaveText('d4 scores 70.0%. Try again.');
  await expect(page.locator('.accuracy-burst')).toHaveText('70%');
  await play(page, 'b2b3');
  await expect(detail).toHaveText('b3 scores 0.0%. Try again.');
  await page.waitForTimeout(900); // longer than the in-game hint, which never appears here
  await expect(page.locator('.move-hint')).toHaveCount(0);
  await expect(title).toHaveText('Replay 1 of 3');
  expect(await pieceAt(page, 'd2')).toBe('wP');
  expect(await pieceAt(page, 'b2')).toBe('wP');
  await play(page, 'e2e4');
  await expect(detail).toHaveText('Correct: e4.');
  await expect(page.locator('.accuracy-burst')).toHaveText('100%');
  expect(await pieceAt(page, 'e4')).toBe('wP');

  // Each miss comes back as it looked when played, with only the earlier moves listed.
  await expect(title).toHaveText('Replay 2 of 3');
  await expect(summary).toHaveText('Move 3');
  await expect(detail).toHaveText("You played Bb5 (75.0%). Find Leela's move.");
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(WHITE_GAME, 4)));
  await expect(page.locator('#move-list .pgn-move')).toHaveText(WHITE_GAME.slice(0, 4));
  await play(page, 'f1c4');
  await expect(detail).toHaveText('Correct: Bc4.');

  await expect(title).toHaveText('Replay 3 of 3');
  await expect(summary).toHaveText('Move 4');
  await expect(detail).toHaveText("You played h3 (79.9%). Find Leela's move.");
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(WHITE_GAME, 6)));
  await expect(page.locator('#move-list .pgn-move')).toHaveText(WHITE_GAME.slice(0, 6));
  await expect(page.locator('[data-square="c4"]')).toHaveClass(/last-user-move/);
  await expect(page.locator('[data-square="c5"]')).toHaveClass(/last-opponent-move/);
  await page.locator('#review-prev').click();
  await page.locator('#review-prev').click();
  await expect(page.locator('#board')).toHaveClass(/reviewing-moves/);
  expect(await pieceAt(page, 'c5')).toBeNull();
  await play(page, 'd2d3'); // reviewing an earlier position never takes moves
  await expect(title).toHaveText('Replay 3 of 3');
  await page.locator('#review-exit').click();
  await expect(page.locator('#board')).not.toHaveClass(/reviewing-moves/);
  expect(await pieceAt(page, 'c5')).toBe('bB');

  // A reload reopens the finished game with only the remaining miss.
  expect((await storedReplay(page)).replayed).toBe(2);
  await open(page, true);
  await expect(title).toHaveText('Game over');
  await expect(summary).toHaveText('76.4% · 7 moves');
  await expect(detail).toHaveText('Moves under 80.0% (your 25th percentile) get replayed.');
  await expect(replayButton).toHaveText('Replay 1 move');
  await expect(replayButton).toBeFocused();
  await expect(newGameButton).toBeHidden();
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(WHITE_GAME, 14)));
  await expect(page.locator('#move-list .pgn-move')).toHaveCount(14);
  await expect.poll(() => calls.sessions).toBe(3); // the next game still loads in the background

  await replayButton.click();
  await expect(title).toHaveText('Replay 3 of 3');
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(WHITE_GAME, 6)));
  await play(page, 'd2d3');

  // Done: back to the final position with New game unlocked.
  await expect(title).toHaveText('Game over');
  await expect(summary).toHaveText('76.4% · 7 moves');
  await expect(detail).toHaveText('Replayed every move under 80.0% (your 25th percentile).');
  await expect(newGameButton).toBeVisible();
  await expect(newGameButton).toBeFocused();
  await expect(replayButton).toBeHidden();
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(WHITE_GAME, 14)));
  await expect(page.locator('#move-list .pgn-move')).toHaveCount(14);
  expect(await storedReplay(page)).toBeNull();

  await newGameButton.click();
  await expect(panel).toBeHidden();
  await expect.poll(() => calls.sessions).toBe(4);
  expect(await boardPlacement(page)).toEqual(placement(START));
  await expect(page.locator('#move-list')).toHaveText('No moves yet');
  expect(calls.saves).toBe(1);
  expect(errors).toEqual([]);
});

test('black: a miss on the first move is replayed after Maia\'s opening move', async ({ page, context }) => {
  const sans = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'];
  const moves = buildMoves(sans);
  await setup(page, context, { game_id: 'replay-black', fen: fenAfter(sans, 1), flip: true, moves, ply: 1 });

  for (const [ply, uci] of [[1, 'e7e5'], [3, 'd7d6'], [5, 'c5d4'], [7, 'g8f6']]) {
    await playTurn(page, uci, ply, moves.length);
  }

  // No history yet, so this game alone sets the bar: 0, 100, 100, 100 puts it at 75%.
  await expect(page.locator('#completion-detail')).toHaveText('Moves under 75.0% (your 25th percentile) get replayed.');
  await expect(page.locator('#completion-replay')).toHaveText('Replay 1 move');
  await page.locator('#completion-replay').click();
  await expect(page.locator('#completion-title')).toHaveText('Replay 1 of 1');
  await expect(page.locator('#completion-detail')).toHaveText("You played e5 (0.0%). Find Leela's move.");
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(sans, 1)));
  await expect(page.locator('#move-list .pgn-move')).toHaveText(['e4']);
  await expect(page.locator('[data-square="e4"]')).toHaveClass(/last-opponent-move/);
  expect(await page.evaluate(async () => (await import('/legacy/js/modules/state.js')).isBoardFlipped())).toBe(true);

  await play(page, 'c7c5');
  await expect(page.locator('#completion-new')).toBeFocused();
  await expect(page.locator('#completion-title')).toHaveText('Game over');
  await expect(page.locator('#completion-detail')).toHaveText('Replayed every move under 75.0% (your 25th percentile).');
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(sans, 8)));
});

test('game modules load from a per-deploy path that /legacy/js imports share', async ({ page, context }) => {
  await setup(page, context, { game_id: 'replay-white', fen: START, flip: false, moves: buildMoves(WHITE_GAME), ply: 0 });

  // A fixed URL let Safari pair a cached old main.js with newer modules.
  const scripts = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => new URL(entry.name).pathname)
    .filter(pathname => pathname.endsWith('.js') && pathname.includes('/js/') && !pathname.startsWith('/_next/')));
  expect(scripts.some(pathname => /^\/legacy-v\/[^/]+\/js\/main\.js$/.test(pathname))).toBe(true);
  expect(scripts.filter(pathname => pathname.startsWith('/legacy/js/'))).toEqual([]);

  // The import map hands absolute /legacy/js imports the game's own module instances.
  await playTurn(page, 'e2e4', 0, WHITE_GAME.length);
  expect(await page.evaluate(async () => (await import('/legacy/js/modules/state.js')).getMoveAccuracies())).toEqual([100]);
});

test('New game loads a newer deploy that went live while the tab was in the background', async ({ page, context }) => {
  const moves = buildMoves(WHITE_GAME);
  await setup(page, context, { game_id: 'replay-white', fen: START, flip: false, moves, ply: 0 });
  const pageVersion = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => new URL(entry.name).pathname.match(/^\/legacy-v\/([^/]+)\/js\/main\.js$/)?.[1])
    .find(Boolean));
  let liveVersion = pageVersion;
  await page.route('**/api/v1/version', route => route.fulfill({ json: { version: liveVersion } }));

  const finishGameAndReturnToTab = async () => {
    for (const [ply, uci] of [[0, 'e2e4'], [2, 'g1f3'], [4, 'f1c4'], [6, 'd2d3'], [8, 'e1g1'], [10, 'b1c3'], [12, 'c1e3']]) {
      await playTurn(page, uci, ply, moves.length);
    }
    await expect(page.locator('#completion-new')).toBeVisible();
    await page.evaluate(() => {
      window.__sameDocument = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };

  // Same deploy: New game stays in the page.
  await finishGameAndReturnToTab();
  await page.locator('#completion-new').click();
  await expect(page.locator('#completion-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);

  // A newer deploy: New game reloads into it.
  liveVersion = `${pageVersion}-next`;
  await finishGameAndReturnToTab();
  await Promise.all([page.waitForEvent('load'), page.locator('#completion-new').click()]);
  await expect(page.locator('#board')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.__sameDocument)).toBeUndefined();
});

test('an unusable stored replay is discarded and a new game starts', async ({ page, context }) => {
  await page.addInitScript(([key, start]) => localStorage.setItem(key, JSON.stringify({
    version: 2, replayed: 0, flip: false, accuracies: [0], pgnMoves: [], moveHistory: [],
    gameOver: { title: 'Game over', threshold: 50, fen: start, highlights: { user: null, opponent: null } },
    // No position for the miss: chess.js alone would read that as the starting position.
    mistakes: [{ ply: 0, best: { uci: 'e2e4', san: 'e4' }, played: 'd4', accuracy: 0, analysis: [] }]
  })), [STORAGE_KEY, START]);
  const calls = await setup(page, context, { game_id: 'replay-white', fen: START, flip: false, moves: buildMoves(WHITE_GAME), ply: 0 });

  await expect(page.locator('#completion-overlay')).toBeHidden();
  await expect.poll(() => calls.sessions).toBe(2);
  expect(await storedReplay(page)).toBeNull();
  await playTurn(page, 'e2e4', 0, WHITE_GAME.length);
});
