export interface RollingAccuracyPoint { game: number; accuracy: number }
export const SEARCH_GRADING_STARTED_AT: string;
export function buildCurrentScoringAccuracy(history: { accuracy: number | null; playedAt: string | Date }[], windowSize?: number): RollingAccuracyPoint[];
export function buildRollingAccuracy(accuracies: (number | null)[], windowSize?: number): RollingAccuracyPoint[];
export function recentAccuracy(history: { accuracy: number | null }[], windowSize?: number): number | null;
export interface NiceScale { min: number; max: number; step: number; ticks: number[] }
export function niceStep(span: number, targetTicks?: number): number;
export function niceScale(low: number, high: number, options?: { targetTicks?: number; floor?: number; ceiling?: number; minSpan?: number }): NiceScale;
