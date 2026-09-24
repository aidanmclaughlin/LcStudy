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
  await page.addInitScript(() => {
    window.__currentGamePoint = null;
    window.addEventListener('lcstudy:current-game', event => { window.__currentGamePoint = event.detail; });
  });
  const { buildAccuracyJourney, buildRollingAccuracy } = await import('./public/legacy/js/modules/journey.mjs');
  const journey = buildAccuracyJourney(history.map(game => ({ accuracy: game.average_accuracy, totalMoves: game.total_moves, thinkTimeMs: game.think_time_ms })), 25, Infinity);
  const row = { label: 'Opening', accuracy: 85, exactRate: 45, moves: 100, games: 10 };
  const stats = {
    journey,
    overview: { totalGames: 160, totalMoves: 3200, recent25: 84, recent10: 85, best25: 89, allTimeAccuracy: 78, exactRate: 45, activeHours: 3.8 },
    elo: { current: { elo: 1320, low80: 1200, high80: 1420, games: 25, bound: null }, calibration: { minimumElo: 1050, maximumElo: 2100 }, series: Array.from({ length: 100 }, (_, i) => ({ game: i + 1, elo: 1200 + i, low80: 1100 + i, high80: 1300 + i })) },
    progress: { accuracy100: buildRollingAccuracy(history.map(game => game.average_accuracy)), adjustedRecent25: 83, trendPer100: 6.2, difficultyCoverage: 0.9, forecast: { remainingHours: 23, remainingGames: 1800, remainingGamesLow: 800, remainingGamesHigh: 6500 } },
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
  return { calls, moves, stats };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const state = await import('/legacy/js/modules/state.js');
    return { id: state.getSessionId(), fen: state.getChessEngine().fen(), scores: state.getMoveAccuracies(), ply: state.getSessionCache().currentIndex, review: state.getCurrentMoveIndex() };
  });
}

async function currentGamePoint(page) {
  return page.evaluate(() => window.__currentGamePoint);
}

test('Stats preserves a played game and excludes time spent away', async ({ page, context }, testInfo) => {
  const { calls, moves } = await setup(page, context);
  await expect(page.locator('#accuracy-chart')).toHaveCount(0);
  await expect(page.locator('.journey-canvas')).toHaveCount(0);
  expect(await currentGamePoint(page)).toBeNull();
  await expect(page.locator('#hours-left-count')).toHaveCount(0);
  await expect(page.locator('.stats-trigger .stat-tile')).toHaveCount(3);
  const accuracy100 = history.slice(-100).reduce((sum, game) => sum + game.average_accuracy, 0) / 100;
  const pace100 = history.slice(-100).reduce((sum, game) => sum + game.think_time_ms / game.total_moves / 1000, 0) / 100;
  await expect(page.locator('#avg-accuracy')).toHaveText(`${accuracy100.toFixed(1)}%`);
  await expect(page.locator('#avg-move-time')).toHaveText(`${pace100.toFixed(2)}s`);
  await expect(page.locator('.panel-chart #game-accuracy')).toHaveText('--');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('button', { name: 'Stats', exact: true })).toHaveCount(0);
  const trigger = await page.getByRole('button', { name: 'Accuracy summary, open statistics' }).boundingBox();
  expect(trigger.height).toBeGreaterThanOrEqual(48);
  expect(trigger.width).toBeGreaterThan(250);
  const viewport = page.viewportSize();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.locator('.stats-trigger .stat-value').evaluateAll(values => values.every(value => value.scrollWidth <= value.clientWidth))).toBe(true);
  }
  await page.setViewportSize(viewport);
  await page.screenshot({ path: testInfo.outputPath('game-page.png') });
  for (let i = 0; i < 10; i += 2) {
    await page.locator(`[data-square="${moves[i].uci.slice(0, 2)}"]`).click();
    await page.locator(`[data-square="${moves[i].uci.slice(2, 4)}"]`).click();
    await expect.poll(async () => (await snapshot(page)).ply).toBe(i + 2);
  }
  const before = await snapshot(page);
  expect(before.scores).toHaveLength(5);
  await expect.poll(async () => (await currentGamePoint(page))?.moves).toBe(5);
  const livePoint = await currentGamePoint(page);
  await expect(page.locator('.panel-chart #game-accuracy')).toHaveText('100.0%');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-tone', 'better');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-direction', 'up');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('data-tone', 'better');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('data-direction', 'down');
  await page.screenshot({ path: testInfo.outputPath('game-metrics.png') });
  const expectedPoint = await page.evaluate(async () => {
    const { buildCurrentGamePoint } = await import('/legacy/js/modules/journey.mjs');
    const { getMoveAccuracies } = await import('/legacy/js/modules/state.js');
    const { getMoveTimesMs } = await import('/legacy/js/modules/timeclock.js');
    return buildCurrentGamePoint(getMoveAccuracies(), getMoveTimesMs());
  });
  expect(livePoint).toEqual(expectedPoint);
  const sessionCount = calls.sessions;
  await page.evaluate(() => { window.originalBoard = document.getElementById('board'); });
  await page.locator('#avg-accuracy').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Accuracy summary, open statistics' }).click();
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
  await page.getByRole('button', { name: 'Accuracy summary, open statistics' }).click();
  await expect(page.locator('.journey-current')).toContainText('Current game / 6 moves');
  await page.getByRole('button', { name: 'Resume game' }).click();
});

