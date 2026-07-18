const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { test, devices, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const { Chess } = require('chess.js');

function loadEnv(file) {
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    let value = trimmed.slice(idx + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function moveParts(uci) {
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

function normalizeUci(move) {
  return `${move.from}${move.to}${move.promotion || ''}`.toLowerCase();
}

function buildProgressHistory() {
  return Array.from({ length: 45 }, (_, index) => {
    const accuracy = 64 + index * 0.34 + Math.sin(index * 0.8) * 2.2;
    return {
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      average_accuracy: accuracy,
      total_moves: 20,
      accuracy_history: Array(20).fill(accuracy),
      maia_level: 1500,
      duration_ms: 120000 + index * 1500,
      result: 'finished',
    };
  });
}

function parseAnalysisComment(comment) {
  if (!comment) return undefined;

  const match = comment.match(/\[%lcstudy\s+([A-Za-z0-9_-]+)\]/);
  if (!match) return undefined;

  const raw = match[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw.padEnd(Math.ceil(raw.length / 4) * 4, '=');
  const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));

  return payload.moves.map((move) => ({
    uci: move.u.toLowerCase(),
    san: move.s,
    policy: Number(move.p),
    accuracy: Number(move.a),
    best: move.u.toLowerCase() === payload.best.toLowerCase(),
  }));
}

function buildFinalMateSession() {
  const pgnDir = path.join(process.cwd(), 'data/pgn');

  const pgnFiles = fs.readdirSync(pgnDir)
    .filter((name) => name.endsWith('.pgn') || name.endsWith('.pgn.gz'))
    .sort();
  for (const file of pgnFiles) {
    let pgn;
    const game = new Chess();
    try {
      const raw = fs.readFileSync(path.join(pgnDir, file));
      pgn = file.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
      game.loadPgn(pgn);
    } catch {
      continue; // skip partially-written or malformed files
    }
    const headers = game.header();
    const blackPlayer = String(headers.Black || '').toLowerCase();
    const flip = blackPlayer.includes('player') || blackPlayer.includes('leela');

    const commentsByFen = new Map(
      game.getComments().map(({ fen, comment }) => [fen, comment])
    );
    const replay = new Chess();
    const moves = [];
    let matePly = -1;
    let mateFen = null;

    for (const move of game.history({ verbose: true })) {
      const fenBefore = replay.fen();
      replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      const analysis = parseAnalysisComment(commentsByFen.get(replay.fen()));
      moves.push({
        uci: normalizeUci(move),
        san: move.san,
        analysis,
      });

      if (replay.isCheckmate() && analysis?.length) {
        matePly = moves.length - 1;
        mateFen = fenBefore;
      }
    }

    if (matePly >= 0 && mateFen) {
      return {
        id: 'final-mate-session',
        game_id: `final-mate-fixture-${file}`,
        flip,
        fen: mateFen,
        starting_fen: new Chess().fen(),
        moves,
        ply: matePly,
        maia_level: 1500,
      };
    }
  }

  throw new Error('No final mate fixture found');
}

async function squareClick(page, square) {
  await page.locator(`[data-square="${square}"]`).click({ timeout: 10000 });
}

async function squareTap(page, square) {
  const center = await squareCenter(page, square);
  await page.touchscreen.tap(center.x, center.y);
}

async function squareCenter(page, square) {
  const box = await page.locator(`[data-square="${square}"]`).boundingBox({ timeout: 10000 });
  if (!box) throw new Error(`No bounding box for ${square}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragMove(page, from, to, options = {}) {
  const start = await squareCenter(page, from);
  const end = await squareCenter(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });

  if (options.expectPreview) {
    await expect(page.locator('.drag-ghost')).toHaveCount(1);
    await expect(page.locator(`[data-square="${from}"] .piece.is-dragging-source`)).toHaveCount(1);
  }

  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();

  if (options.expectPreview) {
    await expect(page.locator('.drag-ghost')).toHaveCount(0);
  }
}

async function requireSquareClass(page, square, className) {
  const hasClass = await page.locator(`[data-square="${square}"]`).evaluate((el, cls) => (
    el.classList.contains(cls)
  ), className);

  if (!hasClass) {
    throw new Error(`Expected ${square} to have ${className}`);
  }
}

async function requireMoveHighlight(page, role, move) {
  const [from, to] = moveParts(move.uci);
  const prefix = role === 'user' ? 'last-user-move' : 'last-opponent-move';

  await requireSquareClass(page, from, prefix);
  await requireSquareClass(page, from, `${prefix}-from`);
  await requireSquareClass(page, to, prefix);
  await requireSquareClass(page, to, `${prefix}-to`);
}

async function pieceAt(page, square) {
  const piece = page.locator(`[data-square="${square}"] .piece`);
  if (await piece.count() === 0) return null;
  return piece.first().evaluate((element) => element.dataset.piece || null);
}

test.use({
  ...devices['iPhone 14'],
  baseURL: 'http://localhost:3000',
});

test('accuracy gameplay, haptics, and move review', async ({ page, context }) => {
  test.setTimeout(60000);
  loadEnv(path.join(process.cwd(), '.env.local'));
  const { sql } = require('@vercel/postgres');
  const email = `lcstudy-e2e-${Date.now()}@example.test`;
  const { rows } = await sql`
    INSERT INTO users (email, name, image)
    VALUES (${email}, ${'LcStudy E2E'}, ${null})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, email, name, image;
  `;
  const user = rows[0];
  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET,
    token: { sub: user.id, userId: user.id, email: user.email, name: user.name },
  });
  await sql`DELETE FROM users WHERE id = ${user.id};`;

  await context.addCookies([
    { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
    { name: '__Secure-next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: true },
  ]);

  // Compile the stats route before exercising document navigation; otherwise
  // Next dev's first-route Fast Refresh can reload the prior page mid-click.
  const statsWarmup = await context.request.get('http://localhost:3000/stats');
  expect(statsWarmup.ok()).toBe(true);

  await context.addInitScript(() => {
    window.__haptics = [];
    window.__vibrateCalls = [];
    try {
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value(pattern) {
          window.__vibrateCalls.push(pattern);
          return false;
        },
      });
    } catch (_) {}

    document.addEventListener('change', (event) => {
      if (event.target?.matches?.('input[switch]')) {
        window.__haptics.push({
          type: event.target.matches('[data-lcstudy-direct-haptic]') ? 'direct-switch' : 'programmatic-switch',
          trusted: event.isTrusted,
          square: event.target.closest('[data-square]')?.dataset?.square || null,
          at: Date.now(),
        });
      }
    });
  });

  await page.route('**/api/v1/game-history', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ history: buildProgressHistory() }),
  }));

  let successfulSessionResponses = 0;
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/session/new') && response.status() === 200) {
      successfulSessionResponses += 1;
    }
  });
  const sessionResponsePromise = page.waitForResponse((resp) => (
    resp.url().includes('/api/v1/session/new') && resp.status() === 200
  ));
  await page.goto('/', { waitUntil: 'networkidle' });
  const sessionData = await (await sessionResponsePromise).json();
  await page.waitForSelector('#board .piece');
  await expect(page.locator('#completion-overlay')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Hours Left to 97%' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '25-Game Accuracy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accuracy Over Moves' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats');
  await expect(page.locator('.panel-chart canvas')).toHaveCount(2);
  await expect(page.locator('.panel-goal canvas')).toHaveCount(0);
  await expect(page.locator('input[switch][data-lcstudy-haptic-switch]')).toHaveCount(1);
  await expect(page.locator('input[switch][data-lcstudy-direct-haptic]')).toHaveCount(64);
  await page.screenshot({ path: 'e2e-screenshots/01-initial-iphone.png', fullPage: true });

  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 844 });
  const narrowGoalFits = await page.locator('.panel-goal').evaluate((panel) => {
    const count = panel.querySelector('#hours-left-count');
    const originalText = count?.textContent;
    if (count) count.textContent = '16 played / 1,300h left';
    const fits = panel.scrollWidth <= panel.clientWidth;
    if (count) count.textContent = originalText;
    return fits;
  });
  expect(narrowGoalFits).toBe(true);
  if (originalViewport) await page.setViewportSize(originalViewport);

  const firstMove = sessionData.moves[sessionData.ply];
  const firstReply = sessionData.moves[sessionData.ply + 1];
  const [firstFrom, firstTo] = moveParts(firstMove.uci);
  const [, firstReplyTo] = moveParts(firstReply.uci);
  await dragMove(page, firstFrom, firstTo, { expectPreview: true });
  await page.waitForSelector('.accuracy-burst');
  await page.screenshot({ path: 'e2e-screenshots/02a-accuracy-burst.png', fullPage: true });
  await page.waitForFunction((replySan) => (
    (document.querySelector('#move-list')?.textContent || '').includes(replySan)
  ), firstReply.san);
  expect(await pieceAt(page, firstReplyTo)).not.toBeNull();
  await page.waitForFunction(() => document.querySelector('#move-feedback')?.textContent?.includes('100'));
  await requireMoveHighlight(page, 'user', firstMove);
  await requireMoveHighlight(page, 'opponent', firstReply);
  await page.screenshot({ path: 'e2e-screenshots/02-after-best-move.png', fullPage: true });

  const secondMove = sessionData.moves[sessionData.ply + 2];
  const secondReply = sessionData.moves[sessionData.ply + 3];
  if (!secondMove?.analysis?.length) throw new Error('No second analyzed prompt');
  const alternate = [...secondMove.analysis].reverse().find((move) => (
    move.uci !== secondMove.uci && move.uci.slice(0, 2) !== secondMove.uci.slice(0, 2)
  )) || [...secondMove.analysis].reverse().find((move) => move.uci !== secondMove.uci);
  if (!alternate) throw new Error('No alternate legal move');

  const [altFrom, altTo] = moveParts(alternate.uci);
  const [secondFrom] = moveParts(secondMove.uci);
  await squareTap(page, altFrom);
  await page.waitForTimeout(150);
  await squareTap(page, altTo);
  await page.waitForTimeout(120);
  expect(await pieceAt(page, secondFrom)).not.toBeNull();
  await page.waitForSelector('.accuracy-burst');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'e2e-screenshots/03a-low-accuracy-burst.png', fullPage: true });
  await page.waitForFunction((replySan) => (
    (document.querySelector('#move-list')?.textContent || '').includes(replySan)
  ), secondReply.san);
  await requireMoveHighlight(page, 'user', secondMove);
  await requireMoveHighlight(page, 'opponent', secondReply);
  await page.screenshot({ path: 'e2e-screenshots/03-after-low-accuracy-move.png', fullPage: true });

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  await requireMoveHighlight(page, 'user', secondMove);
  await requireMoveHighlight(page, 'opponent', secondReply);
  await page.screenshot({ path: 'e2e-screenshots/04-review-back.png', fullPage: true });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await requireMoveHighlight(page, 'user', secondMove);
  await requireMoveHighlight(page, 'opponent', secondReply);
  await page.screenshot({ path: 'e2e-screenshots/05-review-forward.png', fullPage: true });
  await expect(page.locator('#review-prev')).toBeVisible();
  await page.locator('#review-prev').click();
  await expect(page.locator('#board')).toHaveClass(/reviewing-moves/);
  await page.screenshot({ path: 'e2e-screenshots/06-review-button-back.png', fullPage: true });
  await page.locator('#review-next').click();
  await expect(page.locator('#board')).not.toHaveClass(/reviewing-moves/);
  await page.screenshot({ path: 'e2e-screenshots/07-review-button-forward.png', fullPage: true });

  const haptics = await page.evaluate(() => window.__haptics || []);
  const trustedDirectHaptics = haptics.filter((event) => event.type === 'direct-switch' && event.trusted);
  const vibrateCalls = await page.evaluate(() => window.__vibrateCalls || []);
  if (trustedDirectHaptics.length < 2) {
    throw new Error(`Expected trusted haptics from direct board touches, got ${JSON.stringify(haptics)}`);
  }
  expect(vibrateCalls).toEqual([]);
  await expect(page.locator('input[switch][data-lcstudy-haptic-switch]')).toHaveCount(1);
  await expect(page.locator('input[switch][data-lcstudy-direct-haptic]')).toHaveCount(64);
  const allTimeMetricText = await page.locator('#all-time-accuracy').textContent();
  const metricText = await page.locator('#avg-accuracy').textContent();
  const gameMetricText = await page.locator('#game-accuracy').textContent();
  const feedbackText = await page.locator('#move-feedback').textContent();
  const historyText = await page.locator('#move-list').textContent();
  if (!allTimeMetricText?.includes('%') || !metricText?.includes('%') || !gameMetricText?.includes('%') || !feedbackText?.includes('%')) {
    throw new Error(`Expected accuracy metrics, got ${allTimeMetricText} / ${metricText} / ${gameMetricText} / ${feedbackText}`);
  }
  if (feedbackText.includes('100.0')) {
    throw new Error(`Expected legal wrong move accuracy below 100%, got ${feedbackText}`);
  }
  const accuracyView = await page.evaluate(async () => {
    const state = await import('/legacy/js/modules/state.js');
    const charts = await import('/legacy/js/modules/charts.js');
    const chart = state.getAccuracyChart();
    const originalHistory = state.getGameHistory();
    const originalMoves = state.getMoveAccuracies();

    state.setMoveAccuracies([]);
    charts.updateCharts();
    const normalEstimate = charts.calculateCurrentGoalEstimate(originalHistory, []);

    state.setGameHistory(originalHistory.slice(0, 1));
    charts.updateCharts();
    const firstGameEstimate = charts.calculateCurrentGoalEstimate(originalHistory.slice(0, 1), []);
    const firstGame = {
      countText: document.getElementById('hours-left-count')?.textContent,
      title: document.getElementById('hours-left-count')?.title,
      chartPoints: chart.data.datasets[0].data.filter(Number.isFinite).length,
      hoursLeftMs: firstGameEstimate.hoursLeftMs,
    };

    state.setGameHistory(originalHistory.map((game) => ({
      ...game,
      duration_ms: Number(game.duration_ms) * 2,
    })));
    charts.updateCharts();
    const slowerEstimate = charts.calculateCurrentGoalEstimate(state.getGameHistory(), []);

    state.setGameHistory(originalHistory.map((game, index) => ({
      ...game,
      duration_ms: index === 0 ? Number(game.duration_ms) * 1000 : game.duration_ms,
    })));
    charts.updateCharts();
    const outlierEstimate = charts.calculateCurrentGoalEstimate(state.getGameHistory(), []);

    state.setGameHistory(originalHistory);
    state.setMoveAccuracies(originalMoves);
    charts.updateCharts();
    const finalAccuracy = chart.data.datasets[0].data.filter(Number.isFinite);
    const perGame = originalHistory.map((game) => Number(game.average_accuracy));
    if (originalMoves.length > 0) {
      perGame.push(originalMoves.reduce((sum, value) => sum + Number(value), 0) / originalMoves.length);
    }
    const expectedLast = perGame.slice(-25).reduce((sum, value) => sum + value, 0) / Math.min(25, perGame.length);

    return {
      label: chart.data.datasets[0].label,
      pointCount: finalAccuracy.length,
      firstAccuracy: finalAccuracy[0],
      expectedFirst: perGame[0],
      lastAccuracy: finalAccuracy.at(-1),
      expectedLast,
      gameCountText: document.getElementById('accuracy-chart-count')?.textContent,
      axisMinimum: chart.options.scales.y.min,
      dataMinimum: Math.min(...finalAccuracy),
      pointRadius: chart.data.datasets[0].pointRadius,
      normalHours: normalEstimate.hoursLeftMs / 3600000,
      slowerHours: slowerEstimate.hoursLeftMs / 3600000,
      outlierHours: outlierEstimate.hoursLeftMs / 3600000,
      firstGame,
    };
  });
  expect(accuracyView.label).toBe('25-Game Accuracy');
  expect(accuracyView.pointCount).toBe(46);
  expect(accuracyView.firstAccuracy).toBeCloseTo(accuracyView.expectedFirst, 8);
  expect(accuracyView.lastAccuracy).toBeCloseTo(accuracyView.expectedLast, 8);
  expect(accuracyView.gameCountText).toBe('45 games');
  expect(accuracyView.axisMinimum).toBeGreaterThan(0);
  expect(accuracyView.axisMinimum).toBeCloseTo(accuracyView.dataMinimum, 8);
  expect(accuracyView.pointRadius).toBe(0);
  expect(accuracyView.slowerHours / accuracyView.normalHours).toBeCloseTo(2, 5);
  expect(accuracyView.outlierHours / accuracyView.normalHours).toBeLessThan(1.05);
  expect(accuracyView.firstGame.hoursLeftMs).toBeGreaterThan(0);
  expect(accuracyView.firstGame.countText).toMatch(/^1 played \/ [\d,.]+h left$/);
  expect(accuracyView.firstGame.title).toContain('Power-law estimate from 1 game');
  expect(accuracyView.firstGame.chartPoints).toBe(1);

  await Promise.all([
    page.waitForURL('**/stats'),
    page.getByRole('link', { name: 'Stats' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
  const sessionResponsesBeforeReturn = successfulSessionResponses;
  await Promise.all([
    page.waitForURL('http://localhost:3000/'),
    page.getByRole('link', { name: 'Game' }).click(),
  ]);
  await page.waitForSelector('#board .piece');
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#accuracy-chart')).toBeVisible();
  await expect.poll(() => successfulSessionResponses).toBeGreaterThanOrEqual(sessionResponsesBeforeReturn + 2);
  await sql`DELETE FROM users WHERE email = ${email};`;

  console.log(JSON.stringify({
    screenshots: 9,
    haptics: haptics.length,
    trustedDirectHaptics: trustedDirectHaptics.length,
    hapticBackend: 'direct-ios-switch',
    allTimeMetricText,
    metricText,
    gameMetricText,
    feedbackText,
    historyText,
    accuracyView,
    firstMove: firstMove.uci,
    firstReply: firstReply.uci,
    alternateMove: alternate.uci,
    secondMove: secondMove.uci,
    secondReply: secondReply.uci,
  }));
});

test.describe('progress dashboard', () => {
  const desktopSafari = { ...devices['Desktop Safari'] };
  delete desktopSafari.defaultBrowserType;

  test.use({
    ...desktopSafari,
    baseURL: 'http://localhost:3000',
  });

  test('renders modeled progress on desktop and mobile', async ({ page, context }) => {
    test.setTimeout(60000);
    loadEnv(path.join(process.cwd(), '.env.local'));
    const { sql } = require('@vercel/postgres');
    const email = `lcstudy-stats-e2e-${Date.now()}@example.test`;
    const { rows } = await sql`
      INSERT INTO users (email, name, image)
      VALUES (${email}, ${'LcStudy Stats E2E'}, ${null})
      RETURNING id, email, name, image;
    `;
    const user = rows[0];
    const token = await encode({
      secret: process.env.NEXTAUTH_SECRET,
      token: { sub: user.id, userId: user.id, email: user.email, name: user.name },
    });
    const fixtureRows = Array.from({ length: 36 }, (_, index) => {
      const accuracy = 81 + index * 0.13 + Math.sin(index * 0.7) * 0.6;
      const totalMoves = 12 + (index % 9);
      const gameId = `stats-e2e-${Date.now()}-${index}`;
      return {
        id: gameId,
        source: {
          precomputed: true,
          leelaColor: index % 2 === 0 ? 'w' : 'b',
          openingLine: index % 3 === 0 ? ['e4', 'e5'] : index % 3 === 1 ? ['d4', 'd5'] : ['Nf3', 'Nf6'],
          metadata: { openingSource: 'lichess-rated-rapid-dump' },
        },
        difficulty: 70 + Math.sin(index * 0.45) * 8,
        playedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        accuracy,
        totalMoves,
        accuracyHistory: Array.from({ length: totalMoves }, (_, moveIndex) => (
          Math.max(0, Math.min(100, accuracy + Math.sin(moveIndex * 0.9) * 8))
        )),
        maiaLevel: 1100 + (index % 6) * 200,
        durationMs: 140000 + index * 1200,
        thinkTimeMs: 90000 + index * 900,
        moveTimesMs: Array.from({ length: totalMoves }, () => 5000 + index * 40),
      };
    });
    const gameIds = fixtureRows.map((row) => row.id);

    try {
      await sql.query(
        `INSERT INTO games (id, source, difficulty)
         SELECT id, source, difficulty
         FROM jsonb_to_recordset($1::jsonb)
           AS fixture(id text, source jsonb, difficulty numeric)`,
        [JSON.stringify(fixtureRows)]
      );
      await sql.query(
        `INSERT INTO user_games (
           user_id, game_id, attempts, solved, accuracy, played_at,
           total_moves, average_accuracy, accuracy_history, maia_level,
           duration_ms, think_time_ms, move_times_ms
         )
         SELECT $1::uuid, id, total_moves, true, accuracy, played_at,
                total_moves, accuracy, accuracy_history, maia_level,
                duration_ms, think_time_ms, move_times_ms
         FROM jsonb_to_recordset($2::jsonb) AS fixture(
           id text, played_at timestamptz, accuracy numeric, total_moves integer,
           accuracy_history jsonb, maia_level integer, duration_ms integer,
           think_time_ms integer, move_times_ms jsonb
         )`,
        [user.id, JSON.stringify(fixtureRows.map((row) => ({
          id: row.id,
          played_at: row.playedAt,
          accuracy: row.accuracy,
          total_moves: row.totalMoves,
          accuracy_history: row.accuracyHistory,
          maia_level: row.maiaLevel,
          duration_ms: row.durationMs,
          think_time_ms: row.thinkTimeMs,
          move_times_ms: row.moveTimesMs,
        })))]
      );

      await context.addCookies([
        { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
        { name: '__Secure-next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: true },
      ]);

      await page.goto('/stats', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Maia Elo', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Accuracy', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Skill Map', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Time', exact: true })).toBeVisible();
      const eloMetric = page.locator('.stats-metric').filter({ hasText: 'Maia Elo' });
      await expect(eloMetric.locator('strong')).toHaveText('1,300');
      await expect(eloMetric.locator('.stats-metric-detail')).toHaveText('1,190 to 1,410 80% range');
      await expect(page.locator('.stats-progress-chart')).toHaveCount(2);
      await expect(page.locator('.stats-elo-chart-line')).toHaveCount(1);
      await expect(page.locator('.stats-elo-band .stats-chart-label').filter({ hasText: '<1,050' })).toHaveCount(1);
      await expect(page.locator('.stats-elo-band .stats-chart-label').filter({ hasText: '2,100+' })).toHaveCount(1);
      await expect(page.locator('.stats-chart-line')).toHaveCount(3);
      await expect(page.locator('.stats-breakdown-row')).not.toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight)).toBe(true);
      await page.screenshot({ path: 'e2e-screenshots/11-stats-desktop.png', fullPage: true });

      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await page.locator('.stats-breakdown-row').evaluateAll((rows) => (
        rows.every((row) => row.scrollWidth <= row.clientWidth + 1)
      ))).toBe(true);
      await page.screenshot({ path: 'e2e-screenshots/12-stats-mobile.png', fullPage: true });
    } finally {
      await sql`DELETE FROM users WHERE id = ${user.id};`;
      await sql.query('DELETE FROM games WHERE id = ANY($1::text[])', [gameIds]);
    }
  });
});

test.describe('desktop checkmate', () => {
  const desktopSafari = { ...devices['Desktop Safari'] };
  delete desktopSafari.defaultBrowserType;

  test.use({
    ...desktopSafari,
    baseURL: 'http://localhost:3000',
  });

  test('checkmate prompt completes after wrong illegal move', async ({ page, context }) => {
    test.setTimeout(60000);
    loadEnv(path.join(process.cwd(), '.env.local'));
    const { sql } = require('@vercel/postgres');
    const email = `lcstudy-mate-e2e-${Date.now()}@example.test`;
    const { rows } = await sql`
      INSERT INTO users (email, name, image)
      VALUES (${email}, ${'LcStudy Mate E2E'}, ${null})
      RETURNING id, email, name, image;
    `;
    const user = rows[0];
    const token = await encode({
      secret: process.env.NEXTAUTH_SECRET,
      token: { sub: user.id, userId: user.id, email: user.email, name: user.name },
    });
    await sql`DELETE FROM users WHERE id = ${user.id};`;

    await context.addCookies([
      { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
      { name: '__Secure-next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: true },
    ]);

    const fixture = buildFinalMateSession();
    let sessionNewCalls = 0;
    let completeCalls = 0;
    const completePayloads = [];

    await page.route('**/api/v1/game-history', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: [] }),
    }));
    await page.route('**/api/v1/session/new', route => {
      sessionNewCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    });
    await page.route('**/api/v1/session/*/complete', async route => {
      completeCalls += 1;
      completePayloads.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#board .piece');
    // Initial game load plus the background prefetch of the next game.
    await expect.poll(() => sessionNewCalls).toBe(2);

    const expectedMate = fixture.moves[fixture.ply];
    const [expectedFrom, expectedTo] = moveParts(expectedMate.uci);
    const legalWrong = expectedMate.analysis.find((move) => move.uci !== expectedMate.uci);
    if (!legalWrong) throw new Error('No legal wrong mate move found');
    const [wrongFrom, wrongTo] = moveParts(legalWrong.uci);
    const mateBoard = new Chess(fixture.fen);
    const movingPiece = mateBoard.get(expectedFrom);
    if (!movingPiece) throw new Error('No mating piece found');
    const expectedPieceCode = movingPiece ? `${movingPiece.color}${movingPiece.type.toUpperCase()}` : null;
    const legalMateMoves = new Set(mateBoard.moves({ verbose: true }).map(normalizeUci));
    const illegalTo = [
      'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
      'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
      'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
      'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
      'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
      'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
      'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
      'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
    ].find((square) => square !== expectedFrom && !mateBoard.get(square) && !legalMateMoves.has(`${expectedFrom}${square}`));
    if (!illegalTo) throw new Error('No illegal empty mate target found');

    await squareClick(page, expectedFrom);
    await squareClick(page, illegalTo);
    await page.waitForFunction(() => (
      (document.querySelector('#move-feedback')?.textContent || '').includes('Illegal move')
    ));
    expect(await pieceAt(page, expectedFrom)).toBe(expectedPieceCode);
    expect(completeCalls).toBe(0);

    await squareClick(page, wrongFrom);
    await squareClick(page, wrongTo);
    await page.waitForTimeout(120);
    expect(await pieceAt(page, expectedFrom)).toBe(expectedPieceCode);
    await page.waitForFunction((expectedSan) => (
      (document.querySelector('#move-list')?.textContent || '').includes(expectedSan) &&
      (document.querySelector('#move-feedback')?.textContent || '').includes('%')
    ), expectedMate.san);
    await page.waitForSelector('.confetti');
    await requireMoveHighlight(page, 'user', fixture.moves[fixture.ply]);
    await expect(page.locator('#completion-overlay')).toBeVisible();
    await expect(page.locator('#completion-new')).toBeVisible();
    await expect(page.locator('.completion-signout')).toBeVisible();
    await page.screenshot({ path: 'e2e-screenshots/10-checkmate-auto-play.png', fullPage: true });
    await expect.poll(() => completeCalls).toBe(1);
    await page.waitForTimeout(3200);
    expect(sessionNewCalls).toBe(2);
    expect(completePayloads[0]?.accuracy_history).toEqual([legalWrong.accuracy]);
    expect(completePayloads[0]?.duration_ms).toBeGreaterThan(0);
    expect(completePayloads[0]?.think_time_ms).toBeGreaterThan(0);
    expect(completePayloads[0]?.move_times_ms).toHaveLength(1);
    // The think-budget coach UI was removed; the client no longer sends a suggestion.
    expect(completePayloads[0]?.suggested_think_ms).toBeUndefined();
    expect(await pieceAt(page, expectedFrom)).toBeNull();
    expect(await pieceAt(page, expectedTo)).toBe(expectedPieceCode);

    await page.locator('#completion-review').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#completion-overlay')).toBeHidden();
    await expect(page.locator('#board')).toHaveClass(/reviewing-moves/);
    expect(await pieceAt(page, expectedFrom)).toBeNull();
    expect(await pieceAt(page, expectedTo)).toBe(expectedPieceCode);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    expect(await pieceAt(page, expectedFrom)).toBe(expectedPieceCode);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    expect(await pieceAt(page, expectedFrom)).toBeNull();
    expect(await pieceAt(page, expectedTo)).toBe(expectedPieceCode);
    await expect(page.locator('#completion-overlay')).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await expect(page.locator('#board')).not.toHaveClass(/reviewing-moves/);
    await expect(page.locator('#completion-overlay')).toBeVisible();

    await page.locator('#completion-new').click();
    // New Game consumes the prefetched session and prefetches another.
    await expect.poll(() => sessionNewCalls).toBe(3);
    await expect(page.locator('#completion-overlay')).toBeHidden();
    expect(completeCalls).toBe(1);
    await page.waitForFunction((from) => (
      Boolean(document.querySelector(`[data-square="${from}"] .piece`)?.dataset?.piece)
    ), expectedFrom);

    const historyText = await page.locator('#move-list').textContent();
    const feedbackText = await page.locator('#move-feedback').textContent();
    await sql`DELETE FROM users WHERE email = ${email};`;

    console.log(JSON.stringify({
      checkmateMove: fixture.moves[fixture.ply].uci,
      feedbackText,
      historyText,
    }));
  });
});
