/**
 * Game history API endpoint.
 *
 * GET /api/v1/game-history
 * Returns the authenticated user's complete game history.
 *
 * POST /api/v1/game-history
 * Legacy endpoint - results are now recorded automatically server-side.
 */

import { getAuthSession } from "@/lib/auth";
import { getUserGameHistory } from "@/lib/db";
import { jsonResponse, unauthorizedResponse } from "@/lib/api-utils";
import type { GameHistoryResponse, GameHistoryEntry } from "@/lib/types/api";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const history = await getUserGameHistory(session.user.id);

  const payload: GameHistoryEntry[] = history.map((item) => ({
    date: item.playedAt.toISOString(),
    average_retries: item.averageRetries ?? 0,
    total_moves: item.totalMoves,
    maia_level: item.maiaLevel ?? 1500,
    result: item.solved ? "finished" : "incomplete"
  }));

  return jsonResponse<GameHistoryResponse>({ history: payload });
}

/**
 * Legacy POST endpoint.
 * Game results are now recorded automatically when sessions complete.
 * @deprecated Use POST /api/v1/session/[sid]/complete instead
 */
export async function POST() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  return jsonResponse({ success: true });
}
