from __future__ import annotations

import io
import json
import os
import platform
import re
import shutil
import sys
import tarfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

from .engines import bin_dir, ensure_dirs, nets_dir


GITHUB_API = "https://api.github.com"


def _http_get(url: str, follow_redirects: bool = True) -> httpx.Response:
    headers = {"User-Agent": "lcstudy-installer"}
    resp = httpx.get(url, headers=headers, follow_redirects=follow_redirects, timeout=60.0)
    resp.raise_for_status()
    return resp


def _is_macos_arm() -> bool:
    return platform.system().lower() == "darwin" and platform.machine().lower() in {"arm64", "aarch64"}


def fetch_latest_lc0_release_asset_url() -> Optional[tuple[str, str]]:
    # Returns (asset_name, download_url)
    resp = _http_get(f"{GITHUB_API}/repos/LeelaChessZero/lc0/releases/latest")
    data = resp.json()
    assets = data.get("assets", [])
    # Prefer macOS arm64 zip
    preferred_patterns = []
    if _is_macos_arm():
        preferred_patterns = [
            re.compile(r"darwin.*arm64.*\.(zip|tar\.gz)$", re.I),
            re.compile(r"macos.*arm64.*\.(zip|tar\.gz)$", re.I),
            re.compile(r"osx.*arm64.*\.(zip|tar\.gz)$", re.I),
        ]
    else:
        sysname = platform.system().lower()
        arch = platform.machine().lower()
        if sysname == "darwin":
            preferred_patterns = [re.compile(r"darwin.*\.(zip|tar\.gz)$", re.I)]
        elif sysname == "linux":
            preferred_patterns = [re.compile(r"linux.*\.(zip|tar\.gz)$", re.I)]
        elif sysname == "windows":
            preferred_patterns = [re.compile(r"windows.*\.(zip|tar\.gz)$", re.I)]

    # Try preferred
    for pat in preferred_patterns:
        for a in assets:
            name = a.get("name", "")
            if pat.search(name):
                return name, a.get("browser_download_url")
    # No suitable asset found
    return None


def download_and_extract(url: str, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    resp = _http_get(url)
    content = resp.content

    # Try zip first
    if zipfile.is_zipfile(io.BytesIO(content)):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            zf.extractall(dest_dir)
        return
    # Try tar.gz
    try:
        with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as tf:
            tf.extractall(dest_dir)
        return
    except tarfile.ReadError:
        pass
    # Write as file
    filename = dest_dir / Path(url).name
    filename.write_bytes(content)


def locate_extracted_lc0(dir_: Path) -> Optional[Path]:
    # Search for lc0 binary in extracted content
    candidates = []
    for root, _, files in os.walk(dir_):
        for f in files:
            if f == "lc0" or f == "lc0.exe":
                candidates.append(Path(root) / f)
    # Prefer top-level lc0
    if not candidates:
        return None
    # Pick the shortest path as heuristic
    return sorted(candidates, key=lambda p: len(str(p)))[0]


def install_lc0() -> Path:
    ensure_dirs()
    found = fetch_latest_lc0_release_asset_url()
    if not found:
        # Try platform package manager fallbacks
        if platform.system().lower() == "darwin":
            # Attempt Homebrew
            try:
                print("No macOS lc0 release asset found; attempting 'brew install lc0'...")
                import subprocess
                subprocess.run(["brew", "install", "lc0"], check=True)
                # Verify
                exe = shutil.which("lc0")
                if exe:
                    return Path(exe)
            except Exception as e:
                raise RuntimeError(
                    "Failed to install lc0 via Homebrew. Please install lc0 manually (brew install lc0)"
                ) from e
        raise RuntimeError("No suitable lc0 release asset found for this platform.")
    name, url = found
    tmpdir = bins_tmp = bin_dir() / "_lc0_download"
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

MAIA_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]


def find_maia_asset(level: int) -> Optional[tuple[str, str]]:
    # Return (asset_name, url)
    filename_patterns = [
        re.compile(fr"maia[-_]?{level}.*\.pb(\.gz)?$", re.I),
        re.compile(fr"maia[-_]?{level}.*weights.*\.gz$", re.I),
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
    return None


def install_maia(level: int) -> Path:
    ensure_dirs()
    found = find_maia_asset(level)
    if not found:
        raise RuntimeError(
            f"Could not locate Maia {level} weights in known releases. Please provide manually."
        )
    _, url = found
    resp = _http_get(url)
    # Save to nets dir
    filename = nets_dir() / f"maia-{level}.pb.gz"
    filename.write_bytes(resp.content)
    return filename


def install_maia_all() -> list[Path]:
    paths = []
    for lvl in MAIA_LEVELS:
        try:
            paths.append(install_maia(lvl))
        except Exception as e:
            print(f"Warning: Maia {lvl} download failed: {e}")
    return paths


def install_lczero_best_network() -> Path:
    ensure_dirs()
    # Best network URL pattern. This endpoint commonly serves the current best network.
    # If it fails, we ask the user to provide a path.
    urls = [
        "https://lczero.org/get_network?best=true",
        "https://lczero.org/api/best-network",
    ]
    last_err: Optional[Exception] = None
    for url in urls:
        try:
            resp = _http_get(url)
            # Some endpoints return redirect to a file
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
