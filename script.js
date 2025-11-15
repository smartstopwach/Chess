/* ===== script.js =====
   Voice Chess with Stockfish (worker), chess.js, chessboard.js
   - No external PNGs: pieceTheme returns data-URI SVGs
   - SpeechRecognition (English + Hindi friendly)
   - SpeechSynthesis for AI replies
   - Stockfish worker via CDN (STOCKFISH_WORKER_URL defined in index.html)
*/

// ----- Helpers / Globals -----
const game = new Chess();
let board = null;
let engine = null;
let engineReady = false;
let thinking = false;
let engineId = 0;
let useStockfish = true;
let voiceOutput = true;

// small logger
function log(msg){
  const el = document.getElementById('log');
  const ts = new Date().toLocaleTimeString();
  el.innerHTML = `[${ts}] ${msg}<br>` + el.innerHTML;
}

// ----- SVG pieces generator (returns data URI) -----
// We draw minimal elegant SVG icons (letter + circle) so no PNG required.
function pieceSvgDataURI(piece, isWhite){
  // piece: 'wP','bK' etc coming from chessboard naming; but we'll map manually below
  // pieceName: p,n,b,r,q,k
  const color = isWhite ? '#f7fdfd' : '#001219';
  const fg = isWhite ? '#001a1f' : '#9ff7ff';
  const circle = isWhite ? '#00d4ff20' : '#00eaff10';
  // Determine letter
  const letterMap = {p:'♟', n:'♞', b:'♝', r:'♜', q:'♛', k:'♚'};
  // detect type from string (e.g., 'wN' or 'bq')
  const t = piece.slice(-1).toLowerCase();
  const glyph = letterMap[t] || '?';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
    <rect width='100%' height='100%' rx='18' ry='18' fill='${isWhite? "#002a33" : "#022b34"}' opacity='0.0'/>
    <g transform='translate(80,80)'>
      <circle r='56' fill='${circle}' />
      <text x='0' y='18' font-size='56' text-anchor='middle' fill='${fg}' font-family='Segoe UI Symbol, "Noto Color Emoji", "Apple Color Emoji", Arial'>${glyph}</text>
    </g>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// pieceTheme function for chessboard.js
function pieceTheme(piece){
  // chessboard uses 'wP', 'bK' etc names sometimes; but accepts file path function
  const isWhite = piece[0] === 'w' || piece[0] === 'W';
  return pieceSvgDataURI(piece, isWhite);
}

// ----- Initialize Board -----
const cfg = {
  draggable: true,
  position: 'start',
  pieceTheme: pieceTheme,
  onDrop: onDrop,
  onSnapEnd: () => board.position(game.fen())
};
board = Chessboard('board', cfg);

// update UI elements
function refreshUI(){
  board.position(game.fen());
  document.getElementById('moves').textContent = game.history().join(' ');
  document.getElementById('turn').textContent = game.turn() === 'w' ? 'White' : 'Black';
  if (game.game_over()){
    if (game.in_checkmate()) status('Checkmate! ' + (game.turn()==='w' ? 'Black' : 'White') + ' wins');
    else if (game.in_draw()) status('Draw');
    else status('Game over');
  }
}

function status(s){
  document.getElementById('status').textContent = s;
}

// on piece drop (drag)
function onDrop(source, target){
  const move = game.move({from: source, to: target, promotion: 'q'});
  if (move === null) return 'snapback';
  refreshUI();
  log('Player: ' + move.san);
  if (useStockfish) askEngineForMove(); else setTimeout(randomAiMove, 300);
}

// random fallback AI
function randomAiMove(){
  if (game.game_over()) return;
  const m = game.moves();
  const play = m[Math.floor(Math.random()*m.length)];
  game.move(play);
  refreshUI();
  log('AI played (random): ' + play);
  if (voiceOutput) speak("AI played " + sanToSpoken(play));
}

// ----- Speech synthesis -----
function speak(text, lang='en-IN'){
  if (!voiceOutput) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1;
  window.speechSynthesis.cancel(); // cancel pending
  window.speechSynthesis.speak(u);
}

// convert SAN like "Nf3" or "exd5" to spoken phrase
function sanToSpoken(san){
  return san
    .replace(/N/g,'Knight ')
    .replace(/B/g,'Bishop ')
    .replace(/R/g,'Rook ')
    .replace(/Q/g,'Queen ')
    .replace(/K/g,'King ')
    .replace(/x/g,' takes ')
    .replace(/\+/g,' check')
    .replace(/#/g,' checkmate')
    .replace(/([a-h])([1-8])/g, (m, f, r)=> f.toUpperCase()+r);
}

// ----- Stockfish engine integration (Worker) -----
function initEngine(){
  try {
    // instantiate worker from CDN path
    engine = new Worker(STOCKFISH_WORKER_URL);
  } catch (e){
    log('Failed to spawn Stockfish worker from CDN; make sure CDN allowed loading as worker. Falling back to no Stockfish.');
    useStockfish = false;
    document.getElementById('stockfishToggle').checked = false;
    return;
  }

  engine.onmessage = function(e){
    const line = e.data ? e.data : e;
    // some builds send objects; we handle strings.
    if (typeof line !== 'string') return;
    // log engine messages sparingly
    // console.log('[engine] ', line);
    if (line === 'uciok') {
      engineReady = true;
      log('Engine ready');
      return;
    }
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const best = parts[1];
      if (best && best !== '(none)') {
        applyEngineMove(best);
      } else {
        log('Engine did not return move: ' + line);
      }
      thinking = false;
      return;
    }
    // optional: handle 'info' lines for thinking output
  };

  // initialize UCI
  engine.postMessage('uci');
  engine.postMessage('isready');
  engineReady = false;
  thinking = false;
}

// ask engine to compute bestmove
function askEngineForMove(depth = 12){
  if (!engine || !useStockfish) { randomAiMove(); return; }
  if (!engineReady) {
    // still warming; try random fallback
    log('Engine not ready yet; playing random move');
    randomAiMove();
    return;
  }
  // send current position
  const fen = game.fen();
  engine.postMessage('position fen ' + fen);
  engine.postMessage('go depth ' + depth);
  thinking = true;
  log('Engine thinking (depth ' + depth + ')...');
}

// apply UCI move like e2e4 or g1f3
function applyEngineMove(uci){
  // uci: from+to(+promotion)
  const from = uci.substring(0,2);
  const to = uci.substring(2,4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const moveObj = { from, to };
  if (promotion) moveObj.promotion = promotion;
  const mv = game.move(moveObj);
  if (mv){
    refreshUI();
    log('Engine plays: ' + mv.san);
    if (voiceOutput) speak('AI played ' + sanToSpoken(mv.san));
  } else {
    log('Engine suggested illegal move: ' + uci);
  }
}

// ----- SpeechRecognition (voice in) -----
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
if (SpeechRec){
  recognizer = new SpeechRec();
  recognizer.continuous = false;
  recognizer.interimResults = false;
  // We set language to en-IN; Hindi/English mixed often recognized decently
  recognizer.lang = 'en-IN';
  recognizer.onstart = () => { status('Listening...'); log('Microphone on'); };
  recognizer.onerror = (e) => { log('Speech error: ' + (e.error||'unknown')); status('Speech error'); };
  recognizer.onend = () => { status('Idle'); log('Microphone off'); };
  recognizer.onresult = (e) => {
    const txt = e.results[0][0].transcript.trim();
    document.getElementById('heard').innerText = txt;
    log('Heard: ' + txt);
    interpretSpeech(txt);
  };
} else {
  log('SpeechRecognition not supported in this browser (use Chrome).');
  document.getElementById('listenBtn').disabled = true;
}

// Start / stop buttons
document.getElementById('listenBtn').onclick = () => {
  if (!recognizer) return alert('SpeechRecognition not available — use Chrome on desktop/mobile.');
  recognizer.start();
};
document.getElementById('stopBtn').onclick = () => { if (recognizer) recognizer.stop(); };

// New game / undo
document.getElementById('newBtn').onclick = () => {
  game.reset(); board.start(); refreshUI(); log('New game'); speak('New game started');
};
document.getElementById('undoBtn').onclick = () => {
  game.undo(); refreshUI(); log('Undo'); speak('Move undone');
};

// toggles
document.getElementById('stockfishToggle').onchange = (e) => {
  useStockfish = e.target.checked;
  log('Stockfish ' + (useStockfish ? 'enabled':'disabled'));
  if (useStockfish && !engine) initEngine();
};
document.getElementById('voiceToggle').onchange = (e) => {
  voiceOutput = e.target.checked;
  log('Voice output ' + (voiceOutput ? 'on':'off'));
};

// ----- Interpret speech into moves -----
function normalizeSpeech(raw){
  let s = raw.toLowerCase();
  // hindi "se" -> "to"
  s = s.replace(/\bse\b/g,' to ');
  s = s.replace(/\bse\b/g,' to ');
  // number words to digits (one..eight)
  const map = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8 };
  for (const [k,v] of Object.entries(map)) s = s.replace(new RegExp('\\b'+k+'\\b','g'), v);
  // remove filler words
  s = s.replace(/\bsquare\b|\bsqaure\b|\bat\b|\bplease\b|\bmove\b/g,' ');
  s = s.replace(/[^\w\s\-x#]/g,' '); // keep letters numbers x - #
  s = s.replace(/\s+/g,' ').trim();
  return s;
}

function interpretSpeech(raw){
  const s = normalizeSpeech(raw);
  // commands
  if (s.includes('new game') || s.includes('restart') || s.includes('start new')){ game.reset(); board.start(); refreshUI(); speak('New game started'); return; }
  if (s.includes('undo') || s.includes('wapis')){ game.undo(); refreshUI(); speak('Undo'); return; }
  if (s.includes('resign')){ status('Resigned'); speak('You resigned'); return; }
  if (s.includes('castle')) {
    const moves = game.moves();
    if (s.includes('queen') || s.includes('long')) {
      if (moves.includes('O-O-O')) { game.move('O-O-O'); refreshUI(); speak('Castle long'); if (useStockfish) askEngineForMove(); return; }
    } else {
      if (moves.includes('O-O')) { game.move('O-O'); refreshUI(); speak('Castle short'); if (useStockfish) askEngineForMove(); return; }
    }
  }

  // find squares like e2 e4
  const sq = s.match(/[a-h][1-8]/g);
  if (sq && sq.length >= 2){
    const from = sq[0];
    const to = sq[1];
    const move = game.move({from, to, promotion:'q'});
    if (move){ refreshUI(); speak('You played ' + sanToSpoken(move.san)); log('Player: ' + move.san); if (useStockfish) askEngineForMove(); else setTimeout(randomAiMove,300); return; }
    else { status('Illegal move: ' + from + to); speak('Illegal move'); return; }
  }

  // try piece name + square e.g., knight f3 or ghati
  const pieceRegex = /(king|queen|bishop|rook|knight|pawn)\s*([a-h][1-8])/;
  const pr = s.match(pieceRegex);
  if (pr){
    const piece = pr[1], to = pr[2];
    const pmap = {king:'k',queen:'q',bishop:'b',rook:'r',knight:'n',pawn:'p'};
    const matches = game.moves({verbose:true}).filter(m => m.to === to && m.piece === pmap[piece]);
    if (matches.length === 1){ game.move(matches[0].san); refreshUI(); speak('You played ' + sanToSpoken(matches[0].san)); if (useStockfish) askEngineForMove(); return; }
    if (matches.length > 1){ game.move(matches[0].san); refreshUI(); speak('Played ' + sanToSpoken(matches[0].san)); if (useStockfish) askEngineForMove(); return; }
  }

  // try SAN matching against legal moves
  const legal = game.moves();
  const cleaned = s.replace(/\s+/g,'');
  for (const m of legal){
    const mclean = m.toLowerCase().replace(/\+/g,'').replace(/#/g,'').replace(/\s+/g,'');
    if (mclean === cleaned || cleaned.includes(mclean) || mclean.includes(cleaned)){
      game.move(m);
      refreshUI();
      speak('You played ' + sanToSpoken(m));
      if (useStockfish) askEngineForMove();
      return;
    }
  }

  status('Could not parse: "'+raw+'"');
  speak('I did not understand. Try: E2 to E4 or Knight f3.');
}

// ----- Init -----
refreshUI();
log('Voice Chess loaded.');

// initialize engine if toggled
if (document.getElementById('stockfishToggle').checked) initEngine();

// quick startup hint
log('Say examples: "E2 to E4", "Knight f3", "Pawn takes d5", "castle king side", "New game", "Undo".');
