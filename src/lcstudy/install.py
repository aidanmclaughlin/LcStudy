"""Install helpers for lc0 and networks.

This module downloads a suitable lc0 binary for the current platform and
retrieves network weights for Leela and Maia into the app's data directory.
"""

from __future__ import annotations

import io
import os
import platform
import re
import shutil
import tarfile
import zipfile
from pathlib import Path
from typing import Optional

import httpx

from .engines import bin_dir, ensure_dirs, nets_dir

GITHUB_API = "https://api.github.com"


def _http_get(url: str, follow_redirects: bool = True) -> httpx.Response:
    """HTTP GET with a small default timeout and a custom UA."""
    headers = {"User-Agent": "lcstudy-installer"}
    resp = httpx.get(
        url, headers=headers, follow_redirects=follow_redirects, timeout=60.0
    )
    resp.raise_for_status()
    return resp


def _is_macos_arm() -> bool:
    """True if running on macOS arm64 (Apple Silicon)."""
    return platform.system().lower() == "darwin" and platform.machine().lower() in {
        "arm64",
        "aarch64",
    }


def fetch_latest_lc0_release_asset_url() -> Optional[tuple[str, str]]:
    """Return (asset_name, url) for a suitable lc0 release asset."""
    resp = _http_get(f"{GITHUB_API}/repos/LeelaChessZero/lc0/releases/latest")
    data = resp.json()
    assets = data.get("assets", [])
    preferred_patterns = []
    if _is_macos_arm():
        preferred_patterns = [
            re.compile(r"darwin.*arm64.*\.(zip|tar\.gz)$", re.I),
            re.compile(r"macos.*arm64.*\.(zip|tar\.gz)$", re.I),
            re.compile(r"osx.*arm64.*\.(zip|tar\.gz)$", re.I),
        ]
    else:
        sysname = platform.system().lower()
        if sysname == "darwin":
            preferred_patterns = [re.compile(r"darwin.*\.(zip|tar\.gz)$", re.I)]
        elif sysname == "linux":
            preferred_patterns = [re.compile(r"linux.*\.(zip|tar\.gz)$", re.I)]
        elif sysname == "windows":
            preferred_patterns = [re.compile(r"windows.*\.(zip|tar\.gz)$", re.I)]

    for pat in preferred_patterns:
        for a in assets:
            name = a.get("name", "")
            if pat.search(name):
                return name, a.get("browser_download_url")
    return None


