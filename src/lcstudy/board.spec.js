const fs = require('node:fs/promises');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { Chess } = require('chess.js');

const harness = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles/variables.css">
<link rel="stylesheet" href="/styles/board.css">
<style>
  * { box-sizing: border-box; }
  body { margin: 16px; }
  #board { width: min(100%, 560px); aspect-ratio: 1; }
</style>
<div id="board"></div>
<script type="module">
  import * as board from '/legacy/js/modules/board.js';
  import * as state from '/legacy/js/modules/state.js';
  const submissions = [];
  board.initBoard();
  board.setBoardInputEnabled(true);
  board.setMoveSubmitCallback(move => submissions.push(move));
  window.boardTest = { board, state, submissions };
</script>`;

async function openBoard(page, flip = false, fen = new Chess().fen()) {
  // Serve the real board modules and styles without a server, database, or network.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://lcstudy.test') return route.abort();
    if (url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: harness });
    }
    const root = url.pathname.startsWith('/legacy/') ? 'public' : 'app';
    const file = path.join(__dirname, root, url.pathname);
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    await route.fulfill({
      contentType: types[path.extname(file)],
      body: await fs.readFile(file),
    });
  });
  await page.goto('http://lcstudy.test');
  await page.waitForFunction(() => window.boardTest);
  await page.evaluate(({ flip, fen }) => {
    const { board, state } = window.boardTest;
    state.setCurrentFen(fen);
    board.setFlip(flip);
    board.updateBoardFromFen(fen);
  }, { flip, fen });
}

const square = (page, name) => page.locator(`[data-square="${name}"]`);

async function pressSquare(page, name, touch) {
  if (touch) await square(page, name).tap();
  else await square(page, name).click();
}

test.describe('Board', () => {
  for (const flip of [false, true]) {
    const side = flip ? 'black' : 'white';

    test(`${side}: correct orientation, square colors, and piece images`, async ({ page }, testInfo) => {
      await openBoard(page, flip);
      const orientations = await page.locator('#board .piece').evaluateAll(pieces => {
        const boardRotation = new DOMMatrix(getComputedStyle(document.getElementById('board')).transform);
        return pieces.map(piece => {
          const style = getComputedStyle(piece);
          const matrix = boardRotation.multiply(new DOMMatrix(style.transform))
            .rotate(style.rotate === 'none' ? 0 : parseFloat(style.rotate));
          return [matrix.a, matrix.b, matrix.c, matrix.d];
        });
      });
      for (const matrix of orientations) {
        [1, 0, 0, 1].forEach((value, index) => expect(matrix[index]).toBeCloseTo(value, 5));
      }
      const corners = await page.locator('#board').evaluate(board => {
        const { left, right, top, bottom } = board.getBoundingClientRect();
        return [[left + 8, top + 8], [right - 8, top + 8], [left + 8, bottom - 8], [right - 8, bottom - 8]]
          .map(([x, y]) => {
            const el = document.elementFromPoint(x, y).closest('.square');
            return { square: el.dataset.square, light: el.classList.contains('light') };
          });
      });
      expect(corners).toEqual((flip ? ['h1', 'a1', 'h8', 'a8'] : ['a8', 'h8', 'a1', 'h1'])
        .map((name, index) => ({ square: name, light: index === 0 || index === 3 })));
      await expect(square(page, 'd1')).toHaveClass(/light/);
      await expect(square(page, 'd8')).toHaveClass(/dark/);
      await expect(square(page, 'd1').locator('.piece')).toHaveAttribute('data-piece', 'wQ');
      await expect(square(page, 'e1').locator('.piece')).toHaveAttribute('data-piece', 'wK');
      await expect(square(page, 'd8').locator('.piece')).toHaveAttribute('data-piece', 'bQ');
      await expect(square(page, 'e8').locator('.piece')).toHaveAttribute('data-piece', 'bK');
      const imagesLoaded = await page.locator('.piece').evaluateAll(pieces => Promise.all(
        pieces.map(async piece => {
          const image = new Image();
          image.src = piece.style.backgroundImage.slice(5, -2);
          await image.decode();
          return image.naturalWidth > 0;
        })
      ));
      expect(imagesLoaded).toEqual(Array(32).fill(true));
      await page.screenshot({ path: testInfo.outputPath(`${side}.png`) });
    });

    test(`${side}: switch selected pieces without submitting a move`, async ({ page, isMobile }) => {
      await openBoard(page, flip);
      const rank = flip ? '8' : '1';
      await pressSquare(page, `g${rank}`, isMobile);
      await expect(square(page, `g${rank}`)).toHaveClass(/selected/);
      await pressSquare(page, `b${rank}`, isMobile);
      await expect(square(page, `b${rank}`)).toHaveClass(/selected/);
      await expect(square(page, `g${rank}`)).not.toHaveClass(/selected/);
      expect(await page.evaluate(() => window.boardTest.submissions)).toEqual([]);
      await pressSquare(page, flip ? 'c6' : 'c3', isMobile);
      expect(await page.evaluate(() => window.boardTest.submissions)).toEqual([flip ? 'b8c6' : 'b1c3']);
    });

    test(`${side}: drag uses board coordinates and clears its preview`, async ({ page }) => {
      await openBoard(page, flip);
      const from = flip ? 'e7' : 'e2';
      const to = flip ? 'e5' : 'e4';
      const start = await square(page, from).boundingBox();
      const end = await square(page, to).boundingBox();
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 5 });
      await expect(page.locator('.drag-ghost')).toBeVisible();
      await page.mouse.up();
      await expect(page.locator('.drag-ghost')).toHaveCount(0);
      await expect(page.locator('.is-dragging-source')).toHaveCount(0);
      expect(await page.evaluate(() => window.boardTest.submissions)).toEqual([from + to]);
    });
  }

  test('non-primary clicks do not select or submit moves', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Secondary mouse clicks are a desktop interaction.');
    await openBoard(page);
    await square(page, 'e2').click({ button: 'right' });
    await expect(page.locator('.selected')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await square(page, 'e2').click();
    await expect(square(page, 'e2')).toHaveClass(/selected/);
    await square(page, 'e4').click({ button: 'right' });
    await expect(square(page, 'e2')).toHaveClass(/selected/);
    expect(await page.evaluate(() => window.boardTest.submissions)).toEqual([]);
  });

  test('click-only input selects, switches, deselects, and submits once', async ({ page }) => {
    await openBoard(page);
    await square(page, 'e2').dispatchEvent('click', { button: 0 });
    await square(page, 'd2').dispatchEvent('click', { button: 0 });
    await expect(square(page, 'd2')).toHaveClass(/selected/);
    await square(page, 'd2').dispatchEvent('click', { button: 0 });
    await expect(page.locator('.selected')).toHaveCount(0);
    await square(page, 'd2').dispatchEvent('click', { button: 0 });
    await square(page, 'd4').dispatchEvent('click', { button: 0 });
    expect(await page.evaluate(() => window.boardTest.submissions)).toEqual(['d2d4']);
  });

  test('loading and history review do not accept moves', async ({ page, isMobile }) => {
    await openBoard(page);
    await page.evaluate(() => window.boardTest.board.setBoardInputEnabled(false));
    await pressSquare(page, 'e2', isMobile);
    await expect(page.locator('.selected')).toHaveCount(0);
    await page.evaluate(() => {
      window.boardTest.board.setBoardInputEnabled(true);
      window.boardTest.state.setIsReviewingMoves(true);
      window.boardTest.board.setReviewingIndicator(true);
    });
    await pressSquare(page, 'e2', isMobile);
    await expect(page.locator('.selected')).toHaveCount(0);
    expect(await page.evaluate(() => window.boardTest.submissions)).toEqual([]);
  });

  test('captures, castling, en passant, and promotion match the chess engine', async ({ page }) => {
    await openBoard(page);
    for (const [fen, san] of [
      ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'O-O'],
      ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'O-O-O'],
      ['r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'O-O'],
      ['r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'O-O-O'],
      ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'exd6'],
      ['4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1', 'exd3'],
      ['4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'exd5'],
      ['4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a8=Q'],
      ['4k3/8/8/8/8/8/p7/4K3 b - - 0 1', 'a1=N'],
    ]) {
      const engine = new Chess(fen);
      const move = engine.move(san);
      await page.evaluate(({ fen, move }) => {
        const { board } = window.boardTest;
        board.setFlip(move.color === 'b');
        board.updateBoardFromFen(fen);
        board.updateBoardAfterMove({ from: move.from, to: move.to, moveResult: move });
      }, { fen, move });
      const actual = await page.locator('#board .piece').evaluateAll(pieces => Object.fromEntries(
        pieces.map(piece => [piece.parentElement.dataset.square, piece.dataset.piece])
      ));
      const expected = Object.fromEntries(engine.board().flat().filter(Boolean)
        .map(piece => [piece.square, piece.color + piece.type.toUpperCase()]));
      expect(actual, `${fen}: ${san}`).toEqual(expected);
    }
  });
});
