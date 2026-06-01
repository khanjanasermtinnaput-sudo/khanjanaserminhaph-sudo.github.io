const RANKS_DATA_RU = {
  bronze:   { color:'#cd7f32', glow:'rgba(205,127,50,0.25)',   icon:'🥉', name:'Bronze' },
  silver:   { color:'#a8b8c8', glow:'rgba(168,184,200,0.25)',  icon:'🥈', name:'Silver' },
  gold:     { color:'#ffd700', glow:'rgba(255,215,0,0.25)',    icon:'🥇', name:'Gold' },
  platinum: { color:'#48d1cc', glow:'rgba(72,209,204,0.25)',   icon:'💎', name:'Platinum' },
  diamond:  { color:'#b044f0', glow:'rgba(176,68,240,0.25)',   icon:'💠', name:'Diamond' },
  master:   { color:'#ff6b35', glow:'rgba(255,107,53,0.25)',   icon:'🔥', name:'Master Player' },
  king:     { color:'#ffd700', glow:'rgba(255,215,0,0.3)',     icon:'👑', name:'King of Badminton' },
};

function checkAndShowRankUp(playerOldPts, playerNewPts, playerName, gainPts) {
  const oldRank = getRankByPts(playerOldPts);
  const newRank = getRankByPts(playerNewPts);
  const rankOrder = ['bronze','silver','gold','platinum','diamond','master','king'];
  // Resolve effective old rank (getRankByPts skips king, so check manually)
  let effectiveOldRankId = oldRank.id;
  if (oldRank.id === 'master' && playerOldPts >= 3000) {
    const sorted = [...db.players].sort((a, b) => b.pts - a.pts);
    if (sorted[0] && sorted[0].name === playerName) effectiveOldRankId = 'king';
  }
  // Resolve effective new rank
  let effectiveNewRankId = newRank.id;
  if (newRank.id === 'master' && playerNewPts >= 3000) {
    const sorted = [...db.players].sort((a, b) => b.pts - a.pts);
    if (sorted[0] && sorted[0].name === playerName) effectiveNewRankId = 'king';
  }
  const oldIdx = rankOrder.indexOf(effectiveOldRankId);
  const newIdx = rankOrder.indexOf(effectiveNewRankId);
  if (newIdx > oldIdx) {
    const rc = RANKS_DATA_RU[effectiveNewRankId];
    if (rc) showRankUp(rc, playerName, gainPts);
  }
  // Refresh baseline so cross-device check on next loadAll doesn't re-trigger
  if (currentUser && currentUser.name === playerName) {
    localStorage.setItem(`badminton_lastpts_${currentUser.id}`, String(playerNewPts));
  }
}

// คิวสำหรับแสดง rank-up ทีละคน (กรณี doubles มีหลายคน rank up พร้อมกัน)
let _ruQueue = [];
let _ruShowing = false;

function showRankUp(rc, playerName, gainPts) {
  const rankId = Object.keys(RANKS_DATA_RU).find(k => RANKS_DATA_RU[k] === rc) || '';
  _ruQueue.push({ rc, playerName, gainPts, rankId });
  // Self-heal: if _ruShowing is stuck true but no overlay actually visible, reset
  if (_ruShowing) {
    const ru = document.getElementById('rankUpOverlay');
    const kru = document.getElementById('kingRankUpOverlay');
    const visible = (ru && ru.classList.contains('ru-show')) || (kru && kru.classList.contains('kru-show'));
    if (!visible) _ruShowing = false;
  }
  if (!_ruShowing) _processRuQueue();
}

function _processRuQueue() {
  if (_ruQueue.length === 0) { _ruShowing = false; return; }
  _ruShowing = true;
  const item = _ruQueue.shift();
  _ruCurrentRankId = item.rankId || '';
  if (item.rankId === 'king') _showKingRankUp(item);
  else _showStandardRankUp(item);
}

function _showStandardRankUp({ rc, playerName, gainPts }) {
  const overlay = document.getElementById('rankUpOverlay');
  const bgGlow  = document.getElementById('ruBgGlow');
  overlay.style.setProperty('--ru-color', rc.color);
  bgGlow.style.background = `radial-gradient(ellipse 60% 60% at 50% 50%, ${rc.glow} 0%, transparent 70%)`;
  const center = document.querySelector('.ru-center');
  const newCenter = center.cloneNode(true);
  center.parentNode.replaceChild(newCenter, center);
  newCenter.querySelector('#ruIcon').textContent = rc.icon;
  newCenter.querySelector('#ruRankName').textContent = rc.name;
  newCenter.querySelector('#ruPlayerName').textContent = playerName;
  newCenter.querySelector('#ruPts').innerHTML = `+<span>${gainPts}</span> คะแนน`;
  ruSpawnParticles(rc.color);
  overlay.classList.add('ru-show');
  document.body.dataset.ruLock = '1';
  document.body.style.overflow = 'hidden';
}

let _kruSparkleStop = null;

