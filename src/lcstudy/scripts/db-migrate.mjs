import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from '@vercel/postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  const filePath = path.join(__dirname, '..', 'docs', 'db', 'migrations.sql');
  const raw = fs.readFileSync(filePath, 'utf8');
  const statements = raw
    .split(/;\s*(?:\r?\n|$)/)
    .map((stmt) => stmt.trim())
    .filter(Boolean);

  for (const statement of statements) {
    console.log(`Running: ${statement.slice(0, 60)}...`);
    if (typeof sql.unsafe === 'function') {
      await sql.unsafe(statement);
    } else if (sql.raw) {
      await sql`${sql.raw(statement)}`;
    } else {
      throw new Error('sql.unsafe is not available and sql.raw fallback failed.');
    }
  }

  console.log('Database migrations completed.');
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
