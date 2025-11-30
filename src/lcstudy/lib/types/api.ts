/**
 * API request and response type definitions.
 * @module types/api
 */

// =============================================================================
// Session API Types
// =============================================================================

/** Request body for creating a new game session */
export interface SessionCreateRequest {
  maia_level?: number;
  custom_fen?: string | null;
}

/** Response from creating a new game session */
export interface SessionCreateResponse {
  id: string;
  game_id: string;
  flip: boolean;
  fen: string;
  starting_fen: string;
  moves: Array<{ uci: string; san: string }>;
  ply: number;
  maia_level: number;
}

/** Request body for completing a game session */
export interface SessionCompleteRequest {
  total_attempts?: number;
  total_moves?: number;
  attempt_history?: number[];
  average_retries?: number;
  maia_level?: number;
  result?: string;
}

/** Response from completing a game session */
export interface SessionCompleteResponse {
  ok: boolean;
}

// =============================================================================
// Stats API Types
// =============================================================================

/** Timeline data point in stats response */
export interface StatsTimelinePoint {
  date: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgAttempts: number;
  cumulativeWinRate: number;
}

/** Attempts data point in stats response */
export interface StatsAttemptsPoint {
  label: string;
  attempts: number;
  solved: boolean;
}

/** Response from the stats endpoint */
export interface StatsResponse {
  totalGames: number;
  solvedGames: number;
  winRate: number;
  averageAttempts: number;
  currentStreak: number;
  timeline: StatsTimelinePoint[];
  attempts: StatsAttemptsPoint[];
}

// =============================================================================
// Game History API Types
// =============================================================================

/** Single game entry in history response */
export interface GameHistoryEntry {
  date: string;
  average_retries: number;
  total_moves: number;
  maia_level: number;
  result: "finished" | "incomplete";
}

/** Response from the game history endpoint */
export interface GameHistoryResponse {
  history: GameHistoryEntry[];
}

// =============================================================================
// Error Types
// =============================================================================

/** Standard API error response */
export interface ApiErrorResponse {
  error: string;
}
