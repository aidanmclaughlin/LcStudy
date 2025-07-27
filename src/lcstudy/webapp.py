from __future__ import annotations

import json
import logging
import os
import random
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

import chess
import chess.pgn
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse

from .engines import (
    EngineConfig,
    Lc0Engine,
    find_lc0,
    info_to_lines,
    info_to_lines_san,
    pick_from_multipv,
)
from .engines import nets_dir


logger = logging.getLogger("lcstudy.webapp")
app = FastAPI(title="LcStudy")



@dataclass
class Session:
    """In-memory session state for the web app.

    Fields:
    - board: current position
    - score_total: accumulated score over correct predictions
    - move_index: ply count from start
    - status: "playing" or "finished"
    - analysis_thread/stop_evt: background analysis management
    - last_lines: last computed Leela top lines for the current position
    """
    id: str
    board: chess.Board = field(default_factory=chess.Board)
    score_total: float = 0.0
    move_index: int = 0
    maia_level: int = 1500
    multipv: int = 5
    leela_nodes: int = 2000
    maia_nodes: int = 1
    leela_weights: Optional[Path] = None
    maia_weights: Optional[Path] = None
    lc0_path: Optional[Path] = None
    status: str = "playing"
    history: list[dict] = field(default_factory=list)
    flip: bool = False
    analysis_thread: Optional[threading.Thread] = None
    stop_evt: Optional[threading.Event] = None
    analysis_fen: Optional[str] = None
    last_lines: list[dict] = field(default_factory=list)
    # Persistent engines (stay open for the session duration)
    leela_engine: Optional['Lc0Engine'] = None
    maia_engine: Optional['Lc0Engine'] = None
    leela_lock: threading.Lock = field(default_factory=threading.Lock)
    maia_lock: threading.Lock = field(default_factory=threading.Lock)


SESSIONS: Dict[str, Session] = {}
SESS_LOCK = threading.Lock()



def get_session(sid: str) -> Session:
    with SESS_LOCK:
        if sid not in SESSIONS:
            raise KeyError
        return SESSIONS[sid]


