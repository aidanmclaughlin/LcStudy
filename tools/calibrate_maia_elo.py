#!/usr/bin/env python3
"""Calibrate LCStudy accuracy to Maia-2 rapid rating buckets.

The generated PGNs already contain Leela's LCStudy score for every legal move
at each player prompt. This script runs Maia-2 on a deterministic sample of
those same positions and computes its policy-weighted expected LCStudy score.

Only prompts after the first five player moves are used because Maia-2 was
trained from ply 11 onward. Games are the sampling and uncertainty unit so long
games do not receive more weight and moves from one game are not treated as
independent observations.

Usage:
    .venv-maia2/bin/python tools/calibrate_maia_elo.py
"""

from __future__ import annotations

import argparse
import base64
import binascii
from dataclasses import dataclass
from datetime import date
import gzip
import json
import math
from pathlib import Path
import random
import re
import statistics
from typing import Iterable, Optional

import chess
import chess.pgn
import pandas as pd
from maia2 import inference as maia_inference
from maia2 import model as maia_model


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PGN_DIR = REPO_ROOT / "src" / "lcstudy" / "data" / "pgn"
DEFAULT_OUTPUT = (
    REPO_ROOT / "src" / "lcstudy" / "data" / "maia-elo-calibration.json"
)
LCSTUDY_COMMENT = re.compile(r"\[%lcstudy\s+([A-Za-z0-9_-]+)\]")
MIN_PROMPT_INDEX = 5
INTERVAL_Z_80 = 1.2815515655446004
MODEL_BUCKETS = (
    (1050, "1000-1099", 1050),
    (1150, "1100-1199", 1150),
    (1250, "1200-1299", 1250),
    (1350, "1300-1399", 1350),
    (1450, "1400-1499", 1450),
    (1550, "1500-1599", 1550),
    (1650, "1600-1699", 1650),
    (1750, "1700-1799", 1750),
    (1850, "1800-1899", 1850),
    (1950, "1900-1999", 1950),
    (2100, "2000-2199", 2100),
)


@dataclass(frozen=True)
class Prompt:
    game_id: str
    fen: str
    opponent_elo: int
    scores: dict[str, float]


