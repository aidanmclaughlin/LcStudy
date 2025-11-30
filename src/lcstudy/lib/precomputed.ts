/**
 * Precomputed game loading and selection.
 *
 * Games are stored as PGN files in data/pgn/ and loaded on server startup.
 * Each game contains moves analyzed by Leela Chess Zero.
 *
 * @module precomputed
 */

import fs from "fs";
import path from "path";
import { Chess } from "chess.js";

// =============================================================================
// Types
// =============================================================================

/** A single move in UCI and SAN notation */
export interface PrecomputedMove {
  uci: string;
  san: string;
}

/** A round of play (player move + optional reply) */
export interface PrecomputedRound {
  player: PrecomputedMove;
  reply?: PrecomputedMove;
}

/** A complete precomputed game */
export interface PrecomputedGame {
  id: string;
  moves: PrecomputedMove[];
  rounds: PrecomputedRound[];
  leelaColor: "w" | "b";
  metadata: {
    event?: string;
    white?: string;
    black?: string;
    result?: string;
  };
  startingFen: string;
}

// =============================================================================
// State
// =============================================================================

/** Cached games (loaded once on first access) */
let cachedGames: PrecomputedGame[] | null = null;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize a PGN header value.
 * @param value - Raw header value
 * @returns Trimmed string or undefined
 */
function normalizeHeader(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Determine which color Leela/player is playing.
 * Looks for "player" or "leela" in the White/Black headers.
 * @param headers - PGN headers
 * @returns Player color ('w' or 'b')
 */
function determineLeelaColor(
  headers: Record<string, string | undefined | null>
): "w" | "b" {
  const whiteHeader = String(headers.White ?? "").toLowerCase();
  const blackHeader = String(headers.Black ?? "").toLowerCase();

  if (whiteHeader.includes("player") || whiteHeader.includes("leela")) {
    return "w";
  }
  if (blackHeader.includes("player") || blackHeader.includes("leela")) {
    return "b";
  }

  // Default to white if no indicator found
  return "w";
}

/**
 * Convert a chess.js move to UCI notation.
 * @param move - Chess.js verbose move
 * @returns UCI string (e.g., "e2e4", "e7e8q")
 */
function normalizeUci(move: {
  from: string;
  to: string;
  promotion?: string | undefined;
}): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase();
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Load all precomputed games from the PGN directory.
 * Results are cached after first call.
 * @returns Array of precomputed games
 */
export function loadPrecomputedGames(): PrecomputedGame[] {
  if (cachedGames) {
    return cachedGames;
  }

  const pgnDir = path.join(process.cwd(), "data", "pgn");
  const files = fs
    .readdirSync(pgnDir)
    .filter((file) => file.endsWith(".pgn"))
    .sort();

  const games: PrecomputedGame[] = [];

  for (const file of files) {
    const game = parsePgnFile(path.join(pgnDir, file));
    if (game) {
      games.push(game);
    }
  }

  cachedGames = games;
  return games;
}

/**
 * Parse a single PGN file into a PrecomputedGame.
 * @param filePath - Full path to PGN file
 * @returns Parsed game or null on error
 */
function parsePgnFile(filePath: string): PrecomputedGame | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const chess = new Chess();
    chess.loadPgn(raw);

    const headers = chess.header() as Record<string, string | undefined | null>;
    const verboseMoves = chess.history({ verbose: true });

    // Extract moves
    const moves: PrecomputedMove[] = verboseMoves.map((move) => ({
      uci: normalizeUci(move),
      san: move.san
    }));

    // Determine starting position
    const startingChess = new Chess();
    const hasSetup =
      (headers.SetUp ?? "") === "1" ||
      String(headers.SetUp ?? "").toLowerCase() === "true";

    if (hasSetup && headers.FEN) {
      try {
        startingChess.load(headers.FEN);
      } catch {
        // Keep default starting position on malformed FEN
      }
    }

    // Build rounds (player move + opponent reply pairs)
    const leelaColor = determineLeelaColor(headers);
    const playerIsWhite = leelaColor === "w";
    const rounds: PrecomputedRound[] = [];

    for (let idx = 0; idx < moves.length; idx++) {
      const isPlayerMove = playerIsWhite ? idx % 2 === 0 : idx % 2 === 1;
      if (!isPlayerMove) continue;

      rounds.push({
        player: moves[idx],
        reply: moves[idx + 1]
      });
    }

    const fileName = path.basename(filePath);
    return {
      id: fileName.replace(/\.pgn$/i, ""),
      moves,
      rounds,
      leelaColor,
      metadata: {
        event: normalizeHeader(headers.Event),
        white: normalizeHeader(headers.White),
        black: normalizeHeader(headers.Black),
        result: normalizeHeader(headers.Result)
      },
      startingFen: startingChess.fen()
    };
  } catch (error) {
    console.error(`Failed to parse PGN file: ${filePath}`, error);
    return null;
  }
}

/**
 * Get a precomputed game by its ID.
 * @param id - Game ID (filename without .pgn)
 * @returns Game or undefined if not found
 */
export function getPrecomputedGameById(id: string): PrecomputedGame | undefined {
  return loadPrecomputedGames().find((game) => game.id === id);
}

/**
 * Pick a random game, preferring ones the user hasn't played.
 * @param excludedIds - Set of game IDs to exclude
 * @returns A precomputed game
 */
export function pickPrecomputedGame(excludedIds: Set<string>): PrecomputedGame {
  const games = loadPrecomputedGames();
  const unplayed = games.filter((game) => !excludedIds.has(game.id));

  // Use unplayed games if available, otherwise pick from all
  const pool = unplayed.length > 0 ? unplayed : games;
  const index = Math.floor(Math.random() * pool.length);

  return pool[index];
}
