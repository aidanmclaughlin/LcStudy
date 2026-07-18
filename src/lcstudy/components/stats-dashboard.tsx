import type {
  GroupStat,
  PaceStat,
  ProgressDashboardStats,
  ProgressSeriesPoint
} from "@/lib/progress-stats";
import { TARGET_ACCURACY } from "@/lib/progress-stats";
import type { MaiaEloSeriesPoint } from "@/lib/maia-elo";

interface StatsDashboardProps {
  stats: ProgressDashboardStats;
}

export function StatsDashboard({ stats }: StatsDashboardProps) {
  const { elo, overview, progress, consistency, timing, skill, coverage } = stats;
  const eloModel = elo.calibration.model === "maia2-rapid"
    ? "Maia-2 rapid"
    : elo.calibration.model;
  const eloTitle = `${eloModel}, ${formatInteger(elo.calibration.sampledGames)} corpus games, ${formatInteger(elo.calibration.sampledPositions)} post-opening positions, latest ${elo.current?.games ?? 0} eligible games`;

  return (
    <main className="stats-page">
      <header className="stats-header">
        <a className="stats-back" href="/">
          <span aria-hidden="true">&#8592;</span>
          Game
        </a>
        <div className="stats-title-group">
          <span className="stats-brand">LCStudy</span>
          <h1>Progress</h1>
        </div>
        <span className="stats-header-count">{formatInteger(overview.totalGames)} games</span>
      </header>

      <section className="stats-metric-grid" aria-label="Progress summary">
        <Metric
          label="Maia Elo"
          value={formatElo(elo.current, elo.calibration.minimumElo, elo.calibration.maximumElo)}
          detail={elo.current
            ? `${formatEloRange(elo.current, elo.calibration.minimumElo, elo.calibration.maximumElo)} 80% range`
            : `Moves ${elo.calibration.firstIncludedPrompt}+`}
          title={eloTitle}
          tone="rose"
        />
        <Metric label="10-game" value={formatPercent(overview.recent10)} tone="green" />
        <Metric
          label="25-game"
          value={formatPercent(overview.recent25)}
          detail={`${formatPercent(overview.recent25Low, 0)}-${formatPercent(overview.recent25High, 0)} 80% range`}
          tone="violet"
        />
        <Metric label="Best 25" value={formatPercent(overview.best25)} tone="amber" />
        <Metric label="All-time" value={formatPercent(overview.allTimeAccuracy)} />
        <Metric label="Leela matches" value={formatPercent(overview.exactRate)} tone="blue" />
        <Metric label="Active practice" value={formatHours(overview.activeHours)} />
      </section>

      <section className="stats-band stats-elo-band">
        <SectionHeading
          title="Maia Elo"
          meta={`${elo.current?.games ?? 0}-game / moves ${elo.calibration.firstIncludedPrompt}+`}
        />
        <div className="stats-chart-legend" aria-hidden="true">
          <LegendItem className="legend-elo" label="25-game estimate" />
          <LegendItem className="legend-elo-range" label="80% range" />
        </div>
        <MaiaEloChart
          points={elo.series}
          minimum={elo.calibration.minimumElo}
          maximum={elo.calibration.maximumElo}
        />
      </section>

      <section className="stats-band stats-progress-band">
        <SectionHeading
          title="Accuracy"
          meta={`${formatInteger(overview.totalGames)} games`}
        />
        <div className="stats-chart-legend" aria-hidden="true">
          <LegendItem className="legend-10" label="10-game" />
          <LegendItem className="legend-25" label="25-game" />
          <LegendItem className="legend-adjusted" label="Difficulty-adjusted" />
          <LegendItem className="legend-target" label={`${TARGET_ACCURACY}% target`} />
        </div>
        <ProgressChart points={progress.series} />
      </section>

      <div className="stats-split stats-goal-row">
        <section className="stats-section">
          <SectionHeading title={`${TARGET_ACCURACY}% Forecast`} meta="10-game target" />
          {progress.forecast ? (
            <div className="forecast-layout">
              <div>
                <span className="stats-feature-value">
                  {formatNullableHours(progress.forecast.remainingHours)}
                </span>
                <span className="stats-feature-label">remaining</span>
              </div>
              <dl className="stats-definition-list">
                <Definition
                  label="Games left"
                  value={formatInteger(progress.forecast.remainingGames)}
                />
                <Definition
                  label="80% range"
                  value={`${formatInteger(progress.forecast.remainingGamesLow)}-${formatInteger(progress.forecast.remainingGamesHigh)}`}
                />
                <Definition
                  label="Target game"
                  value={`#${formatInteger(progress.forecast.targetGame)}`}
                />
                <Definition
                  label="Typical game"
                  value={formatDuration(progress.forecast.typicalGameMs)}
                />
              </dl>
            </div>
          ) : (
            <EmptyState label="Play one scored game" />
          )}
        </section>

        <section className="stats-section">
          <SectionHeading title="Signal" meta="recent form" />
          <dl className="stats-definition-list stats-definition-list--wide">
            <Definition
              label="Adjusted 25-game"
              value={formatPercent(progress.adjustedRecent25)}
            />
            <Definition
              label="Trend / 100 games"
              value={formatSignedPoints(progress.trendPer100)}
              detail={`${formatSignedPoints(progress.trendLow)} to ${formatSignedPoints(progress.trendHigh)}`}
            />
            <Definition
              label="10th percentile"
              value={formatPercent(consistency.recentFloor)}
            />
            <Definition
              label="Game-to-game spread"
              value={`${consistency.recentDeviation.toFixed(1)} pts`}
            />
            <Definition
              label="Next-move recovery"
              value={formatPercent(consistency.recoveryRate * 100, 0)}
              detail={`${formatInteger(consistency.recoverySamples)} chances`}
            />
            <Definition
              label="Difficulty coverage"
              value={formatPercent(progress.difficultyCoverage * 100, 0)}
            />
          </dl>
        </section>
      </div>

      <section className="stats-band">
        <SectionHeading title="Skill Map" meta="sample-shrunk" />
        <div className="stats-breakdown-grid">
          <Breakdown title="Game phase" rows={skill.phases} />
          <Breakdown title="Color" rows={skill.colors} />
          <Breakdown title="Opponent" rows={skill.opponents} suffix=" Elo" />
          <Breakdown title="Position set" rows={skill.difficulties} />
        </div>
        <Breakdown title="Opening lines" rows={skill.openings} wide />
      </section>

      <section className="stats-band">
        <SectionHeading title="Time" meta={`${formatInteger(timing.timedGames)} timed games`} />
        <div className="stats-inline-metrics">
          <InlineMetric label="Median move" value={formatDuration(timing.medianMoveMs)} />
          <InlineMetric
            label="Middle 50%"
            value={`${formatDuration(timing.moveP25Ms)}-${formatDuration(timing.moveP75Ms)}`}
          />
          <InlineMetric
            label="Late-game change"
            value={timing.fatigueDelta === null ? "--" : formatSignedPoints(timing.fatigueDelta)}
            detail={`${formatInteger(timing.fatigueGames)} games`}
          />
          <InlineMetric
            label="Thinking effect"
            value={`${formatSignedPoints(timing.tempoEffect)} / 2x time`}
          />
        </div>

        <div className="stats-split stats-time-grid">
          <PaceTable rows={timing.pace} />
          <LearningRateTable rows={timing.learningRates} />
        </div>
      </section>

      <section className="stats-band stats-coverage-band">
        <SectionHeading title="Coverage" meta={`${formatInteger(overview.totalMoves)} moves`} />
        <div className="coverage-grid">
          <CoverageMetric
            label="Lichess openings"
            value={`${formatInteger(coverage.lichessGames)} games`}
            percent={coverage.lichessShare}
          />
          <CoverageMetric
            label="Color metadata"
            value={`${formatInteger(coverage.whiteGames)} W / ${formatInteger(coverage.blackGames)} B`}
            percent={coverage.colorCoverage}
          />
          <CoverageMetric
            label="Difficulty model"
            value={`${formatInteger(coverage.difficultyGames)} games`}
            percent={progress.difficultyCoverage}
          />
          <CoverageMetric
            label="Opening lines"
            value={`${formatInteger(coverage.openingLines)} lines`}
            percent={coverage.openingCoverage}
          />
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
  title,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail?: string;
  title?: string;
  tone?: "neutral" | "green" | "violet" | "amber" | "blue" | "rose";
}) {
  return (
    <div className={`stats-metric stats-metric--${tone}`} title={title}>
      <span className="stats-metric-label">{label}</span>
      <strong>{value}</strong>
      {detail && <span className="stats-metric-detail">{detail}</span>}
    </div>
  );
}

