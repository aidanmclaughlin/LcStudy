# LcStudy

An educational app to help people learn and experiment with Leela Chess Zero (LcZero).

This repository is a minimal starter with a Python package, a simple CLI, and a place to grow web and notebook-based lessons.

## Quick start

Requirements: Python 3.9+

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -e .
lcstudy --help
```

## Goals
- Lower the barrier to trying LcZero
- Offer guided lessons and exercises
- Provide a playground to run positions against lc0 and analyze ideas

## Structure
- src/lcstudy: core package
- src/lcstudy/cli.py: entry point CLI
- lessons/: space for notebooks and guided content
- examples/: minimal sample positions, configs

## Next steps
- Detect and guide installation of lc0 and required backends
- Add a lightweight web UI and interactive lessons
- Add engines integration (UCI) and basic analysis workflows

