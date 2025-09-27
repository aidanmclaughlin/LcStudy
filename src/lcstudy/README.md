# LcStudy (Vercel)

The classic LcStudy Leela-vs-Maia trainer now runs on Vercel. The UI, board animations, and flow match the original local app; the only change is that player progress, streaks, and averages are persisted in Postgres instead of local JSON files.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in:
   - `NEXTAUTH_SECRET` – generate with `openssl rand -base64 32`
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` – from your Google Cloud OAuth client
   - `DATABASE_URL` – pooled connection string from Neon/Vercel Postgres (SSL required)
3. Provision the schema:
   ```bash
   npm run db:migrate
   ```
4. (Optional) Drop additional Leela-vs-Maia PGNs into `data/pgn/`. They are parsed automatically on startup.
5. Start the dev server:
   ```bash
   npm run dev
   ```
6. Open `http://localhost:3000`, sign in with Google, and you’ll see the legacy interface with your stats loaded from Postgres.

## Deploying to Vercel

1. `vercel login` and `vercel link` inside `src/lcstudy` if you haven’t already.
2. In the Vercel dashboard, add the same environment variables (`NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, `NEXTAUTH_URL=https://<your-domain>`, `POSTGRES_URL=<same as DATABASE_URL>`).
3. Trigger `vercel --prod` or use the dashboard – build runs `npm run build`, which compiles the Next.js app and bundles the legacy assets.

## How It Works

- **Frontend**: The original static HTML/CSS/JS lives under `public/legacy/`. It mounts inside the Next.js page so the look & feel stays untouched.
- **Precomputed games**: PGNs from `data/pgn/*.pgn` are parsed at runtime (via `chess.js`) to build deterministic move lists. The player always steps through a full Leela vs Maia game.
- **Sessions**: Active sessions are stored in Postgres (`sessions` table) so serverless invocations can validate moves, handle retries, and track Maia replies exactly like the FastAPI version.
- **History & stats**: Completed games land in `user_games` with average retries, total moves, and Maia level. The legacy `/api/v1/game-history` and `/api/v1/stats` endpoints read from this table to feed the charts.
- **Auth**: NextAuth with Google keeps the experience gated per player. Session cookies are forwarded automatically to the legacy fetch calls.

## Useful Commands

```bash
npm run lint     # ESLint via next lint
npm run build    # Production build (requires env vars)
npm run dev      # Local dev server
npm run db:migrate  # Apply schema changes to the configured DATABASE_URL
```

## License

MIT
