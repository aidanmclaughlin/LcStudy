/**
 * Accuracy colors: one smooth scale from red through amber to green, shared by
 * the in-game chart, the accuracy burst, and the move header.
 * @module colors
 */

/** [accuracy, color] stops: red at 50% and below, amber at 77.5%, green at 100%. */
const STOPS = [[50, '#ef4444'], [77.5, '#f59e0b'], [100, '#22c55e']];

/**
 * Color for an accuracy percentage, blended in OKLCH so equal steps in
 * accuracy look like equal steps in color.
 * @param {number} accuracy - Accuracy percentage (clamped to the scale)
 * @returns {string} '#rrggbb'
 */
export function accuracyColor(accuracy) {
  const value = Number.isFinite(Number(accuracy)) ? Number(accuracy) : 0;
  if (value <= STOPS[0][0]) return STOPS[0][1];
  if (value >= STOPS.at(-1)[0]) return STOPS.at(-1)[1];

  const upper = STOPS.findIndex(([stop]) => value <= stop);
  const [fromStop, fromHex] = STOPS[upper - 1];
  const [toStop, toHex] = STOPS[upper];
  const from = toOklch(fromHex), to = toOklch(toHex);
  const t = (value - fromStop) / (toStop - fromStop);
  const hueTurn = ((to.h - from.h + 540) % 360) - 180;

  return fromOklch({
    l: from.l + (to.l - from.l) * t,
    c: from.c + (to.c - from.c) * t,
    h: from.h + hueTurn * t
  });
}

// sRGB <-> OKLCH (Björn Ottosson's OKLab, in polar form)

function toOklch(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}

function fromOklch({ l: L, c, h }) {
  const A = c * Math.cos(h * Math.PI / 180);
  const B = c * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
  return `#${rgb.map((channel) => {
    const encoded = Math.round(Math.min(1, Math.max(0, fromLinear(channel))) * 255);
    return encoded.toString(16).padStart(2, '0');
  }).join('')}`;
}

function toLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel) {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.max(0, channel) ** (1 / 2.4) - 0.055;
}
