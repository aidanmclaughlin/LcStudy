import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { ensureGamesSeeded, pickNextGame } from "@/lib/games";
import { getUserPlayedGameIds } from "@/lib/db";

const MAX_ATTEMPTS = 3;

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureGamesSeeded();
  const played = await getUserPlayedGameIds(session.user.id);
  const game = pickNextGame(played);

  return NextResponse.json({
    game,
    maxAttempts: MAX_ATTEMPTS
  });
}
