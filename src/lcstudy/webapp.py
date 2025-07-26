from __future__ import annotations

import json
import os
import random
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

import chess
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .engines import (
    EngineConfig,
    Lc0Engine,
    find_lc0,
    info_to_lines,
    info_to_lines_san,
    pick_from_multipv,
)
from .engines import nets_dir


app = FastAPI(title="LcStudy")


@dataclass
class Session:
    id: str
    board: chess.Board = field(default_factory=chess.Board)
    score_total: float = 0.0
    move_index: int = 0  # ply count from start
    maia_level: int = 1500
    multipv: int = 5
    leela_nodes: int = 2000
    maia_nodes: int = 300
    leela_weights: Optional[Path] = None
    maia_weights: Optional[Path] = None
    lc0_path: Optional[Path] = None
    status: str = "playing"  # playing|finished
    history: list[dict] = field(default_factory=list)
    flip: bool = False


SESSIONS: Dict[str, Session] = {}
SESS_LOCK = threading.Lock()


def get_session(sid: str) -> Session:
    with SESS_LOCK:
        if sid not in SESSIONS:
            raise KeyError
        return SESSIONS[sid]


def html_index() -> str:
    return """
<!doctype html>
<html>
  <head>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <title>LcStudy</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 1rem; }
      .row { display: flex; gap: 1rem; align-items:flex-start; }
      .panel { border: 1px solid #ccc; padding: .75rem; border-radius: .5rem; }
      .board { display:grid; grid-template-columns: repeat(8, 48px); grid-auto-rows: 48px; border:1px solid #aaa; }
      .sq { display:flex; align-items:center; justify-content:center; font-size: 28px; user-select:none; cursor:pointer; }
      .light { background:#f0d9b5; }
      .dark { background:#b58863; }
      .sel { outline: 3px solid #33a; }
      .controls input[type=text] { width: 8rem; }
      .lines tt { display: block; }
      .bar { height:8px; background:#ddd; position:relative; margin-top:6px; }
      .bar .w { background:#4caf50; height:100%; }
    </style>
  </head>
  <body>
    <h1>LcStudy: Learn to think like Leela</h1>
    <div class='panel'>
      <form id='startForm'>
        Maia level: <input type='number' id='maia' value='1500' min='1100' max='1900' step='100'>
        MultiPV: <input type='number' id='mpv' value='5' min='1' max='10'>
        Leela nodes: <input type='number' id='lnodes' value='2000' min='200' step='100'>
        Maia nodes: <input type='number' id='mnodes' value='300' min='50' step='50'>
        <button type='submit'>Start New Session</button>
      </form>
      <div id='status'></div>
    </div>
    <div class='row'>
      <div class='panel' style='flex:1;'>
        <h3>Board</h3>
        <div id='board' class='board'></div>
        <div>
          <label><input type='checkbox' id='flip'> Black at bottom</label>
        </div>
        <div class='controls'>
          <form id='moveForm'>
            Predict Leela's move: <input type='text' id='move' autocomplete='off' placeholder='e2e4'>
            <button type='submit'>Play</button>
            <button type='button' id='resign'>End</button>
          </form>
          <div id='last'></div>
        </div>
      </div>
      <div class='panel' style='width: 28rem;'>
        <h3>Leela Top lines</h3>
        <div id='lines' class='lines'></div>
        <div class='bar'><div id='scorebar' class='w' style='width:0%'></div></div>
        <div>Score total: <span id='score_total'>0.000</span> | Avg/guess: <span id='score_avg'>0.000</span></div>
        <h4>History</h4>
        <div id='history' style='max-height:12rem; overflow:auto; font-family:monospace;'></div>
      </div>
    </div>
    <script>
      let SID = null;
      let ORIENT_BLACK = false;
      let SELECTED = null;
      let LEGAL_HINT = [];
      const PIECES = { 'P':'♙','N':'♘','B':'♗','R':'♖','Q':'♕','K':'♔','p':'♟','n':'♞','b':'♝','r':'♜','q':'♛','k':'♚' };

      function parseFEN(fen) {
        const part = fen.split(' ')[0];
        const ranks = part.split('/');
        const board = [];
        for (let r=0;r<8;r++){
          const row = [];
          for (const ch of ranks[r]){
            if (/[1-8]/.test(ch)) { for(let i=0;i<parseInt(ch);i++) row.push(''); }
            else row.push(ch);
          }
          board.push(row);
        }
        return board;
      }

      function sqName(file, rank) {
        return 'abcdefgh'[file] + (rank+1);
      }

      function renderBoard(fen) {
        const b = document.getElementById('board');
        b.innerHTML = '';
        const m = parseFEN(fen);
        for (let r=0;r<8;r++){
          for (let f=0; f<8; f++){
            const rr = ORIENT_BLACK ? r : 7 - r;
            const ff = ORIENT_BLACK ? 7 - f : f;
            const piece = m[rr][ff];
            const div = document.createElement('div');
            const dark = (r+f)%2==1;
            div.className = 'sq ' + (dark?'dark':'light');
            div.dataset.square = sqName(f, r);
            div.textContent = PIECES[piece] || '';
            div.addEventListener('click', onSquareClick);
            b.appendChild(div);
          }
        }
      }

      function onSquareClick(ev){
        const sq = ev.currentTarget.dataset.square;
        if (!SELECTED) { SELECTED = sq; highlight(sq); return; }
        if (SELECTED === sq) { SELECTED = null; clearHighlights(); return; }
        const mv = SELECTED + sq;
        SELECTED = null; clearHighlights();
        document.getElementById('move').value = mv;
      }

      function highlight(sq){
        clearHighlights();
        document.querySelectorAll('.sq').forEach(el=>{ if(el.dataset.square===sq) el.classList.add('sel'); });
      }
      function clearHighlights(){
        document.querySelectorAll('.sq').forEach(el=>el.classList.remove('sel'));
      }
      async function start() {{
        const maia = parseInt(document.getElementById('maia').value);
        const mpv = parseInt(document.getElementById('mpv').value);
        const lnodes = parseInt(document.getElementById('lnodes').value);
        const mnodes = parseInt(document.getElementById('mnodes').value);
        const res = await fetch('/api/session/new', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{maia_level:maia, multipv:mpv, leela_nodes:lnodes, maia_nodes:mnodes}})}});
        const data = await res.json();
        SID = data.id;
        document.getElementById('status').textContent = 'Session ' + SID + ' started.';
        await refresh();
      }}
      async function refresh() {{
        if (!SID) return;
        const res = await fetch('/api/session/' + SID + '/state');
        const data = await res.json();
        renderBoard(data.fen);
        const total = (data.score_total||0);
        const guesses = (data.guesses||0);
        document.getElementById('score_total').textContent = total.toFixed(3);
        document.getElementById('score_avg').textContent = (guesses? total/guesses:0).toFixed(3);
        const pct = Math.min(100, Math.max(0, total * 10));
        document.getElementById('scorebar').style.width = pct + '%';
        if (data.status === 'finished') {
          document.getElementById('last').innerHTML = 'Session finished. Total score: ' + (data.score_total||0).toFixed(3) + ` <a href="/api/session/${SID}/pgn" target="_blank">Download PGN</a>`;
        }
        const hres = await fetch('/api/session/' + SID + '/history');
        const hdata = await hres.json();
        const hist = hdata.history || [];
        const elh = document.getElementById('history');
        elh.innerHTML = '';
        hist.forEach((it, idx)=>{
          const d = document.createElement('div');
          d.textContent = `${idx+1}. you ${it.your_move} | leela ${it.leela_move} | maia ${it.maia_move} | +${it.score.toFixed(3)} (=${it.total.toFixed(3)})`;
          elh.appendChild(d);
        });
      }}
      document.getElementById('startForm').addEventListener('submit', async (e) => {{ e.preventDefault(); await start(); }});
      document.getElementById('flip').addEventListener('change', async (e)=>{ ORIENT_BLACK = e.target.checked; await refresh(); });
      document.getElementById('moveForm').addEventListener('submit', async (e) => {{
        e.preventDefault();
        if (!SID) return;
        const mv = document.getElementById('move').value.trim();
        document.getElementById('move').value = '';
        const res = await fetch('/api/session/' + SID + '/predict', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{move: mv}})}});
        const data = await res.json();
        const last = document.getElementById('last');
        if (data.error) {{
          last.textContent = 'Error: ' + data.error;
        }} else {{
          last.innerHTML = `You played <b>${data.your_move}</b>. Leela played <b>${data.leela_move}</b>. Score +${data.score.toFixed(3)} (total ${data.total.toFixed(3)}). Maia replied <b>${data.maia_move}</b>.`;
          const lines = data.top_lines || [];
          const el = document.getElementById('lines');
          el.innerHTML = '';
          lines.forEach((ln) => {{
            const tt = document.createElement('tt');
            const cp = ln.cp !== null ? (ln.cp>0? '+'+ln.cp: ln.cp) : (ln.mate? ('#'+ln.mate): '');
            tt.textContent = `#${ln.multipv} ${cp} ${ln.move}  ${ln.san||''}`;
            el.appendChild(tt);
          }});
          await refresh();
        }}
      }});
      document.getElementById('resign').addEventListener('click', async ()=>{
        if (!SID) return;
        await fetch('/api/session/' + SID + '/end', {method:'POST'});
        await refresh();
      });
    </script>
  </body>
 </html>
"""


