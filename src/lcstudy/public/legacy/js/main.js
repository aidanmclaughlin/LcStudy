let SID = null;
const sessionCache = { sessionId: null, gameId: null, moves: [], currentIndex: 0, rounds: [], roundIndex: 0, flip: false, maiaLevel: 1500 };
let selectedSquare = null;
let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let currentTurn = 'white';
let leelaTopMoves = [];
let boardIsFlipped = false;
let boardObserver = null;
let isRebuildingBoard = false;

const ATTEMPT_LIMIT = 10;
const CHART_JS_SRC = 'https://cdn.jsdelivr.net/npm/chart.js';
const CHESS_JS_SRC = '/legacy/vendor/chess.esm.js';

let chartLoaderPromise = null;
let chessLoaderPromise = null;
let chessEngine = null;

function ensureChartJs() {
  if (typeof window !== 'undefined' && typeof window.Chart !== 'undefined') {
    return Promise.resolve();
  }
  if (chartLoaderPromise) {
    return chartLoaderPromise;
  }
  chartLoaderPromise = new Promise((resolve, reject) => {
    try {
      if (typeof window === 'undefined') {
        resolve();
        return;
      }
      if (typeof window.Chart !== 'undefined') {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-chartjs]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Chart.js')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = CHART_JS_SRC;
      script.async = true;
      script.dataset.chartjs = 'true';
      script.addEventListener('load', () => resolve());
      script.addEventListener('error', () => reject(new Error('Failed to load Chart.js')));
      document.head.appendChild(script);
    } catch (err) {
      reject(err);
    }
  });
  return chartLoaderPromise;
}

function ensureChessJs() {
  if (typeof window !== 'undefined' && typeof window.Chess !== 'undefined') {
    return Promise.resolve();
  }
  if (chessLoaderPromise) {
    return chessLoaderPromise;
  }
  chessLoaderPromise = (async () => {
    if (typeof window === 'undefined') {
      return;
    }
    if (typeof window.Chess !== 'undefined') {
      return;
    }
    try {
      const mod = await import(/* webpackIgnore: true */ CHESS_JS_SRC);
      const ChessCtor = mod?.Chess || mod?.default || mod;
      if (typeof ChessCtor !== 'function') {
        throw new Error('Invalid chess.js module');
      }
      window.Chess = ChessCtor;
    } catch (err) {
      console.error('Failed to load chess.js', err);
      throw err;
    }
  })();
  return chessLoaderPromise;
}

function getCurrentRound() {
  const roundIndex = coerceIndex(sessionCache.roundIndex);
  return sessionCache.rounds[roundIndex] || null;
}

function applyMoveToBoard(moveDef, isUserMove) {
  if (!chessEngine || !moveDef) return null;
  const norm = moveDef.uci.toLowerCase();
  const from = norm.slice(0, 2);
  const to = norm.slice(2, 4);
  const promotion = norm.length > 4 ? norm.slice(4) : undefined;
  const moveResult = chessEngine.move({ from, to, promotion: promotion || undefined });
  if (!moveResult) {
    console.warn('applyMoveToBoard failed', { moveDef, isUserMove, fen: chessEngine.fen(), norm });
    return null;
  }
  const fenAfter = chessEngine.fen();
  currentFen = fenAfter;
  liveFen = fenAfter;
  updateBoardFromFen(fenAfter);
  const san = moveResult.san || moveDef.san || moveDef.uci;
  addMoveToHistory(fenAfter, san, isUserMove);
  pgnMoves.push(san);
  return moveResult;
}

function handleMaiaReply(round) {
  if (!round || !round.reply) {
    return null;
  }
  return applyMoveToBoard(round.reply, false);
}

function getPlayerColor() {
  return sessionCache.flip ? 'b' : 'w';
}

function isPlayerMove(index) {
  if (typeof index !== 'number' || index < 0) {
    return false;
  }
  const playerColor = getPlayerColor();
  const isWhitePly = index % 2 === 0;
  return playerColor === 'w' ? isWhitePly : !isWhitePly;
}