test('responsive charts, tabs, and failed loading preserve the board', async ({ page, context }, testInfo) => {
  const { calls } = await setup(page, context);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const before = await snapshot(page);
  const progressWithoutChart = await page.evaluate(async () => {
    const state = await import('/legacy/js/modules/state.js');
    const charts = await import('/legacy/js/modules/charts.js');
    const savedChart = state.getMoveAccuracyChart(), savedHistory = state.getGameHistory();
    try {
      state.setMoveAccuracyChart(null);
      state.setGameHistory(savedHistory.slice(0, 99));
      charts.updateStatistics();
      return document.getElementById('avg-accuracy').textContent;
    } finally {
      state.setMoveAccuracyChart(savedChart);
      state.setGameHistory(savedHistory);
      charts.updateStatistics();
    }
  });
  expect(progressWithoutChart).toBe('--');
  calls.fail = true;
  await page.getByRole('button', { name: 'Accuracy summary, open statistics' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not be loaded');
  calls.fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.journey-canvas canvas')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage === getComputedStyle(document.getElementById('stats-dialog')).backgroundImage)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.stats-page')).getPropertyValue('--text-primary') === getComputedStyle(document.documentElement).getPropertyValue('--text-primary'))).toBe(true);
  await expect(page.locator('.stats-metric')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '100-game accuracy', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Maia-equivalent Elo', exact: true })).toHaveCount(0);
  await expect(page.locator('.stats-accuracy-chart-wrap .stats-chart-x-label')).toHaveText(['Game 100', 'Game 130', 'Game 160']);
  const latestAccuracy = history.slice(-100).reduce((sum, game) => sum + game.average_accuracy, 0) / 100;
  await expect(page.locator('.stats-accuracy-band .stats-section-heading > span')).toHaveText(`${latestAccuracy.toFixed(1)}%`);
  const backStyles = await page.getByRole('button', { name: 'Resume game' }).evaluate(button => {
    const style = getComputedStyle(button), box = button.getBoundingClientRect();
    return { background: style.backgroundImage, shadow: style.boxShadow, height: box.height, width: box.width };
  });
  expect(backStyles.background).toBe('none');
  expect(backStyles.shadow).toBe('none');
  expect(backStyles.height).toBeGreaterThanOrEqual(44);
  expect(backStyles.width).toBeLessThan(130);
  await expect(page.getByRole('heading', { name: 'Current form', exact: true })).not.toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('tab', { name: 'Overview' }).click();
    await page.locator('summary').filter({ hasText: 'Learning & target' }).click();
    await expect(page.getByRole('heading', { name: 'Current form', exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'Learning & target' }).click();
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
      if (tab === 'Breakdowns') {
        await page.locator('summary').filter({ hasText: 'Opening lines' }).click();
        await expect(page.getByRole('heading', { name: 'Accuracy by line' })).toBeVisible();
        await page.locator('summary').filter({ hasText: 'Data coverage' }).click();
        await expect(page.getByRole('heading', { name: 'Sample', exact: true })).toBeVisible();
        expect(await page.locator('#stats-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      await page.locator('#stats-dialog').evaluate(el => { el.scrollTop = 0; });
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${width}-${tab}.png`) });
      if (tab === 'Overview' && (width === 390 || width === 1440)) {
        await page.locator('.stats-accuracy-band').scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${width}-accuracy.png`) });
      }
    }
  }
  await page.getByRole('button', { name: 'Resume game' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  expect(calls.saves).toBe(0);
  expect(errors).toEqual([]);
});

