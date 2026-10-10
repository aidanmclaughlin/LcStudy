/**
 * Rescore saved games on the first try at each move.
 *
 * Games saved while every try counted stored the mean over all tries in
 * average_accuracy (and accuracy). accuracy_history always held the first try
 * at each move, so the game's first-try accuracy is its mean (a JSON null
 * reads as 0, as in the app). Only games with retries (attempts > total_moves)
 * can differ. Safe to rerun.
 *
 * Usage: node scripts/backfill-first-try-accuracy.mjs [--apply]
 * Without --apply it only lists what would change.
 */

import fs from "node:fs";
import path from "node:path";

import { sql } from "@vercel/postgres";

if (typeof process.loadEnvFile === "function" && fs.existsSync(path.join(process.cwd(), ".env.local"))) {
  process.loadEnvFile(path.join(process.cwd(), ".env.local"));
}

const apply = process.argv.includes("--apply");

const { rows } = await sql`
  SELECT id, played_at, attempts, total_moves, average_accuracy,
         (SELECT AVG(COALESCE(value::numeric, 0)) FROM jsonb_array_elements_text(accuracy_history)) AS first_try
  FROM user_games
  WHERE attempts > total_moves
    AND jsonb_typeof(accuracy_history) = 'array'
    AND jsonb_array_length(accuracy_history) > 0
  ORDER BY played_at;
`;

const changes = rows.filter((row) => Math.abs(Number(row.average_accuracy) - Number(row.first_try)) > 1e-9);
for (const row of changes) {
  console.log(
    `${row.played_at.toISOString()}  ${Number(row.average_accuracy).toFixed(1)} -> ${Number(row.first_try).toFixed(1)}`
    + `  (${row.attempts} tries, ${row.total_moves} moves)`
  );
}
console.log(`${changes.length} of ${rows.length} games with retries ${apply ? "rescored" : "would be rescored (pass --apply)"}`);

if (apply && changes.length > 0) {
  await sql`
    UPDATE user_games
    SET average_accuracy = first_try.value,
        accuracy = first_try.value
    FROM (
      SELECT id, (SELECT AVG(COALESCE(value::numeric, 0)) FROM jsonb_array_elements_text(accuracy_history)) AS value
      FROM user_games
      WHERE attempts > total_moves
        AND jsonb_typeof(accuracy_history) = 'array'
        AND jsonb_array_length(accuracy_history) > 0
    ) AS first_try
    WHERE user_games.id = first_try.id
      AND user_games.average_accuracy IS DISTINCT FROM first_try.value;
  `;
}
