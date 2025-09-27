# Architecture Overview

## High-Level Flow

1. **Authentication**
   - Users sign in with Google via NextAuth.
   - Sessions are stored using JWTs (default NextAuth strategy) making the solution serverless-friendly.

2. **Game Retrieval**
   - A curated set of precomputed Leela vs Maia games lives in `data/games.json`.
   - The Next.js API picks the next unplayed game for the signed-in user.
   - Games are tracked in `user_games` to prevent duplicates until the pool resets.

3. **Gameplay Loop**
   - The client renders the current board via `react-chessboard` and handles move attempts with `chess.js`.
   - When the user submits the correct prediction (or exhausts attempts), the client posts results to `/api/games/complete`.

4. **Stats & Analytics**
   - Aggregate metrics (win rate over time, average attempts, total solves) are derived with SQL and served via `/api/stats/summary`.
   - Charts are rendered client-side using `react-chartjs-2`.

## Key Components

- `app/page.tsx` & `components/*` provide the responsive UI.
- `lib/auth.ts` defines NextAuth config and helper guards.
- `lib/db.ts` centralises Postgres access using `@vercel/postgres`.
- `lib/games.ts` exposes helpers for picking and parsing precomputed games.
- `app/api/**/*` exports route handlers for gameplay, completion, and stats.

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  image TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  source jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT REFERENCES games(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  solved BOOLEAN NOT NULL DEFAULT false,
  accuracy NUMERIC,
  played_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, game_id)
);
```

The `games.source` column stores the JSON payload for parity with `data/games.json`. Most read operations rely on the static JSON file to avoid cold-start queries and guarantee deterministic puzzles across deployments.

## Deployment Notes

- Configure the Vercel project root to `src/lcstudy`.
- Provide environment variables in the dashboard (see `.env.example`).
- Use the SQL above (also in `docs/db/migrations.sql`) to initialise the database.
- Upload your curated `data/games.json` file (the shipping sample contains a handful of games for development).
- Background jobs were intentionally removed; all interactions fit within serverless request limits.

## Mobile Responsiveness

Tailwind utility classes power a responsive layout. The board collapses beneath the stats column on narrow viewports, and key actions remain thumb-accessible. Charts compress gracefully with hidden legends at small breakpoints.
