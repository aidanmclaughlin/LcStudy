import argparse
import shutil
import subprocess
import sys
from typing import Optional

from . import __version__


def which(cmd: str) -> Optional[str]:
    return shutil.which(cmd)


def run(cmd: list[str]) -> tuple[int, str, str]:
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
    print(__version__)
    return 0


def cmd_hello(args: argparse.Namespace) -> int:
    name = args.name or "there"
    print(f"Hello, {name}! This is LcStudy.")
    return 0


def cmd_doctor(_: argparse.Namespace) -> int:
    print("LcStudy environment check:\n")
    ok = True

    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    print(f"- Python: {py_ver}")

    try:
        from .engines import nets_dir, find_lc0
    except Exception:
        nets_dir = lambda: None  # type: ignore
        find_lc0 = lambda: None  # type: ignore

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
        print("  Tip: Install LcZero and ensure the 'lc0' binary is available on your PATH.")

    # Networks
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
        print("- Networks: tools not installed yet. Install with: pip install -e .[all]")

    if ok:
        print("\nAll checks passed.")
        return 0
    else:
        print("\nSome checks failed. See tips above.")
        return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lcstudy",
        description="LcStudy - learn and experiment with LcZero",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_ver = sub.add_parser("version", help="Show version and exit")
    p_ver.set_defaults(func=cmd_version)

    p_hello = sub.add_parser("hello", help="Say hello")
    p_hello.add_argument("name", nargs="?", help="Name to greet")
    p_hello.set_defaults(func=cmd_hello)

    p_doc = sub.add_parser("doctor", help="Check local environment and lc0 availability")
    p_doc.set_defaults(func=cmd_doctor)

    # Installers
    p_inst = sub.add_parser("install", help="Install engines and networks")
    inst_sub = p_inst.add_subparsers(dest="what", required=True)

    p_lc0 = inst_sub.add_parser("lc0", help="Install latest lc0 binary")
    p_lc0.set_defaults(func=cmd_install_lc0)

    p_net = inst_sub.add_parser("bestnet", help="Download best LcZero network")
    p_net.set_defaults(func=cmd_install_bestnet)

    p_maia = inst_sub.add_parser("maia", help="Download Maia networks")
    p_maia.add_argument("level", nargs="?", type=int, help="Maia level e.g. 1500; omit to download all")
    p_maia.set_defaults(func=cmd_install_maia)

    p_all = inst_sub.add_parser("all", help="Install lc0, best net, and all Maia nets")
    p_all.set_defaults(func=cmd_install_all)

    # Web app
    p_web = sub.add_parser("web", help="Run local web app")
    p_web.add_argument("--host", default="127.0.0.1")
    p_web.add_argument("--port", type=int, default=8000)
    p_web.set_defaults(func=cmd_web)

    # One-shot: install everything (if needed) and launch web app
    p_up = sub.add_parser("up", help="Install engines/nets if missing and launch the web app")
    p_up.add_argument("--host", default="127.0.0.1")
    p_up.add_argument("--port", type=int, default=8000)
    p_up.add_argument("--quick", action="store_true", help="Only ensure Maia 1500 instead of all levels")
    p_up.add_argument("--maia-level", type=int, default=1500, help="Maia level to ensure when using --quick")
    p_up.add_argument("--no-open", action="store_true", help="Do not open the browser automatically")
    p_up.set_defaults(func=cmd_up)

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


# Commands below


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
        print(f"Downloaded best network to {path}")
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


def cmd_web(args: argparse.Namespace) -> int:
    # Launch the FastAPI app with uvicorn
    try:
        import uvicorn
        from .webapp import app
    except Exception:
        print("Web dependencies missing. Install with: pip install -e .[all]")
        return 1

    # Quick preflight
    try:
        from .engines import find_lc0
        if not find_lc0():
            print("Warning: lc0 not found. Install with: lcstudy install lc0")
    except Exception:
        print("Note: engine helpers not available. Install with: pip install -e .[all]")

    uvicorn.run(app, host=args.host, port=args.port)
    return 0


def _ensure_installed(quick: bool = False, maia_level: int = 1500) -> None:
    from .engines import find_lc0, nets_dir
    from .install import install_lc0, install_lczero_best_network, install_maia_all, install_maia

    if not find_lc0():
        print("Installing lc0 (latest release)...")
        install_lc0()
    nd = nets_dir()
    nd.mkdir(parents=True, exist_ok=True)
    best = nd / "lczero-best.pb.gz"
    if not best.exists():
        print("Downloading best LcZero network...")
        install_lczero_best_network()
    if quick:
        mp = nd / f"maia-{maia_level}.pb.gz"
        if not mp.exists():
            print(f"Downloading Maia {maia_level} network...")
            install_maia(maia_level)
    else:
        existing = list(nd.glob("maia-*.pb.gz"))
        if len(existing) < 9:
            print("Downloading Maia networks (1100..1900)...")
            install_maia_all()


def cmd_up(args: argparse.Namespace) -> int:
    # Ensure required components
    try:
        _ensure_installed(quick=bool(args.quick), maia_level=int(args.maia_level))
    except Exception as e:
        print(f"Setup warning: {e}")
        print("Proceeding to launch the web app in fallback mode. You can still explore the UI.")

    # Launch web
    try:
        import uvicorn
        from .webapp import app
    except Exception:
        print("Web dependencies missing. Install with: pip install -e .[all]")
        return 1

    url = f"http://{args.host}:{args.port}"
    print(f"Launching web app at {url}")
    if not args.no_open:
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception:
            pass
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


def entry_up() -> None:
    # Console script entry to start everything with a single command
    ns = argparse.Namespace(host="127.0.0.1", port=8000, quick=False, maia_level=1500, no_open=False)
    raise SystemExit(cmd_up(ns))
