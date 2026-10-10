/**
 * Statistical model for the progress dashboard.
 *
 * A game's accuracy (averageAccuracy) is the mean of the first try at each
 * move (accuracyHistory); retries are not scored.
 */

import type { UserGameStatsRow } from "@/lib/db";
import { computeMaiaElo, type MaiaEloStats } from "@/lib/maia-elo";
import { RETRIES_STARTED_AT, buildCurrentScoringAccuracy, recentAccuracy, type RollingAccuracyPoint } from "../public/legacy/js/modules/journey.mjs";

const RECENT_WINDOW = 100;
const TARGET_WINDOW = 10;
export const TARGET_ACCURACY = 97;
const FORECAST_CEILING = 100;
const FORECAST_EXPONENT = 0.5;
const FORECAST_PRIOR_FLOOR = 65;
const FORECAST_PRIOR_OFFSET = 750;
const FORECAST_FLOOR_SIGMA = 8;
const FORECAST_LOG_OFFSET_SIGMA = 1.25;
const FORECAST_OBSERVATION_SIGMA = 10;
const INTERVAL_Z_80 = 1.282;

export interface ProgressSeriesPoint {
  game: number;
  rolling10: number;
  rolling100: number;
  adjusted100: number;
  low80: number;
  high80: number;
}

export interface GroupStat {
  label: string;
  accuracy: number;
  exactRate: number;
  moves: number;
  games: number;
}

export interface AccuracyForecast {
  targetGame: number;
  targetGameLow: number;
  targetGameHigh: number;
  remainingGames: number;
  remainingGamesLow: number;
  remainingGamesHigh: number;
}

export interface ProgressDashboardStats {
  elo: MaiaEloStats;
  overview: {
    totalGames: number;
    totalMoves: number;
    allTimeAccuracy: number;
    recentGames: number;
    recent100: number | null;
    /** Attempts per move, retries included, over those of the same games played with retries; 1 = every move found first try */
    recentAttemptsPerMove: number | null;
    /** How many games recentAttemptsPerMove covers */
    recentAttemptsGames: number;
    recent100Low: number;
    recent100High: number;
    best100: number | null;
    exactRate: number;
  };
  progress: {
    series: ProgressSeriesPoint[];
    accuracy100: RollingAccuracyPoint[];
    adjustedRecent100: number;
    trendPer100: number;
    trendLow: number;
    trendHigh: number;
    difficultyCoverage: number;
    forecast: AccuracyForecast | null;
  };
  consistency: {
    recentFloor: number;
    recentDeviation: number;
    recoveryRate: number;
    recoverySamples: number;
  };
  skill: {
    phases: GroupStat[];
    colors: GroupStat[];
    opponents: GroupStat[];
    difficulties: GroupStat[];
    openings: GroupStat[];
  };
  coverage: {
    lichessGames: number;
    lichessShare: number;
    whiteGames: number;
    blackGames: number;
    colorCoverage: number;
    difficultyGames: number;
    openingLines: number;
    openingCoverage: number;
  };
}

interface ValidGame {
  row: UserGameStatsRow;
  historyIndex: number;
  accuracy: number;
  adjustedAccuracy: number;
}

interface MoveObservation {
  accuracy: number;
  gameIndex: number;
  phase: string;
  color: string | null;
  opponent: string | null;
  difficulty: string | null;
  opening: string | null;
}

interface ForecastCandidate {
  error: number;
  targetGame: number;
}

