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
  const [firstFrom, firstTo] = moveParts(firstMove.uci);
  await squareClick(page, firstFrom);
  await page.waitForTimeout(150);
  await squareClick(page, firstTo);
  await page.waitForFunction(() => document.querySelector('#avg-accuracy')?.textContent?.includes('100'));
  await page.screenshot({ path: 'e2e-screenshots/02-after-best-move.png', fullPage: true });

  const secondMove = sessionData.moves[sessionData.ply + 2];
  if (!secondMove?.analysis?.length) throw new Error('No second analyzed prompt');
  const alternate = [...secondMove.analysis].reverse().find((move) => (
    move.uci !== secondMove.uci && move.uci.slice(0, 2) !== secondMove.uci.slice(0, 2)
  )) || [...secondMove.analysis].reverse().find((move) => move.uci !== secondMove.uci);
  if (!alternate) throw new Error('No alternate legal move');

  const [altFrom, altTo] = moveParts(alternate.uci);
  await squareClick(page, altFrom);
  await page.waitForTimeout(150);
  await squareClick(page, altTo);
  await page.waitForFunction(() => (document.querySelector('#move-feedback')?.textContent || '').includes('%'));
  await page.screenshot({ path: 'e2e-screenshots/03-after-low-accuracy-move.png', fullPage: true });

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e-screenshots/04-review-back.png', fullPage: true });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e-screenshots/05-review-forward.png', fullPage: true });

  const haptics = await page.evaluate(() => window.__haptics || []);
  if (haptics.length < 8) {
    throw new Error(`Expected haptics for select/move/success/error, got ${haptics.length}`);
  }
  console.log(JSON.stringify({
    screenshots: 5,
    haptics: haptics.length,
    metricText: await page.locator('#avg-accuracy').textContent(),
    feedbackText: await page.locator('#move-feedback').textContent(),
    firstMove: firstMove.uci,
    alternateMove: alternate.uci,
  }));
});
