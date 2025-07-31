from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .config.logging import get_logger, setup_logging
from .controllers.deps import (get_analysis_service, get_engine_service,
                               get_session_repository)
from .controllers.errors import register_exception_handlers
from .controllers.health_controller import router as health_router
from .controllers.history_controller import router as history_router
from .controllers.session_controller import router as session_router

setup_logging()
logger = get_logger("webapp")

app = FastAPI(title="LcStudy")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Optional user-provided assets (e.g., custom piece sets) under ~/.lcstudy/assets

_settings = get_settings()
USER_ASSETS_DIR = _settings.data_dir / "assets"
try:
    USER_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/assets", StaticFiles(directory=str(USER_ASSETS_DIR)), name="assets")
    logger.info("Mounted user assets directory at %s", USER_ASSETS_DIR)
except Exception:
    # If it fails, continue without user assets
    logger.warning("User assets directory could not be mounted: %s", USER_ASSETS_DIR)


def html_index() -> str:
    template_path = Path(__file__).parent / "templates" / "index.html"
    return template_path.read_text()


@app.get("/")
def index() -> HTMLResponse:
    return HTMLResponse(html_index(), media_type="text/html; charset=utf-8")


@app.get("/config.js")
def config_js() -> Response:
    """Optional runtime config exposed to the browser.

    Supports overriding piece assets via environment variables:
    - LCSTUDY_PIECE_BASE_URL: base URL to a directory containing wK.svg, etc.
    - LCSTUDY_PIECE_EXT: svg or png
    """
    base = os.environ.get("LCSTUDY_PIECE_BASE_URL", "")
    ext = os.environ.get("LCSTUDY_PIECE_EXT", "")
    js = ""  # default empty
    if base:
        js += f"window.PIECE_BASE = '{base}';\n"
    if ext:
        js += f"window.PIECE_EXT = '{ext}';\n"
    return Response(js, media_type="application/javascript")


# Routers
app.include_router(health_router)
app.include_router(history_router)
app.include_router(session_router)

# Error handlers
register_exception_handlers(app)


# Background session cleanup
import threading

_stop_cleanup = threading.Event()


def _cleanup_loop():
    settings = get_settings()
    repo = get_session_repository()
    interval = max(5, int(settings.session.cleanup_interval))
    timeout = max(60, int(settings.session.default_timeout))
    while not _stop_cleanup.is_set():
        try:
            repo.cleanup_expired(timeout)
        except Exception:
            pass
        _stop_cleanup.wait(interval)


@app.on_event("startup")
async def on_startup():
    t = threading.Thread(target=_cleanup_loop, daemon=True)
    t.start()


@app.on_event("shutdown")
async def on_shutdown():
    logger.info("Shutting down services...")
    _stop_cleanup.set()
    get_analysis_service().shutdown_all()
    get_engine_service().shutdown_all()
    logger.info("Services shut down successfully")
