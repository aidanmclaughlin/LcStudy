const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const { Chess } = require('chess.js');
process.loadEnvFile(path.join(__dirname, '.env.local'));

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
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET, token: { sub: userId, userId, name: 'Game test' } });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, url: 'http://127.0.0.1:3110', httpOnly: true, sameSite: 'Lax' }]);
  const calls = { sessions: 0, saves: [] };
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/new')) {
      calls.sessions++;
      return route.fulfill({ json: { maia_level: 1500, starting_fen: START, ...session, id: `game-${calls.sessions}` } });
    }
    if (url.pathname.endsWith('/complete')) {
      calls.saves.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname.endsWith('/game-history')) return route.fulfill({ json: { history } });
    return route.abort();
  });
  await open(page);
  return calls;
}

async function open(page) {
  await page.goto('/');
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
  await expect.poll(async () => (await snapshot(page)).ply).toBe(Math.min(ply + 2, totalPlies));
}

/** First try at each move, every try, and the next ply to play. */
function snapshot(page) {
  return page.evaluate(async () => {
    const state = await import('/legacy/js/modules/state.js');
    return { scores: state.getMoveAccuracies(), tries: state.getTryScores().map(({ accuracy }) => accuracy), ply: state.getSessionCache().currentIndex };
  });
}

/** The in-game chart's bars: one per try. */
function chartBars(page) {
  return page.evaluate(async () => {
    const chart = (await import('/legacy/js/modules/state.js')).getMoveAccuracyChart();
    return chart ? { labels: chart.data.labels, data: chart.data.datasets[0].data } : null;
  });
}

function boardPlacement(page) {
  return page.locator('#board .piece').evaluateAll(pieces => Object.fromEntries(
    pieces.map(piece => [piece.parentElement.dataset.square, piece.dataset.piece])
  ));
}

/** The shake's sideways distance in px, set as the board shakes. */
function shakeDistance(page) {
  return page.locator('#board').evaluate(board => parseFloat(board.style.getPropertyValue('--shake-distance')));
}

/** The accuracy scale's color for a score, from the game's own module. */
function scaleColor(page, accuracy) {
  return page.evaluate(async value => (await import('/legacy/js/modules/colors.mjs')).accuracyColor(value), accuracy);
}

function pieceAt(page, square) {
  return page.evaluate(name => document.querySelector(`[data-square="${name}"] .piece`)?.dataset.piece || null, square);
}

