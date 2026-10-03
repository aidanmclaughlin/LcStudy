"use client";

import type {
  GroupStat,
  ProgressDashboardStats
} from "@/lib/progress-stats";
import { TARGET_ACCURACY } from "@/lib/progress-stats";
import type { MaiaEloSeriesPoint } from "@/lib/maia-elo";
import { useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { niceScale, type RollingAccuracyPoint } from "../public/legacy/js/modules/journey.mjs";

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
}

/**
 * Every block is the same card: a label header (with optional meta on the
 * right) above its content. Each number appears once per tab.
 *
 * Accuracy means accuracy across every try in a game; the first try at each
 * move is shown separately, the way move-matching accuracy is usually reported.
 */
export function StatsDashboard({ stats, embedded = false }: StatsDashboardProps) {
  const { elo, overview, progress, consistency, skill, coverage } = stats;
  const [tab, setTab] = useState("overview");
  const recentSample = `Last ${formatInteger(overview.recentGames)} scored games`;
  const tabs = [["overview", "Overview"], ["breakdowns", "Breakdowns"]];
  const forecast = progress.forecast;

  return (
    <main className="stats-page">
      <header className="stats-header">
        <h1>Stats</h1>
        <span className="stats-header-count">{formatInteger(overview.totalGames)} {overview.totalGames === 1 ? "game" : "games"}</span>
        {!embedded && <a className="stats-back" href="/"><ArrowLeft size={16} aria-hidden="true" />Game</a>}
      </header>

      <section className="stats-kpis" aria-label="Progress summary">
        <Metric label="100-game accuracy" value={overview.recent100 === null ? "--" : formatPercent(overview.recent100)}
          title="Accuracy across every try, over the last 100 scored games with each game weighted equally" />
        <Metric label="First-try accuracy" value={overview.recentFirstTry === null ? "--" : formatPercent(overview.recentFirstTry)}
          title="Accuracy of your first try at each move over the same 100 games, the way move-matching accuracy is usually reported" />
        <Metric label="Maia Elo" value={formatElo(elo.current, elo.calibration.minimumElo, elo.calibration.maximumElo)}
          title={elo.current ? `Maia-2 rapid equivalent over the last ${elo.current.games} eligible games; 80% range ${formatEloRange(elo.current, elo.calibration.minimumElo, elo.calibration.maximumElo)}. Not an official rating.` : "No eligible positions"} />
      </section>

      <nav className="stats-tabs segmented" role="tablist" aria-label="Statistics sections">
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

      <div role="tabpanel" className="stats-panel" id={`stats-panel-${tab}`} aria-labelledby={`stats-tab-${tab}`}>
        {tab === "overview" && <>
          <Card title="100-game accuracy" className="stats-accuracy-band"
            meta={gameSpan(progress.accuracy100)}>
            <RollingAccuracyChart points={progress.accuracy100} />
          </Card>
          <div className="stats-grid">
            <Card title="Current form" meta={recentSample}>
              <dl className="stats-definition-list">
                <Definition label="Best 100 games" value={overview.best100 === null ? "--" : formatPercent(overview.best100)} />
                <Definition label="Difficulty-adjusted" value={overview.recentGames === 100 ? formatPercent(progress.adjustedRecent100) : "--"} />
                <Definition label="Trend per 100 games" value={formatSignedPoints(progress.trendPer100)} />
                <Definition label="Game-to-game spread" value={formatPoints(consistency.recentDeviation)} />
              </dl>
            </Card>
            <Card title={`Road to ${TARGET_ACCURACY}%`} meta="10-game average">
              {forecast ? <dl className="stats-definition-list">
                <Definition label="Games left" value={formatInteger(forecast.remainingGames)} />
                <Definition label="80% range" value={`${formatInteger(forecast.remainingGamesLow)}–${formatInteger(forecast.remainingGamesHigh)}`} />
              </dl> : <EmptyState label="No scored games yet" />}
            </Card>
          </div>
        </>}

        {tab === "breakdowns" && <>
          <p className="stats-caption">First tries · {recentSample}</p>
          <div className="stats-grid">
            <Card title="Game phase"><Breakdown rows={skill.phases} /></Card>
            <Card title="Position difficulty"><Breakdown rows={skill.difficulties} /></Card>
          </div>
          <Card title="Color"><Breakdown rows={skill.colors} split /></Card>
          <Card title="Opponent"><Breakdown rows={skill.opponents} suffix=" Elo" split /></Card>
          <Card title="Opening lines" meta={`${formatInteger(skill.openings.length)} ${skill.openings.length === 1 ? "line" : "lines"}`}>
            <Breakdown rows={skill.openings} split />
          </Card>
          <Card title="Data coverage" meta={`Lifetime · ${formatInteger(overview.totalMoves)} moves`}>
            <div className="stats-breakdown-rows stats-breakdown-rows--split" style={splitRows(4)}>
              <CoverageRow label="Lichess openings" detail={`${formatInteger(coverage.lichessGames)} games`} share={coverage.lichessShare} />
              <CoverageRow label="Color balance" detail={`${formatInteger(coverage.whiteGames)} White · ${formatInteger(coverage.blackGames)} Black`} share={coverage.colorCoverage} />
              <CoverageRow label="Difficulty scored" detail={`${formatInteger(coverage.difficultyGames)} games`} share={progress.difficultyCoverage} />
              <CoverageRow label="Opening lines" detail={`${formatInteger(coverage.openingLines)} lines`} share={coverage.openingCoverage} />
            </div>
          </Card>
        </>}

      </div>
    </main>
  );
}

