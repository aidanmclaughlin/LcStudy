/**
 * Precompute per-game ease (predictability) into games.difficulty.
 *
 * Ease = mean over a game's Leela prompts of the policy-weighted accuracy
 * (same formula as positionEase in lib/coach.ts), computed straight from the
 * PGN analysis blobs. Run after regenerating or re-grading the corpus so
 * /api/v1/coach never parses PGNs on the request path.
 *
 * Usage: node scripts/precompute-difficulty.mjs
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { sql } from '@vercel/postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    let v = t.slice(i + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i)] ??= v;
  }
}

function decodeBlob(encoded) {
  const raw = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function positionEase(moves) {
  let policyTotal = 0;
  let weighted = 0;
  for (const m of moves) {
    const p = Number(m.p);
    const a = Number(m.a);
    if (!Number.isFinite(p) || !Number.isFinite(a) || p <= 0) continue;
    policyTotal += p;
    weighted += p * a;
  }
  return policyTotal > 0 ? weighted / policyTotal : null;
}

async function main() {
  loadLocalEnv();

  const pgnDir = path.join(__dirname, '..', 'data', 'pgn');
  const files = fs.readdirSync(pgnDir)
    .filter((f) => f.endsWith('.pgn') || f.endsWith('.pgn.gz'))
    .sort();

  const ids = [];
  const eases = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(pgnDir, file));
    const text = file.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    const blobs = [...text.matchAll(/\[%lcstudy\s+([A-Za-z0-9_-]+)\]/g)];
    const values = [];
    for (const match of blobs) {
      try {
        const payload = decodeBlob(match[1]);
        const ease = positionEase(payload.moves ?? []);
        if (ease !== null) values.push(ease);
      } catch {
        // skip malformed blob
      }
    }
    if (values.length === 0) continue;
    ids.push(file.replace(/\.pgn(\.gz)?$/i, ''));
    eases.push(values.reduce((a, b) => a + b, 0) / values.length);
  }

  console.log(`computed ease for ${ids.length}/${files.length} games; upserting...`);

  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const idChunk = ids.slice(i, i + BATCH);
    const easeChunk = eases.slice(i, i + BATCH);
    await sql.query(
      `INSERT INTO games (id, source, difficulty)
       SELECT id, '{"precomputed":true}'::jsonb, difficulty
       FROM unnest($1::text[], $2::numeric[]) AS t(id, difficulty)
       ON CONFLICT (id) DO UPDATE SET difficulty = EXCLUDED.difficulty`,
      [idChunk, easeChunk]
    );
    console.log(`  upserted ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
  }

  console.log('done');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