function _showKingRankUp({ playerName, gainPts }) {
  const overlay = document.getElementById('kingRankUpOverlay');
  // Stop any running sparkle from previous show
  if (_kruSparkleStop) { _kruSparkleStop(); _kruSparkleStop = null; }
  // Clone entire overlay to reset ALL CSS animations (mirrors demo approach)
  const fresh = overlay.cloneNode(true);
  fresh.querySelector('#kruBeams').innerHTML = '';
  fresh.querySelector('#kruEmbers').innerHTML = '';
  overlay.parentNode.replaceChild(fresh, overlay);
  // Set dynamic content
  fresh.querySelector('#kruPlayerName').textContent = playerName;
  fresh.querySelector('#kruPts').innerHTML = `+<span>${gainPts}</span> คะแนน`;
  // Set crown image src
  const crownImg = fresh.querySelector('#kruCrownImg');
  if (crownImg && typeof CROWN_SRC !== 'undefined') crownImg.src = CROWN_SRC;
  // Spawn beams + embers into the fresh clone
  kruSpawnBeams(fresh.querySelector('#kruBeams'));
  kruSpawnEmbers(fresh.querySelector('#kruEmbers'));
  fresh.classList.add('kru-show');
  document.body.dataset.ruLock = '1';
  document.body.style.overflow = 'hidden';
  // Init sparkle canvas after overlay is visible
  const crownCanvas = fresh.querySelector('#kruCrownCanvas');
  if (crownCanvas && typeof initCrownSparkle === 'function') {
    requestAnimationFrame(() => { _kruSparkleStop = initCrownSparkle(crownCanvas, 340, 340); });
  }
}

function closeRankUp() {
  const overlay = document.getElementById('rankUpOverlay');
  overlay.style.transition = 'opacity 0.4s ease';
  overlay.style.opacity = '0';
  setTimeout(() => {
    overlay.classList.remove('ru-show');
    overlay.style.opacity = '';
    overlay.style.transition = '';
    document.getElementById('ruParticles').innerHTML = '';
    delete document.body.dataset.ruLock;
    if (!document.body.dataset.ppLock && !document.body.dataset.refLock) {
      document.body.style.overflow = '';
    }
    setTimeout(_processRuQueue, 200);
  }, 400);
}

function closeKingRankUp() {
  if (_kruSparkleStop) { _kruSparkleStop(); _kruSparkleStop = null; }
  const overlay = document.getElementById('kingRankUpOverlay');
  overlay.style.transition = 'opacity 0.4s ease';
  overlay.style.opacity = '0';
  setTimeout(() => {
    overlay.classList.remove('kru-show');
    overlay.style.opacity = '';
    overlay.style.transition = '';
    const b = overlay.querySelector('#kruBeams'); if (b) b.innerHTML = '';
    const e = overlay.querySelector('#kruEmbers'); if (e) e.innerHTML = '';
    delete document.body.dataset.ruLock;
    if (!document.body.dataset.ppLock && !document.body.dataset.refLock) {
      document.body.style.overflow = '';
    }
    setTimeout(_processRuQueue, 200);
  }, 400);
}

function kruSpawnBeams(container) {
  container = container || document.getElementById('kruBeams');
  if (!container) return;
  container.innerHTML = '';
  const count = 6;
  for (let i = 0; i < count; i++) {
    const beam = document.createElement('div');
    beam.className = 'kru-beam';
    const offset = (i - (count-1)/2) * 60;
    const dur = 0.7 + Math.random() * 0.5;
    const del = 0.85 + Math.random() * 0.3;
    const width = 2 + Math.random() * 2;
    beam.style.cssText = `transform:translateX(${offset}px);animation-duration:${dur}s;animation-delay:${del}s;width:${width}px;`;
    container.appendChild(beam);
  }
}

function kruSpawnEmbers(container) {
  container = container || document.getElementById('kruEmbers');
  if (!container) return;
  container.innerHTML = '';
  const count = 40;
  for (let i = 0; i < count; i++) {
    const e = document.createElement('div');
    e.className = 'kru-ember';
    const x = Math.random() * 100;
    const size = 2 + Math.random() * 4;
    const dur = 4 + Math.random() * 4;
    const del = 1.0 + Math.random() * 4;
    const drift = (Math.random() - 0.5) * 80;
    e.style.cssText = `left:${x}%;bottom:-10px;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${del}s;--drift:${drift}px;`;
    container.appendChild(e);
  }
}

function ruSpawnParticles(color) {
  const container = document.getElementById('ruParticles');
  container.innerHTML = '';
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const count = _ruCurrentRankId === 'king' ? 90 : _ruCurrentRankId === 'master' ? 70 : 50;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'ru-particle';
    const size  = 4 + Math.random() * 8;
    const angle = Math.random() * Math.PI * 2;
    const dist  = 80 + Math.random() * 280;
    const tx    = Math.cos(angle) * dist;
    const ty    = Math.sin(angle) * dist - 60;
    const dur   = 1.2 + Math.random() * 1.2;
    const delay = Math.random() * 0.5;
    const bg    = Math.random() > 0.4 ? color : (Math.random() > 0.5 ? '#fff' : '#ffd700');
    p.style.cssText = `width:${size}px;height:${size}px;background:${bg};left:${cx}px;top:${cy}px;--tx:${tx}px;--ty:${ty}px;--dur:${dur}s;animation-delay:${delay}s;`;
    container.appendChild(p);
  }
}