test('rolling accuracy renders empty, single-point, and constant histories', async ({ page, context }) => {
  const { stats } = await setup(page, context);
  const { buildRollingAccuracy } = await import('./public/legacy/js/modules/journey.mjs');
  for (const scores of [Array(99).fill(80), Array(100).fill(80), Array(120).fill(0), Array(120).fill(100)]) {
    stats.progress.accuracy100 = buildRollingAccuracy(scores);
    await page.locator('#avg-accuracy').click();
    if (scores.length < 100) {
      await expect(page.getByText('Available after 100 scored games')).toBeVisible();
      await expect(page.locator('.stats-accuracy-chart-line')).toHaveCount(0);
    } else {
      await expect(page.locator('.stats-accuracy-chart-line')).toHaveAttribute('d', /^M[\d., Lh]+$/);
      expect(await page.locator('.stats-accuracy-chart-line').evaluate(path => path.getTotalLength())).toBeGreaterThan(0);
      const labels = await page.locator('.stats-accuracy-chart-wrap .stats-chart-y-axis').innerText();
      expect(labels).not.toMatch(/NaN|Infinity/);
      await expect(page.locator('.stats-accuracy-band .stats-section-heading > span')).toHaveText(`${scores[0].toFixed(1)}%`);
    }
    await page.getByRole('button', { name: 'Resume game' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Accuracy summary, open statistics' })).toBeFocused();
  }
});

test('live comparison arrows distinguish accuracy and pace, ties, and missing timing', async ({ page, context }, testInfo) => {
  await setup(page, context);
  await page.locator('[data-square=e2]').click();
  await page.locator('[data-square=e4]').click();
  await expect.poll(async () => (await snapshot(page)).ply).toBe(2);
  const configure = async (accuracy, paceMultiplier, timed = true) => page.evaluate(async ({ accuracy, paceMultiplier, timed }) => {
    const state = await import('/legacy/js/modules/state.js');
    const clock = await import('/legacy/js/modules/timeclock.js');
    const charts = await import('/legacy/js/modules/charts.js');
    const seconds = clock.getMoveTimesMs()[0] / 1000;
    state.setMoveAccuracies([accuracy]);
    state.setGameHistory(Array.from({ length: 100 }, () => ({
      average_accuracy: 80, total_moves: 20, think_time_ms: timed ? seconds * paceMultiplier * 20000 : null
    })));
    charts.updateStatistics();
  }, { accuracy, paceMultiplier, timed });
  await configure(90, 2);
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-tone', 'better');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('data-tone', 'better');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('data-direction', 'down');
  await configure(70, 0.5);
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-tone', 'worse');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-direction', 'down');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('data-tone', 'worse');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('data-direction', 'up');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('title', /slower than your 100-game average/);
  await expect(page.locator('#game-accuracy')).toHaveText('70.0%');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.locator('.stats-trigger').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.locator('.stat-value-row').evaluateAll(rows => rows.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('narrow-metrics.png') });
  await configure(80, 1);
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('aria-hidden', 'true');
  await configure(90, 1, false);
  await expect(page.locator('#avg-move-time')).toHaveText('--');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-tone', 'better');
  await page.evaluate(async () => {
    const state = await import('/legacy/js/modules/state.js');
    state.setMoveAccuracies([]);
    (await import('/legacy/js/modules/timeclock.js')).startGameClock();
    (await import('/legacy/js/modules/charts.js')).updateStatistics();
  });
  await expect(page.locator('#game-accuracy')).toHaveText('--');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('aria-hidden', 'true');
});
