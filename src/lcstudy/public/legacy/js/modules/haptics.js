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
