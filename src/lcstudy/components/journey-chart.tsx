"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import type { Chart } from "chart.js";
import { createJourneyChartConfig, paretoFrontier, type AccuracyJourney, type CurrentGamePoint } from "../public/legacy/js/modules/journey.mjs";

export function JourneyChart({ journey, currentGame = null }: { journey: AccuracyJourney; currentGame?: CurrentGamePoint | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [range, setRange] = useState<"recent" | "all">("recent");
  const [error, setError] = useState(false);
  const visible = useMemo(() => {
    const points = range === "recent" ? journey.points.slice(-100) : journey.points;
    return { ...journey, points, frontier: paretoFrontier(points.filter(point => !point.provisional)) };
  }, [journey, range]);
  const latest = visible.points.at(-1);
  const hasPoints = Boolean(latest || currentGame);
  useEffect(() => {
    if (!hasPoints) return;
    let chart: Chart | undefined;
    let cancelled = false;
    setError(false);
    import("chart.js/auto").then(({ default: ChartJS }) => {
      if (!cancelled && canvas.current) chart = new ChartJS(canvas.current, createJourneyChartConfig(visible, false, currentGame));
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; chart?.destroy(); };
  }, [visible, currentGame, hasPoints]);

  if (!hasPoints || error) {
    return <div className="stats-empty" role="status">{error ? "Chart unavailable" : "No timed games yet"}</div>;
  }

  return <div className="journey-figure">
    <div className="journey-toolbar">
      <div className="stats-chart-legend">
        <span className="journey-time-key" aria-label="Journey chronology: older windows fade, the newest is brightest"><span>Older</span><i aria-hidden="true" /><span>Newer</span></span>
        <span><i className="frontier-key" />Frontier</span>
        {currentGame && <span><i className="current-game-key" />Current game</span>}
      </div>
      <div className="segmented segmented--compact" role="group" aria-label="Journey history">
        <button type="button" aria-pressed={range === "recent"} onClick={() => setRange("recent")}>Recent 100</button>
        <button type="button" aria-pressed={range === "all"} onClick={() => setRange("all")}>All games</button>
      </div>
    </div>
    <div className="journey-canvas">
      <canvas ref={canvas} role="img" aria-label="Accuracy versus thinking seconds per move; the journey runs from faded older windows to the brightest newest one, with direction arrows, the observed Pareto frontier, and the current game" />
    </div>
    <dl className="journey-caption-list">
      <div className="journey-caption">
        <dt>{latest ? `Games ${latest.startGame}–${latest.game}${latest.provisional ? ` · ${latest.games} of ${journey.windowSize} · provisional` : ""}` : `${journey.windowSize}-game windows`}</dt>
        <dd>{latest ? `${latest.y.toFixed(1)}% · ${latest.x.toFixed(2)}s per move` : "--"}</dd>
      </div>
      {currentGame && <div className="journey-caption journey-current">
        <dt>Current game · {currentGame.moves} {currentGame.moves === 1 ? "move" : "moves"}</dt>
        <dd>{currentGame.y.toFixed(1)}% · {currentGame.x.toFixed(2)}s per move</dd>
      </div>}
    </dl>
  </div>;
}