test('a miss stays on the board until Leela\'s move is found; every try counts toward the game', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const moves = buildMoves(WHITE_GAME, { 0: [['d4', 70]], 4: [['Bb5', 99.4], ['Be2', 99.5]], 6: [['h3', 100]] });
  const calls = await setup(page, context, { game_id: 'white', fen: START, flip: false, moves, ply: 0 });
  const feedback = page.locator('#move-feedback');
  const burst = page.locator('.accuracy-burst');

  // An illegal move changes nothing and scores nothing.
  await play(page, 'g1g3');
  await expect(feedback).toHaveText('Illegal move');
  expect(await snapshot(page)).toEqual({ scores: [], tries: [], ply: 0 });

  // A wrong move shows its score and leaves the position for another try.
  await play(page, 'b2b3');
  await expect(feedback).toHaveText('0.0%');
  await expect(burst).toHaveText('0%');
  expect(await snapshot(page)).toEqual({ scores: [0], tries: [0], ply: 0 });
  expect(await shakeDistance(page)).toBeCloseTo(32, 6);

  // Leela's move is never shown or played.
  await page.waitForTimeout(900);
  await expect(page.locator('.move-hint')).toHaveCount(0);
  expect(await boardPlacement(page)).toEqual(placement(START));
  await expect(page.locator('#move-list')).toHaveText('No moves yet');

  // Every try is scored for the game; the first stays the move's first-try score.
  await play(page, 'd2d4');
  await expect(feedback).toHaveText('70.0%');
  await expect(burst).toHaveText('70%');
  // The shake grows linearly with the miss; burst and header share one smooth color scale.
  expect(await shakeDistance(page)).toBeCloseTo(2 + 0.3 * 30, 6);
  const orange = await scaleColor(page, 70);
  expect(orange).toBe('#f88700');
  expect(await burst.evaluate(el => el.style.getPropertyValue('--accuracy-burst-color'))).toBe(orange);
  await expect(feedback).toHaveAttribute('data-tone', 'accuracy');
  expect(await feedback.evaluate(el => el.style.getPropertyValue('--accuracy-color'))).toBe(orange);
  await expect(feedback).toHaveCSS('color', 'rgb(248, 135, 0)');
  await play(page, 'b2b3');
  await expect(feedback).toHaveText('0.0%');
  expect(await snapshot(page)).toEqual({ scores: [0], tries: [0, 70, 0], ply: 0 });
  await expect(page.locator('#current-accuracy')).toHaveText('23.3%');
  expect(await boardPlacement(page)).toEqual(placement(START));

  // Finding it plays on as usual.
  await play(page, 'e2e4');
  await expect(burst).toHaveText('100%');
  await expect(feedback).toHaveText('100.0%');
  await expect.poll(async () => (await snapshot(page)).ply).toBe(2);
  await expect(page.locator('#move-list .pgn-move')).toHaveText(['e4', 'e5']);
  expect(await snapshot(page)).toEqual({ scores: [0], tries: [0, 70, 0, 100], ply: 2 });

  await playTurn(page, 'g1f3', 2, moves.length);
  expect(await snapshot(page)).toEqual({ scores: [0, 100], tries: [0, 70, 0, 100, 100], ply: 4 });
  await expect(page.locator('#current-accuracy')).toHaveText('54.0%');

  // 99.4% still needs another try; a move as good as Leela's (shown as 100%) ends the retries
  // and her own move is played.
  await play(page, 'f1b5');
  await expect(feedback).toHaveText('99.4%');
  await expect(burst).toHaveText('99%');
  expect(await pieceAt(page, 'f1')).toBe('wB');
  await play(page, 'f1e2');
  await expect(feedback).toHaveText('99.5%');
  await expect(burst).toHaveText('100%');
  await expect.poll(async () => (await snapshot(page)).ply).toBe(6);
  expect(await pieceAt(page, 'c4')).toBe('wB');
  expect(await pieceAt(page, 'e2')).toBeNull();
  await playTurn(page, 'h2h3', 6, moves.length);
  expect(await pieceAt(page, 'd3')).toBe('wP');
  expect(await pieceAt(page, 'h3')).toBeNull();
  expect((await snapshot(page)).scores).toEqual([0, 100, 99.4, 100]);

  for (const [ply, uci] of [[8, 'e1g1'], [10, 'b1c3'], [12, 'c1e3']]) {
    await playTurn(page, uci, ply, moves.length);
  }

  // The game's accuracy is the mean over every try: 868.9 over 11 tries.
  const tries = [0, 70, 0, 100, 100, 99.4, 99.5, 100, 100, 100, 100];
  expect((await snapshot(page)).tries).toEqual(tries);
  await expect(page.locator('#completion-overlay')).toBeVisible();
  await expect(page.locator('#completion-title')).toHaveText('Game over');
  await expect(page.locator('#completion-summary')).toHaveText('79.0% · 7 moves');
  await expect(page.locator('#current-accuracy')).toHaveText('79.0%');
  // With no earlier games, the finished game is the whole recent average.
  await expect(page.locator('#avg-accuracy-label')).toHaveText('1-game accuracy');
  await expect(page.locator('#avg-accuracy')).toHaveText('79.0%');
  await expect(page.locator('.completion-actions .btn')).toHaveText(['Review', 'New game']);
  await expect(page.locator('#completion-new')).toBeFocused();

  // The chart shows one bar per try, labelled by move and try, colored on the same scale.
  await expect.poll(async () => (await chartBars(page))?.data).toEqual(tries);
  expect(await page.evaluate(async () => {
    const chart = (await import('/legacy/js/modules/state.js')).getMoveAccuracyChart();
    const { accuracyColor } = await import('/legacy/js/modules/colors.mjs');
    return chart.data.datasets[0].backgroundColor.every((color, i) => color === accuracyColor(chart.data.datasets[0].data[i]));
  })).toBe(true);
  expect((await chartBars(page)).labels).toEqual([
    'Move 1 · try 1', 'Move 1 · try 2', 'Move 1 · try 3', 'Move 1 · try 4', 'Move 2',
    'Move 3 · try 1', 'Move 3 · try 2', 'Move 4', 'Move 5', 'Move 6', 'Move 7'
  ]);

  // Saved: accuracy across every try, each move's first try, and the try count; no timing.
  await expect.poll(() => calls.saves.length).toBe(1);
  const [saved] = calls.saves;
  expect(Object.keys(saved).sort()).toEqual(['accuracy_history', 'attempts', 'average_accuracy', 'maia_level', 'result', 'total_moves']);
  expect(saved.average_accuracy).toBeCloseTo(868.9 / 11, 9);
  expect(saved.accuracy_history).toEqual([0, 100, 99.4, 100, 100, 100, 100]);
  expect(saved).toMatchObject({ total_moves: 7, attempts: 11, result: 'finished' });

  await page.keyboard.press('Enter');
  await expect(page.locator('#completion-overlay')).toBeHidden();
  await expect.poll(() => calls.sessions).toBe(3);
  expect(await boardPlacement(page)).toEqual(placement(START));
  await expect(page.locator('#move-list')).toHaveText('No moves yet');
  expect(await snapshot(page)).toEqual({ scores: [], tries: [], ply: 0 });
  await expect.poll(async () => (await chartBars(page))?.data).toEqual([]);
  expect(errors).toEqual([]);
});