let _ruCurrentRankId = '';

/* ══════════════════════════════════════════════════
   v4.0 FINAL — 14 FEATURES
══════════════════════════════════════════════════ */

// ── 1. ELO x2 Mode ──────────────────────────────
let eloX2Active = localStorage.getItem('badminton_elo_x2') === '1';
(function(){
  const b=document.getElementById('eloX2Banner');
  if(b&&eloX2Active){ b.classList.add('active'); document.body.classList.add('x2-active'); }
})();

function toggleEloX2(on) {
  eloX2Active = on;
  localStorage.setItem('badminton_elo_x2', on ? '1' : '0');
  const b = document.getElementById('eloX2Banner');
  if (b) b.classList.toggle('active', on);
  document.body.classList.toggle('x2-active', on);
  const btn = document.getElementById('eloX2Toggle');
  if (btn) { btn.textContent = on ? '⚡ เปิดอยู่' : 'ปิดอยู่'; btn.className = 'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost'); }
  toast(on ? '⚡ ELO x2 เปิดแล้ว! คะแนนคูณ 2 ทุกแมตช์' : 'ELO x2 ปิดแล้ว', 'info');
}

const _calcEloBase = calcElo;
calcElo = function(a,b,c,d,e,f) {
  const r = _calcEloBase(a,b,c,d,e,f);
  return eloX2Active ? { gain: r.gain * 2, loss: r.loss } : r;
};

// ── 2. Match Timer ───────────────────────────────
let _timerIv = null, _timerStart = 0;

function startMatchTimer() {
  clearInterval(_timerIv);
  _timerStart = Date.now();
  const el = document.getElementById('matchTimerDisplay');
  if (el) { el.style.display = ''; el.textContent = '00:00'; }
  _timerIv = setInterval(() => {
    const s = Math.floor((Date.now() - _timerStart) / 1000);
    const el2 = document.getElementById('matchTimerDisplay');
    if (el2) el2.textContent = String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
  }, 1000);
}

function stopMatchTimer() {
  clearInterval(_timerIv);
  const el = document.getElementById('matchTimerDisplay');
  if (el) el.style.display = 'none';
}

const _selectModeBase = selectPlayMode;
selectPlayMode = function(m) { _selectModeBase(m); startMatchTimer(); };

const _cancelMatchBase = cancelMatch;
cancelMatch = function() { stopMatchTimer(); _cancelMatchBase(); };

// ── 9. ELO x2 Banner + Admin toggle ─────────────
const _renderAdminBase = renderAdmin;
renderAdmin = async function() {
  await _renderAdminBase();
  if (!isAdminUser() || document.getElementById('eloX2Section')) return;
  const main = document.querySelector('#adminSection main');
  if (!main) return;
  const div = document.createElement('div');
  div.id = 'eloX2Section';
  div.className = 'card';
  div.style.cssText = 'border-color:rgba(255,150,0,.35);background:rgba(255,150,0,.05)';
  div.innerHTML = `<div class="card-title" style="color:#ff9f43">⚡ ELO x2 Mode</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="font-size:.83rem;color:var(--muted)">เปิดโหมดคูณ ELO ×2 สำหรับ Event พิเศษ</div>
      <button id="eloX2Toggle" class="btn btn-sm ${eloX2Active?'btn-primary':'btn-ghost'}" style="white-space:nowrap;width:auto" onclick="toggleEloX2(!eloX2Active)">${eloX2Active?'⚡ เปิดอยู่':'ปิดอยู่'}</button>
    </div>`;
  main.insertBefore(div, main.firstChild);
};

// ── 8. Live Match Table ──────────────────────────
async function renderLiveTbl() {
  const sec = document.getElementById('liveMatchSection');
  const lst = document.getElementById('liveMatchList');
  if (!sec || !lst) return;
  try {
    const pend = await dbGetPending();
    if (!pend || !pend.length) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    lst.innerHTML = pend.slice(0,5).map(m => {
      const ta = formatTeamNames(m.team_a||[]);
      const tb = formatTeamNames(m.team_b||[]);
      return `<div class="live-match-item">
        <div class="live-dot"></div>
        <div style="flex:1;font-size:.82rem"><b>${ta}</b><span style="color:var(--muted)"> vs </span><b>${tb}</b></div>
        <div style="font-family:'Rajdhani';color:var(--neon);font-weight:700">${m.score_a}-${m.score_b}</div>
        <span style="font-size:.68rem;color:var(--muted)">${m.type==='doubles'?'👥':'👤'}</span>
      </div>`;
    }).join('');
  } catch(e) { sec.style.display = 'none'; }
}

