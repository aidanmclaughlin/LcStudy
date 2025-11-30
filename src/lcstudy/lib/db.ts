/**
 * Database operations using Vercel Postgres.
 * @module db
 */

import { sql as baseSql } from "@vercel/postgres";

import type {
  DbUser,
  DbUserRow,
  UserGameRow,
  UserGameDbRow,
  RecordGameResultParams,
  MoveHistoryEntry,
  SessionRecord,
  SessionDbRow,
  CreateSessionParams,
  UpdateSessionParams
} from "./types/db";

// Re-export types for convenience
export type {
  DbUser,
  UserGameRow,
  MoveHistoryEntry,
  SessionRecord,
  RecordGameResultParams,
  CreateSessionParams,
  UpdateSessionParams
};

export const sql = baseSql;

// =============================================================================
// User Operations
// =============================================================================

/**
 * Ensure a user exists in the database, creating or updating as needed.
 * @param profile - User profile from OAuth provider
 * @returns The database user record
 */
export async function ensureUser(profile: {
  email?: string | null;
  name?: string | null;
  image?: string | null;
}): Promise<DbUser> {
  if (!profile.email) {
    throw new Error("Email is required for user provisioning");
  }

  const { rows } = await sql<DbUserRow>`
    INSERT INTO users (email, name, image)
    VALUES (${profile.email}, ${profile.name ?? null}, ${profile.image ?? null})
    ON CONFLICT (email)
    DO UPDATE SET name = EXCLUDED.name, image = EXCLUDED.image
    RETURNING id, email, name, image;
  `;

  return rows[0];
}

/**
 * Get a user by their email address.
 * @param email - User's email
 * @returns User record or null if not found
 */
export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const { rows } = await sql<DbUserRow>`
    SELECT id, email, name, image
    FROM users
    WHERE email = ${email}
    LIMIT 1;
  `;
  return rows[0] ?? null;
}

/**
 * Get a user by their database ID.
 * @param id - User's UUID
 * @returns User record or null if not found
 */
export async function getUserById(id: string): Promise<DbUser | null> {
  const { rows } = await sql<DbUserRow>`
    SELECT id, email, name, image
    FROM users
    WHERE id = ${id}
    LIMIT 1;
  `;
  return rows[0] ?? null;
}

// =============================================================================
// Game Operations
// =============================================================================

/**
 * Ensure a game record exists in the database.
 * @param args - Game ID and source data
 */
export async function ensureGameRecord(args: {
  id: string;
  source: unknown;
}): Promise<void> {
  const { id, source } = args;

  await sql`
    INSERT INTO games (id, source)
    VALUES (${id}, ${JSON.stringify(source)}::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `;
}

/**
 * Get a user's complete game history, ordered by play date.
 * @param userId - User's UUID
 * @returns Array of game records
 */
export async function getUserGameHistory(userId: string): Promise<UserGameRow[]> {
  const { rows } = await sql<UserGameDbRow>`
    SELECT user_id, game_id, attempts, solved, accuracy, played_at, total_moves, average_retries, maia_level
    FROM user_games
    WHERE user_id = ${userId}
    ORDER BY played_at ASC;
  `;

  return rows.map(mapUserGameRow);
}

/**
 * Get the set of game IDs a user has already played.
 * @param userId - User's UUID
 * @returns Set of game IDs
 */
export async function getUserPlayedGameIds(userId: string): Promise<Set<string>> {
  const { rows } = await sql<{ game_id: string }>`
    SELECT game_id
    FROM user_games
    WHERE user_id = ${userId};
  `;

  return new Set(rows.map((row) => row.game_id));
}

/**
 * Record the result of a completed game.
 * @param params - Game result parameters
 */
export async function recordGameResult(params: RecordGameResultParams): Promise<void> {
  const { userId, gameId, attempts, solved, accuracy, totalMoves, averageRetries, maiaLevel } = params;

  await sql`
    INSERT INTO user_games (user_id, game_id, attempts, solved, accuracy, total_moves, average_retries, maia_level)
    VALUES (${userId}, ${gameId}, ${attempts}, ${solved}, ${accuracy}, ${totalMoves}, ${averageRetries}, ${maiaLevel})
  `;
}

// =============================================================================
// Session Operations
// =============================================================================

/**
 * Delete all sessions for a user.
 * Called before creating a new session to ensure single active session.
 * @param userId - User's UUID
 */
export async function deleteSessionsForUser(userId: string): Promise<void> {
  await sql`
    DELETE FROM sessions
    WHERE user_id = ${userId};
  `;
}

