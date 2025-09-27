# Architecture Overview

## High-Level Flow

1. **Authentication**
   - Google Sign-In via NextAuth (JWT strategy) protects all gameplay APIs.
   - The Next.js layout simply mounts the legacy HTML once the session is valid.

2. **Precomputed Game Store**
   - Original Leela vs Maia PGNs live under `data/pgn/*.pgn` (same files that shipped with the CLI version).
   - On first access the server parses them with `chess.js`, recording SAN + UCI move lists and Leela’s colour.
   - `pickPrecomputedGame()` avoids repeats by consulting the `user_games` table; it falls back to the full set once a player exhausts the pool.

3. **Session Lifecycle**
   - `/api/v1/session/new` creates a row in `sessions`, storing the live FEN, ply index, attempts, and SAN history. Sessions survive across serverless invocations.
   - `/api/v1/session/{id}/check-move` validates legality (and promotions) against the stored FEN.
   - `/api/v1/session/{id}/predict` compares the submitted UCI to the precomputed move. On success it advances the board, auto-plays Maia’s reply, logs attempts, and, when the game ends, records aggregates in `user_games`.
   - Legacy JS polls `/api/v1/session/{id}/state` for fresh FEN/turn data to keep the board, PGN display, and charts in sync.

4. **History & Stats**
   - `/api/v1/game-history` returns the legacy payload (`average_retries`, `total_moves`, `maia_level`, etc.) straight from `user_games`.
   - `/api/v1/stats` reuses the same data for win-rate streak charts (compatible with the old JSON storage).

## Key Modules

- `public/legacy/` – the untouched HTML/CSS/JS from the FastAPI app (confetti, streak pill, keyboard nav, etc.).
- `lib/precomputed.ts` – PGN loader + in-memory cache.
- `lib/sessions.ts` – session/state machine logic ported from the Python `GameService`.
- `lib/db.ts` – Postgres helpers for users, sessions, and aggregated history.
- `app/api/v1/**` – Next.js route handlers mirroring the original `/api/v1` endpoints.

## Database Notes

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  fen TEXT NOT NULL,
  ply INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'playing',
  current_attempts INTEGER NOT NULL DEFAULT 0,
  attempts_history JSONB NOT NULL DEFAULT '[]',
  move_history JSONB NOT NULL DEFAULT '[]',
  score_total NUMERIC NOT NULL DEFAULT 0,
  flip BOOLEAN NOT NULL DEFAULT FALSE,
  maia_level INTEGER NOT NULL DEFAULT 1500,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_games
  ADD COLUMN IF NOT EXISTS total_moves INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_retries NUMERIC,
  ADD COLUMN IF NOT EXISTS maia_level INTEGER DEFAULT 1500;
```

- `sessions` holds the live board state and attempt counters between requests.
- `user_games` now stores the same fields the legacy JSON used (average retries per Leela move, total moves, Maia level) so historical charts render unchanged.

## Deployment

- Project root: `src/lcstudy`.
- Required env vars: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, `POSTGRES_URL`.
- Games are read from the bundle at runtime, so deployments stay deterministic—just commit PGNs into `data/pgn`.

## Frontend Behaviour

The DOM structure, CSS, sound effects, keyboard review controls, confetti bursts, and streak pill are identical to commit `14318a497430e581c0e809175b0797fe870a52d7`. The only difference is that stats persist via Postgres, and the API layer is powered by Next.js instead of FastAPI.
