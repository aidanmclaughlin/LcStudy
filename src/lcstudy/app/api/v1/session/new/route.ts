import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { createSessionForUser } from "@/lib/sessions";

interface SessionCreateRequest {
  maia_level?: number;
  custom_fen?: string | null;
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SessionCreateRequest = {};
  try {
    body = (await request.json()) as SessionCreateRequest;
  } catch (error) {
    // ignore malformed bodies and use defaults
  }

  const maiaLevel = body.maia_level ?? 1500;

  const { session: gameSession, game } = await createSessionForUser({
    userId: session.user.id,
    maiaLevel
  });

  return NextResponse.json({
    id: gameSession.id,
    game_id: game.id,
    flip: gameSession.flip,
    fen: gameSession.fen,
    starting_fen: game.startingFen,
    moves: game.moves,
    ply: gameSession.ply,
    maia_level: gameSession.maiaLevel
  });
}
