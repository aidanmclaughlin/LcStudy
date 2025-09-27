import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { recordGameResult } from "@/lib/db";
import { ensureGamesSeeded, getAllGames } from "@/lib/games";

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { gameId, attempts, solved } = body as {
    gameId?: string;
    attempts?: number;
    solved?: boolean;
  };

  if (!gameId || typeof attempts !== "number" || attempts <= 0) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!getAllGames().some((entry) => entry.id === gameId)) {
    return NextResponse.json({ error: "Unknown game" }, { status: 400 });
  }

  const accuracy = solved ? 1 / attempts : 0;

  await ensureGamesSeeded();

  await recordGameResult({
    userId: session.user.id,
    gameId,
    attempts,
    solved: Boolean(solved),
    accuracy
  });

  return NextResponse.json({ ok: true });
}
