/** Maia-2 rapid equivalent rating derived from LCStudy move accuracy. */

import calibrationData from "@/data/maia-elo-calibration.json";
import type { UserGameStatsRow } from "@/lib/db";

const INTERVAL_Z_80 = 1.2815515655446004;
const DEFAULT_GAME_DEVIATION = 12;
export const MAIA_ELO_WINDOW = 25;

type RatingBound = "low" | "high" | null;

interface CalibrationPoint {
  elo: number;
  bucket: string;
  accuracy: number;
  low80: number;
  high80: number;
}

export interface MaiaEloSeriesPoint {
  game: number;
  elo: number;
  low80: number;
  high80: number;
  accuracy: number;
  games: number;
  moves: number;
  bound: RatingBound;
}

export interface MaiaEloStats {
  current: MaiaEloSeriesPoint | null;
  series: MaiaEloSeriesPoint[];
  calibration: {
    model: string;
    sampledGames: number;
    sampledPositions: number;
    firstIncludedPrompt: number;
    minimumElo: number;
    maximumElo: number;
    points: Array<{ elo: number; bucket: string; accuracy: number }>;
  };
}

interface EligibleGame {
  game: number;
  accuracy: number;
  moves: number;
}

const CALIBRATION_POINTS = [...calibrationData.points]
  .map((point) => ({
    elo: Number(point.elo),
    bucket: point.bucket,
    accuracy: Number(point.accuracy),
    low80: Number(point.low80),
    high80: Number(point.high80)
  }))
  .sort((left, right) => left.elo - right.elo) satisfies CalibrationPoint[];

const MINIMUM_ELO = CALIBRATION_POINTS[0].elo;
const MAXIMUM_ELO = CALIBRATION_POINTS[CALIBRATION_POINTS.length - 1].elo;
const FIRST_INCLUDED_PROMPT = Number(calibrationData.scope.firstIncludedPrompt);

export function computeMaiaElo(history: UserGameStatsRow[]): MaiaEloStats {
  const eligible = history.flatMap((game, historyIndex): EligibleGame[] => {
    const scores = game.accuracyHistory
      .slice(FIRST_INCLUDED_PROMPT - 1)
      .map(finiteNumber)
      .filter((value): value is number => value !== null && value >= 0 && value <= 100);
    if (scores.length === 0) return [];
    return [{
      game: historyIndex + 1,
      accuracy: mean(scores),
      moves: scores.length
    }];
  });
  const historyDeviation = eligible.length > 1
    ? standardDeviation(eligible.map((game) => game.accuracy))
    : DEFAULT_GAME_DEVIATION;

  const series = eligible.map((game, index) => {
    const window = eligible.slice(Math.max(0, index - MAIA_ELO_WINDOW + 1), index + 1);
    const accuracy = mean(window.map((entry) => entry.accuracy));
    const observedDeviation = window.length > 1
      ? standardDeviation(window.map((entry) => entry.accuracy))
      : historyDeviation;
    const observationSe = observedDeviation / Math.sqrt(window.length);
    const calibrationSe = calibrationStandardError(accuracy);
    const interval = INTERVAL_Z_80 * Math.sqrt(
      observationSe ** 2 + calibrationSe ** 2
    );
    const estimate = accuracyToElo(accuracy);

    return {
      game: game.game,
      elo: estimate.elo,
      low80: accuracyToElo(accuracy - interval).elo,
      high80: accuracyToElo(accuracy + interval).elo,
      accuracy,
      games: window.length,
      moves: sum(window.map((entry) => entry.moves)),
      bound: estimate.bound
    };
  });

  return {
    current: series.length > 0 ? series[series.length - 1] : null,
    series,
    calibration: {
      model: calibrationData.model,
      sampledGames: Number(calibrationData.scope.sampledGames),
      sampledPositions: Number(calibrationData.scope.sampledPositions),
      firstIncludedPrompt: FIRST_INCLUDED_PROMPT,
      minimumElo: MINIMUM_ELO,
      maximumElo: MAXIMUM_ELO,
      points: CALIBRATION_POINTS.map(({ elo, bucket, accuracy }) => ({
        elo,
        bucket,
        accuracy
      }))
    }
  };
}

function accuracyToElo(accuracy: number): { elo: number; bound: RatingBound } {
  const first = CALIBRATION_POINTS[0];
  const last = CALIBRATION_POINTS[CALIBRATION_POINTS.length - 1];
  if (accuracy <= first.accuracy) return { elo: first.elo, bound: "low" };
  if (accuracy >= last.accuracy) return { elo: last.elo, bound: "high" };

  for (let index = 1; index < CALIBRATION_POINTS.length; index++) {
    const upper = CALIBRATION_POINTS[index];
    if (accuracy > upper.accuracy) continue;
    const lower = CALIBRATION_POINTS[index - 1];
    const span = upper.accuracy - lower.accuracy;
    const fraction = span > 0 ? (accuracy - lower.accuracy) / span : 0.5;
    const elo = lower.elo + fraction * (upper.elo - lower.elo);
    return { elo: roundToTen(elo), bound: null };
  }

  return { elo: last.elo, bound: "high" };
}

function calibrationStandardError(accuracy: number): number {
  const standardErrors = CALIBRATION_POINTS.map((point) => (
    (point.high80 - point.low80) / (2 * INTERVAL_Z_80)
  ));
  if (accuracy <= CALIBRATION_POINTS[0].accuracy) return standardErrors[0];

  for (let index = 1; index < CALIBRATION_POINTS.length; index++) {
    const upper = CALIBRATION_POINTS[index];
    if (accuracy > upper.accuracy) continue;
    const lower = CALIBRATION_POINTS[index - 1];
    const span = upper.accuracy - lower.accuracy;
    const fraction = span > 0 ? (accuracy - lower.accuracy) / span : 0.5;
    return standardErrors[index - 1]
      + fraction * (standardErrors[index] - standardErrors[index - 1]);
  }

  return standardErrors[standardErrors.length - 1];
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(
    values.reduce((total, value) => total + (value - center) ** 2, 0)
      / (values.length - 1)
  );
}

function roundToTen(value: number): number {
  return Math.round(value / 10) * 10;
}
