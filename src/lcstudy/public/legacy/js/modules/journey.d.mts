import type { ChartConfiguration } from 'chart.js';
export interface JourneyGame { accuracy: number | null; totalMoves: number; thinkTimeMs: number | null }
export interface JourneyPoint { x: number; y: number; game: number; startGame: number; games: number; provisional: boolean }
export interface CurrentGamePoint { x: number; y: number; moves: number; currentGame: true }
export interface AccuracyJourney { points: JourneyPoint[]; frontier: JourneyPoint[]; timedGames: number; totalGames: number; windowSize: number }
export function buildAccuracyJourney(history: JourneyGame[], windowSize?: number, limit?: number): AccuracyJourney;
export function paretoFrontier(points: JourneyPoint[]): JourneyPoint[];
export function buildCurrentGamePoint(accuracies: number[], moveTimesMs: number[]): CurrentGamePoint | null;
export function journeyColor(progress: number): string;
export function journeyArrows(points: JourneyPoint[], pixels: { x: number; y: number }[], compact?: boolean): { x: number; y: number; dx: number; dy: number; progress: number }[];
export function createJourneyChartConfig(journey: AccuracyJourney, compact?: boolean, currentGame?: CurrentGamePoint | null): ChartConfiguration<'scatter', (JourneyPoint | CurrentGamePoint)[]>;