def html_index() -> str:
    """Return the inlined HTML/JS for the minimal UI."""
    return """
<!doctype html>
<html>
  <head>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <title>LcStudy</title>
    
    <style>
      :root { --sq: 64px; --light: #3b4252; --dark: #2e3440; --brand: #8b5cf6; --ok: #22c55e; --bad:#ef4444; --ink:#e5e7eb; --muted:#9ca3af; --bg1:#0b1220; --bg2:#0b1324; }
      html,body { height: 100%; }
      body { margin:0; font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,system-ui,sans-serif; color: var(--ink); background: radial-gradient(1200px 800px at 10% 10%, #0f1a34 0%, var(--bg1) 50%), linear-gradient(180deg, var(--bg1), var(--bg2)); }
      .wrap { max-width: 1100px; margin: 0 auto; padding: 28px; }
      .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
      h1 { margin:0; font-weight: 800; letter-spacing: -0.02em; font-size: 22px; color:#f8fafc; }
      .meta { color: var(--muted); font-size: 13px; }
      .panel { background: rgba(17, 24, 39, .7); border: 1px solid rgba(148,163,184,.15); padding: 14px; border-radius: 14px; box-shadow: 0 10px 30px rgba(2,6,23,.25); backdrop-filter: blur(4px); }
      .stage { display:flex; align-items:center; justify-content:center; margin-top: 8px; }
      #board { width: 512px; height: 512px; border: 1px solid rgba(148,163,184,.2); border-radius: 12px; overflow:hidden; display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); }
      .square { display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; position: relative; }
      .square.light { background: #f0d9b5; }
      .square.dark { background: #b58863; }
      .square.selected { box-shadow: inset 0 0 0 3px #ff6b6b; }
      .square.highlight { box-shadow: inset 0 0 0 3px #4ecdc4; }
      .piece { width: 85%; height: 85%; background-size: contain; background-repeat: no-repeat; background-position: center; cursor: grab; transition: transform 0.1s ease; }
      .piece:active { cursor: grabbing; transform: scale(1.1); }
      .square:hover .piece { transform: scale(1.05); }
      .board-flash-green { animation: boardOk 600ms ease; }
      .board-flash-red { animation: boardBad 600ms ease; }
      @keyframes boardOk { 
        0% { box-shadow: 0 0 0 0 rgba(34,197,94,.0); transform: scale(1); } 
        50% { box-shadow: 0 0 0 12px rgba(34,197,94,.8); transform: scale(1.02); } 
        100% { box-shadow: 0 0 0 0 rgba(34,197,94,.0); transform: scale(1); } 
      }
      @keyframes boardBad { 
        0% { box-shadow: 0 0 0 0 rgba(239,68,68,.0); transform: scale(1); } 
        50% { box-shadow: 0 0 0 12px rgba(239,68,68,.8); transform: scale(0.98); } 
        100% { box-shadow: 0 0 0 0 rgba(239,68,68,.0); transform: scale(1); } 
      }
      @keyframes shake { 
        0%, 100% { transform: translateX(0) rotate(0deg); } 
        25% { transform: translateX(-8px) rotate(-1deg); } 
        75% { transform: translateX(8px) rotate(1deg); } 
      }
      .pill { display:inline-flex; align-items:center; gap:8px; background: rgba(139,92,246,.12); color:#c4b5fd; padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(139,92,246,.25); }
      .btn { background: linear-gradient(180deg,#8b5cf6,#7c3aed); color:#fff; border:0; padding:9px 14px; border-radius: 10px; font-weight:700; cursor:pointer; box-shadow: 0 6px 14px rgba(124,58,237,.3); }
      .btn:hover { filter:brightness(1.05); }
    </style>
  </head>
  <body>
    <div class='wrap'>
    <div class='head'>
      <h1>LcStudy</h1>
      <div class='pill'><span id='who'>You (Leela) — White to move</span></div>
    </div>
    <div class='panel' style='display:flex; gap:10px; align-items:center; justify-content:space-between; margin-bottom:14px;'>
      <button id='new' class='btn'>New Game</button>
      <div id='status' class='meta'>Drag a piece to make your prediction.</div>
    </div>
    <div class='stage'>
      <div>
        <div id='board'></div>
        <div class='meta' style='text-align:center; margin-top:8px;'>Green = exact match, Red = not Leela's choice.</div>
        <div id='last' style='text-align:center; margin-top:8px;'></div>
      </div>
    </div>
    </div>
    <script>
      
      let SID = null;
      let selectedSquare = null;
      let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      let currentTurn = 'white';
      let leelaTopMoves = []; // Pre-fetched Leela analysis for instant validation

      
      const pieceImages = {
        'wK': 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
        'wQ': 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
        'wR': 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
        'wB': 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
        'wN': 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
        'wP': 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
        'bK': 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg',
        'bQ': 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
        'bR': 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
        'bB': 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
        'bN': 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
        'bP': 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg'
      };

      function flashBoard(success) {
        const boardEl = document.getElementById('board');
        const className = success ? 'board-flash-green' : 'board-flash-red';
        boardEl.classList.remove('board-flash-green', 'board-flash-red');
        boardEl.offsetHeight;
        boardEl.classList.add(className);
        setTimeout(() => {
          boardEl.classList.remove(className);
        }, 300);
      }

      let pendingMoves = new Set();

      async function submitMove(mv){
        if (!SID || pendingMoves.has(mv)) return;
        
        pendingMoves.add(mv);
        
        const fromSquare = mv.slice(0, 2);
        const toSquare = mv.slice(2, 4);
        
        const leelaTopMove = leelaTopMoves.length > 0 ? leelaTopMoves[0].move : null;
        const isLeelaMove = leelaTopMove === mv;
        
        if (isLeelaMove) {
          animateMove(fromSquare, toSquare);
          flashBoard(true);
          submitCorrectMoveToServer(mv);
        } else if (leelaTopMove === null) {
          animateMove(fromSquare, toSquare);
          submitMoveToServer(mv, fromSquare, toSquare);
        } else {
          flashBoard(false);
          revertMove();
          document.getElementById('last').textContent = `Not Leela's choice. Try again. (Leela wants: ${leelaTopMove})`;
        }
        
        pendingMoves.delete(mv);
      }

      async function submitCorrectMoveToServer(mv) {
        try {
          const res = await fetch('/api/session/' + SID + '/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({move: mv, client_validated: true})});
          const data = await res.json();
          
          if (data.correct) {
            const last = document.getElementById('last');
            last.innerHTML = `Correct! Leela played <b>${data.leela_move}</b>. Maia replied <b>${data.maia_move}</b>. Total ${data.total.toFixed(3)}.`;
            
            setTimeout(async () => {
              await refresh();
            }, 600);
          }
        } catch (e) {
          
        }
      }

      async function submitMoveToServer(mv, fromSquare, toSquare) {
        try {
          console.log(`=== MOVE SUBMISSION START ===`);
          const submitStart = performance.now();
          
          const fetchStart = performance.now();
          const res = await fetch('/api/session/' + SID + '/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({move: mv})});
          const fetchTime = performance.now() - fetchStart;
          console.log(`Server request took ${fetchTime.toFixed(1)}ms`);
          
          const parseStart = performance.now();
          const data = await res.json();
          const parseTime = performance.now() - parseStart;
          console.log(`Response parsing took ${parseTime.toFixed(1)}ms`);
          
          const last = document.getElementById('last');
          
          if (data.error) {
            flashBoard(false);
            revertMove();
            last.textContent = 'Error: ' + data.error;
            return;
          }
          
          const ok = !!data.correct;
          
          if (ok) {
            flashBoard(true);
            last.innerHTML = `Correct! Leela played <b>${data.leela_move}</b>. Maia replied <b>${data.maia_move}</b>. Total ${data.total.toFixed(3)}.`;
            
            const totalSubmitTime = performance.now() - submitStart;
            console.log(`Total move submission took ${totalSubmitTime.toFixed(1)}ms`);
            console.log(`=== SCHEDULING REFRESH IN 600ms ===`);
            
            setTimeout(async () => {
              await refresh();
            }, 600);
          } else {
            flashBoard(false);
            revertMove();
            last.textContent = data.message || "Not Leela's choice. Try again.";
          }
        } catch (e) {
          flashBoard(false);
          revertMove();
        }
      }

      function animateMove(fromSquare, toSquare) {
        const fromEl = document.querySelector(`[data-square="${fromSquare}"]`);
        const toEl = document.querySelector(`[data-square="${toSquare}"]`);
        const piece = fromEl?.querySelector('.piece');
        if (piece && toEl) {
          const existingPiece = toEl.querySelector('.piece');
          if (existingPiece) {
            existingPiece.remove();
          }
          toEl.appendChild(piece);
          piece.style.transform = 'scale(1.1)';
          setTimeout(() => {
            piece.style.transform = '';
          }, 150);
        }
      }

      function revertMove() {
        updateBoardFromFen(currentFen);
        const boardEl = document.getElementById('board');
        boardEl.style.animation = 'shake 0.3s ease-in-out';
        setTimeout(() => { boardEl.style.animation = ''; }, 300);
      }
      function initBoard() {
        createBoardHTML();
        updateBoardFromFen(currentFen);
      }

      function createBoardHTML() {
        const boardEl = document.getElementById('board');
        boardEl.innerHTML = '';
        
        let squareCount = 0;
        for (let rank = 8; rank >= 1; rank--) {
          for (let file = 0; file < 8; file++) {
            const square = String.fromCharCode(97 + file) + rank;
            const squareEl = document.createElement('div');
            squareEl.className = `square ${(rank + file) % 2 === 0 ? 'dark' : 'light'}`;
            squareEl.dataset.square = square;
            squareEl.addEventListener('click', onSquareClick);
            boardEl.appendChild(squareEl);
            squareCount++;
          }
        }
      }

      function parseFEN(fen) {
        const position = {};
        const parts = fen.split(' ');
        const board = parts[0];
        const ranks = board.split('/');
        
        for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
          const rank = 8 - rankIndex;
          const rankData = ranks[rankIndex];
          let file = 0;
          
          for (let char of rankData) {
            if (char >= '1' && char <= '8') {
              file += parseInt(char);
            } else {
              const square = String.fromCharCode(97 + file) + rank;
              const color = char === char.toUpperCase() ? 'w' : 'b';
              const piece = char.toUpperCase();
              position[square] = color + piece;
              file++;
            }
          }
        }
        return position;
      }

      function updateBoardFromFen(fen) {
        document.querySelectorAll('.piece').forEach(p => p.remove());
        const position = parseFEN(fen);
        
        for (const [square, piece] of Object.entries(position)) {
          const pieceEl = document.createElement('div');
          pieceEl.className = 'piece';
          pieceEl.style.backgroundImage = `url(${pieceImages[piece]})`;
          pieceEl.dataset.piece = piece;
          
          const squareEl = document.querySelector(`[data-square="${square}"]`);
          if (squareEl) {
            squareEl.appendChild(pieceEl);
          }
        }
      }

      function onSquareClick(event) {
        const square = event.currentTarget.dataset.square;
        const piece = event.currentTarget.querySelector('.piece');
        
        if (selectedSquare === null) {
          if (piece && piece.style.backgroundImage.includes('lt45')) {
            selectedSquare = square;
            event.currentTarget.classList.add('selected');
          }
        } else {
          if (selectedSquare === square) {
            clearSelection();
          } else {
            const move = selectedSquare + square;
            clearSelection();
            submitMove(move);
          }
        }
      }

      function clearSelection() {
        document.querySelectorAll('.square.selected').forEach(sq => {
          sq.classList.remove('selected');
        });
        selectedSquare = null;
      }

      function setWho(turn) {
        const el = document.getElementById('who');
        el.textContent = `You (Leela) — ${turn.charAt(0).toUpperCase() + turn.slice(1)} to move`;
      }

      async function start() {
        const res = await fetch('/api/session/new', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({})});
        const data = await res.json();
        SID = data.id;
        document.getElementById('status').textContent = 'Session ' + SID + ' started.';
        await refresh();
      }

      async function refresh() {
        if (!SID) return;
        
        console.log(`=== REFRESH START ===`);
        const refreshStart = performance.now();
        
        const fetchStart = performance.now();
        const res = await fetch('/api/session/' + SID + '/state');
        const fetchTime = performance.now() - fetchStart;
        console.log(`State fetch took ${fetchTime.toFixed(1)}ms`);
        
        const parseStart = performance.now();
        const data = await res.json();
        const parseTime = performance.now() - parseStart;
        console.log(`State parse took ${parseTime.toFixed(1)}ms`);
        
        const updateStart = performance.now();
        currentFen = data.fen;
        currentTurn = data.turn;
        leelaTopMoves = data.top_lines || [];
        updateBoardFromFen(currentFen);
        clearSelection();
        setWho(data.turn);
        const updateTime = performance.now() - updateStart;
        console.log(`Board update took ${updateTime.toFixed(1)}ms`);
        
        if (data.status === 'finished') {
          document.getElementById('last').innerHTML = 'Session finished. Total score: ' + (data.score_total||0).toFixed(3) + ` <a href="/api/session/${SID}/pgn" target="_blank">Download PGN</a>`;
        }
        
        const totalRefreshTime = performance.now() - refreshStart;
        console.log(`=== TOTAL REFRESH: ${totalRefreshTime.toFixed(1)}ms ===`);
      }

      document.getElementById('new').addEventListener('click', async () => {
        await start();
      });

      window.addEventListener('DOMContentLoaded', async () => { initBoard(); start(); });
    </script>
  </body>
 </html>
"""


