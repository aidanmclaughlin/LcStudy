# LcStudy

Learn to think like Leela (LcZero). LcStudy is a small Python project with a CLI and a local web app that helps you practice predicting Leela’s moves while playing against Maia engines.

The repo is intentionally minimal: a Python package, FastAPI-based web app, and just enough plumbing to install engines/networks and generate training games locally.

• Looking for the engine/agent details? See AGENTS.md

## Quick start

Requirements: Python 3.9+

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e .[all]

# One-command setup (install lc0 + networks if missing) and launch the app
lcstudy up

# Or just inspect the CLI
lcstudy --help
```

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
# Install helpers
lcstudy install lc0         # download latest lc0 binary
lcstudy install bestnet     # download the current best LcZero network
lcstudy install maia        # download Maia networks (1100..1900)
# Or everything at once
lcstudy install all

# Launch the web app (installs if missing, then starts FastAPI/uvicorn)
lcstudy up

# Alternatively, run without the auto-install step
lcstudy web --host 127.0.0.1 --port 8000
```

Notes
- macOS (including Apple Silicon) works with lc0 builds that support the appropriate backend; lc0 typically auto-detects the best backend.
- Default locations: lc0 lives in ~/.lcstudy/bin and networks in ~/.lcstudy/nets.
- If a download ever fails, you can place .pb.gz files manually in ~/.lcstudy/nets (names like lczero-best.pb.gz, maia-1500.pb.gz, …).
- Precomputed games are written to ~/.lcstudy/precomputed/games by the background generator.

## CLI cheatsheet

- lcstudy version — print package version
- lcstudy doctor — check your environment (lc0 and networks)
- lcstudy install lc0|bestnet|maia|all — install helpers and networks
- lcstudy web — run the web app (no auto-install)
- lcstudy up — ensure installs exist, optionally open a browser, and run the app

## Project layout

- src/lcstudy
  - config/: settings and logging
  - controllers/: FastAPI routers and DI helpers
  - services/: engine, analysis, game logic
  - repositories/: in-memory sessions, history store, precomputed seeds
  - domain/: data models and request/response validation
  - static/, templates/: bundled UI assets
  - webapp.py: app wiring and lifecycle
- examples/: placeholder for sample positions and walkthroughs

## Configuration

Environment variables
- LCSTUDY_DATA_DIR: override data directory (default: ~/.lcstudy)
- LCSTUDY_LC0_PATH: path to lc0 executable
- LCSTUDY_DEFAULT_NODES: default engine nodes (used by helpers)
- LCSTUDY_THREADS: engine threads
- LCSTUDY_LOG_LEVEL: INFO, DEBUG, etc.
- LCSTUDY_HOST, LCSTUDY_PORT: server bind settings

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

- lc0 not found: install via lcstudy install lc0 or your system package manager; ensure lc0 is on PATH
- Best net download failed: place a .pb.gz at ~/.lcstudy/nets/lczero-best.pb.gz
- Maia nets missing: run lcstudy install maia or drop maia-<level>.pb.gz files into ~/.lcstudy/nets
- The UI says “No precomputed game available”: the app can still run, but grading requires precomputed games. Let the background generator run for a bit (lcstudy up), or generate seeds yourself with: python -m lcstudy.scripts.generate_seeds

## Roadmap ideas

- Richer lesson content and interactive exercises
- Live streaming analysis (SSE/WebSocket) in the UI
