import Script from "next/script";
import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";

export default async function HomePage() {
  const session = await getAuthSession();

  if (!session?.user) {
    redirect("/signin");
  }

  return (
    <>
      <Script src="https://cdn.jsdelivr.net/npm/chart.js" strategy="beforeInteractive" />
      <Script src="/legacy/js/main.js" strategy="afterInteractive" />
      <div
        className="wrap"
        style={{
          width: "100%",
          height: "100vh",
          padding: "1vh",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "3vw",
            alignItems: "flex-start",
            height: "90vh"
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              height: "100%"
            }}
          >
            <div
              style={{
                textAlign: "center",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center"
              }}
            >
              <div
                id="board"
                style={{
                  width: "min(70vw, 90vh)",
                  height: "min(70vw, 90vh)",
                  margin: "0 auto"
                }}
              />
            </div>
          </div>
          <div
            style={{
              width: "25vw",
              minWidth: "280px",
              display: "flex",
              flexDirection: "column",
              gap: "1vh",
              height: "100%",
              overflow: "hidden"
            }}
          >
            <div
              className="panel"
              style={{
                padding: "2vh 3vh",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <h1
                style={{
                  margin: 0,
                  color: "#f8fafc",
                  fontSize: "1.2rem",
                  fontWeight: 800
                }}
              >
                LcStudy
              </h1>
              <div style={{ display: "flex", gap: "0.5vh", alignItems: "center" }}>
                <span
                  id="streak-pill"
                  className="streak-pill"
                  style={{
                    padding: "0.5vh 1vw",
                    fontSize: "0.8rem",
                    whiteSpace: "nowrap",
                    borderRadius: "10px"
                  }}
                >
                  Streak x1
                </span>
                <button
                  id="new"
                  className="btn"
                  style={{
                    padding: "0.5vh 1vw",
                    fontSize: "0.8rem",
                    whiteSpace: "nowrap"
                  }}
                >
                  New Game
                </button>
              </div>
            </div>

            <div
              className="panel"
              style={{
                padding: "2.5vh 3vh",
                flex: 2,
                minHeight: 0,
                display: "flex",
                flexDirection: "column"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1.5vh"
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    fontWeight: 600
                  }}
                >
                  Avg Attempts Over Time
                </h2>
                <span
                  style={{
                    color: "#f59e0b",
                    fontWeight: 600,
                    fontSize: "0.75rem"
                  }}
                >
                  Current Average: <span id="avg-attempts">0</span>
                </span>
              </div>
              <canvas id="accuracy-chart" style={{ width: "100%", flex: 1 }} />
            </div>

            <div
              className="panel"
              style={{
                padding: "2.5vh 3vh",
                flex: 2,
                minHeight: 0,
                display: "flex",
                flexDirection: "column"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1.5vh"
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    fontWeight: 600
                  }}
                >
                  Attempts per Move
                </h2>
                <span
                  id="attempts-remaining"
                  style={{
                    color: "#ef4444",
                    fontWeight: 600,
                    fontSize: "0.75rem"
                  }}
                >
                  10 left
                </span>
              </div>
              <canvas id="attempts-chart" style={{ width: "100%", flex: 1 }} />
            </div>

            <div
              className="panel"
              style={{
                padding: "2.5vh 3vh",
                flex: "0 0 auto",
                minHeight: "8vh",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1.5vh"
                }}
              >
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
              <div
                id="pgn-moves"
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: "0.7rem",
                  lineHeight: 1.3,
                  overflowX: "scroll",
                  whiteSpace: "nowrap",
                  padding: "0.5vh 0",
                  scrollbarWidth: "none",
                  msOverflowStyle: "none"
                }}
              >
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
