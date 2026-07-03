/**
 * Think-time coach API endpoint.
 *
 * GET /api/v1/coach
 * Fits the coach model on the user's game history and returns a suggested
 * think budget for the next game, plus per-bin posterior summaries.
 */

import { getAuthSession } from "@/lib/auth";
import { getUserGameHistory, getGameDifficulties, setGameDifficulty } from "@/lib/db";
import { getPrecomputedGameById } from "@/lib/precomputed";
import { fitCoach, gameEase, type CoachGameInput } from "@/lib/coach";
import { jsonResponse, unauthorizedResponse } from "@/lib/api-utils";
import type { CoachResponse } from "@/lib/types/api";

/** Cap on PGN parses per request while the difficulty cache backfills */
const MAX_DIFFICULTY_BACKFILL = 200;

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const history = await getUserGameHistory(session.user.id);

  // Resolve per-game ease (predictability) from the cache, computing missing
  // entries from the PGN analysis blobs and writing them back.
  const gameIds = Array.from(new Set(history.map((g) => g.gameId)));
  const difficulties = await getGameDifficulties(gameIds);

  let backfilled = 0;
  const backfillWrites: Promise<void>[] = [];
  for (const id of gameIds) {
    if (difficulties.has(id) || backfilled >= MAX_DIFFICULTY_BACKFILL) continue;

    const game = getPrecomputedGameById(id);
    if (!game) continue;

    const ease = gameEase(game.rounds.map((round) => ({ analysis: round.player.analysis })));
    if (ease === null) continue;

    difficulties.set(id, ease);
    backfillWrites.push(
      setGameDifficulty(id, ease).catch((error) => {
        console.warn(`Failed to cache difficulty for ${id}`, error);
      })
    );
    backfilled += 1;
  }
  await Promise.all(backfillWrites);

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
