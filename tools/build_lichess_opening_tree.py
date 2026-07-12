#!/usr/bin/env python3
"""Build a compact opening trie from a Lichess rated-game PGN stream.

The input should be a decompressed monthly standard PGN export. Only rated rapid
games with at least ten plies are included. Counts are grouped the same way as
the Lichess opening explorer: by the midpoint of the two player ratings.
"""

import argparse
import gzip
import os
import pickle
import re
import sys
import time
from pathlib import Path
from typing import TextIO

OPENING_PLIES = 10
FORMAT_VERSION = 3
RATING_GROUPS = (0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500)
MAX_BACKOFF_SUFFIX = 3
RESULT_TOKENS = {"1-0", "0-1", "1/2-1/2", "*"}
HEADER_RE = re.compile(r'^\[([A-Za-z0-9_]+) "(.*)"\]$')
COMMENT_RE = re.compile(r"\{[^}]*\}")
MOVE_NUMBER_RE = re.compile(r"^\d+\.(?:\.\.)?")
ANNOTATION_RE = re.compile(r"[!?]+$")


def rating_group(white_elo: int, black_elo: int) -> int:
    average = (white_elo + black_elo) // 2
    return max(group for group in RATING_GROUPS if group <= average)


def extract_san_moves(movetext: str, limit: int = OPENING_PLIES) -> list[str]:
    clean = COMMENT_RE.sub(" ", movetext)
    moves: list[str] = []
    for raw_token in clean.split():
        token = MOVE_NUMBER_RE.sub("", raw_token)
        if not token or token in RESULT_TOKENS or token.startswith("$"):
            continue
        token = ANNOTATION_RE.sub("", token)
        if not token:
            continue
        moves.append(token)
        if len(moves) == limit:
            break
    return moves


def insert_line(root: dict[str, list[object]], moves: list[str]) -> None:
    node = root
    for san in moves:
        entry = node.get(san)
        if entry is None:
            entry = [0, {}]
            node[san] = entry
        entry[0] = int(entry[0]) + 1
        node = entry[1]  # type: ignore[assignment]


def build_backoff_tables(
    roots: dict[int, dict[str, list[object]]],
) -> dict[int, list[dict[tuple[str, ...], dict[str, int]]]]:
    """Aggregate human move counts by ply and recent SAN suffix."""
    tables: dict[int, list[dict[tuple[str, ...], dict[str, int]]]] = {}
    for group, root in roots.items():
        by_ply: list[dict[tuple[str, ...], dict[str, int]]] = [
            {} for _ in range(OPENING_PLIES)
        ]
        stack: list[tuple[dict[str, list[object]], tuple[str, ...]]] = [(root, ())]
        while stack:
            node, history = stack.pop()
            ply = len(history)
            if ply >= OPENING_PLIES:
                continue
            for san, entry in node.items():
                if (
                    not isinstance(entry, list)
                    or len(entry) != 2
                    or not isinstance(entry[1], dict)
                ):
                    continue
                count = int(entry[0])
                for suffix_length in range(min(MAX_BACKOFF_SUFFIX, ply) + 1):
                    suffix = history[-suffix_length:] if suffix_length else ()
                    candidates = by_ply[ply].setdefault(suffix, {})
                    candidates[san] = candidates.get(san, 0) + count
                if entry[1] and ply + 1 < OPENING_PLIES:
                    stack.append((entry[1], history + (san,)))
        tables[group] = by_ply
    return tables


def build_tree(
    stream: TextIO,
    source_month: str,
    source_url: str,
    max_games: int = 0,
    progress_every: int = 100_000,
    progress_stream: TextIO = sys.stderr,
) -> dict[str, object]:
    roots: dict[int, dict[str, list[object]]] = {group: {} for group in RATING_GROUPS}
    sampled_by_group = {group: 0 for group in RATING_GROUPS}
    headers: dict[str, str] = {}
    movetext_lines: list[str] = []
    total_games = 0
    rapid_games = 0
    sampled_games = 0
    first_date = ""
    last_date = ""
    started = time.time()

    def finish_game() -> bool:
        nonlocal total_games, rapid_games, sampled_games, first_date, last_date
        if not movetext_lines:
            return False
        total_games += 1
        if headers.get("Event") != "Rated Rapid game":
            return False
        rapid_games += 1
        try:
            white_elo = int(headers["WhiteElo"])
            black_elo = int(headers["BlackElo"])
        except (KeyError, ValueError):
            return False

        moves = extract_san_moves(" ".join(movetext_lines))
        if len(moves) < OPENING_PLIES:
            return False

        group = rating_group(white_elo, black_elo)
        insert_line(roots[group], moves)
        sampled_by_group[group] += 1
        sampled_games += 1
        game_date = headers.get("UTCDate") or headers.get("Date") or ""
        if game_date:
            first_date = first_date or game_date
            last_date = game_date

        if progress_every and sampled_games % progress_every == 0:
            elapsed = max(time.time() - started, 0.001)
            print(
                f"[{sampled_games:,}] rapid openings "
                f"({sampled_games / elapsed:,.0f}/s, {game_date})",
                file=progress_stream,
                flush=True,
            )
        return max_games > 0 and sampled_games >= max_games

    for raw_line in stream:
        line = raw_line.strip()
        if line.startswith("["):
            if movetext_lines:
                if finish_game():
                    break
                headers = {}
                movetext_lines = []
            match = HEADER_RE.match(line)
            if match:
                headers[match.group(1)] = match.group(2)
        elif line:
            movetext_lines.append(line)
        elif movetext_lines:
            if finish_game():
                break
            headers = {}
            movetext_lines = []
    else:
        if movetext_lines:
            finish_game()

    if sampled_games == 0:
        raise RuntimeError("No eligible rated rapid games were found")

    backoffs = build_backoff_tables(roots)

    return {
        "metadata": {
            "format_version": FORMAT_VERSION,
            "source": "lichess-rated-rapid-dump",
            "source_month": source_month,
            "source_url": source_url,
            "speed": "rapid",
            "plies": OPENING_PLIES,
            "total_games_seen": total_games,
            "rapid_games_seen": rapid_games,
            "sampled_games": sampled_games,
            "sampled_by_group": sampled_by_group,
            "first_date": first_date,
            "last_date": last_date,
        },
        "roots": roots,
        "backoffs": backoffs,
    }


def write_tree(payload: dict[str, object], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with gzip.open(temporary, "wb", compresslevel=6) as handle:
        pickle.dump(payload, handle, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(temporary, output)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build an LcStudy Lichess opening trie"
    )
    parser.add_argument("--output", "-o", type=Path, required=True)
    parser.add_argument("--source-month", required=True, help="YYYY-MM")
    parser.add_argument("--source-url", required=True)
    parser.add_argument(
        "--max-games",
        type=int,
        default=0,
        help="stop after this many eligible games; 0 reads the complete dump",
    )
    parser.add_argument("--progress-every", type=int, default=100_000)
    args = parser.parse_args()

    payload = build_tree(
        sys.stdin,
        source_month=args.source_month,
        source_url=args.source_url,
        max_games=args.max_games,
        progress_every=args.progress_every,
    )
    write_tree(payload, args.output)
    metadata = payload["metadata"]
    print(f"Wrote {args.output}: {metadata}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