def board_ascii(board: chess.Board) -> str:
    """Compact unicode board representation (for debug/logging)."""
    return board.unicode(borders=True)


def _fallback_top_lines(board: chess.Board, k: int = 5, pov: Optional[chess.Color] = None) -> list[dict]:
    """Cheap heuristic move ranking used when engines are unavailable."""
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
    """Pick a heuristic move with optional temperature."""
    candidates = _fallback_top_lines(board, k=5)
    if not candidates:
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
    """Get or create persistent engine instances for Leela and Maia.

    If Maia weights are missing, reuse Leela weights to keep the app usable.
    """
    import time
    start_time = time.time()
    print(f"open_engines() called for session {sess.id}")
    
    path = sess.lc0_path or find_lc0()
    if not path:
        raise RuntimeError("lc0 not found. Run `lcstudy install lc0` first or add lc0 to PATH.")
    
    # Create Leela engine if not exists (with thread safety)
    leela_lock_start = time.time()
    print("Acquiring Leela lock...")
    with sess.leela_lock:
        leela_lock_time = time.time() - leela_lock_start
        print(f"Leela lock acquired in {leela_lock_time:.3f}s")
        if sess.leela_engine is None:
            print(f"Creating NEW Leela engine for session {sess.id}")
            leela_cfg = EngineConfig(exe=path, weights=sess.leela_weights)
            sess.leela_engine = Lc0Engine(leela_cfg)
            sess.leela_engine.open()
            print(f"Leela engine created and opened for session {sess.id}")
        else:
            print(f"Reusing existing Leela engine for session {sess.id}")
    
    # Create Maia engine if not exists (with thread safety)
    maia_lock_start = time.time()
    print("Acquiring Maia lock...")
    with sess.maia_lock:
        maia_lock_time = time.time() - maia_lock_start
        print(f"Maia lock acquired in {maia_lock_time:.3f}s")
        if sess.maia_engine is None:
            print(f"Creating NEW Maia engine for session {sess.id}")
            maia_cfg = EngineConfig(exe=path, weights=sess.maia_weights or sess.leela_weights)
            sess.maia_engine = Lc0Engine(maia_cfg)
            sess.maia_engine.open()
            print(f"Maia engine created and opened for session {sess.id}")
        else:
            print(f"Reusing existing Maia engine for session {sess.id}")
    
    total_time = time.time() - start_time
    print(f"open_engines() completed in {total_time:.3f}s")
    return sess.leela_engine, sess.maia_engine