function Card({ title, meta, className = "", children }: { title: string; meta?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`stats-card${className ? ` ${className}` : ""}`}>
      <div className="stats-card-heading">
        <h2 className="label">{title}</h2>
        {meta && <span className="stats-card-meta">{meta}</span>}
      </div>
      {children}
    </section>
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
      <span className="label stats-metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RollingAccuracyChart({ points }: { points: RollingAccuracyPoint[] }) {
  if (points.length === 0) return <EmptyState label="Available after 100 games with current scoring" />;

  const values = points.map(point => point.accuracy);
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max(0.25, (high - low) * 0.06);
  const scale = niceScale(low - padding, high + padding, { targetTicks: 4, floor: 0, ceiling: 100 });
  const tickDigits = scale.step >= 1 ? 0 : 1;
  const firstGame = points[0].game, lastGame = points.at(-1)!.game;
  const x = (index: number) => (
    points.length === 1 ? CHART_WIDTH / 2 : (points[index].game - firstGame) * CHART_WIDTH / (lastGame - firstGame)
  );
  const y = (value: number) => (
    (scale.max - value) * CHART_HEIGHT / (scale.max - scale.min || 1)
  );
  const coordinates = points.map((point, index) => `${x(index).toFixed(2)},${y(point.accuracy).toFixed(2)}`);
  const linePath = `M${coordinates.join(" L")}${points.length === 1 ? "h0.01" : ""}`;
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(2)},${CHART_HEIGHT} L${x(0).toFixed(2)},${CHART_HEIGHT} Z`;
  const xTicks = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
  const yAxisTicks = scale.ticks.map(tick => ({
    key: String(tick),
    label: formatPercent(tick, tickDigits),
    position: y(tick)
  }));
  const xAxisTicks = xTicks.map((index) => ({
    key: String(index),
    label: `Game ${formatInteger(points[index].game)}`,
    position: x(index)
  }));
  const last = points.length - 1;

  return (
    <ChartFrame
      className="stats-accuracy-chart-wrap"
      titleId="accuracy-chart-title"
      descriptionId="accuracy-chart-description"
      title="100-game rolling accuracy over games"
      description="Average accuracy across every try in the most recent 100 games scored under the current search-based grading system, with each game weighted equally. Earlier policy-based scores are excluded."
      yTicks={yAxisTicks}
      xTicks={xAxisTicks}
      overlay={<span className="stats-chart-dot" style={{ left: `${x(last) / CHART_WIDTH * 100}%`, top: `${y(points[last].accuracy)}%` }} />}
    >
      <defs>
        <linearGradient id="stats-accuracy-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#a78bfa" stopOpacity="0.2" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
      </defs>
      {points.length > 1 && <path className="stats-accuracy-chart-area" d={areaPath} />}
      <path className="stats-accuracy-chart-line" d={linePath} style={points.length === 1 ? { strokeWidth: 6 } : undefined} />
    </ChartFrame>
  );
}

function ChartFrame({
  className = "",
  titleId,
  descriptionId,
  title,
  description,
  yTicks,
  xTicks,
  overlay,
  children
}: {
  className?: string;
  titleId: string;
  descriptionId: string;
  title: string;
  description: string;
  yTicks: ChartTick[];
  xTicks: ChartTick[];
  overlay?: ReactNode;
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
          {overlay}
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
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** One row per group: name and accuracy on top, sample size and exact rate under, then the bar. */
function Breakdown({
  rows,
  suffix = "",
  split = false
}: {
  rows: GroupStat[];
  suffix?: string;
  split?: boolean;
}) {
  if (rows.length === 0) return <EmptyState label="No recorded data" />;
  return (
    <div className={`stats-breakdown-rows${split ? " stats-breakdown-rows--split" : ""}`} style={split ? splitRows(rows.length) : undefined}>
      {rows.map((row) => (
        <BarRow
          key={row.label}
          label={`${formatRange(row.label)}${suffix}`}
          value={formatPercent(row.accuracy)}
          detail={`${formatInteger(row.games)} ${row.games === 1 ? "game" : "games"} · ${formatInteger(row.moves)} moves`}
          extra={`${formatPercent(row.exactRate, 0)} exact`}
          fill={row.accuracy / 100}
        />
      ))}
    </div>
  );
}

function gameSpan(points: RollingAccuracyPoint[]): string | undefined {
  if (points.length === 0) return undefined;
  const [first, last] = [points[0].game, points.at(-1)!.game];
  return first === last ? `Game ${formatInteger(first)}` : `Games ${formatInteger(first)}–${formatInteger(last)}`;
}

function splitRows(count: number) {
  return { "--rows": Math.ceil(count / 2) } as CSSProperties;
}

function CoverageRow({ label, detail, share }: { label: string; detail: string; share: number }) {
  const clamped = Math.min(1, Math.max(0, share));
  return <BarRow label={label} value={formatPercent(clamped * 100, 0)} detail={detail} fill={clamped} />;
}

function BarRow({ label, value, detail, extra, fill }: { label: string; value: string; detail: string; extra?: string; fill: number }) {
  return (
    <div className="stats-breakdown-row">
      <div className="stats-breakdown-line">
        <span className="stats-breakdown-name" title={label}>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="stats-breakdown-line stats-breakdown-detail">
        <span>{detail}</span>
        {extra && <span>{extra}</span>}
      </div>
      <div className="stats-breakdown-track" aria-hidden="true">
        <span style={{ width: `${Math.max(1, fill * 100)}%` }} />
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="stats-empty">{label}</div>;
}

function formatPercent(value: number, digits = 1): string {
  return `${Number.isFinite(value) ? value.toFixed(digits) : "0.0"}%`;
}

/** Server labels use hyphens for numeric ranges ("1100-1299"); show an en dash. */
function formatRange(label: string): string {
  return label.replace(/(\d)-(\d)/g, "$1–$2");
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

function formatPoints(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} pts` : "--";
}

function formatSignedPoints(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} pts`;
}
