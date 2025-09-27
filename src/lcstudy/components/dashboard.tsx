"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { signOut } from "next-auth/react";
import { Chess } from "chess.js";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import Image from "next/image";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

const Chessboard = dynamic(async () => (await import('react-chessboard')).Chessboard, { ssr: false });

interface DashboardUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface GamePayload {
  id: string;
  white: string;
  black: string;
  event: string;
  eco: string;
  result: string;
  startingFen: string;
  sideToMove: "w" | "b";
  bestMoveSan: string;
  bestMoveUci: string;
  context: string[];
  description: string;
}

interface StatsSummary {
  totalGames: number;
  solvedGames: number;
  winRate: number;
  averageAttempts: number;
  currentStreak: number;
  timeline: {
    date: string;
    gamesPlayed: number;
    wins: number;
    winRate: number;
    avgAttempts: number;
    cumulativeWinRate: number;
  }[];
  attempts: {
    label: string;
    attempts: number;
    solved: boolean;
  }[];
}

type GameStatus = "idle" | "playing" | "won" | "lost";

interface Props {
  user: DashboardUser;
}

const INITIAL_STATS: StatsSummary = {
  totalGames: 0,
  solvedGames: 0,
  winRate: 0,
  averageAttempts: 0,
  currentStreak: 0,
  timeline: [],
  attempts: []
};