def get_maia_engine_only(sess: Session) -> Lc0Engine:
    """Get or create just the Maia engine without touching Leela locks."""
    path = sess.lc0_path or find_lc0()
    if not path:
        raise RuntimeError("lc0 not found. Run `lcstudy install lc0` first or add lc0 to PATH.")
    
    # Create Maia engine if not exists (with thread safety)
    with sess.maia_lock:
        if sess.maia_engine is None:
            maia_cfg = EngineConfig(exe=path, weights=sess.maia_weights or sess.leela_weights)
            sess.maia_engine = Lc0Engine(maia_cfg)
            sess.maia_engine.open()
            print(f"Created NEW Maia-only engine for session {sess.id}")
        else:
            print(f"Reusing existing Maia-only engine for session {sess.id}")
    
    return sess.maia_engine


def stop_analysis(sess: Session) -> None:
    """Signal the background analysis loop to stop and join it."""
    th = sess.analysis_thread
    if th and th.is_alive():
        if sess.stop_evt:
            sess.stop_evt.set()
        th.join(timeout=2.5)
    sess.analysis_thread = None
    sess.stop_evt = None


def restart_analysis(sess: Session) -> None:
    """Start (or restart) incremental background analysis for the current board."""
    stop_analysis(sess)
    sess.analysis_fen = sess.board.fen()
    evt = threading.Event()
    sess.stop_evt = evt

    def worker():
        try:
            leela, _ = open_engines(sess)
        except Exception:
            return
        try:
            board = chess.Board(sess.analysis_fen)
            nodes = 1000
            while not evt.is_set() and sess.status == "playing" and sess.analysis_fen == sess.board.fen():
                try:
                    with sess.leela_lock:
                        infos = leela.analyse(board, nodes=nodes, multipv=max(1, sess.multipv))
                    sess.last_lines = info_to_lines_san(board, infos, board.turn)
                    nodes = min(nodes * 2, 200000)
                except Exception:
                    break
        except Exception:
            pass

    th = threading.Thread(target=worker, daemon=True)
    sess.analysis_thread = th
    th.start()