function buildRoundsFromMoves(moves) {
  if (!Array.isArray(moves)) {
    return [];
  }
  const rounds = [];
  for (let idx = 0; idx < moves.length; idx += 1) {
    if (!isPlayerMove(idx)) {
      continue;
    }
    const playerMove = moves[idx];
    const replyIndex = idx + 1 < moves.length ? idx + 1 : null;
    const replyMove = replyIndex !== null ? moves[replyIndex] : undefined;
    rounds.push({
      player: playerMove,
      reply: replyMove,
      playerIndex: idx,
      replyIndex: replyIndex
    });
  }
  return rounds;
}

function coerceIndex(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (numeric < 0) {
    return 0;
  }
  return Math.floor(numeric);
}

function updateRoundIndexFromCurrentIndex() {
  if (!Array.isArray(sessionCache.rounds)) {
    sessionCache.roundIndex = 0;
    return;
  }
  const currentPly = coerceIndex(sessionCache.currentIndex);
  let completed = 0;
  for (const round of sessionCache.rounds) {
    if (round && typeof round.playerIndex === 'number' && round.playerIndex < currentPly) {
      completed += 1;
    }
  }
  sessionCache.roundIndex = completed;
}

function getExpectedPlayerMove() {
  if (!Array.isArray(sessionCache.rounds)) {
    return null;
  }
  const roundIndex = coerceIndex(sessionCache.roundIndex);
  const round = sessionCache.rounds[roundIndex];
  if (!round || !round.player) {
    return null;
  }
  return {
    index: typeof round.playerIndex === 'number' ? round.playerIndex : roundIndex,
    move: round.player,
    roundIndex,
    round
  };
}

async function completeExpectedMove(expectedInfo, attemptsForMove, isAutoPlay) {
  const moveResult = applyMoveToBoard(expectedInfo.move, true);
  if (!moveResult) {
    console.warn('Move application failed', expectedInfo.move);
    flashBoard('wrong');
    return false;
  }

  if (isAutoPlay) {
    flashBoard('illegal');
    correctStreak = 0;
  } else {
    flashBoard('success');
    correctStreak = (correctStreak || 0) + 1;
    if (expectedInfo.move && typeof expectedInfo.move.uci === 'string') {
      const targetSquare = expectedInfo.move.uci.slice(2, 4);
      celebrateSuccess(targetSquare);
    }
  }
  showStreakPill();

  currentMoveAttempts = 0;
  gameAttempts.push(attemptsForMove);
  totalAttempts += attemptsForMove;
  moveCounter += 1;
  updateAttemptsRemaining(ATTEMPT_LIMIT);

  sessionCache.currentIndex = expectedInfo.index + 1;

  const round = expectedInfo.round;
  if (round && round.reply) {
    const replyResult = handleMaiaReply(round);
    if (!replyResult) {
      console.warn('Failed to apply Maia reply', round.reply);
    } else {
      const replyIndex = typeof round.replyIndex === 'number' ? round.replyIndex : expectedInfo.index;
      sessionCache.currentIndex = Math.max(sessionCache.currentIndex, replyIndex + 1);
    }
  }

  sessionCache.roundIndex = coerceIndex(expectedInfo.roundIndex) + 1;
  updateRoundIndexFromCurrentIndex();

  updateCharts();
  updateStatistics(totalAttempts, moveCounter);
  updatePGNDisplay();

  if (sessionCache.currentIndex >= sessionCache.moves.length) {
    await saveCompletedGame('finished');
    await loadGameHistory();
    setTimeout(async () => {
      await start();
    }, 2500);
  }

  return true;
}

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
let soundEnabled = true; // always on
let correctStreak = 0;
let sfxCtx = null;

function getAudioContext() {
  if (!sfxCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) sfxCtx = new AC();
  }
  return sfxCtx;
}

function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }
  } catch (e) {}
}

const defaultPieceImages = {
  'wK': '/legacy/img/pieces/wK.svg',
  'wQ': '/legacy/img/pieces/wQ.svg',
  'wR': '/legacy/img/pieces/wR.svg',
  'wB': '/legacy/img/pieces/wB.svg',
  'wN': '/legacy/img/pieces/wN.svg',
  'wP': '/legacy/img/pieces/wP.svg',
  'bK': '/legacy/img/pieces/bK.svg',
  'bQ': '/legacy/img/pieces/bQ.svg',
  'bR': '/legacy/img/pieces/bR.svg',
  'bB': '/legacy/img/pieces/bB.svg',
  'bN': '/legacy/img/pieces/bN.svg',
  'bP': '/legacy/img/pieces/bP.svg'
};
const pieceCodes = ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'];

