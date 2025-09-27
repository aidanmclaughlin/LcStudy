import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { checkMoveLegality, getSessionForUser } from "@/lib/sessions";

interface MoveRequest {
  move: string;
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

  const result = checkMoveLegality(record, payload.move);
  return NextResponse.json(result);
}
