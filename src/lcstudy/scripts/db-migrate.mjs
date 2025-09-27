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

  const client = await sql.connect();
  try {
    for (const statement of statements) {
      console.log(`Running: ${statement.slice(0, 60)}...`);
      await client.query(statement);
    }
  } finally {
    await client.end();
  }

  console.log('Database migrations completed.');
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
