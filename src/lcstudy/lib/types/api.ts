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
  moves: Array<{
    uci: string;
    san: string;
    analysis?: Array<{
      uci: string;
      san: string;
      policy: number;
      accuracy: number;
      best: boolean;
    }>;
  }>;
  ply: number;
  maia_level: number;
}

/** Request body for completing a game session */
export interface SessionCompleteRequest {
  total_moves?: number;
  average_accuracy?: number;
  accuracy_history?: number[];
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
  avgAccuracy: number;
  cumulativeAccuracy: number;
}

/** Accuracy data point in stats response */
export interface StatsAccuracyPoint {
  label: string;
  accuracy: number;
  solved: boolean;
}

/** Response from the stats endpoint */
export interface StatsResponse {
  totalGames: number;
  solvedGames: number;
  winRate: number;
  averageAccuracy: number;
  currentStreak: number;
  timeline: StatsTimelinePoint[];
  accuracy: StatsAccuracyPoint[];
}

// =============================================================================
// Game History API Types
// =============================================================================

/** Single game entry in history response */
export interface GameHistoryEntry {
  date: string;
  average_accuracy: number;
  total_moves: number;
  accuracy_history: number[];
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