function MaiaEloChart({
  points,
  minimum,
  maximum
}: {
  points: MaiaEloSeriesPoint[];
  minimum: number;
  maximum: number;
}) {
  if (points.length === 0) return <EmptyState label="No post-opening history yet" />;

  const width = 960;
  const height = 280;
  const padding = { top: 18, right: 18, bottom: 34, left: 58 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (index: number) => padding.left + (
    points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1)
  );
  const y = (value: number) => padding.top
    + (maximum - value) * chartHeight / (maximum - minimum || 1);
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.elo).toFixed(2)}`)
    .join(" ");
  const bandPath = [
    ...points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.high80).toFixed(2)}`),
    ...points.slice().reverse().map((point, reverseIndex) => {
      const index = points.length - reverseIndex - 1;
      return `L${x(index).toFixed(2)},${y(point.low80).toFixed(2)}`;
    }),
    "Z"
  ].join(" ");
  const yTicks = Array.from({ length: 4 }, (_, index) => (
    minimum + (maximum - minimum) * index / 3
  ));
  const xTicks = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));

  return (
    <div className="stats-chart-wrap stats-elo-chart-wrap">
      <svg
        className="stats-progress-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="elo-chart-title elo-chart-description"
      >
        <title id="elo-chart-title">Maia-equivalent Elo over games</title>
        <desc id="elo-chart-description">
          Twenty-five-game Maia-2 rapid equivalent rating with an eighty percent uncertainty interval.
        </desc>
        {yTicks.map((tick, index) => (
          <g key={tick}>
            <line
              className="stats-chart-gridline"
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="stats-chart-label" x={padding.left - 10} y={y(tick) + 4} textAnchor="end">
              {index === 0
                ? `<${formatInteger(minimum)}`
                : index === yTicks.length - 1
                  ? `${formatInteger(maximum)}+`
                  : formatInteger(tick)}
            </text>
          </g>
        ))}
        <path className="stats-elo-chart-band" d={bandPath} />
        <path className="stats-elo-chart-line" d={linePath} />
        {xTicks.map((index) => (
          <text
            className="stats-chart-label"
            key={index}
            x={x(index)}
            y={height - 9}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
          >
            Game {points[index].game}
          </text>
        ))}
      </svg>
    </div>
  );
}

