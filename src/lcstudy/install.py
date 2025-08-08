"""Install helpers for lc0 and networks.

This module downloads a suitable lc0 binary for the current platform and
retrieves network weights for Leela and Maia into the app's data directory.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import tarfile
import zipfile
from pathlib import Path
from typing import Optional

import httpx
import time

from .engines import bin_dir, ensure_dirs, nets_dir

GITHUB_API = "https://api.github.com"

# Tunables for network operations (can be overridden via env vars)
HTTP_TIMEOUT = float(os.environ.get("LCSTUDY_HTTP_TIMEOUT", "180.0"))
HTTP_RETRIES = int(os.environ.get("LCSTUDY_HTTP_RETRIES", "3"))
HTTP_BACKOFF = float(os.environ.get("LCSTUDY_HTTP_BACKOFF", "1.5"))


def _http_get(url: str, follow_redirects: bool = True) -> httpx.Response:
    """HTTP GET with retries, timeout, and a custom UA."""
    headers = {"User-Agent": "lcstudy-installer"}
    last_err: Optional[Exception] = None
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            resp = httpx.get(
                url,
                headers=headers,
                follow_redirects=follow_redirects,
                timeout=HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            return resp
        except Exception as e:  # httpx.TimeoutException, httpx.HTTPError, etc.
            last_err = e
            if attempt < HTTP_RETRIES:
                sleep_s = HTTP_BACKOFF ** (attempt - 1)
                print(f"Network hiccup on GET {url} (attempt {attempt}/{HTTP_RETRIES}): {e}. Retrying in {sleep_s:.1f}s...")
                time.sleep(sleep_s)
            else:
                break
    assert last_err is not None
    raise last_err


def _http_stream(url: str, follow_redirects: bool = True) -> httpx.Response:
    """HTTP GET as a stream with timeout and custom UA (no retries)."""
    headers = {"User-Agent": "lcstudy-installer"}
    resp = httpx.stream(
        "GET",
        url,
        headers=headers,
        follow_redirects=follow_redirects,
        timeout=HTTP_TIMEOUT,
    )
    return resp


def _print_progress(prefix: str, downloaded: int, total: Optional[int]) -> None:
    """Render a simple in-place progress bar to stdout.

    Uses only the standard library and works without TTY; it prints carriage
    returns to update the same line. If total is unknown, shows bytes only.
    """
    if total and total > 0:
        width = 40
        pct = downloaded / total
        filled = int(width * pct)
        bar = "#" * filled + "-" * (width - filled)
        total_mb = total / (1024 * 1024)
        done_mb = downloaded / (1024 * 1024)
        msg = f"{prefix} [{bar}] {pct*100:5.1f}% {done_mb:6.1f}/{total_mb:.1f} MB"
    else:
        done_mb = downloaded / (1024 * 1024)
        msg = f"{prefix} {done_mb:6.1f} MB"
    print("\r" + msg, end="", flush=True)


def _download_to_file_with_progress(url: str, dest: Path, label: Optional[str] = None) -> None:
    """Stream a URL to a file while printing a progress bar.

    Writes to a temporary ``.part`` file and renames on completion.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_suffix(dest.suffix + ".part")
    prefix = label or f"Downloading {dest.name}"
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            with _http_stream(url) as resp:
                resp.raise_for_status()
                total = (
                    int(resp.headers.get("Content-Length"))
                    if resp.headers.get("Content-Length")
                    else None
                )
                downloaded = 0
                with open(temp, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=1024 * 128):
                        if not chunk:
                            continue
                        f.write(chunk)
                        downloaded += len(chunk)
                        _print_progress(prefix, downloaded, total)
            break
        except Exception as e:  # timeouts, connection resets, etc.
            if attempt < HTTP_RETRIES:
                sleep_s = HTTP_BACKOFF ** (attempt - 1)
                print(f"Network hiccup downloading {url} (attempt {attempt}/{HTTP_RETRIES}): {e}. Retrying in {sleep_s:.1f}s...")
                time.sleep(sleep_s)
            else:
                print(f"Failed to download after {HTTP_RETRIES} attempts: {e}")
                raise
    # Finish line
    print()
    temp.replace(dest)


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
    """Download an archive or file and extract/save into dest_dir.

    Streams the download with a progress bar. If the file is an archive
    (zip or tar.*), it is extracted and the archive is removed; otherwise
    it is saved as-is.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    archive_path = dest_dir / Path(url).name
    _download_to_file_with_progress(url, archive_path, label=f"Downloading {archive_path.name}")
    # Try to extract if it's an archive
    try:
        if zipfile.is_zipfile(archive_path):
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(dest_dir)
            archive_path.unlink(missing_ok=True)
            return
        if tarfile.is_tarfile(archive_path):
            with tarfile.open(archive_path, mode="r:*") as tf:
                tf.extractall(dest_dir)
            archive_path.unlink(missing_ok=True)
            return
    except (zipfile.BadZipFile, tarfile.TarError):
        # Fall through to keep the file as-is
        pass


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
                exe_str = shutil.which("lc0")
                if exe_str:
                    return Path(exe_str)
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
    ("CSSLab", "maia-chess"),  # official release v1.0 hosts 1100..1900
    ("maiachess", "maia-chess"),
    ("facebookresearch", "maia-chess"),
]

# Supported Maia levels (networks expected under ~/.lcstudy/nets as maia-<level>.pb.gz)
MAIA_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2200]

# Some networks may be published outside official release assets. Provide
# direct URLs for those known cases as a fallback.
MAIA_DIRECT_URLS: dict[int, str] = {
    # Official CSSLab v1.0 release hosts 1100..1900
    1100: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1100.pb.gz",
    1200: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1200.pb.gz",
    1300: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1300.pb.gz",
    1400: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1400.pb.gz",
    1500: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1500.pb.gz",
    1600: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1600.pb.gz",
    1700: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1700.pb.gz",
    1800: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1800.pb.gz",
    1900: "https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1900.pb.gz",
    # 2200 remains a community-contributed network
    2200: "https://github.com/CallOn84/LeelaNets/raw/refs/heads/main/Nets/Maia%202200/maia-2200.pb.gz",
}


def find_maia_asset(level: int) -> Optional[tuple[str, str]]:
    """Return (asset_name, url) for a Maia network at the given level.

    Prefer known direct URLs (fast, stable), then fall back to searching
    known GitHub release assets.
    """
    # Prefer direct links to avoid API calls and timeouts
    if level in MAIA_DIRECT_URLS:
        url = MAIA_DIRECT_URLS[level]
        return (f"maia-{level}.pb.gz", url)

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
    filename = nets_dir() / f"maia-{level}.pb.gz"
    _download_to_file_with_progress(url, filename, label=f"Maia {level}")
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


CONTRIB_BT4_URL = (
    "https://storage.lczero.org/files/networks-contrib/big-transformers/BT4-1740.pb.gz"
)


def install_lczero_best_network() -> Path:
    """Download the BT4-1740 transformer and use it as the Leela network.

    Saves as both 'lczero-best.pb.gz' (for compatibility) and 'BT4-1740.pb.gz'.
    """
    ensure_dirs()
    out_best = nets_dir() / "lczero-best.pb.gz"
    out_bt4 = nets_dir() / "BT4-1740.pb.gz"
    _download_to_file_with_progress(CONTRIB_BT4_URL, out_best, label="Leela best net")
    # Also save under the BT4 filename for convenience
    try:
        shutil.copy2(out_best, out_bt4)
    except Exception:
        _download_to_file_with_progress(CONTRIB_BT4_URL, out_bt4, label="BT4-1740")
    return out_best


def install_lczero_bt4_transformer() -> Path:
    """Download the BT4-1740 transformer network (explicit helper)."""
    ensure_dirs()
    out = nets_dir() / "BT4-1740.pb.gz"
    _download_to_file_with_progress(CONTRIB_BT4_URL, out, label="BT4-1740")
    return out
