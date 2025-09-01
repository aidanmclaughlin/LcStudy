import argparse
import types
import sys
import time as real_time


def _install_fake_uvicorn(monkeypatch):
    mod = types.ModuleType("uvicorn")

    def fake_run(app, host=None, port=None, log_level=None):
        # Allow background threads a moment to run
        real_time.sleep(0.02)
        return None

    mod.run = fake_run  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "uvicorn", mod)


def _install_fake_webapp(monkeypatch):
    mod = types.ModuleType("lcstudy.webapp")
    mod.app = object()  # minimal sentinel
    monkeypatch.setitem(sys.modules, "lcstudy.webapp", mod)


def test_up_opens_browser_with_localhost(monkeypatch):
    import lcstudy.cli as cli
    from lcstudy.config.settings import Settings
    import lcstudy.config as config

    # Avoid importing optional deps and background installers
    monkeypatch.setattr(cli, "_ensure_web_deps", lambda: True)
    monkeypatch.setattr(cli, "_ensure_installed", lambda *a, **k: None)

    _install_fake_uvicorn(monkeypatch)
    _install_fake_webapp(monkeypatch)

    # Speed up the browser-open delay
    monkeypatch.setattr(cli.time, "sleep", lambda n: None)

    # Capture browser opens
    opened = []

    def fake_open(url, new=0):
        opened.append((url, new))
        return True

    monkeypatch.setattr(cli.webbrowser, "open", fake_open)

    # Use default host
    s = Settings()
    s.server.host = "127.0.0.1"
    s.server.port = 8123
    monkeypatch.setattr(config, "get_settings", lambda: s)

    # Run the command
    cli.cmd_up(argparse.Namespace(no_seeds=True))

    assert any(u == "http://127.0.0.1:8123" for u, _ in opened)


def test_up_opens_browser_when_bound_all_interfaces(monkeypatch):
    import lcstudy.cli as cli
    from lcstudy.config.settings import Settings
    import lcstudy.config as config

    monkeypatch.setattr(cli, "_ensure_web_deps", lambda: True)
    monkeypatch.setattr(cli, "_ensure_installed", lambda *a, **k: None)

    _install_fake_uvicorn(monkeypatch)
    _install_fake_webapp(monkeypatch)

    monkeypatch.setattr(cli.time, "sleep", lambda n: None)

    opened = []

    def fake_open(url, new=0):
        opened.append((url, new))
        return True

    monkeypatch.setattr(cli.webbrowser, "open", fake_open)

    s = Settings()
    s.server.host = "0.0.0.0"
    s.server.port = 8124
    monkeypatch.setattr(config, "get_settings", lambda: s)

    cli.cmd_up(argparse.Namespace(no_seeds=True))

    # Browser should open 127.0.0.1 when bound to 0.0.0.0
    assert any(u == "http://127.0.0.1:8124" for u, _ in opened)
