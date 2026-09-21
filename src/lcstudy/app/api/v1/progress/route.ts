import { getAuthSession } from "@/lib/auth";
import { getUserGameStatsHistory } from "@/lib/db";
import { computeProgressDashboard } from "@/lib/progress-stats";
import { jsonResponse, unauthorizedResponse } from "@/lib/api-utils";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) return unauthorizedResponse();
  const stats = computeProgressDashboard(await getUserGameStatsHistory(session.user.id));
  const response = jsonResponse(stats);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
