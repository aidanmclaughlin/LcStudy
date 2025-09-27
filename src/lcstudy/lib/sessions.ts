import { Chess } from "chess.js";
import { randomUUID } from "crypto";

import {
  createSessionRecord,
  deleteSessionById,
  deleteSessionsForUser,
  getSessionRecord,
  getUserPlayedGameIds,
  recordGameResult,
  type SessionRecord
} from "@/lib/db";
import { getPrecomputedGameById, pickPrecomputedGame, type PrecomputedGame } from "@/lib/precomputed";

interface CreateSessionOptions {
  userId: string;
  maiaLevel: number;
}

export interface SessionCreationResult {
  session: SessionRecord;
  game: PrecomputedGame;
}

export async function createSessionForUser({ userId, maiaLevel }: CreateSessionOptions): Promise<SessionCreationResult> {
  await deleteSessionsForUser(userId);

  const played = await getUserPlayedGameIds(userId);
  const game = pickPrecomputedGame(played);

  const sessionId = randomUUID();
  const flip = game.leelaColor === "b";

  const chess = new Chess(game.startingFen);
  let ply = 0;

  if (flip && game.moves.length > 0) {
    const opening = game.moves[0];
    const move = chess.move({ from: opening.uci.slice(0, 2), to: opening.uci.slice(2, 4), promotion: opening.uci.length > 4 ? opening.uci.slice(4) : undefined });
    if (move) {
      ply = 1;
    }
  }

  const session = await createSessionRecord({
    id: sessionId,
    userId,
    gameId: game.id,
    fen: chess.fen(),
    ply,
    flip,
    maiaLevel,
    moveHistory: [],
    attemptsHistory: []
  });

  return { session, game };
}

export interface FinalizeSessionInput {
  sessionId: string;
  userId: string;
  attemptHistory: number[];
  totalAttempts?: number;
  totalMoves?: number;
  averageRetries?: number | null;
  maiaLevel?: number | null;
  result?: string;
}

export async function finalizeSession(args: FinalizeSessionInput): Promise<void> {
  const { sessionId, userId, attemptHistory } = args;
  const session = await getSessionRecord(sessionId);

  if (!session || session.userId !== userId) {
    throw new Error("Session not found");
  }

  const movesCount = args.totalMoves ?? attemptHistory.length;
  const attemptsSum =
    args.totalAttempts ?? (attemptHistory.length > 0 ? attemptHistory.reduce((sum, value) => sum + value, 0) : 0);
  const averageRetries =
    args.averageRetries ?? (movesCount > 0 ? attemptsSum / movesCount : null);

  await recordGameResult({
    userId: session.userId,
    gameId: session.gameId,
    attempts: attemptsSum,
    solved: (args.result ?? "finished") === "finished",
    accuracy: averageRetries && averageRetries > 0 ? 1 / averageRetries : null,
    totalMoves: movesCount,
    averageRetries,
    maiaLevel: args.maiaLevel ?? session.maiaLevel
  });

  await deleteSessionById(sessionId);
}

export async function getSessionForUser(sessionId: string, userId: string) {
  const session = await getSessionRecord(sessionId);
  if (!session || session.userId !== userId) {
    return null;
  }
  return session;
}
