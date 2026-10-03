import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accuracyColor } from './public/legacy/js/modules/colors.mjs';

const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

test('the accuracy scale runs from red through amber to green', () => {
  assert.equal(accuracyColor(100), '#22c55e');
  assert.equal(accuracyColor(77.5), '#f59e0b');
  assert.equal(accuracyColor(50), '#ef4444');
  for (const value of [0, 20, -5, NaN, undefined]) assert.equal(accuracyColor(value), '#ef4444');
  assert.equal(accuracyColor(140), '#22c55e');
});

test('neighbouring accuracies get neighbouring colors, with no bands', () => {
  for (let accuracy = 0; accuracy < 100; accuracy += 0.5) {
    const color = accuracyColor(accuracy);
    assert.match(color, /^#[0-9a-f]{6}$/);
    const next = channels(accuracyColor(accuracy + 0.5));
    const step = Math.max(...channels(color).map((value, i) => Math.abs(value - next[i])));
    assert.ok(step <= 16, `${accuracy}%: ${color} jumps by ${step}`);
  }
  // Green rises steadily from the red end to the green end.
  const greens = [50, 60, 70, 80, 90, 100].map(value => channels(accuracyColor(value))[1]);
  assert.deepEqual([...greens].sort((a, b) => a - b), greens);
});
