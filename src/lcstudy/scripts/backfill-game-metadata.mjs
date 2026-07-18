/** Backfill immutable game metadata from the canonical local PGNs. */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { sql } from "@vercel/postgres";
import { Chess } from "chess.js";

const PGN_DIR = path.join(process.cwd(), "data", "pgn");
const BATCH_SIZE = 200;

if (typeof process.loadEnvFile === "function" && fs.existsSync(path.join(process.cwd(), ".env.local"))) {
  process.loadEnvFile(path.join(process.cwd(), ".env.local"));
}

function readPgn(gameId) {
  const gzipPath = path.join(PGN_DIR, `${gameId}.pgn.gz`);
  const plainPath = path.join(PGN_DIR, `${gameId}.pgn`);

  if (fs.existsSync(gzipPath)) {
    return zlib.gunzipSync(fs.readFileSync(gzipPath)).toString("utf8");
  }
  if (fs.existsSync(plainPath)) {
    return fs.readFileSync(plainPath, "utf8");
  }
  return null;
}

function normalize(value) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text || undefined;
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseMaiaLevel(headers) {
  const match = `${headers.White ?? ""} ${headers.Black ?? ""}`.match(/Maia\s+(\d{3,4})/i);
  return match ? Number(match[1]) : undefined;
}

function parseSource(gameId, pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.header();
  const white = String(headers.White ?? "").toLowerCase();
  const black = String(headers.Black ?? "").toLowerCase();
  const leelaColor = white.includes("player") || white.includes("leela")
    ? "w"
    : black.includes("player") || black.includes("leela")
      ? "b"
      : "w";
  const moves = chess.history({ verbose: true });

  return {
    id: gameId,
    precomputed: true,
    leelaColor,
    openingLine: moves.slice(0, 10).map((move) => move.san),
    startingFen: new Chess().fen(),
    metadata: {
      event: normalize(headers.Event),
      white: normalize(headers.White),
      black: normalize(headers.Black),
      result: normalize(headers.Result),
      maiaLevel: parseMaiaLevel(headers),
      maiaSearch: normalize(headers.LcStudyMaiaSearch),
      openingSource: normalize(headers.LcStudyOpeningSource),
      openingSpeed: normalize(headers.LcStudyOpeningSpeed),
      openingRatingGroup: normalize(headers.LcStudyOpeningRatingGroup),
      openingPlies: parseNumber(headers.LcStudyOpeningPlies)
    },
    totalMoves: moves.length
  };
}

async function updateBatch(entries) {
  if (entries.length === 0) return;
  await sql.query(
    `UPDATE games AS game
     SET source = game.source || updates.source
     FROM unnest($1::text[], $2::jsonb[]) AS updates(id, source)
     WHERE game.id = updates.id`,
    [
      entries.map((entry) => entry.id),
      entries.map((entry) => JSON.stringify(entry.source))
    ]
  );
}

async function main() {
  const { rows } = await sql.query(
    `SELECT DISTINCT game.id
     FROM games AS game
     JOIN user_games AS history ON history.game_id = game.id
     WHERE NOT (game.source ? 'leelaColor')
        OR NOT (game.source ? 'openingLine')
     ORDER BY game.id`
  );
  const entries = [];
  const missing = [];

  for (const row of rows) {
    const pgn = readPgn(row.id);
    if (!pgn) {
      missing.push(row.id);
      continue;
    }
    try {
      entries.push({ id: row.id, source: parseSource(row.id, pgn) });
    } catch (error) {
      console.warn(`Failed to parse ${row.id}: ${error.message}`);
    }
  }

  for (let index = 0; index < entries.length; index += BATCH_SIZE) {
    await updateBatch(entries.slice(index, index + BATCH_SIZE));
  }

  console.log(JSON.stringify({
    candidates: rows.length,
    updated: entries.length,
    missing: missing.length
  }));
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
