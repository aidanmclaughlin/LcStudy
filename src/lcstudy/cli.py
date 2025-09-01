"""LcStudy command-line interface.

This module provides the ``lcstudy`` console entrypoint, offering:
- environment checks (doctor)
- installer helpers for engines and networks
- local web app launchers (web, up)

The implementation favors clear messages over implicit side effects. It does
not attempt to install dependencies automatically unless the user explicitly
invokes an install command.
"""

import argparse
import os
import importlib
import shutil
import subprocess
import threading
import sys
import time
import webbrowser
from typing import Optional

from . import __version__


def which(cmd: str) -> Optional[str]:
    """Return full path to an executable if it is found on PATH."""
    return shutil.which(cmd)


def run(cmd: list[str]) -> tuple[int, str, str]:
    """Run a command and capture its output.

    Returns a tuple of (returncode, stdout, stderr).
    """
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except FileNotFoundError:
        return 127, "", f"command not found: {cmd[0]}"


def cmd_version(_: argparse.Namespace) -> int:
    """Print package version."""
    print(__version__)
    return 0


def cmd_hello(args: argparse.Namespace) -> int:
    """Friendly greeting for quick smoke testing."""
    name = args.name or "there"
    print(f"Hello, {name}! This is LcStudy.")
    return 0


def cmd_doctor(_: argparse.Namespace) -> int:
    """Check local environment for common requirements (lc0, networks)."""
    print("LcStudy environment check:\n")
    ok = True

    py_ver = (
        f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    )
    print(f"- Python: {py_ver}")

    try:
        from .engines import find_lc0, nets_dir
    except Exception:

        def nets_dir():  # type: ignore
            return None

        def find_lc0():  # type: ignore
            return None

    lc0_path = which("lc0") or (str(find_lc0() or "") if find_lc0 else "")
    if lc0_path:
        code, out, err = run([lc0_path, "--version"])
        version_line = out.splitlines()[0] if out else "(version unknown)"
        print(f"- lc0: found at {lc0_path}")
        print(f"  {version_line}")
        if err:
            print(f"  stderr: {err}")
    else:
        ok = False
        print("- lc0: NOT found in PATH")
        print(
            "  Tip: Install LcZero and ensure the 'lc0' binary is available on your PATH."
        )

    try:
        nd = nets_dir()
        best = nd / "lczero-best.pb.gz"
        any_maia = list(nd.glob("maia-*.pb.gz"))
        print(f"- Networks dir: {nd}")
        if best.exists():
            print(f"  - Leela best: {best}")
        else:
            ok = False
            print("  - Leela best: NOT found. Run: lcstudy install bestnet")
        if any_maia:
            levs = ", ".join(sorted(p.stem.split("-")[-1] for p in any_maia))
            print(f"  - Maia nets: {len(any_maia)} found ({levs})")
        else:
            print("  - Maia nets: none found. Optional: lcstudy install maia")
    except Exception:
        print(
            "- Networks: tools not installed yet. Install with: pip install -e .[all]"
        )

    if ok:
        print("\nAll checks passed.")
        return 0
    else:
        print("\nSome checks failed. See tips above.")
        return 1


def cmd_install_lc0(_: argparse.Namespace) -> int:
    try:
        from .install import install_lc0

        exe = install_lc0()
        print(f"Installed lc0 to {exe}")
        return 0
    except Exception as e:
        print(f"Install failed: {e}")
        return 1


def cmd_install_bestnet(_: argparse.Namespace) -> int:
    try:
        from .install import install_lczero_best_network

        path = install_lczero_best_network()
        print(f"Best network saved to {path}")
        return 0
    except Exception as e:
        print(f"Download failed: {e}")
        return 1


def cmd_install_maia(args: argparse.Namespace) -> int:
    try:
        from .install import install_maia, install_maia_all

        if args.level is None:
            paths = install_maia_all()
            if paths:
                print("Downloaded:")
                for p in paths:
                    print(f"- {p}")
            else:
                print("No Maia networks downloaded. See warnings above.")
            return 0
        else:
            p = install_maia(args.level)
            print(f"Downloaded Maia {args.level} to {p}")
            return 0
    except Exception as e:
        print(f"Download failed: {e}")
        return 1


def cmd_install_all(_: argparse.Namespace) -> int:
    code = 0
    code |= cmd_install_lc0(argparse.Namespace())
    code |= cmd_install_bestnet(argparse.Namespace())
    code |= cmd_install_maia(argparse.Namespace(level=None))
    return 0 if code == 0 else 1


def _apply_runtime_flags(args: argparse.Namespace) -> None:
    """Apply global/runtime flags to environment before starting the app."""
    if getattr(args, "no_seeds", False):
        os.environ["LCSTUDY_DISABLE_SEEDS"] = "1"


def cmd_web(args: argparse.Namespace) -> int:
    """Deprecated: use 'lcstudy up' instead."""
    print("'lcstudy web' is deprecated. Use: lcstudy up")
    # Fall back to up for compatibility
    return cmd_up(args)