def board_ascii(board: chess.Board) -> str:
    # Unicode representation without ranks/files labels to keep it compact
    return board.unicode(borders=True)


def _fallback_top_lines(board: chess.Board, k: int = 5, pov: Optional[chess.Color] = None) -> list[dict]:
    # Simple heuristic top lines for offline preview mode
    pov = board.turn if pov is None else pov
    moves = list(board.legal_moves)
    scored = []
    for mv in moves:
        score = 0
        if board.is_capture(mv):
            score += 100
        board.push(mv)
        if board.is_check():
            score += 50
        # Prefer central control
        fx, fy = chess.square_file(mv.to_square), chess.square_rank(mv.to_square)
        score += (3 - abs(3.5 - fx)) + (3 - abs(3.5 - fy))
        board.pop()
        scored.append((score, mv))
    scored.sort(reverse=True, key=lambda x: x[0])
    out = []
    tmpb = board.copy()
    for i, (_, mv) in enumerate(scored[:k], start=1):
        out.append({
            "multipv": i,
            "move": mv.uci(),
            "san": tmpb.san(mv),
            "cp": None,
            "mate": None,
        })
    return out


def _fallback_choose_move(board: chess.Board, temperature: float = 0.0) -> chess.Move:
    # Choose among top few by simple heuristic with temperature
    candidates = _fallback_top_lines(board, k=5)
    if not candidates:
        # No legal moves; shouldn't happen
        return chess.Move.null()
    import random
    if temperature and len(candidates) > 1:
        weights = [1.0 / i for i in range(1, len(candidates) + 1)]
        total = sum(weights)
        r = random.random() * total
        c = 0.0
        for w, cnd in zip(weights, candidates):
            c += w
            if r <= c:
                return chess.Move.from_uci(cnd["move"])  # type: ignore
        return chess.Move.from_uci(candidates[0]["move"])  # type: ignore
    return chess.Move.from_uci(candidates[0]["move"])  # type: ignore