def download_and_extract(url: str, dest_dir: Path) -> None:
    """Download an archive or file and extract/save into dest_dir."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    resp = _http_get(url)
    content = resp.content

    if zipfile.is_zipfile(io.BytesIO(content)):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            zf.extractall(dest_dir)
        return
    try:
        with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as tf:
            tf.extractall(dest_dir)
        return
    except tarfile.ReadError:
        pass
    filename = dest_dir / Path(url).name
    filename.write_bytes(content)


def locate_extracted_lc0(dir_: Path) -> Optional[Path]:
    """Return a path to lc0 binary within an extracted directory tree."""
    candidates = []
    for root, _, files in os.walk(dir_):
        for f in files:
            if f == "lc0" or f == "lc0.exe":
                candidates.append(Path(root) / f)
    if not candidates:
        return None
    return sorted(candidates, key=lambda p: len(str(p)))[0]


def install_lc0() -> Path:
    """Install lc0 binary into the app bin directory, returning its path.

    On macOS, falls back to Homebrew if a suitable release asset isn't found.
    """
    ensure_dirs()
    found = fetch_latest_lc0_release_asset_url()
    if not found:
        if platform.system().lower() == "darwin":
            try:
                print(
                    "No macOS lc0 release asset found; attempting 'brew install lc0'..."
                )
                import subprocess

                subprocess.run(["brew", "install", "lc0"], check=True)
                exe = shutil.which("lc0")
                if exe:
                    return Path(exe)
            except Exception as e:
                raise RuntimeError(
                    "Failed to install lc0 via Homebrew. Please install lc0 manually (brew install lc0)"
                ) from e
        raise RuntimeError("No suitable lc0 release asset found for this platform.")
    name, url = found
    tmpdir = bin_dir() / "_lc0_download"
    if tmpdir.exists():
        shutil.rmtree(tmpdir, ignore_errors=True)
    tmpdir.mkdir(parents=True, exist_ok=True)
    download_and_extract(url, tmpdir)
    exe = locate_extracted_lc0(tmpdir)
    if exe is None:
        raise RuntimeError(f"lc0 binary not found in archive {name}")
    final = bin_dir() / ("lc0.exe" if exe.name.endswith(".exe") else "lc0")
    shutil.copy2(exe, final)
    final.chmod(0o755)
    shutil.rmtree(tmpdir, ignore_errors=True)
    return final


MAIA_REPOS = [
    ("maiachess", "maia-chess"),
    ("facebookresearch", "maia-chess"),
]

# Supported Maia levels (networks expected under ~/.lcstudy/nets as maia-<level>.pb.gz)
MAIA_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2200]

# Some networks may be published outside official release assets. Provide
# direct URLs for those known cases as a fallback.
MAIA_DIRECT_URLS: dict[int, str] = {
    2200: "https://github.com/CallOn84/LeelaNets/raw/refs/heads/main/Nets/Maia%202200/maia-2200.pb.gz",
}


def find_maia_asset(level: int) -> Optional[tuple[str, str]]:
    """Return (asset_name, url) for a Maia network at the given level.

    Tries known GitHub release assets first; falls back to any hardcoded
    direct URL for the requested level.
    """
    filename_patterns = [
        re.compile(rf"maia[-_]?{level}.*\.pb(\.gz)?$", re.I),
        re.compile(rf"maia[-_]?{level}.*weights.*\.gz$", re.I),
    ]
    for owner, repo in MAIA_REPOS:
        try:
            resp = _http_get(f"{GITHUB_API}/repos/{owner}/{repo}/releases/latest")
            assets = resp.json().get("assets", [])
            for a in assets:
                name = a.get("name", "")
                for pat in filename_patterns:
                    if pat.search(name):
                        return name, a.get("browser_download_url")
        except Exception:
            continue
    # Fallback: direct URL mapping for networks not in official releases
    if level in MAIA_DIRECT_URLS:
        url = MAIA_DIRECT_URLS[level]
        return (f"maia-{level}.pb.gz", url)
    return None


def install_maia(level: int) -> Path:
    """Download and save a Maia network to the nets directory."""
    ensure_dirs()
    found = find_maia_asset(level)
    if not found:
        raise RuntimeError(
            f"Could not locate Maia {level} weights in known releases. Please provide manually."
        )
    _, url = found
    resp = _http_get(url)
    filename = nets_dir() / f"maia-{level}.pb.gz"
    filename.write_bytes(resp.content)
    return filename


def install_maia_all() -> list[Path]:
    """Download all supported Maia networks, returning saved paths."""
    paths = []
    for lvl in MAIA_LEVELS:
        try:
            paths.append(install_maia(lvl))
        except Exception as e:
            print(f"Warning: Maia {lvl} download failed: {e}")
    return paths


def install_lczero_best_network() -> Path:
    """Download and save the current best LcZero network to nets directory."""
    ensure_dirs()
    urls = [
        "https://lczero.org/get_network?best=true",
        "https://lczero.org/api/best-network",
    ]
    last_err: Optional[Exception] = None
    for url in urls:
        try:
            resp = _http_get(url)
            content = resp.content
            out = nets_dir() / "lczero-best.pb.gz"
            out.write_bytes(content)
            return out
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(
        f"Failed to download best LcZero network automatically. Error: {last_err}. "
        "Please download a .pb.gz network and place it at ~/.lcstudy/nets/lczero-best.pb.gz"
    )
