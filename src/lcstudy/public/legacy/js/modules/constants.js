/**
 * Application constants and configuration.
 * @module constants
 */

/** Maximum attempts allowed per move before auto-play */
export const ATTEMPT_LIMIT = 10;

/** CDN URL for Chart.js library */
export const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js';

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
export const MAIA_LEVELS = [1100, 1300, 1500, 1700, 1900];

/** Confetti colors for celebration effects */
export const CONFETTI_COLORS = ['#f59e0b', '#fbbf24', '#f87171', '#34d399', '#60a5fa', '#a78bfa'];

/** Full confetti colors for game completion */
export const CELEBRATION_COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];

/** Chart.js common scale options */
export const CHART_SCALE_OPTIONS = {
  grid: {
    color: 'rgba(148, 163, 184, 0.12)',
    drawBorder: false
  },
  border: { display: false },
  ticks: {
    color: '#94a3b8',
    font: { size: 10, weight: '500' },
    padding: 6
  }
};

/** Chart.js tooltip styling */
export const CHART_TOOLTIP_OPTIONS = {
  backgroundColor: 'rgba(15, 23, 42, 0.9)',
  titleColor: '#f1f5f9',
  bodyColor: '#cbd5e1',
  borderColor: 'rgba(148, 163, 184, 0.2)',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 10
};

/**
 * Get the image URL for a piece code.
 * @param {string} code - Piece code (e.g., 'wK', 'bQ')
 * @returns {string} URL to the piece SVG
 */
export function getPieceImageUrl(code) {
  return PIECE_IMAGES[code];
}
