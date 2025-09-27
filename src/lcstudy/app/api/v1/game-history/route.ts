import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { getUserGameHistory } from "@/lib/db";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const history = await getUserGameHistory(session.user.id);

  const payload = history.map((item) => ({
    date: item.playedAt.toISOString(),
    average_retries:
      item.averageRetries ?? (item.totalMoves > 0 ? item.attempts / item.totalMoves : item.attempts),
    total_moves: item.totalMoves,
    maia_level: item.maiaLevel ?? 1500,
    result: item.solved ? "finished" : "incomplete"
  }));

  return NextResponse.json({ history: payload });
}

// Legacy endpoint – results are recorded automatically server-side.
export async function POST() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ success: true });
}
