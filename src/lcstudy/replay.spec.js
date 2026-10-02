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

async function setup(page, context, session) {
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
    if (url.pathname.endsWith('/game-history')) return route.fulfill({ json: { history: [] } });
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

test('moves under 40% must be replayed before a new game, even across a reload', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const moves = buildMoves(WHITE_GAME, { 4: [['Bb5', 40]], 6: [['h3', 39.9]] });
  const calls = await setup(page, context, { game_id: 'replay-white', fen: START, flip: false, moves, ply: 0 });

  // d4 is unscored (0%), Bb5 sits exactly on the threshold, h3 is just under it.
  for (const [ply, uci] of [[0, 'd2d4'], [2, 'g1f3'], [4, 'f1b5'], [6, 'h2h3'], [8, 'e1g1'], [10, 'b1c3'], [12, 'c1e3']]) {
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
  await expect(summary).toHaveText('68.6% · 7 moves');
  await expect(replayButton).toHaveText('Replay 2 moves');
  await expect(replayButton).toBeFocused();
  await expect(newGameButton).toBeHidden();
  await expect(detail).toBeHidden();
  await expect.poll(() => calls.saves).toBe(1);
  expect((await storedReplay(page)).mistakes.map(mistake => mistake.ply)).toEqual([0, 6]);

  // New game stays locked even when triggered directly.
  await page.evaluate(() => document.getElementById('completion-new').click());
  await page.waitForTimeout(300);
  expect(calls.sessions).toBe(2);
  await expect(replayButton).toBeVisible();

  // Enter takes the focused primary action: the first miss, from the starting position.
  await page.keyboard.press('Enter');
  await expect(title).toHaveText('Replay 1 of 2');
  await expect(summary).toHaveText('Move 1');
  await expect(detail).toHaveText("You played d4 (0.0%). Find Leela's move.");
  await expect(page.locator('.completion-actions')).toBeHidden();
  expect(await boardPlacement(page)).toEqual(placement(START));
  await expect(page.locator('#move-list')).toHaveText('No moves yet');
  await expect(page.locator('#board .last-user-move, #board .last-opponent-move')).toHaveCount(0);

  // An illegal move changes nothing; a wrong one marks Leela's move, which must still be played.
  await play(page, 'g1g3');
  await page.waitForTimeout(200);
  await expect(detail).toHaveText("You played d4 (0.0%). Find Leela's move.");
  expect(await pieceAt(page, 'g1')).toBe('wN');
  await play(page, 'd2d4');
  await expect(detail).toHaveText('Leela played e4. Play it to continue.');
  await expect(page.locator('[data-square="e2"].move-hint-held, [data-square="e4"].move-hint-held')).toHaveCount(2);
  expect(await pieceAt(page, 'd2')).toBe('wP');
  expect(await pieceAt(page, 'd4')).toBeNull();
  await page.waitForTimeout(900); // outlasts the brief in-game hint
  await expect(page.locator('.move-hint-held')).toHaveCount(2);
  await play(page, 'e2e4');
  await expect(detail).toHaveText('Correct: e4.');
  expect(await pieceAt(page, 'e4')).toBe('wP');
  await expect(page.locator('.move-hint')).toHaveCount(0);

  // The next miss looks as it did when played, with only the earlier moves listed and reviewable.
  await expect(title).toHaveText('Replay 2 of 2');
  await expect(summary).toHaveText('Move 4');
  await expect(detail).toHaveText("You played h3 (39.9%). Find Leela's move.");
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(WHITE_GAME, 6)));
  await expect(page.locator('#move-list .pgn-move')).toHaveText(WHITE_GAME.slice(0, 6));
  await expect(page.locator('[data-square="c4"]')).toHaveClass(/last-user-move/);
  await expect(page.locator('[data-square="c5"]')).toHaveClass(/last-opponent-move/);
  await page.locator('#review-prev').click();
  await page.locator('#review-prev').click();
  await expect(page.locator('#board')).toHaveClass(/reviewing-moves/);
  expect(await pieceAt(page, 'c5')).toBeNull();
  await play(page, 'd2d3'); // reviewing an earlier position never takes moves
  await expect(title).toHaveText('Replay 2 of 2');
  await page.locator('#review-exit').click();
  await expect(page.locator('#board')).not.toHaveClass(/reviewing-moves/);
  expect(await pieceAt(page, 'c5')).toBe('bB');

  // A reload reopens the finished game with only the remaining miss.
  expect((await storedReplay(page)).replayed).toBe(1);
  await open(page, true);
  await expect(title).toHaveText('Game over');
  await expect(summary).toHaveText('68.6% · 7 moves');
  await expect(replayButton).toHaveText('Replay 1 move');
  await expect(replayButton).toBeFocused();
  await expect(newGameButton).toBeHidden();
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(WHITE_GAME, 14)));
  await expect(page.locator('#move-list .pgn-move')).toHaveCount(14);
  await expect.poll(() => calls.sessions).toBe(3); // the next game still loads in the background

  await replayButton.click();
  await expect(title).toHaveText('Replay 2 of 2');
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(WHITE_GAME, 6)));
  await play(page, 'd2d3');

  // Done: back to the final position with New game unlocked.
  await expect(title).toHaveText('Game over');
  await expect(summary).toHaveText('68.6% · 7 moves');
  await expect(newGameButton).toBeVisible();
  await expect(newGameButton).toBeFocused();
  await expect(replayButton).toBeHidden();
  await expect(detail).toBeHidden();
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

test('an unusable stored replay is discarded and a new game starts', async ({ page, context }) => {
  await page.addInitScript(([key, start]) => localStorage.setItem(key, JSON.stringify({
    version: 1, replayed: 0, flip: false, accuracies: [0], pgnMoves: [], moveHistory: [],
    gameOver: { title: 'Game over', fen: start, highlights: { user: null, opponent: null } },
    // No position for the miss: chess.js alone would read that as the starting position.
    mistakes: [{ ply: 0, best: { uci: 'e2e4', san: 'e4' }, played: 'd4', accuracy: 0 }]
  })), [STORAGE_KEY, START]);
  const calls = await setup(page, context, { game_id: 'replay-white', fen: START, flip: false, moves: buildMoves(WHITE_GAME), ply: 0 });

  await expect(page.locator('#completion-overlay')).toBeHidden();
  await expect.poll(() => calls.sessions).toBe(2);
  expect(await storedReplay(page)).toBeNull();
  await playTurn(page, 'e2e4', 0, WHITE_GAME.length);
});
