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

export interface UserGameRow {
  userId: string;
  gameId: string;
  attempts: number;
  solved: boolean;
  accuracy: number | null;
  playedAt: Date;
}

interface UserGameDbRow {
  user_id: string;
  game_id: string;
  attempts: number;
  solved: boolean;
  accuracy: number | null;
  played_at: Date;
}

export async function getUserGameHistory(userId: string): Promise<UserGameRow[]> {
  const { rows } = await sql<UserGameDbRow>`
    SELECT user_id, game_id, attempts, solved, accuracy, played_at
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
    playedAt: new Date(row.played_at)
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
}): Promise<void> {
  const { userId, gameId, attempts, solved, accuracy } = args;

  await sql`
    INSERT INTO user_games (user_id, game_id, attempts, solved, accuracy)
    VALUES (${userId}, ${gameId}, ${attempts}, ${solved}, ${accuracy})
    ON CONFLICT (user_id, game_id)
    DO UPDATE SET attempts = EXCLUDED.attempts,
                  solved = EXCLUDED.solved,
                  accuracy = EXCLUDED.accuracy,
                  played_at = NOW();
  `;
}
