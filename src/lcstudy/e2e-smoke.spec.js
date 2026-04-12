const fs = require('fs');
const path = require('path');
const { test, devices } = require('@playwright/test');
const { encode } = require('next-auth/jwt');

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

test.use({
  ...devices['iPhone 14'],
  baseURL: 'http://localhost:3000',
});

test('accuracy gameplay, haptics, and move review', async ({ page, context }) => {
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

  const firstMove = sessionData.moves[sessionData.ply];
  const firstReply = sessionData.moves[sessionData.ply + 1];
  const [firstFrom, firstTo] = moveParts(firstMove.uci);
  await dragMove(page, firstFrom, firstTo);
  await page.waitForFunction(() => document.querySelector('#avg-accuracy')?.textContent?.includes('100'));
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
  await squareClick(page, altFrom);
  await page.waitForTimeout(150);
  await squareClick(page, altTo);
  await page.waitForFunction(() => (document.querySelector('#move-list')?.textContent || '').includes('2.'));
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
  if (!metricText?.includes('%') || !feedbackText?.includes('%')) {
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
