/**
 * User statistics API endpoint.
 *
 * GET /api/v1/stats
 * Returns aggregated statistics for the authenticated user's game history.
 */

import { getAuthSession } from "@/lib/auth";
import { getUserGameHistory } from "@/lib/db";
import { computeStats } from "@/lib/stats";
import { jsonResponse, unauthorizedResponse } from "@/lib/api-utils";
import type { StatsResponse } from "@/lib/types/api";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return unauthorizedResponse();
  }

  const history = await getUserGameHistory(session.user.id);
  const summary = computeStats(history);

  return jsonResponse<StatsResponse>(summary);
}