@dataclass(frozen=True)
class SampledGame:
    game_id: str
    prompts: tuple[Prompt, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Calibrate LCStudy accuracy to Maia-2 rapid Elo"
    )
    parser.add_argument("--pgn-dir", type=Path, default=DEFAULT_PGN_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--games", type=int, default=600)
    parser.add_argument("--positions-per-game", type=int, default=6)
    parser.add_argument("--seed", type=int, default=20260718)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--device", default="cpu")
    return parser.parse_args()


def decode_analysis(comment: str) -> Optional[dict[str, object]]:
    match = LCSTUDY_COMMENT.search(comment)
    if not match:
        return None
    raw = match.group(1).replace("-", "+").replace("_", "/")
    raw += "=" * ((4 - len(raw) % 4) % 4)
    try:
        payload = json.loads(base64.b64decode(raw).decode("utf-8"))
    except (binascii.Error, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def read_game(path: Path) -> Optional[chess.pgn.Game]:
    opener = gzip.open if path.suffix == ".gz" else open
    try:
        with opener(path, "rt", encoding="utf-8") as handle:
            return chess.pgn.read_game(handle)
    except (OSError, UnicodeDecodeError, ValueError):
        return None


def opponent_elo(headers: chess.pgn.Headers) -> Optional[int]:
    explicit = headers.get("LcStudyOpponentEloSelf")
    if explicit:
        try:
            return int(explicit)
        except ValueError:
            pass
    match = re.search(
        r"Maia\s+(\d+)",
        f"{headers.get('White', '')} {headers.get('Black', '')}",
        re.IGNORECASE,
    )
    return int(match.group(1)) if match else None


def leela_color(headers: chess.pgn.Headers) -> Optional[chess.Color]:
    white = headers.get("White", "").lower()
    black = headers.get("Black", "").lower()
    if "leela" in white and "player" in white:
        return chess.WHITE
    if "leela" in black and "player" in black:
        return chess.BLACK
    return None


def extract_prompts(path: Path) -> list[Prompt]:
    game = read_game(path)
    if game is None:
        return []
    if game.headers.get("LcStudyLeelaNet") != "BT4-it332":
        return []
    if game.headers.get("LcStudyLeelaSearch") != "200 nodes":
        return []
    if game.headers.get("LcStudyGrading") != "q-wpl-exp10":
        return []

    color = leela_color(game.headers)
    opponent = opponent_elo(game.headers)
    if color is None or opponent is None:
        return []

    game_id = re.sub(r"\.pgn(?:\.gz)?$", "", path.name, flags=re.IGNORECASE)
    board = game.board()
    prompt_index = 0
    prompts: list[Prompt] = []

    for node in game.mainline():
        if board.turn == color:
            payload = decode_analysis(node.comment)
            moves = payload.get("moves") if payload else None
            if payload and payload.get("v") == 2 and isinstance(moves, list):
                scores = {
                    str(move.get("u", "")).lower(): float(move.get("a"))
                    for move in moves
                    if isinstance(move, dict)
                    and isinstance(move.get("u"), str)
                    and isinstance(move.get("a"), (int, float))
                }
                if prompt_index >= MIN_PROMPT_INDEX and scores:
                    prompts.append(
                        Prompt(
                            game_id=game_id,
                            fen=board.fen(),
                            opponent_elo=opponent,
                            scores=scores,
                        )
                    )
            prompt_index += 1
        board.push(node.move)

    return prompts


def pgn_paths(directory: Path) -> list[Path]:
    return sorted((*directory.glob("*.pgn"), *directory.glob("*.pgn.gz")))


def sample_games(
    paths: list[Path],
    game_limit: int,
    positions_per_game: int,
    rng: random.Random,
) -> list[SampledGame]:
    shuffled = paths[:]
    rng.shuffle(shuffled)
    sampled: list[SampledGame] = []

    for path in shuffled:
        prompts = extract_prompts(path)
        if not prompts:
            continue
        if len(prompts) > positions_per_game:
            prompts = [prompts[index] for index in sorted(
                rng.sample(range(len(prompts)), positions_per_game)
            )]
        sampled.append(SampledGame(prompts[0].game_id, tuple(prompts)))
        if len(sampled) >= game_limit:
            break

    if len(sampled) < game_limit:
        raise RuntimeError(
            f"Only {len(sampled)} eligible games found; requested {game_limit}"
        )
    return sampled


def expected_score(
    policy: dict[str, float],
    scores: dict[str, float],
) -> tuple[float, float]:
    weighted = 0.0
    exact = 0.0
    mass = 0.0
    for move, probability in policy.items():
        score = scores.get(move.lower())
        if score is None or probability <= 0 or not math.isfinite(probability):
            continue
        mass += probability
        weighted += probability * score
        if score >= 99.995:
            exact += probability
    if mass <= 0:
        raise RuntimeError("Maia policy and LCStudy legal moves did not overlap")
    return weighted / mass, exact / mass


def mean_interval(values: list[float]) -> tuple[float, float, float]:
    center = statistics.fmean(values)
    if len(values) < 2:
        return center, center, center
    standard_error = statistics.stdev(values) / math.sqrt(len(values))
    return (
        center,
        center - INTERVAL_Z_80 * standard_error,
        center + INTERVAL_Z_80 * standard_error,
    )


def isotonic(values: Iterable[float]) -> list[float]:
    blocks: list[dict[str, object]] = []
    for index, value in enumerate(values):
        blocks.append({"start": index, "end": index, "weight": 1.0, "sum": value})
        while len(blocks) >= 2:
            left = blocks[-2]
            right = blocks[-1]
            left_mean = float(left["sum"]) / float(left["weight"])
            right_mean = float(right["sum"]) / float(right["weight"])
            if left_mean <= right_mean:
                break
            blocks[-2:] = [{
                "start": left["start"],
                "end": right["end"],
                "weight": float(left["weight"]) + float(right["weight"]),
                "sum": float(left["sum"]) + float(right["sum"]),
            }]

    result = [0.0] * sum(int(block["end"]) - int(block["start"]) + 1 for block in blocks)
    for block in blocks:
        block_mean = float(block["sum"]) / float(block["weight"])
        for index in range(int(block["start"]), int(block["end"]) + 1):
            result[index] = block_mean
    return result


def calibrate(
    games: list[SampledGame],
    device: str,
    batch_size: int,
) -> list[dict[str, object]]:
    prompts = [prompt for game in games for prompt in game.prompts]
    game_ids = [prompt.game_id for prompt in prompts]
    print(f"Loading Maia-2 rapid on {device}...", flush=True)
    model = maia_model.from_pretrained(type="rapid", device=device)
    raw_points: list[dict[str, object]] = []

    for elo, bucket, model_elo in MODEL_BUCKETS:
        frame = pd.DataFrame({
            "fen": [prompt.fen for prompt in prompts],
            "move": [next(iter(prompt.scores)) for prompt in prompts],
            "elo_self": [model_elo] * len(prompts),
            "elo_oppo": [prompt.opponent_elo for prompt in prompts],
        })
        predictions, _ = maia_inference.inference_batch(
            frame,
            model,
            verbose=False,
            batch_size=batch_size,
            num_workers=0,
        )
        per_game_scores: dict[str, list[float]] = {}
        per_game_exact: dict[str, list[float]] = {}
        for index, policy in enumerate(predictions["move_probs"]):
            score, exact = expected_score(policy, prompts[index].scores)
            per_game_scores.setdefault(game_ids[index], []).append(score)
            per_game_exact.setdefault(game_ids[index], []).append(exact)

        game_scores = [statistics.fmean(values) for values in per_game_scores.values()]
        game_exact = [statistics.fmean(values) for values in per_game_exact.values()]
        accuracy, low80, high80 = mean_interval(game_scores)
        raw_points.append({
            "elo": elo,
            "bucket": bucket,
            "rawAccuracy": accuracy,
            "low80": low80,
            "high80": high80,
            "exactRate": 100 * statistics.fmean(game_exact),
            "games": len(game_scores),
            "positions": len(prompts),
        })
        print(
            f"  {bucket}: {accuracy:.3f}% "
            f"({low80:.3f}-{high80:.3f}), "
            f"{100 * statistics.fmean(game_exact):.2f}% exact",
            flush=True,
        )

    adjusted = isotonic(float(point["rawAccuracy"]) for point in raw_points)
    for point, accuracy in zip(raw_points, adjusted):
        point["accuracy"] = accuracy
    return raw_points


def rounded_point(point: dict[str, object]) -> dict[str, object]:
    return {
        key: round(value, 4) if isinstance(value, float) else value
        for key, value in point.items()
    }


def main() -> int:
    args = parse_args()
    if args.games < 2 or args.positions_per_game < 1 or args.batch_size < 1:
        raise ValueError("games, positions-per-game, and batch-size must be positive")

    paths = pgn_paths(args.pgn_dir)
    rng = random.Random(args.seed)
    print(
        f"Sampling {args.games} of {len(paths)} corpus games, "
        f"up to {args.positions_per_game} post-opening prompts each...",
        flush=True,
    )
    games = sample_games(
        paths,
        args.games,
        args.positions_per_game,
        rng,
    )
    positions = sum(len(game.prompts) for game in games)
    print(f"Sample contains {positions} prompts.", flush=True)
    points = calibrate(games, args.device, args.batch_size)

    payload = {
        "version": 1,
        "generatedAt": date.today().isoformat(),
        "model": "maia2-rapid",
        "oracle": {
            "network": "BT4-it332",
            "search": "200 nodes",
            "grading": "q-wpl-exp10",
        },
        "scope": {
            "corpusGames": len(paths),
            "sampledGames": len(games),
            "sampledPositions": positions,
            "positionsPerGame": args.positions_per_game,
            "firstIncludedPrompt": MIN_PROMPT_INDEX + 1,
            "seed": args.seed,
            "confidence": 0.8,
            "ratingRange": [MODEL_BUCKETS[0][0], MODEL_BUCKETS[-1][0]],
            "weighting": "equal-games",
        },
        "points": [rounded_point(point) for point in points],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
