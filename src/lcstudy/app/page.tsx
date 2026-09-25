/**
 * Home page - Main game interface.
 *
 * This page renders the chess board and sidebar panels.
 * The actual game logic is handled by the legacy JavaScript
 * loaded as an ES module (main.js).
 *
 * Layout:
 * - Board column: Chessboard (rendered by board.js)
 * - Sidebar: Game-over panel, accuracy summary with Stats access, per-move chart, move list
 */

import Script from "next/script";
import { redirect } from "next/navigation";
import { ArrowUp, ChevronLeft, ChevronRight, X } from "lucide-react";

import { getAuthSession } from "@/lib/auth";
import { StatsView } from "@/components/stats-view";

export default async function HomePage() {
  const session = await getAuthSession();

  if (!session?.user) {
    redirect("/signin");
  }

  return (
    <>
      <Script src="/legacy/js/main.js" strategy="afterInteractive" type="module" />

      <main className="layout-root">
        <div className="layout">
          {/* Chess Board */}
          <div className="board-column">
            <div className="board-shell">
              <div id="board" className="board-surface" />
            </div>
          </div>

          {/* Sidebar Panels */}
          <div className="sidebar">
            {/* Game-over panel: beside the board so the final position stays visible */}
            <section
              id="completion-overlay"
              className="panel completion-panel"
              aria-live="polite"
              aria-labelledby="completion-title"
              aria-hidden="true"
              hidden
            >
              <div className="completion-copy">
                <span className="completion-kicker">Checkmate</span>
                <h2 id="completion-title" className="completion-title">Game complete</h2>
                <p id="completion-summary" className="completion-summary" />
              </div>
              <div className="completion-actions">
                <button id="completion-review" className="btn btn-secondary" type="button">
                  Review
                </button>
                <button id="completion-new" className="btn btn-primary" type="button">
                  New game
                </button>
              </div>
            </section>

            {/* Accuracy Summary Panel */}
            <StatsView>
              <span className="stat-tile">
                <span className="stat-label">100-game accuracy</span>
                <span id="avg-accuracy" className="stat-value">--</span>
                <span className="stat-current">
                  <span className="stat-current-label">Game</span>
                  <span className="stat-value-row">
                    <span id="current-accuracy" className="stat-current-value">--</span>
                    <span id="accuracy-comparison" className="metric-comparison" role="img" aria-hidden="true"><ArrowUp size={12} aria-hidden="true" /></span>
                  </span>
                </span>
              </span>
              <span className="stat-tile">
                <span className="stat-label">100-game pace</span>
                <span id="avg-move-time" className="stat-value">--</span>
                <span className="stat-current">
                  <span className="stat-current-label">Game</span>
                  <span className="stat-value-row">
                    <span id="current-move-time" className="stat-current-value">--</span>
                    <span id="pace-comparison" className="metric-comparison" role="img" aria-hidden="true"><ArrowUp size={12} aria-hidden="true" /></span>
                  </span>
                </span>
              </span>
            </StatsView>

            {/* Move Accuracy Chart Panel */}
            <section className="panel panel-chart" aria-labelledby="move-chart-title">
              <div className="panel-heading move-chart-heading">
                <h2 id="move-chart-title">Move accuracy</h2>
                <span className="move-chart-summary">
                  <span className="move-chart-stat">
                    <span className="move-chart-label">Game</span>
                    <strong id="game-accuracy" className="panel-metric" title="Current game accuracy">--</strong>
                  </span>
                  <span className="move-chart-stat">
                    <span id="move-feedback-label" className="move-chart-label">Move</span>
                    <strong id="move-feedback" className="panel-metric" data-tone="muted" role="status" aria-atomic="true">--</strong>
                  </span>
                </span>
              </div>
              <div className="chart-container">
                <canvas id="move-accuracy-chart" role="img" aria-label="Accuracy of each move in this game" />
              </div>
            </section>

            {/* Move List Panel */}
            <section className="panel panel-history" aria-labelledby="move-list-title">
              <div className="panel-heading">
                <h2 id="move-list-title">Moves</h2>
                <button id="review-exit" className="review-status" type="button" aria-label="Exit review and return to the game" hidden>
                  Reviewing
                  <X size={12} strokeWidth={2.5} aria-hidden="true" />
                </button>
                <div className="move-review-controls" role="group" aria-label="Move review controls">
                  <button id="review-prev" className="review-button" type="button" aria-label="Previous move" disabled>
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <button id="review-next" className="review-button" type="button" aria-label="Next move" disabled>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div id="pgn-moves" className="pgn-moves">
                <div id="move-list" className="move-list">
                  <span className="pgn-empty">No moves yet</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
