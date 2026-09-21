import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAccuracyJourney, buildCurrentGamePoint, journeyColor, journeyArrows, paretoFrontier, createJourneyChartConfig } from './public/legacy/js/modules/journey.mjs';

const game = (accuracy = 80, seconds = 3, totalMoves = 20) => ({ accuracy, totalMoves, thinkTimeMs: seconds * totalMoves * 1000 });

test('both axes use the same 25 games with equal game weights', () => {
  const history = Array.from({ length: 25 }, (_, index) => game(60 + index, index + 1, index + 1));
  const { points } = buildAccuracyJourney(history);
  assert.equal(points.length, 1);
  assert.deepEqual(points[0], { x: 13, y: 72, game: 25, startGame: 1, games: 25, provisional: false });
});

test('rolling context is calculated before truncating to the last 100 windows', () => {
  const { points } = buildAccuracyJourney(Array.from({ length: 150 }, (_, i) => game(i / 2, 1 + i)));
  assert.equal(points.length, 100);
  assert.equal(points[0].game, 51);
  assert.equal(points[0].startGame, 27);
  assert.equal(points[0].y, 19);
  assert.equal(points.at(-1).game, 150);
});

test('missing timing breaks a window instead of treating it as fast or substituting duration', () => {
  const history = [...Array(25).fill(game()), { ...game(), thinkTimeMs: null, durationMs: 1000 }, ...Array(25).fill(game(90, 2))];
  const result = buildAccuracyJourney(history);
  assert.deepEqual(result.points.map(point => point.game), [25, 51]);
  assert.equal(result.timedGames, 50);
  assert.equal(result.points[1].startGame, 27);
});

test('warmup is provisional and cannot define the 25-game frontier', () => {
  const result = buildAccuracyJourney([game(100, 0.1)]);
  assert.equal(result.points[0].provisional, true);
  assert.deepEqual(result.frontier, []);
  assert.deepEqual(buildAccuracyJourney([]).points, []);
});

test('Pareto frontier rejects slower or less accurate points and keeps newest ties', () => {
  const input = [[1, 70], [2, 80], [3, 75], [2, 79], [4, 95], [5, 95], [2, 80]]
    .map(([x, y], index) => ({ x, y, game: index + 1 }));
  assert.deepEqual(paretoFrontier(input).map(point => point.game), [1, 7, 5]);
  assert.equal(input.length, 7);
});

test('constant and extreme accuracy values still have usable axes', () => {
  for (const accuracy of [0, 80, 100]) {
    const config = createJourneyChartConfig(buildAccuracyJourney(Array(25).fill(game(accuracy, 2))));
    assert.ok(config.options.scales.y.max > config.options.scales.y.min);
    assert.ok(config.options.scales.x.max > config.options.scales.x.min);
    assert.ok(config.options.scales.y.min >= 0);
    assert.ok(config.options.scales.y.max <= 100);
  }
});

test('current game pairs submitted accuracy with submitted thinking time', () => {
  assert.deepEqual(buildCurrentGamePoint([100, 0, 80], [1000, 2000, 6000]), {
    x: 3, y: 60, moves: 3, currentGame: true
  });
  assert.equal(buildCurrentGamePoint([], []), null);
  assert.equal(buildCurrentGamePoint([80], []), null);
  assert.equal(buildCurrentGamePoint([80], [0]), null);
  assert.equal(buildCurrentGamePoint([NaN], [1000]), null);
  assert.equal(buildCurrentGamePoint([80], [-1]), null);
  assert.equal(buildCurrentGamePoint([101], [1000]), null);
});

test('live marker expands axes without changing the recorded frontier', () => {
  const journey = buildAccuracyJourney(Array(25).fill(game(80, 3)));
  const current = buildCurrentGamePoint([100], [1000]);
  const config = createJourneyChartConfig(journey, false, current);
  assert.deepEqual(config.data.datasets.find(dataset => dataset.label === 'Current game').data, [current]);
  assert.deepEqual(config.data.datasets.find(dataset => dataset.label === 'Observed frontier').data, journey.frontier);
  assert.equal(journey.frontier[0].y, 80);
  assert.ok(config.options.scales.x.min < current.x);
  assert.equal(config.options.scales.y.max, 100);
  assert.equal(config.options.plugins.tooltip.callbacks.title([{ raw: current }]), 'Current game / 1 move');
  const emptyHistory = createJourneyChartConfig(buildAccuracyJourney([]), true, current);
  assert.equal(emptyHistory.data.datasets.find(dataset => dataset.label === 'Current game').data.length, 1);
  assert.deepEqual(emptyHistory.data.datasets.find(dataset => dataset.label === 'Observed frontier').data, []);
});

