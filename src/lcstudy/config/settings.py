from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class DatabaseSettings:
    url: str = "sqlite:///lcstudy.db"
    echo: bool = False
    pool_size: int = 10
    max_overflow: int = 20


@dataclass
class EngineSettings:
    lc0_executable: Optional[str] = None
    default_nodes: int = 2000
    # Low-cost nodes for correctness validation (fast path)
    validation_nodes: int = 150
    default_threads: Optional[int] = None
    timeout_seconds: float = 30.0
    backend: Optional[str] = None


@dataclass
class ServerSettings:
    host: str = "127.0.0.1"
    port: int = 8000
    debug: bool = False
    reload: bool = False
    workers: int = 1


@dataclass
class LoggingSettings:
    level: str = "INFO"
    format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    file_path: Optional[str] = None


@dataclass
class SessionSettings:
    default_timeout: int = 3600
    cleanup_interval: int = 300
    max_sessions: int = 1000


@dataclass
class Settings:
    database: DatabaseSettings = field(default_factory=DatabaseSettings)
    engine: EngineSettings = field(default_factory=EngineSettings)
    server: ServerSettings = field(default_factory=ServerSettings)
    logging: LoggingSettings = field(default_factory=LoggingSettings)
    session: SessionSettings = field(default_factory=SessionSettings)

    data_dir: Path = field(default_factory=lambda: Path.home() / ".lcstudy")
    networks_dir: Optional[Path] = None
    # Controls background seed (auto-game) generation watchdog in web runtime
    enable_seed_generator: bool = True

    @classmethod
    def from_env(cls) -> Settings:
        settings = cls()

        if db_url := os.getenv("LCSTUDY_DATABASE_URL"):
            settings.database.url = db_url

        if debug := os.getenv("LCSTUDY_DEBUG"):
            settings.server.debug = debug.lower() in ("true", "1", "yes")

        if host := os.getenv("LCSTUDY_HOST"):
            settings.server.host = host

        if port := os.getenv("LCSTUDY_PORT"):
            settings.server.port = int(port)

        if log_level := os.getenv("LCSTUDY_LOG_LEVEL"):
            settings.logging.level = log_level.upper()

        if data_dir := os.getenv("LCSTUDY_DATA_DIR"):
            settings.data_dir = Path(data_dir)

        if lc0_path := os.getenv("LCSTUDY_LC0_PATH"):
            settings.engine.lc0_executable = lc0_path

        if nodes := os.getenv("LCSTUDY_DEFAULT_NODES"):
            settings.engine.default_nodes = int(nodes)

        if threads := os.getenv("LCSTUDY_THREADS"):
            settings.engine.default_threads = int(threads)

        # Background seed generation toggle (default: enabled)
        if enable := os.getenv("LCSTUDY_ENABLE_SEEDS"):
            settings.enable_seed_generator = enable.lower() in ("1", "true", "yes", "on")
        if disable := os.getenv("LCSTUDY_DISABLE_SEEDS"):
            # Explicit disable takes precedence if set truthy
            if disable.lower() in ("1", "true", "yes", "on"):
                settings.enable_seed_generator = False

        settings.networks_dir = settings.data_dir / "networks"

        return settings


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings.from_env()
    return _settings
