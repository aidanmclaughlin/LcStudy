const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const { Chess } = require('chess.js');
const { computeProgressDashboard } = require('./lib/progress-stats');
const { buildGameResult } = require('./lib/game-result');
process.loadEnvFile(path.join(__dirname, '.env.local'));

// accuracy_history holds each move's first try; average_accuracy is their mean.
// The first 20 games predate search-based grading; the rest were played with retries.
const history = Array.from({ length: 160 }, (_, i) => {
  const average_accuracy = 70 + i * 0.1 + Math.sin(i / 7) * 4;
  return {
    date: new Date(i < 20 ? Date.UTC(2026, 6, 4, 0, i) : Date.UTC(2026, 9, 4, 0, i)).toISOString(),
    average_accuracy, total_moves: 20, accuracy_history: Array(20).fill(average_accuracy), maia_level: 1500
  };
});

function statsRow(accuracy, index, overrides = {}) {
  return {
    userId: 'fixture', gameId: `lichess_maia2_fixture_${index}`, attempts: 20, solved: true,
    accuracy, averageAccuracy: accuracy, playedAt: new Date(Date.UTC(2026, 9, 4, 0, index)),
    totalMoves: 20, averageRetries: 0, accuracyHistory: Array(20).fill(accuracy),
    maiaLevel: 1500, difficulty: null, leelaColor: 'w',
    openingLine: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'O-O', 'd6'],
    openingSource: 'lichess', openingRatingGroup: '1500', ...overrides
  };
}