def open_engines(sess: Session) -> tuple[Lc0Engine, Lc0Engine]:
    path = sess.lc0_path or find_lc0()
    if not path:
        raise RuntimeError("lc0 not found. Run `lcstudy install lc0` first or add lc0 to PATH.")
    leela_cfg = EngineConfig(exe=path, weights=sess.leela_weights)
    # Fallback: if Maia weights are missing, use Leela weights so the app remains usable
    maia_cfg = EngineConfig(exe=path, weights=sess.maia_weights or sess.leela_weights)
    return Lc0Engine(leela_cfg), Lc0Engine(maia_cfg)


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return html_index()


@app.post("/api/session/new")
def api_session_new(payload: dict) -> JSONResponse:
    maia_level = int(payload.get("maia_level", 1500))
    multipv = int(payload.get("multipv", 5))
    leela_nodes = int(payload.get("leela_nodes", 2000))
    maia_nodes = int(payload.get("maia_nodes", 300))
    sid = uuid.uuid4().hex[:8]
    # Resolve default weights paths if present
    leela_w = nets_dir() / "lczero-best.pb.gz"
    leela_w = leela_w if leela_w.exists() else None
    maia_w = nets_dir() / f"maia-{maia_level}.pb.gz"
    maia_w = maia_w if maia_w.exists() else None
    sess = Session(
        id=sid,
        maia_level=maia_level,
        multipv=multipv,
        leela_nodes=leela_nodes,
        maia_nodes=maia_nodes,
        leela_weights=leela_w,
        maia_weights=maia_w,
    )
    with SESS_LOCK:
        SESSIONS[sid] = sess
    return JSONResponse({"id": sid})


