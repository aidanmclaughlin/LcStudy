/**
 * Home page - Main game interface.
 *
 * This page renders the chess board and sidebar panels.
 * The actual game logic is handled by the legacy JavaScript
 * loaded as an ES module (main.js).
 *
 * Layout:
 * - Board column: Chessboard powered by chessboard-element
 * - Sidebar: Header, charts (accuracy over games, per-move accuracy), move history
 */

import Script from "next/script";
import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";
import { AuthControls } from "@/components/auth-controls";

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
            </div>
          </div>

          {/* Sidebar Panels */}
          <div className="sidebar">
            {/* Header Panel */}
            <div className="panel panel-header">
              <span className="header-title">LcStudy</span>
              <div className="panel-header-controls">
                <span id="streak-pill" className="streak-pill">
                  Streak x1
                </span>
                <button id="new" className="btn btn-sm">
                  New Game
                </button>
                <button
                  id="zen-toggle"
                  className="btn btn-sm btn-icon"
                  type="button"
                  aria-label="Enter zen mode"
                  aria-pressed="false"
                >
                  <span className="zen-icon" aria-hidden="true" />
                </button>
                <AuthControls />
              </div>
            </div>

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
                <span className="stat-label">Last move</span>
                <span id="move-feedback" className="stat-value stat-value--muted">
                  Pick move
                </span>
              </div>
            </div>

            {/* Accuracy Chart Panel */}
            <div className="panel panel-chart">
              <div className="panel-section-heading">
                <h2>Accuracy Over Time</h2>
              </div>
              <div className="chart-container">
                <canvas id="accuracy-chart" />
              </div>
            </div>

            {/* Move Accuracy Chart Panel */}
            <div className="panel panel-chart">
              <div className="panel-section-heading">
                <h2>Accuracy per Move</h2>
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
      <button
        id="zen-exit"
        className="btn btn-icon zen-exit"
        type="button"
        aria-label="Exit zen mode"
      >
        <span className="zen-exit-icon" aria-hidden="true" />
      </button>
    </>
  );
}
