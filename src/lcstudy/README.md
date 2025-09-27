# LcStudy Vercel Edition

A Next.js rewrite of the LcStudy training tool designed for frictionless deployment on Vercel.

## Getting Started

1. Install dependencies and bootstrap Tailwind/Next.js:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and provide real credentials:
   - `NEXTAUTH_SECRET`: generate with `openssl rand -base64 32`
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: from Google Cloud console OAuth credentials
   - `DATABASE_URL`: Vercel Postgres connection string (or any Postgres-compatible URL)
3. Prepare the database tables:
   ```bash
   npm run db:migrate
   ```
   _See `docs/ARCHITECTURE.md` for schema details and SQL helpers._
4. (Optional) Update `data/games.json` with additional precomputed puzzles. New entries are upserted into Postgres on demand.
5. Run the development server:
   ```bash
   npm run dev
   ```
6. Open `http://localhost:3000` in your browser.

## Deploying To Vercel

- Set the project root in Vercel to `src/lcstudy`.
- Configure Environment Variables in the Vercel dashboard: `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`.
- Provision Vercel Postgres (or point to any managed Postgres) and run the SQL in `docs/db/migrations.sql`.
- Trigger a deploy; Vercel will run `npm install` followed by `npm run build` automatically.

## Tooling

This project uses:
- Next.js App Router (React Server Components)
- Tailwind CSS for layout and responsive design
- NextAuth (Google provider) for authentication
- `@vercel/postgres` for serverless SQL queries
- Chart.js + React wrappers for performance graphs
- `react-chessboard` + `chess.js` for board mechanics

## License

MIT