function getPieceUrl(code) { return defaultPieceImages[code]; }

// No user-provided pieces; use fixed Wikipedia URLs.

function initializeCharts() {
  if (typeof window === 'undefined' || typeof window.Chart === 'undefined') {
    console.error('Chart.js is not available yet. Skipping chart initialization.');
    return;
  }
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
        padding: { left: 18, right: 18, top: 20, bottom: 16 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              const dsIndex = context.datasetIndex;
              const idx = context.dataIndex;
              const value = context.formattedValue;
              if (dsIndex === 0) {
                const ds = context.chart.data.datasets[0] || {};
                const minIdx = ds.customMinIndex;
                if (minIdx !== undefined && minIdx !== null && idx === minIdx) {
                  return `Lowest Retries: ${value}`;
                }
                return `Average Retries: ${value}`;
              } else if (dsIndex === 1) {
                return `Current Game: ${value}`;
              }
              return value;
            }
          }
        }
      },
      scales: {
        y: {
          min: 0,
          grid: { color: 'rgba(148,163,184,0.18)', drawBorder: false },
          border: { display: false },
          ticks: {
            color: '#9ca3af',
            font: { size: 10 },
            padding: 6,
            callback: function(value) {
              return value.toFixed(1);
            }
          }
        },
        x: {
          grid: { color: 'rgba(148,163,184,0.12)', drawBorder: false },
          border: { display: false },
          ticks: {
            color: '#9ca3af',
            font: { size: 10 },
            padding: 6
          }
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
        padding: { left: 18, right: 18, top: 20, bottom: 16 }
      },
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          min: 0,
          grid: { color: 'rgba(148,163,184,0.18)', drawBorder: false },
          border: { display: false },
          ticks: { 
            color: '#9ca3af', 
            font: { size: 10 },
            stepSize: 1,
            padding: 6
          }
        },
        x: {
          grid: { color: 'rgba(148,163,184,0.12)', drawBorder: false },
          border: { display: false },
          ticks: { 
            color: '#9ca3af', 
            font: { size: 10 },
            padding: 6
          }
        }
      }
    }
  });
}

// ----- Tasteful feedback utilities -----
function initUXToggles() {
  // Always-on sound; clear any persisted mute flag if present
  soundEnabled = true;
  try { localStorage.removeItem('lcstudy_sound'); } catch (e) {}
}

function playSuccessChime() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
    const now = ctx.currentTime;
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(880, now);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o1.connect(g1).connect(ctx.destination);
    o1.start(now);
    o1.stop(now + 0.2);

    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(1320, now + 0.12);
    g2.gain.setValueAtTime(0.0001, now + 0.12);
    g2.gain.exponentialRampToValueAtTime(0.15, now + 0.14);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    o2.connect(g2).connect(ctx.destination);
    o2.start(now + 0.12);
    o2.stop(now + 0.34);
  } catch (e) {}
}

function vibrateSuccess() {
  if (navigator.vibrate) {
    try { navigator.vibrate([18, 10, 18]); } catch (e) {}
  }
}

function showStreakPill() {
  const pill = document.getElementById('streak-pill');
  if (!pill) return;
  if (correctStreak >= 2) {
    pill.textContent = `Streak x${correctStreak}`;
    pill.classList.add('show', 'streak-pop');
    setTimeout(() => pill.classList.remove('streak-pop'), 320);
  } else {
    pill.classList.remove('show');
  }
}

function successPulseAtSquare(square) {
  const el = document.querySelector(`[data-square="${square}"]`);
  if (!el) return;
  const hit = document.createElement('div');
  hit.className = 'hit';
  el.appendChild(hit);
  setTimeout(() => { try { el.removeChild(hit); } catch (e) {} }, 420);
}

