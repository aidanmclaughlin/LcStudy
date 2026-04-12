const fs = require('fs');
const path = require('path');
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

  for (const file of fs.readdirSync(pgnDir).filter((name) => name.endsWith('.pgn')).sort()) {
    const pgn = fs.readFileSync(path.join(pgnDir, file), 'utf8');
    const game = new Chess();
    game.loadPgn(pgn);
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

async function squareCenter(page, square) {
  const box = await page.locator(`[data-square="${square}"]`).boundingBox({ timeout: 10000 });
  if (!box) throw new Error(`No bounding box for ${square}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragMove(page, from, to) {
  const start = await squareCenter(page, from);
  const end = await squareCenter(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
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

  await context.addInitScript(() => {
    window.__haptics = [];
    try {
      Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    } catch (_) {}
    const originalClick = HTMLLabelElement.prototype.click;
    HTMLLabelElement.prototype.click = function patchedClick() {
      if (this.querySelector && this.querySelector('input[switch]')) {
        window.__haptics.push({ type: 'ios-switch', at: Date.now() });
      }
      return originalClick.call(this);
    };
  });

  const sessionResponsePromise = page.waitForResponse((resp) => (
    resp.url().includes('/api/v1/session/new') && resp.status() === 200
  ));
  await page.goto('/', { waitUntil: 'networkidle' });
  const sessionData = await (await sessionResponsePromise).json();
  await page.waitForSelector('#board .piece');
  await page.screenshot({ path: 'e2e-screenshots/01-initial-iphone.png', fullPage: true });
  await page.locator('#zen-toggle').click();
  await expect(page.locator('body')).toHaveClass(/zen-mode/);
  await expect(page.locator('#zen-exit')).toBeVisible();
  await page.screenshot({ path: 'e2e-screenshots/01b-zen-mode.png', fullPage: true });
  await page.locator('#zen-exit').click();
  await expect(page.locator('body')).not.toHaveClass(/zen-mode/);

  const firstMove = sessionData.moves[sessionData.ply];
  const firstReply = sessionData.moves[sessionData.ply + 1];
  const [firstFrom, firstTo] = moveParts(firstMove.uci);
  const [firstReplyFrom] = moveParts(firstReply.uci);
  await dragMove(page, firstFrom, firstTo);
  await page.waitForTimeout(120);
  expect(await pieceAt(page, firstReplyFrom)).not.toBeNull();
  await page.waitForFunction((replySan) => (
    (document.querySelector('#move-list')?.textContent || '').includes(replySan)
  ), firstReply.san);
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
  await squareClick(page, altFrom);
  await page.waitForTimeout(150);
  await squareClick(page, altTo);
  await page.waitForTimeout(120);
  expect(await pieceAt(page, secondFrom)).not.toBeNull();
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

  const haptics = await page.evaluate(() => window.__haptics || []);
  if (haptics.length < 8) {
    throw new Error(`Expected haptics for select/move/success/error, got ${haptics.length}`);
  }
  const metricText = await page.locator('#avg-accuracy').textContent();
  const feedbackText = await page.locator('#move-feedback').textContent();
  const historyText = await page.locator('#move-list').textContent();
  if (!metricText?.includes('pp') || !feedbackText?.includes('%')) {
    throw new Error(`Expected accuracy metrics, got ${metricText} / ${feedbackText}`);
  }
  if (feedbackText.includes('100.0')) {
    throw new Error(`Expected legal wrong move accuracy below 100%, got ${feedbackText}`);
  }
  console.log(JSON.stringify({
    screenshots: 5,
    haptics: haptics.length,
    metricText,
    feedbackText,
    historyText,
    firstMove: firstMove.uci,
    firstReply: firstReply.uci,
    alternateMove: alternate.uci,
    secondMove: secondMove.uci,
    secondReply: secondReply.uci,
  }));
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
    expect(sessionNewCalls).toBe(1);

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
    await requireMoveHighlight(page, 'user', fixture.moves[fixture.ply]);
    await page.screenshot({ path: 'e2e-screenshots/10-checkmate-auto-play.png', fullPage: true });
    await page.waitForTimeout(3200);
    expect(sessionNewCalls).toBe(1);
    expect(completeCalls).toBe(0);
    expect(await pieceAt(page, expectedFrom)).toBeNull();
    expect(await pieceAt(page, expectedTo)).toBe(expectedPieceCode);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    expect(await pieceAt(page, expectedFrom)).toBeNull();
    expect(await pieceAt(page, expectedTo)).toBe(expectedPieceCode);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    expect(await pieceAt(page, expectedFrom)).toBe(expectedPieceCode);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    expect(await pieceAt(page, expectedFrom)).toBeNull();
    expect(await pieceAt(page, expectedTo)).toBe(expectedPieceCode);

    await page.locator('#new').click();
    await expect.poll(() => completeCalls).toBe(1);
    await expect.poll(() => sessionNewCalls).toBe(2);
    expect(completePayloads[0]?.accuracy_history).toEqual([legalWrong.accuracy]);
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
