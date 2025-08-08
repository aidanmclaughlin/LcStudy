from __future__ import annotations

import threading
from pathlib import Path

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

# Track the seed generator subprocess if/when started
_seed_proc = None  # type: ignore[var-annotated]

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


def _seed_watchdog_loop():
    """Start the seed generator once the Leela network is present.

    This avoids launching and exiting immediately when running `lcstudy up`
    with a fresh cache where networks are being downloaded in the background.
    """
    try:
        from .engines import nets_dir
    except Exception:
        # If engines helpers aren't available, just don't attempt to start.
        return

    global _seed_proc
    check_interval = 5.0
    announced_wait = False

    while not _stop_cleanup.is_set():
        try:
            nd = nets_dir()
            best = nd / "lczero-best.pb.gz"
            bt4 = nd / "BT4-1740.pb.gz"
            ready = best.exists() or bt4.exists()
            running = (
                "_seed_proc" in globals()
                and _seed_proc
                and getattr(_seed_proc, "poll", lambda: None)() is None
            )
            if ready and not running:
                try:
                    import subprocess
                    import sys

                    _seed_proc = subprocess.Popen(
                        [
                            sys.executable,
                            "-m",
                            "lcstudy.scripts.generate_seeds",
                            "--daemon",
                        ]
                    )
                    logger.info(
                        "Started seed generator subprocess (pid=%s)",
                        getattr(_seed_proc, "pid", "?"),
                    )
                except Exception as e:
                    logger.warning("Seed generator failed to start: %s", e)
                finally:
                    announced_wait = False
            elif not ready and not announced_wait:
                logger.info(
                    "Seed generator waiting for Leela network file in %s...",
                    nd,
                )
                announced_wait = True
        except Exception:
            pass
        # Sleep or exit if shutdown requested
        if _stop_cleanup.wait(check_interval):
            break


@app.on_event("startup")
async def on_startup():
    threading.Thread(target=_cleanup_loop, daemon=True).start()
    # Start a watchdog that launches the seed generator once weights exist
    threading.Thread(target=_seed_watchdog_loop, daemon=True).start()


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
