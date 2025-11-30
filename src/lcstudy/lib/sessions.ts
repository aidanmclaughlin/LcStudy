/**
 * Session management for game play.
 *
 * Session Lifecycle:
 * 1. User requests new game → createSessionForUser()
 * 2. User plays moves → session state updated client-side
 * 3. Game completes → finalizeSession() records result and deletes session
 *
 * @module sessions
 */

import { Chess } from "chess.js";
import { randomUUID } from "crypto";

import {
  createSessionRecord,
  deleteSessionById,
  deleteSessionsForUser,
  ensureGameRecord,
  getSessionRecord,
  getUserPlayedGameIds,
  recordGameResult,
  type SessionRecord
} from "@/lib/db";
import {
  getPrecomputedGameById,
  pickPrecomputedGame,
  type PrecomputedGame
} from "@/lib/precomputed";

// =============================================================================
// Types
// =============================================================================

/** Options for creating a new session */
export interface CreateSessionOptions {
  userId: string;
  maiaLevel: number;
}

/** Result of session creation */
export interface CreateSessionResult {
  session: SessionRecord;
  game: PrecomputedGame;
}

/** Input for finalizing a session */
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

// =============================================================================
// Session Operations
// =============================================================================

/**
 * Create a new game session for a user.
 *
 * This function:
 * 1. Deletes any existing sessions for the user
 * 2. Picks a game the user hasn't played (or random if all played)
 * 3. Creates the session with initial state
 *
 * @param options - User ID and Maia level
 * @returns The created session and game data
 */
export async function createSessionForUser(
  options: CreateSessionOptions
): Promise<CreateSessionResult> {
  const { userId, maiaLevel } = options;

  // Ensure only one active session per user
  await deleteSessionsForUser(userId);

  // Pick a game the user hasn't played yet
  const playedGameIds = await getUserPlayedGameIds(userId);
  const game = pickPrecomputedGame(playedGameIds);

  // Ensure the game exists in the database
  await ensureGameRecord({ id: game.id, source: game });

  // Initialize chess engine for move validation
  const sessionId = randomUUID();
  const flip = game.leelaColor === "b";
  const chess = new Chess(game.startingFen);

  // If playing as black, apply white's first move
  let ply = 0;
  if (flip && game.moves.length > 0) {
    const openingMove = game.moves[0];
    const moveResult = chess.move({
      from: openingMove.uci.slice(0, 2),
      to: openingMove.uci.slice(2, 4),
      promotion: openingMove.uci.length > 4 ? openingMove.uci.slice(4) : undefined
    });
    if (moveResult) {
      ply = 1;
    }
  }

  // Create the session record
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

/**
 * Finalize a session by recording the game result and cleaning up.
 *
 * @param input - Session finalization parameters
 * @throws Error if session not found or doesn't belong to user
 */
export async function finalizeSession(input: FinalizeSessionInput): Promise<void> {
  const { sessionId, userId, attemptHistory } = input;

  // Verify session ownership
  const session = await getSessionRecord(sessionId);
  if (!session || session.userId !== userId) {
    throw new Error("Session not found");
  }

  // Calculate statistics
  const movesCount = input.totalMoves ?? attemptHistory.length;
  const attemptsSum = input.totalAttempts ??
    (attemptHistory.length > 0
      ? attemptHistory.reduce((sum, value) => sum + value, 0)
      : 0);
  const averageRetries = input.averageRetries ??
    (movesCount > 0 ? attemptsSum / movesCount : null);

  // Record the game result
  await recordGameResult({
    userId: session.userId,
    gameId: session.gameId,
    attempts: attemptsSum,
    solved: (input.result ?? "finished") === "finished",
    accuracy: averageRetries && averageRetries > 0 ? 1 / averageRetries : null,
    totalMoves: movesCount,
    averageRetries,
    maiaLevel: input.maiaLevel ?? session.maiaLevel
  });

  // Clean up the session
  await deleteSessionById(sessionId);
}

/**
 * Get a session if it belongs to the specified user.
 *
 * @param sessionId - Session UUID
 * @param userId - User UUID
 * @returns Session record or null if not found/unauthorized
 */
export async function getSessionForUser(
  sessionId: string,
  userId: string
): Promise<SessionRecord | null> {
  const session = await getSessionRecord(sessionId);

  if (!session || session.userId !== userId) {
    return null;
  }

  return session;
}
