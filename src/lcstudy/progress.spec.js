const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const { Chess } = require('chess.js');
process.loadEnvFile(path.join(__dirname, '.env.local'));

const history = Array.from({ length: 160 }, (_, i) => ({
  average_accuracy: 70 + i * 0.1 + Math.sin(i / 7) * 4, total_moves: 20,
  think_time_ms: (4 - i * 0.01 + Math.cos(i / 9) * 0.5) * 20000,
  duration_ms: 90000, accuracy_history: Array(20).fill(80), maia_level: 1500
}));

async function setup(page, context) {
  const { buildAccuracyJourney } = await import('./public/legacy/js/modules/journey.mjs');
  const journey = buildAccuracyJourney(history.map(game => ({ accuracy: game.average_accuracy, totalMoves: game.total_moves, thinkTimeMs: game.think_time_ms })), 25, Infinity);
  const row = { label: 'Opening', accuracy: 85, exactRate: 45, moves: 100, games: 10 };
  const stats = {
    journey,
    overview: { totalGames: 160, totalMoves: 3200, recent25: 84, recent10: 85, best25: 89, allTimeAccuracy: 78, exactRate: 45, activeHours: 3.8 },
    elo: { current: { elo: 1320, low80: 1200, high80: 1420, games: 25, bound: null }, calibration: { minimumElo: 1050, maximumElo: 2100 }, series: Array.from({ length: 100 }, (_, i) => ({ game: i + 1, elo: 1200 + i, low80: 1100 + i, high80: 1300 + i })) },
    progress: { adjustedRecent25: 83, trendPer100: 6.2, difficultyCoverage: 0.9, forecast: { remainingHours: 23, remainingGames: 1800, remainingGamesLow: 800, remainingGamesHigh: 6500 } },
    consistency: { recentDeviation: 4.2 },
    timing: { timedGames: 160, medianMoveMs: 2300, moveP25Ms: 1200, moveP75Ms: 4600, fatigueDelta: -2, tempoEffect: 1.2, pace: [{ label: 'Fast', accuracy: 81, games: 30 }], learningRates: [{ minutes: 2, games: 20, hours: 1, rateMean: 1, rateLow: -1, rateHigh: 2 }] },
    skill: { phases: [row], colors: [{ ...row, label: 'White' }], opponents: [{ ...row, label: '1500' }], difficulties: [row], openings: [{ ...row, label: 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 O-O d6' }] },
    coverage: { lichessGames: 150, lichessShare: 0.9, whiteGames: 80, blackGames: 80, colorCoverage: 1, difficultyGames: 160, openingLines: 32, openingCoverage: 1 }
  };
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET, token: { sub: '00000000-0000-4000-8000-000000000099', userId: '00000000-0000-4000-8000-000000000099', name: 'Progress test' } });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, url: 'http://127.0.0.1:3110', httpOnly: true, sameSite: 'Lax' }]);
  const game = new Chess(); const starting_fen = game.fen();
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O', 'd6', 'Nc3', 'O-O', 'Be3', 'a6'].map(san => {
    const move = game.move(san); const uci = move.from + move.to;
    return { uci, san, analysis: [{ uci, san, accuracy: 100, policy: 1, best: true }] };
  });
  const calls = { sessions: 0, saves: 0, fail: false };
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/progress')) return route.fulfill({ status: calls.fail ? 503 : 200, json: calls.fail ? {} : stats });
    if (url.pathname.endsWith('/new')) {
      calls.sessions++;
      return route.fulfill({ json: { id: `fixture-${calls.sessions}`, game_id: 'fixture', starting_fen, fen: starting_fen, flip: false, moves, ply: 0, maia_level: 1500 } });
    }
    if (url.pathname.endsWith('/complete')) { calls.saves++; return route.fulfill({ json: { success: true } }); }
    if (url.pathname.endsWith('/game-history')) return route.fulfill({ json: { history } });
    return route.abort();
  });
  await page.goto('/');
  await expect(page.locator('#board')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(async () => (await import('/legacy/js/modules/state.js')).setSoundEnabled(false));
  return { calls, moves };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const state = await import('/legacy/js/modules/state.js');
    return { id: state.getSessionId(), fen: state.getChessEngine().fen(), scores: state.getMoveAccuracies(), ply: state.getSessionCache().currentIndex, review: state.getCurrentMoveIndex() };
  });
}

async function currentGamePoint(page) {
  return page.evaluate(() => window.Chart.getChart('accuracy-chart').data.datasets.find(dataset => dataset.label === 'Current game').data[0] || null);
}

