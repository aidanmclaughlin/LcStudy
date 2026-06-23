/**
 * Haptic feedback adapter.
 * @module haptics
 */

const SWITCH_ID = 'lcstudy-haptic-switch';
const DIRECT_SWITCH_SELECTOR = 'input[switch][data-lcstudy-direct-haptic]';
let switchLabel = null;
let switchInput = null;

function isAppleTouchDevice() {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const appleMobile = /iPhone|iPad|iPod/i.test(userAgent);
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return appleMobile || touchMac;
}

export function createDirectHapticControl() {
  if (!isAppleTouchDevice() || typeof document === 'undefined') return null;

  // Safari 26.5 only emits switch haptics from direct user interaction.
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.tabIndex = -1;
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.dataset.lcstudyDirectHaptic = 'true';
  input.className = 'direct-haptic-switch';
  return input;
}

export function isDirectHapticControl(target) {
  return Boolean(target?.matches?.(DIRECT_SWITCH_SELECTOR));
}

function ensureSwitchHaptic() {
  if (switchLabel?.isConnected && switchInput?.isConnected) {
    return { label: switchLabel, input: switchInput };
  }
  if (typeof document === 'undefined' || !document.body) return null;

  const label = document.createElement('label');
  label.htmlFor = SWITCH_ID;
  label.setAttribute('aria-hidden', 'true');
  label.dataset.lcstudyHaptic = 'true';
  label.style.position = 'fixed';
  label.style.left = '0';
  label.style.top = '0';
  label.style.width = '1px';
  label.style.height = '1px';
  label.style.overflow = 'hidden';
  label.style.opacity = '0.001';
  label.style.pointerEvents = 'none';

  const input = document.createElement('input');
  input.id = SWITCH_ID;
  input.type = 'checkbox';
  input.tabIndex = -1;
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.dataset.lcstudyHapticSwitch = 'true';
  input.style.appearance = 'auto';

  label.appendChild(input);
  document.body.appendChild(label);
  switchLabel = label;
  switchInput = input;
  return { label, input };
}

function triggerSwitchHaptic() {
  const control = ensureSwitchHaptic();
  if (!control) return false;

  const previous = control.input.checked;
  control.label.click();
  return control.input.checked !== previous;
}

function triggerVibration(pattern) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }

  try {
    return navigator.vibrate(pattern) !== false;
  } catch {
    return false;
  }
}

function triggerPattern(pulses, gap) {
  const pulseCount = Math.max(1, Math.floor(pulses));
  const pause = Math.max(35, Math.floor(gap));

  if (!isAppleTouchDevice()) {
    const vibrationPattern = [];
    for (let index = 0; index < pulseCount; index++) {
      if (index > 0) vibrationPattern.push(pause);
      vibrationPattern.push(35);
    }
    if (triggerVibration(vibrationPattern)) return;
  }

  triggerSwitchHaptic();
  for (let index = 1; index < pulseCount; index++) {
    setTimeout(triggerSwitchHaptic, index * pause);
  }
}

export function initializeHaptics() {
  if (isAppleTouchDevice()) {
    ensureSwitchHaptic();
  }
}

export function hapticSelect() {
  triggerPattern(1, 55);
}

export function hapticMove() {
  triggerPattern(1, 55);
}

export function hapticSuccess() {
  triggerPattern(2, 90);
}

export function hapticError() {
  triggerPattern(3, 85);
}

export function hapticInaccuracy(accuracy) {
  const miss = Math.max(0, Math.min(1, (100 - Number(accuracy || 0)) / 100));
  const force = Math.pow(miss, 1.35);
  const pulses = Math.max(1, Math.min(5, Math.round(1 + force * 4)));
  const gap = Math.max(45, 105 - force * 45);
  triggerPattern(pulses, gap);
}
