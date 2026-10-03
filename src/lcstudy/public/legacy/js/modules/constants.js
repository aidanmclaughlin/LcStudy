/**
 * Application constants and configuration.
 * @module constants
 */

/** Chart.js library path (vendored locally; no CDN round-trip) */
export const CHART_JS_CDN = '/legacy/vendor/chart.umd.js';

/** Local path to chess.js ESM module */
export const CHESS_JS_PATH = '/legacy/vendor/chess.esm.js';

/** Default starting FEN position */
export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** SVG piece image paths */
export const PIECE_IMAGES = {
  wK: '/legacy/img/pieces/wK.svg',
  wQ: '/legacy/img/pieces/wQ.svg',
  wR: '/legacy/img/pieces/wR.svg',
  wB: '/legacy/img/pieces/wB.svg',
  wN: '/legacy/img/pieces/wN.svg',
  wP: '/legacy/img/pieces/wP.svg',
  bK: '/legacy/img/pieces/bK.svg',
  bQ: '/legacy/img/pieces/bQ.svg',
  bR: '/legacy/img/pieces/bR.svg',
  bB: '/legacy/img/pieces/bB.svg',
  bN: '/legacy/img/pieces/bN.svg',
  bP: '/legacy/img/pieces/bP.svg'
};

/** All piece codes for iteration */
export const PIECE_CODES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];

/** Available Maia difficulty levels */
export const MAIA_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2200];

/** Confetti colors for celebration effects */
export const CONFETTI_COLORS = ['#f59e0b', '#fbbf24', '#f87171', '#34d399', '#60a5fa', '#a78bfa'];

/** Full confetti colors for game completion */
export const CELEBRATION_COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];

/** Move accuracy bands: >= 90 good, >= 65 ok, otherwise bad */
export const ACCURACY_COLORS = {
  good: '#22c55e',
  ok: '#f59e0b',
  bad: '#ef4444'
};

/** Chart.js common scale options */
export const CHART_SCALE_OPTIONS = {
  grid: {
    color: 'rgba(148, 163, 184, 0.1)',
    drawTicks: false
  },
  border: { display: false },
  ticks: {
    color: '#64748b',
    font: { size: 10, weight: '500' },
    padding: 6
  }
};

/** Chart.js tooltip styling */
export const CHART_TOOLTIP_OPTIONS = {
  backgroundColor: 'rgba(15, 23, 42, 0.96)',
  titleColor: '#f8fafc',
  bodyColor: '#cbd5e1',
  borderColor: 'rgba(148, 163, 184, 0.24)',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 8,
  caretSize: 5
};

/**
 * Get the image URL for a piece code.
 * @param {string} code - Piece code (e.g., 'wK', 'bQ')
 * @returns {string} URL to the piece SVG
 */
export function getPieceImageUrl(code) {
  return PIECE_IMAGES[code];
}
