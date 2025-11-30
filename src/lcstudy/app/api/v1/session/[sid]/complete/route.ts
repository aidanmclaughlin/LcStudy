/**
 * Session completion API endpoint.
 *
 * POST /api/v1/session/[sid]/complete
 * Finalizes a game session, records the result, and cleans up.
 */

import { getAuthSession } from "@/lib/auth";
import { finalizeSession } from "@/lib/sessions";
import {
  jsonResponse,
  errorResponse,
  unauthorizedResponse,
  parseJsonBody
} from "@/lib/api-utils";
import type { SessionCompleteRequest, SessionCompleteResponse } from "@/lib/types/api";

export async function POST(
  request: Request,
  { params }: { params: { sid: string } }
) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const payload = await parseJsonBody<SessionCompleteRequest>(request);
  if (!payload) {
    return errorResponse("Invalid payload");
  }

  try {
    await finalizeSession({
      sessionId: params.sid,
      userId: session.user.id,
      totalAttempts: payload.total_attempts,
      totalMoves: payload.total_moves,
      attemptHistory: payload.attempt_history ?? [],
      averageRetries: payload.average_retries,
      maiaLevel: payload.maia_level,
      result: payload.result ?? "finished"
    });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }

  return jsonResponse<SessionCompleteResponse>({ ok: true });
}