export function computeProgressDashboard(
  history: UserGameStatsRow[]
): ProgressDashboardStats {
  const elo = computeMaiaElo(history);
  const validRows = history
    .map((row, historyIndex) => ({
      row,
      historyIndex,
      accuracy: finiteNumber(row.averageAccuracy)
    }))
    .filter((entry): entry is Omit<ValidGame, "adjustedAccuracy"> =>
      entry.accuracy !== null && entry.accuracy >= 0 && entry.accuracy <= 100);

  const knownDifficulties = validRows
    .map((entry) => finiteNumber(entry.row.difficulty))
    .filter((value): value is number => value !== null);
  const difficultyCenter = mean(knownDifficulties);
  const difficultyEffect = estimateDifficultyEffect(validRows);
  const validGames: ValidGame[] = validRows.map((entry) => {
    const difficulty = finiteNumber(entry.row.difficulty);
    return {
      ...entry,
      adjustedAccuracy: difficulty === null
        ? entry.accuracy
        : entry.accuracy - difficultyEffect * (difficulty - difficultyCenter)
    };
  });

  const accuracies = validGames.map((game) => game.accuracy);
  const adjusted = validGames.map((game) => game.adjustedAccuracy);
  const series = buildProgressSeries(accuracies, adjusted);
  const recentGames = validGames.slice(-RECENT_WINDOW);
  const recentHistory = recentGames.map(game => game.row);
  const recent = accuracies.slice(-RECENT_WINDOW);
  const recentInterval = meanInterval(recent);
  // The headline average covers the latest games, up to 100, so it starts with the first game.
  const recent100 = recentAccuracy(validGames.map((game) => ({ accuracy: game.accuracy })), RECENT_WINDOW).accuracy;
  const recentAttempts = attemptsPerMove(recentHistory);
  const moveScores = history.flatMap((game) => validMoveScores(game.accuracyHistory));
  const totalMoves = history.reduce((sum, game) => sum + Math.max(0, game.totalMoves), 0);
  const trend = linearTrend(adjusted.slice(-RECENT_WINDOW));
  const observations = buildMoveObservations(recentGames);
  const globalMoveMean = mean(observations.map((move) => move.accuracy));
  const globalExactRate = rate(observations.map((move) => isExact(move.accuracy)));
  const groupPriorMoves = 24;
  const phases = summarizeGroups(
    observations,
    (move) => move.phase,
    ["Opening", "Middlegame", "Endgame"],
    globalMoveMean,
    globalExactRate,
    groupPriorMoves
  );
  const colors = summarizeGroups(
    observations.filter((move) => move.color !== null),
    (move) => move.color ?? "",
    ["White", "Black"],
    globalMoveMean,
    globalExactRate,
    groupPriorMoves
  );
  const opponents = summarizeGroups(
    observations.filter((move) => move.opponent !== null),
    (move) => move.opponent ?? "",
    opponentOrder(observations),
    globalMoveMean,
    globalExactRate,
    groupPriorMoves
  );
  const difficulties = summarizeGroups(
    observations.filter((move) => move.difficulty !== null),
    (move) => move.difficulty ?? "",
    ["Harder", "Typical", "Easier"],
    globalMoveMean,
    globalExactRate,
    groupPriorMoves
  );
  const openingOrder = mostCommonOpenings(recentGames, 7);
  const openingSet = new Set(openingOrder);
  const openingObservations = observations
    .filter((move) => move.opening !== null)
    .map((move) => ({
      ...move,
      opening: openingSet.has(move.opening ?? "") ? move.opening : "Other lines"
    }));
  const openings = summarizeGroups(
    openingObservations,
    (move) => move.opening ?? "",
    [...openingOrder, ...(openingObservations.some((move) => move.opening === "Other lines") ? ["Other lines"] : [])],
    globalMoveMean,
    globalExactRate,
    groupPriorMoves
  );
  const recovery = recoverySummary(recentHistory);
  const colorGames = validGames.filter((game) => game.row.leelaColor !== null);
  const openingGames = validGames.filter((game) => game.row.openingLine.length > 0);
  const lichessGames = validGames.filter((game) => isLichessGame(game.row)).length;

  return {
    elo,
    overview: {
      totalGames: history.length,
      totalMoves,
      allTimeAccuracy: weightedGameAccuracy(history),
      recentGames: recentGames.length,
      recent100,
      recentAttemptsPerMove: recentAttempts.value,
      recentAttemptsGames: recentAttempts.games,
      recent100Low: recentInterval.low,
      recent100High: recentInterval.high,
      best100: bestRollingAverage(accuracies, RECENT_WINDOW),
      exactRate: rate(moveScores.map(isExact)) * 100
    },
    progress: {
      series,
      accuracy100: buildCurrentScoringAccuracy(history.map(game => ({
        accuracy: finiteNumber(game.averageAccuracy), playedAt: game.playedAt
      }))),
      adjustedRecent100: mean(adjusted.slice(-RECENT_WINDOW)),
      trendPer100: trend.slope * 100,
      trendLow: trend.low * 100,
      trendHigh: trend.high * 100,
      difficultyCoverage: history.length > 0 ? knownDifficulties.length / history.length : 0,
      forecast: buildForecast(accuracies)
    },
    consistency: {
      recentFloor: quantile(recent, 0.1),
      recentDeviation: standardDeviation(recent),
      recoveryRate: recovery.rate,
      recoverySamples: recovery.samples
    },
    skill: {
      phases,
      colors,
      opponents,
      difficulties,
      openings
    },
    coverage: {
      lichessGames,
      lichessShare: validGames.length > 0 ? lichessGames / validGames.length : 0,
      whiteGames: colorGames.filter((game) => game.row.leelaColor === "w").length,
      blackGames: colorGames.filter((game) => game.row.leelaColor === "b").length,
      colorCoverage: validGames.length > 0 ? colorGames.length / validGames.length : 0,
      difficultyGames: knownDifficulties.length,
      openingLines: new Set(openingGames.map((game) => openingKey(game.row))).size,
      openingCoverage: validGames.length > 0 ? openingGames.length / validGames.length : 0
    }
  };
}