def cmd_up(args: argparse.Namespace) -> int:
    if not _ensure_web_deps():
        return 1

    # Start installs in the background so the site opens immediately.
    def _bg_install() -> None:
        try:
            # Use default strategy: ensure lc0, best net, and all Maia nets.
            _ensure_installed(quick=False, maia_level=1500)
        except Exception as e:
            print(f"Setup warning: {e}")
            print(
                "Proceeding to launch the web app in fallback mode. You can still explore the UI."
            )

    threading.Thread(target=_bg_install, name="lcstudy-install", daemon=True).start()

    # Apply flags BEFORE importing webapp so settings reflect env at import time
    _apply_runtime_flags(args)

    from .config import get_settings
    import uvicorn
    from .webapp import app

    settings = get_settings()
    host = settings.server.host or "127.0.0.1"
    port = int(settings.server.port or 8000)
    url = f"http://{host}:{port}"
    # When binding to 0.0.0.0/::, open localhost in the browser
    open_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    open_url = f"http://{open_host}:{port}"
    print(f"Launching web app at {url}")

    # Open the browser shortly after starting, without blocking
    def _open_browser_later() -> None:
        try:
            time.sleep(0.8)
            webbrowser.open(open_url, new=2)
        except Exception:
            # Best-effort: ignore failures to open a browser
            pass

    threading.Thread(target=_open_browser_later, name="lcstudy-browser", daemon=True).start()

    uvicorn.run(app, host=host, port=port, log_level="warning")
    return 0


def entry_up() -> int:
    """Entry point for the ``lcstudy-up`` helper script.

    This mirrors running ``lcstudy up`` with default arguments. Having a
    dedicated entry point makes it easy to provide a one-command experience.
    """
    ns = argparse.Namespace(no_seeds=False)
    return cmd_up(ns)


def _ensure_web_deps() -> bool:
    """Validate optional runtime dependencies are importable.

    We do not attempt to auto-install packages here; instead we provide clear
    instructions to the user to install the documented extras.
    """
    required = ["fastapi", "uvicorn", "chess", "httpx"]
    for pkg in required:
        try:
            importlib.import_module(pkg)
        except ModuleNotFoundError:
            print(f"Missing required package: {pkg}")
            print(
                "Run: pip install -e '.[all]'  # or: pip install fastapi uvicorn python-chess httpx"
            )
            return False
    return True


def _ensure_installed(quick: bool = False, maia_level: int = 1500) -> None:
    """Ensure lc0 and required networks exist, installing if missing."""
    from .engines import find_lc0, nets_dir
    from .install import (
        install_lc0,
        install_lczero_best_network,
        install_maia,
        install_maia_all,
    )

    if not find_lc0():
        print("Installing lc0 (latest release)...")
        install_lc0()
    nd = nets_dir()
    nd.mkdir(parents=True, exist_ok=True)
    best = nd / "lczero-best.pb.gz"
    if not best.exists():
        print("Downloading best LcZero network...")
        install_lczero_best_network()
    # install_lczero_best_network() already writes both lczero-best.pb.gz and BT4-1740.pb.gz
    if quick:
        mp = nd / f"maia-{maia_level}.pb.gz"
        if not mp.exists():
            print(f"Downloading Maia {maia_level} network...")
            install_maia(maia_level)
    else:
        existing = list(nd.glob("maia-*.pb.gz"))
        if len(existing) < 10:
            print("Downloading Maia networks (1100..2200)...")
            install_maia_all()