test('Stats preserves a played game and excludes time spent away', async ({ page, context }, testInfo) => {
  const { calls, moves } = await setup(page, context);
  await expect.poll(() => page.evaluate(() => Boolean(window.Chart?.getChart('accuracy-chart')))).toBe(true);
  expect(await currentGamePoint(page)).toBeNull();
  await expect(page.locator('.journey-time-key')).toContainText('Older');
  await expect.poll(() => page.evaluate(() => {
    const chart = window.Chart.getChart('accuracy-chart');
    const dataset = chart.data.datasets.find(item => item.label === 'Journey');
    if (dataset.data.length < 2) return false;
    const color = index => dataset.segment.borderColor({ p0: { raw: dataset.data[index] }, p1: { raw: dataset.data[index + 1] } });
    return color(0) !== color(dataset.data.length - 2) && chart.config.plugins.some(plugin => plugin.id === 'journey-direction');
  })).toBe(true);
  for (let i = 0; i < 10; i += 2) {
    await page.locator(`[data-square="${moves[i].uci.slice(0, 2)}"]`).click();
    await page.locator(`[data-square="${moves[i].uci.slice(2, 4)}"]`).click();
    await expect.poll(async () => (await snapshot(page)).ply).toBe(i + 2);
  }
  const before = await snapshot(page);
  expect(before.scores).toHaveLength(5);
  await expect.poll(async () => (await currentGamePoint(page))?.moves).toBe(5);
  const livePoint = await currentGamePoint(page);
  const expectedPoint = await page.evaluate(async () => {
    const { buildCurrentGamePoint } = await import('/legacy/js/modules/journey.mjs');
    const { getMoveAccuracies } = await import('/legacy/js/modules/state.js');
    const { getMoveTimesMs } = await import('/legacy/js/modules/timeclock.js');
    return buildCurrentGamePoint(getMoveAccuracies(), getMoveTimesMs());
  });
  expect(livePoint).toEqual(expectedPoint);
  const sessionCount = calls.sessions;
  await page.evaluate(() => { window.originalBoard = document.getElementById('board'); });
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').locator('.journey-time-key')).toContainText('Newer');
  await expect(page.locator('.journey-current')).toContainText('Current game / 5 moves');
  await expect(page.locator('.journey-current')).toContainText(`${livePoint.y.toFixed(1)}% / ${livePoint.x.toFixed(2)}s per move`);
  await expect.poll(() => page.locator('.journey-canvas canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let top = Infinity, bottom = -Infinity;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 235 && pixels[i + 1] === 165 && pixels[i + 2] === 172 && pixels[i + 3] === 255) {
        const y = Math.floor(i / 4 / canvas.width);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return (bottom - top + 1) / (canvas.width / canvas.clientWidth);
  })).toBeGreaterThan(6);
  await page.locator('.journey-figure').screenshot({ path: testInfo.outputPath('current-game-journey.png') });
  await page.getByRole('button', { name: 'All games', exact: true }).click();
  await expect(page.locator('.journey-current')).toContainText('Current game / 5 moves');
  const elapsed = await page.evaluate(async () => (await import('/legacy/js/modules/timeclock.js')).getGameDurationMs());
  await page.waitForTimeout(700);
  const after = await page.evaluate(async () => (await import('/legacy/js/modules/timeclock.js')).getGameDurationMs());
  expect(after).toBe(elapsed);
  expect(await currentGamePoint(page)).toEqual(livePoint);
  await page.getByRole('tab', { name: 'Overview' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Breakdowns' })).toHaveAttribute('aria-selected', 'true');
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Resume game' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.originalBoard === document.getElementById('board'))).toBe(true);
  for (const exit of ['escape', 'back']) {
    await page.getByRole('button', { name: 'Stats', exact: true }).click();
    if (exit === 'escape') await page.keyboard.press('Escape');
    else await page.goBack();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(await snapshot(page)).toEqual(before);
  }
  await page.goForward();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Resume game' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(calls.sessions).toBe(sessionCount);
  expect(calls.saves).toBe(0);
  await page.locator('[data-square=b1]').click();
  await page.locator('[data-square=c3]').click();
  await expect.poll(async () => (await snapshot(page)).scores.length).toBe(6);
  await expect.poll(async () => (await currentGamePoint(page))?.moves).toBe(6);
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.journey-current')).toContainText('Current game / 6 moves');
  await page.getByRole('button', { name: 'Resume game' }).click();
});

test('responsive charts, tabs, and failed loading preserve the board', async ({ page, context }, testInfo) => {
  const { calls } = await setup(page, context);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const before = await snapshot(page);
  calls.fail = true;
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not be loaded');
  calls.fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.journey-canvas canvas')).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('tab', { name: 'Overview' }).click();
    const chart = await page.locator('.journey-canvas').boundingBox();
    expect(chart.width).toBeGreaterThan(width <= 600 ? width - 36 : 600);
    expect(chart.height).toBeGreaterThanOrEqual(300);
    expect(Math.abs(chart.width - chart.height)).toBeLessThan(2);
    expect(chart.width).toBeLessThanOrEqual(720);
    await page.getByRole('button', { name: 'All games', exact: true }).click();
    await page.getByRole('button', { name: 'Recent 100', exact: true }).click();
    for (const tab of ['Overview', 'Breakdowns', 'Timing']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      if (tab === 'Overview') await expect.poll(async () => page.locator('.journey-canvas canvas').evaluate(canvas =>
        canvas.width > 0 && canvas.height > 0 && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)
      )).toBe(true);
      expect(await page.locator('#stats-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.locator('.stats-page').evaluate(el => getComputedStyle(el).caretColor)).toBe('rgba(0, 0, 0, 0)');
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${width}-${tab}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Resume game' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  expect(calls.saves).toBe(0);
  expect(errors).toEqual([]);
});