function buildProgressSeries(
  accuracies: number[],
  adjusted: number[]
): ProgressSeriesPoint[] {
  return accuracies.map((_, index) => {
    const recent10 = accuracies.slice(Math.max(0, index - TARGET_WINDOW + 1), index + 1);
    const recent100 = accuracies.slice(Math.max(0, index - RECENT_WINDOW + 1), index + 1);
    const adjusted100 = adjusted.slice(Math.max(0, index - RECENT_WINDOW + 1), index + 1);
    const interval = meanInterval(recent100);

    return {
      game: index + 1,
      rolling10: mean(recent10),
      rolling100: mean(recent100),
      adjusted100: mean(adjusted100),
      low80: interval.low,
      high80: interval.high
    };
  });
}

function buildMoveObservations(validGames: ValidGame[]): MoveObservation[] {
  const difficultyValues = validGames
    .map((game) => finiteNumber(game.row.difficulty))
    .filter((value): value is number => value !== null);
  const hardBoundary = quantile(difficultyValues, 1 / 3);
  const easyBoundary = quantile(difficultyValues, 2 / 3);

  return validGames.flatMap((game) => {
    const difficultyValue = finiteNumber(game.row.difficulty);
    const difficulty = difficultyValue === null
      ? null
      : difficultyValue <= hardBoundary
        ? "Harder"
        : difficultyValue >= easyBoundary
          ? "Easier"
          : "Typical";
    const color = game.row.leelaColor === "w"
      ? "White"
      : game.row.leelaColor === "b"
        ? "Black"
        : null;
    const opponentValue = finiteNumber(game.row.maiaLevel);
    const opponent = opponentValue === null ? null : opponentBand(opponentValue);
    const opening = game.row.openingLine.length > 0 ? openingKey(game.row) : null;

    return validMoveScores(game.row.accuracyHistory).map((accuracy, moveIndex) => ({
      accuracy,
      gameIndex: game.historyIndex,
      phase: moveIndex < 8 ? "Opening" : moveIndex < 20 ? "Middlegame" : "Endgame",
      color,
      opponent,
      difficulty,
      opening
    }));
  });
}

