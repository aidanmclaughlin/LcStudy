import { sql as baseSql } from "@vercel/postgres";

export const sql = baseSql;

export interface DbUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

interface DbUserRow extends DbUser {}

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

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const { rows } = await sql<DbUserRow>`
    SELECT id, email, name, image
    FROM users
    WHERE email = ${email}
    LIMIT 1;
  `;
  return rows[0] ?? null;
}

export async function getUserById(id: string): Promise<DbUser | null> {
  const { rows } = await sql<DbUserRow>`
    SELECT id, email, name, image
    FROM users
    WHERE id = ${id}
    LIMIT 1;
  `;
  return rows[0] ?? null;
}

export async function ensureGameRecord(args: { id: string; source: unknown }): Promise<void> {
  const { id, source } = args;

  await sql`
    INSERT INTO games (id, source)
    VALUES (${id}, ${JSON.stringify(source)}::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `;
}

export interface UserGameRow {
  userId: string;
  gameId: string;
  attempts: number;
  solved: boolean;
  accuracy: number | null;
  playedAt: Date;
  totalMoves: number;
  averageRetries: number | null;
  maiaLevel: number | null;
}

interface UserGameDbRow {
  user_id: string;
  game_id: string;
  attempts: number;
  solved: boolean;
  accuracy: number | null;
  played_at: Date;
  total_moves: number | null;
  average_retries: number | null;
  maia_level: number | null;
}

export async function getUserGameHistory(userId: string): Promise<UserGameRow[]> {
  const { rows } = await sql<UserGameDbRow>`
    SELECT user_id, game_id, attempts, solved, accuracy, played_at, total_moves, average_retries, maia_level
    FROM user_games
    WHERE user_id = ${userId}
    ORDER BY played_at ASC;
  `;

  return rows.map((row) => ({
    userId: row.user_id,
    gameId: row.game_id,
    attempts: row.attempts,
    solved: row.solved,
    accuracy: row.accuracy,
    playedAt: new Date(row.played_at),
    totalMoves: row.total_moves ?? 0,
    averageRetries: row.average_retries,
    maiaLevel: row.maia_level
  }));
}

export async function getUserPlayedGameIds(userId: string): Promise<Set<string>> {
  const { rows } = await sql<{ game_id: string }>`
    SELECT game_id
    FROM user_games
    WHERE user_id = ${userId};
  `;

  return new Set(rows.map((row) => row.game_id));
}

export async function recordGameResult(args: {
  userId: string;
  gameId: string;
  attempts: number;
  solved: boolean;
  accuracy: number | null;
  totalMoves: number;
  averageRetries: number | null;
  maiaLevel: number | null;
}): Promise<void> {
  const { userId, gameId, attempts, solved, accuracy, totalMoves, averageRetries, maiaLevel } = args;

  await sql`
    INSERT INTO user_games (user_id, game_id, attempts, solved, accuracy, total_moves, average_retries, maia_level)
    VALUES (${userId}, ${gameId}, ${attempts}, ${solved}, ${accuracy}, ${totalMoves}, ${averageRetries}, ${maiaLevel})
    ON CONFLICT (user_id, game_id)
    DO UPDATE SET attempts = EXCLUDED.attempts,
                  solved = EXCLUDED.solved,
                  accuracy = EXCLUDED.accuracy,
                  total_moves = EXCLUDED.total_moves,
                  average_retries = EXCLUDED.average_retries,
                  maia_level = EXCLUDED.maia_level,
                  played_at = NOW();
  `;
}

export interface MoveHistoryEntry {
  fen: string;
  san: string;
  isUserMove: boolean;
}

export interface SessionRecord {
  id: string;
  userId: string;
  gameId: string;
  fen: string;
  ply: number;
  status: "playing" | "finished";
  currentAttempts: number;
  attemptsHistory: number[];
  moveHistory: MoveHistoryEntry[];
  scoreTotal: number;
  flip: boolean;
  maiaLevel: number;
  createdAt: Date;
  updatedAt: Date;
}

interface SessionDbRow {
  id: string;
  user_id: string;
  game_id: string;
  fen: string;
  ply: number;
  status: string;
  current_attempts: number;
  attempts_history: any;
  move_history: any;
  score_total: string | number;
  flip: boolean;
  maia_level: number;
  created_at: Date;
  updated_at: Date;
}

function mapSessionRow(row: SessionDbRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id,
    fen: row.fen,
    ply: row.ply,
    status: (row.status as SessionRecord["status"]),
    currentAttempts: row.current_attempts,
    attemptsHistory: Array.isArray(row.attempts_history) ? row.attempts_history.map((value: unknown) => Number(value)) : [],
    moveHistory: Array.isArray(row.move_history) ? row.move_history : [],
    scoreTotal: typeof row.score_total === "string" ? Number(row.score_total) : Number(row.score_total ?? 0),
    flip: row.flip,
    maiaLevel: row.maia_level,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await sql`
    DELETE FROM sessions
    WHERE user_id = ${userId};
  `;
}

export async function createSessionRecord(args: {
  id: string;
  userId: string;
  gameId: string;
  fen: string;
  ply: number;
  flip: boolean;
  maiaLevel: number;
  status?: "playing" | "finished";
  currentAttempts?: number;
  attemptsHistory?: number[];
  moveHistory?: MoveHistoryEntry[];
  scoreTotal?: number;
}): Promise<SessionRecord> {
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
  } = args;

  const { rows } = await sql<SessionDbRow>`
    INSERT INTO sessions (id, user_id, game_id, fen, ply, status, current_attempts, attempts_history, move_history, score_total, flip, maia_level)
    VALUES (${id}, ${userId}, ${gameId}, ${fen}, ${ply}, ${status}, ${currentAttempts}, ${JSON.stringify(attemptsHistory)}, ${JSON.stringify(moveHistory)}, ${scoreTotal}, ${flip}, ${maiaLevel})
    RETURNING id, user_id, game_id, fen, ply, status, current_attempts, attempts_history, move_history, score_total, flip, maia_level, created_at, updated_at;
  `;

  return mapSessionRow(rows[0]);
}

export async function getSessionRecord(id: string): Promise<SessionRecord | null> {
  const { rows } = await sql<SessionDbRow>`
    SELECT id, user_id, game_id, fen, ply, status, current_attempts, attempts_history, move_history, score_total, flip, maia_level, created_at, updated_at
    FROM sessions
    WHERE id = ${id}
    LIMIT 1;
  `;

  return rows[0] ? mapSessionRow(rows[0]) : null;
}

export async function updateSessionRecord(args: {
  id: string;
  fen: string;
  ply: number;
  status: "playing" | "finished";
  currentAttempts: number;
  attemptsHistory: number[];
  moveHistory: MoveHistoryEntry[];
  scoreTotal: number;
}): Promise<SessionRecord> {
  const { id, fen, ply, status, currentAttempts, attemptsHistory, moveHistory, scoreTotal } = args;

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

export async function deleteSessionById(id: string): Promise<void> {
  await sql`
    DELETE FROM sessions
    WHERE id = ${id};
  `;
}
