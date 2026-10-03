import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRollingAccuracy, buildCurrentScoringAccuracy, SEARCH_GRADING_STARTED_AT, recentAccuracy, niceScale } from './public/legacy/js/modules/journey.mjs';

test('current-scoring chart never mixes grading eras or renumbers games', () => {
  const cutoff = Date.parse(SEARCH_GRADING_STARTED_AT);
  const oldGames = Array.from({ length: 104 }, () => ({ accuracy: 30, playedAt: new Date(cutoff - 1) }));
  const newGames = Array.from({ length: 100 }, () => ({ accuracy: 80, playedAt: new Date(cutoff) }));
  assert.deepEqual(buildCurrentScoringAccuracy(oldGames), []);
  assert.deepEqual(buildCurrentScoringAccuracy([...oldGames, ...newGames.slice(0, 99)]), []);
  const history = [...oldGames, ...newGames, { accuracy: 20, playedAt: SEARCH_GRADING_STARTED_AT }];
  assert.deepEqual(buildCurrentScoringAccuracy(history), [
    { game: 204, accuracy: 80 }, { game: 205, accuracy: 79.4 }
  ]);
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
  assert.deepEqual(buildCurrentScoringAccuracy(history), [{ game: 102, accuracy: 85 }]);
});

test('100-game accuracy waits for full windows and drops the oldest game', () => {
  assert.deepEqual(buildRollingAccuracy([]), []);
  assert.deepEqual(buildRollingAccuracy(Array(99).fill(80)), []);
  const accuracies = Array.from({ length: 101 }, (_, i) => i);
  assert.deepEqual(buildRollingAccuracy(accuracies), [
    { game: 100, accuracy: 49.5 }, { game: 101, accuracy: 50.5 }
  ]);
  assert.equal(accuracies.length, 101);
});

test('rolling accuracy skips invalid scores without losing historical game numbers', () => {
  const scores = [...Array(99).fill(80), null, NaN, Infinity, -1, 101, 100, 0];
  assert.deepEqual(buildRollingAccuracy(scores), [
    { game: 105, accuracy: 80.2 }, { game: 106, accuracy: 79.4 }
  ]);
  for (const value of [0, 80, 100]) {
    assert.deepEqual(buildRollingAccuracy(Array(100).fill(value)), [{ game: 100, accuracy: value }]);
  }
  assert.throws(() => buildRollingAccuracy([80], 0), RangeError);
});

test('the home 100-game accuracy matches the chart and skips unscored games', () => {
  const history = Array.from({ length: 140 }, (_, i) => ({ accuracy: i / 2 }));
  const baseline = recentAccuracy(history);
  assert.equal(baseline, buildRollingAccuracy(history.map(game => game.accuracy)).at(-1).accuracy);
  assert.equal(recentAccuracy([...history, { accuracy: null }, { accuracy: 101 }]), baseline);
  assert.equal(recentAccuracy(history.slice(0, 99)), null);
  assert.equal(recentAccuracy([]), null);
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
