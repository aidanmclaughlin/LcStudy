# LcStudy

An educational app to help people learn and experiment with Leela Chess Zero (LcZero).

This repository is a minimal starter with a Python package, a simple CLI, and a place to grow web and notebook-based lessons.

## Quick start

Requirements: Python 3.9+

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -e .[all]
lcstudy --help
```

## Goals
- Lower the barrier to trying LcZero
- Offer guided lessons and exercises
- Provide a playground to run positions against lc0 and analyze ideas

## Structure
- src/lcstudy: core package
  - config/: settings and logging
  - controllers/: FastAPI routers and DI helpers
  - services/: engine, analysis, and game logic
  - repositories/: session and history persistence
  - domain/: data models and request/response validation
  - static/, templates/: web UI assets
  - webapp.py: app wiring and startup/shutdown

## New: Learn-to-think-like-Leela web app

This repo includes an experimental local web app that helps you learn to emulate Leela's moves while playing against human-like Maia engines.

Features
- Automatically install the latest LcZero binary and download networks (best Leela net and Maia nets 1100–1900)
- Spin up two engines locally: Leela (best net) and Maia (selected level)
- You predict Leela's move each turn; your score reflects how close you are to Leela's choice
- Maia moves quickly with shallow search; first 10 plies are sampled with temperature to diversify openings
- Always analyze from Leela's perspective; Leela always plays the best move

Usage
```bash
# Install
lcstudy install lc0         # downloads latest lc0 binary
lcstudy install bestnet     # downloads best LcZero network
lcstudy install maia        # downloads all Maia networks (1100..1900)
# or everything at once
lcstudy install all

# Single-command setup and run
lcstudy up  # installs lc0 + best net + Maia nets (if missing) and launches the web app

# Or run the web app directly (assuming installs are done)
lcstudy web --host 127.0.0.1 --port 8000
```

Notes
- Apple Silicon is supported by preferring the Metal backend for lc0 on macOS.
- Networks are stored in ~/.lcstudy/nets and the lc0 binary in ~/.lcstudy/bin by default.
- You can override the storage location by setting LCSTUDY_HOME to a directory path.
- If automatic network downloads fail (e.g., due to API/URL changes), place .pb.gz files in ~/.lcstudy/nets (names: lczero-best.pb.gz, maia-1500.pb.gz, etc.).
- Static assets are bundled locally; the UI does not rely on external chess piece URLs.

Environment variables
- LCSTUDY_DATA_DIR: override data directory (default: ~/.lcstudy)
- LCSTUDY_LC0_PATH: path to lc0 executable
- LCSTUDY_DEFAULT_NODES: default analysis nodes
- LCSTUDY_THREADS: engine threads
- LCSTUDY_LOG_LEVEL: INFO, DEBUG, etc.
- LCSTUDY_HOST, LCSTUDY_PORT: server bind settings

## Next steps
- Add WebSocket/SSE streaming for analysis updates (SSE endpoint available)
- Expand lesson content and interactive exercises
