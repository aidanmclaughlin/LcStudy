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

# Generate a replacement set with the stable best net and fixed search time
python tools/generate_games.py \
  --count 100 \
  --replace-output \
  --leela-net BT4-it332 \
  --leela-movetime-ms 5000 \
  --maia-nodes 1 \
  --maia-temperature 1.0 \
  --maia-policy-temp 1.0 \
  --maia-temp-decay-moves 22 \
  --maia-temp-cutoff-move 20 \
  --maia-temp-endgame 0.25 \
  --maia-temp-value-cutoff 25 \
  --seed 20260412 \
  --require-result
```

`--replace-output` writes the new batch in a temporary folder first. Existing PGNs are deleted only after the requested replacement batch completes.
Use `--require-result` for production batches so every saved PGN reaches a real game result.

Games are saved to `src/lcstudy/data/pgn/` and will be included in the next Vercel deployment.

### Lambda Cloud generation

Use a single Lambda Cloud GPU instance. Keep the whole replacement batch on one instance type with the same `--leela-movetime-ms` value, and keep Maia at `--maia-nodes 1` with Maia-only temperature sampling so it stays policy-driven but not deterministic.

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
  --leela-movetime-ms 5000 \
  --maia-nodes 1 \
  --maia-temperature 1.0 \
  --maia-policy-temp 1.0 \
  --maia-temp-decay-moves 22 \
  --maia-temp-cutoff-move 20 \
  --maia-temp-endgame 0.25 \
  --maia-temp-value-cutoff 25 \
  --no-leela-config \
  --leela-backend cuda-fp16 \
  --seed 20260412 \
  --require-result

python3 tools/generate_games.py \
  --count 100 \
  --replace-output \
  --leela-net BT4-it332 \
  --leela-movetime-ms 5000 \
  --maia-nodes 1 \
  --maia-temperature 1.0 \
  --maia-policy-temp 1.0 \
  --maia-temp-decay-moves 22 \
  --maia-temp-cutoff-move 20 \
  --maia-temp-endgame 0.25 \
  --maia-temp-value-cutoff 25 \
  --no-leela-config \
  --leela-backend cuda-fp16 \
  --seed 20260412 \
  --require-result
```

Copy the finished PGNs back before terminating the instance:

```bash
rsync ubuntu@<lambda-host>:~/LcStudy/src/lcstudy/data/pgn/ src/lcstudy/data/pgn/
```

### Workflow

1. Run the 2-game smoke test
2. Generate the replacement batch with the same search times
3. Commit the new PGN files
4. Push to deploy to Vercel
5. Users will see the new games in the app
