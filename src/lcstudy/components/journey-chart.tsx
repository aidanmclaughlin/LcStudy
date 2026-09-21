"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import type { Chart } from "chart.js";
import { createJourneyChartConfig, paretoFrontier, type AccuracyJourney } from "../public/legacy/js/modules/journey.mjs";

export function JourneyChart({ journey }: { journey: AccuracyJourney }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [range, setRange] = useState<"recent" | "all">("recent");
  const [error, setError] = useState(false);
  const visible = useMemo(() => {
    const points = range === "recent" ? journey.points.slice(-100) : journey.points;
    return { ...journey, points, frontier: paretoFrontier(points.filter(point => !point.provisional)) };
  }, [journey, range]);
  useEffect(() => {
    let chart: Chart | undefined;
    let cancelled = false;
    setError(false);
    import("chart.js/auto").then(({ default: ChartJS }) => {
      if (!cancelled && canvas.current) chart = new ChartJS(canvas.current, createJourneyChartConfig(visible));
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; chart?.destroy(); };
  }, [visible]);
  const latest = visible.points.at(-1);
  return <div className="journey-figure">
    <div className="journey-toolbar">
      <div className="stats-chart-legend">
        <span><i className="journey-key" />Journey</span>
        <span><i className="frontier-key" />Observed frontier</span>
        <span><i className="latest-key" />Latest</span>
      </div>
      <div className="stats-segment" aria-label="Journey history">
        <button type="button" aria-pressed={range === "recent"} onClick={() => setRange("recent")}>Recent 100</button>
        <button type="button" aria-pressed={range === "all"} onClick={() => setRange("all")}>All games</button>
      </div>
    </div>
    <div className="journey-canvas">
      <canvas ref={canvas} role="img" aria-label="Accuracy versus thinking seconds per move, with chronological journey and observed Pareto frontier" hidden={!latest || error} />
      {(!latest || error) && <div className="stats-empty" role="status">{error ? "Chart unavailable" : "No timed game history yet"}</div>}
    </div>
    <div className="journey-caption">
      <span>{latest ? `Games ${latest.startGame}-${latest.game}${latest.provisional ? ` / ${latest.games} of 25 / provisional` : " / 25-game windows"}` : "25-game windows"}</span>
      <span>{latest ? `${latest.y.toFixed(1)}% / ${latest.x.toFixed(2)}s per move` : "--"}</span>
    </div>
  </div>;
}
