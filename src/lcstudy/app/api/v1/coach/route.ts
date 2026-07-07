/**
 * Think-time coach API endpoint.
 *
 * GET /api/v1/coach
 * Fits the coach model on the user's game history and returns a suggested
 * think budget for the next game, plus per-bin posterior summaries.
 */

import { getAuthSession } from "@/lib/auth";
import { getUserGameHistory, getGameDifficulties } from "@/lib/db";
import { fitCoach, type CoachGameInput } from "@/lib/coach";
import { jsonResponse, unauthorizedResponse } from "@/lib/api-utils";
import type { CoachResponse } from "@/lib/types/api";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const history = await getUserGameHistory(session.user.id);

  // Per-game ease (predictability) comes from the precomputed cache only;
  // games without a cached value are used unadjusted. The cache is populated
  // offline (tools/precompute_difficulty.py) — never on the request path.
  const gameIds = Array.from(new Set(history.map((g) => g.gameId)));
  const difficulties = await getGameDifficulties(gameIds);

  const inputs: CoachGameInput[] = history.map((g) => ({
    thinkMs: g.thinkTimeMs ?? g.durationMs ?? 0,
    moves: g.totalMoves,
    accuracy: g.averageAccuracy ?? 0,
    ease: difficulties.get(g.gameId) ?? null
  }));

  const suggestion = fitCoach(inputs);

  const response: CoachResponse = {
    suggested_think_ms: suggestion.suggestedThinkMs,
    per_move_ms: suggestion.perMoveMs,
    status: suggestion.status,
    note: suggestion.note,
    n_games: suggestion.nGames,
    beta: suggestion.beta,
    bins: suggestion.bins.map((bin) => ({
      minutes: bin.minutes,
      games: bin.games,
      hours: Math.round(bin.hours * 100) / 100,
      rate_mean: Math.round(bin.rateMean * 1000) / 1000,
      rate_sd: Math.round(bin.rateSd * 1000) / 1000,
      p_best: Math.round(bin.pBest * 1000) / 1000
    })),
    skill_series: suggestion.skillSeries
  };

  return jsonResponse(response);
}
