/**
 * Haptic feedback adapter.
 * @module haptics
 */

import { haptic } from '../../vendor/ios-haptics.js';

export function hapticSelect() {
  haptic();
}

export function hapticMove() {
  haptic();
}

export function hapticSuccess() {
  haptic.confirm();
}

export function hapticError() {
  haptic.error();
}

export function hapticInaccuracy(accuracy) {
  const miss = Math.max(0, Math.min(1, (100 - Number(accuracy || 0)) / 100));
  const force = Math.pow(miss, 1.35);
  const pulses = Math.max(1, Math.min(5, Math.round(1 + force * 4)));
  const gap = Math.max(45, 105 - force * 45);

  for (let idx = 0; idx < pulses; idx++) {
    setTimeout(() => {
      if (force > 0.72 && idx === 0) {
        haptic.error();
      } else if (force > 0.38 && idx === 0) {
        haptic.confirm();
      } else {
        haptic();
      }
    }, idx * gap);
  }
}