export default function Dashboard({ user }: Props) {
  const [game, setGame] = useState<GamePayload | null>(null);
  const [stats, setStats] = useState<StatsSummary>(INITIAL_STATS);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [attempts, setAttempts] = useState(0);
  const [status, setStatus] = useState<GameStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [position, setPosition] = useState<string>("start");
  const [highlightSquares, setHighlightSquares] = useState<Record<string, CSSProperties>>({});
  const [isFetching, setIsFetching] = useState(true);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [chess, setChess] = useState<Chess | null>(null);

  const orientation = game?.sideToMove === "w" ? "white" : "black";
  const attemptsLeft = Math.max(maxAttempts - attempts, 0);
  const userInitials = useMemo(() => {
    if (user.name) {
      return user.name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    }
    if (user.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return "LC";
  }, [user.name, user.email]);

  const resetBoardState = useCallback((payload: GamePayload | null) => {
    if (!payload) return;
    const instance = new Chess(payload.startingFen);
    setChess(instance);
    setPosition(instance.fen());
    setStatus("playing");
    setAttempts(0);
    setMessage(null);
    setHighlightSquares({});
    setHasRecorded(false);
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/summary", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as StatsSummary;
      setStats(data);
    } catch (err) {
      console.error("Failed to load stats", err);
    }
  }, []);

  const fetchNextGame = useCallback(async () => {
    setIsFetching(true);
    try {
      const res = await fetch("/api/games/next", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Unable to fetch game");
      }
      const data = await res.json();
      setGame(data.game as GamePayload);
      setMaxAttempts(data.maxAttempts ?? 3);
      resetBoardState(data.game as GamePayload);
    } catch (err) {
      console.error(err);
      setMessage("Unable to load a new game. Please try again in a moment.");
    } finally {
      setIsFetching(false);
    }
  }, [resetBoardState]);

  useEffect(() => {
    fetchStats();
    fetchNextGame();
  }, [fetchStats, fetchNextGame]);

  const recordResult = useCallback(
    async (solved: boolean, attemptCount: number) => {
      if (!game || hasRecorded) return;
      try {
        setHasRecorded(true);
        await fetch("/api/games/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: game.id,
            attempts: attemptCount,
            solved
          })
        });
      } catch (err) {
        console.error("Failed to record result", err);
      } finally {
        fetchStats();
      }
    },
    [game, hasRecorded, fetchStats]
  );

  const applySolution = useCallback(() => {
    if (!chess || !game) return;
    const from = game.bestMoveUci.slice(0, 2);
    const to = game.bestMoveUci.slice(2, 4);
    const promotion = game.bestMoveUci.slice(4);
    chess.move({ from, to, promotion: promotion || undefined });
    setPosition(chess.fen());
    setHighlightSquares({
      [from]: { background: "rgba(139, 92, 246, 0.35)" },
      [to]: { background: "rgba(139, 92, 246, 0.75)" }
    });
  }, [chess, game]);

  const handlePieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string) => {
      if (!game || !chess || status !== "playing") {
        return false;
      }

      const tentativeMove = chess.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q"
      });

      if (!tentativeMove) {
        return false;
      }

      chess.undo();

      const promotion = tentativeMove.promotion ?? "";
      const attemptUci = `${sourceSquare}${targetSquare}${promotion}`.toLowerCase();
      const solutionUci = game.bestMoveUci.toLowerCase();
      const isCorrect =
        attemptUci === solutionUci ||
        (promotion && `${sourceSquare}${targetSquare}`.toLowerCase() === solutionUci);

      const attemptCount = attempts + 1;
      setAttempts(attemptCount);

      if (isCorrect) {
        chess.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: tentativeMove.promotion ?? undefined
        });
        setPosition(chess.fen());
        setStatus("won");
        setMessage("Nice! You matched Leela's choice.");
        setHighlightSquares({
          [sourceSquare]: { background: "rgba(34, 197, 94, 0.35)" },
          [targetSquare]: { background: "rgba(34, 197, 94, 0.75)" }
        });
        recordResult(true, attemptCount);
        return true;
      }

      setHighlightSquares({
        [sourceSquare]: { background: "rgba(239, 68, 68, 0.35)" },
        [targetSquare]: { background: "rgba(239, 68, 68, 0.7)" }
      });

      if (attemptCount >= maxAttempts) {
        setStatus("lost");
        setMessage(`Out of attempts. Leela played ${game.bestMoveSan}.`);
        applySolution();
        recordResult(false, attemptCount);
      } else {
        setMessage(`Not quite. ${maxAttempts - attemptCount} attempt${
          maxAttempts - attemptCount === 1 ? "" : "s"
        } left.`);
      }

      return false;
    },
    [chess, game, status, attempts, maxAttempts, recordResult, applySolution]
  );

  const handleReveal = useCallback(async () => {
    if (!game || !chess || status !== "playing") return;
    applySolution();
    setStatus("lost");
    setAttempts(maxAttempts);
    setMessage(`Revealed: ${game.bestMoveSan}`);
    if (!hasRecorded) {
      await recordResult(false, Math.max(attempts, 1));
    }
  }, [game, chess, status, applySolution, hasRecorded, recordResult, attempts, maxAttempts]);

  const handleNextGame = useCallback(async () => {
    if (!game) return;
    if (status === "playing" && !hasRecorded) {
      await recordResult(false, Math.max(attempts, 1));
    }
    fetchNextGame();
  }, [attempts, fetchNextGame, game, hasRecorded, recordResult, status]);

  const winRatePercent = Math.round(stats.winRate * 100);

  const winRateChart = useMemo(() => {
    const labels = stats.timeline.map((item) => item.date);
    const dataPoints = stats.timeline.map((item) => Math.round(item.cumulativeWinRate * 1000) / 10);
    return {
      labels,
      datasets: [
        {
          label: "Cumulative Win Rate (%)",
          data: dataPoints,
          borderColor: "#8b5cf6",
          backgroundColor: "rgba(139, 92, 246, 0.15)",
          tension: 0.35,
          fill: true,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    };
  }, [stats.timeline]);

  const attemptsChart = useMemo(() => {
    return {
      labels: stats.attempts.map((item) => item.label),
      datasets: [
        {
          label: "Attempts",
          data: stats.attempts.map((item) => item.attempts),
          backgroundColor: stats.attempts.map((item) =>
            item.solved ? "rgba(34, 197, 94, 0.8)" : "rgba(239, 68, 68, 0.8)"
          ),
          borderRadius: 6
        }
      ]
    };
  }, [stats.attempts]);

  return (
    <main className="flex min-h-screen flex-col gap-6 px-4 pb-10 pt-6 md:px-10">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">LcStudy</h1>
          <p className="text-sm text-slate-300">
            Predict Leela&apos;s move, stay streaky, and keep an eye on your improvement.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-2 shadow-panel">
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name ?? "Player avatar"}
                width={32}
                height={32}
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold">
                {userInitials}
              </div>
            )}
            <div className="text-right">
              <div className="text-sm font-semibold">{user.name ?? "Leela Fan"}</div>
              <div className="text-xs text-slate-400">Current streak: {stats.currentStreak}</div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
            onClick={() => signOut({ callbackUrl: "/signin" })}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-3xl bg-slate-900/70 p-6 shadow-panel backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex flex-1 flex-col items-center gap-4">
              <div className="w-full max-w-[480px] overflow-hidden rounded-3xl border border-white/5 shadow-2xl">
                <Chessboard
                  id="lcstudy-board"
                  position={position}
                  boardOrientation={orientation}
                  arePiecesDraggable={status === "playing"}
                  onPieceDrop={handlePieceDrop}
                  customDarkSquareStyle={{ backgroundColor: "#1e293b" }}
                  customLightSquareStyle={{ backgroundColor: "#334155" }}
                  customBoardStyle={{ borderRadius: "24px" }}
                  customSquareStyles={highlightSquares}
                  animationDuration={200}
                />
              </div>
              <div className="flex w-full flex-col gap-4 rounded-2xl bg-slate-950/60 p-4 text-sm text-slate-200 shadow-inner">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">
                    {game ? `${game.white} vs ${game.black}` : "Loading game..."}
                  </span>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-300">
                    {game?.eco ?? "--"}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{game?.event ?? ""}</p>
                <p className="text-sm text-slate-200">{game?.description}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-amber-300">
                    Attempts left: {attemptsLeft}
                  </span>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium">
                    Result: {game?.result ?? ""}
                  </span>
                </div>
                {message && (
                  <p className="rounded-2xl bg-slate-800/80 px-3 py-2 text-sm text-slate-100">
                    {message}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleNextGame}
                    disabled={isFetching}
                    className="rounded-full bg-violet-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "playing" ? "Skip Puzzle" : "Next Puzzle"}
                  </button>
                  <button
                    type="button"
                    onClick={handleReveal}
                    disabled={isFetching || status !== "playing"}
                    className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reveal Solution
                  </button>
                </div>
              </div>
            </div>

            <aside className="w-full max-w-md rounded-2xl bg-slate-950/60 p-5 text-sm text-slate-200 shadow-inner">
              <h2 className="text-lg font-semibold text-slate-100">Continuation</h2>
              <p className="mt-1 text-xs text-slate-400">
                How Leela continued after finding the best move.
              </p>
              <ol className="scrollbar-hide mt-4 max-h-64 space-y-2 overflow-y-auto pr-2">
                {game?.context.map((line, idx) => (
                  <li key={line} className="rounded-xl bg-slate-900/80 px-3 py-2 text-xs text-slate-200">
                    <span className="mr-2 text-slate-500">{idx + 1}.</span>
                    {line}
                  </li>
                ))}
                {!game && (
                  <li className="rounded-xl bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
                    Loading lines...
                  </li>
                )}
              </ol>
            </aside>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-3xl bg-slate-900/70 p-6 shadow-panel backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Performance snapshot</h2>
                <p className="text-xs text-slate-400">Updated after every puzzle</p>
              </div>
              <div className="rounded-full bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300">
                Win rate {winRatePercent}%
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard label="Total games" value={stats.totalGames} />
              <MetricCard label="Solved" value={stats.solvedGames} />
              <MetricCard
                label="Avg attempts"
                value={stats.averageAttempts > 0 ? stats.averageAttempts.toFixed(1) : "—"}
              />
            </div>
          </div>

          <div className="rounded-3xl bg-slate-900/70 p-6 shadow-panel backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Win rate over time</h2>
            </div>
            <div className="mt-4 h-60">
              {stats.timeline.length > 0 ? (
                <Line
                  data={winRateChart}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      y: {
                        min: 0,
                        max: 100,
                        ticks: {
                          color: "#94a3b8",
                          callback: (value) => `${value}%`
                        },
                        grid: { color: "rgba(148, 163, 184, 0.15)" }
                      },
                      x: {
                        ticks: { color: "#94a3b8" },
                        grid: { color: "rgba(148, 163, 184, 0.1)" }
                      }
                    },
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          label: (context) => `${context.parsed.y.toFixed(1)}%`
                        }
                      }
                    }
                  }}
                />
              ) : (
                <EmptyChartState message="Play your first puzzle to unlock analytics." />
              )}
            </div>
          </div>

          <div className="rounded-3xl bg-slate-900/70 p-6 shadow-panel backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Attempts per puzzle</h2>
            </div>
            <div className="mt-4 h-56">
              {stats.attempts.length > 0 ? (
                <Bar
                  data={attemptsChart}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      y: {
                        beginAtZero: true,
                        grid: { color: "rgba(148, 163, 184, 0.15)" },
                        ticks: { color: "#94a3b8", precision: 0 }
                      },
                      x: {
                        grid: { color: "rgba(148, 163, 184, 0.1)" },
                        ticks: { color: "#94a3b8" }
                      }
                    },
                    plugins: {
                      legend: { display: false }
                    }
                  }}
                />
              ) : (
                <EmptyChartState message="Attempts history will show up once you finish a game." />
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-slate-950/60 px-4 py-5 text-center text-slate-200 shadow-inner">
      <div className="text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}