@app.get("/")
def index() -> HTMLResponse:
    return HTMLResponse(html_index(), media_type="text/html; charset=utf-8")


@app.post("/api/session/new")
def api_session_new(payload: dict) -> JSONResponse:
    """Create a new session with optional Maia level and analysis parameters."""
    maia_level = int(payload.get("maia_level", 1500))
    multipv = int(payload.get("multipv", 5))
    leela_nodes = int(payload.get("leela_nodes", 2000))
    maia_nodes = 1
    sid = uuid.uuid4().hex[:8]
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
    
    # Pre-warm engines to eliminate first-move delay
    try:
        leela, maia = open_engines(sess)
        logger.info("Pre-warmed engines for session %s", sid)
    except Exception as e:
        logger.warning("Failed to pre-warm engines: %s", e)
    
    try:
        restart_analysis(sess)
    except Exception:
        pass
    return JSONResponse({"id": sid})


@app.get("/api/session/{sid}/state")
def api_session_state(sid: str) -> JSONResponse:
    """Return the current session state and fresh Leela top lines."""
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")
    top_lines = get_current_leela_analysis(sess)

    return JSONResponse(
        {
            "id": sess.id,
            "fen": sess.board.fen(),
            "turn": "white" if sess.board.turn else "black",
            "score_total": sess.score_total,
            "guesses": len(sess.history),
            "ply": sess.move_index,
            "status": sess.status,
            "top_lines": top_lines,
        }
    )

