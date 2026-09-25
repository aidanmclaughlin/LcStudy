const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const { Chess } = require('chess.js');
const { computeProgressDashboard } = require('./lib/progress-stats');
process.loadEnvFile(path.join(__dirname, '.env.local'));

const history = Array.from({ length: 160 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 6, i < 20 ? 4 : 6, 0, i)).toISOString(),
  average_accuracy: 70 + i * 0.1 + Math.sin(i / 7) * 4, total_moves: 20,
  think_time_ms: (4 - i * 0.01 + Math.cos(i / 9) * 0.5) * 20000,
  duration_ms: 90000, accuracy_history: Array(20).fill(80), maia_level: 1500
}));

function statsRow(accuracy, index, overrides = {}) {
  return {
    userId: 'fixture', gameId: `lichess_maia2_fixture_${index}`, attempts: 20, solved: true,
    accuracy, averageAccuracy: accuracy, playedAt: new Date(Date.UTC(2026, 6, 6, 0, index)),
    totalMoves: 20, averageRetries: 0, accuracyHistory: Array(20).fill(accuracy),
    maiaLevel: 1500, durationMs: 90000, thinkTimeMs: 60000, moveTimesMs: Array(20).fill(3000),
    suggestedThinkMs: null, difficulty: null, leelaColor: 'w',
    openingLine: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O', 'd6'],
    openingSource: 'lichess', openingRatingGroup: '1500', ...overrides
  };
}