function SectionHeading({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="stats-section-heading">
      <h2>{title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="stats-legend-item">
      <span className={`stats-legend-swatch ${className}`} />
      {label}
    </span>
  );
}

function ProgressChart({ points }: { points: ProgressSeriesPoint[] }) {
  if (points.length === 0) return <EmptyState label="No game history yet" />;

  const width = 960;
  const height = 300;
  const padding = { top: 18, right: 18, bottom: 34, left: 54 };
  const values = points.flatMap((point) => [
    point.rolling10,
    point.rolling25,
    point.adjusted25,
    point.low80,
    point.high80
  ]);
  const minimum = Math.max(0, Math.floor(Math.min(...values) - 2));
  const maximum = Math.min(100, Math.ceil(Math.max(TARGET_ACCURACY, ...values) + 1));
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (index: number) => padding.left + (
    points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1)
  );
  const y = (value: number) => padding.top + (maximum - value) * chartHeight / (maximum - minimum || 1);
  const pathFor = (valueFor: (point: ProgressSeriesPoint) => number) => points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(valueFor(point)).toFixed(2)}`)
    .join(" ");
  const bandPath = [
    ...points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.high80).toFixed(2)}`),
    ...points.slice().reverse().map((point, reverseIndex) => {
      const index = points.length - reverseIndex - 1;
      return `L${x(index).toFixed(2)},${y(point.low80).toFixed(2)}`;
    }),
    "Z"
  ].join(" ");
  const yTicks = Array.from({ length: 4 }, (_, index) => (
    minimum + (maximum - minimum) * index / 3
  ));
  const xTicks = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));

  return (
    <div className="stats-chart-wrap">
      <svg
        className="stats-progress-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="progress-chart-title progress-chart-description"
      >
        <title id="progress-chart-title">Rolling accuracy over games</title>
        <desc id="progress-chart-description">
          Ten-game, twenty-five-game, and difficulty-adjusted accuracy with an eighty percent interval.
        </desc>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              className="stats-chart-gridline"
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="stats-chart-label" x={padding.left - 10} y={y(tick) + 4} textAnchor="end">
              {tick.toFixed(0)}%
            </text>
          </g>
        ))}
        {minimum <= TARGET_ACCURACY && maximum >= TARGET_ACCURACY && (
          <line
            className="stats-chart-target"
            x1={padding.left}
            x2={width - padding.right}
            y1={y(TARGET_ACCURACY)}
            y2={y(TARGET_ACCURACY)}
          />
        )}
        <path className="stats-chart-band" d={bandPath} />
        <path className="stats-chart-line stats-chart-line--adjusted" d={pathFor((point) => point.adjusted25)} />
        <path className="stats-chart-line stats-chart-line--25" d={pathFor((point) => point.rolling25)} />
        <path className="stats-chart-line stats-chart-line--10" d={pathFor((point) => point.rolling10)} />
        {xTicks.map((index) => (
          <text
            className="stats-chart-label"
            key={index}
            x={x(index)}
            y={height - 9}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
          >
            Game {points[index].game}
          </text>
        ))}
      </svg>
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
  suffix = "",
  wide = false
}: {
  title: string;
  rows: GroupStat[];
  suffix?: string;
  wide?: boolean;
}) {
  return (
    <div className={`stats-breakdown${wide ? " stats-breakdown--wide" : ""}`}>
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
