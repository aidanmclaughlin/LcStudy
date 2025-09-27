import gamesRaw from "@/data/games.json";
import { sql } from "@/lib/db";

export interface GameDefinition {
  id: string;
  white: string;
  black: string;
  event: string;
  eco: string;
  result: string;
  startingFen: string;
  sideToMove: "w" | "b";
  bestMoveSan: string;
  bestMoveUci: string;
  context: string[];
  description: string;
}

const GAMES: GameDefinition[] = gamesRaw as GameDefinition[];

let seeded = false;

export function getAllGames(): GameDefinition[] {
  return GAMES;
}

export async function ensureGamesSeeded(): Promise<void> {
  if (seeded) return;

  for (const game of GAMES) {
    await sql`
      INSERT INTO games (id, source)
      VALUES (${game.id}, ${JSON.stringify(game)})
      ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source;
    `;
  }

  seeded = true;
}

export function pickNextGame(excludedIds: Set<string>): GameDefinition {
  const available = GAMES.filter((game) => !excludedIds.has(game.id));
  const pool = available.length > 0 ? available : GAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}
