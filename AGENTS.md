# Agent Guide (Read Me First)

This document is for AI coding agents working on this repository. It consolidates structure, constraints, workflows, and high-signal tips so you can move fast without breaking things.

## Overview
- App: Practice “predict Leela’s move” using precomputed Leela vs Maia games.
- Components: CLI (`lcstudy`), FastAPI web app, lightweight services and repos.
- Principle: Keep request paths fast and engine-agnostic; long engine work happens offline/background.

## Source Layout
- `src/lcstudy/`
  - `cli.py`: Console entry (`lcstudy`, `lcstudy-up`), installers, doctor, app launchers.
  - `webapp.py`: FastAPI app, static/templates mounting, routers, background cleanup + seed generator.
  - `engines.py`: Paths, engine helpers (lc0), option mapping, PV parsing, scoring utils.
  - `install.py`: Download helpers for lc0 and networks (best LcZero, Maia levels).
  - `controllers/`: FastAPI routers, DI, error registration.
  - `services/`: Game/session logic, analysis, engine orchestration.
  - `repositories/`: In-memory stores for sessions, history, precomputed seeds.
  - `domain/`: Data models and request/response validation (Pydantic v2 validators).
  - `config/`: Settings and logging plumbing.
  - `scripts/`: Seed generator (`generate_seeds`), invoked by webapp on startup.
  - `templates/`, `static/`: Bundled UI assets (no external CDN).
- `tests/`: Pytest suite, isolated from network/engines.
- `examples/`: Sample data and walkthroughs (optional).

## How To Run
- Local quick start:
  - `python -m venv .venv && source .venv/bin/activate`
  - `pip install -e .[all]`
  - `lcstudy up` (ensures lc0 + nets if missing; launches web app)
- Make targets (optional but supported): `make setup`, `make test`, `make lint`, `make serve`.
- Web app: `lcstudy web --host 127.0.0.1 --port 8000` (no auto-install).

## Testing
- Runner: `pytest -q`. `pytest.ini` sets `pythonpath = .` so imports of `src/...` work everywhere.
- Constraints: Do not perform network I/O or require actual engines in tests. Mock repositories/services.
- Scope: Prefer unit tests for services/repositories. Keep FastAPI route tests engine-agnostic.

## CI (GitHub Actions)
- Python 3.11, installs with `pip install -e .[all]`.
- Lint: `ruff check src`. Types: `mypy src`. Tests: `pytest -q`.
- Tip: If imports fail with `No module named 'src'`, ensure `pytest.ini` includes `pythonpath = .`.

## Coding Style
- Python 3.9+, 4-space indent, type hints on new/changed code.
- Naming: modules `snake_case.py`; classes `PascalCase`; functions/vars `snake_case`.
- Tools: Black, Ruff, isort, mypy via `pre-commit`. Run `make lint` for all hooks.

## Engines & Data
- Binaries: `~/.lcstudy/bin`; Networks: `~/.lcstudy/nets`.
- Installer helpers: `lcstudy install lc0|bestnet|maia|all`.
- Precomputed games: `~/.lcstudy/precomputed/games` (filled by `scripts.generate_seeds`).
- Web startup spawns the seed generator subprocess; request handlers do not call engines.

## Configuration
- Env vars: `LCSTUDY_DATA_DIR`, `LCSTUDY_LC0_PATH`, `LCSTUDY_DEFAULT_NODES`, `LCSTUDY_THREADS`, `LCSTUDY_LOG_LEVEL`, `LCSTUDY_HOST`, `LCSTUDY_PORT`.
- Keep endpoints engine-agnostic; long work belongs in background helpers or scripts.

## Common Tasks (Agent Playbook)
- Add a CLI subcommand: extend `build_parser()` in `cli.py`, implement handler, add tests under `tests/`.
- Update web route: modify or add a router in `controllers/`, ensure schemas live in `domain/`, add tests.
- Engine utility change: keep `engines.py` self-contained; do not leak engine calls into controllers.
- New static/template: add under `src/lcstudy/static` or `templates`; MANIFEST.in already includes them.

## Guardrails & Non-Goals
- No network access in tests; mock IO. Web handlers must not block on engines.
- Do not store user data in repo; user data lives under `~/.lcstudy`.
- Keep changes focused; update docs and tests when behavior changes.

## Housekeeping
- `.gitignore` covers caches, coverage, logs, tool dirs. Avoid committing `.venv/` or local artifacts.
- We removed duplicate/empty test scaffolds and various caches. Prefer adding only meaningful files.

If in doubt, ask for clarification. When changing behavior, prefer small PRs with tests.
