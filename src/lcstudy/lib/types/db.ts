/**
 * Database type definitions.
 * @module types/db
 */

// =============================================================================
// User Types
// =============================================================================

/** User record from the database */
export interface DbUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/** Raw user row from database query */
export interface DbUserRow extends DbUser {}

// =============================================================================
// Game Types
// =============================================================================

/** User's game history record */
export interface UserGameRow {
  userId: string;
  gameId: string;
  attempts: number;
  solved: boolean;
  accuracy: number | null;
  playedAt: Date;
  totalMoves: number;
  averageRetries: number | null;
  maiaLevel: number | null;
}

/** Raw game row from database query */
export interface UserGameDbRow {
  user_id: string;
  game_id: string;
  attempts: number;
  solved: boolean;
  accuracy: number | null;
  played_at: Date;
  total_moves: number | null;
  average_retries: number | null;
  maia_level: number | null;
}

/** Parameters for recording a game result */
export interface RecordGameResultParams {
  userId: string;
  gameId: string;
  attempts: number;
  solved: boolean;
  accuracy: number | null;
  totalMoves: number;
  averageRetries: number | null;
  maiaLevel: number | null;
}

// =============================================================================
// Session Types
// =============================================================================

/** Entry in the move history */
export interface MoveHistoryEntry {
  fen: string;
  san: string;
  isUserMove: boolean;
}

/** Session status */
export type SessionStatus = "playing" | "finished";

/** Session record from the database */
export interface SessionRecord {
  id: string;
  userId: string;
  gameId: string;
  fen: string;
  ply: number;
  status: SessionStatus;
  currentAttempts: number;
  attemptsHistory: number[];
  moveHistory: MoveHistoryEntry[];
  scoreTotal: number;
  flip: boolean;
  maiaLevel: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw session row from database query */
export interface SessionDbRow {
  id: string;
  user_id: string;
  game_id: string;
  fen: string;
  ply: number;
  status: string;
  current_attempts: number;
  attempts_history: unknown;
  move_history: unknown;
  score_total: string | number;
  flip: boolean;
  maia_level: number;
  created_at: Date;
  updated_at: Date;
}

/** Parameters for creating a session */
export interface CreateSessionParams {
  id: string;
  userId: string;
  gameId: string;
  fen: string;
  ply: number;
  flip: boolean;
  maiaLevel: number;
  status?: SessionStatus;
  currentAttempts?: number;
  attemptsHistory?: number[];
  moveHistory?: MoveHistoryEntry[];
  scoreTotal?: number;
}

/** Parameters for updating a session */
export interface UpdateSessionParams {
  id: string;
  fen: string;
  ply: number;
  status: SessionStatus;
  currentAttempts: number;
  attemptsHistory: number[];
  moveHistory: MoveHistoryEntry[];
  scoreTotal: number;
}