test('journey colors follow time even when accuracy and pace reverse', () => {
  assert.equal(journeyColor(-1), 'rgb(101, 127, 153)');
  assert.equal(journeyColor(2), 'rgb(244, 190, 101)');
  const points = [{ x: 1, y: 90, game: 25 }, { x: 3, y: 80, game: 26 }, { x: 2, y: 95, game: 27 }];
  const config = createJourneyChartConfig({ points, frontier: [] });
  const { borderColor } = config.data.datasets.find(dataset => dataset.label === 'Journey').segment;
  assert.equal(borderColor({ p0: { raw: points[0] }, p1: { raw: points[1] } }), journeyColor(0.25));
  assert.equal(borderColor({ p0: { raw: points[1] }, p1: { raw: points[2] } }), journeyColor(0.75));
});

test('direction arrows follow screen-space chronology and avoid gaps or overlapping cues', () => {
  const points = Array.from({ length: 10 }, (_, game) => ({ game }));
  const pixels = points.map((_, index) => ({ x: 500 - index * 40, y: 500 - index * 40 }));
  const arrows = journeyArrows(points, pixels);
  assert.equal(arrows.length, 5);
  assert.equal(journeyArrows(points, pixels, true).length, 3);
  assert.ok(arrows.every(arrow => arrow.dx < 0 && arrow.dy < 0));
  for (let i = 0; i < arrows.length; i++) {
    assert.ok(arrows.slice(i + 1).every(other => Math.hypot(arrows[i].x - other.x, arrows[i].y - other.y) >= 28));
  }
  const gapPoints = [1, 2, 5, 6].map(game => ({ game }));
  const gapPixels = [0, 40, 80, 120].map(x => ({ x, y: 0 }));
  assert.deepEqual(journeyArrows(gapPoints, gapPixels).map(arrow => arrow.x), [20, 100]);
  assert.deepEqual(journeyArrows(points, points.map(() => ({ x: 0, y: 0 }))), []);
  const smoothPoints = Array.from({ length: 100 }, (_, game) => ({ game }));
  assert.equal(journeyArrows(smoothPoints, smoothPoints.map(({ game }) => ({ x: game * 2, y: 0 }))).length, 5);
  assert.deepEqual(journeyArrows([], []), []);
});

test('direction plugin reads updated chart data instead of its initial empty history', () => {
  const plugin = createJourneyChartConfig(buildAccuracyJourney([])).plugins[0];
  const strokes = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { strokes.push(this.strokeStyle); } };
  const data = [{ game: 1 }, { game: 2 }];
  const chart = { ctx, data: { datasets: [{ label: 'Journey', data }] } };
  plugin.afterDatasetDraw(chart, { index: 0, meta: { data: [{ x: 100, y: 100 }, { x: 50, y: 50 }] } });
  assert.deepEqual(strokes, [journeyColor(0.5)]);
  chart.data.datasets[0].label = 'Current game';
  plugin.afterDatasetDraw(chart, { index: 0, meta: { data: [] } });
  assert.equal(strokes.length, 1);
});

test('Stats, hidden tabs, and review pause clocks without losing the live prompt', async () => {
  let time = 0;
  const originalPerformance = globalThis.performance;
  globalThis.performance = { now: () => time };
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible', getElementById: () => null });
  globalThis.window = new EventTarget();
  try {
    const clock = await import('./public/legacy/js/modules/timeclock.js');
    clock.startGameClock(); clock.promptBegin();
    time = 1000; clock.setClockPaused('stats', true);
    time = 2000; clock.setClockPaused('hidden', true);
    time = 3000; clock.setClockPaused('stats', false);
    time = 4000; clock.setClockPaused('hidden', false);
    time = 5000;
    assert.equal(clock.promptSubmit(), 2000);
    assert.equal(clock.getGameDurationMs(), 2000);
    clock.setClockPaused('stats', true);
    clock.promptBegin(); // Opponent playback may complete while Stats is open.
    time = 7000;
    assert.equal(clock.getLiveThinkTimeMs(), 2000);
    clock.setClockPaused('review', true); clock.setClockPaused('stats', false);
    time = 8000; clock.setClockPaused('review', false);
    time = 8500;
    assert.equal(clock.promptSubmit(), 500);
    clock.endGameClock();
    time = 20000;
    assert.equal(clock.getGameDurationMs(), 2500);
    assert.deepEqual(clock.getMoveTimesMs(), [2000, 500]);
  } finally {
    globalThis.performance = originalPerformance;
    delete globalThis.document; delete globalThis.window;
  }
});
