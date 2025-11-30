/**
 * Dynamic script loaders for Chart.js and chess.js.
 * @module loaders
 */

import { CHART_JS_CDN, CHESS_JS_PATH } from './constants.js';
import {
  getChartLoaderPromise,
  setChartLoaderPromise,
  getChessLoaderPromise,
  setChessLoaderPromise
} from './state.js';

/**
 * Ensure Chart.js is loaded.
 * @returns {Promise<void>}
 */
export function ensureChartJs() {
  // Already loaded
  if (typeof window !== 'undefined' && typeof window.Chart !== 'undefined') {
    return Promise.resolve();
  }

  // Already loading
  const existingPromise = getChartLoaderPromise();
  if (existingPromise) {
    return existingPromise;
  }

  // Start loading
  const promise = new Promise((resolve, reject) => {
    try {
      if (typeof window === 'undefined') {
        resolve();
        return;
      }

      if (typeof window.Chart !== 'undefined') {
        resolve();
        return;
      }

      // Check for existing script tag
      const existing = document.querySelector('script[data-chartjs]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Chart.js')), { once: true });
        return;
      }

      // Create and load script
      const script = document.createElement('script');
      script.src = CHART_JS_CDN;
      script.async = true;
      script.dataset.chartjs = 'true';
      script.addEventListener('load', () => resolve());
      script.addEventListener('error', () => reject(new Error('Failed to load Chart.js')));
      document.head.appendChild(script);
    } catch (err) {
      reject(err);
    }
  });

  setChartLoaderPromise(promise);
  return promise;
}

/**
 * Ensure chess.js is loaded.
 * @returns {Promise<void>}
 */
export function ensureChessJs() {
  // Already loaded
  if (typeof window !== 'undefined' && typeof window.Chess !== 'undefined') {
    return Promise.resolve();
  }

  // Already loading
  const existingPromise = getChessLoaderPromise();
  if (existingPromise) {
    return existingPromise;
  }

  // Start loading
  const promise = (async () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (typeof window.Chess !== 'undefined') {
      return;
    }

    try {
      const mod = await import(/* webpackIgnore: true */ CHESS_JS_PATH);
      const ChessCtor = mod?.Chess || mod?.default || mod;

      if (typeof ChessCtor !== 'function') {
        throw new Error('Invalid chess.js module');
      }

      window.Chess = ChessCtor;
    } catch (err) {
      console.error('Failed to load chess.js', err);
      throw err;
    }
  })();

  setChessLoaderPromise(promise);
  return promise;
}

/**
 * Load all required dependencies.
 * @returns {Promise<void>}
 */
export async function loadDependencies() {
  await Promise.all([ensureChartJs(), ensureChessJs()]);
}
