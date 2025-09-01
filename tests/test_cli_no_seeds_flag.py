import argparse
import importlib
import importlib.abc
import importlib.machinery
import sys
import types


def test_no_seeds_env_applied_before_webapp_import(monkeypatch):
    import lcstudy.cli as cli
    import lcstudy.config as config

    # Ensure deps check passes and installers don't run
    monkeypatch.setattr(cli, "_ensure_web_deps", lambda: True)
    monkeypatch.setattr(cli, "_ensure_installed", lambda *a, **k: None)

    # Fake uvicorn
    uv = types.ModuleType("uvicorn")

    def fake_run(app, host=None, port=None, log_level=None):
        return None

    uv.run = fake_run  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "uvicorn", uv)

    # Remove any pre-existing modules to ensure clean import
    sys.modules.pop("lcstudy.webapp", None)

    class FakeLoader(importlib.abc.Loader):
        def create_module(self, spec):  # type: ignore[override]
            return types.ModuleType(spec.name)

        def exec_module(self, module):  # type: ignore[override]
            # Simulate webapp import-time get_settings (via setup_logging)
            module.app = object()
            module.captured = {"settings_at_import": config.get_settings()}

    class FakeFinder(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path, target=None):  # type: ignore[override]
            if fullname == "lcstudy.webapp":
                return importlib.machinery.ModuleSpec(fullname, FakeLoader())
            return None

    finder = FakeFinder()
    sys.meta_path.insert(0, finder)
    try:
        # Execute: --no-seeds should set env before importing webapp
        cli.cmd_up(argparse.Namespace(no_seeds=True))
    finally:
        # Clean up import hook
        if finder in sys.meta_path:
            sys.meta_path.remove(finder)

    # Assert that settings at webapp import reflect disabled seeds
    webapp = sys.modules.get("lcstudy.webapp")
    assert webapp is not None
    settings_at_import = getattr(webapp, "captured")["settings_at_import"]
    assert settings_at_import.enable_seed_generator is False