function summarizeGroups(
  observations: MoveObservation[],
  labelFor: (observation: MoveObservation) => string,
  order: string[],
  globalMean: number,
  globalExactRate: number,
  priorMoves: number
): GroupStat[] {
  const buckets = new Map<string, { scores: number[]; games: Set<number> }>();

  for (const observation of observations) {
    const label = labelFor(observation);
    if (!label) continue;
    const bucket = buckets.get(label) ?? { scores: [], games: new Set<number>() };
    bucket.scores.push(observation.accuracy);
    bucket.games.add(observation.gameIndex);
    buckets.set(label, bucket);
  }

  return order.flatMap((label) => {
    const bucket = buckets.get(label);
    if (!bucket || bucket.scores.length === 0) return [];
    const moves = bucket.scores.length;
    const exactMatches = bucket.scores.filter(isExact).length;

    return [{
      label,
      accuracy: (sum(bucket.scores) + globalMean * priorMoves) / (moves + priorMoves),
      exactRate: 100 * (exactMatches + globalExactRate * priorMoves) / (moves + priorMoves),
      moves,
      games: bucket.games.size
    }];
  });
}

function opponentOrder(observations: MoveObservation[]): string[] {
  const present = new Set(
    observations
      .map((move) => move.opponent)
      .filter((value): value is string => value !== null)
  );
  return [
    "Under 1100",
    "1100-1299",
    "1300-1499",
    "1500-1699",
    "1700-1899",
    "1900-2099",
    "2100-2299",
    "2300+"
  ].filter((label) => present.has(label));
}

function opponentBand(rating: number): string {
  if (rating < 1100) return "Under 1100";
  if (rating < 1300) return "1100-1299";
  if (rating < 1500) return "1300-1499";
  if (rating < 1700) return "1500-1699";
  if (rating < 1900) return "1700-1899";
  if (rating < 2100) return "1900-2099";
  if (rating < 2300) return "2100-2299";
  return "2300+";
}

function estimateDifficultyEffect(
  games: Array<{ row: UserGameStatsRow; accuracy: number }>
): number {
  let cross = 0;
  let squares = 100;

  for (let index = 1; index < games.length; index++) {
    const previousDifficulty = finiteNumber(games[index - 1].row.difficulty);
    const difficulty = finiteNumber(games[index].row.difficulty);
    if (previousDifficulty === null || difficulty === null) continue;
    const difficultyDelta = difficulty - previousDifficulty;
    const accuracyDelta = games[index].accuracy - games[index - 1].accuracy;
    cross += difficultyDelta * accuracyDelta;
    squares += difficultyDelta * difficultyDelta;
  }

  return clamp(cross / squares, 0, 1.5);
}

function mostCommonOpenings(validGames: ValidGame[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const game of validGames) {
    if (game.row.openingLine.length === 0) continue;
    const key = openingKey(game.row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label]) => label);
}

function openingKey(row: UserGameStatsRow): string {
  return row.openingLine.slice(0, 2).join(" ");
}

function recoverySummary(history: UserGameStatsRow[]): { rate: number; samples: number } {
  let samples = 0;
  let recoveries = 0;

  for (const game of history) {
    const scores = validMoveScores(game.accuracyHistory);
    for (let index = 0; index + 1 < scores.length; index++) {
      if (scores[index] >= 65) continue;
      samples += 1;
      if (scores[index + 1] >= 65) recoveries += 1;
    }
  }

  return { rate: samples > 0 ? recoveries / samples : 0, samples };
}

