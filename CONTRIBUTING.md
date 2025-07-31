Contributing to LcStudy

Development quickstart
- Python 3.9+
- Create venv and install editable with extras
  - python -m venv .venv
  - source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
  - pip install -e .[all]
- Install pre-commit hooks (optional but recommended)
  - pip install pre-commit
  - pre-commit install

Common tasks
- Run CLI: lcstudy --help
- Launch web app: lcstudy web --host 127.0.0.1 --port 8000
- One-command up (ensure engines/nets): lcstudy up
- Run tests: pytest

Project layout
- src/lcstudy
  - config/: settings and logging
  - controllers/: FastAPI routers and DI helpers
  - services/: engine, analysis, and game logic
  - repositories/: session and history persistence
  - domain/: data models and request/response validation
  - static/, templates/: web UI assets

Environment variables
- LCSTUDY_DATA_DIR: override data directory (default: ~/.lcstudy)
- LCSTUDY_LC0_PATH: path to lc0 executable
- LCSTUDY_DEFAULT_NODES: default analysis nodes
- LCSTUDY_THREADS: engine threads
- LCSTUDY_LOG_LEVEL: INFO, DEBUG, etc.
- LCSTUDY_HOST, LCSTUDY_PORT: server bind settings

Conventional commits
- Please use conventional commit messages (feat:, fix:, docs:, refactor:, test:, chore:, etc.).

Code style
- Black, isort, ruff linters enabled via pre-commit.
- mypy for type checking is encouraged for new/changed code.