function createConfettiBurstAt(x, y, count = 16) {
  const colors = ['#f59e0b', '#fbbf24', '#f87171', '#34d399', '#60a5fa', '#a78bfa'];
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-burst';
    c.style.left = (x - 4) + 'px';
    c.style.top = (y - 4) + 'px';
    c.style.backgroundColor = colors[Math.floor(Math.random()*colors.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 70;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    c.style.setProperty('--dx', dx + 'px');
    c.style.setProperty('--dy', dy + 'px');
    document.body.appendChild(c);
    setTimeout(() => { try { document.body.removeChild(c); } catch (e) {} }, 700);
  }
}

function shimmerJackpotOnBoard() {
  const board = document.getElementById('board');
  if (!board) return;
  const overlay = document.createElement('div');
  overlay.className = 'shimmer-overlay';
  board.appendChild(overlay);
  setTimeout(() => { try { board.removeChild(overlay); } catch (e) {} }, 560);
}

function celebrateSuccess(toSquare) {
  successPulseAtSquare(toSquare);
  const el = document.querySelector(`[data-square="${toSquare}"]`);
  if (el) {
    const r = el.getBoundingClientRect();
    createConfettiBurstAt(r.left + r.width/2, r.top + r.height/2, 16);
  }
  playSuccessChime();
  vibrateSuccess();
  if (Math.random() < 0.07) {
    shimmerJackpotOnBoard();
    if (el) {
      const r = el.getBoundingClientRect();
      createConfettiBurstAt(r.left + r.width/2, r.top + r.height/2, 24);
    }
  }
}

function updateStatistics(scoreTotal, currentMove) {
  const currentAverageElement = document.getElementById('avg-attempts');
  if (currentAverageElement) {
    const avgAttempts = gameAttempts.length > 0 ? (totalAttempts / gameAttempts.length) : 0;
    const prev = parseFloat(currentAverageElement.textContent || '0') || 0;
    const next = parseFloat(avgAttempts.toFixed(1));
    if (next !== prev) {
      currentAverageElement.textContent = next.toFixed(1);
      currentAverageElement.classList.add('num-bounce');
      setTimeout(() => currentAverageElement.classList.remove('num-bounce'), 260);
    }
  }
}

function updateCharts() {
  if (accuracyChart) {
    const labels = [];
    const historicalData = [];
    const currentGameData = [];
    // Per-point style arrays for highlighting the minimum value
    const pointBgColors = [];
    const pointBdColors = [];
    const pointRadii = [];
    const pointHoverRadii = [];
    const pointBorderWidths = [];
    
    for (let i = 0; i < cumulativeAverages.length; i++) {
      labels.push('');
      historicalData.push(cumulativeAverages[i]);
      currentGameData.push(null);
      pointBgColors.push('#8b5cf6');
      pointBdColors.push('#8b5cf6');
      pointRadii.push(0); // hide most points
      pointHoverRadii.push(0);
      pointBorderWidths.push(0);
    }
    
    if (gameAttempts.length > 0) {
      const currentGameAvg = totalAttempts / gameAttempts.length;
      labels.push('');
      historicalData.push(null);
      currentGameData.push(currentGameAvg);
      pointBgColors.push('#8b5cf6');
      pointBdColors.push('#8b5cf6');
      pointRadii.push(0);
      pointHoverRadii.push(0);
      pointBorderWidths.push(0);
    }
    // Determine and highlight the all-time lowest historical average
    let minIdxForTooltip = null;
    if (cumulativeAverages.length > 0) {
      let minVal = cumulativeAverages[0];
      let minIdx = 0;
      for (let i = 1; i < cumulativeAverages.length; i++) {
        if (cumulativeAverages[i] < minVal) {
          minVal = cumulativeAverages[i];
          minIdx = i;
        }
      }
      // Apply red styling and a larger point radius to the min point
      pointBgColors[minIdx] = '#e11d48';
      // Use a white border ring for contrast against the filled area
      pointBdColors[minIdx] = '#ffffff';
      pointRadii[minIdx] = 5;  // slightly smaller
      pointHoverRadii[minIdx] = 7;
      pointBorderWidths[minIdx] = 2;
      minIdxForTooltip = minIdx;
    }

    accuracyChart.data.labels = labels;
    accuracyChart.data.datasets[0].data = historicalData;
    accuracyChart.data.datasets[1].data = currentGameData;
    // Update per-point style to highlight the minimum
    accuracyChart.data.datasets[0].pointBackgroundColor = pointBgColors;
    accuracyChart.data.datasets[0].pointBorderColor = pointBdColors;
    accuracyChart.data.datasets[0].pointRadius = pointRadii;
    accuracyChart.data.datasets[0].pointHoverRadius = pointHoverRadii;
    accuracyChart.data.datasets[0].pointBorderWidth = pointBorderWidths;
    // Dynamically tighten Y axis to data range with ±0.5 padding
    const yVals = [];
    for (let i = 0; i < cumulativeAverages.length; i++) {
      const v = cumulativeAverages[i];
      if (typeof v === 'number' && !isNaN(v)) yVals.push(v);
    }
    if (gameAttempts.length > 0) {
      const currentGameAvg = totalAttempts / gameAttempts.length;
      if (typeof currentGameAvg === 'number' && !isNaN(currentGameAvg)) yVals.push(currentGameAvg);
    }
    if (yVals.length > 0) {
      let minY = yVals[0];
      let maxY = yVals[0];
      for (let i = 1; i < yVals.length; i++) {
        if (yVals[i] < minY) minY = yVals[i];
        if (yVals[i] > maxY) maxY = yVals[i];
      }
      const pad = 0.2;
      accuracyChart.options.scales.y.min = minY - pad;
      accuracyChart.options.scales.y.max = maxY + pad;
    }

    // Expose min index for tooltip labeling
    accuracyChart.data.datasets[0].customMinIndex = minIdxForTooltip;
    accuracyChart.update('none');
  }
  
  if (attemptsChart && gameAttempts.length > 0) {
    attemptsChart.data.labels = gameAttempts.map(() => '');
    attemptsChart.data.datasets[0].data = gameAttempts;
    
    // Update bar colors based on current move index
    // Convert move history index to user move index (attempts array index)
    let currentUserMoveIndex = -1;
    if (isReviewingMoves && currentMoveIndex >= 0) {
      let userMoveCount = 0;
      for (let i = 0; i <= currentMoveIndex && i < moveHistory.length; i++) {
        if (moveHistory[i].isUserMove) {
          if (i === currentMoveIndex) {
            currentUserMoveIndex = userMoveCount;
          }
          userMoveCount++;
        }
      }
    }
    
    const colors = gameAttempts.map((_, index) => {
      const isCurrentMove = isReviewingMoves && currentUserMoveIndex === index;
      return isCurrentMove ? '#10b981' : '#f59e0b'; // green for current, amber for others
    });
    attemptsChart.data.datasets[0].backgroundColor = colors;
    attemptsChart.data.datasets[0].borderColor = colors.map(color => color === '#10b981' ? '#059669' : '#d97706');
    
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
    
    // Check if this is the current move being reviewed
    const isWhiteHighlighted = isReviewingMoves && currentMoveIndex === i;
    const isBlackHighlighted = isReviewingMoves && currentMoveIndex === i + 1;
    
    pgnText += `<span style="color: #f8fafc; font-weight: 600;">${moveNum}.</span> `;
    
    // Highlight white move if it's current
    if (whiteMove) {
      if (isWhiteHighlighted) {
        pgnText += `<span style="background-color: #10b981; color: #000; padding: 2px 4px; border-radius: 3px;">${whiteMove}</span>`;
      } else {
        pgnText += whiteMove;
      }
    }
    
    // Highlight black move if it's current
    if (blackMove) {
      pgnText += ' ';
      if (isBlackHighlighted) {
        pgnText += `<span style="background-color: #10b981; color: #000; padding: 2px 4px; border-radius: 3px;">${blackMove}</span>`;
      } else {
        pgnText += blackMove;
      }
    }
    
    pgnText += ' ';
  }
  pgnElement.innerHTML = pgnText;
  
  // Instant PGN scroll - no delay needed
  pgnContainer.scrollLeft = pgnContainer.scrollWidth;
}

async function loadGameHistory() {
  try {
    const res = await fetch('/api/v1/game-history');
    const data = await res.json();
    gameHistory = data.history || [];

    // Calculate proper cumulative average (weighted by total moves)
    cumulativeAverages = [];
    let totalMovesSoFar = 0;
    let totalAttemptsSoFar = 0;

    for (let i = 0; i < gameHistory.length; i++) {
      const game = gameHistory[i];
      const gameMoves = game.total_moves || 0;
      const gameAttempts = game.average_retries * gameMoves;

      totalMovesSoFar += gameMoves;
      totalAttemptsSoFar += gameAttempts;

      // Cumulative average = total attempts / total moves
      const cumulativeAvg = totalMovesSoFar > 0 ? totalAttemptsSoFar / totalMovesSoFar : 0;
      cumulativeAverages.push(cumulativeAvg);
    }

    updateCharts();
  } catch (e) {
    console.log('Failed to load game history:', e);
  }
}

async function saveCompletedGame(result) {
  if (!SID || gameAttempts.length === 0) {
    return;
  }

  const maiaLevel = sessionCache.maiaLevel || window.currentMaiaLevel || 1500;
  const totalMoves = gameAttempts.length;
  const totalAttemptsForGame = totalAttempts;
  const attemptHistory = [...gameAttempts];
  console.debug('saveCompletedGame payload', { SID, totalMoves, totalAttemptsForGame, attemptHistory });
  const averageRetries = totalMoves > 0 ? totalAttemptsForGame / totalMoves : 0;

  try {
    const res = await fetch(`/api/v1/session/${SID}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        total_attempts: totalAttemptsForGame,
        total_moves: totalMoves,
        attempt_history: attemptHistory,
        average_retries: averageRetries,
        maia_level: maiaLevel,
        result: result
      })
    });
    if (!res.ok) {
      console.error('Failed to persist game', res.status, await res.text());
    }
  } catch (e) {
    console.log('Failed to persist game:', e);
  }

  gameHistory.push({
    average_retries: averageRetries,
    total_moves: totalMoves,
    maia_level: maiaLevel,
    result: result
  });

  // Recalculate cumulative averages properly (weighted by total moves)
  cumulativeAverages = [];
  let totalMovesSoFar = 0;
  let totalAttemptsSoFar = 0;

  for (let i = 0; i < gameHistory.length; i++) {
    const game = gameHistory[i];
    const gameMoves = game.total_moves || 0;
    const gameAttempts = game.average_retries * gameMoves;

    totalMovesSoFar += gameMoves;
    totalAttemptsSoFar += gameAttempts;

    // Cumulative average = total attempts / total moves
    const cumulativeAvg = totalMovesSoFar > 0 ? totalAttemptsSoFar / totalMovesSoFar : 0;
    cumulativeAverages.push(cumulativeAvg);
  }

  updateCharts();
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
    className = 'board-shake';
  }
  boardEl.classList.remove('board-flash-green', 'board-shake', 'board-flash-gray');
  boardEl.offsetHeight;
  boardEl.classList.add(className);
  // Animation duration
  const duration = className === 'board-shake' ? 400 : 300;
  setTimeout(() => {
    boardEl.classList.remove(className);
  }, duration);
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

async function submitMove(mv) {
  if (!SID || !sessionCache.moves.length) return;

  const expectedInfo = getExpectedPlayerMove();
  if (!expectedInfo) {
    console.warn('No expected move remaining');
    return;
  }

  let normalized = mv.toLowerCase();
  const expectedUci = expectedInfo.move.uci.toLowerCase();
  if (expectedUci.length === 5 && normalized.length === 4) {
    normalized += expectedUci[4];
  }

  console.debug('submitMove', {
    input: mv,
    normalized,
    expected: expectedUci,
    expectedIndex: expectedInfo.index,
    currentIndex: sessionCache.currentIndex,
    flip: sessionCache.flip,
    movesLength: sessionCache.moves.length,
    roundIndex: sessionCache.roundIndex
  });

  const attemptsForMove = currentMoveAttempts + 1;

  if (normalized !== expectedUci) {
    currentMoveAttempts = attemptsForMove;
    console.warn('Incorrect move', normalized, 'expected', expectedUci, 'index', expectedInfo.index, 'currentIndex', sessionCache.currentIndex);
    flashBoard('wrong');
    updateAttemptsRemaining(Math.max(0, ATTEMPT_LIMIT - currentMoveAttempts));
    correctStreak = 0;
    showStreakPill();
    updateBoardFromFen(currentFen);
    if (currentMoveAttempts >= ATTEMPT_LIMIT) {
      console.info('Auto-playing move after reaching attempt limit', expectedInfo.move);
      await completeExpectedMove(expectedInfo, ATTEMPT_LIMIT, true);
    }
    return;
  }

  await completeExpectedMove(expectedInfo, attemptsForMove, false);
}

async function submitCorrectMoveToServer(mv) {
  try {

  } catch (e) {
    
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
    // Instant piece animation - no delay needed
    piece.classList.remove('animate');
  }
}

function revertMove() {
  updateBoardFromFen(currentFen);
}

function initBoard() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  createBoardHTML();
  updateBoardFromFen(currentFen);

  if (boardObserver) {
    try { boardObserver.disconnect(); } catch (e) {}
  }

  boardObserver = new MutationObserver(() => {
    if (isRebuildingBoard) return;
    if (!boardEl.hasChildNodes()) {
      try {
        isRebuildingBoard = true;
        createBoardHTML();
        updateBoardFromFen(currentFen);
      } finally {
        isRebuildingBoard = false;
      }
    }
  });

  try {
    boardObserver.observe(boardEl, { childList: true });
  } catch (e) {}
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
    board.style.setProperty('--board-rotation', '180deg');
  } else {
    board.style.transform = 'none';
    board.style.setProperty('--board-rotation', '0deg');
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
  // Ensure audio context is unlocked by user interaction
  try { unlockAudio(); } catch (e) {}
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

  const payload = { maia_level: maiaLevel };
  if (customFen) {
    payload.custom_fen = customFen;
  }

  const res = await fetch('/api/v1/session/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    console.error('Failed to create session', res.status);
    return;
  }
  const rawBody = await res.text();
  let data;
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    console.error('Failed to parse session response', {
      status: res.status,
      body: rawBody
    }, err);
    throw err;
  }

  SID = data.id;
  sessionCache.sessionId = data.id;
  sessionCache.gameId = data.game_id;
  sessionCache.moves = Array.isArray(data.moves) ? data.moves : [];
  sessionCache.flip = Boolean(data.flip);
  sessionCache.currentIndex = coerceIndex(data.ply);
  sessionCache.maiaLevel = data.maia_level || maiaLevel;
  sessionCache.rounds = buildRoundsFromMoves(sessionCache.moves);
  updateRoundIndexFromCurrentIndex();
  console.debug('Session initialized', {
    sessionId: SID,
    gameId: sessionCache.gameId,
    moves: sessionCache.moves.length,
    currentIndex: sessionCache.currentIndex,
    flip: sessionCache.flip,
    roundIndex: sessionCache.roundIndex,
    totalRounds: sessionCache.rounds.length,
    nextRound: sessionCache.rounds[sessionCache.roundIndex] || null
  });

  const startingFen = data.starting_fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const currentFenValue = data.fen || startingFen;

  if (typeof window.Chess === 'function') {
    chessEngine = new window.Chess(startingFen);
  } else {
    console.error('chess.js not available');
    return;
  }

  setBoardFlip(sessionCache.flip);
  resetGameData();
  resetMoveHistory();
  initUXToggles();

  if (Array.isArray(sessionCache.moves) && sessionCache.moves.length > 0) {
    for (let idx = 0; idx < sessionCache.currentIndex; idx++) {
      const moveDef = sessionCache.moves[idx];
      if (!applyMoveToBoard(moveDef, isPlayerMove(idx))) {
        console.warn('Failed to apply historical move', moveDef);
        break;
      }
    }
  }

  updateRoundIndexFromCurrentIndex();

  if (currentFenValue) {
    chessEngine.load(currentFenValue);
  }

  currentFen = chessEngine.fen();
  liveFen = currentFen;
  updateBoardFromFen(currentFen);
  updatePGNDisplay();
  updateAttemptsRemaining(ATTEMPT_LIMIT);

  try {
    window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
    window.addEventListener('keydown', unlockAudio, { once: true, passive: true });
    window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
    window.addEventListener('click', unlockAudio, { once: true, passive: true });
  } catch (e) {}
}


document.getElementById('new').addEventListener('click', async () => {
  try { unlockAudio(); } catch (e) {}
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
  
  // Update charts and PGN display to reflect current move highlighting
  updateCharts();
  updatePGNDisplay();
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

async function bootstrap() {
  try {
    await Promise.all([ensureChartJs(), ensureChessJs()]);
    initBoard();
    initializeCharts();
    await loadGameHistory();
    await start();
    document.addEventListener('keydown', handleKeyPress);
  } catch (err) {
    console.error('LcStudy bootstrap failed', err);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  void bootstrap();
}
