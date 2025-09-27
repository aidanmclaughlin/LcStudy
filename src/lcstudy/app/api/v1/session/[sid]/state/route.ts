import { NextResponse } from "next/server";
import { Chess } from "chess.js";

import { getAuthSession } from "@/lib/auth";
import { getSessionForUser } from "@/lib/sessions";

export async function GET(_request: Request, { params }: { params: { sid: string } }) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const record = await getSessionForUser(params.sid, session.user.id);
  if (!record) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const chess = new Chess(record.fen);
  const turn = chess.turn() === "w" ? "white" : "black";

  return NextResponse.json({
    id: record.id,
    fen: record.fen,
    turn,
    score_total: record.scoreTotal,
    ply: record.ply,
    status: record.status,
    flip: record.flip,
    top_lines: [],
    maia_level: record.maiaLevel
  });
}
