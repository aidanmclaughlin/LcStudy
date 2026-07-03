/**
 * Think-time coach.
 *
 * Estimates which per-game think-time budget maximizes accuracy improvement
 * per hour of practice, and Thompson-samples a suggested budget so the
 * schedule keeps exploring while the posteriors are wide.
 *
 * Model (game-level, no per-move analysis):
 *   1. Difficulty adjustment: each game gets an "ease" score — the expected
 *      accuracy of sampling Leela's own policy in that game's positions —
 *      computed from the PGN analysis blobs. Games full of forced moves grade
 *      easier; we subtract the centered ease so accuracy is comparable
 *      across games.
 *   2. Tempo effect (performance, not learning): thinking longer in a game
 *      raises measured accuracy at fixed skill. Estimated as beta points per
 *      doubling of ms/move via first differences of consecutive games, which
 *      cancels the slow-moving skill component.
 *   3. Tempo-adjusted skill series: s_i = adjustedAccuracy_i - beta * (log2
 *      tempo_i - log2 refTempo). This is "accuracy at the reference tempo".
 *   4. Learning rates: consecutive-game skill increments y = s_{i+1} - s_i are
 *      regressed on the hours of game i, one coefficient per think-time bin,
 *      with a conjugate normal prior. Posterior rate_b = accuracy points per
 *      hour of practice at budget b.
 *   5. Suggestion: Thompson sample each bin's posterior, recommend the argmax.
 *      With little data the posteriors overlap and the suggestion is close to
 *      uniform exploration; it concentrates as evidence accumulates.
 *
 * @module coach
 */

// =============================================================================
// Types
// =============================================================================

/** One game's inputs to the model, in chronological order */
export interface CoachGameInput {
  /** Total think time in ms (falls back to wall-clock duration for old games) */
  thinkMs: number;
  /** Number of scored player moves */
  moves: number;
  /** Mean move accuracy, 0-100 */
  accuracy: number;
  /** Expected policy-sampler accuracy for this game's positions (0-100), if known */
  ease: number | null;
}

/** Posterior summary for one think-time bin */
export interface CoachBin {
  /** Budget this bin represents, in minutes of think time per game */
  minutes: number;
  /** Games observed in this bin */
  games: number;
  /** Practice hours observed in this bin */
  hours: number;
  /** Posterior mean learning rate, accuracy points per hour */
  rateMean: number;
  /** Posterior standard deviation of the learning rate */
  rateSd: number;
  /** Monte-Carlo probability this bin has the highest learning rate */
  pBest: number;
}

/** Coach recommendation payload */
export interface CoachSuggestion {
  /** Suggested think budget for the next game, in ms */
  suggestedThinkMs: number;
  /** Suggested pace in ms per move, based on the median game length */
  perMoveMs: number;
  /** How settled the model is */
  status: "exploring" | "learning" | "confident";
  /** Human-readable one-liner for the UI */
  note: string;
  /** Per-bin posterior summaries */
  bins: CoachBin[];
  /** Number of games the model was fit on */
  nGames: number;
  /** Estimated accuracy points per doubling of think time (performance effect) */
  beta: number;
  /** Tempo-adjusted skill series (accuracy at reference tempo), for charts */
  skillSeries: number[];
}

// =============================================================================
// Constants
// =============================================================================

/** Think-budget bins, minutes per game. Log-spaced to probe the range. */
export const BIN_MINUTES = [4, 8, 15, 30];

/** Minimum scored moves for a game to inform the model */
const MIN_MOVES = 5;

/** Minimum games before the posteriors mean anything at all */
const MIN_GAMES_FOR_MODEL = 8;

/** Difficulty adjustment weight (1 = subtract centered ease one-for-one) */
const GAMMA = 1;

/** Ridge (in log2-tempo units) stabilizing the beta estimate */
const BETA_RIDGE = 4;

/** Bounds for the tempo effect: 0..15 accuracy points per doubling */
const BETA_MAX = 15;

/** Bounds for the pooled prior learning rate, points per hour */
const PRIOR_RATE_MAX = 3;

