# Repository Guidelines

## Project Structure & Modules
- Source: `src/lcstudy/` (controllers, services, repositories, domain, config, scripts, templates, static).
- Tests: `tests/` with `test_*.py` modules.
- Examples: `examples/` for sample data and walkthroughs.
- Packaging: `pyproject.toml` (console scripts: `lcstudy`, `lcstudy-up`), `MANIFEST.in`.

## Build, Test, and Dev Commands
- `make setup`: create venv, install editable package with extras, set up pre-commit.
- `make serve`: run the FastAPI app locally (`lcstudy web --host 127.0.0.1 --port 8000`).
- `make test`: run pytest quietly (`pytest -q`).
- `make lint` / `make format`: run Black, Ruff, isort, mypy hooks.
- Engines/networks: `lcstudy install lc0|bestnet|maia|all`; one-shot run: `lcstudy up`.

## Coding Style & Naming
- Python 3.9+, 4-space indentation, type hints for new/changed code.
- Naming: modules `snake_case.py`, classes `PascalCase`, functions/vars `snake_case`.
- Tools: Black (format), isort (imports), Ruff (lint), mypy (types). Use `pre-commit` locally.

## Testing Guidelines
- Framework: `pytest`. Place tests under `tests/` named `test_*.py`.
- Keep tests independent of network and external engines; mock repositories/services as in examples.
- Run locally with `pytest -q` or `make test`. Aim to cover services and repositories.

## Commit & Pull Requests
- Use conventional commits (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- PRs must include: clear description, linked issues, steps to test, and screenshots for UI changes.
- Keep changes focused; update docs (README/AGENTS) and add tests when behavior changes.

## Agent-Specific Notes
- Agents: Leela (lc0) and Maia (various levels) run via wrappers in `lcstudy.services.engine_service` and `lcstudy.engines`.
- Precomputed games (seeds) power grading; generator lives in `lcstudy.scripts.generate_seeds`.
- Data paths: binaries `~/.lcstudy/bin`, nets `~/.lcstudy/nets`, seeds `~/.lcstudy/precomputed/games`.

## Configuration Tips
- Useful env vars: `LCSTUDY_DATA_DIR`, `LCSTUDY_LC0_PATH`, `LCSTUDY_DEFAULT_NODES`, `LCSTUDY_THREADS`, `LCSTUDY_LOG_LEVEL`, `LCSTUDY_HOST`, `LCSTUDY_PORT`.
- Keep code engine-agnostic on request paths; avoid introducing live engine calls into web handlers.
