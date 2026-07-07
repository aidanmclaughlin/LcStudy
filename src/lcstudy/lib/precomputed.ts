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
import zlib from "zlib";
import { Chess } from "chess.js";

// =============================================================================
// Types
// =============================================================================

/** LC0 evaluation for one legal move in the prompt position */
export interface MoveEvaluation {
  uci: string;
  san: string;
  /** Raw network policy prior, percent */
  policy: number;
  /** Partial credit 0-100. Blob v1: prior ratio; v2: Q-based win% loss curve */
  accuracy: number;
  best: boolean;
  /** Search visit share, percent (blob v2 only) */
  visits?: number;
  /** Search value Q in [-1, 1] from side to move (blob v2 only) */
  q?: number;
}

/** A single move in UCI and SAN notation */
export interface PrecomputedMove {
  uci: string;
  san: string;
  analysis?: MoveEvaluation[];
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
    maiaLevel?: number;
    maiaSearch?: string;
  };
  startingFen: string;
}

// =============================================================================
// State
// =============================================================================

/** Cached games (loaded once on first access) */
let cachedGames: PrecomputedGame[] | null = null;
let cachedGameIds: string[] | null = null;
const cachedGamesById = new Map<string, PrecomputedGame>();

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

function parseMaiaLevel(headers: Record<string, string | undefined | null>): number | undefined {
  const text = `${headers.White ?? ""} ${headers.Black ?? ""}`;
  const match = text.match(/Maia\s+(\d{3,4})/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * Decode compact LC0 analysis stored in PGN comments.
 */
function parseAnalysisComment(comment: string | undefined): MoveEvaluation[] | undefined {
  if (!comment) {
    return undefined;
  }

  const match = comment.match(/\[%lcstudy\s+([A-Za-z0-9_-]+)\]/);
  if (!match) {
    return undefined;
  }

  const raw = match[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw.padEnd(Math.ceil(raw.length / 4) * 4, "=");
  const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
    v?: number;
    moves?: Array<{
      u: string;
      s: string;
      p: number;
      a: number;
      n?: number;
      q?: number;
    }>;
    best?: string;
  };

  if ((payload.v !== 1 && payload.v !== 2) || !Array.isArray(payload.moves) || !payload.best) {
    throw new Error("Unsupported LC0 analysis comment");
  }

  return payload.moves.map((move) => ({
    uci: move.u.toLowerCase(),
    san: move.s,
    policy: Number(move.p),
    accuracy: Number(move.a),
    best: move.u.toLowerCase() === payload.best?.toLowerCase(),
    ...(move.n !== undefined ? { visits: Number(move.n) } : {}),
    ...(move.q !== undefined ? { q: Number(move.q) } : {})
  }));
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

  const games: PrecomputedGame[] = [];

  for (const id of loadPrecomputedGameIds()) {
    const game = getPrecomputedGameById(id);
    if (game) {
      games.push(game);
    }
  }

  cachedGames = games;
  return games;
}

/**
 * Load the cheap precomputed game index without parsing PGN contents.
 * @returns Sorted game IDs
 */
function loadPrecomputedGameIds(): string[] {
  if (cachedGameIds) {
    return cachedGameIds;
  }

  cachedGameIds = Array.from(
    new Set(
      fs
        .readdirSync(getPgnDir())
        .filter((file) => file.endsWith(".pgn") || file.endsWith(".pgn.gz"))
        .map((file) => file.replace(/\.pgn(\.gz)?$/i, ""))
    )
  ).sort();

  return cachedGameIds;
}

function getPgnDir(): string {
  return path.join(process.cwd(), "data", "pgn");
}

function getPgnPathForId(id: string): string | null {
  const ids = loadPrecomputedGameIds();
  if (!ids.includes(id)) {
    return null;
  }

  const gzPath = path.join(getPgnDir(), `${id}.pgn.gz`);
  if (fs.existsSync(gzPath)) {
    return gzPath;
  }
  return path.join(getPgnDir(), `${id}.pgn`);
}

/** Read a PGN file, transparently gunzipping .pgn.gz storage. */
function readPgnFile(filePath: string): string {
  if (filePath.endsWith(".gz")) {
    return zlib.gunzipSync(fs.readFileSync(filePath)).toString("utf8");
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Parse a single PGN file into a PrecomputedGame.
 * @param filePath - Full path to PGN file
 * @returns Parsed game or null on error
 */
function parsePgnFile(filePath: string): PrecomputedGame | null {
  try {
    const raw = readPgnFile(filePath);
    const chess = new Chess();
    chess.loadPgn(raw);

    const headers = chess.header() as Record<string, string | undefined | null>;
    const verboseMoves = chess.history({ verbose: true });
    const commentsByFen = new Map(
      chess.getComments().map(({ fen, comment }) => [fen, comment])
    );

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

    const replay = new Chess(startingChess.fen());
    const moves: PrecomputedMove[] = [];

    for (const move of verboseMoves) {
      const applied = replay.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion
      });

      if (!applied) {
        throw new Error(`Failed to replay move ${normalizeUci(move)}`);
      }

      moves.push({
        uci: normalizeUci(move),
        san: move.san,
        analysis: parseAnalysisComment(commentsByFen.get(replay.fen()))
      });
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

    const missingAnalysis = rounds.find((round) => !round.player.analysis?.length);
    if (missingAnalysis) {
      throw new Error(`Missing LC0 analysis for player move ${missingAnalysis.player.uci}`);
    }

    const fileName = path.basename(filePath);
    return {
      id: fileName.replace(/\.pgn(\.gz)?$/i, ""),
      moves,
      rounds,
      leelaColor,
      metadata: {
        event: normalizeHeader(headers.Event),
        white: normalizeHeader(headers.White),
        black: normalizeHeader(headers.Black),
        result: normalizeHeader(headers.Result),
        maiaLevel: parseMaiaLevel(headers),
        maiaSearch: normalizeHeader(headers.LcStudyMaiaSearch)
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
  const cached = cachedGamesById.get(id);
  if (cached) {
    return cached;
  }

  const pgnPath = getPgnPathForId(id);
  if (!pgnPath) {
    return undefined;
  }

  const game = parsePgnFile(pgnPath);
  if (!game) {
    return undefined;
  }

  cachedGamesById.set(id, game);
  return game;
}

/**
 * Pick a random game, preferring ones the user hasn't played.
 * @param excludedIds - Set of game IDs to exclude
 * @returns A precomputed game
 */
export function pickPrecomputedGame(excludedIds: Set<string>): PrecomputedGame {
  const ids = loadPrecomputedGameIds();
  const unplayed = ids.filter((id) => !excludedIds.has(id));

  // Use unplayed games if available, otherwise pick from all
  const pool = unplayed.length > 0 ? unplayed : ids;
  const game = pickParsableGameFromIds(pool) ?? pickParsableGameFromIds(ids);

  if (!game) {
    throw new Error("No precomputed games available");
  }

  return game;
}

function pickParsableGameFromIds(ids: string[]): PrecomputedGame | null {
  if (ids.length === 0) {
    return null;
  }

  const start = Math.floor(Math.random() * ids.length);

  for (let offset = 0; offset < ids.length; offset++) {
    const id = ids[(start + offset) % ids.length];
    const game = getPrecomputedGameById(id);
    if (game) {
      return game;
    }
  }

  return null;
}