function buildForecast(accuracies: number[]): AccuracyForecast | null {
  if (accuracies.length === 0) return null;
  const completedGames = accuracies.length;
  const minimumFuture = minimumFutureGamesForTarget(accuracies);
  const rollingReached = accuracies.length >= TARGET_WINDOW
    && mean(accuracies.slice(-TARGET_WINDOW)) >= TARGET_ACCURACY;
  const candidates = forecastCandidates(accuracies);
  if (candidates.length === 0) return null;
  const bestError = Math.min(...candidates.map((candidate) => candidate.error));
  const weightedTargets = candidates.map((candidate) => ({
    value: resolveForecastTarget(
      completedGames,
      candidate.targetGame,
      rollingReached,
      minimumFuture
    ),
    weight: Math.exp(-0.5 * Math.min(80, candidate.error - bestError))
  }));
  const best = candidates.reduce((current, candidate) => (
    candidate.error < current.error ? candidate : current
  ));
  const targetGame = resolveForecastTarget(
    completedGames,
    best.targetGame,
    rollingReached,
    minimumFuture
  );
  const targetGameLow = Math.round(weightedQuantile(weightedTargets, 0.1));
  const targetGameHigh = Math.round(weightedQuantile(weightedTargets, 0.9));

  return {
    targetGame,
    targetGameLow,
    targetGameHigh,
    remainingGames: Math.max(0, targetGame - completedGames),
    remainingGamesLow: Math.max(0, targetGameLow - completedGames),
    remainingGamesHigh: Math.max(0, targetGameHigh - completedGames)
  };
}

function forecastCandidates(accuracies: number[]): ForecastCandidate[] {
  const floorPriorPrecision = 1 / (FORECAST_FLOOR_SIGMA ** 2);
  const observationPrecision = 1 / (FORECAST_OBSERVATION_SIGMA ** 2);
  const priorLogOffset = Math.log(FORECAST_PRIOR_OFFSET);
  const candidates: ForecastCandidate[] = [];

  for (let logOffset = Math.log(20); logOffset <= Math.log(20000); logOffset += 0.025) {
    const offset = Math.exp(logOffset);
    let floorNumerator = FORECAST_PRIOR_FLOOR * floorPriorPrecision;
    let floorDenominator = floorPriorPrecision;
    const decays: number[] = [];

    for (let index = 0; index < accuracies.length; index++) {
      const decay = Math.pow(offset / (index + 1 + offset), FORECAST_EXPONENT);
      decays.push(decay);
      floorNumerator += decay * (
        accuracies[index] - FORECAST_CEILING * (1 - decay)
      ) * observationPrecision;
      floorDenominator += decay * decay * observationPrecision;
    }

    const floor = clamp(floorNumerator / floorDenominator, 45, 80);
    let error = ((floor - FORECAST_PRIOR_FLOOR) / FORECAST_FLOOR_SIGMA) ** 2
      + ((logOffset - priorLogOffset) / FORECAST_LOG_OFFSET_SIGMA) ** 2;

    for (let index = 0; index < accuracies.length; index++) {
      const prediction = FORECAST_CEILING * (1 - decays[index]) + floor * decays[index];
      error += ((accuracies[index] - prediction) / FORECAST_OBSERVATION_SIGMA) ** 2;
    }

    const ratio = (FORECAST_CEILING - TARGET_ACCURACY) / (FORECAST_CEILING - floor);
    if (ratio <= 0 || ratio >= 1) continue;
    const targetGame = offset * (Math.pow(ratio, -1 / FORECAST_EXPONENT) - 1);
    if (Number.isFinite(targetGame)) candidates.push({ error, targetGame });
  }

  return candidates;
}

function resolveForecastTarget(
  completedGames: number,
  rawTarget: number,
  rollingReached: boolean,
  minimumFuture: number
): number {
  if (rollingReached) return completedGames;
  return Math.max(
    Math.round(rawTarget),
    completedGames + Math.max(1, minimumFuture)
  );
}

function minimumFutureGamesForTarget(accuracies: number[]): number {
  if (accuracies.length < TARGET_WINDOW) return TARGET_WINDOW - accuracies.length;
  const latest = accuracies.slice(-TARGET_WINDOW);
  if (mean(latest) >= TARGET_ACCURACY) return 0;

  for (let future = 1; future <= TARGET_WINDOW; future++) {
    const projected = [...latest.slice(future), ...Array(future).fill(100)];
    if (mean(projected) >= TARGET_ACCURACY) return future;
  }

  return TARGET_WINDOW;
}

