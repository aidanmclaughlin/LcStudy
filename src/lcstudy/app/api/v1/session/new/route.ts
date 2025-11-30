/**
 * New game session API endpoint.
 *
 * POST /api/v1/session/new
 * Creates a new game session for the authenticated user.
 * Picks an unplayed game from the pool when possible.
 */

import { getAuthSession } from "@/lib/auth";
import { createSessionForUser } from "@/lib/sessions";
import { jsonResponse, unauthorizedResponse, parseJsonBody } from "@/lib/api-utils";
import type { SessionCreateRequest, SessionCreateResponse } from "@/lib/types/api";

/** Default Maia level when not specified in request */
const DEFAULT_MAIA_LEVEL = 1500;

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const body = await parseJsonBody<SessionCreateRequest>(request) ?? {};
  const maiaLevel = body.maia_level ?? DEFAULT_MAIA_LEVEL;

  const { session: gameSession, game } = await createSessionForUser({
    userId: session.user.id,
    maiaLevel
  });

  const response: SessionCreateResponse = {
    id: gameSession.id,
    game_id: game.id,
    flip: gameSession.flip,
    fen: gameSession.fen,
    starting_fen: game.startingFen,
    moves: game.moves,
    ply: gameSession.ply,
    maia_level: gameSession.maiaLevel
  };

  return jsonResponse(response);
}