@app.get("/api/session/{sid}/state")
def api_session_state(sid: str) -> JSONResponse:
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")

    return JSONResponse(
        {
            "id": sess.id,
            "fen": sess.board.fen(),
            "turn": "white" if sess.board.turn else "black",
            "score_total": sess.score_total,
            "guesses": len(sess.history),
            "ply": sess.move_index,
            "status": sess.status,
        }
    )


@app.post("/api/session/{sid}/predict")
def api_session_predict(sid: str, payload: dict) -> JSONResponse:
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")

    move_str = str(payload.get("move", "")).strip()
    if not move_str:
        return JSONResponse({"error": "Missing move"}, status_code=400)

    board = sess.board.copy()
    try:
        # Parse move (assume UCI)
        mv = chess.Move.from_uci(move_str)
        if mv not in board.legal_moves:
            return JSONResponse({"error": "Illegal move in current position"}, status_code=400)
    except Exception:
        return JSONResponse({"error": "Invalid move format. Use UCI like e2e4 or g1f3."}, status_code=400)

    # Compute Leela best move and multipv
    engine_ok = True
    try:
        leela, maia = open_engines(sess)
        with leela:
            infos = leela.analyse(board, nodes=sess.leela_nodes, multipv=max(1, sess.multipv))
            top_lines = info_to_lines_san(board, infos, board.turn)
            # Determine best move
            best_move = infos[0].get("pv")[0] if infos and infos[0].get("pv") else leela.bestmove(board, nodes=max(1000, sess.leela_nodes // 2))
    except Exception as e:
        engine_ok = False
        infos = []
        top_lines = _fallback_top_lines(board, k=max(1, sess.multipv), pov=board.turn)
        best_move = _fallback_choose_move(board, temperature=0.0)

    # Find chosen move rank and cp
    your_rank = None
    best_cp = None
    your_cp = None
    for i, info in enumerate(infos, start=1):
        pv = info.get("pv")
        if not pv:
            continue
        if i == 1:
            s = info.get("score")
            if s is not None:
                sc = s.pov(board.turn)
                if not sc.is_mate():
                    best_cp = sc.score()
        if pv[0] == mv:
            your_rank = i
            s = info.get("score")
            if s is not None:
                sc = s.pov(board.turn)
                if not sc.is_mate():
                    your_cp = sc.score()

    # Score similarity
    from .engines import score_similarity

    score = score_similarity(best_cp, your_cp, your_rank, max_rank=len(infos))
    sess.score_total += score

    # Apply Leela move (not the user's guess)
    board.push(best_move)
    sess.board = board
    sess.move_index += 1

    # Maia reply using low nodes, and temperature for first 10 plies
    reply_move_san = None
    try:
        if engine_ok:
            with maia:
                # For the first 10 plies (5 moves by each), sample from MultiPV with temperature
                temperature = 1.2 if sess.move_index <= 10 else 0.0
                mpv = max(2, min(5, sess.multipv)) if temperature > 0 else 1
                infos_m = maia.analyse(sess.board, nodes=sess.maia_nodes, multipv=mpv)
                if temperature > 0 and mpv > 1:
                    mv_reply = pick_from_multipv(infos_m, sess.board.turn, temperature=temperature)
                else:
                    mv_reply = infos_m[0].get("pv")[0] if infos_m and infos_m[0].get("pv") else maia.bestmove(sess.board, nodes=max(200, sess.maia_nodes))
        else:
            temperature = 1.2 if sess.move_index <= 10 else 0.0
            mv_reply = _fallback_choose_move(sess.board, temperature=temperature)
    except Exception:
        mv_reply = _fallback_choose_move(sess.board, temperature=1.0 if sess.move_index <= 10 else 0.0)

    sess.board.push(mv_reply)
    sess.move_index += 1

    # Record history entry
    sess.history.append(
        {
            "ply": sess.move_index,
            "your_move": mv.uci(),
            "leela_move": best_move.uci(),
            "maia_move": mv_reply.uci(),
            "score": score,
            "total": sess.score_total,
            "fen": sess.board.fen(),
            "top_lines": top_lines,
        }
    )

    # Check game over
    game_over = False
    result = None
    if sess.board.is_game_over():
        game_over = True
        result = sess.board.result(claim_draw=True)
        sess.status = "finished"

    return JSONResponse(
        {
            "your_move": mv.uci(),
            "leela_move": best_move.uci(),
            "maia_move": mv_reply.uci(),
            "score": score,
            "total": sess.score_total,
            "top_lines": top_lines,
            "fen": sess.board.fen(),
            "board_ascii": board_ascii(sess.board),
            "game_over": game_over,
            "result": result,
        }
    )


@app.post("/api/session/{sid}/end")
def api_session_end(sid: str) -> JSONResponse:
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")
    sess.status = "finished"
    return JSONResponse({"ok": True})


@app.get("/api/session/{sid}/history")
def api_session_history(sid: str) -> JSONResponse:
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")
    return JSONResponse({"history": sess.history, "total": sess.score_total})


@app.post("/api/session/{sid}/settings")
def api_session_settings(sid: str, payload: dict) -> JSONResponse:
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")
    # Update simple settings
    for k in ["multipv", "leela_nodes", "maia_nodes", "maia_level", "flip"]:
        if k in payload:
            setattr(sess, k, int(payload[k]) if isinstance(getattr(sess, k), int) else bool(payload[k]))
    # Update weights based on Maia level if present
    mw = nets_dir() / f"maia-{sess.maia_level}.pb.gz"
    if mw.exists():
        sess.maia_weights = mw
    return JSONResponse({"ok": True})


@app.get("/api/session/{sid}/pgn")
def api_session_pgn(sid: str):
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")
    import chess.pgn

    game = chess.pgn.Game()
    game.headers["Event"] = "LcStudy Training"
    game.headers["White"] = "Leela (lc0)"
    game.headers["Black"] = f"Maia-{sess.maia_level}"
    game.setup(chess.STARTING_FEN)
    node = game
    b = chess.Board()
    for h in sess.history:
        # Only include engine moves and replies into PGN moves; annotate user's prediction
        mv_leela = chess.Move.from_uci(h["leela_move"]) if h.get("leela_move") else None
        if mv_leela and mv_leela in b.legal_moves:
            node = node.add_variation(mv_leela)
            node.comment = f"Your guess: {h['your_move']}; score +{h['score']:.3f} (total {h['total']:.3f})"
            b.push(mv_leela)
        mv_maia = chess.Move.from_uci(h["maia_move"]) if h.get("maia_move") else None
        if mv_maia and mv_maia in b.legal_moves:
            node = node.add_variation(mv_maia)
            b.push(mv_maia)
    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    pgn_str = game.accept(exporter)
    return HTMLResponse(pgn_str, media_type="text/plain")