function linearTrend(values: number[]): { slope: number; low: number; high: number } {
  if (values.length < 3) return { slope: 0, low: 0, high: 0 };
  const xMean = (values.length + 1) / 2;
  const yMean = mean(values);
  let cross = 0;
  let xSquares = 0;

  for (let index = 0; index < values.length; index++) {
    const xDelta = index + 1 - xMean;
    cross += xDelta * (values[index] - yMean);
    xSquares += xDelta * xDelta;
  }

  const slope = xSquares > 0 ? cross / xSquares : 0;
  const intercept = yMean - slope * xMean;
  const residualSquares = values.reduce((total, value, index) => {
    const residual = value - (intercept + slope * (index + 1));
    return total + residual * residual;
  }, 0);
  const residualVariance = residualSquares / Math.max(1, values.length - 2);
  const slopeSe = xSquares > 0 ? Math.sqrt(residualVariance / xSquares) : 0;

  return {
    slope,
    low: slope - INTERVAL_Z_80 * slopeSe,
    high: slope + INTERVAL_Z_80 * slopeSe
  };
}

function meanInterval(values: number[]): { low: number; high: number } {
  if (values.length === 0) return { low: 0, high: 0 };
  const center = mean(values);
  const halfWidth = values.length > 1
    ? INTERVAL_Z_80 * standardDeviation(values) / Math.sqrt(values.length)
    : 0;
  return {
    low: clamp(center - halfWidth, 0, 100),
    high: clamp(center + halfWidth, 0, 100)
  };
}

function bestRollingAverage(values: number[], windowSize: number): number | null {
  if (values.length < windowSize) return null;
  let best = -Infinity;
  for (let index = windowSize - 1; index < values.length; index++) {
    const window = values.slice(index - windowSize + 1, index + 1);
    best = Math.max(best, mean(window));
  }
  return best;
}

function weightedGameAccuracy(history: UserGameStatsRow[]): number {
  let weighted = 0;
  let moves = 0;
  for (const game of history) {
    const accuracy = finiteNumber(game.averageAccuracy);
    if (accuracy === null || game.totalMoves <= 0) continue;
    weighted += accuracy * game.totalMoves;
    moves += game.totalMoves;
  }
  return moves > 0 ? weighted / moves : 0;
}

/**
 * Every attempt over every move of the games played with retries (earlier
 * games had one try per move); each move takes at least one.
 */
function attemptsPerMove(history: UserGameStatsRow[]): { value: number | null; games: number } {
  const retriesStartedAt = Date.parse(RETRIES_STARTED_AT);
  let attempts = 0;
  let moves = 0;
  let games = 0;
  for (const game of history) {
    if (!(game.totalMoves > 0) || new Date(game.playedAt).getTime() < retriesStartedAt) continue;
    games += 1;
    moves += game.totalMoves;
    attempts += Math.max(game.totalMoves, finiteNumber(game.attempts) ?? 0);
  }
  return { value: moves > 0 ? attempts / moves : null, games };
}

function isLichessGame(row: UserGameStatsRow): boolean {
  return row.gameId.startsWith("lichess_maia2_")
    || row.openingSource?.toLowerCase().includes("lichess") === true;
}

function validMoveScores(values: number[]): number[] {
  return values
    .map(finiteNumber)
    .filter((value): value is number => value !== null && value >= 0 && value <= 100);
}

function isExact(value: number): boolean {
  return value >= 99.995;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function rate(values: boolean[]): number {
  return values.length > 0 ? values.filter(Boolean).length / values.length : 0;
}

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function weightedQuantile(
  values: Array<{ value: number; weight: number }>,
  probability: number
): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((total, entry) => total + entry.weight, 0);
  const threshold = clamp(probability, 0, 1) * totalWeight;
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= threshold) return entry.value;
  }
  return sorted[sorted.length - 1].value;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(
    values.reduce((total, value) => total + (value - center) ** 2, 0)
      / (values.length - 1)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
