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
    # Predictive cache for next likely position
    predicted_fen: Optional[str] = None
    predicted_lines: list[dict] = field(default_factory=list)
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
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    
    <style>
      :root { --sq: 64px; --light: #3b4252; --dark: #2e3440; --brand: #8b5cf6; --ok: #22c55e; --bad:#ef4444; --ink:#e5e7eb; --muted:#9ca3af; --bg1:#0b1220; --bg2:#0b1324; }
      html,body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
      body { font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,system-ui,sans-serif; color: var(--ink); background: radial-gradient(1200px 800px at 10% 10%, #0f1a34 0%, var(--bg1) 50%), linear-gradient(180deg, var(--bg1), var(--bg2)); }
      .wrap { max-width: 1100px; margin: 0 auto; padding: 28px; }
      .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
      h1 { margin:0; font-weight: 800; letter-spacing: -0.02em; font-size: 22px; color:#f8fafc; }
      .meta { color: var(--muted); font-size: 13px; }
      .panel { background: rgba(17, 24, 39, .7); border: 1px solid rgba(148,163,184,.15); padding: 14px; border-radius: 14px; box-shadow: 0 10px 30px rgba(2,6,23,.25); backdrop-filter: blur(4px); }
      .stage { display:flex; align-items:center; justify-content:center; margin-top: 8px; }
      #board { border: 1px solid rgba(148,163,184,.2); border-radius: 12px; overflow:hidden; display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); box-shadow: 0 20px 50px rgba(2,6,23,.4); }
      .square { display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; position: relative; }
      .square.light { background: #f0d9b5; }
      .square.dark { background: #b58863; }
      .square.selected { box-shadow: inset 0 0 0 3px #ff6b6b; }
      .square.highlight { box-shadow: inset 0 0 0 3px #4ecdc4; }
      .piece { width: 85%; height: 85%; background-size: contain; background-repeat: no-repeat; background-position: center; cursor: grab; transition: transform 0.1s ease; }
      .piece.flipped { transform: rotate(180deg); }
      .piece.flipped.animate { transform: rotate(180deg) scale(1.1); }
      .piece.animate { transform: scale(1.1); }
      .piece:active { cursor: grabbing; }
      .square:hover .piece { }
      .board-flash-green { animation: boardOk 600ms ease; }
      .board-flash-red { animation: boardBad 600ms ease; }
      .board-flash-gray { animation: boardGray 600ms ease; }
      @keyframes boardOk { 
        0% { box-shadow: 0 0 0 0 rgba(34,197,94,.0); } 
        50% { box-shadow: 0 0 0 12px rgba(34,197,94,.8); } 
        100% { box-shadow: 0 0 0 0 rgba(34,197,94,.0); } 
      }
      @keyframes boardBad { 
        0% { box-shadow: 0 0 0 0 rgba(239,68,68,.0); } 
        50% { box-shadow: 0 0 0 12px rgba(239,68,68,.8); } 
        100% { box-shadow: 0 0 0 0 rgba(239,68,68,.0); } 
      }
      @keyframes boardGray { 
        0% { box-shadow: 0 0 0 0 rgba(107,114,128,.0); } 
        50% { box-shadow: 0 0 0 12px rgba(107,114,128,.6); } 
        100% { box-shadow: 0 0 0 0 rgba(107,114,128,.0); } 
      }
      .pill { display:inline-flex; align-items:center; gap:8px; background: rgba(139,92,246,.12); color:#c4b5fd; padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(139,92,246,.25); }
      .btn { background: linear-gradient(180deg,#8b5cf6,#7c3aed); color:#fff; border:0; padding:9px 14px; border-radius: 10px; font-weight:700; cursor:pointer; box-shadow: 0 6px 14px rgba(124,58,237,.3); }
      .btn:hover { filter:brightness(1.05); }
    </style>
  </head>
  <body>
    <div class='wrap' style='width: 100%; height: 100vh; padding: 1vh; box-sizing: border-box; display: flex; align-items: center; justify-content: center;'>
    <!-- Two-column layout -->
    <div style='display: flex; gap: 3vw; align-items: flex-start; height: 90vh;'>
      
      <!-- Left column: Board section (larger) -->
      <div style='display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%;'>
        <div style='text-align: center; height: 100%; display: flex; flex-direction: column; justify-content: center;'>
          <div id='board' style='width: min(70vw, 90vh); height: min(70vw, 90vh); margin: 0 auto;'></div>
        </div>
        
      </div>
      
      <!-- Right column: Stats and controls -->
      <div style='width: 25vw; min-width: 280px; display: flex; flex-direction: column; gap: 1vh; height: 100%; overflow: hidden;'>
        
        <!-- Header & Controls Combined -->
        <div class='panel' style='padding: 1vh;'>
          <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 1vh;'>
            <h1 style='margin: 0; color: #f8fafc; font-size: 1.2rem; font-weight: 800;'>LcStudy</h1>
            <div style='display: flex; gap: 0.5vh;'>
              <button id='new' class='btn' style='padding: 0.5vh 1vw; font-size: 0.8rem; white-space: nowrap;'>New Game</button>
              <button onclick='playLeelaMove()' class='btn' style='padding: 0.5vh 1vw; font-size: 0.8rem; white-space: nowrap; background: #22c55e;'>Leela</button>
            </div>
          </div>
          <div>
            <label for='maia-elo' style='display: block; margin-bottom: 0.3vh; color: var(--muted); font-size: 0.7rem;'>Maia Strength:</label>
            <select id='maia-elo' style='width: 100%; padding: 0.3vh 0.8vh; border-radius: 0.3vh; border: 1px solid rgba(148,163,184,.3); background: rgba(17, 24, 39, .8); color: var(--ink); font-size: 0.75rem;'>
              <option value="1100">1100 (Beginner)</option>
              <option value="1300">1300 (Novice)</option>
              <option value="1500" selected>1500 (Intermediate)</option>
              <option value="1700">1700 (Advanced)</option>
              <option value="1900">1900 (Expert)</option>
            </select>
          </div>
        </div>
        
        <!-- Accuracy Over Time Chart -->
        <div class='panel' style='padding: 1vh; flex: 2; min-height: 0; display: flex; flex-direction: column;'>
          <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5vh;'>
            <h2 style='margin: 0; color: #f8fafc; font-size: 0.9rem; font-weight: 600;'>Your Accuracy Over Time</h2>
          </div>
          <canvas id='accuracy-chart' style='width: 100%; flex: 1;'></canvas>
        </div>
        
        <!-- Attempts Chart -->
        <div class='panel' style='padding: 1vh; flex: 2; min-height: 0; display: flex; flex-direction: column;'>
          <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5vh;'>
            <h2 style='margin: 0; color: #f8fafc; font-size: 0.9rem; font-weight: 600;'>Attempts per Move</h2>
            <span style='color: #f59e0b; font-weight: 600; font-size: 0.75rem;'>Avg: <span id='avg-attempts'>0.0</span></span>
          </div>
          <canvas id='attempts-chart' style='width: 100%; flex: 1;'></canvas>
        </div>
        
        <!-- PGN Moves (Single Line) -->
        <div class='panel' style='padding: 2vh 2vh; flex: 0 0 auto; min-height: 8vh; display: flex; flex-direction: column; justify-content: center;'>
          <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 1vh;'>
            <h2 style='margin: 0; color: #f8fafc; font-size: 0.9rem; font-weight: 600;'>Recent Moves</h2>
            <span style='color: #22c55e; font-weight: 600; font-size: 0.75rem;'>Current: <span id='current-eval'>0.0%</span></span>
          </div>
          <div id='pgn-moves' style='font-family: Georgia, serif; font-size: 0.7rem; line-height: 1.3; overflow-x: auto; white-space: nowrap; padding: 0.5vh 0;'>
            <div id='move-list' class='meta'>Game not started</div>
          </div>
        </div>
        
      </div>
    </div>
    </div>
    <script>
      
      let SID = null;
      let selectedSquare = null;
      let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      let currentTurn = 'white';
      let leelaTopMoves = []; // Pre-fetched Leela analysis for instant validation
      let boardIsFlipped = false; // Track flip state globally
      
      // Game tracking data
      let gameAttempts = []; // Attempts per move
      let totalAttempts = 0;
      let currentMoveAttempts = 0;
      let moveCounter = 1;
      let pgnMoves = [];
      let gameHistory = []; // Historical game averages
      let cumulativeAverages = []; // Running average over time
      
      // Chart instances
      let accuracyChart = null;
      let attemptsChart = null;

      
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

      function initializeCharts() {
        // Initialize Accuracy Chart
        const accuracyCtx = document.getElementById('accuracy-chart').getContext('2d');
        accuracyChart = new Chart(accuracyCtx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [{
              label: "Average Retries",
              data: [],
              borderColor: '#8b5cf6',
              backgroundColor: 'rgba(139, 92, 246, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.3
            }, {
              label: "Current Game",
              data: [],
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34, 197, 94, 0.2)',
              borderWidth: 2,
              pointRadius: 6,
              pointHoverRadius: 8,
              fill: false,
              tension: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
              padding: 15
            },
            scales: {
              y: {
                min: 0,
                grid: { color: 'rgba(148,163,184,0.2)' },
                ticks: { 
                  color: '#9ca3af', 
                  font: { size: 10 },
                  callback: function(value) {
                    return value.toFixed(1);
                  }
                }
              },
              x: {
                grid: { color: 'rgba(148,163,184,0.2)' },
                ticks: { 
                  color: '#9ca3af', 
                  font: { size: 10 }
                }
              }
            },
            plugins: {
              legend: { 
                display: false
              }
            }
          }
        });

        // Initialize Attempts Chart
        const attemptsCtx = document.getElementById('attempts-chart').getContext('2d');
        attemptsChart = new Chart(attemptsCtx, {
          type: 'bar',
          data: {
            labels: [],
            datasets: [{
              label: 'Attempts',
              data: [],
              backgroundColor: '#f59e0b',
              borderColor: '#d97706',
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
              padding: 15
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: { color: 'rgba(148,163,184,0.2)' },
                ticks: { 
                  color: '#9ca3af', 
                  font: { size: 10 },
                  stepSize: 1
                }
              },
              x: {
                grid: { color: 'rgba(148,163,184,0.2)' },
                ticks: { 
                  color: '#9ca3af', 
                  font: { size: 10 }
                }
              }
            },
            plugins: {
              legend: { 
                display: false
              }
            }
          }
        });
      }

      function updateStatistics(scoreTotal, currentMove) {
        // Update current position win probability from Leela
        const currentEvalElement = document.getElementById('current-eval');
        if (currentEvalElement && leelaTopMoves.length > 0) {
          // Extract win probability from Leela's evaluation
          let winProb = null;
          if (leelaTopMoves[0].wdl && leelaTopMoves[0].wdl.length >= 3) {
            // WDL format: [win, draw, loss] probabilities
            winProb = leelaTopMoves[0].wdl[0] * 100;
          } else if (leelaTopMoves[0].winrate !== null && leelaTopMoves[0].winrate !== undefined) {
            winProb = leelaTopMoves[0].winrate * 100;
          } else if (leelaTopMoves[0].cp !== null) {
            // Convert centipawns to win probability
            const cp = leelaTopMoves[0].cp;
            winProb = (1 / (1 + Math.pow(10, -cp / 400))) * 100;
          }
          
          if (winProb !== null) {
            currentEvalElement.textContent = winProb.toFixed(1) + '%';
          }
        }
        
        const avgAttempts = totalAttempts > 0 ? (totalAttempts / Math.max(1, gameAttempts.length)) : 0;
        document.getElementById('avg-attempts').textContent = avgAttempts.toFixed(1);
      }

      function updateCharts() {
        if (accuracyChart) {
          // Historical games
          const labels = [];
          const historicalData = [];
          const currentGameData = [];
          
          // Add historical game labels and data
          for (let i = 0; i < cumulativeAverages.length; i++) {
            labels.push(`Game ${i + 1}`);
            historicalData.push(cumulativeAverages[i]);
            currentGameData.push(null); // No current game data for historical games
          }
          
          // Add current game if we have attempts
          if (gameAttempts.length > 0) {
            const currentGameAvg = totalAttempts / gameAttempts.length;
            labels.push(`Game ${cumulativeAverages.length + 1}`);
            historicalData.push(null); // No historical data for current game
            currentGameData.push(currentGameAvg);
          }
          
          accuracyChart.data.labels = labels;
          accuracyChart.data.datasets[0].data = historicalData;
          accuracyChart.data.datasets[1].data = currentGameData;
          accuracyChart.update('none');
        }
        
        if (attemptsChart && gameAttempts.length > 0) {
          attemptsChart.data.labels = gameAttempts.map((_, i) => `Move ${i + 1}`);
          attemptsChart.data.datasets[0].data = gameAttempts;
          attemptsChart.update('none');
        }
      }

      function updatePGNDisplay() {
        const pgnElement = document.getElementById('move-list');
        const pgnContainer = document.getElementById('pgn-moves');
        
        if (pgnMoves.length === 0) {
          pgnElement.innerHTML = '<span class="meta">Game not started</span>';
          return;
        }
        
        let pgnText = '';
        for (let i = 0; i < pgnMoves.length; i += 2) {
          const moveNum = Math.floor(i / 2) + 1;
          const whiteMove = pgnMoves[i] || '';
          const blackMove = pgnMoves[i + 1] || '';
          pgnText += `<span style="color: #f8fafc; font-weight: 600;">${moveNum}.</span> ${whiteMove}`;
          if (blackMove) pgnText += ` ${blackMove}`;
          pgnText += ' ';
        }
        pgnElement.innerHTML = pgnText;
        
        // Auto-scroll to show latest moves
        setTimeout(() => {
          pgnContainer.scrollLeft = pgnContainer.scrollWidth;
        }, 10);
        
      }

      async function loadGameHistory() {
        try {
          const res = await fetch('/api/game-history');
          const data = await res.json();
          gameHistory = data.history || [];
          
          // Calculate cumulative averages
          cumulativeAverages = [];
          let runningSum = 0;
          for (let i = 0; i < gameHistory.length; i++) {
            runningSum += gameHistory[i].average_retries;
            cumulativeAverages.push(runningSum / (i + 1));
          }
          
          updateCharts();
        } catch (e) {
          console.log('Failed to load game history:', e);
        }
      }

      async function saveCompletedGame(result) {
        console.log('*** saveCompletedGame called with result:', result);
        console.log('*** gameAttempts.length:', gameAttempts.length);
        console.log('*** totalAttempts:', totalAttempts);
        
        if (gameAttempts.length === 0) {
          console.log('*** No moves made, not saving game');
          return;
        }
        
        const avgRetries = totalAttempts / gameAttempts.length;
        const maiaLevel = parseInt(document.getElementById('maia-elo').value);
        
        console.log('*** Saving game with avgRetries:', avgRetries, 'maiaLevel:', maiaLevel);
        
        try {
          await fetch('/api/game-history', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              average_retries: avgRetries,
              total_moves: gameAttempts.length,
              maia_level: maiaLevel,
              result: result
            })
          });
          
          // Update local data and chart
          gameHistory.push({
            average_retries: avgRetries,
            total_moves: gameAttempts.length,
            maia_level: maiaLevel,
            result: result
          });
          
          // Recalculate cumulative averages
          let runningSum = 0;
          cumulativeAverages = [];
          for (let i = 0; i < gameHistory.length; i++) {
            runningSum += gameHistory[i].average_retries;
            cumulativeAverages.push(runningSum / (i + 1));
          }
          
          updateCharts();
        } catch (e) {
          console.log('Failed to save game:', e);
        }
      }

      function resetGameData() {
        gameAttempts = [];
        totalAttempts = 0;
        currentMoveAttempts = 0;
        moveCounter = 1;
        pgnMoves = [];
        
        if (attemptsChart) {
          attemptsChart.data.labels = [];
          attemptsChart.data.datasets[0].data = [];
          attemptsChart.update('none');
        }
        
        // Update accuracy chart to remove current game data
        updateCharts();
        
        updatePGNDisplay();
        updateStatistics(0, 1);
      }

      function flashBoard(result) {
        const boardEl = document.getElementById('board');
        let className;
        if (result === 'success') {
          className = 'board-flash-green';
        } else if (result === 'illegal') {
          className = 'board-flash-gray';
        } else {
          className = 'board-flash-red';
        }
        boardEl.classList.remove('board-flash-green', 'board-flash-red', 'board-flash-gray');
        boardEl.offsetHeight;
        boardEl.classList.add(className);
        setTimeout(() => {
          boardEl.classList.remove(className);
        }, 300);
      }

      let pendingMoves = new Set();

      function isPawnPromotion(mv) {
        if (mv.length !== 4) return false;
        const fromSquare = mv.slice(0, 2);
        const toSquare = mv.slice(2, 4);
        const fromRank = parseInt(fromSquare[1]);
        const toRank = parseInt(toSquare[1]);
        
        // Check if it's a move to the back rank (promotion rank)
        if (!(toRank === 8 || toRank === 1)) return false;
        
        // Check if it's a pawn moving to the back rank
        const fromElement = document.getElementById(fromSquare);
        const piece = fromElement?.querySelector('.piece');
        if (!piece) {
          console.log(`*** isPawnPromotion: No piece found at ${fromSquare}`);
          return false;
        }
        
        const pieceStyle = piece.style.backgroundImage;
        console.log(`*** isPawnPromotion: piece style = ${pieceStyle}`);
        
        // Check for pawn in the URL - look for 'plt45' or 'pdt45'
        const isWhitePawn = pieceStyle.includes('plt45');
        const isBlackPawn = pieceStyle.includes('pdt45');
        const isPawn = isWhitePawn || isBlackPawn;
        
        console.log(`*** isPawnPromotion: isPawn=${isPawn}, isWhitePawn=${isWhitePawn}, isBlackPawn=${isBlackPawn}`);
        console.log(`*** isPawnPromotion: fromRank=${fromRank}, toRank=${toRank}`);
        
        // White pawns promote on rank 8, black pawns on rank 1
        const isWhitePawnPromotion = isWhitePawn && fromRank === 7 && toRank === 8;
        const isBlackPawnPromotion = isBlackPawn && fromRank === 2 && toRank === 1;
        
        const result = isWhitePawnPromotion || isBlackPawnPromotion;
        console.log(`*** isPawnPromotion: result=${result}`);
        
        return result;
      }

      function showPromotionDialog() {
        return new Promise((resolve) => {
          // Create modal overlay
          const overlay = document.createElement('div');
          overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          `;
          
          // Create dialog
          const dialog = document.createElement('div');
          dialog.style.cssText = `
            background: #2a2a2a;
            padding: 24px;
            border-radius: 12px;
            text-align: center;
            color: white;
            font-family: inherit;
          `;
          
          const title = document.createElement('h3');
          title.textContent = 'Choose promotion piece:';
          title.style.cssText = 'margin: 0 0 20px 0; font-size: 18px;';
          dialog.appendChild(title);
          
          // Create piece buttons
          const pieces = [
            { piece: 'q', name: 'Queen', symbol: '♕' },
            { piece: 'r', name: 'Rook', symbol: '♖' },
            { piece: 'b', name: 'Bishop', symbol: '♗' },
            { piece: 'n', name: 'Knight', symbol: '♘' }
          ];
          
          const buttonContainer = document.createElement('div');
          buttonContainer.style.cssText = 'display: flex; gap: 12px; justify-content: center;';
          
          pieces.forEach(({ piece, name, symbol }) => {
            const button = document.createElement('button');
            button.innerHTML = `<div style="font-size: 32px; margin-bottom: 8px;">${symbol}</div><div style="font-size: 12px;">${name}</div>`;
            button.style.cssText = `
              background: #4a4a4a;
              border: 2px solid #666;
              border-radius: 8px;
              color: white;
              padding: 16px 12px;
              cursor: pointer;
              min-width: 80px;
              transition: all 0.2s;
            `;
            
            button.onmouseover = () => {
              button.style.background = '#5a5a5a';
              button.style.borderColor = '#888';
            };
            button.onmouseout = () => {
              button.style.background = '#4a4a4a';
              button.style.borderColor = '#666';
            };
            
            button.onclick = () => {
              document.body.removeChild(overlay);
              resolve(piece);
            };
            
            buttonContainer.appendChild(button);
          });
          
          dialog.appendChild(buttonContainer);
          overlay.appendChild(dialog);
          document.body.appendChild(overlay);
          
          // Close on overlay click
          overlay.onclick = (e) => {
            if (e.target === overlay) {
              document.body.removeChild(overlay);
              resolve(null);
            }
          };
        });
      }

      async function playLeelaMove() {
        if (!SID) {
          console.log('*** No session ID');
          return;
        }
        
        try {
          console.log('*** Fetching Leela move...');
          const res = await fetch('/api/session/' + SID + '/state');
          const data = await res.json();
          
          // Try different ways to get the move
          let leelaMove = null;
          if (data.lines && data.lines.length > 0 && data.lines[0].move) {
            leelaMove = data.lines[0].move;
          } else if (data.top_move) {
            leelaMove = data.top_move;
          } else if (data.top_lines && data.top_lines.length > 0 && data.top_lines[0].move) {
            leelaMove = data.top_lines[0].move;
          }
          
          if (leelaMove) {
            console.log(`*** Playing Leela's top move: ${leelaMove}`);
            await submitMove(leelaMove);
          } else {
            console.log('*** No Leela move available');
          }
        } catch (error) {
          console.error('*** Error playing Leela move:', error);
        }
      }

      async function submitMove(mv){
        if (!SID || pendingMoves.has(mv)) return;
        
        // Handle pawn promotion with piece selection
        if (isPawnPromotion(mv)) {
          const promotionPiece = await showPromotionDialog();
          if (!promotionPiece) return; // User cancelled
          mv = mv + promotionPiece;
        }
        
        // Check if move is legal using a quick server call
        try {
          const legalCheckRes = await fetch('/api/session/' + SID + '/check-move', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({move: mv})
          });
          const legalData = await legalCheckRes.json();
          
          if (!legalData.legal) {
            flashBoard('illegal');
            return;
          }
        } catch (e) {
          // If check fails, continue with normal processing
          console.log('Move legality check failed:', e);
        }
        
        pendingMoves.add(mv);
        
        const fromSquare = mv.slice(0, 2);
        const toSquare = mv.slice(2, 4);
        
        const leelaTopMove = leelaTopMoves.length > 0 ? leelaTopMoves[0].move : null;
        const isLeelaMove = leelaTopMove === mv;
        
        if (isLeelaMove) {
          currentMoveAttempts++;
          totalAttempts++;
          animateMove(fromSquare, toSquare);
          flashBoard('success');
          submitCorrectMoveToServer(mv);
        } else if (leelaTopMove === null) {
          animateMove(fromSquare, toSquare);
          submitMoveToServer(mv, fromSquare, toSquare);
        } else {
          currentMoveAttempts++;
          totalAttempts++;
          flashBoard('wrong');
          revertMove();
        }
        
        pendingMoves.delete(mv);
      }

      async function submitCorrectMoveToServer(mv) {
        try {
          const res = await fetch('/api/session/' + SID + '/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({move: mv, client_validated: true})});
          const data = await res.json();
          
          if (data.correct) {
            // Record this move's attempt count
            gameAttempts.push(currentMoveAttempts);
            currentMoveAttempts = 0;
            moveCounter++;
            
            // Add moves to PGN tracking
            pgnMoves.push(data.leela_move);
            if (data.maia_move) {
              pgnMoves.push(data.maia_move);
            }
            
            // Check if this move ended the game and save immediately
            if (data.status === 'finished') {
              console.log('*** Correct move resulted in game finish - saving immediately...');
              await saveCompletedGame('finished');
              await loadGameHistory();
            }
            
            // Move feedback removed - visual feedback through board animation
            
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
            // Check if it's an illegal move (don't count against attempts)
            if (data.error.includes('Illegal move')) {
              flashBoard('illegal');
            } else {
              // Count this as a wrong attempt for other errors
              currentMoveAttempts++;
              totalAttempts++;
              flashBoard('wrong');
            }
            revertMove();
            last.textContent = 'Error: ' + data.error;
            return;
          }
          
          const ok = !!data.correct;
          
          if (ok) {
            // Count this as an attempt since it was legal (even if correct)
            currentMoveAttempts++;
            totalAttempts++;
            // Record this move's attempt count
            gameAttempts.push(currentMoveAttempts);
            currentMoveAttempts = 0;
            moveCounter++;
            
            // Add moves to PGN tracking
            pgnMoves.push(data.leela_move);
            if (data.maia_move) {
              pgnMoves.push(data.maia_move);
            }
            
            flashBoard('success');
            // Move feedback removed - visual feedback through board animation
            
            const totalSubmitTime = performance.now() - submitStart;
            console.log(`Total move submission took ${totalSubmitTime.toFixed(1)}ms`);
            console.log(`=== SCHEDULING REFRESH IN 600ms ===`);
            
            setTimeout(async () => {
              await refresh();
            }, 600);
          } else {
            // Count this as a wrong attempt for legal but incorrect moves
            currentMoveAttempts++;
            totalAttempts++;
            flashBoard('wrong');
            revertMove();
          }
        } catch (e) {
          // Count network/server errors as attempts
          currentMoveAttempts++;
          totalAttempts++;
          flashBoard('wrong');
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
          // Use CSS class for animation
          piece.classList.add('animate');
          setTimeout(() => {
            piece.classList.remove('animate');
          }, 150);
        }
      }

      function revertMove() {
        // Just revert to current position, flip state never changes
        updateBoardFromFen(currentFen);
        // Removed shake animation as it was interfering with board flip
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

      function setBoardFlip(flip) {
        const board = document.getElementById('board');
        console.log(`*** setBoardFlip called with: ${flip}`);
        boardIsFlipped = flip; // Store globally
        if (flip) {
          board.style.transform = 'rotate(180deg)';
        } else {
          board.style.transform = 'none';
        }
      }

      function updateBoardFromFen(fen) {
        document.querySelectorAll('.piece').forEach(p => p.remove());
        const position = parseFEN(fen);
        
        console.log(`*** updateBoardFromFen - boardIsFlipped: ${boardIsFlipped}`);
        
        for (const [square, piece] of Object.entries(position)) {
          const pieceEl = document.createElement('div');
          pieceEl.className = 'piece';
          pieceEl.style.backgroundImage = `url(${pieceImages[piece]})`;
          pieceEl.dataset.piece = piece;
          
          // Use CSS class for rotation instead of inline styles
          if (boardIsFlipped) {
            pieceEl.classList.add('flipped');
            console.log(`*** Adding flipped class to piece ${piece}`);
          } else {
            console.log(`*** No flip class for piece ${piece}`);
          }
          
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
          if (piece) {
            // Determine which pieces player can move based on board orientation
            const playerPieceType = boardIsFlipped ? 'dt45' : 'lt45'; // dt45 = dark/black pieces, lt45 = light/white pieces
            
            if (piece.style.backgroundImage.includes(playerPieceType)) {
              selectedSquare = square;
              event.currentTarget.classList.add('selected');
            }
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
        // Turn indicator removed - color is evident from board orientation
      }

      async function start() {
        const maiaLevel = parseInt(document.getElementById('maia-elo').value);
        const playerColor = Math.random() < 0.5 ? 'white' : 'black'; // Random starting color
        const res = await fetch('/api/session/new', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({maia_level: maiaLevel, player_color: playerColor})});
        const data = await res.json();
        SID = data.id;
        
        // Immediately set board flip state (this should stay constant for the entire game)
        const shouldFlip = data.flip || false;
        setBoardFlip(shouldFlip);
        
        // Set initial position
        const sessionFen = data.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        updateBoardFromFen(sessionFen);
        
        resetGameData();
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
        const shouldFlip = data.flip || false;
        console.log(`*** Client received: FEN=${currentFen.slice(0,30)}, top_move=${leelaTopMoves[0]?.move || 'none'}, flip=${shouldFlip}`);
        
        // No longer tracking win probability per move
        
        // Update board position (flip state is already set and won't change)
        updateBoardFromFen(currentFen);
        clearSelection();
        setWho(data.turn);
        
        // Update statistics and charts
        updateStatistics(data.score_total || 0, data.ply || moveCounter);
        updateCharts();
        updatePGNDisplay();
        
        const updateTime = performance.now() - updateStart;
        console.log(`Board update took ${updateTime.toFixed(1)}ms`);
        
        console.log('*** Game status:', data.status);
        if (data.status === 'finished') {
          console.log('*** Game finished - saving to history...');
          // Save completed game stats
          await saveCompletedGame('finished');
          
          // Reload game history to update the chart
          await loadGameHistory();
        }
        
        const totalRefreshTime = performance.now() - refreshStart;
        console.log(`=== TOTAL REFRESH: ${totalRefreshTime.toFixed(1)}ms ===`);
      }

      document.getElementById('new').addEventListener('click', async () => {
        await start();
      });

      window.addEventListener('DOMContentLoaded', async () => { 
        initBoard(); 
        initializeCharts();
        await loadGameHistory();
        start(); 
      });
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
    """DISABLED: Background analysis was causing cache corruption."""
    # Stop any existing analysis
    stop_analysis(sess)
    # Don't start new background analysis - we'll use on-demand analysis instead
    print(f"Background analysis disabled for session {sess.id}")


@app.get("/")
def index() -> HTMLResponse:
    return HTMLResponse(html_index(), media_type="text/html; charset=utf-8")


@app.get("/api/game-history")
def api_get_game_history() -> JSONResponse:
    """Load game history from local JSON file."""
    import json
    from lcstudy.engines import home_dir
    history_file = home_dir() / "game_history.json"
    try:
        if history_file.exists():
            with open(history_file, 'r') as f:
                history = json.load(f)
        else:
            history = []
        return JSONResponse({"history": history})
    except Exception as e:
        logger.warning("Failed to load game history: %s", e)
        return JSONResponse({"history": []})


@app.post("/api/game-history")
def api_save_game_history(payload: dict) -> JSONResponse:
    """Save completed game stats to local JSON file."""
    import json
    from datetime import datetime
    from lcstudy.engines import home_dir, ensure_dirs
    
    history_file = home_dir() / "game_history.json"
    
    # Load existing history
    try:
        if history_file.exists():
            with open(history_file, 'r') as f:
                history = json.load(f)
        else:
            history = []
    except Exception:
        history = []
    
    # Add new game
    game_data = {
        "date": datetime.now().isoformat(),
        "average_retries": float(payload.get("average_retries", 0)),
        "total_moves": int(payload.get("total_moves", 0)),
        "maia_level": int(payload.get("maia_level", 1500)),
        "result": str(payload.get("result", "unknown"))
    }
    history.append(game_data)
    
    # Save updated history
    try:
        ensure_dirs()  # Ensure the directory exists
        with open(history_file, 'w') as f:
            json.dump(history, f, indent=2)
        return JSONResponse({"success": True})
    except Exception as e:
        logger.warning("Failed to save game history: %s", e)
        return JSONResponse({"success": False, "error": str(e)})


@app.post("/api/session/{sid}/check-move")
def api_session_check_move(sid: str, payload: dict) -> JSONResponse:
    """Check if a move is legal without making it."""
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")
    
    move_str = str(payload.get("move", "")).strip()
    if not move_str:
        return JSONResponse({"legal": False})
    
    try:
        # Handle both regular moves (e2e4) and promotions (e7e8q)
        mv = chess.Move.from_uci(move_str)
        legal = mv in sess.board.legal_moves
        return JSONResponse({"legal": legal})
    except Exception as e:
        # If parsing fails, it's definitely not legal
        logger.debug(f"Move parsing failed for '{move_str}': {e}")
        return JSONResponse({"legal": False})


@app.post("/api/session/new")
def api_session_new(payload: dict) -> JSONResponse:
    """Create a new session with optional Maia level and analysis parameters."""
    maia_level = int(payload.get("maia_level", 1500))
    multipv = int(payload.get("multipv", 5))
    leela_nodes = int(payload.get("leela_nodes", 2000))
    maia_nodes = 1
    player_color = str(payload.get("player_color", "white"))
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
        flip=(player_color == "black"),
    )
    with SESS_LOCK:
        SESSIONS[sid] = sess
    
    # Pre-warm engines to eliminate first-move delay
    try:
        leela, maia = open_engines(sess)
        logger.info("Pre-warmed engines for session %s", sid)
        
        # If player is black, make Maia's opening move
        if player_color == "black":
            with sess.maia_lock:
                # Use some randomness for opening variety
                temperature = 1.0 if sess.move_index < 10 else 0.0
                if temperature > 0:
                    infos = maia.analyse(sess.board, nodes=max(100, sess.maia_nodes), multipv=5)
                    maia_move = pick_from_multipv(infos, sess.board.turn, temperature)
                else:
                    maia_move = maia.bestmove(sess.board, nodes=sess.maia_nodes)
                sess.board.push(maia_move)
                sess.move_index += 1
                logger.info("Maia opened with %s", maia_move.uci())
                
    except Exception as e:
        logger.warning("Failed to pre-warm engines: %s", e)
    
    try:
        restart_analysis(sess)
    except Exception:
        pass
    return JSONResponse({
        "id": sid, 
        "flip": sess.flip,
        "fen": sess.board.fen()
    })


@app.get("/api/session/{sid}/state")
def api_session_state(sid: str) -> JSONResponse:
    """Return the current session state and cached Leela top lines."""
    try:
        sess = get_session(sid)
    except KeyError:
        raise HTTPException(404, "Session not found")
    
    # Smart cache: check if we have valid analysis for current position
    current_fen = sess.board.fen()
    
    # Check if cache is valid for current position
    if sess.analysis_fen == current_fen and sess.last_lines:
        top_lines = sess.last_lines
        top_move = top_lines[0]['move'] if top_lines else 'none'
        print(f"*** Cache HIT for {current_fen[:30]} (top move: {top_move})")
    elif sess.predicted_fen == current_fen and sess.predicted_lines:
        # Predictive cache hit!
        top_lines = sess.predicted_lines
        top_move = top_lines[0]['move'] if top_lines else 'none'
        print(f"*** PREDICTIVE CACHE HIT for {current_fen[:30]} (top move: {top_move})")
        # Move prediction to main cache
        sess.last_lines = sess.predicted_lines
        sess.analysis_fen = current_fen
        sess.predicted_fen = None
        sess.predicted_lines = []
    else:
        # Cache miss - get fresh analysis and update cache
        print(f"*** Cache MISS for {current_fen[:30]} (cached_fen: {sess.analysis_fen[:30] if sess.analysis_fen else 'None'})")
        
        # Cache miss - get fresh analysis and update cache  
        try:
            leela, _ = open_engines(sess)
            if sess.leela_lock.acquire(timeout=0.2):  # 200ms timeout
                try:
                    board = sess.board.copy()
                    infos = leela.analyse(board, nodes=150, multipv=3)  # Quick analysis
                    if not isinstance(infos, list):
                        infos = [infos]
                    top_lines = info_to_lines(infos, board.turn)
                    
                    # Update cache with fresh analysis for THIS position
                    sess.last_lines = top_lines
                    sess.analysis_fen = current_fen
                    
                    top_move = top_lines[0]['move'] if top_lines else 'none'
                    print(f"*** Got fresh analysis and updated cache (top move: {top_move})")
                finally:
                    sess.leela_lock.release()
            else:
                # Couldn't get lock, use fallback but don't cache it
                board = sess.board.copy()
                top_lines = _fallback_top_lines(board, k=3, pov=board.turn)
                top_move = top_lines[0]['move'] if top_lines else 'none'
                print(f"*** Lock timeout, using fallback (top move: {top_move})")
        except Exception as e:
            # Error getting analysis, use fallback
            board = sess.board.copy()
            top_lines = _fallback_top_lines(board, k=3, pov=board.turn)
            top_move = top_lines[0]['move'] if top_lines else 'none'
            print(f"*** Analysis error, using fallback (top move: {top_move}): {e}")

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
            "flip": sess.flip,
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