test('black: a miss on the first move keeps Maia\'s opening move on the board', async ({ page, context }) => {
  const sans = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'];
  const moves = buildMoves(sans);
  await setup(page, context, { game_id: 'black', fen: fenAfter(sans, 1), flip: true, moves, ply: 1 });

  await play(page, 'e7e5');
  await expect(page.locator('#move-feedback')).toHaveText('0.0%');
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(sans, 1)));
  await expect(page.locator('#move-list .pgn-move')).toHaveText(['e4']);
  await expect(page.locator('[data-square="e4"]')).toHaveClass(/last-opponent-move/);
  expect(await page.evaluate(async () => (await import('/legacy/js/modules/state.js')).isBoardFlipped())).toBe(true);

  for (const [ply, uci] of [[1, 'c7c5'], [3, 'd7d6'], [5, 'c5d4'], [7, 'g8f6']]) {
    await playTurn(page, uci, ply, moves.length);
  }
  // Five tries over four moves: 0, then four at 100.
  await expect(page.locator('#completion-summary')).toHaveText('80.0% · 4 moves');
  expect(await boardPlacement(page)).toEqual(placement(fenAfter(sans, 8)));
});

test('a wrong try at the mating move leaves the game open until mate is found', async ({ page, context }) => {
  const sans = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
  const moves = buildMoves(sans);
  const calls = await setup(page, context, { game_id: 'mate', fen: START, flip: false, moves, ply: 0 });

  for (const [ply, uci] of [[0, 'e2e4'], [2, 'f1c4'], [4, 'd1h5']]) {
    await playTurn(page, uci, ply, moves.length);
  }
  await play(page, 'd2d3');
  await expect(page.locator('#move-feedback')).toHaveText('0.0%');
  await page.waitForTimeout(500);
  await expect(page.locator('#completion-overlay')).toBeHidden();
  expect(calls.saves).toEqual([]);

  await play(page, 'h5f7');
  await expect(page.locator('#completion-title')).toHaveText('Checkmate');
  await expect(page.locator('#completion-summary')).toHaveText('80.0% · 4 moves');
  await expect.poll(() => calls.saves.length).toBe(1);
  expect(calls.saves[0]).toMatchObject({ accuracy_history: [100, 100, 100, 0], attempts: 5, average_accuracy: 80 });
  expect(await pieceAt(page, 'f7')).toBe('wQ');
});

test('Leela\'s move ends the retries even when the analysis doesn\'t list it', async ({ page, context }) => {
  const moves = buildMoves(WHITE_GAME);
  moves[0].analysis = [];
  await setup(page, context, { game_id: 'white', fen: START, flip: false, moves, ply: 0 });

  await play(page, 'd2d4');
  await expect(page.locator('#move-feedback')).toHaveText('0.0%');
  await playTurn(page, 'e2e4', 0, moves.length);
  expect(await snapshot(page)).toEqual({ scores: [0], tries: [0, 100], ply: 2 });
});

test('a replay saved before retries replaced it is dropped and a new game starts', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('lcstudy_pending_replay', JSON.stringify({ version: 2 })));
  const calls = await setup(page, context, { game_id: 'white', fen: START, flip: false, moves: buildMoves(WHITE_GAME), ply: 0 });

  await expect(page.locator('#completion-overlay')).toBeHidden();
  await expect.poll(() => calls.sessions).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('lcstudy_pending_replay'))).toBeNull();
  await playTurn(page, 'e2e4', 0, WHITE_GAME.length);
});

test('game modules load from a per-deploy path that /legacy/js imports share', async ({ page, context }) => {
  await setup(page, context, { game_id: 'white', fen: START, flip: false, moves: buildMoves(WHITE_GAME), ply: 0 });

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
  await setup(page, context, { game_id: 'white', fen: START, flip: false, moves, ply: 0 });
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