async function setup(page, context) {
  // Some retries: 20 moves and 20-24 attempts per game, 1.10 attempts per move over any 100 games in a row.
  const stats = computeProgressDashboard(history.map((game, index) => statsRow(game.average_accuracy, index, {
    playedAt: new Date(game.date), accuracyHistory: game.accuracy_history, attempts: 20 + (index % 5)
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
    return { id: state.getSessionId(), fen: state.getChessEngine().fen(), scores: state.getMoveAccuracies(), tries: state.getTryCount(), ply: state.getSessionCache().currentIndex, review: state.getCurrentMoveIndex() };
  });
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

test('Stats preserves a played game', async ({ page, context }, testInfo) => {
  const { calls, moves } = await setup(page, context);
  await expect(page.locator('#accuracy-chart')).toHaveCount(0);
  await expect(page.locator('#hours-left-count')).toHaveCount(0);
  // One summary tile, first-try accuracy; time is not tracked.
  await expect(page.locator('.stats-trigger .stat-tile')).toHaveCount(1);
  await expect(page.locator('#avg-move-time, #current-move-time, #pace-comparison')).toHaveCount(0);
  await expect(page.locator('.stats-trigger #move-feedback')).toHaveCount(0);
  await expect(page.locator('#move-chart-count')).toHaveCount(0);
  // Game accuracy lives in the summary only; the chart header shows the last try.
  await expect(page.locator('#game-accuracy')).toHaveCount(0);
  const accuracy100 = mean(history.slice(-100).map(game => game.average_accuracy));
  await expect(page.locator('#avg-accuracy-label')).toHaveText('100-game accuracy');
  await expect(page.locator('#avg-accuracy')).toHaveText(`${accuracy100.toFixed(1)}%`);
  await expect(page.locator('.panel-chart #move-feedback')).toHaveText('--');
  await expect(page.locator('#current-accuracy')).toHaveText('--');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('aria-hidden', 'true');
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
  expect(before.tries).toBe(5);
  await expect(page.locator('#current-accuracy')).toHaveText('100.0%');
  await expect(page.locator('.panel-chart #move-feedback')).toHaveText('100.0%');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-tone', 'better');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-direction', 'up');
  await page.screenshot({ path: testInfo.outputPath('game-metrics.png') });
  const sessionCount = calls.sessions;
  await page.evaluate(() => { window.originalBoard = document.getElementById('board'); });
  await page.locator('#avg-accuracy').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Overview' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Breakdowns' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
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
  // Move history keys stay with Stats while it covers the board.
  await page.keyboard.press('ArrowLeft');
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Resume game' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(calls.sessions).toBe(sessionCount);
  expect(calls.saves).toBe(0);
  await page.locator('[data-square=b1]').click();
  await page.locator('[data-square=c3]').click();
  await expect.poll(async () => (await snapshot(page)).scores.length).toBe(6);
  await page.getByRole('button', { name: 'Accuracy summary, open statistics' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
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
      return [document.getElementById('avg-accuracy-label').textContent, document.getElementById('avg-accuracy').textContent];
    } finally {
      state.setMoveAccuracyChart(savedChart);
      state.setGameHistory(savedHistory);
      charts.updateStatistics();
    }
  });
  // Before 100 games the summary averages the games there are (summed newest first, as the app does).
  const first99 = history.slice(0, 99).reverse().reduce((sum, game) => sum + game.average_accuracy, 0) / 99;
  expect(progressWithoutChart).toEqual(['99-game accuracy', `${first99.toFixed(1)}%`]);
  calls.fail = true;
  await page.getByRole('button', { name: 'Accuracy summary, open statistics' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not be loaded');
  calls.fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.stats-accuracy-chart-line')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage === getComputedStyle(document.getElementById('stats-dialog')).backgroundImage)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.stats-page')).getPropertyValue('--text-primary') === getComputedStyle(document.documentElement).getPropertyValue('--text-primary'))).toBe(true);
  await expect(page.locator('.stats-metric .stats-metric-label')).toHaveText(['100-game accuracy', 'Attempts per move', 'Maia Elo']);
  await expect(page.locator('.stats-metric').filter({ hasText: 'Attempts per move' }).locator('strong')).toHaveText('1.10');
  await expect(page.locator('.stats-metric').filter({ hasText: 'Maia Elo' })).toHaveAttribute('title', /last 100 eligible games; 80% range/);
  await expect(page.getByRole('heading', { name: 'Accuracy', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Maia-equivalent Elo', exact: true })).toHaveCount(0);
  // A dot for every current-scoring game (21-160) under the rolling average line.
  await expect(page.locator('.stats-accuracy-chart-wrap .stats-chart-x-label')).toHaveText(['Game 21', 'Game 90', 'Game 160']);
  expect(await page.locator('.stats-accuracy-chart-games').evaluate(path => path.getAttribute('d').match(/M/g).length)).toBe(140);
  await expect(page.locator('.stats-chart-legend')).toContainText('Each game');
  await expect(page.locator('.stats-chart-legend')).toContainText('Average of up to 100 games');
  const latest = history.slice(-100);
  await expect(page.locator('.stats-metric').filter({ hasText: '100-game accuracy' }).locator('strong')).toHaveText(`${mean(latest.map(game => game.average_accuracy)).toFixed(1)}%`);
  await expect(page.locator('.stats-accuracy-band .stats-card-meta')).toHaveText('Games 21–160');
  // Time is not tracked anywhere on the page.
  await expect(page.getByRole('tab', { name: 'Timing' })).toHaveCount(0);
  await expect(page.getByText(/pace|seconds|thinking|time left|typical game|\bhours?\b/i)).toHaveCount(0);
  const backStyles = await page.getByRole('button', { name: 'Resume game' }).evaluate(button => {
    const style = getComputedStyle(button), box = button.getBoundingClientRect();
    return { background: style.backgroundImage, shadow: style.boxShadow, height: box.height, width: box.width };
  });
  expect(backStyles.background).toBe('none');
  expect(backStyles.shadow).toBe('none');
  expect(backStyles.height).toBeGreaterThanOrEqual(44);
  expect(backStyles.width).toBeLessThan(130);
  // No collapsible sections: every card is always visible.
  await expect(page.locator('details')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Current form', exact: true })).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByRole('heading', { name: 'Current form', exact: true })).toBeVisible();
    await expect(page.getByText('Best 100 games', { exact: true })).toBeVisible();
    await expect(page.getByText('Difficulty-adjusted', { exact: true })).toBeVisible();
    await expect(page.getByText('10-game average', { exact: true })).toBeVisible();
    await expect(page.getByText('Games left', { exact: true })).toBeVisible();
    const chart = await page.locator('.stats-accuracy-chart-wrap').boundingBox();
    expect(chart.width).toBeGreaterThan(width <= 600 ? width - 36 : 600);
    expect(chart.width).toBeLessThanOrEqual(744);
    for (const tab of ['Overview', 'Breakdowns']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      if (tab === 'Breakdowns') await expect(page.locator('.stats-caption')).toHaveText('Last 100 scored games');
      expect(await page.locator('#stats-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.locator('.stats-page').evaluate(el => getComputedStyle(el).caretColor)).toBe('rgba(0, 0, 0, 0)');
      if (tab === 'Breakdowns') {
        await expect(page.getByRole('heading', { name: 'Opening lines', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Data coverage', exact: true })).toBeVisible();
        expect(await page.locator('.stats-breakdown-row').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true);
      }
      await page.locator('#stats-dialog').evaluate(el => { el.scrollTop = 0; });
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${width}-${tab}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Resume game' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  expect(calls.saves).toBe(0);
  expect(errors).toEqual([]);
});

test('the accuracy chart plots every game from the first, for any history', async ({ page, context }) => {
  const { stats } = await setup(page, context);
  const { buildRollingAccuracy } = require('./public/legacy/js/modules/journey.mjs');
  for (const scores of [[], [80], Array.from({ length: 23 }, (_, i) => 60 + i), Array(120).fill(0), Array(120).fill(100)]) {
    stats.progress.accuracy100 = buildRollingAccuracy(scores);
    await page.locator('#avg-accuracy').click();
    if (scores.length === 0) {
      await expect(page.locator('.stats-accuracy-band').getByText('No scored games yet')).toBeVisible();
      await expect(page.locator('.stats-accuracy-chart-line')).toHaveCount(0);
    } else {
      await expect(page.locator('.stats-accuracy-chart-line')).toHaveAttribute('d', /^M[\d., Lh]+$/);
      expect(await page.locator('.stats-accuracy-chart-line').evaluate(path => path.getTotalLength())).toBeGreaterThan(0);
      // Reopening shows the previous chart until the new data arrives.
      await expect.poll(() => page.locator('.stats-accuracy-chart-games').evaluate(path => path.getAttribute('d').match(/M/g).length)).toBe(scores.length);
      const labels = await page.locator('.stats-accuracy-chart-wrap .stats-chart-y-axis').innerText();
      expect(labels).not.toMatch(/NaN|Infinity/);
      await expect(page.locator('.stats-accuracy-band .stats-card-meta')).toHaveText(scores.length === 1 ? 'Game 1' : `Games 1–${scores.length}`);
    }
    await page.getByRole('button', { name: 'Resume game' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Accuracy summary, open statistics' })).toBeFocused();
  }
});

test('the comparison arrow sets this game against the recent accuracy', async ({ page, context }, testInfo) => {
  await setup(page, context);
  await page.locator('[data-square=e2]').click();
  await page.locator('[data-square=e4]').click();
  await expect.poll(async () => (await snapshot(page)).ply).toBe(2);
  const configure = async (scores, games = 100) => page.evaluate(async ({ scores, games }) => {
    const state = await import('/legacy/js/modules/state.js');
    const charts = await import('/legacy/js/modules/charts.js');
    state.setMoveAccuracies(scores);
    state.setGameHistory(Array.from({ length: games }, () => ({ average_accuracy: 80, total_moves: 20 })));
    charts.updateStatistics();
  }, { scores, games });
  await configure([90]);
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-tone', 'better');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-direction', 'up');
  await configure([100, 40]);
  await expect(page.locator('#current-accuracy')).toHaveText('70.0%');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-tone', 'worse');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-direction', 'down');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('title', /10\.0 percentage points lower than your recent average/);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.locator('.stats-trigger').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.locator('.stat-value-row').evaluateAll(rows => rows.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('narrow-metrics.png') });
  await configure([80]);
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('aria-hidden', 'true');
  // Before 100 games the average covers the games there are, and the label says how many.
  await expect(page.locator('#avg-accuracy-label')).toHaveText('100-game accuracy');
  await configure([90], 23);
  await expect(page.locator('#avg-accuracy-label')).toHaveText('23-game accuracy');
  await expect(page.locator('#avg-accuracy')).toHaveText('80.0%');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('data-direction', 'up');
  await configure([90], 1);
  await expect(page.locator('#avg-accuracy-label')).toHaveText('1-game accuracy');
  await configure([90], 0);
  await expect(page.locator('#avg-accuracy-label')).toHaveText('100-game accuracy');
  await expect(page.locator('#avg-accuracy')).toHaveText('--');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('aria-hidden', 'true');
  await configure([]);
  await expect(page.locator('#current-accuracy')).toHaveText('--');
  await expect(page.locator('#move-feedback')).toHaveText('--');
  await expect(page.locator('#accuracy-comparison')).toHaveAttribute('aria-hidden', 'true');
});

test('the accuracy summary stays compact and separate from move feedback', async ({ page, context }, testInfo) => {
  await setup(page, context);
  await page.evaluate(async () => {
    const state = await import('/legacy/js/modules/state.js');
    const charts = await import('/legacy/js/modules/charts.js');
    const effects = await import('/legacy/js/modules/effects.js');
    // Three moves; the second was found on a retry, which isn't scored.
    state.setMoveAccuracies([100, 0, 80]);
    charts.updateStatistics();
    effects.updateMoveFeedback({ accuracy: 80 });
  });
  await expect(page.locator('#current-accuracy')).toHaveText('60.0%');
  await expect(page.locator('#move-feedback')).toHaveText('80.0%');

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const heading = await page.locator('.move-chart-heading').boundingBox();
    const summary = await page.locator('.stats-trigger').boundingBox();
    expect(summary.height).toBeLessThanOrEqual(80);
    expect(await page.locator('.stats-trigger .stat-label, .stats-trigger .stat-value').evaluateAll(elements => elements.every(element =>
      element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight
    ))).toBe(true);
    // The 100-game accuracy on the left, this game's on the right, each label above its value.
    const box = selector => page.locator(selector).boundingBox();
    const [label, value, gameLabel, gameValue] = await Promise.all(['.stat-label', '#avg-accuracy', '.stat-current-label', '.stat-value-row'].map(box));
    expect(label.x + label.width).toBeLessThanOrEqual(gameLabel.x);
    expect(value.x + value.width).toBeLessThanOrEqual(gameValue.x);
    expect(gameLabel.y + gameLabel.height).toBeLessThanOrEqual(gameValue.y + 1);
    expect(Math.abs((gameLabel.x + gameLabel.width) - (gameValue.x + gameValue.width))).toBeLessThan(1);
    expect(gameValue.x + gameValue.width).toBeLessThanOrEqual(summary.x + summary.width);
    for (const feedback of [null, { loading: true }, { error: true }, { illegal: true }, { accuracy: 100 }]) {
      await page.evaluate(async feedback => (await import('/legacy/js/modules/effects.js')).updateMoveFeedback(feedback), feedback);
      const next = await page.locator('.move-chart-heading').boundingBox();
      expect(next.height).toBe(heading.height);
      expect(await page.locator('#move-feedback').evaluate(value => value.scrollWidth <= value.clientWidth && value.scrollHeight <= value.clientHeight)).toBe(true);
      const title = await page.locator('.move-chart-heading h2').boundingBox();
      const value = await page.locator('#move-feedback').boundingBox();
      expect(title.x + title.width).toBeLessThanOrEqual(value.x);
    }
    await page.locator('.stats-trigger').screenshot({ path: testInfo.outputPath(`${width}-summary.png`) });
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
    leelaColor: index < 25 ? 'b' : 'w'
  }));
  const stats = computeProgressDashboard(rows);
  expect(stats.overview).toMatchObject({ totalGames: 125, totalMoves: 2500, recentGames: 100, recent100: 70, best100: 70 });
  expect(stats.progress.adjustedRecent100).toBe(70);
  expect(stats.progress.series.at(-1)).toMatchObject({ rolling100: 70, adjusted100: 70 });
  expect(stats.consistency.recentDeviation).toBeCloseTo(Math.sqrt(30000 / 99), 8);
  expect(stats.skill.colors).toEqual([{ label: 'White', accuracy: 70, exactRate: 25, games: 100, moves: 2000 }]);
  expect(stats.coverage).toMatchObject({ whiteGames: 100, blackGames: 25, lichessGames: 125 });
  expect(Object.keys(stats).sort()).toEqual(['consistency', 'coverage', 'elo', 'overview', 'progress', 'skill']);

  const changedOldGames = rows.map((row, index) => index < 25 ? statsRow(100, index) : row);
  const changed = computeProgressDashboard(changedOldGames);
  expect(changed.overview.recent100).toBe(stats.overview.recent100);
  expect(changed.progress.trendPer100).toBe(stats.progress.trendPer100);
  expect(changed.consistency).toEqual(stats.consistency);
  expect(changed.skill).toEqual(stats.skill);

  const unscored = statsRow(null, 125, { accuracyHistory: [] });
  const skipped = computeProgressDashboard([...rows, unscored]);
  expect(skipped.overview).toMatchObject({ recent100: 70, recentGames: 100, totalGames: 126 });
});

test('attempts per move count retries over every move of the headline games', () => {
  // 120 games of 20 moves: older ones took 50 attempts, the latest 100 took 30.
  const rows = Array.from({ length: 120 }, (_, index) => statsRow(80, index, { attempts: index < 20 ? 50 : 30 }));
  expect(computeProgressDashboard(rows).overview.recentAttemptsPerMove).toBe(1.5);
  // Longer games weigh more: the average is over moves, not games.
  const mixed = [statsRow(80, 0, { totalMoves: 10, attempts: 30 }), statsRow(80, 1, { totalMoves: 30, attempts: 30 })];
  expect(computeProgressDashboard(mixed).overview.recentAttemptsPerMove).toBe(1.5);
  // Every move takes at least one attempt, and games without moves are skipped.
  const odd = [statsRow(80, 0, { attempts: 0 }), statsRow(80, 1, { totalMoves: 0, attempts: 9 })];
  expect(computeProgressDashboard(odd).overview.recentAttemptsPerMove).toBe(1);
  // Games from before retries (one try per move) don't count; the tile says how many do.
  const beforeRetries = Array.from({ length: 70 }, (_, index) => statsRow(80, index, { playedAt: new Date(Date.UTC(2026, 9, 2, 0, index)) }));
  const withRetries = Array.from({ length: 30 }, (_, index) => statsRow(80, 70 + index, { attempts: 30 }));
  expect(computeProgressDashboard([...beforeRetries, ...withRetries]).overview)
    .toMatchObject({ recentGames: 100, recentAttemptsPerMove: 1.5, recentAttemptsGames: 30 });
  expect(computeProgressDashboard(beforeRetries).overview).toMatchObject({ recentAttemptsPerMove: null, recentAttemptsGames: 0 });
});

test('the server scores a game on its first tries, whatever the client sends', () => {
  const tries = [[['b2b3', 0], ['d2d4', 70], ['e2e4', 100]], [['g1f3', 100]]];
  // An older tab sends the mean over every try; the first tries decide.
  const result = buildGameResult({ accuracyHistory: [0, 100], attempts: 5, triesHistory: tries, averageAccuracy: 85, totalMoves: 9 });
  expect(result).toEqual({ accuracyHistory: [0, 100], totalMoves: 2, attempts: 5, averageRetries: 1.5, averageAccuracy: 50, triesHistory: tries });
  // Attempts can't be fewer than moves or logged tries.
  expect(buildGameResult({ accuracyHistory: [0, 100], attempts: 1, triesHistory: tries }).attempts).toBe(4);
  // A try log that doesn't match the first tries is dropped, not the game.
  expect(buildGameResult({ accuracyHistory: [70, 100], triesHistory: tries }).triesHistory).toBeNull();
  expect(buildGameResult({ accuracyHistory: [0, 100], triesHistory: tries.slice(0, 1) }).triesHistory).toBeNull();
  expect(buildGameResult({ accuracyHistory: [0, 100], triesHistory: [[['b2b3', 0]], [['bad', 100]]] }).triesHistory).toBeNull();
  expect(buildGameResult({ accuracyHistory: [] })).toMatchObject({ totalMoves: 0, attempts: 0, averageAccuracy: null, averageRetries: null });
  // Scores outside 0-100 reject the game.
  expect(() => buildGameResult({ accuracyHistory: [50, 101] })).toThrow('Invalid accuracy history');
  expect(() => buildGameResult({ accuracyHistory: [50, null] })).toThrow('Invalid accuracy history');
});

test('dashboard handles short histories', () => {
  const empty = computeProgressDashboard([]);
  expect(empty.overview).toMatchObject({ recentGames: 0, recent100: null, recentAttemptsPerMove: null, best100: null });
  expect(empty.progress.forecast).toBeNull();
  const rows = Array.from({ length: 101 }, (_, index) => statsRow(80, index));
  // Before 100 games the headlines and chart cover the games there are; the best 100 needs 100.
  const partial = computeProgressDashboard(rows.slice(0, 99));
  expect(partial.overview).toMatchObject({ recentGames: 99, recent100: 80, best100: null });
  expect(partial.progress.accuracy100).toHaveLength(99);
  expect(partial.progress.accuracy100[0]).toEqual({ game: 1, score: 80, accuracy: 80, games: 1 });
  expect(computeProgressDashboard(rows.slice(0, 1)).overview).toMatchObject({ recentGames: 1, recent100: 80 });
  expect(Object.keys(partial.progress.forecast).sort()).toEqual(['remainingGames', 'remainingGamesHigh', 'remainingGamesLow', 'targetGame', 'targetGameHigh', 'targetGameLow']);
  const full = computeProgressDashboard([statsRow(100, 0), ...rows.slice(0, 99)]);
  expect(full.overview.best100).toBeCloseTo(80.2);
});
