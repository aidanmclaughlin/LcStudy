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

    lc0_path = which("lc0")
    if lc0_path:
        code, out, err = run(["lc0", "--version"])
        version_line = out.splitlines()[0] if out else "(version unknown)"
        print(f"- lc0: found at {lc0_path}")
        print(f"  {version_line}")
        if err:
            print(f"  stderr: {err}")
    else:
        ok = False
        print("- lc0: NOT found in PATH")
        print("  Tip: Install LcZero and ensure the 'lc0' binary is available on your PATH.")

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

