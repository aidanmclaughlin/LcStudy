"use client";

import type {
  GroupStat,
  PaceStat,
  ProgressDashboardStats
} from "@/lib/progress-stats";
import { TARGET_ACCURACY } from "@/lib/progress-stats";
import type { MaiaEloSeriesPoint } from "@/lib/maia-elo";
import { useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { JourneyChart } from "./journey-chart";
import type { CurrentGamePoint, RollingAccuracyPoint } from "../public/legacy/js/modules/journey.mjs";

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 100;

interface ChartTick {
  key: string;
  label: string;
  position: number;
}

interface StatsDashboardProps {
  stats: ProgressDashboardStats;
  embedded?: boolean;
  currentGame?: CurrentGamePoint | null;
}

export function StatsDashboard({ stats, embedded = false, currentGame = null }: StatsDashboardProps) {
  const { elo, overview, progress, consistency, timing, skill, coverage, journey } = stats;
  const [tab, setTab] = useState("overview");
  const latest = journey.points.at(-1);
  const tabs = [["overview", "Overview"], ["breakdowns", "Breakdowns"], ["timing", "Timing"]];

  return (
    <main className="stats-page">
      <header className="stats-header">
        <h1>Stats</h1>
        <span className="stats-header-count">{formatInteger(overview.totalGames)} games</span>
        {!embedded && <a className="stats-back" href="/"><ArrowLeft size={16} aria-hidden="true" />Game</a>}
      </header>

      <section className="stats-metric-grid" aria-label="Progress summary">
        <Metric label="25-game accuracy" value={overview.totalGames ? formatPercent(overview.recent25) : "--"} />
        <Metric label="Thinking / move" value={latest ? `${latest.x.toFixed(2)}s` : "--"} />
        <Metric label="Maia Elo" value={formatElo(elo.current, elo.calibration.minimumElo, elo.calibration.maximumElo)}
          title={elo.current ? `Maia-2 rapid equivalent estimate; 80% range ${formatEloRange(elo.current, elo.calibration.minimumElo, elo.calibration.maximumElo)}. Not an official rating.` : "No eligible positions"} />
      </section>

      <nav className="stats-tabs" role="tablist" aria-label="Statistics sections">
        {tabs.map(([id, label], index) => <button key={id} type="button" role="tab" id={`stats-tab-${id}`}
          aria-selected={tab === id} aria-controls={`stats-panel-${id}`} tabIndex={tab === id ? 0 : -1}
          onClick={() => setTab(id)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            setTab(tabs[next][0]);
            document.getElementById(`stats-tab-${tabs[next][0]}`)?.focus();
          }}>{label}</button>)}
      </nav>

      <div role="tabpanel" id={`stats-panel-${tab}`} aria-labelledby={`stats-tab-${tab}`}>
        {tab === "overview" && <>
          <section className="stats-band stats-journey-band">
            <SectionHeading title="Accuracy & pace" />
            <JourneyChart journey={journey} currentGame={currentGame} />
          </section>
          <section className="stats-band stats-accuracy-band">
            <SectionHeading title="100-game accuracy" meta={progress.accuracy100.length ? formatPercent(progress.accuracy100.at(-1)!.accuracy) : undefined} />
            <RollingAccuracyChart points={progress.accuracy100} />
          </section>
          <Details title="Learning & target">
            <div className="stats-split">
              <section className="stats-section">
                <SectionHeading title="Current form" meta="recent games" />
                <dl className="stats-definition-list">
                  <Definition label="10-game accuracy" value={formatPercent(overview.recent10)} />
                  <Definition label="Best 25-game accuracy" value={formatPercent(overview.best25)} />
                  <Definition label="Difficulty-adjusted / 25" value={formatPercent(progress.adjustedRecent25)} />
                  <Definition label="Trend / 100 games" value={formatSignedPoints(progress.trendPer100)} />
                  <Definition label="Game-to-game spread" value={`${consistency.recentDeviation.toFixed(1)} pts`} />
                </dl>
              </section>
              <section className="stats-section">
                <SectionHeading title={`Road to ${TARGET_ACCURACY}%`} meta="10-game target / estimate" />
                {progress.forecast ? <div className="forecast-layout">
                  <div><strong className="stats-feature-value">{formatNullableHours(progress.forecast.remainingHours)}</strong><span className="stats-feature-label">estimated remaining</span></div>
                  <dl className="stats-definition-list">
                    <Definition label="Games left" value={formatInteger(progress.forecast.remainingGames)} />
                    <Definition label="80% range / games" value={`${formatInteger(progress.forecast.remainingGamesLow)}-${formatInteger(progress.forecast.remainingGamesHigh)}`} />
                  </dl>
                </div> : <EmptyState label="No scored games yet" />}
              </section>
            </div>
          </Details>
        </>}

        {tab === "breakdowns" && <>
          <section className="stats-band">
            <SectionHeading title="Performance by position" meta="sample-adjusted averages" />
            <div className="stats-breakdown-grid">
              <Breakdown title="Game phase" rows={skill.phases} />
              <Breakdown title="Color" rows={skill.colors} />
              <Breakdown title="Opponent" rows={skill.opponents} suffix=" Elo" />
              <Breakdown title="Position difficulty" rows={skill.difficulties} />
            </div>
          </section>
          <Details title="Opening lines">
            <Breakdown title="Accuracy by line" rows={skill.openings} />
          </Details>
          <Details title="Data coverage">
            <SectionHeading title="Sample" meta={`${formatInteger(overview.totalGames)} games / ${formatInteger(overview.totalMoves)} moves`} />
            <div className="coverage-grid">
              <CoverageMetric label="Lichess openings" value={`${formatInteger(coverage.lichessGames)} games`} percent={coverage.lichessShare} />
              <CoverageMetric label="Color" value={`${coverage.whiteGames} W / ${coverage.blackGames} B`} percent={coverage.colorCoverage} />
              <CoverageMetric label="Difficulty" value={`${coverage.difficultyGames} games`} percent={progress.difficultyCoverage} />
              <CoverageMetric label="Openings" value={`${coverage.openingLines} lines`} percent={coverage.openingCoverage} />
            </div>
          </Details>
        </>}

        {tab === "timing" && <section className="stats-band">
          <SectionHeading title="Thinking time" meta={`${formatHours(overview.activeHours)} practice / ${formatInteger(timing.timedGames)} timed games`} />
          <div className="stats-inline-metrics">
            <InlineMetric label="Median move" value={formatDuration(timing.medianMoveMs)} />
            <InlineMetric label="Middle 50%" value={`${formatDuration(timing.moveP25Ms)}-${formatDuration(timing.moveP75Ms)}`} />
            <InlineMetric label="Late-game accuracy change" value={timing.fatigueDelta === null ? "--" : formatSignedPoints(timing.fatigueDelta)} />
            <InlineMetric label="Time association / 2x" value={formatSignedPoints(timing.tempoEffect)} />
          </div>
          <div className="stats-split stats-time-grid">
            <PaceTable rows={timing.pace} />
            <LearningRateTable rows={timing.learningRates} />
          </div>
        </section>}
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  title
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="stats-metric" title={title}>
      <span className="stats-metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RollingAccuracyChart({ points }: { points: RollingAccuracyPoint[] }) {
  if (points.length === 0) return <EmptyState label="Available after 100 games with current scoring" />;

  const values = points.map(point => point.accuracy);
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max(0.5, (high - low) * 0.1);
  const minimum = Math.max(0, low - padding), maximum = Math.min(100, high + padding);
  const firstGame = points[0].game, lastGame = points.at(-1)!.game;
  const x = (index: number) => (
    points.length === 1 ? CHART_WIDTH / 2 : (points[index].game - firstGame) * CHART_WIDTH / (lastGame - firstGame)
  );
  const y = (value: number) => (
    (maximum - value) * CHART_HEIGHT / (maximum - minimum || 1)
  );
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.accuracy).toFixed(2)}`)
    .join(" ") + (points.length === 1 ? "h0.01" : "");
  const yTicks = Array.from({ length: 4 }, (_, index) => (
    minimum + (maximum - minimum) * index / 3
  ));
  const xTicks = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
  const yAxisTicks = yTicks.map(tick => ({
    key: String(tick),
    label: formatPercent(tick),
    position: y(tick)
  }));
  const xAxisTicks = xTicks.map((index) => ({
    key: String(index),
    label: `Game ${points[index].game}`,
    position: x(index)
  }));

  return (
    <ChartFrame
      className="stats-accuracy-chart-wrap"
      titleId="accuracy-chart-title"
      descriptionId="accuracy-chart-description"
      title="100-game rolling accuracy over games"
      description="Average accuracy of the most recent 100 games scored under the current search-based grading system, with each game weighted equally. Earlier policy-based scores are excluded."
      yTicks={yAxisTicks}
      xTicks={xAxisTicks}
    >
        <path className="stats-accuracy-chart-line" d={linePath} style={points.length === 1 ? { strokeWidth: 6 } : undefined} />
    </ChartFrame>
  );
}

function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="stats-section-heading">
      <h2>{title}</h2>
      {meta && <span>{meta}</span>}
    </div>
  );
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  return <details className="stats-details">
    <summary>{title}<ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="stats-details-body">{children}</div>
  </details>;
}

function ChartFrame({
  className = "",
  titleId,
  descriptionId,
  title,
  description,
  yTicks,
  xTicks,
  children
}: {
  className?: string;
  titleId: string;
  descriptionId: string;
  title: string;
  description: string;
  yTicks: ChartTick[];
  xTicks: ChartTick[];
  children: ReactNode;
}) {
  return (
    <div className={`stats-chart-wrap${className ? ` ${className}` : ""}`}>
      <div className="stats-chart-frame">
        <div className="stats-chart-y-axis" aria-hidden="true">
          {yTicks.map((tick) => (
            <span
              className="stats-chart-label"
              key={tick.key}
              style={{ top: `${tick.position}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <div className="stats-chart-plot">
          <svg
            className="stats-progress-chart"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${titleId} ${descriptionId}`}
            focusable="false"
          >
            <title id={titleId}>{title}</title>
            <desc id={descriptionId}>{description}</desc>
            {yTicks.map((tick) => (
              <line
                className="stats-chart-gridline"
                key={tick.key}
                x1={0}
                x2={CHART_WIDTH}
                y1={tick.position}
                y2={tick.position}
              />
            ))}
            {children}
          </svg>
        </div>
        <div className="stats-chart-x-axis" aria-hidden="true">
          {xTicks.map((tick, index) => (
            <span
              className={`stats-chart-label stats-chart-x-label stats-chart-x-label--${
                xTicks.length === 1 ? "center" : index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "center"
              }`}
              key={tick.key}
              style={{ left: `${tick.position / CHART_WIDTH * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Definition({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail && <span>{detail}</span>}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  suffix = ""
}: {
  title: string;
  rows: GroupStat[];
  suffix?: string;
}) {
  return (
    <div className="stats-breakdown">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <EmptyState label="No recorded data" />
      ) : (
        <div className="stats-breakdown-rows">
          {rows.map((row) => (
            <div className="stats-breakdown-row" key={row.label}>
              <div className="stats-breakdown-label">
                <span title={row.label}>{row.label}{suffix}</span>
                <small>{formatInteger(row.games)}g / {formatInteger(row.moves)}m</small>
              </div>
              <div className="stats-breakdown-track" aria-hidden="true">
                <span style={{ width: `${Math.max(2, row.accuracy)}%` }} />
              </div>
              <strong>{formatPercent(row.accuracy)}</strong>
              <span className="stats-exact-rate">{formatPercent(row.exactRate, 0)} exact</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineMetric({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="stats-inline-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function PaceTable({ rows }: { rows: PaceStat[] }) {
  return (
    <div className="stats-data-table">
      <h3>Speed-accuracy</h3>
      <div className="stats-table-header">
        <span>Pace</span><span>Games</span><span>Adjusted</span>
      </div>
      {rows.map((row) => (
        <div className="stats-table-row" key={row.label}>
          <strong>{row.label}</strong>
          <span>{formatInteger(row.games)}</span>
          <span>{formatPercent(row.accuracy)}</span>
        </div>
      ))}
    </div>
  );
}

function LearningRateTable({
  rows
}: {
  rows: ProgressDashboardStats["timing"]["learningRates"];
}) {
  return (
    <div className="stats-data-table">
      <h3>Learning per hour</h3>
      <div className="stats-table-header">
        <span>Budget</span><span>Games</span><span>Points / hour</span>
      </div>
      {rows.map((row) => (
        <div className="stats-table-row" key={row.minutes}>
          <strong>{row.minutes}m</strong>
          <span>{formatInteger(row.games)}</span>
          <span title={`80% range ${row.rateLow.toFixed(2)} to ${row.rateHigh.toFixed(2)}`}>
            {row.rateMean.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CoverageMetric({
  label,
  value,
  percent
}: {
  label: string;
  value: string;
  percent: number;
}) {
  const clamped = Math.min(1, Math.max(0, percent));
  return (
    <div className="coverage-metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="coverage-track" aria-hidden="true">
        <span style={{ width: `${clamped * 100}%` }} />
      </div>
      <small>{formatPercent(clamped * 100, 0)}</small>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="stats-empty">{label}</div>;
}

function formatPercent(value: number, digits = 1): string {
  return `${Number.isFinite(value) ? value.toFixed(digits) : "0.0"}%`;
}

function formatElo(
  estimate: MaiaEloSeriesPoint | null,
  minimum: number,
  maximum: number
): string {
  if (!estimate) return "--";
  if (estimate.bound === "low") return `<${formatInteger(minimum)}`;
  if (estimate.bound === "high") return `${formatInteger(maximum)}+`;
  return formatInteger(estimate.elo);
}

function formatEloRange(
  estimate: MaiaEloSeriesPoint,
  minimum: number,
  maximum: number
): string {
  const low = estimate.low80 <= minimum
    ? `<${formatInteger(minimum)}`
    : formatInteger(estimate.low80);
  const high = estimate.high80 >= maximum
    ? `${formatInteger(maximum)}+`
    : formatInteger(estimate.high80);
  return `${low} to ${high}`;
}

function formatInteger(value: number): string {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString();
}

function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "--";
  return hours >= 100 ? `${Math.round(hours).toLocaleString()}h` : `${hours.toFixed(1)}h`;
}

function formatNullableHours(hours: number | null): string {
  return hours === null ? "--" : formatHours(hours);
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds <= 0) return "--";
  const seconds = milliseconds / 1000;
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  if (seconds >= 60) return `${(seconds / 60).toFixed(seconds >= 600 ? 0 : 1)}m`;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function formatSignedPoints(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} pts`;
}
