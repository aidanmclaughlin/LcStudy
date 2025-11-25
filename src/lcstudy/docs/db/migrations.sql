-- Create extension (if not already installed)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  image TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  source JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  solved BOOLEAN NOT NULL DEFAULT FALSE,
  accuracy NUMERIC,
  played_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_games_user ON user_games(user_id);
CREATE INDEX IF NOT EXISTS idx_user_games_game ON user_games(game_id);

ALTER TABLE user_games DROP CONSTRAINT IF EXISTS user_games_user_id_game_id_key;
CREATE INDEX IF NOT EXISTS idx_user_games_user_played_at ON user_games(user_id, played_at);

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

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

ALTER TABLE user_games ADD COLUMN IF NOT EXISTS total_moves INTEGER DEFAULT 0;
ALTER TABLE user_games ADD COLUMN IF NOT EXISTS average_retries NUMERIC;
ALTER TABLE user_games ADD COLUMN IF NOT EXISTS maia_level INTEGER DEFAULT 1500;
