import { Chess } from "chess.js";
import { randomUUID } from "crypto";

import {
  createSessionRecord,
  deleteSessionsForUser,
  getSessionRecord,
  getUserPlayedGameIds,
  MoveHistoryEntry,
  recordGameResult,
  SessionRecord,
  updateSessionCurrentAttempts,
  updateSessionRecord
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

function parseUci(uci: string): { from: string; to: string; promotion?: string } {
  const norm = uci.toLowerCase();
  const from = norm.slice(0, 2);
  const to = norm.slice(2, 4);
  const promotion = norm.length > 4 ? norm.slice(4) : undefined;
  return { from, to, promotion };
}

export async function createSessionForUser({ userId, maiaLevel }: CreateSessionOptions): Promise<SessionCreationResult> {
  await deleteSessionsForUser(userId);

  const played = await getUserPlayedGameIds(userId);
  const game = pickPrecomputedGame(played);

  const sessionId = randomUUID();
  const flip = game.leelaColor === "b";

  const chess = new Chess(game.startingFen);
  const moveHistory: MoveHistoryEntry[] = [];
  let ply = 0;

  if (flip && game.moves.length > 0) {
    const maiaMove = game.moves[0];
    const { from, to, promotion } = parseUci(maiaMove.uci);
    const move = chess.move({ from, to, promotion });
    if (move) {
      moveHistory.push({ fen: chess.fen(), san: move.san, isUserMove: false });
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
    moveHistory
  });

  return { session, game };
}

export async function getSessionForUser(sessionId: string, userId: string): Promise<SessionRecord | null> {
  const session = await getSessionRecord(sessionId);
  if (!session || session.userId !== userId) {
    return null;
  }
  return session;
}

export interface MoveCheckResult {
  legal: boolean;
  needsPromotion: boolean;
}

export function checkMoveLegality(session: SessionRecord, move: string): MoveCheckResult {
  const chess = new Chess(session.fen);
  const norm = move.toLowerCase();
  const legalMoves = chess.moves({ verbose: true });
  const isExact = legalMoves.some((legalMove) => normalizeMove(legalMove) === norm);
  if (isExact) {
    return { legal: true, needsPromotion: false };
  }

  const needsPromotion = legalMoves.some((legalMove) => {
    const base = `${legalMove.from}${legalMove.to}`.toLowerCase();
    return norm.startsWith(base) && legalMove.promotion;
  });

  return { legal: false, needsPromotion };
}

function normalizeMove(move: { from: string; to: string; promotion?: string | undefined }): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase();
}

interface PredictionFailure {
  correct: false;
  attempts: number;
  message: string;
}

interface PredictionSuccess {
  correct: true;
  attempts: number;
  message: string;
  fen: string;
  status: "playing" | "finished";
  leelaMove: string;
  maiaMove?: string;
}

export type PredictionResult = PredictionFailure | PredictionSuccess;

function ensureGame(session: SessionRecord): PrecomputedGame {
  const game = getPrecomputedGameById(session.gameId);
  if (!game) {
    throw new Error(`Game ${session.gameId} not found`);
  }
  return game;
}

export async function submitMove(session: SessionRecord, move: string): Promise<{ record: SessionRecord; result: PredictionResult }> {
  if (session.status === "finished") {
    return {
      record: session,
      result: {
        correct: false,
        attempts: session.currentAttempts,
        message: "Game already finished."
      }
    };
  }

  const game = ensureGame(session);
  const expected = game.moves[session.ply];

  if (!expected) {
    return {
      record: session,
      result: {
        correct: false,
        attempts: session.currentAttempts,
        message: "No move expected at this stage."
      }
    };
  }

  const normalized = move.toLowerCase();
  if (normalized !== expected.uci) {
    const attempts = session.currentAttempts + 1;
    await updateSessionCurrentAttempts({ id: session.id, currentAttempts: attempts });
    const updated = { ...session, currentAttempts: attempts, updatedAt: new Date() };
    return {
      record: updated,
      result: {
        correct: false,
        attempts,
        message: "Not quite. Try again."
      }
    };
  }

  const chess = new Chess(session.fen);
  const { from, to, promotion } = parseUci(normalized);
  const userMove = chess.move({ from, to, promotion });
  if (!userMove) {
    throw new Error("Failed to apply user move");
  }

  const attemptsForMove = session.currentAttempts + 1;
  const attemptsHistory = [...session.attemptsHistory, attemptsForMove];
  const moveHistory: MoveHistoryEntry[] = [
    ...session.moveHistory,
    { fen: chess.fen(), san: userMove.san, isUserMove: true }
  ];

  let ply = session.ply + 1;
  let maiaMoveSan: string | undefined;

  if (ply < game.moves.length) {
    const maiaMoveDef = game.moves[ply];
    const reply = chess.move(parseUci(maiaMoveDef.uci));
    if (reply) {
      maiaMoveSan = reply.san;
      moveHistory.push({ fen: chess.fen(), san: reply.san, isUserMove: false });
      ply += 1;
    }
  }

  const status: "playing" | "finished" = ply >= game.moves.length ? "finished" : "playing";

  const updatedRecord = await updateSessionRecord({
    id: session.id,
    fen: chess.fen(),
    ply,
    status,
    currentAttempts: 0,
    attemptsHistory,
    moveHistory,
    scoreTotal: session.scoreTotal
  });

  if (status === "finished") {
    const totalMoves = attemptsHistory.length;
    const totalAttempts = attemptsHistory.reduce((sum, value) => sum + value, 0);
    const averageRetries = totalMoves > 0 ? totalAttempts / totalMoves : null;
    const accuracy = averageRetries && averageRetries > 0 ? 1 / averageRetries : null;

    await recordGameResult({
      userId: session.userId,
      gameId: session.gameId,
      attempts: totalAttempts,
      solved: true,
      accuracy,
      totalMoves,
      averageRetries,
      maiaLevel: session.maiaLevel
    });

    // Clean up finished session to keep the table lean
  }

  return {
    record: updatedRecord,
    result: {
      correct: true,
      attempts: attemptsForMove,
      message: "Nice!",
      fen: updatedRecord.fen,
      status,
      leelaMove: userMove.san,
      maiaMove: maiaMoveSan
    }
  };
}