def build_parser() -> argparse.ArgumentParser:
    """Create the top-level argument parser for the CLI."""

    class HelpFormatter(
        argparse.ArgumentDefaultsHelpFormatter, argparse.RawTextHelpFormatter
    ):
        pass

    parser = argparse.ArgumentParser(
        prog="lcstudy",
        description=(
            "LcStudy – practice predicting Leela's moves and explore Maia models.\n"
            "Commands cover quick web launch, environment checks, and installers."
        ),
        epilog=(
            "Examples:\n"
            "  lcstudy up\n"
            "  lcstudy up --no-seeds\n"
            "  lcstudy doctor\n"
            "  lcstudy install lc0\n"
            "  lcstudy install maia --level 1500\n"
            "  lcstudy install all\n"
            "\nData dirs: ~/.lcstudy/bin (binaries), ~/.lcstudy/nets (networks)"
        ),
        formatter_class=HelpFormatter,
    )

    # Common top-level flags
    parser.add_argument(
        "-V",
        "--version",
        action="version",
        version=__version__,
        help="Show version and exit",
    )

    sub = parser.add_subparsers(title="Commands", dest="command", required=True)

    # up: main entry to run the web app (with background install)
    p_up = sub.add_parser(
        "up",
        help="Ensure engines/nets exist and launch the web app",
        description=(
            "Launch the local FastAPI app and open a browser.\n"
            "Performs best-effort setup in the background (lc0 + networks)."
        ),
        formatter_class=HelpFormatter,
    )
    p_up.add_argument(
        "--no-seeds",
        action="store_true",
        help="Disable background auto-generation of training games",
    )
    p_up.set_defaults(func=cmd_up)

    # web: deprecated alias to up (kept for discoverability)
    p_web = sub.add_parser(
        "web",
        help="[Deprecated] Alias for 'up'",
        description="Deprecated: use 'lcstudy up' instead."
        " This command forwards to 'up'.",
        formatter_class=HelpFormatter,
    )
    p_web.add_argument(
        "--no-seeds",
        action="store_true",
        help="Disable background auto-generation of training games",
    )
    p_web.set_defaults(func=cmd_web)

    # doctor: environment checks
    p_doc = sub.add_parser(
        "doctor",
        help="Check local environment and report missing pieces",
        description=(
            "Run a quick diagnostic to check Python, lc0, and networks.\n"
            "Provides tips for installing missing components."
        ),
        formatter_class=HelpFormatter,
    )
    p_doc.set_defaults(func=cmd_doctor)

    # install group with subcommands
    p_install = sub.add_parser(
        "install",
        help="Install engines or networks",
        description=(
            "Download and set up required components.\n\n"
            "Subcommands:\n"
            "  lc0       Install LcZero engine binary\n"
            "  bestnet   Download recommended LcZero network\n"
            "  maia      Download a Maia network (or all)\n"
            "  all       Install lc0 + bestnet + maia"
        ),
        formatter_class=HelpFormatter,
    )
    sub_install = p_install.add_subparsers(
        title="Install Commands", dest="install_cmd", required=True
    )

    # install lc0
    p_i_lc0 = sub_install.add_parser(
        "lc0",
        help="Install LcZero engine binary",
        description="Install the latest lc0 binary to ~/.lcstudy/bin.",
        formatter_class=HelpFormatter,
    )
    p_i_lc0.set_defaults(func=cmd_install_lc0)

    # install bestnet
    p_i_best = sub_install.add_parser(
        "bestnet",
        help="Download the recommended LcZero network",
        description="Download the recommended LcZero network to ~/.lcstudy/nets.",
        formatter_class=HelpFormatter,
    )
    p_i_best.set_defaults(func=cmd_install_bestnet)

    # install maia
    p_i_maia = sub_install.add_parser(
        "maia",
        help="Download Maia network(s)",
        description=(
            "Download a Maia network by level (e.g., 1100..2200).\n"
            "If no level is specified, all standard levels are downloaded."
        ),
        formatter_class=HelpFormatter,
    )
    p_i_maia.add_argument(
        "--level",
        type=int,
        help="Specific Maia level to download (e.g., 1500). If omitted, download all.",
    )
    p_i_maia.set_defaults(func=cmd_install_maia)

    # install all
    p_i_all = sub_install.add_parser(
        "all",
        help="Install lc0 + bestnet + all Maia networks",
        description="Install lc0 and download bestnet and all Maia networks.",
        formatter_class=HelpFormatter,
    )
    p_i_all.set_defaults(func=cmd_install_all)

    # Top-level convenience aliases so `-h` lists everything explicitly
    p_ilc0 = sub.add_parser(
        "install-lc0",
        help="Alias of 'install lc0'",
        description="Alias for: lcstudy install lc0",
        formatter_class=HelpFormatter,
    )
    p_ilc0.set_defaults(func=cmd_install_lc0)

    p_ibest = sub.add_parser(
        "install-bestnet",
        help="Alias of 'install bestnet'",
        description="Alias for: lcstudy install bestnet",
        formatter_class=HelpFormatter,
    )
    p_ibest.set_defaults(func=cmd_install_bestnet)

    p_imaia = sub.add_parser(
        "install-maia",
        help="Alias of 'install maia'",
        description="Alias for: lcstudy install maia",
        formatter_class=HelpFormatter,
    )
    p_imaia.add_argument(
        "--level",
        type=int,
        help="Specific Maia level to download (e.g., 1500). If omitted, download all.",
    )
    p_imaia.set_defaults(func=cmd_install_maia)

    p_iall = sub.add_parser(
        "install-all",
        help="Alias of 'install all'",
        description="Alias for: lcstudy install all",
        formatter_class=HelpFormatter,
    )
    p_iall.set_defaults(func=cmd_install_all)

    # hello: quick smoke test
    p_hello = sub.add_parser(
        "hello",
        help="Print a friendly greeting (for quick smoke testing)",
        description="Print a friendly greeting; useful to verify CLI wiring.",
        formatter_class=HelpFormatter,
    )
    p_hello.add_argument("--name", help="Name to greet", default=None)
    p_hello.set_defaults(func=cmd_hello)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    func = getattr(args, "func", None)
    if func is None:
        parser.print_help()
        return 2
    return int(func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
