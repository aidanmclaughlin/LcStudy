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
  avgAttempts: number;
  cumulativeWinRate: number;
}

/** A single game's attempts data */
export interface AttemptsPoint {
  label: string;
  attempts: number;
  solved: boolean;
}

/** Complete user statistics summary */
export interface UserStatsSummary {
  totalGames: number;
  solvedGames: number;
  winRate: number;
  averageAttempts: number;
  currentStreak: number;
  timeline: TimelinePoint[];
  attempts: AttemptsPoint[];
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
  const averageAttempts = calculateWeightedAverage(history);
  const currentStreak = calculateStreak(history);
  const timeline = buildTimeline(history);
  const attempts = buildAttemptsData(history);

  return {
    totalGames,
    solvedGames,
    winRate,
    averageAttempts,
    currentStreak,
    timeline,
    attempts
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
    averageAttempts: 0,
    currentStreak: 0,
    timeline: [],
    attempts: []
  };
}

/**
 * Calculate the weighted average attempts per move across all games.
 * Weighted by total moves in each game.
 */
function calculateWeightedAverage(history: UserGameRow[]): number {
  const totalMoves = history.reduce((sum, game) => sum + game.totalMoves, 0);
  const totalAttempts = history.reduce((sum, game) => {
    const gameAttempts = (game.averageRetries ?? 0) * game.totalMoves;
    return sum + gameAttempts;
  }, 0);

  return totalMoves > 0 ? totalAttempts / totalMoves : 0;
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
    attempts: number;
  }>();

  for (const game of history) {
    const key = game.playedAt.toISOString().slice(0, 10);

    if (!daily.has(key)) {
      daily.set(key, { wins: 0, total: 0, moves: 0, attempts: 0 });
    }

    const bucket = daily.get(key)!;
    bucket.total++;
    bucket.moves += game.totalMoves;
    bucket.attempts += (game.averageRetries ?? 0) * game.totalMoves;

    if (game.solved) {
      bucket.wins++;
    }
  }

  // Build timeline with cumulative stats
  const sortedDates = Array.from(daily.keys()).sort();
  const timeline: TimelinePoint[] = [];
  let cumulativeWins = 0;
  let cumulativeTotal = 0;

  for (const date of sortedDates) {
    const entry = daily.get(date)!;
    cumulativeWins += entry.wins;
    cumulativeTotal += entry.total;

    timeline.push({
      date,
      gamesPlayed: entry.total,
      wins: entry.wins,
      winRate: entry.wins / entry.total,
      avgAttempts: entry.moves > 0 ? entry.attempts / entry.moves : 0,
      cumulativeWinRate: cumulativeWins / cumulativeTotal
    });
  }

  return timeline;
}

/**
 * Build per-game attempts data for visualization.
 */
function buildAttemptsData(history: UserGameRow[]): AttemptsPoint[] {
  return history.map((game, idx) => ({
    label: `#${idx + 1}`,
    attempts: game.averageRetries ?? 0,
    solved: game.solved
  }));
}