/** Monte-Carlo samples for pBest */
const MC_SAMPLES = 400;

// =============================================================================
// Small numeric helpers
// =============================================================================

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Robust scale estimate: median absolute deviation scaled to sigma */
function madSigma(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations) * 1.4826;
}

/** Standard normal sample (Box-Muller) */
function randNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Index of the bin whose target is nearest in log space */
export function nearestBinIndex(thinkMs: number): number {
  const minutes = thinkMs / 60000;
  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < BIN_MINUTES.length; i++) {
    const distance = Math.abs(Math.log(Math.max(minutes, 0.25)) - Math.log(BIN_MINUTES[i]));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// =============================================================================
// Difficulty (ease) from PGN analysis
// =============================================================================

/**
 * Expected accuracy of sampling Leela's own policy in one position.
 * High = predictable position (policy mass concentrated on well-scoring moves).
 * @param analysis - Per-move policy/accuracy entries for the position
 */
export function positionEase(
  analysis: Array<{ policy: number; accuracy: number }>
): number | null {
  let policyTotal = 0;
  let weighted = 0;

  for (const entry of analysis) {
    const p = Number(entry.policy);
    const a = Number(entry.accuracy);
    if (!Number.isFinite(p) || !Number.isFinite(a) || p <= 0) continue;
    policyTotal += p;
    weighted += p * a;
  }

  return policyTotal > 0 ? weighted / policyTotal : null;
}

/**
 * Mean position ease across a game's player moves (0-100).
 * @param rounds - The game's player-move analysis lists
 */
export function gameEase(
  rounds: Array<{ analysis?: Array<{ policy: number; accuracy: number }> }>
): number | null {
  const values: number[] = [];

  for (const round of rounds) {
    if (!round.analysis?.length) continue;
    const ease = positionEase(round.analysis);
    if (ease !== null) values.push(ease);
  }

  return values.length > 0 ? mean(values) : null;
}

// =============================================================================
// Model fit
// =============================================================================

/**
 * Fit the coach model and Thompson-sample a suggestion.
 * @param games - Chronological game inputs (already filtered to valid rows)
 */
export function fitCoach(games: CoachGameInput[]): CoachSuggestion {
  const usable = games.filter(
    (g) =>
      Number.isFinite(g.thinkMs) &&
      g.thinkMs > 1000 &&
      g.moves >= MIN_MOVES &&
      Number.isFinite(g.accuracy)
  );

  const medianMoves = median(usable.map((g) => g.moves)) || 35;

  if (usable.length < MIN_GAMES_FOR_MODEL) {
    return exploratorySuggestion(usable, medianMoves);
  }

  // --- 1. Difficulty adjustment -------------------------------------------
  const eases = usable.map((g) => g.ease).filter((e): e is number => e !== null);
  const easeCenter = eases.length > 0 ? mean(eases) : 0;
  const adjusted = usable.map((g) =>
    g.ease !== null ? g.accuracy - GAMMA * (g.ease - easeCenter) : g.accuracy
  );

  // --- 2. Tempo (performance) effect via first differences ----------------
  const logTempo = usable.map((g) => Math.log2(g.thinkMs / g.moves));
  let diffNumerator = 0;
  let diffDenominator = BETA_RIDGE;

  for (let i = 1; i < usable.length; i++) {
    const dA = adjusted[i] - adjusted[i - 1];
    const dT = logTempo[i] - logTempo[i - 1];
    diffNumerator += dA * dT;
    diffDenominator += dT * dT;
  }

  const beta = clamp(diffNumerator / diffDenominator, 0, BETA_MAX);

  // --- 3. Tempo-adjusted skill series --------------------------------------
  const refLogTempo = median(logTempo);
  const skill = usable.map((_, i) => adjusted[i] - beta * (logTempo[i] - refLogTempo));

  // --- 4. Per-bin learning-rate posteriors ---------------------------------
  const increments: Array<{ y: number; hours: number; bin: number }> = [];
  for (let i = 0; i + 1 < usable.length; i++) {
    increments.push({
      y: skill[i + 1] - skill[i],
      hours: usable[i].thinkMs / 3_600_000,
      bin: nearestBinIndex(usable[i].thinkMs)
    });
  }

  const ys = increments.map((p) => p.y);
  const sigma = Math.max(3, madSigma(ys));
  const totalHours = increments.reduce((sum, p) => sum + p.hours, 0);
  const pooledRate = totalHours > 0 ? clamp(ys.reduce((a, b) => a + b, 0) / totalHours, 0, PRIOR_RATE_MAX) : 0.5;
  const priorMean = pooledRate;
  const priorSd = Math.max(1.0, 2 * pooledRate);

  const bins: CoachBin[] = BIN_MINUTES.map((minutes, index) => {
    const members = increments.filter((p) => p.bin === index);
    let precision = 1 / (priorSd * priorSd);
    let weighted = priorMean / (priorSd * priorSd);

    for (const p of members) {
      precision += (p.hours * p.hours) / (sigma * sigma);
      weighted += (p.hours * p.y) / (sigma * sigma);
    }

    return {
      minutes,
      games: members.length,
      hours: members.reduce((sum, p) => sum + p.hours, 0),
      rateMean: weighted / precision,
      rateSd: Math.sqrt(1 / precision),
      pBest: 0
    };
  });

  // --- 5. Thompson sampling + pBest ----------------------------------------
  const wins = new Array(bins.length).fill(0);
  for (let s = 0; s < MC_SAMPLES; s++) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let b = 0; b < bins.length; b++) {
      const draw = bins[b].rateMean + bins[b].rateSd * randNormal();
      if (draw > bestValue) {
        bestValue = draw;
        bestIndex = b;
      }
    }
    wins[bestIndex] += 1;
  }
  bins.forEach((bin, index) => {
    bin.pBest = wins[index] / MC_SAMPLES;
  });

  // One fresh Thompson draw decides the actual suggestion.
  let suggestionIndex = 0;
  let suggestionValue = -Infinity;
  for (let b = 0; b < bins.length; b++) {
    const draw = bins[b].rateMean + bins[b].rateSd * randNormal();
    if (draw > suggestionValue) {
      suggestionValue = draw;
      suggestionIndex = b;
    }
  }

  const maxPBest = Math.max(...bins.map((b) => b.pBest));
  const leader = bins[bins.map((b) => b.pBest).indexOf(maxPBest)];
  const status: CoachSuggestion["status"] = maxPBest < 0.55 ? "learning" : "confident";
  const note =
    status === "confident"
      ? `${leader.minutes}m games maximize improvement/hour (${Math.round(maxPBest * 100)}% sure)`
      : `leaning ${leader.minutes}m (${Math.round(maxPBest * 100)}% sure) — still comparing budgets`;

  const suggested = bins[suggestionIndex];

  return {
    suggestedThinkMs: suggested.minutes * 60000,
    perMoveMs: Math.round((suggested.minutes * 60000) / medianMoves),
    status,
    note,
    bins,
    nGames: usable.length,
    beta,
    skillSeries: skill.map((s) => Math.round(s * 100) / 100)
  };
}

/**
 * Cold-start behavior: rotate uniformly through the bins so early data covers
 * the whole range. Deterministic rotation by game count avoids streaks.
 */
function exploratorySuggestion(usable: CoachGameInput[], medianMoves: number): CoachSuggestion {
  const index = usable.length % BIN_MINUTES.length;
  const minutes = BIN_MINUTES[index];

  return {
    suggestedThinkMs: minutes * 60000,
    perMoveMs: Math.round((minutes * 60000) / medianMoves),
    status: "exploring",
    note: `exploring: play a mix of budgets (${MIN_GAMES_FOR_MODEL - usable.length} more timed games to start fitting)`,
    bins: BIN_MINUTES.map((m) => ({
      minutes: m,
      games: usable.filter((g) => nearestBinIndex(g.thinkMs) === BIN_MINUTES.indexOf(m)).length,
      hours: 0,
      rateMean: 0,
      rateSd: 0,
      pBest: 1 / BIN_MINUTES.length
    })),
    nGames: usable.length,
    beta: 0,
    skillSeries: []
  };
}
