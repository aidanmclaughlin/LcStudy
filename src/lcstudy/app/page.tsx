/**
 * Home page - Main game interface.
 *
 * This page renders the chess board and sidebar panels.
 * The actual game logic is handled by the legacy JavaScript
 * loaded as an ES module (main.js).
 *
 * Layout:
 * - Board column: Chessboard powered by chessboard-element
 * - Sidebar: Stats, charts (accuracy over games, per-move accuracy), move history
 */

import Script from "next/script";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";
import { CompletionSignOutButton } from "@/components/auth-controls";

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
            <div className="panel panel-stats" aria-label="Accuracy summary">
              <div className="stat-tile">
                <span className="stat-label">All-time</span>
                <span id="all-time-accuracy" className="stat-value">0.0%</span>
              </div>
              <div className="stat-tile">
                <span className="stat-label">10-game</span>
                <span id="avg-accuracy" className="stat-value">0.0%</span>
              </div>
              <div className="stat-tile">
                <span className="stat-label">1-game</span>
                <span id="game-accuracy" className="stat-value">0.0%</span>
              </div>
              <div className="stat-tile">
                <span className="stat-label">Move</span>
                <span id="move-feedback" className="stat-value stat-value--muted">
                  Pick move
                </span>
              </div>
            </div>

            {/* Hours Left Summary */}
            <div className="panel panel-goal">
              <div className="panel-section-heading">
                <h2>Hours Left to 90%</h2>
                <span
                  id="hours-left-count"
                  className="panel-count"
                  title="Power-law estimate of time remaining to the 90% rolling average target"
                >
                  0 played / --h left
                </span>
              </div>
            </div>

            {/* Game Accuracy Chart Panel */}
            <div className="panel panel-chart">
              <div className="panel-section-heading">
                <h2>25-Game Accuracy</h2>
                <div className="panel-heading-actions">
                  <span id="accuracy-chart-count" className="panel-count">0 games</span>
                  <Link className="panel-stats-link" href="/stats">
                    Stats
                  </Link>
                </div>
              </div>
              <div className="chart-container">
                <canvas id="accuracy-chart" />
              </div>
            </div>

            {/* Move Accuracy Chart Panel */}
            <div className="panel panel-chart">
              <div className="panel-section-heading">
                <h2>Accuracy Over Moves</h2>
                <span id="move-chart-count" className="panel-count">0 moves</span>
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
