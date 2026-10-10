/**
 * What a finished (or abandoned) game records, derived from the client's payload.
 *
 * A game's accuracy is the mean of the first try at each move. It is derived
 * here rather than taken from the client, so a tab still running an older
 * deploy (which sent the mean over every try) can't log anything else.
 *
 * @module game-result
 */

/** One logged try: the move (UCI) and its accuracy */
export type LoggedTry = [string, number];

export interface GameResultInput {
  /** First try at each move */
  accuracyHistory: unknown;
  /** Tries across all moves, retries included */
  attempts?: unknown;
  /** The moves tried at each move, in order (see triesHistory below) */
  triesHistory?: unknown;
}

export interface GameResult {
  accuracyHistory: number[];
  totalMoves: number;
  attempts: number;
  averageRetries: number | null;
  averageAccuracy: number | null;
  /** Null when the client sent none, or one that doesn't match accuracyHistory */
  triesHistory: LoggedTry[][] | null;
}

/**
 * @throws Error if accuracyHistory isn't a list of scores between 0 and 100
 */
export function buildGameResult(input: GameResultInput): GameResult {
  const accuracyHistory = parseAccuracyHistory(input.accuracyHistory);
  const totalMoves = accuracyHistory.length;
  const triesHistory = parseTriesHistory(input.triesHistory, accuracyHistory);
  const loggedTries = triesHistory?.reduce((sum, tries) => sum + tries.length, 0) ?? 0;

  // Every move takes at least one try, and every logged try was a try.
  const reported = Number.isInteger(input.attempts) ? input.attempts as number : 0;
  const attempts = Math.max(reported, totalMoves, loggedTries);

  return {
    accuracyHistory,
    totalMoves,
    attempts,
    averageRetries: totalMoves > 0 ? (attempts - totalMoves) / totalMoves : null,
    averageAccuracy: totalMoves > 0
      ? accuracyHistory.reduce((sum, value) => sum + value, 0) / totalMoves
      : null,
    triesHistory
  };
}

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function parseAccuracyHistory(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isScore)) {
    throw new Error("Invalid accuracy history");
  }
  return value;
}

/**
 * The moves tried at each move, as [uci, accuracy] pairs in order: one list
 * per move, each starting with that move's first try. Kept only if it is
 * consistent with accuracyHistory; it is logged, never scored.
 */
function parseTriesHistory(value: unknown, accuracyHistory: number[]): LoggedTry[][] | null {
  if (!Array.isArray(value) || value.length !== accuracyHistory.length) return null;
  const valid = value.every((tries, move) =>
    Array.isArray(tries)
    && tries.length > 0
    && tries.every((entry) => Array.isArray(entry) && entry.length === 2
      && typeof entry[0] === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(entry[0])
      && isScore(entry[1]))
    && tries[0][1] === accuracyHistory[move]);
  return valid ? value as LoggedTry[][] : null;
}
