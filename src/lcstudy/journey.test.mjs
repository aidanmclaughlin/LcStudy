import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRollingAccuracy, buildCurrentScoringAccuracy, SEARCH_GRADING_STARTED_AT, recentAccuracy, niceScale } from './public/legacy/js/modules/journey.mjs';

test('current-scoring chart never mixes grading eras or renumbers games', () => {
  const cutoff = Date.parse(SEARCH_GRADING_STARTED_AT);
  const oldGames = Array.from({ length: 104 }, () => ({ accuracy: 30, playedAt: new Date(cutoff - 1) }));
  const newGames = Array.from({ length: 100 }, () => ({ accuracy: 80, playedAt: new Date(cutoff) }));
  assert.deepEqual(buildCurrentScoringAccuracy(oldGames), []);
  const history = [...oldGames, ...newGames, { accuracy: 20, playedAt: SEARCH_GRADING_STARTED_AT }];
  const points = buildCurrentScoringAccuracy(history);
  assert.equal(points.length, 101);
  assert.deepEqual(points[0], { game: 105, score: 80, accuracy: 80, games: 1 });
  assert.deepEqual(points.at(-2), { game: 204, score: 80, accuracy: 80, games: 100 });
  assert.deepEqual(points.at(-1), { game: 205, score: 20, accuracy: 79.4, games: 100 });
  assert.equal(history.length, 205);
  assert.equal(history[0].accuracy, 30);
});

test('undated and unscored games cannot contaminate current-scoring windows', () => {
  const history = [
    { accuracy: 0, playedAt: 'invalid' },
    ...Array.from({ length: 99 }, () => ({ accuracy: 85, playedAt: SEARCH_GRADING_STARTED_AT })),
    { accuracy: null, playedAt: SEARCH_GRADING_STARTED_AT },
    { accuracy: 85, playedAt: SEARCH_GRADING_STARTED_AT }
  ];
  const points = buildCurrentScoringAccuracy(history);
  assert.deepEqual(points.map(point => point.game), [...Array.from({ length: 99 }, (_, i) => i + 2), 102]);
  assert.ok(points.every(point => point.accuracy === 85));
  assert.deepEqual(points.at(-1), { game: 102, score: 85, accuracy: 85, games: 100 });
});

test('the rolling average starts at the first game and drops the oldest past 100', () => {
  assert.deepEqual(buildRollingAccuracy([]), []);
  assert.deepEqual(buildRollingAccuracy([80, 60, 100]), [
    { game: 1, score: 80, accuracy: 80, games: 1 },
    { game: 2, score: 60, accuracy: 70, games: 2 },
    { game: 3, score: 100, accuracy: 80, games: 3 }
  ]);
  const accuracies = Array.from({ length: 101 }, (_, i) => i);
  const points = buildRollingAccuracy(accuracies);
  assert.equal(points.length, 101);
  assert.deepEqual(points.at(-2), { game: 100, score: 99, accuracy: 49.5, games: 100 });
  assert.deepEqual(points.at(-1), { game: 101, score: 100, accuracy: 50.5, games: 100 });
  assert.equal(accuracies.length, 101);
});

test('rolling accuracy skips invalid scores without losing historical game numbers', () => {
  const scores = [...Array(99).fill(80), null, NaN, Infinity, -1, 101, 100, 0];
  const points = buildRollingAccuracy(scores);
  assert.deepEqual(points.map(point => point.game), [...Array.from({ length: 99 }, (_, i) => i + 1), 105, 106]);
  assert.deepEqual(points.slice(-2), [
    { game: 105, score: 100, accuracy: 80.2, games: 100 },
    { game: 106, score: 0, accuracy: 79.4, games: 100 }
  ]);
  for (const value of [0, 80, 100]) {
    assert.deepEqual(buildRollingAccuracy(Array(100).fill(value)).at(-1), { game: 100, score: value, accuracy: value, games: 100 });
  }
  assert.throws(() => buildRollingAccuracy([80], 0), RangeError);
});

test('the headline average covers the latest games, up to 100, and matches the chart', () => {
  const history = Array.from({ length: 140 }, (_, i) => ({ accuracy: i / 2 }));
  const baseline = recentAccuracy(history);
  assert.deepEqual(baseline, { accuracy: buildRollingAccuracy(history.map(game => game.accuracy)).at(-1).accuracy, games: 100 });
  assert.deepEqual(recentAccuracy([...history, { accuracy: null }, { accuracy: 101 }]), baseline);
  // Before 100 games it averages the games there are.
  assert.deepEqual(recentAccuracy([{ accuracy: 80 }, { accuracy: null }, { accuracy: 90 }]), { accuracy: 85, games: 2 });
  assert.deepEqual(recentAccuracy([]), { accuracy: null, games: 0 });
});

test('axes end on round ticks within their bounds', () => {
  // The chart pads its range by at least 0.25 points, so constant histories still span.
  for (const [low, high] of [[83.2, 89.9], [-0.25, 0.25], [99.75, 100.25], [-5, 104]]) {
    const scale = niceScale(low, high, { targetTicks: 4, floor: 0, ceiling: 100 });
    assert.ok(scale.max > scale.min, `${low}-${high}`);
    assert.ok(scale.min >= 0 && scale.max <= 100);
    for (const value of [scale.min, scale.max]) {
      assert.ok(Math.abs(value / scale.step - Math.round(value / scale.step)) < 1e-9, `${value} / ${scale.step}`);
    }
    assert.deepEqual(scale.ticks.at(0), scale.min);
    assert.deepEqual(scale.ticks.at(-1), scale.max);
  }
});
