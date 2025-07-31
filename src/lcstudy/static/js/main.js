let SID = null;
let selectedSquare = null;
let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let currentTurn = 'white';
let leelaTopMoves = [];
let boardIsFlipped = false;

let gameAttempts = [];
let totalAttempts = 0;
let currentMoveAttempts = 0;
let moveCounter = 1;
let pgnMoves = [];
let gameHistory = [];
let cumulativeAverages = [];

// Move navigation state
let moveHistory = []; // Array of {fen, san, isUserMove} objects
let currentMoveIndex = -1; // -1 means at current/live position
let isReviewingMoves = false;
let liveFen = ''; // The actual current game position

let accuracyChart = null;
let attemptsChart = null;

const defaultPieceImages = {
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
const pieceCodes = ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'];

function getPieceUrl(code) { return defaultPieceImages[code]; }

// No user-provided pieces; use fixed Wikipedia URLs.

function initializeCharts() {
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
  const currentAverageElement = document.getElementById('avg-attempts');
  if (currentAverageElement) {
    const avgAttempts = gameAttempts.length > 0 ? (totalAttempts / gameAttempts.length) : 0;
    currentAverageElement.textContent = avgAttempts.toFixed(1);
  }
}

function updateCharts() {
  if (accuracyChart) {
    const labels = [];
    const historicalData = [];
    const currentGameData = [];
    
    for (let i = 0; i < cumulativeAverages.length; i++) {
      labels.push(`Game ${i + 1}`);
      historicalData.push(cumulativeAverages[i]);
      currentGameData.push(null);
    }
    
    if (gameAttempts.length > 0) {
      const currentGameAvg = totalAttempts / gameAttempts.length;
      labels.push(`Game ${cumulativeAverages.length + 1}`);
      historicalData.push(null);
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
  
  setTimeout(() => {
    pgnContainer.scrollLeft = pgnContainer.scrollWidth;
  }, 10);
}

async function loadGameHistory() {
  try {
    const res = await fetch('/api/v1/game-history');
    const data = await res.json();
    gameHistory = data.history || [];
    
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
  if (gameAttempts.length === 0) {
    return;
  }
  
  const avgRetries = totalAttempts / gameAttempts.length;
  const maiaLevel = window.currentMaiaLevel || 1500;
  
  try {
    await fetch('/api/v1/game-history', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        average_retries: avgRetries,
        total_moves: gameAttempts.length,
        maia_level: maiaLevel,
        result: result
      })
    });
    
    gameHistory.push({
      average_retries: avgRetries,
      total_moves: gameAttempts.length,
      maia_level: maiaLevel,
      result: result
    });
    
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

async function needsPromotion(mv) {
  try {
    const res = await fetch('/api/v1/session/' + SID + '/check-move', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({move: mv})
    });
    const data = await res.json();
    return data.needs_promotion || false;
  } catch (e) {
    return false;
  }
}

function showPromotionDialog() {
  return new Promise((resolve) => {
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
    
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve(null);
      }
    };
  });
}




function updateAttemptsRemaining(remaining) {
  const attemptsElement = document.getElementById('attempts-remaining');
  if (attemptsElement) {
    if (remaining === 0) {
      attemptsElement.textContent = 'auto-play';
      attemptsElement.style.color = '#dc2626';
    } else if (remaining <= 3) {
      attemptsElement.textContent = `${remaining} left`;
      attemptsElement.style.color = '#ef4444';
    } else {
      attemptsElement.textContent = `${remaining} left`;
      attemptsElement.style.color = '#f59e0b';
    }
  }
}

function createConfetti() {
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];
  const confettiCount = 150;
  
  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + 'vw';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.width = Math.random() * 10 + 5 + 'px';
    confetti.style.height = confetti.style.width;
    confetti.style.animationDelay = Math.random() * 0.5 + 's';
    confetti.style.animationDuration = Math.random() * 2 + 2 + 's';
    
    document.body.appendChild(confetti);
    
    setTimeout(() => {
      if (confetti.parentNode) {
        confetti.parentNode.removeChild(confetti);
      }
    }, 4000);
  }
}

async function setupPromotionTest() {
  const testFen = "8/1P6/8/8/8/8/8/8 w - - 0 1";
  await start(testFen);
}