/**
 * Create a new game session.
 * @param params - Session creation parameters
 * @returns The created session record
 */
export async function createSessionRecord(params: CreateSessionParams): Promise<SessionRecord> {
  const {
    id,
    userId,
    gameId,
    fen,
    ply,
    flip,
    maiaLevel,
    status = "playing",
    currentAttempts = 0,
    attemptsHistory = [],
    moveHistory = [],
    scoreTotal = 0
  } = params;

  const { rows } = await sql<SessionDbRow>`
    INSERT INTO sessions (id, user_id, game_id, fen, ply, status, current_attempts, attempts_history, move_history, score_total, flip, maia_level)
    VALUES (${id}, ${userId}, ${gameId}, ${fen}, ${ply}, ${status}, ${currentAttempts}, ${JSON.stringify(attemptsHistory)}, ${JSON.stringify(moveHistory)}, ${scoreTotal}, ${flip}, ${maiaLevel})
    RETURNING id, user_id, game_id, fen, ply, status, current_attempts, attempts_history, move_history, score_total, flip, maia_level, created_at, updated_at;
  `;

  return mapSessionRow(rows[0]);
}

/**
 * Get a session by its ID.
 * @param id - Session UUID
 * @returns Session record or null if not found
 */
export async function getSessionRecord(id: string): Promise<SessionRecord | null> {
  const { rows } = await sql<SessionDbRow>`
    SELECT id, user_id, game_id, fen, ply, status, current_attempts, attempts_history, move_history, score_total, flip, maia_level, created_at, updated_at
    FROM sessions
    WHERE id = ${id}
    LIMIT 1;
  `;

  return rows[0] ? mapSessionRow(rows[0]) : null;
}

/**
 * Update a session's state.
 * @param params - Session update parameters
 * @returns The updated session record
 */
export async function updateSessionRecord(params: UpdateSessionParams): Promise<SessionRecord> {
  const { id, fen, ply, status, currentAttempts, attemptsHistory, moveHistory, scoreTotal } = params;

  const { rows } = await sql<SessionDbRow>`
    UPDATE sessions
    SET fen = ${fen},
        ply = ${ply},
        status = ${status},
        current_attempts = ${currentAttempts},
        attempts_history = ${JSON.stringify(attemptsHistory)},
        move_history = ${JSON.stringify(moveHistory)},
        score_total = ${scoreTotal},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, user_id, game_id, fen, ply, status, current_attempts, attempts_history, move_history, score_total, flip, maia_level, created_at, updated_at;
  `;

  return mapSessionRow(rows[0]);
}

/**
 * Update only the current attempts count for a session.
 * @param args - Session ID and new attempts count
 */
export async function updateSessionCurrentAttempts(args: {
  id: string;
  currentAttempts: number;
}): Promise<void> {
  const { id, currentAttempts } = args;
  await sql`
    UPDATE sessions
    SET current_attempts = ${currentAttempts},
        updated_at = NOW()
    WHERE id = ${id};
  `;
}

/**
 * Delete a session by its ID.
 * @param id - Session UUID
 */
export async function deleteSessionById(id: string): Promise<void> {
  await sql`
    DELETE FROM sessions
    WHERE id = ${id};
  `;
}

// =============================================================================
// Row Mappers
// =============================================================================

/**
 * Map a raw session database row to a SessionRecord.
 */
function mapSessionRow(row: SessionDbRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id,
    fen: row.fen,
    ply: row.ply,
    status: row.status as SessionRecord["status"],
    currentAttempts: row.current_attempts,
    attemptsHistory: Array.isArray(row.attempts_history)
      ? row.attempts_history.map((value: unknown) => Number(value))
      : [],
    moveHistory: Array.isArray(row.move_history) ? row.move_history : [],
    scoreTotal: typeof row.score_total === "string"
      ? Number(row.score_total)
      : Number(row.score_total ?? 0),
    flip: row.flip,
    maiaLevel: row.maia_level,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

/**
 * Map a raw user game database row to a UserGameRow.
 */
function mapUserGameRow(row: UserGameDbRow): UserGameRow {
  return {
    userId: row.user_id,
    gameId: row.game_id,
    attempts: row.attempts,
    solved: row.solved,
    accuracy: row.accuracy,
    playedAt: new Date(row.played_at),
    totalMoves: row.total_moves ?? 0,
    averageRetries: row.average_retries,
    maiaLevel: row.maia_level
  };
}
