import type { UserGameRow } from "@/lib/db";

export interface TimelinePoint {
  date: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgAttempts: number;
  cumulativeWinRate: number;
}

export interface AttemptsPoint {
  label: string;
  attempts: number;
  solved: boolean;
}

export interface UserStatsSummary {
  totalGames: number;
  solvedGames: number;
  winRate: number;
  averageAttempts: number;
  currentStreak: number;
  timeline: TimelinePoint[];
  attempts: AttemptsPoint[];
}

export function computeStats(history: UserGameRow[]): UserStatsSummary {
  if (history.length === 0) {
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

  const totalGames = history.length;
  const solvedGames = history.filter((g) => g.solved).length;
  const winRate = solvedGames / totalGames;

  // Calculate proper weighted average across all games
  const totalMoves = history.reduce((sum, g) => sum + g.totalMoves, 0);
  const totalAttempts = history.reduce((sum, g) => {
    const gameAttempts = (g.averageRetries ?? 0) * g.totalMoves;
    return sum + gameAttempts;
  }, 0);
  const averageAttempts = totalMoves > 0 ? totalAttempts / totalMoves : 0;

  // streak calculation (count consecutive solved from the end)
  let currentStreak = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].solved) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  const daily = new Map<string, { wins: number; total: number; moves: number; attempts: number }>();
  history.forEach((g) => {
    const key = g.playedAt.toISOString().slice(0, 10);
    if (!daily.has(key)) {
      daily.set(key, { wins: 0, total: 0, moves: 0, attempts: 0 });
    }
    const bucket = daily.get(key)!;
    bucket.total += 1;
    bucket.moves += g.totalMoves;
    bucket.attempts += (g.averageRetries ?? 0) * g.totalMoves;
    if (g.solved) bucket.wins += 1;
  });

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

  const attempts: AttemptsPoint[] = history.map((g, idx) => ({
    label: `#${idx + 1}`,
    attempts: g.averageRetries ?? 0,
    solved: g.solved
  }));

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