async function submitMove(mv){
  if (!SID || pendingMoves.has(mv)) return;
  
  if (await needsPromotion(mv)) {
    const promotionPiece = await showPromotionDialog();
    if (!promotionPiece) return;
    mv = mv + promotionPiece;
  }
  
  try {
    const legalCheckRes = await fetch('/api/v1/session/' + SID + '/check-move', {
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
    console.log('Move legality check failed:', e);
  }
  
  pendingMoves.add(mv);
  
  const fromSquare = mv.slice(0, 2);
  const toSquare = mv.slice(2, 4);
  
  animateMove(fromSquare, toSquare);
  submitMoveToServer(mv, fromSquare, toSquare);
  
  pendingMoves.delete(mv);
}

async function submitCorrectMoveToServer(mv) {
  try {
    const res = await fetch('/api/v1/session/' + SID + '/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({move: mv, client_validated: true})});
    const data = await res.json();
    
    if (data.correct) {
      const attempts = data.attempts || 1;
      gameAttempts.push(attempts);
      currentMoveAttempts = 0;
      totalAttempts += attempts;
      moveCounter++;
      
      pgnMoves.push(data.leela_move);
      if (data.maia_move) {
        pgnMoves.push(data.maia_move);
      }
      
      if (data.status === 'finished') {
        console.log('Game finished! Starting new game in 2.5s...');
        createConfetti();
        await saveCompletedGame('finished');
        await loadGameHistory();
        
        setTimeout(async () => {
          console.log('Starting new game now...');
          await start();
        }, 2500);
      }
      
      setTimeout(async () => {
        await refresh();
      }, 600);
    }
  } catch (e) {
    
  }
}

async function submitMoveToServer(mv, fromSquare, toSquare) {
  try {
    const res = await fetch('/api/v1/session/' + SID + '/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({move: mv})});
    const data = await res.json();
    
    const last = document.getElementById('last');
    
    if (data.error) {
      if (data.error.includes('Illegal move')) {
        flashBoard('illegal');
      } else {
        flashBoard('wrong');
      }
      revertMove();
      if (last) last.textContent = 'Error: ' + data.error;
      return;
    }
    
    const ok = !!data.correct;
    
    if (ok) {
      const attempts = data.attempts || 1;
      gameAttempts.push(attempts);
      currentMoveAttempts = 0;
      totalAttempts += attempts;
      moveCounter++;
      
      // Track the user's move in history
      if (data.leela_move) {
        const userMoveSAN = data.leela_move; // This should ideally be SAN notation
        addMoveToHistory(currentFen, userMoveSAN, true);
      }
      
      pgnMoves.push(data.leela_move);
      if (data.maia_move) {
        pgnMoves.push(data.maia_move);
        // Note: We'll add Maia's move to history after refresh when we get the new FEN
      }
      
      updateAttemptsRemaining(10);
      
      flashBoard('success');
      
      setTimeout(async () => {
        await refresh();
        updateAttemptsRemaining(10);
        
        // Add Maia's move to history if it was made
        if (data.maia_move) {
          const maiaMoveSAN = data.maia_move;
          addMoveToHistory(liveFen, maiaMoveSAN, false);
        }
      }, 600);
    } else {
      const attempts = data.attempts || 1;
      const remaining = Math.max(0, 10 - attempts);
      updateAttemptsRemaining(remaining);
      
      flashBoard('wrong');
      revertMove();
      if (last) last.textContent = data.message || 'Not the correct move. Try again.';
    }
  } catch (e) {
    flashBoard('wrong');
    revertMove();
    console.error('Move submission error:', e);
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
    piece.classList.add('animate');
    setTimeout(() => {
      piece.classList.remove('animate');
    }, 150);
  }
}

function revertMove() {
  updateBoardFromFen(currentFen);
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
  boardIsFlipped = flip;
  if (flip) {
    board.style.transform = 'rotate(180deg)';
  } else {
    board.style.transform = 'none';
  }
}

function updateBoardFromFen(fen) {
  document.querySelectorAll('.piece').forEach(p => p.remove());
  const position = parseFEN(fen);
  
  for (const [square, piece] of Object.entries(position)) {
    const pieceEl = document.createElement('div');
    pieceEl.className = 'piece';
    pieceEl.style.backgroundImage = `url(${getPieceUrl(piece)})`;
    pieceEl.dataset.piece = piece;
    
    if (boardIsFlipped) {
      pieceEl.classList.add('flipped');
    }
    
    const squareEl = document.querySelector(`[data-square="${square}"]`);
    if (squareEl) {
      squareEl.appendChild(pieceEl);
    }
  }
}

function onSquareClick(event) {
  // Don't allow moves when reviewing past positions
  if (isReviewingMoves) {
    console.log('Cannot make moves while reviewing. Use arrow keys to return to current position.');
    return;
  }
  
  const square = event.currentTarget.dataset.square;
  const piece = event.currentTarget.querySelector('.piece');
  
  if (selectedSquare === null) {
    if (piece) {
      const playerColor = boardIsFlipped ? 'b' : 'w';
      if ((piece.dataset.piece || '').startsWith(playerColor)) {
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
  
}

async function start(customFen = null) {
  const maiaLevels = [1100, 1300, 1500, 1700, 1900];
  const maiaLevel = maiaLevels[Math.floor(Math.random() * maiaLevels.length)];
  window.currentMaiaLevel = maiaLevel;

  // Color will be determined by the precomputed game on the backend
  const payload = {maia_level: maiaLevel};
  if (customFen) {
    payload.custom_fen = customFen;
  }
  const res = await fetch('/api/v1/session/new', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
  if (!res.ok) {
    console.error('Failed to create session', res.status);
    return;
  }
  const data = await res.json();
  SID = data.id;
  
  const shouldFlip = data.flip || false;
  setBoardFlip(shouldFlip);
  
  const sessionFen = data.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  updateBoardFromFen(sessionFen);
  
  resetGameData();
  resetMoveHistory();
  await refresh();
  updateAttemptsRemaining(10);
}

async function refresh() {
  if (!SID) return;
  
  const res = await fetch('/api/v1/session/' + SID + '/state');
  
  const data = await res.json();
  
  // Update live position
  updateLiveFen(data.fen);
  currentTurn = data.turn;
  leelaTopMoves = data.top_lines || [];
  const shouldFlip = data.flip || false;
  
  // Only update board display if we're at live position
  if (!isReviewingMoves) {
    updateBoardFromFen(data.fen);
  }
  clearSelection();
  setWho(data.turn);
  
  updateStatistics(data.score_total || 0, data.ply || moveCounter);
  updateCharts();
  updatePGNDisplay();
  
  if (data.status === 'finished') {
    console.log('Game finished! Starting new game in 2.5s...');
    createConfetti();
    
    await saveCompletedGame('finished');
    
    await loadGameHistory();
    
    setTimeout(async () => {
      console.log('Starting new game now...');
      await start();
    }, 2500);
  }
}

document.getElementById('new').addEventListener('click', async () => {
  await start();
});

function handleKeyPress(event) {
  // Only handle arrow keys
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    return;
  }
  
  event.preventDefault();
  
  if (event.key === 'ArrowLeft') {
    // Left arrow = go back in time (earlier moves)
    navigateToMove(currentMoveIndex - 1);
  } else if (event.key === 'ArrowRight') {
    // Right arrow = go forward in time (later moves)
    navigateToMove(currentMoveIndex + 1);
  }
}

function navigateToMove(targetIndex) {
  const maxIndex = moveHistory.length - 1;
  
  console.log(`Navigate: current=${currentMoveIndex}, target=${targetIndex}, maxIndex=${maxIndex}`);
  
  // Handle navigation from live position
  if (currentMoveIndex === -1) {
    if (targetIndex === -2) {
      // Left arrow from live position: go to most recent move (maxIndex)
      targetIndex = maxIndex;
    } else if (targetIndex === 0) {
      // Right arrow from live position: stay at live position
      return;
    }
  }
  
  // Valid navigation range:
  // -1 = live position (current game state)
  // 0 to maxIndex = historical moves
  
  // Clamp targetIndex to valid range
  if (targetIndex < 0 && targetIndex !== -1) {
    // Trying to go before first move - stay at first move
    targetIndex = 0;
  } else if (targetIndex > maxIndex) {
    // If trying to go past last historical move, return to live position  
    targetIndex = -1;
  }
  
  if (targetIndex === currentMoveIndex) {
    console.log('No change needed');
    return; // No change
  }
  
  console.log(`Moving to index ${targetIndex}`);
  currentMoveIndex = targetIndex;
  isReviewingMoves = currentMoveIndex !== -1;
  
  if (isReviewingMoves) {
    // Show historical position
    const move = moveHistory[currentMoveIndex];
    console.log(`Showing historical move ${currentMoveIndex}: ${move.san}`);
    updateBoardFromFen(move.fen);
    updateNavigationUI();
  } else {
    // Return to live position
    console.log('Returning to live position');
    updateBoardFromFen(liveFen);
    updateNavigationUI();
  }
  
  clearSelection();
}

function updateNavigationUI() {
  // Add visual indicator when reviewing moves
  const boardEl = document.getElementById('board');
  if (isReviewingMoves) {
    boardEl.classList.add('reviewing-moves');
    // Show move info
    const move = moveHistory[currentMoveIndex];
    console.log(`Reviewing move ${currentMoveIndex + 1}/${moveHistory.length}: ${move.san}`);
  } else {
    boardEl.classList.remove('reviewing-moves');
    console.log('Back to live position');
  }
}

function addMoveToHistory(fen, san, isUserMove) {
  moveHistory.push({
    fen: fen,
    san: san,
    isUserMove: isUserMove
  });
}

function resetMoveHistory() {
  moveHistory = [];
  currentMoveIndex = -1;
  isReviewingMoves = false;
  liveFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
}

function updateLiveFen(fen) {
  liveFen = fen;
  // If we're at live position, update the display
  if (!isReviewingMoves) {
    currentFen = fen;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  initBoard();
  initializeCharts();
  await loadGameHistory();
  start();
  
  // Add keyboard event listener
  document.addEventListener('keydown', handleKeyPress);
});