async function setup(page, context) {
  await page.addInitScript(() => {
    window.__currentGamePoint = null;
    window.addEventListener('lcstudy:current-game', event => { window.__currentGamePoint = event.detail; });
  });
  const stats = computeProgressDashboard(history.map((game, index) => statsRow(game.average_accuracy, index, {
    playedAt: new Date(game.date), thinkTimeMs: game.think_time_ms,
    moveTimesMs: Array(20).fill(game.think_time_ms / 20)
  })));
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
  await expect(page.locator('.stats-trigger .stat-tile')).toHaveCount(2);
  await expect(page.locator('.stats-trigger #move-feedback')).toHaveCount(0);
  await expect(page.locator('#move-chart-count')).toHaveCount(0);
  await expect(page.locator('.move-chart-summary .move-chart-label')).toHaveText(['Game', 'Move']);
  const accuracy100 = history.slice(-100).reduce((sum, game) => sum + game.average_accuracy, 0) / 100;
  const pace100 = history.slice(-100).reduce((sum, game) => sum + game.think_time_ms / game.total_moves / 1000, 0) / 100;
  await expect(page.locator('#avg-accuracy')).toHaveText(`${accuracy100.toFixed(1)}%`);
  await expect(page.locator('#avg-move-time')).toHaveText(`${pace100.toFixed(2)}s`);
  await expect(page.locator('.panel-chart #game-accuracy')).toHaveText('--');
  await expect(page.locator('.panel-chart #move-feedback')).toHaveText('--');
  await expect(page.locator('#current-accuracy')).toHaveText('--');
  await expect(page.locator('#current-move-time')).toHaveText('--');
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
  await expect(page.locator('#current-accuracy')).toHaveText('100.0%');
  await expect(page.locator('#current-move-time')).toHaveText(`${livePoint.x.toFixed(2)}s`);
  await expect(page.locator('.panel-chart #move-feedback')).toHaveText('100.0%');
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
  await expect(page.locator('.journey-current')).toContainText('Current game · 5 moves');
  await expect(page.locator('.journey-current')).toContainText(`${livePoint.y.toFixed(1)}% · ${livePoint.x.toFixed(2)}s per move`);
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
  await expect(page.locator('.journey-current')).toContainText('Current game · 5 moves');
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
  await expect(page.locator('.journey-current')).toContainText('Current game · 6 moves');
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
  await expect(page.locator('.stats-metric').filter({ hasText: 'Maia Elo' })).toHaveAttribute('title', /last 100 eligible games; 80% range/);
  await expect(page.getByRole('heading', { name: '100-game accuracy', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Maia-equivalent Elo', exact: true })).toHaveCount(0);
  await expect(page.locator('.stats-accuracy-chart-wrap .stats-chart-x-label')).toHaveText(['Game 120', 'Game 140', 'Game 160']);
  const latestAccuracy = history.slice(-100).reduce((sum, game) => sum + game.average_accuracy, 0) / 100;
  const latestPace = history.slice(-100).reduce((sum, game) => sum + game.think_time_ms / game.total_moves / 1000, 0) / 100;
  await expect(page.locator('.stats-metric').filter({ hasText: '100-game accuracy' }).locator('strong')).toHaveText(`${latestAccuracy.toFixed(1)}%`);
  await expect(page.locator('.stats-metric').filter({ hasText: '100-game pace' }).locator('strong')).toHaveText(`${latestPace.toFixed(2)}s`);
  await expect(page.locator('.journey-caption')).toContainText('Games 61–160');
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
    await expect(page.getByText('Best 100-game accuracy', { exact: true })).toBeVisible();
    await expect(page.getByText('Difficulty-adjusted / 100', { exact: true })).toBeVisible();
    await expect(page.getByText('10-game average · estimate', { exact: true })).toBeVisible();
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
      if (tab !== 'Overview') await expect(page.locator('.stats-band > .stats-section-heading > span')).toContainText('Last 100 scored games');
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
  const { buildRollingAccuracy } = require('./public/legacy/js/modules/journey.mjs');
  for (const scores of [Array(99).fill(80), Array(100).fill(80), Array(120).fill(0), Array(120).fill(100)]) {
    stats.progress.accuracy100 = buildRollingAccuracy(scores);
    await page.locator('#avg-accuracy').click();
    if (scores.length < 100) {
      await expect(page.getByText('Available after 100 games with current scoring')).toBeVisible();
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
  await expect(page.locator('#current-accuracy')).toHaveText('70.0%');
  expect(await page.locator('#current-move-time').innerText()).toMatch(/^\d+\.\d{2}s$/);
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
  await expect(page.locator('#current-accuracy')).toHaveText('--');
  await expect(page.locator('#current-move-time')).toHaveText('--');
  await expect(page.locator('#move-feedback')).toHaveText('--');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('aria-hidden', 'true');
});

test('paired metrics stay compact and separate the game from move feedback', async ({ page, context }, testInfo) => {
  await setup(page, context);
  await page.evaluate(async () => {
    const state = await import('/legacy/js/modules/state.js');
    const charts = await import('/legacy/js/modules/charts.js');
    const effects = await import('/legacy/js/modules/effects.js');
    state.setMoveAccuracies([100, 0, 80]);
    charts.updateStatistics();
    effects.updateMoveFeedback({ accuracy: 80 });
  });
  await expect(page.locator('#current-accuracy')).toHaveText('60.0%');
  await expect(page.locator('#game-accuracy')).toHaveText('60.0%');
  await expect(page.locator('#move-feedback')).toHaveText('80.0%');
  await expect(page.locator('#current-move-time')).toHaveText('--');
  await expect(page.locator('#pace-comparison')).toHaveAttribute('aria-hidden', 'true');

  await page.clock.install();
  await page.evaluate(async () => {
    const clock = await import('/legacy/js/modules/timeclock.js');
    clock.startGameClock();
    clock.promptBegin();
  });
  await page.clock.fastForward(123450);
  await page.evaluate(async () => {
    (await import('/legacy/js/modules/timeclock.js')).promptSubmit();
    (await import('/legacy/js/modules/state.js')).setMoveAccuracies([100]);
    (await import('/legacy/js/modules/charts.js')).updateStatistics();
  });
  await expect(page.locator('#current-accuracy')).toHaveText('100.0%');
  await expect(page.locator('#current-move-time')).toHaveText('123.45s');

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const heading = await page.locator('.move-chart-heading').boundingBox();
    const summary = await page.locator('.stats-trigger').boundingBox();
    expect(summary.height).toBeLessThanOrEqual(90);
    expect(await page.locator('.stats-trigger .stat-label, .stats-trigger .stat-value').evaluateAll(elements => elements.every(element =>
      element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight
    ))).toBe(true);
    expect(await page.locator('.stat-current').evaluateAll(rows => rows.every(row => {
      const label = row.querySelector('.stat-current-label').getBoundingClientRect();
      const value = row.querySelector('.stat-value-row').getBoundingClientRect();
      return label.right <= value.left && row.scrollWidth <= row.clientWidth;
    }))).toBe(true);
    for (const feedback of [null, { loading: true }, { error: true }, { illegal: true }, { bestMoveSan: 'Nxf8=Q+' }, { accuracy: 100 }]) {
      await page.evaluate(async feedback => (await import('/legacy/js/modules/effects.js')).updateMoveFeedback(feedback), feedback);
      const next = await page.locator('.move-chart-heading').boundingBox();
      expect(next.height).toBe(heading.height);
      expect(await page.locator('.move-chart-stat').evaluateAll(stats => stats.every(stat => stat.scrollWidth <= stat.clientWidth && stat.scrollHeight <= stat.clientHeight))).toBe(true);
      const title = await page.locator('.move-chart-heading h2').boundingBox();
      const metrics = await page.locator('.move-chart-summary').boundingBox();
      expect(title.x + title.width).toBeLessThanOrEqual(metrics.x);
    }
    await page.locator('.stats-trigger').screenshot({ path: testInfo.outputPath(`${width}-paired-summary.png`) });
    await page.locator('.panel-chart').screenshot({ path: testInfo.outputPath(`${width}-move-header.png`) });
  }
});

test('Maia Elo uses the latest 100 eligible games, skipping opening-only games', () => {
  const { computeMaiaElo, MAIA_ELO_WINDOW } = require('./lib/maia-elo');
  expect(MAIA_ELO_WINDOW).toBe(100);
  const history = Array.from({ length: 125 }, (_, index) => ({
    accuracyHistory: [...Array(5).fill(0), ...Array(5).fill(index < 25 ? 10 : index < 100 ? 60 : 100)]
  })).flatMap(game => [game, { accuracyHistory: Array(5).fill(100) }]);
  const result = computeMaiaElo(history);
  expect(result.current).toMatchObject({ game: 249, games: 100, moves: 500, accuracy: 70 });
  expect(result.series).toHaveLength(125);
  expect(result.series[98].games).toBe(99);
  expect(result.series[99].games).toBe(100);
  expect(result.series.every(point => point.games <= 100)).toBe(true);
  const changedOldGames = history.map((game, index) => index < 50 ? { accuracyHistory: Array(10).fill(100) } : game);
  expect(computeMaiaElo(changedOldGames).current).toEqual(result.current);
});

test('Maia Elo preserves empty and partial eligible-game histories', () => {
  const { computeMaiaElo } = require('./lib/maia-elo');
  expect(computeMaiaElo([]).current).toBeNull();
  expect(computeMaiaElo([{ accuracyHistory: Array(5).fill(100) }]).current).toBeNull();
  const result = computeMaiaElo([
    { accuracyHistory: [...Array(5).fill(0), 80] },
    { accuracyHistory: [...Array(5).fill(100), 100, 100] }
  ]);
  expect(result.current).toMatchObject({ game: 2, games: 2, moves: 3, accuracy: 90 });
});

test('dashboard performance uses 100 scored games while coverage stays lifetime', () => {
  const rows = Array.from({ length: 125 }, (_, index) => statsRow(index < 25 ? 10 : index < 100 ? 60 : 100, index, {
    leelaColor: index < 25 ? 'b' : 'w',
    thinkTimeMs: index < 25 ? 200000 : index < 100 ? 60000 : 20000,
    moveTimesMs: Array(20).fill(index < 25 ? 10000 : index < 100 ? 3000 : 1000)
  }));
  const stats = computeProgressDashboard(rows);
  expect(stats.overview).toMatchObject({ totalGames: 125, totalMoves: 2500, recentGames: 100, recent100: 70, recentSecondsPerMove: 2.5, best100: 70 });
  expect(stats.progress.adjustedRecent100).toBe(70);
  expect(stats.progress.series.at(-1)).toMatchObject({ rolling100: 70, adjusted100: 70 });
  expect(stats.consistency.recentDeviation).toBeCloseTo(Math.sqrt(30000 / 99), 8);
  expect(stats.journey.windowSize).toBe(100);
  expect(stats.journey.points.at(-1)).toMatchObject({ game: 125, startGame: 26, games: 100, x: 2.5, y: 70, provisional: false });
  expect(stats.timing).toMatchObject({ timedGames: 100, medianMoveMs: 3000, fatigueGames: 100 });
  expect(stats.timing.pace.reduce((sum, group) => sum + group.games, 0)).toBe(100);
  expect(stats.skill.colors).toEqual([{ label: 'White', accuracy: 70, exactRate: 25, games: 100, moves: 2000 }]);
  expect(stats.coverage).toMatchObject({ whiteGames: 100, blackGames: 25, timedGames: 125, lichessGames: 125 });
  expect(stats.overview.activeHours).toBeCloseTo(10000000 / 3600000, 8);

  const changedOldGames = rows.map((row, index) => index < 25 ? statsRow(100, index) : row);
  const changed = computeProgressDashboard(changedOldGames);
  expect(changed.overview.recent100).toBe(stats.overview.recent100);
  expect(changed.progress.trendPer100).toBe(stats.progress.trendPer100);
  expect(changed.consistency).toEqual(stats.consistency);
  expect(changed.skill).toEqual(stats.skill);
  expect(changed.timing).toEqual(stats.timing);

  const unscored = statsRow(null, 125, { accuracyHistory: [] });
  const skipped = computeProgressDashboard([...rows, unscored]);
  expect(skipped.overview).toMatchObject({ recent100: 70, recentSecondsPerMove: 2.5, recentGames: 100, totalGames: 126 });
});

test('dashboard handles short histories and never uses stale pace', () => {
  const empty = computeProgressDashboard([]);
  expect(empty.overview).toMatchObject({ recentGames: 0, recent100: null, recentSecondsPerMove: null, best100: null });
  const rows = Array.from({ length: 101 }, (_, index) => statsRow(80, index));
  const partial = computeProgressDashboard(rows.slice(0, 99));
  expect(partial.overview).toMatchObject({ recentGames: 99, recent100: null, recentSecondsPerMove: null, best100: null });
  expect(partial.journey.points.at(-1)).toMatchObject({ games: 99, provisional: true });
  expect(partial.journey.frontier).toEqual([]);
  const missingTiming = computeProgressDashboard([...rows.slice(0, 100), { ...rows[100], thinkTimeMs: null }]);
  expect(missingTiming.overview).toMatchObject({ recent100: 80, recentSecondsPerMove: null });
  expect(missingTiming.journey.points.at(-1).game).toBe(100);
  const full = computeProgressDashboard([statsRow(100, 0), ...rows.slice(0, 99)]);
  expect(full.overview.best100).toBeCloseTo(80.2);
});
