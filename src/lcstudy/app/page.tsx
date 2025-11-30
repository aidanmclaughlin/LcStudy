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
      <Script src="/legacy/js/main.js" strategy="afterInteractive" />
      <div className="wrap layout-root" style={{ minHeight: "100vh" }}>
        <div className="layout">
          <div className="board-column">
            <div className="board-shell">
              <div id="board" className="board-surface" />
            </div>
          </div>
          <div className="sidebar">
            <div className="panel panel-header">
              <span className="header-title">LcStudy</span>
              <div className="panel-header-controls">
                <span id="streak-pill" className="streak-pill">
                  Streak x1
                </span>
                <button id="new" className="btn btn-sm">
                  New Game
                </button>
                <AuthControls />
              </div>
            </div>

            <div className="panel panel-chart">
              <div className="panel-section-heading">
                <h2
                  style={{
                    margin: 0,
                    color: "#f8fafc",
                    fontSize: "0.85rem",
                    fontWeight: 600
                  }}
                >
                  Avg Attempts Over Time
                </h2>
                <span className="panel-metric">
                  Current Average: <span id="avg-attempts">0</span>
                </span>
              </div>
              <div className="chart-container">
                <canvas id="accuracy-chart" />
              </div>
            </div>

            <div className="panel panel-chart">
              <div className="panel-section-heading">
                <h2
                  style={{
                    margin: 0,
                    color: "#f8fafc",
                    fontSize: "0.85rem",
                    fontWeight: 600
                  }}
                >
                  Attempts per Move
                </h2>
                <span id="attempts-remaining" className="panel-metric panel-metric--accent">
                  10 left
                </span>
              </div>
              <div className="chart-container">
                <canvas id="attempts-chart" />
              </div>
            </div>

            <div className="panel panel-history">
              <div className="panel-section-heading">
                <h2
                  style={{
                    margin: 0,
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    fontWeight: 600
                  }}
                >
                  Recent Moves
                </h2>
                <div style={{ display: "flex", gap: "1vh", alignItems: "center" }} />
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
