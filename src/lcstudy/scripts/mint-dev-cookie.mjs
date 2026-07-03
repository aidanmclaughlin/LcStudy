/**
 * Mint a NextAuth session cookie for local testing.
 *
 * Creates (or reuses) a throwaway test user and prints a session token that
 * can be set as the `next-auth.session-token` cookie against localhost.
 * Mirrors the technique used by e2e-smoke.spec.js.
 *
 * Usage: node scripts/mint-dev-cookie.mjs [email]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encode } from 'next-auth/jwt';
import { sql } from '@vercel/postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    let value = trimmed.slice(index + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

async function main() {
  loadLocalEnv();

  const email = process.argv[2] || 'lcstudy-local-test@example.test';
  const { rows } = await sql`
    INSERT INTO users (email, name, image)
    VALUES (${email}, ${'Local Test'}, ${null})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, email, name;
  `;
  const user = rows[0];

  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET,
    token: { sub: user.id, userId: user.id, email: user.email, name: user.name }
  });

  console.log(JSON.stringify({ email: user.email, userId: user.id, token }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
