import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { finalizeSession } from "@/lib/sessions";

interface CompletePayload {
  total_attempts?: number;
  total_moves?: number;
  attempt_history?: number[];
  average_retries?: number;
  maia_level?: number;
  result?: string;
}

export async function POST(request: Request, { params }: { params: { sid: string } }) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: CompletePayload;
  try {
    payload = (await request.json()) as CompletePayload;
  } catch (error) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
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
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
