from __future__ import annotations

import logging
import logging.handlers
import sys
from pathlib import Path

from .settings import get_settings


def setup_logging() -> None:
    settings = get_settings()

    log_level = getattr(logging, settings.logging.level.upper(), logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    formatter = logging.Formatter(settings.logging.format)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    if settings.logging.file_path:
        file_path = Path(settings.logging.file_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)

        file_handler = logging.handlers.RotatingFileHandler(
            file_path, maxBytes=10 * 1024 * 1024, backupCount=5
        )
        file_handler.setLevel(log_level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

    lcstudy_logger = logging.getLogger("lcstudy")
    lcstudy_logger.setLevel(log_level)

    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_access_logger = logging.getLogger("uvicorn.access")

    if settings.server.debug:
        uvicorn_logger.setLevel(logging.DEBUG)
        uvicorn_access_logger.setLevel(logging.DEBUG)
    else:
        uvicorn_logger.setLevel(logging.INFO)
        uvicorn_access_logger.setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"lcstudy.{name}")
