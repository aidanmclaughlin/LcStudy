#!/usr/bin/env python3
"""Audit a generated LcStudy batch against its frozen Lichess opening tree."""

import argparse
from collections import Counter
import gzip
import json
import pickle
import random
from pathlib import Path
from typing import Iterable

import chess
import chess.pgn

from generate_games_maia2 import (
    OPENING_BACKOFF_POLICY,
    OPENING_PLIES,
    OPENING_TREE_FORMAT_VERSION,
    opening_tree_legal_candidates,
)


def pgn_paths(directory: Path, prefix: str = "") -> list[Path]:
    return sorted(
        path
        for path in directory.iterdir()
        if path.name.startswith(prefix)
        and (path.name.endswith(".pgn") or path.name.endswith(".pgn.gz"))
    )


def read_game(path: Path) -> chess.pgn.Game:
    opener = gzip.open if path.name.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as handle:
        game = chess.pgn.read_game(handle)
    if game is None:
        raise RuntimeError(f"Could not parse {path.name}")
    return game


def move_key(game: chess.pgn.Game) -> tuple[str, ...]:
    return tuple(move.uci() for move in game.mainline_moves())


def load_comparison_keys(
    directory: Path | None,
    ignored_prefixes: tuple[str, ...],
) -> set[tuple[str, ...]]:
    if directory is None:
        return set()
    keys = set()
    for path in pgn_paths(directory):
        if path.name.startswith(ignored_prefixes):
            continue
        keys.add(move_key(read_game(path)))
    return keys


def weighted_pick(candidates: dict[str, int], rng: random.Random) -> str:
    total = sum(candidates.values())
    pick = rng.random() * total
    cumulative = 0
    for san, count in candidates.items():
        cumulative += count
        if pick < cumulative:
            return san
    return next(reversed(candidates))


def total_variation(
    observed: Counter[str],
    expected: Counter[str],
    sample_count: int,
) -> float:
    labels = observed.keys() | expected.keys()
    return 0.5 * sum(
        abs(observed[label] / sample_count - expected[label] / sample_count)
        for label in labels
    )


def distribution_check(
    events: list[tuple[str, dict[str, int]]],
    simulations: int,
    rng: random.Random,
) -> dict[str, object]:
    observed = Counter(selected for selected, _ in events)
    expected: Counter[str] = Counter()
    for _, candidates in events:
        total = sum(candidates.values())
        for san, count in candidates.items():
            expected[san] += count / total

    observed_tv = total_variation(observed, expected, len(events))
    simulated_tvs = []
    for _ in range(simulations):
        simulated = Counter(weighted_pick(candidates, rng) for _, candidates in events)
        simulated_tvs.append(total_variation(simulated, expected, len(events)))
    simulated_tvs.sort()

    rank = sum(tv <= observed_tv for tv in simulated_tvs) / len(simulated_tvs)
    lower = simulated_tvs[int(0.025 * (len(simulated_tvs) - 1))]
    upper = simulated_tvs[int(0.975 * (len(simulated_tvs) - 1))]
    return {
        "events": len(events),
        "observed_tv": round(observed_tv, 5),
        "simulation_95pct": [round(lower, 5), round(upper, 5)],
        "simulation_percentile": round(rank, 3),
    }


def require_header(
    game: chess.pgn.Game,
    name: str,
    expected: str,
    filename: str,
) -> None:
    actual = game.headers.get(name)
    if actual != expected:
        raise RuntimeError(f"{filename}: {name} is {actual!r}, expected {expected!r}")


