from __future__ import annotations

from pathlib import Path
import threading

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .config.logging import get_logger, setup_logging
from .controllers.deps import get_engine_service, get_session_repository
from .controllers.errors import register_exception_handlers
from .controllers.health_controller import router as health_router
from .controllers.history_controller import router as history_router
from .controllers.session_controller import router as session_router

setup_logging()
logger = get_logger("webapp")

app = FastAPI(title="LcStudy")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# For simplicity and consistency, we do not support user-provided piece sets.


def html_index() -> str:
    template_path = Path(__file__).parent / "templates" / "index.html"
    return template_path.read_text()


@app.get("/")
def index() -> HTMLResponse:
    return HTMLResponse(html_index(), media_type="text/html; charset=utf-8")


# No runtime-config endpoint; the UI uses fixed Wikipedia pieces.


# Routers
app.include_router(health_router)
app.include_router(history_router)
app.include_router(session_router)

# Error handlers
register_exception_handlers(app)


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
    # Start background seed generation as a subprocess
    try:
        import subprocess
        import sys

        global _seed_proc
        _seed_proc = subprocess.Popen([sys.executable, "-m", "lcstudy.scripts.generate_seeds", "--daemon"])  # type: ignore[var-annotated]
        logger.info(
            "Started seed generator subprocess (pid=%s)",
            getattr(_seed_proc, "pid", "?"),
        )
    except Exception as e:
        logger.warning("Seed generator failed to start: %s", e)


@app.on_event("shutdown")
async def on_shutdown():
    logger.info("Shutting down services...")
    _stop_cleanup.set()
    get_engine_service().shutdown_all()
    # Stop subprocess if running
    try:
        if (
            "_seed_proc" in globals()
            and _seed_proc
            and getattr(_seed_proc, "poll", lambda: None)() is None
        ):
            _seed_proc.terminate()
    except Exception:
        pass
    logger.info("Services shut down successfully")