def get_current_leela_analysis(sess):
    """Compute fresh Leela analysis for the session's current board."""
    try:
        board = sess.board.copy()
        logger.debug("Analyzing current position: %s", board.fen())
        leela, _ = open_engines(sess)
        with sess.leela_lock:
            infos = leela.analyse(board, nodes=500, multipv=3)
            if not isinstance(infos, list):
                infos = [infos]
        lines = info_to_lines(infos, board.turn)
        sess.last_lines = lines
        logger.debug("Analysis complete; top move: %s", (lines[0]['move'] if lines else None))
        return lines
    except Exception as e:
        logger.warning("Leela analysis failed: %s", e)
        board = sess.board.copy()
        return _fallback_top_lines(board, k=3, pov=board.turn)


@app.post("/api/session/{sid}/predict")
def api_session_predict(sid: str, payload: dict) -> JSONResponse:
    """Validate a user's move, advance the game on a correct prediction, and score it."""
    logger.debug("predict: %s", payload)
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")

    move_str = str(payload.get("move", "")).strip()
    client_validated = payload.get("client_validated", False)
    logger.debug("received move=%s client_validated=%s", move_str, client_validated)
    if not move_str:
        return JSONResponse({"error": "Missing move"}, status_code=400)

    board = sess.board.copy()
    logger.debug("board=%s", board.fen())
    try:
        mv = chess.Move.from_uci(move_str)
        logger.debug("parsed move: %s", mv)
        if mv not in board.legal_moves:
            logger.debug("illegal move: %s", mv)
            return JSONResponse({"error": "Illegal move in current position"}, status_code=400)
    except Exception as e:
        logger.debug("move parse failed: %s", e)
        return JSONResponse({"error": "Invalid move format. Use UCI like e2e4 or g1f3."}, status_code=400)

    if client_validated:
        logger.debug("client-validated; skipping engine validation")
        best_move = mv
        engine_ok = True
        infos = []
        top_lines = []
    else:
        logger.debug("computing Leela best move")
        engine_ok = True
        try:
            stop_analysis(sess)
            infos = []
            top_lines = sess.last_lines or []
            logger.debug("cached top_lines available: %s", bool(top_lines))
            if top_lines and top_lines[0].get("move"):
                best_move = chess.Move.from_uci(top_lines[0]["move"])  
                logger.debug("using cached best move: %s", best_move.uci())
            else:
                logger.debug("no cached move; creating engine")
                leela, _ = open_engines(sess)
                logger.debug("calculating bestmove")
                with sess.leela_lock:
                    best_move = leela.bestmove(board, nodes=max(1000, sess.leela_nodes), seconds=10.0)
                logger.debug("bestmove=%s", best_move.uci())
        except Exception as e:
            logger.warning("bestmove failed: %s", e)
            engine_ok = False
            infos = []
            top_lines = _fallback_top_lines(board, k=max(1, sess.multipv), pov=board.turn)
            best_move = _fallback_choose_move(board, temperature=0.0)
            logger.debug("fallback bestmove=%s", best_move.uci())

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

    from .engines import score_similarity

    score = score_similarity(best_cp, your_cp, your_rank, max_rank=len(infos))

    logger.debug("compare user=%s leela=%s", mv.uci(), best_move.uci())
    if mv != best_move:
        logger.debug("move rejected")
        try:
            restart_analysis(sess)
        except Exception:
            pass
        response = {
            "your_move": mv.uci(),
            "correct": False,
            "message": "Not Leela's choice. Try again.",
            "score_hint": score,
        }
        logger.debug("rejection response: %s", response)
        return JSONResponse(response)
    
    logger.debug("move accepted")

    sess.board.push(best_move)
    sess.move_index += 1

    maia_move_uci: Optional[str] = None
    import time
    print(f"=== MAIA MOVE START ===")
    maia_total_start = time.time()
    try:
        engine_start = time.time()
        print("About to get Maia engine only...")
        maia = get_maia_engine_only(sess)
        engine_time = time.time() - engine_start
        print(f"Maia engine access took {engine_time:.3f}s")
        print(f"Got Maia engine: maia={id(maia)}")
        
        lock_start = time.time()
        with sess.maia_lock:
            lock_time = time.time() - lock_start
            print(f"Maia lock acquired in {lock_time:.3f}s")
            
            temperature = 1.0 if sess.move_index < 10 else 0.0
            print(f"Maia move {sess.move_index}, temperature={temperature}, nodes={sess.maia_nodes}")
            
            analysis_start = time.time()
            if temperature > 0:
                print(f"Maia early game analysis path")
                # Prefer short time-based analysis to encourage multiple PVs
                multipv_count = max(5, sess.multipv)
                infos2 = maia.analyse(sess.board, nodes=sess.maia_nodes, multipv=multipv_count)
                if not isinstance(infos2, list):
                    infos2 = [infos2]
                if len(infos2) <= 1:
                    # If we don't get multiple PVs with 1 node, use fallback heuristic
                    infos2 = []  # Will trigger fallback move selection
                if len(infos2) > 1:
                    mv2 = pick_from_multipv(infos2, pov=sess.board.turn, temperature=temperature)
                    print(f"Maia used multipv selection")
                else:
                    # As a last resort, pick a heuristic move with temperature
                    mv2 = _fallback_choose_move(sess.board, temperature=temperature)
                    print(f"Maia used fallback heuristic")
            else:
                print(f"Maia late game bestmove path")
                mv2 = maia.bestmove(sess.board, nodes=sess.maia_nodes)
                print(f"Maia used bestmove")
            analysis_time = time.time() - analysis_start
            print(f"Maia analysis took {analysis_time:.3f}s")
        
        board_start = time.time()
        sess.board.push(mv2)
        maia_move_uci = mv2.uci()
        sess.move_index += 1
        board_time = time.time() - board_start
        print(f"Maia board update took {board_time:.3f}s")
        
    except Exception as e:
        print(f"Maia exception: {e}")
        mv2 = _fallback_choose_move(sess.board, temperature=0.0)
        if mv2 and mv2 != chess.Move.null():
            sess.board.push(mv2)
            maia_move_uci = mv2.uci()
            sess.move_index += 1
    
    maia_total_time = time.time() - maia_total_start
    print(f"=== MAIA TOTAL: {maia_total_time:.3f}s ===")

    sess.score_total += 1.0
    if sess.board.is_game_over():
        sess.status = "finished"

    sess.history.append({
        "ply": sess.move_index,
        "leela_move": best_move.uci(),
        "maia_move": maia_move_uci,
        "score": 1.0,
    })

    try:
        restart_analysis(sess)
    except Exception:
        pass

    return JSONResponse({
        "correct": True,
        "leela_move": best_move.uci(),
        "maia_move": maia_move_uci,
        "total": sess.score_total,
        "fen": sess.board.fen(),
        "status": sess.status,
    })


@app.get("/api/session/{sid}/pgn")
def api_session_pgn(sid: str) -> PlainTextResponse:
    """Return the PGN of the current session as plain text."""
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")

    game = chess.pgn.Game()
    game.headers["Event"] = "LcStudy"
    game.headers["Site"] = "Local"
    game.headers["White"] = "You (Leela)"
    game.headers["Black"] = f"Maia {sess.maia_level}"
    game.headers["Date"] = time.strftime("%Y.%m.%d")

    node = game
    tmp = chess.Board()
    for mv in sess.board.move_stack:
        node = node.add_variation(mv)
        tmp.push(mv)
    game.headers["Result"] = tmp.result(claim_draw=True) if tmp.is_game_over() else "*"

    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    text = game.accept(exporter)
    return PlainTextResponse(text, media_type="text/plain; charset=utf-8")
