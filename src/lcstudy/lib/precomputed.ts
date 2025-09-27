import fs from "fs";
import path from "path";
import { Chess } from "chess.js";

export interface PrecomputedMove {
  uci: string;
  san: string;
}

export interface PrecomputedGame {
  id: string;
  moves: PrecomputedMove[];
  leelaColor: "w" | "b";
  metadata: {
    event?: string;
    white?: string;
    black?: string;
    result?: string;
  };
  startingFen: string;
}

let cachedGames: PrecomputedGame[] | null = null;

function normalizeHeader(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function determineLeelaColor(headers: Record<string, string | undefined | null>): "w" | "b" {
  const whiteHeader = String(headers.White ?? "").toLowerCase();
  const blackHeader = String(headers.Black ?? "").toLowerCase();
  if (whiteHeader.includes("player") || whiteHeader.includes("leela")) {
    return "w";
  }
  if (blackHeader.includes("player") || blackHeader.includes("leela")) {
    return "b";
  }
  // Fallback: assume Leela is white
  return "w";
}

function normalizeUci(move: { from: string; to: string; promotion?: string | undefined }): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase();
}

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
    const fullPath = path.join(pgnDir, file);
    const raw = fs.readFileSync(fullPath, "utf8");

    const chess = new Chess();
    chess.loadPgn(raw);

    const headers = chess.header() as Record<string, string | undefined | null>;
    const verboseMoves = chess.history({ verbose: true });
    const moves: PrecomputedMove[] = verboseMoves.map((move) => ({
      uci: normalizeUci(move),
      san: move.san
    }));

    const startingChess = new Chess();
    if (((headers.SetUp ?? "") === "1" || String(headers.SetUp ?? "").toLowerCase() === "true") && headers.FEN) {
      try {
        startingChess.load(headers.FEN);
      } catch (err) {
        // ignore malformed FEN and keep default starting position
      }
    }

    games.push({
      id: file.replace(/\.pgn$/i, ""),
      moves,
      leelaColor: determineLeelaColor(headers),
      metadata: {
        event: normalizeHeader(headers.Event),
        white: normalizeHeader(headers.White),
        black: normalizeHeader(headers.Black),
        result: normalizeHeader(headers.Result)
      },
      startingFen: startingChess.fen()
    });
  }

  cachedGames = games;
  return games;
}

export function getPrecomputedGameById(id: string): PrecomputedGame | undefined {
  return loadPrecomputedGames().find((game) => game.id === id);
}

export function pickPrecomputedGame(excluded: Set<string>): PrecomputedGame {
  const games = loadPrecomputedGames();
  const unplayed = games.filter((game) => !excluded.has(game.id));
  const pool = unplayed.length > 0 ? unplayed : games;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}
