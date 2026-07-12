# LcStudy Tools

Offline utilities for managing LcStudy game data.

## generate_games.py

Generates Leela vs Maia training games and saves them as PGN files.

### Setup

1. Install Python dependencies:
   ```bash
   pip install chess
   ```

2. Install lc0:
   ```bash
   brew install lc0
   ```

3. Download networks to `~/.lcstudy/nets/`:
   - **Leela network**: Download [BT4-it332](https://storage.lczero.org/files/networks-contrib/BT4-1024x15x32h-swa-6147500-policytune-332.pb.gz) and save it as `BT4-it332.pb.gz`
   - **Maia networks**: Download from [maia-chess releases](https://github.com/CSSLab/maia-chess/releases) and save as `maia-1100.pb.gz`, `maia-1500.pb.gz`, etc.

### Usage

```bash
# Generate 10 games (default)
python tools/generate_games.py

# Generate 100 games
python tools/generate_games.py --count 100 --seed 20260412

# Generate a replacement set with the stable best net and fixed Leela node budget
python tools/generate_games.py \
  --count 100 \
  --replace-output \
  --leela-net BT4-it332 \
  --leela-nodes 200 \
  --maia-nodes 1 \
  --maia-temperature-random \
  --maia-policy-temp 1.0 \
  --maia-temp-decay-moves 10 \
  --maia-temp-cutoff-move 10 \
  --maia-temp-endgame 0.0 \
  --maia-temp-value-cutoff 25 \
  --seed 20260412 \
  --require-result
```

Use `--leela-nodes <n>` instead of `--leela-movetime-ms` when you need the Leela search budget to stay consistent across different GPU types.
`--replace-output` writes the new batch in a temporary folder first. Existing PGNs are deleted only after the requested replacement batch completes.
Use `--require-result` for production batches so every saved PGN reaches a real game result.

Games are saved to `src/lcstudy/data/pgn/` and will be included in the next Vercel deployment.

## generate_games_maia2.py

Production Maia-2 games keep Leela's original network, 200-node search, fresh
process lifecycle, and FEN-only position feeding. The opponent's moves before
ply 11 are sampled directly from the count-weighted distribution of rated rapid
games in the opponent's rating group; Maia-2 is used only from ply 11 onward,
matching the positions represented in its training.

Format 3 uses the exact rating-cohort path whenever it exists. For genuinely
unseen Leela lines, it backs off to the exact all-rating path, then the longest
available recent SAN suffix from three moves down to same-ply human frequencies.
Every candidate still comes from the current Lichess sample and is filtered for
legality in the actual position.

Maia-2 0.9 does not declare its runtime dependencies, so install them
explicitly in the generation environment:

```bash
python3 -m venv .venv-maia2
.venv-maia2/bin/pip install \
  maia2==0.9 chess==1.11.2 pandas gdown pyzstd einops pyyaml
```

Build a reproducible tree from the latest complete monthly Lichess export:

```bash
SOURCE=https://database.lichess.org/standard/lichess_db_standard_rated_2026-06.pgn.zst
curl -fL "$SOURCE" | zstd -dc | python3 tools/build_lichess_opening_tree.py \
  --source-month 2026-06 \
  --source-url "$SOURCE" \
  --output ~/.lcstudy/openings/lichess-rapid-2026-06.pkl.gz
```

Then run generation against that frozen count tree:

```bash
.venv-maia2/bin/python tools/generate_games_maia2.py \
  --count 1000 \
  --workers 3 \
  --leela-net BT4-it332 \
  --leela-nodes 200 \
  --leela-backend cuda \
  --opening-tree ~/.lcstudy/openings/lichess-rapid-2026-06.pkl.gz \
  --seed 20260711
```

Before a large batch, stress-test opening coverage without completing games:

```bash
.venv-maia2/bin/python tools/generate_games_maia2.py \
  --count 1000 \
  --workers 3 \
  --max-plies 10 \
  --leela-backend cuda \
  --opening-tree ~/.lcstudy/openings/lichess-rapid-2026-06.pkl.gz \
  --output /tmp/lcstudy-opening-smoke \
  --seed 20260712
```

Audit the completed batch against the same frozen tree before publishing it:

```bash
.venv-maia2/bin/python tools/audit_lichess_openings.py \
  --tree ~/.lcstudy/openings/lichess-rapid-2026-06.pkl.gz \
  --games src/lcstudy/data/pgn \
  --prefix lichess_maia2_20260711_
```

Every PGN records the source, speed, date window, sample size, ply cutoff, and
Lichess rating group so production batches remain auditable. Read the complete
latest month for production so every date contributes and rare Leela branches
retain support. The tree is mandatory: generation stops if it cannot return a
legal continuation after exhausting the human backoff hierarchy and never
substitutes another opening policy. Generation requires the frozen public dump
so runs are reproducible and independent of account access.

### Maia-2 production workflow

1. Build the tree from the complete latest monthly rated-standard dump.
2. Run 1,000 unique ten-ply games with `--max-plies 10`; any support error rejects the tree.
3. Generate the full batch with the same tree, Leela net, node budget, and seed.
4. Run `audit_lichess_openings.py` against the retained production corpus.
5. Replace only the superseded batch, then run the app build and browser tests.
6. Copy the validated files locally, terminate compute, then push and deploy production.

### Legacy Maia-1 Lambda generation

Use a single Lambda Cloud GPU instance. Keep the whole batch on one instance type with the same `--leela-nodes` value, and keep Maia at `--maia-nodes 1` with opening-only temperature sampling so it stays policy-driven after the first 10 moves.

Launch the instance with the default Lambda Stack image, add your SSH key, then copy Maia weights from this Mac:

```bash
ssh ubuntu@<lambda-host> 'mkdir -p ~/.lcstudy/nets'
rsync ~/.lcstudy/nets/maia-*.pb.gz ubuntu@<lambda-host>:~/.lcstudy/nets/
```

On the Lambda instance:

```bash
git clone https://github.com/<your-fork>/LcStudy.git
cd LcStudy
REPO_DIR=$PWD

sudo apt-get update
sudo apt-get install -y curl ninja-build pkg-config zlib1g-dev libopenblas-dev python3-pip
python3 -m pip install --upgrade meson ninja chess

git clone -b release/0.32 https://github.com/LeelaChessZero/lc0.git /tmp/lc0
cd /tmp/lc0
./build.sh release -Dgtest=false
mkdir -p ~/.lcstudy/bin ~/.lcstudy/nets
cp build/release/lc0 ~/.lcstudy/bin/lc0
cd "$REPO_DIR"

curl -fL 'https://storage.lczero.org/files/networks-contrib/BT4-1024x15x32h-swa-6147500-policytune-332.pb.gz' \
  -o ~/.lcstudy/nets/BT4-it332.pb.gz

python3 tools/generate_games.py \
  --count 2 \
  --output /tmp/lcstudy-pgn-smoke \
  --leela-net BT4-it332 \
  --leela-nodes 200 \
  --maia-nodes 1 \
  --maia-temperature-random \
  --maia-policy-temp 1.0 \
  --maia-temp-decay-moves 10 \
  --maia-temp-cutoff-move 10 \
  --maia-temp-endgame 0.0 \
  --maia-temp-value-cutoff 25 \
  --no-leela-config \
  --leela-backend cuda \
  --seed 20260412 \
  --require-result

python3 tools/generate_games.py \
  --count 1000 \
  --maia-levels 1100,1200,1300,1400,1500,1600,1700,1800,1900,2200 \
  --maia-search-variants 2200:2,2200:4,2200:8 \
  --leela-net BT4-it332 \
  --leela-nodes 200 \
  --maia-nodes 1 \
  --maia-temperature-random \
  --maia-policy-temp 1.0 \
  --maia-temp-decay-moves 10 \
  --maia-temp-cutoff-move 10 \
  --maia-temp-endgame 0.0 \
  --maia-temp-value-cutoff 25 \
  --no-leela-config \
  --leela-backend cuda \
  --seed 20260412 \
  --require-result
```

Copy the finished PGNs back before terminating the instance:

```bash
rsync ubuntu@<lambda-host>:~/LcStudy/src/lcstudy/data/pgn/ src/lcstudy/data/pgn/
```

### Legacy Maia-1 workflow

1. Run the 2-game smoke test
2. Generate the replacement batch with the same search times
3. Commit the new PGN files
4. Push to deploy to Vercel
5. Users will see the new games in the app
