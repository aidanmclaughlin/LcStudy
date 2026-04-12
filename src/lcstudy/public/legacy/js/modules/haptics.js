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
  const miss = Math.max(0, Math.min(100, 100 - Number(accuracy || 0)));

  if (miss < 12) {
    haptic();
  } else if (miss < 35) {
    haptic();
    setTimeout(() => haptic(), 110);
  } else if (miss < 65) {
    haptic.confirm();
  } else {
    haptic.error();
  }
}
