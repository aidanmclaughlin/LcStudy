/**
 * Statistics calculation for user performance.
 * @module stats
 */

import type { UserGameRow } from "@/lib/db";

// =============================================================================
// Types
// =============================================================================

/** A single data point in the timeline */
export interface TimelinePoint {
  date: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgAccuracy: number;
  cumulativeAccuracy: number;
}

/** A single game's accuracy data */
export interface AccuracyPoint {
  label: string;
  accuracy: number;
  solved: boolean;
}

/** Complete user statistics summary */
export interface UserStatsSummary {
  totalGames: number;
  solvedGames: number;
  winRate: number;
  averageAccuracy: number;
  currentStreak: number;
  timeline: TimelinePoint[];
  accuracy: AccuracyPoint[];
}

// =============================================================================
// Statistics Calculation
// =============================================================================

/**
 * Compute comprehensive statistics from a user's game history.
 *
 * @param history - Array of user game records, ordered by play date
 * @returns Complete statistics summary
 */
export function computeStats(history: UserGameRow[]): UserStatsSummary {
  if (history.length === 0) {
    return createEmptyStats();
  }

  const totalGames = history.length;
  const solvedGames = history.filter((game) => game.solved).length;
  const winRate = solvedGames / totalGames;
  const averageAccuracy = calculateWeightedAccuracy(history);
  const currentStreak = calculateStreak(history);
  const timeline = buildTimeline(history);
  const accuracy = buildAccuracyData(history);

  return {
    totalGames,
    solvedGames,
    winRate,
    averageAccuracy,
    currentStreak,
    timeline,
    accuracy
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create an empty stats object for users with no history.
 */
function createEmptyStats(): UserStatsSummary {
  return {
    totalGames: 0,
    solvedGames: 0,
    winRate: 0,
    averageAccuracy: 0,
    currentStreak: 0,
    timeline: [],
    accuracy: []
  };
}

/**
 * Calculate the weighted average accuracy per move across all games.
 * Weighted by total moves in each game.
 */
function calculateWeightedAccuracy(history: UserGameRow[]): number {
  const totalMoves = history.reduce((sum, game) => sum + game.totalMoves, 0);
  const totalAccuracy = history.reduce((sum, game) => {
    const gameAccuracy = (game.averageAccuracy ?? 0) * game.totalMoves;
    return sum + gameAccuracy;
  }, 0);

  return totalMoves > 0 ? totalAccuracy / totalMoves : 0;
}

/**
 * Calculate the current winning streak (consecutive solved games from the end).
 */
function calculateStreak(history: UserGameRow[]): number {
  let streak = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].solved) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Build daily aggregated timeline data.
 */
function buildTimeline(history: UserGameRow[]): TimelinePoint[] {
  // Aggregate by date
  const daily = new Map<string, {
    wins: number;
    total: number;
    moves: number;
    accuracy: number;
  }>();

  for (const game of history) {
    const key = game.playedAt.toISOString().slice(0, 10);

    if (!daily.has(key)) {
      daily.set(key, { wins: 0, total: 0, moves: 0, accuracy: 0 });
    }

    const bucket = daily.get(key)!;
    bucket.total++;
    bucket.moves += game.totalMoves;
    bucket.accuracy += (game.averageAccuracy ?? 0) * game.totalMoves;

    if (game.solved) {
      bucket.wins++;
    }
  }

  // Build timeline with cumulative stats
  const sortedDates = Array.from(daily.keys()).sort();
  const timeline: TimelinePoint[] = [];
  let cumulativeAccuracy = 0;
  let cumulativeMoves = 0;

  for (const date of sortedDates) {
    const entry = daily.get(date)!;
    cumulativeAccuracy += entry.accuracy;
    cumulativeMoves += entry.moves;

    timeline.push({
      date,
      gamesPlayed: entry.total,
      wins: entry.wins,
      winRate: entry.wins / entry.total,
      avgAccuracy: entry.moves > 0 ? entry.accuracy / entry.moves : 0,
      cumulativeAccuracy: cumulativeMoves > 0 ? cumulativeAccuracy / cumulativeMoves : 0
    });
  }

  return timeline;
}

/**
 * Build per-game accuracy data for visualization.
 */
function buildAccuracyData(history: UserGameRow[]): AccuracyPoint[] {
  return history.map((game, idx) => ({
    label: `#${idx + 1}`,
    accuracy: game.averageAccuracy ?? 0,
    solved: game.solved
  }));
}
