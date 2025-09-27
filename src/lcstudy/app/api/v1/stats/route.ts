import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { getUserGameHistory } from "@/lib/db";
import { computeStats } from "@/lib/stats";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const history = await getUserGameHistory(session.user.id);
  const summary = computeStats(history);
  return NextResponse.json(summary);
}
