/** score: that game's accuracy; accuracy: the average of up to ACCURACY_WINDOW games ending there (games of them) */
export interface RollingAccuracyPoint { game: number; score: number; accuracy: number; games: number }
export const SEARCH_GRADING_STARTED_AT: string;
export const RETRIES_STARTED_AT: string;
export const ACCURACY_WINDOW: number;
export function buildCurrentScoringAccuracy(history: { accuracy: number | null; playedAt: string | Date }[], windowSize?: number): RollingAccuracyPoint[];
export function buildRollingAccuracy(accuracies: (number | null)[], windowSize?: number): RollingAccuracyPoint[];
export function recentAccuracy(history: { accuracy: number | null }[], windowSize?: number): { accuracy: number | null; games: number };
export interface NiceScale { min: number; max: number; step: number; ticks: number[] }
export function niceStep(span: number, targetTicks?: number): number;
export function niceScale(low: number, high: number, options?: { targetTicks?: number; floor?: number; ceiling?: number; minSpan?: number }): NiceScale;
