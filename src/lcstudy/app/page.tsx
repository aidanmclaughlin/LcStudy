/**
 * Home page - Main game interface.
 *
 * This page renders the chess board and sidebar panels.
 * The actual game logic is handled by the legacy JavaScript
 * loaded as an ES module (main.js).
 *
 * Layout:
 * - Board column: Chessboard powered by chessboard-element
 * - Sidebar: Accuracy summary with Stats access, per-move chart, move history
 */

import Script from "next/script";
import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";
import { CompletionSignOutButton } from "@/components/auth-controls";
import { StatsView } from "@/components/stats-view";
import { ArrowUp } from "lucide-react";

export default async function HomePage() {
  const session = await getAuthSession();

  if (!session?.user) {
    redirect("/signin");
  }

  return (
    <>
      <Script src="/legacy/js/main.js" strategy="afterInteractive" type="module" />

      <div className="wrap layout-root">
        <div className="layout">
          {/* Chess Board */}
          <div className="board-column">
            <div className="board-shell">
              <div id="board" className="board-surface" />
              <div
                id="completion-overlay"
                className="completion-overlay"
                aria-live="polite"
                aria-hidden="true"
                hidden
              >
                <div className="completion-dock">
                  <div className="completion-copy">
                    <span className="completion-kicker">Checkmate</span>
                    <span className="completion-title">Game complete</span>
                  </div>
                  <div className="completion-actions">
                    <button
                      id="completion-review"
                      className="btn btn-sm completion-review"
                      type="button"
                    >
                      Review
                    </button>
                    <button
                      id="completion-new"
                      className="btn btn-sm"
                      type="button"
                    >
                      New Game
                    </button>
                    <CompletionSignOutButton />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Panels */}
          <div className="sidebar">
            {/* Accuracy Summary Panel */}
            <StatsView>
              <span className="stat-tile">
                <span className="stat-label">100-game</span>
                <span className="stat-value-row">
                  <span id="avg-accuracy" className="stat-value">--</span>
                  <span id="accuracy-comparison" className="metric-comparison" role="img" aria-hidden="true"><ArrowUp size={12} aria-hidden="true" /></span>
                </span>
              </span>
              <span className="stat-tile">
                <span className="stat-label">100-game pace</span>
                <span className="stat-value-row">
                  <span id="avg-move-time" className="stat-value">--</span>
                  <span id="pace-comparison" className="metric-comparison" role="img" aria-hidden="true"><ArrowUp size={12} aria-hidden="true" /></span>
                </span>
              </span>
              <span className="stat-tile">
                <span className="stat-label">Move</span>
                <span id="move-feedback" className="stat-value stat-value--muted">
                  Pick move
                </span>
              </span>
            </StatsView>

            {/* Move Accuracy Chart Panel */}
            <div className="panel panel-chart">
              <div className="panel-section-heading move-chart-heading">
                <h2>Accuracy Over Moves</h2>
                <span className="move-chart-summary">
                  <strong id="game-accuracy" className="panel-metric" title="Current game accuracy">--</strong>
                  <span id="move-chart-count" className="panel-count">0 moves</span>
                </span>
              </div>
              <div className="chart-container">
                <canvas id="move-accuracy-chart" />
              </div>
            </div>

            {/* Move History Panel */}
            <div className="panel panel-history">
              <div className="panel-section-heading">
                <h2>Recent Moves</h2>
                <div className="move-review-controls" aria-label="Move review controls">
                  <button
                    id="review-prev"
                    className="btn btn-icon review-button"
                    type="button"
                    aria-label="Previous move"
                  >
                    <span className="review-icon review-icon-prev" aria-hidden="true" />
                  </button>
                  <button
                    id="review-next"
                    className="btn btn-icon review-button"
                    type="button"
                    aria-label="Next move"
                  >
                    <span className="review-icon review-icon-next" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div id="pgn-moves" className="pgn-moves">
                <div id="move-list" className="meta">
                  Game not started
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
