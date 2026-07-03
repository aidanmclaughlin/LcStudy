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
  /** Game to avoid picking (the client's current in-progress game) */
  exclude_game_id?: string | null;
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
  duration_ms?: number | null;
  think_time_ms?: number | null;
  move_times_ms?: number[] | null;
  suggested_think_ms?: number | null;
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
  duration_ms: number | null;
  think_time_ms: number | null;
  suggested_think_ms: number | null;
  result: "finished" | "incomplete";
}

// =============================================================================
// Coach API Types
// =============================================================================

/** Per-bin posterior summary in the coach response */
export interface CoachBinSummary {
  minutes: number;
  games: number;
  hours: number;
  rate_mean: number;
  rate_sd: number;
  p_best: number;
}

/** Response from the think-time coach endpoint */
export interface CoachResponse {
  suggested_think_ms: number;
  per_move_ms: number;
  status: "exploring" | "learning" | "confident";
  note: string;
  n_games: number;
  beta: number;
  bins: CoachBinSummary[];
  skill_series: number[];
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
