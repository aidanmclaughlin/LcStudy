import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { getSessionForUser, submitMove } from "@/lib/sessions";

interface MoveRequest {
  move: string;
  client_validated?: boolean;
}

export async function POST(request: Request, { params }: { params: { sid: string } }) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const record = await getSessionForUser(params.sid, session.user.id);
  if (!record) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let payload: MoveRequest;
  try {
    payload = (await request.json()) as MoveRequest;
  } catch (error) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!payload.move) {
    return NextResponse.json({ error: "Move required" }, { status: 400 });
  }

  try {
    const { record: updated, result } = await submitMove(record, payload.move);

    if (!result.correct) {
      return NextResponse.json({
        correct: false,
        attempts: result.attempts,
        message: result.message
      });
    }

    return NextResponse.json({
      your_move: result.leelaMove,
      correct: true,
      message: result.message,
      total: updated.scoreTotal,
      fen: result.fen,
      status: result.status,
      attempts: result.attempts,
      leela_move: result.leelaMove,
      maia_move: result.maiaMove ?? null
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
