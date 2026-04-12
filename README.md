# LcStudy

Learn to think like Leela (LcZero). LcStudy helps you practice predicting Leela's moves while playing against Maia (human-like) engines.

## Two Versions

- **Vercel/Next.js** (`src/lcstudy/`): Deployed web app with Google auth and Postgres persistence. See `src/lcstudy/README.md`.
- **Python/FastAPI** (legacy): Local CLI and web app. See below.

**Looking for the engine/agent details?** See AGENTS.md

## Quick start

Requirements: Python 3.9+

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e .[all]

# One-command setup (install lc0 + networks if missing) and launch the app
lcstudy up

# Inspect the CLI
lcstudy --help
```

First run behavior
- Single command: `lcstudy up` is all you need. It ensures lc0 and networks are installed if missing, launches the web app, and starts the background seed generator.
- Disable background generation at runtime with `lcstudy up --no-seeds` (or via env `LCSTUDY_DISABLE_SEEDS=1`).
- Immediate play: the app bundles a small set of precomputed PGNs so you can start right away without waiting for generation.
- Background top-up: a generator process fills `~/.lcstudy/precomputed/games` (idles once a healthy pool exists). You can keep playing while it generates.

## What you get

- Local web app to practice “predict Leela’s move” against Maia (human-like) engines
- Background generator that produces Leela vs Maia PGNs for fast, offline grading
- Simple CLI to install lc0 and download networks
- Everything runs locally; static assets are bundled

How it works at a glance
- When you start the web app, a background process can generate Leela vs Maia games (seeds) into your data directory.
- The UI serves these precomputed games: you play as Leela; Maia replies instantly from the precomputed line.
- Your guesses are graded against the expected Leela move from the current game/ply.
- No long engine calls are required during requests; it feels snappy even on modest machines.

See AGENTS.md for the engine/agent model, data locations, and generation details.

## Install and run

```bash
# Launch the web app (installs if missing, then starts FastAPI/uvicorn)
lcstudy up

# Disable background seed generation
lcstudy up --no-seeds
```

Notes
- macOS (including Apple Silicon) works with lc0 builds that support the appropriate backend; lc0 typically auto-detects the best backend.
- Default locations: lc0 lives in ~/.lcstudy/bin and networks in ~/.lcstudy/nets.
- If a download ever fails, you can place .pb.gz files manually in ~/.lcstudy/nets (names like BT4-it332.pb.gz, maia-1500.pb.gz, ...).
- Precomputed games are written to ~/.lcstudy/precomputed/games by the background generator.

## CLI cheatsheet

- lcstudy up — ensure installs exist and run the app
- lcstudy up --no-seeds — run the app without background seed generation

## Project layout

- src/lcstudy/: Next.js/Vercel app (primary)
  - app/: Next.js pages and API routes
  - public/legacy/: Original HTML/CSS/JS UI
  - data/pgn/: Precomputed Leela vs Maia games
  - lib/: Database and game logic
- tools/: Offline utilities
  - generate_games.py: Generate Leela vs Maia PGN files
- examples/: placeholder for sample positions and walkthroughs

## Configuration

Environment variables
- LCSTUDY_DATA_DIR: override data directory (default: ~/.lcstudy)
- LCSTUDY_LC0_PATH: path to lc0 executable
- LCSTUDY_DEFAULT_NODES: default engine nodes (used by helpers)
- LCSTUDY_THREADS: engine threads
- LCSTUDY_LOG_LEVEL: INFO, DEBUG, etc.
- LCSTUDY_HOST, LCSTUDY_PORT: server bind settings
- LCSTUDY_DISABLE_SEEDS=1 (or LCSTUDY_ENABLE_SEEDS=0): disable background seed generator

Data locations
- Binaries: ~/.lcstudy/bin
- Networks: ~/.lcstudy/nets
- Precomputed games: ~/.lcstudy/precomputed/games
- Game history JSON: ~/.lcstudy/game_history.json

## Developing

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e .[all]

# Optional: pre-commit hooks
pip install pre-commit
pre-commit install

# Run tests
pytest -q
```

See CONTRIBUTING.md for more details.

## Troubleshooting

- **lc0 not found**: Install via `brew install lc0` or your system package manager
- **Best net download failed**: Place BT4-it332 at `~/.lcstudy/nets/BT4-it332.pb.gz`
- **Maia nets missing**: Download from [maia-chess releases](https://github.com/CSSLab/maia-chess/releases) into `~/.lcstudy/nets`
- **Need more games**: Generate offline with `python tools/generate_games.py --count 100` (see `tools/README.md`)

## Roadmap ideas

- Richer lesson content and interactive exercises
- Live streaming analysis (SSE/WebSocket) in the UI
