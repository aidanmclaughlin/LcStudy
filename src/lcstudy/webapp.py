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
    maia_nodes: int = 1
    leela_weights: Optional[Path] = None
    maia_weights: Optional[Path] = None
    lc0_path: Optional[Path] = None
    status: str = "playing"  # playing|finished
    history: list[dict] = field(default_factory=list)
    flip: bool = False
    # live analysis
    analysis_thread: Optional[threading.Thread] = None
    stop_evt: Optional[threading.Event] = None
    analysis_fen: Optional[str] = None
    last_lines: list[dict] = field(default_factory=list)


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
    <script src="https://unpkg.com/chess.js@1.0.0-alpha.0/chess.min.js"></script>
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
      console.log("Script starting to load...");
      let SID = null;
      let game = null;
      let selectedSquare = null;
      let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      let currentTurn = 'white';
      let leelaTopMoves = []; // Pre-fetched Leela analysis for instant validation

      // Piece images from Wikimedia Commons
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
        
        // Remove any existing flash classes first
        boardEl.classList.remove('board-flash-green', 'board-flash-red');
        
        // Force reflow to ensure class removal takes effect
        boardEl.offsetHeight;
        
        // Add new flash class
        boardEl.classList.add(className);
        setTimeout(() => {
          boardEl.classList.remove(className);
        }, 300); // Super fast casino-like feedback
      }

      let pendingMoves = new Set();

      async function submitMove(mv){
        if (!SID || pendingMoves.has(mv)) return;
        
        console.log("submitMove", mv);
        pendingMoves.add(mv);
        
        const fromSquare = mv.slice(0, 2);
        const toSquare = mv.slice(2, 4);
        
        // INSTANT CLIENT-SIDE VALIDATION using pre-fetched Leela moves
        console.log("Checking move:", mv, "against Leela moves:", leelaTopMoves);
        const leelaTopMove = leelaTopMoves.length > 0 ? leelaTopMoves[0].move : null;
        const isLeelaMove = leelaTopMove === mv;
        console.log("Leela top move:", leelaTopMove, "Is match:", isLeelaMove);
        
        if (isLeelaMove) {
          // INSTANT CORRECT FEEDBACK - no server round trip needed!
          animateMove(fromSquare, toSquare);
          flashBoard(true);
          
          // Now submit to server in background to advance game
          submitCorrectMoveToServer(mv);
        } else if (leelaTopMove === null) {
          // No Leela analysis available - allow move but validate with server
          console.log("No Leela analysis available, falling back to server validation");
          animateMove(fromSquare, toSquare);
          submitMoveToServer(mv, fromSquare, toSquare);
        } else {
          // INSTANT WRONG FEEDBACK
          flashBoard(false);
          revertMove(fromSquare, toSquare);
          document.getElementById('last').textContent = `Not Leela's choice. Try again. (Leela wants: ${leelaTopMove})`;
        }
        
        pendingMoves.delete(mv);
      }

      async function submitCorrectMoveToServer(mv) {
        try {
          // Pass a flag indicating this move was pre-validated client-side
          const res = await fetch('/api/session/' + SID + '/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({move: mv, client_validated: true})});
          const data = await res.json();
          
          if (data.correct) {
            const last = document.getElementById('last');
            last.innerHTML = `Correct! Leela played <b>${data.leela_move}</b>. Maia replied <b>${data.maia_move}</b>. Total ${data.total.toFixed(3)}.`;
            
            // Refresh to get new position and new Leela analysis
            setTimeout(async () => {
              await refresh();
            }, 600);
          }
        } catch (e) {
          console.error("Server error:", e);
          // Even if server fails, the move was visually correct
        }
      }

      async function submitMoveToServer(mv, fromSquare, toSquare) {
        try {
          const res = await fetch('/api/session/' + SID + '/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({move: mv})});
          const data = await res.json();
          const last = document.getElementById('last');
          
          if (data.error) { 
            flashBoard(false);
            revertMove(fromSquare, toSquare);
            last.textContent = 'Error: ' + data.error;
            return;
          }
          
          const ok = !!data.correct;
          
          if (ok) {
            flashBoard(true);
            last.innerHTML = `Correct! Leela played <b>${data.leela_move}</b>. Maia replied <b>${data.maia_move}</b>. Total ${data.total.toFixed(3)}.`;
            setTimeout(async () => {
              await refresh();
            }, 600);
          } else {
            flashBoard(false);
            revertMove(fromSquare, toSquare);
            last.textContent = data.message || "Not Leela's choice. Try again.";
          }
        } catch (e) {
          console.error("Server error:", e);
          flashBoard(false);
          revertMove(fromSquare, toSquare);
        }
      }

      function animateMove(fromSquare, toSquare) {
        const fromEl = document.querySelector(`[data-square="${fromSquare}"]`);
        const toEl = document.querySelector(`[data-square="${toSquare}"]`);
        const piece = fromEl?.querySelector('.piece');
        
        if (piece && toEl) {
          // Remove any existing piece on target square
          const existingPiece = toEl.querySelector('.piece');
          if (existingPiece) {
            existingPiece.remove();
          }
          
          // Move piece instantly
          toEl.appendChild(piece);
          piece.style.transform = 'scale(1.1)';
          setTimeout(() => {
            piece.style.transform = '';
          }, 150);
        }
      }

      function revertMove(fromSquare, toSquare) {
        // Revert to current board state instantly
        updateBoardFromFen(currentFen);
        
        // Add a little shake animation to show rejection
        const boardEl = document.getElementById('board');
        boardEl.style.animation = 'shake 0.3s ease-in-out';
        setTimeout(() => {
          boardEl.style.animation = '';
        }, 300);
      }
      function initBoard() {
        console.log("Initializing board...");
        createBoardHTML();
        updateBoardFromFen(currentFen);
        console.log("Board initialized with custom implementation");
      }

      function createBoardHTML() {
        const boardEl = document.getElementById('board');
        console.log("Board element found:", boardEl);
        boardEl.innerHTML = '';
        
        let squareCount = 0;
        for (let rank = 8; rank >= 1; rank--) {
          for (let file = 0; file < 8; file++) {
            const square = String.fromCharCode(97 + file) + rank; // a1, b1, etc.
            const squareEl = document.createElement('div');
            squareEl.className = `square ${(rank + file) % 2 === 0 ? 'dark' : 'light'}`;
            squareEl.dataset.square = square;
            squareEl.addEventListener('click', onSquareClick);
            boardEl.appendChild(squareEl);
            squareCount++;
          }
        }
        console.log("Created", squareCount, "squares");
      }

      function parseFEN(fen) {
        const position = {};
        const parts = fen.split(' ');
        const board = parts[0];
        const ranks = board.split('/');
        
        for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
          const rank = 8 - rankIndex; // 8, 7, 6, ..., 1
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
        console.log("Updating board from FEN:", fen);
        
        // Clear all pieces
        document.querySelectorAll('.piece').forEach(p => p.remove());
        
        // Parse FEN and add pieces
        const position = parseFEN(fen);
        console.log("Parsed position:", position);
        
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
        console.log("Updated board with", Object.keys(position).length, "pieces");
      }

      function onSquareClick(event) {
        const square = event.currentTarget.dataset.square;
        const piece = event.currentTarget.querySelector('.piece');
        
        if (selectedSquare === null) {
          // Select square if it has a white piece (user always plays white)
          if (piece && piece.style.backgroundImage.includes('lt45')) {
            selectedSquare = square;
            event.currentTarget.classList.add('selected');
          }
        } else {
          // Try to make a move
          if (selectedSquare === square) {
            // Deselect
            clearSelection();
          } else {
            // Attempt move
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
        const res = await fetch('/api/session/' + SID + '/state');
        const data = await res.json();
        
        currentFen = data.fen;
        currentTurn = data.turn;
        leelaTopMoves = data.top_lines || []; // Cache Leela's analysis for instant validation
        
        console.log('Refreshing with FEN:', currentFen, 'Turn:', currentTurn);
        console.log('Raw top_lines from server:', data.top_lines);
        console.log('Parsed leelaTopMoves:', leelaTopMoves);
        if (leelaTopMoves.length > 0) {
          console.log('Leela top move is:', leelaTopMoves[0].move);
        } else {
          console.log('NO LEELA MOVES AVAILABLE!');
        }
        
        // Update board position
        updateBoardFromFen(currentFen);
        clearSelection();
        
        setWho(data.turn);
        
        if (data.status === 'finished') {
          document.getElementById('last').innerHTML = 'Session finished. Total score: ' + (data.score_total||0).toFixed(3) + ` <a href="/api/session/${SID}/pgn" target="_blank">Download PGN</a>`;
        }
      }

      // Event listeners
      document.getElementById('new').addEventListener('click', async () => {
        await start();
      });

      // Initialize when page loads
      window.addEventListener('DOMContentLoaded', async () => {
        console.log("DOM loaded, initializing board immediately");
        initBoard();
        start();
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


def stop_analysis(sess: Session) -> None:
    th = sess.analysis_thread
    if th and th.is_alive():
        if sess.stop_evt:
            sess.stop_evt.set()
        th.join(timeout=2.5)
    sess.analysis_thread = None
    sess.stop_evt = None


def restart_analysis(sess: Session) -> None:
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
            with leela:
                board = chess.Board(sess.analysis_fen)
                nodes = 1000
                while not evt.is_set() and sess.status == "playing" and sess.analysis_fen == sess.board.fen():
                    try:
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
    maia_level = int(payload.get("maia_level", 1500))
    multipv = int(payload.get("multipv", 5))
    leela_nodes = int(payload.get("leela_nodes", 2000))
    maia_nodes = 1
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
    # start live analysis
    try:
        restart_analysis(sess)
    except Exception:
        pass
    return JSONResponse({"id": sid})


@app.get("/api/session/{sid}/state")
def api_session_state(sid: str) -> JSONResponse:
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")

    # Ensure we always have fresh Leela analysis
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
    """Get current Leela analysis by creating fresh engine instance"""
    try:
        # ALWAYS do fresh analysis for the current position - no caching
        board = sess.board.copy()
        print(f"🔥 Getting fresh Leela analysis for position: {board.fen()}")
        
        # Create fresh engine instance
        leela, _ = open_engines(sess)
            
        # Quick analysis with moderate nodes for reasonable strength
        with leela:
            infos = leela.analyse(board, nodes=500, multipv=3)
            if not isinstance(infos, list):
                infos = [infos]
        
        from .engines import info_to_lines
        lines = info_to_lines(infos, board.turn)
        
        # Cache the fresh analysis
        sess.last_lines = lines
        print(f"🎯 Fresh analysis complete, top move: {lines[0]['move'] if lines else 'none'}")
        return lines
            
    except Exception as e:
        print(f"❌ Leela analysis failed: {e}")
        # Fallback to simple heuristic moves
        board = sess.board.copy()
        return _fallback_top_lines(board, k=3, pov=board.turn)


@app.post("/api/session/{sid}/predict")
def api_session_predict(sid: str, payload: dict) -> JSONResponse:
    print(f"🎯 START predict endpoint: {payload}")
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")

    move_str = str(payload.get("move", "")).strip()
    client_validated = payload.get("client_validated", False)
    print(f"🎯 Received move: {move_str}, client_validated: {client_validated}")
    if not move_str:
        return JSONResponse({"error": "Missing move"}, status_code=400)

    board = sess.board.copy()
    print(f"🎯 Current board position: {board.fen()}")
    try:
        # Parse move (assume UCI)
        mv = chess.Move.from_uci(move_str)
        print(f"🎯 Parsed move: {mv}")
        if mv not in board.legal_moves:
            print(f"🚨 Illegal move! Legal moves: {[m.uci() for m in board.legal_moves]}")
            return JSONResponse({"error": "Illegal move in current position"}, status_code=400)
        print(f"🎯 Move is legal, proceeding...")
    except Exception as e:
        print(f"🚨 Move parsing failed: {e}")
        return JSONResponse({"error": "Invalid move format. Use UCI like e2e4 or g1f3."}, status_code=400)

    # Compute Leela best move (prefer live lines; fallback to quick query)
    if client_validated:
        # Trust client-side validation - use the submitted move as Leela's choice
        print(f"🔥 Skipping Leela validation - trusting client-side analysis")
        best_move = mv
        engine_ok = True
        infos = []  # Initialize empty infos for client-validated moves
        top_lines = []  # Initialize empty top_lines for client-validated moves
    else:
        print(f"🔥 Starting Leela best move computation...")
        engine_ok = True
        try:
            stop_analysis(sess)
            infos = []
            top_lines = sess.last_lines or []
            print(f"🔥 Cached top_lines: {top_lines}")
            if top_lines and top_lines[0].get("move"):
                best_move = chess.Move.from_uci(top_lines[0]["move"])  # type: ignore
                print(f"🔥 Using cached Leela move: {best_move.uci()}")
            else:
                # Create fresh engine instance for bestmove
                print(f"🔥 No cached move, creating fresh Leela engine...")
                leela, _ = open_engines(sess)
                with leela:
                    print(f"🔥 Calculating Leela bestmove...")
                    best_move = leela.bestmove(board, nodes=max(1000, sess.leela_nodes), seconds=10.0)
                    print(f"🔥 Leela bestmove: {best_move.uci()}")
        except Exception as e:
            print(f"🚨 Leela bestmove failed: {e}")
            engine_ok = False
            infos = []
            top_lines = _fallback_top_lines(board, k=max(1, sess.multipv), pov=board.turn)
            best_move = _fallback_choose_move(board, temperature=0.0)
            print(f"🔥 Fallback Leela move: {best_move.uci()}")

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

    # Require exact match to proceed
    print(f"🎯 Move validation: user={mv.uci()} vs leela={best_move.uci()}")
    if mv != best_move:
        # Wrong guess: do not advance; restart analysis and ask to try again
        print(f"❌ Move rejected: {mv.uci()} != {best_move.uci()}")
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
        print(f"🎯 Returning rejection response: {response}")
        return JSONResponse(response)
    
    print(f"✅ Move accepted: {mv.uci()} matches Leela's choice!")

    # Correct: award score and proceed (apply Leela's best move)
    sess.score_total += 1.0
    board.push(best_move)
    sess.board = board
    sess.move_index += 1

    # Maia reply using low nodes, and temperature for first 10 plies
    reply_move_san = None
    try:
        if engine_ok:
            # Create fresh Maia engine instance
            print(f"🎭 Creating Maia engine for position: {sess.board.fen()}")
            _, maia = open_engines(sess)
            with maia:
                print(f"🎭 Maia calculating move with nodes=1...")
                # Add 5 second timeout to prevent hanging
                mv_reply = maia.bestmove(sess.board, nodes=1, seconds=5.0)
                print(f"🎭 Maia chose move: {mv_reply.uci()}")
        else:
            print(f"🎭 Engine not ok, using fallback for Maia move")
            mv_reply = _fallback_choose_move(sess.board, temperature=0.0)
    except Exception as e:
        print(f"🚨 Maia move generation failed: {e}")
        mv_reply = _fallback_choose_move(sess.board, temperature=0.0)
        print(f"🎭 Fallback Maia move: {mv_reply.uci()}")

    print(f"🎭 Pushing Maia move {mv_reply.uci()} to board")
    sess.board.push(mv_reply)
    sess.move_index += 1
    print(f"🎭 Board after Maia move: {sess.board.fen()}")
    print(f"🎭 Move index now: {sess.move_index}")
    
    # CRITICAL: Clear old analysis for fresh analysis next time
    sess.last_lines = []  # Clear cached analysis so next state request gets fresh data

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

    # restart analysis for next position
    try:
        restart_analysis(sess)
    except Exception:
        pass

    # Check game over
    game_over = False
    result = None
    if sess.board.is_game_over():
        game_over = True
        result = sess.board.result(claim_draw=True)
        sess.status = "finished"

    response_data = {
        "your_move": mv.uci(),
        "leela_move": best_move.uci(),
        "maia_move": mv_reply.uci(),
        "correct": True,
        "score": 1.0,
        "total": sess.score_total,
        "fen": sess.board.fen(),
        "game_over": game_over,
        "result": result,
    }
    print(f"🎯 Returning response: {response_data}")
    return JSONResponse(response_data)


@app.post("/api/session/{sid}/end")
def api_session_end(sid: str) -> JSONResponse:
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")
    sess.status = "finished"
    try:
        stop_analysis(sess)
    except Exception:
        pass
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
