# Agents and engines in LcStudy

This document describes the “agents” that power LcStudy, how they are configured, and how requests flow through the system.

TL;DR
- Leela (lc0) and Maia are the two chess agents the app uses.
- For the interactive web app, LcStudy relies on precomputed Leela-vs-Maia games (PGNs) for fast, offline grading.
- A background generator process can continuously produce those games on your machine if lc0 and the networks are installed.

Contents
- Conceptual model
- Components and data flow
- Installing and selecting agents
- Seed generation details
- Extending or swapping agents
- Data locations and limits

Conceptual model
- Agent: a chess engine plus weights and options. In LcStudy, both “Leela” and “Maia <level>” are lc0 engines with different networks.
- Grader: logic that determines whether the user’s guess matches Leela’s expected move at a given ply.
- Seeds: precomputed games (PGN) where Leela plays Maia. Seeds make the UI responsive because grading does not need to call a heavy engine.

Components and data flow

At runtime
1) The web app starts (FastAPI/uvicorn).
2) A background subprocess is launched that can generate seed games (see Seed generation details).
3) When the UI creates a new session, GameService requests a precomputed game from PrecomputedRepository and determines Leela’s color for that game.
4) On each guess (POST /api/v1/session/{id}/predict), GameService compares the user’s move to the precomputed Leela move at the current ply:
   - Correct: the move is applied; score increases; the Maia reply is immediately applied from the seed; the game advances.
   - Incorrect: attempts increase; after 10 failed attempts the correct move is auto-played and the game advances.
5) No live engine calls are performed on the request path. This keeps the UI responsive without a dedicated GPU or long searches.

Classes involved
- lcstudy.services.engine_service
  - EngineInterface: minimal protocol for analyze/bestmove/close.
  - LeelaEngine: thin wrapper around lc0 using lcstudy.engines.Lc0Engine.
  - EngineService: manages engine instances and caches lc0 processes:
    - get_leela_engine(session_id): lc0 with the best Leela network.
    - get_maia_engine(level): lc0 with a Maia network for the given level.
- lcstudy.engines
  - EngineConfig: options passed to lc0 (weights file, threads, backend, …).
  - Lc0Engine: context-managed wrapper over python-chess UCI engine with helpers for analyse and bestmove, plus projection helpers for UI-friendly fields.
- lcstudy.repositories.precomputed_repository
  - Loads seed PGNs, tracks Leela’s color per game, and serves expected moves by (game_id, ply_index).
- lcstudy.services.game_service
  - Request-time logic and grading against precomputed games. It does not call engines on the hot path.

Installing and selecting agents

Networks and binaries
- Install lc0: lcstudy install lc0
- Best Leela network: lcstudy install bestnet (saved as ~/.lcstudy/nets/lczero-best.pb.gz)
- Maia networks (1100..1900): lcstudy install maia

Selecting Maia level
- The UI sends the desired Maia level when creating a new session.
- Seed generation samples Maia levels to create variety; over time your precomputed library will include a spread of levels.

Engine settings
- Threads and nodes: LCSTUDY_THREADS and LCSTUDY_DEFAULT_NODES influence defaults consumed by helpers.
- Backend: lc0 usually auto-detects the optimal backend; forcing a specific backend can be done via lc0 options (LcStudy does not currently expose a separate env var for this).

Seed generation details

Module: lcstudy.scripts.generate_seeds
- Produces PGNs where Leela plays against Maia and writes them to ~/.lcstudy/precomputed/games.
- On macOS/Linux/Windows, this runs locally and requires the lc0 binary and the corresponding networks.
- Leela move search: fixed small node budget (default ~1000 nodes) to keep generation reasonably fast.
- Maia move search: very small node count (1 by default) with temperature sampling from MultiPV during the opening plies to diversify positions.
- Color: Each game flips a coin to decide whether Leela is White or Black; the session always lets you play as Leela.
- Background cap: In daemon mode, generation idles when the precomputed directory has 25 or more PGN files (configurable via --max-seeds). This avoids unnecessary compute once you have a healthy seed pool.

Running manually
```bash
python -m lcstudy.scripts.generate_seeds --count 25    # generate 25 games
python -m lcstudy.scripts.generate_seeds --daemon      # keep generating; idles once 25 seeds exist
python -m lcstudy.scripts.generate_seeds --daemon --max-seeds 50  # change the cap
```

Extending or swapping agents

Adding another lc0-based agent (new network)
- Place the weights under ~/.lcstudy/nets and extend EngineService to return a configured LeelaEngine pointing to those weights.

Integrating a different UCI engine
- Implement a small wrapper that satisfies EngineInterface (analyze, get_best_move, close) using python-chess UCI.
- Extend EngineService to create/cache instances of your wrapper.
- Update the generator to use your agent for either side when creating seeds.

Data locations and limits

- Binaries: ~/.lcstudy/bin
- Networks: ~/.lcstudy/nets
- Precomputed games: ~/.lcstudy/precomputed/games
- Game history: ~/.lcstudy/game_history.json

Notes and limits
- If engines/networks are not installed, the app still runs, but grading requires precomputed games. Use lcstudy up and give the generator time to create a library, or copy PGNs into the precomputed folder.
- Engine processes are cached and reused by EngineService; the web request path avoids engine calls to keep latency low.
