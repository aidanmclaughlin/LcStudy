.PHONY: setup lint format test serve

setup:
	python -m venv .venv
	. .venv/bin/activate && pip install -U pip && pip install -e .[all] && pip install pre-commit && pre-commit install

lint:
	pre-commit run --all-files

format:
	pre-commit run black --all-files || true
	pre-commit run isort --all-files || true
	pre-commit run ruff --all-files || true

test:
	pytest -q

serve:
	lcstudy up