def audit_games(
    paths: Iterable[Path],
    payload: dict[str, object],
    comparison_keys: set[tuple[str, ...]],
    simulations: int,
    seed: int,
) -> dict[str, object]:
    metadata = payload["metadata"]
    roots = payload["roots"]
    backoffs = payload["backoffs"]
    if (
        not isinstance(metadata, dict)
        or not isinstance(roots, dict)
        or not isinstance(backoffs, dict)
    ):
        raise RuntimeError("Opening tree is missing metadata, roots, or backoffs")
    if metadata.get("format_version") != OPENING_TREE_FORMAT_VERSION:
        raise RuntimeError("Opening tree format does not match the generator")

    expected_headers = {
        "LcStudyLeelaNet": "BT4-it332",
        "LcStudyLeelaSearch": "200 nodes",
        "LcStudyLeelaLifecycle": "fresh-per-game",
        "LcStudyOpeningSource": str(metadata["source"]),
        "LcStudyOpeningSpeed": "rapid",
        "LcStudyOpeningPlies": str(OPENING_PLIES),
        "LcStudyOpeningBackoff": OPENING_BACKOFF_POLICY,
        "LcStudyOpeningGames": str(metadata["sampled_games"]),
    }
    expected_since = str(metadata["first_date"])[:7].replace(".", "-")
    expected_until = str(metadata["last_date"])[:7].replace(".", "-")

    opening_events: list[list[tuple[str, dict[str, int]]]] = [
        [] for _ in range(OPENING_PLIES // 2)
    ]
    colors = Counter()
    rating_groups = Counter()
    backoff_sources = Counter()
    seen_keys: dict[tuple[str, ...], str] = {}
    duplicate_pairs: list[tuple[str, str]] = []
    retained_collisions: list[str] = []
    game_count = 0
    analysis_moves = 0

    for path in paths:
        game = read_game(path)
        for name, expected in expected_headers.items():
            require_header(game, name, expected, path.name)
        require_header(game, "LcStudyOpeningSince", expected_since, path.name)
        require_header(game, "LcStudyOpeningUntil", expected_until, path.name)

        white = game.headers.get("White", "")
        black = game.headers.get("Black", "")
        if white == "Leela (PLAYER)":
            leela_is_white = True
            colors["leela_white"] += 1
        elif black == "Leela (PLAYER)":
            leela_is_white = False
            colors["leela_black"] += 1
        else:
            raise RuntimeError(f"{path.name}: missing Leela player header")

        group = int(game.headers["LcStudyOpeningRatingGroup"])
        if not isinstance(roots.get(group), dict):
            raise RuntimeError(f"{path.name}: tree has no rating group {group}")
        rating_groups[group] += 1

        board = game.board()
        san_history: list[str] = []
        opponent_opening_move = 0
        for child in game.mainline():
            is_leela_turn = (board.turn == chess.WHITE) == leela_is_white
            san = board.san(child.move)

            if board.ply() < OPENING_PLIES and not is_leela_turn:
                legal_candidates, source = opening_tree_legal_candidates(
                    board,
                    roots,
                    backoffs,
                    group,
                    san_history,
                )
                candidates = {
                    board.san(candidate): count for candidate, count in legal_candidates
                }
                if san not in candidates:
                    raise RuntimeError(
                        f"{path.name}: opponent move {san} has zero source count"
                    )
                opening_events[opponent_opening_move].append((san, candidates))
                opponent_opening_move += 1
                backoff_sources[source] += 1

            if is_leela_turn:
                if "[%lcstudy " not in child.comment:
                    raise RuntimeError(
                        f"{path.name}: Leela move {board.ply() + 1} lacks analysis"
                    )
                analysis_moves += 1
            san_history.append(san)
            board.push(child.move)

        key = move_key(game)
        if key in seen_keys:
            duplicate_pairs.append((seen_keys[key], path.name))
        else:
            seen_keys[key] = path.name
        if key in comparison_keys:
            retained_collisions.append(path.name)
        game_count += 1

    if duplicate_pairs:
        details = ", ".join(f"{first} = {second}" for first, second in duplicate_pairs)
        raise RuntimeError(f"Duplicate generated games: {details}")
    if retained_collisions:
        raise RuntimeError(
            "Duplicates of retained production games: " + ", ".join(retained_collisions)
        )
    if game_count == 0:
        raise RuntimeError("No generated PGNs matched")

    rng = random.Random(seed)
    checks = [distribution_check(events, simulations, rng) for events in opening_events]
    return {
        "games": game_count,
        "analysis_moves": analysis_moves,
        "colors": dict(sorted(colors.items())),
        "rating_groups": dict(sorted(rating_groups.items())),
        "opening_sources": dict(sorted(backoff_sources.items())),
        "tree_games": metadata["sampled_games"],
        "tree_dates": [metadata["first_date"], metadata["last_date"]],
        "opening_move_distribution_checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit LcStudy Lichess openings")
    parser.add_argument("--tree", type=Path, required=True)
    parser.add_argument("--games", type=Path, required=True)
    parser.add_argument("--prefix", default="")
    parser.add_argument("--compare-dir", type=Path)
    parser.add_argument("--compare-ignore-prefix", action="append", default=[])
    parser.add_argument("--simulations", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=20260711)
    args = parser.parse_args()

    with gzip.open(args.tree, "rb") as handle:
        payload = pickle.load(handle)
    if not isinstance(payload, dict):
        raise RuntimeError("Opening tree payload is invalid")

    comparison_keys = load_comparison_keys(
        args.compare_dir,
        tuple(args.compare_ignore_prefix),
    )
    result = audit_games(
        pgn_paths(args.games, args.prefix),
        payload,
        comparison_keys,
        args.simulations,
        args.seed,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
