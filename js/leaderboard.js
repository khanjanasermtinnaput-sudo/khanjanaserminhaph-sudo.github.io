async function renderLeaderboard() {
  try {
    await loadAll();
    checkSelfRankUpFromDB();
    checkKingChange();
    const sorted = [...db.players].sort((a,b) => b.pts - a.pts);
    if (!sorted.length) return;
    lbPrevRanks = JSON.parse(localStorage.getItem('badminton_rank_snapshot') || '{}');
    const _curSnap = {}; sorted.forEach((p,i) => { _curSnap[p.id] = i+1; }); localStorage.setItem('badminton_rank_snapshot', JSON.stringify(_curSnap));

    // ── STAT CARDS ──
    const totalMatches = db.matches.length;
    let bestWR = 0, bestWRName = '—';
    sorted.forEach(p => {
      const total = p.wins + p.losses;
      if (total >= 3) {
        const wr = Math.round(p.wins / total * 100);
        if (wr > bestWR) { bestWR = wr; bestWRName = p.name; }
      }
    });
    lbCountUp('lbStatPlayers', sorted.length, 900);
    lbCountUp('lbStatMatches', totalMatches, 900);
    document.getElementById('lbStatWR').textContent = bestWR + '%';
    document.getElementById('lbStatWRName').textContent = bestWRName;

    // ── PODIUM TOP 3 ──
    const top3 = sorted.slice(0, 3);
    // order: 2nd | 1st | 3rd
    const podOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
    const podClasses = top3[1] ? ['lbr2','lbr1','lbr3'] : ['lbr1','lbr3'];
    const podRankLabel = ['อันดับ 2','อันดับ 1','อันดับ 3'];
    const podRankClass = ['lbsilv','lbgold','lbbrnz'];
    const podColors = [[220,175,55],[155,165,180],[185,135,85]]; // gold, silver, bronze particles

    const podHTML = podOrder.map((p, i) => {
      if (!p) return '';
      const cls = podClasses[i];
      const isFirst = cls === 'lbr1';
      const colors = getAvatarColor(p.id);
      const av = getAvatar(p.id, p.name);
      const wr = p.wins + p.losses > 0 ? Math.round(p.wins / (p.wins + p.losses) * 100) : 0;
      const canvasId = `lbpc${i}`;
      const isSE = isFirst && (_resolveFrameKey(p.gachaFrame) === 'solaremperor');
      return `<div class="lb-pc lb-glass ${cls}${isSE ? ' lb-king-throne' : ''}" style="animation-delay:${i*.12+.28}s" onclick="openPlayerProfile(${p.id})">
        <canvas class="lb-pod-canvas" id="${canvasId}"></canvas>
        <div class="lb-pod-shim"></div>
        ${isFirst ? '<div class="lb-crown">👑</div>' : ''}
        <div class="lb-pod-rank ${podRankClass[i]}">${podRankLabel[i]}</div>
        <div class="lb-pod-av ${getGachaFrameClass(p)}" style="background:${av.bg};color:${av.fg};${av.fs?'font-size:'+av.fs:''}">${getGachaFrameInner(p)}${av.content}</div>
        <div class="lb-pod-name ${getGachaNameClass(p)}">${p.name}</div>
        <div class="lb-pod-score" id="lbpscore${p.id}">${p.pts.toLocaleString()}</div>
        <div class="lb-pod-wins">ชนะ ${p.wins} · แพ้ ${p.losses} · ${wr}%</div>
      </div>`;
    }).join('');
    document.getElementById('lbPodium').innerHTML = podHTML;

    // animate podium cards
    requestAnimationFrame(() => {
      const isLite = document.documentElement.getAttribute('data-style') === 'lite';
      document.querySelectorAll('.lb-pc').forEach((el,i) => {
        if (isLite) { el.classList.add('lbvis'); el.style.opacity='1'; el.style.transform='none'; }
        else setTimeout(() => el.classList.add('lbvis'), i*120+100);
      });
      // particle canvases – skip in lite
      if (!isLite) podOrder.forEach((p,i) => { if(p) lbParticles(`lbpc${i}`, ...podColors[i]); });
    });

    // ── BOARD (rank 4+) ──
    lbAllPlayers = sorted;
    lbRenderBoard(sorted);

  } catch(e) { console.error('renderLeaderboard error:', e); }
}

let lbAllPlayers = [];
let lbPrevRanks = {};
function lbFilterBoard(q) {
  const filtered = q ? lbAllPlayers.filter(p => p.name.toLowerCase().includes(q.toLowerCase())) : lbAllPlayers;
  lbRenderBoard(filtered, false);
}

// คืน HTML badge สำหรับแถวใน Leaderboard
// ระบบ "ติก = โชว์": ติกใน Profile → โชว์ทั้ง Leaderboard และ Profile, ไม่ติก → ไม่โชว์
function getPlayerLBBadges(p) {
  const pinnedAchs = p.pinnedAchs; // null = ไม่เคยตั้งค่า (โชว์ทุก customAch ที่มี), array = ตั้งค่าแล้ว
  if (pinnedAchs === null || pinnedAchs === undefined) {
    // ยังไม่เคยตั้งค่า → โชว์ customAch ทั้งหมด (default)
    return (p.customAch || []).map(a =>
      `<span class="cach-badge cach-frame-${a.frame||'gold'}" style="font-size:0.6rem;padding:2px 7px;line-height:1.3">${a.icon||'🏆'} ${a.title}</span>`
    ).join('');
  }
  // ตั้งค่าแล้ว: รวม built-in + customAch แล้วโชว์เฉพาะที่ติก (pinned)
  const allDefs = (typeof ACHIEVEMENTS_DEF !== 'undefined' && typeof TOURNAMENT_ACHIEVEMENTS_DEF !== 'undefined')
    ? [...ACHIEVEMENTS_DEF, ...TOURNAMENT_ACHIEVEMENTS_DEF] : [];
  const seenIds = new Set();
  const allAchs = [];
  // Built-in ที่ unlock แล้ว
  allDefs.forEach(a => {
    if (seenIds.has(a.id)) return;
    try { if (a.check(p, db.players, db.matches)) { allAchs.push({ id: a.id, icon: a.icon, title: a.title, color: a.color, frame: null }); seenIds.add(a.id); } } catch(e) {}
  });
  // customAch (admin-awarded)
  (p.customAch || []).forEach(a => {
    if (seenIds.has(a.id)) return;
    allAchs.push({ id: a.id, icon: a.icon || '🏆', title: a.title, frame: a.frame || 'gold' });
    seenIds.add(a.id);
  });
  return allAchs.filter(a => pinnedAchs.includes(a.id)).map(a =>
    `<span class="cach-badge cach-frame-${a.frame||'gold'}" style="font-size:0.6rem;padding:2px 7px;line-height:1.3">${a.icon||'🏆'} ${a.title}</span>`
  ).join('');
}

function lbRenderBoard(data, animate = true) {
  const bl = document.getElementById('lbBoardList');
  bl.innerHTML = '';
  const sorted = [...lbAllPlayers].sort((a,b) => b.pts - a.pts);
  data.forEach((p, i) => {
    const globalPos = sorted.findIndex(x => x.id === p.id) + 1;
    const isMe = currentUser && p.id === currentUser.id;
    const wp = p.wins + p.losses > 0 ? Math.round(p.wins / (p.wins + p.losses) * 100) : 0;
    const colors = getAvatarColor(p.id);
    const av = getAvatar(p.id, p.name);
    const rank = getRank(p.pts, p.id);
    // rank badge emoji
    const posEmoji = globalPos === 1 ? '🥇' : globalPos === 2 ? '🥈' : globalPos === 3 ? '🥉' : null;
    const posDisplay = posEmoji || globalPos;
    // rank change arrow
    const _prevPos = lbPrevRanks[p.id];
    const _rankDiff = _prevPos ? _prevPos - globalPos : 0;
    const rankArrow = _rankDiff > 0
      ? `<span class="lb-rank-arrow lb-rank-up">▲${_rankDiff}</span>`
      : _rankDiff < 0
      ? `<span class="lb-rank-arrow lb-rank-down">▼${Math.abs(_rankDiff)}</span>`
      : '';
    // trend badge
    const trendBdg = rank.id === 'king' ? '👑' : rank.id === 'master' ? '🔥' : rank.id === 'diamond' ? '💠' : rank.id === 'platinum' ? '💎' : rank.id === 'gold' ? '🥇' : rank.id === 'silver' ? '🥈' : '🥉';

    const isKingThrone = (globalPos === 1 && rank.id === 'king');
    const row = document.createElement('div');
    row.className = `lb-br lb-glass${isMe ? ' lbme' : ''}${isKingThrone ? ' lb-king-throne' : ''}`;
    row.style.animationDelay = (i * .06) + 's';
    row.innerHTML = `
      <div class="lb-rrank">${posDisplay}${rankArrow}</div>
      <div class="lb-rplyr">
        <div style="position:relative;flex-shrink:0">
          <div class="lb-rav ${getGachaFrameClass(p)}" style="background:${av.bg};color:${av.fg};${av.fs?'font-size:'+av.fs:''}">${getGachaFrameInner(p)}${av.content}</div>
          ${rank.id==='king'&&_resolveFrameKey(p.gachaFrame)!=='solaremperor'?'<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);font-size:0.85rem;z-index:5;filter:drop-shadow(0 1px 4px rgba(255,215,0,0.9));animation:kingCrownFloat 2.2s ease-in-out infinite;pointer-events:none">👑</div>':''}
        </div>
        <div>
          <div class="lb-rn${rank.id==='king'?' lb-rn-king':''} ${getGachaNameClass(p)}">${p.name}${isMe ? ` <span style="color:var(--neon);font-size:0.7rem">${t('me')}</span>` : ''}</div>
          <div class="lb-rh" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px"><span class="rank-badge ${rank.class}" style="font-size:0.65rem;padding:1px 6px">${getRankLabel(p.pts,p.id)}</span>${getPlayerLBBadges(p)}</div>
        </div>
      </div>
      <div class="lb-rst"><span class="lb-pts-val">${p.pts.toLocaleString()}</span><small>${t('pts_col')}</small></div>
      <div class="lb-rst">${p.wins}/${p.losses}<small>${t('wl_col')}</small></div>
      <div class="lb-rst">${wp}%<small>Win rate</small></div>
      <div class="lb-rbadge"><div class="lb-bdg">${trendBdg}</div></div>
    `;
    row.addEventListener('click', e => {
      lbAddRipple(row, e);
      setTimeout(() => openPlayerProfile(p.id), 120);
    });
    bl.appendChild(row);
    const isLite = document.documentElement.getAttribute('data-style') === 'lite';
    if (animate && !isLite) {
      setTimeout(() => {
        row.classList.add('lbvis');
        if (isKingThrone) { row.style.opacity = '1'; row.style.transform = 'none'; }
      }, i * 60 + 80);
    } else {
      row.classList.add('lbvis');
      row.style.opacity = '1'; row.style.transform = 'none';
    }
  });
}

function lbAddRipple(el, e) {
  const r = el.getBoundingClientRect(), sz = Math.max(r.width, r.height);
  const rp = document.createElement('span'); rp.className = 'lb-rpl';
  rp.style.cssText = `width:${sz}px;height:${sz}px;left:${e.clientX-r.left-sz/2}px;top:${e.clientY-r.top-sz/2}px;`;
  el.appendChild(rp); setTimeout(() => rp.remove(), 620);
}

function lbCountUp(elId, target, dur = 1000) {
  const el = document.getElementById(elId); if (!el) return;
  if (document.documentElement.getAttribute('data-style') === 'lite') { el.textContent = target.toLocaleString(); return; }
  const s = performance.now();
  const step = ts => {
    const p = Math.min((ts - s) / dur, 1);
    const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    el.textContent = Math.floor(e * target).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString();
  };
  requestAnimationFrame(step);
}

function lbParticles(id, r, g, b) {
  const c = document.getElementById(id); if (!c) return;
  const ctx = c.getContext('2d'); let ps = [], W, H;
  function resize() { const rc = c.parentElement.getBoundingClientRect(); W = c.width = rc.width; H = c.height = rc.height; }
  resize(); new ResizeObserver(resize).observe(c.parentElement);
  function mk() { return { x: Math.random()*W, y: H+8, r: Math.random()*2.4+.7, sp: Math.random()*.7+.28, a: Math.random()*.45+.15, wb: Math.random()*Math.PI*2, ws: (Math.random()-.5)*.045 }; }
  for (let i = 0; i < 18; i++) { const p = mk(); p.y = Math.random()*H; ps.push(p); }
  function loop() {
    ctx.clearRect(0,0,W,H);
    ps.forEach((p,i) => {
      p.y -= p.sp; p.wb += p.ws; p.x += Math.sin(p.wb)*.45;
      p.a += (Math.random()-.5)*.022; p.a = Math.max(.04, Math.min(.72, p.a));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(${r},${g},${b},${p.a.toFixed(2)})`; ctx.fill();
      if (p.y < -10) ps[i] = mk();
    });
    requestAnimationFrame(loop);
  }
  loop();
}

function renderMatchSetup() {
  const opts = db.players.map(p => `<option value="${p.id}">${p.name} (${p.pts}pts)</option>`).join('');
  document.getElementById('singleA').innerHTML = `<option value="">${t('select_ph')}</option>` + opts;
  document.getElementById('singleB').innerHTML = `<option value="">${t('select_ph')}</option>` + opts;
}
function renderDoublesPlayers() {
  const html = db.players.map(p => { const rank = getRank(p.pts, p.id); return `<div class="pl-item" id="dp_${p.id}"><div class="pl-check" id="chk_${p.id}" onclick="toggleDoubles(${p.id})"></div><div class="pl-name"><span class="${getGachaNameClass(p)}">${p.name}</span> <span class="rank-badge ${rank.class}" style="font-size:0.68rem">${rank.label}</span></div><div class="pl-pts" id="dteam_${p.id}" style="font-size:0.72rem;color:var(--muted)"></div></div>`; }).join('') || `<div class="text-muted">${t('no_players')}</div>`;
  document.getElementById('doublesPlayerList').innerHTML = html;
  window._doublesSelected = { A: [], B: [] };
}
function toggleDoubles(id) {
  const sel = window._doublesSelected || { A: [], B: [] };
  if (sel.A.includes(id)) sel.A = sel.A.filter(x=>x!==id);
  else if (sel.B.includes(id)) sel.B = sel.B.filter(x=>x!==id);
  else if (sel.A.length < 2) sel.A.push(id);
  else if (sel.B.length < 2) sel.B.push(id);
  else { toast(t('max_2'), 'error'); return; }
  window._doublesSelected = sel;
  db.players.forEach(p => {
    const chk = document.getElementById('chk_' + p.id), dteam = document.getElementById('dteam_' + p.id);
    if (!chk) return;
    const inA = sel.A.includes(p.id), inB = sel.B.includes(p.id);
    chk.classList.toggle('checked', inA || inB);
    chk.textContent = inA ? 'A' : inB ? 'B' : '';
    dteam.textContent = inA ? t('team_a') : inB ? t('team_b') : '';
    dteam.style.color = inA ? 'var(--neon)' : inB ? 'var(--red)' : 'var(--muted)';
  });
}
function startSingles() {
  const aId = parseInt(document.getElementById('singleA').value), bId = parseInt(document.getElementById('singleB').value);
  if (!aId || !bId) return toast('เลือกผู้เล่นทั้งสองฝั่ง', 'error');
  if (aId === bId) return toast('เลือกผู้เล่นคนละคน', 'error');
  currentMatch = { type: 'singles', teamA: [db.players.find(p=>p.id===aId)], teamB: [db.players.find(p=>p.id===bId)], scoreA: 0, scoreB: 0 };
  showMatchPlaying();
}
function startDoubles() {
  const sel = window._doublesSelected || { A: [], B: [] };
  if (sel.A.length !== 2 || sel.B.length !== 2) return toast('ต้องเลือกทีมละ 2 คน', 'error');
  currentMatch = { type: 'doubles', teamA: sel.A.map(id => db.players.find(p=>p.id===id)), teamB: sel.B.map(id => db.players.find(p=>p.id===id)), scoreA: 0, scoreB: 0 };
  showMatchPlaying();
}
function showMatchPlaying() {
  // รีเซ็ต sub-panels
  document.getElementById('modePicker').classList.remove('hidden');
  document.getElementById('classicMode').classList.add('hidden');
  // ตั้งชื่อล่วงหน้าสำหรับทั้ง 2 mode
  const _kingSorted = db.players && db.players.length ? [...db.players].sort((a,b)=>b.pts-a.pts) : [];
  const _kingMatchName = _kingSorted[0] && _kingSorted[0].pts >= 3000 ? _kingSorted[0].name : null;
  const _kc = getKingChallenge();
  const _addBadge = n => {
    let s = n;
    if (_kingMatchName && n === _kingMatchName) s = '👑 ' + s;
    if (_kc && n === _kc.name) s = '🤺 ' + s;
    return s;
  };
  const teamHTML = team => team.map(pm => {
    const full = resolveGachaPlayer(pm);
    const cls = getGachaNameClass(full);
    const badged = _addBadge(pm.name);
    return cls ? `<span class="${cls}">${badged}</span>` : badged;
  }).join(' & ');
  const htmlA = teamHTML(currentMatch.teamA), htmlB = teamHTML(currentMatch.teamB);
  document.getElementById('teamAName').innerHTML = htmlA;
  document.getElementById('teamBName').innerHTML = htmlB;
  document.getElementById('refHalfNameA').innerHTML = htmlA;
  document.getElementById('refHalfNameB').innerHTML = htmlB;
  document.getElementById('scoreA').textContent = '0';
  document.getElementById('scoreB').textContent = '0';
  document.getElementById('refHalfScoreA').textContent = '0';
  document.getElementById('refHalfScoreB').textContent = '0';
  document.getElementById('matchPlaying').classList.remove('hidden');
}

function selectPlayMode(mode) {
  document.getElementById('modePicker').classList.add('hidden');
  if (mode === 'classic') {
    document.getElementById('classicMode').classList.remove('hidden');
  } else {
    // เปิด fullscreen overlay
    const overlay = document.getElementById('refOverlay');
    overlay.style.display = 'flex';
    document.body.dataset.refLock = '1';
    document.body.style.overflow = 'hidden';
    // ซ่อน nav และ theme bar เพื่อเต็มจอจริงๆ
    document.getElementById('mainNav').style.display = 'none';
    document.getElementById('themeControls').style.display = 'none';
  }
}

function refAddScore(team, eventOrDelta, _unused) {
  if (!currentMatch) return;
  const delta = (typeof eventOrDelta === 'number') ? eventOrDelta : 1;
  const key = 'score' + team;
  if (delta > 0 && currentMatch._bwfTriggered) return; // กำลังจบเกมอยู่ ห้ามเพิ่ม
  const _next = Math.max(0, (currentMatch[key] || 0) + delta);
  currentMatch[key] = delta > 0 ? Math.min(30, _next) : _next; // cap 30
  // sync ทั้ง classic display และ fullscreen display
  document.getElementById('score' + team).textContent = currentMatch[key];
  document.getElementById('refHalfScore' + team).textContent = currentMatch[key];
  // ripple effect เฉพาะตอนกด + (event object ถูกส่งมา)
  if (delta > 0 && eventOrDelta && eventOrDelta.clientX !== undefined) {
    const btn = document.getElementById('refTap' + team);
    const ripple = document.createElement('span');
    ripple.className = 'ref-ripple';
    const rect = btn.getBoundingClientRect();
    ripple.style.left = (eventOrDelta.clientX - rect.left) + 'px';
    ripple.style.top  = (eventOrDelta.clientY - rect.top) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }
  if (delta > 0) checkBWFWin();
}

function checkBWFWin() {
  if (!currentMatch) return;
  const sA = currentMatch.scoreA, sB = currentMatch.scoreB;
  // ป้องกัน popup ซ้อน
  if (currentMatch._bwfTriggered) return;
  let winner = null;
  if (sA >= 30 || sB >= 30) {
    winner = sA > sB ? 'A' : 'B';
  } else if ((sA >= 21 || sB >= 21) && Math.abs(sA - sB) >= 2) {
    winner = sA > sB ? 'A' : 'B';
  }
  if (winner) {
    currentMatch._bwfTriggered = true;
    const winName = currentMatch['team'+winner].map(p=>p.name).join(' & ');
    toast(`🏆 ${winName} ชนะ! (${sA}-${sB})`, 'success');
    // ปิด referee overlay ทันที ก่อน modal ขึ้น
    closeRefOverlay();
    setTimeout(() => {
      currentMatch._bwfTriggered = false;
      confirmFinish();
    }, 600);
  }
}

function changeScore(team, delta) {
  if (!currentMatch) return;
  if (delta > 0 && currentMatch._bwfTriggered) return; // กำลังจบเกมอยู่ ห้ามเพิ่ม
  const key = 'score' + team;
  const next = Math.max(0, (currentMatch[key] || 0) + delta);
  currentMatch[key] = delta > 0 ? Math.min(30, next) : next; // cap 30
  document.getElementById('score' + team).textContent = currentMatch[key];
  document.getElementById('refHalfScore' + team).textContent = currentMatch[key];
  if (delta > 0) checkBWFWin();
}

function cancelMatch() {
  currentMatch = null;
  // ปิด fullscreen overlay
  document.getElementById('refOverlay').style.display = 'none';
  delete document.body.dataset.refLock;
  if (!document.body.dataset.ruLock && !document.body.dataset.ppLock) document.body.style.overflow = '';
  document.getElementById('mainNav').style.display = '';
  document.getElementById('themeControls').style.display = '';
  // ปิด matchPlaying
  document.getElementById('matchPlaying').classList.add('hidden');
  document.getElementById('modePicker').classList.remove('hidden');
  document.getElementById('classicMode').classList.add('hidden');
  toast('ยกเลิกแมตช์', 'info');
}

function closeRefOverlay() {
  document.getElementById('refOverlay').style.display = 'none';
  delete document.body.dataset.refLock;
  if (!document.body.dataset.ruLock && !document.body.dataset.ppLock) document.body.style.overflow = '';
  document.getElementById('mainNav').style.display = '';
  document.getElementById('themeControls').style.display = '';
}
function confirmFinish() {
  if (!currentMatch) return;
  const sA = currentMatch.scoreA, sB = currentMatch.scoreB;
  if (sA === sB) return toast('คะแนนเท่ากัน ต้องมีผู้ชนะ', 'error');
  const winTeam = sA > sB ? 'A' : 'B';
  const winners = currentMatch['team'+winTeam];
  const losers  = currentMatch['team'+(winTeam==='A'?'B':'A')];
  const scoreW  = winTeam === 'A' ? sA : sB;
  const scoreL  = winTeam === 'A' ? sB : sA;

  // คำนวณ ELO แต่ละคู่ (singles) หรือเฉลี่ยทีม (doubles)
  const eloResults = [];
  if (currentMatch.type === 'singles') {
    const w = winners[0], l = losers[0];
    const { gain, loss } = calcElo(w.pts, l.pts, w.wins+w.losses, l.wins+l.losses, scoreW, scoreL);
    eloResults.push({ player: w, delta: +applyAchBoost(gain, w), baseGain: gain, isWin: true });
    eloResults.push({ player: l, delta: -loss, isWin: false });
    currentMatch._eloGain = gain;
    currentMatch._eloLoss = loss;
  } else {
    const { perWinner, perLoser } = calcEloTeam(winners, losers, scoreW, scoreL);
    winners.forEach(w => eloResults.push({ player: w, delta: +applyAchBoost(perWinner, w), baseGain: perWinner, isWin: true }));
    losers.forEach(l  => eloResults.push({ player: l, delta: -perLoser, isWin: false }));
    currentMatch._eloGain = perWinner;
    currentMatch._eloLoss = perLoser;
  }
  currentMatch._winTeam = winTeam;
  currentMatch._scoreW  = scoreW;
  currentMatch._scoreL  = scoreL;

  const avgWpts = Math.round(winners.reduce((s,p)=>s+p.pts,0)/winners.length);
  const avgLpts = Math.round(losers.reduce((s,p)=>s+p.pts,0)/losers.length);
  const ptsDiff = avgWpts - avgLpts;
  const upset   = ptsDiff < -100; // ผู้ชนะมีคะแนนน้อยกว่าอย่างชัดเจน

  const eloRowsHTML = eloResults.map(r => {
    const sign  = r.delta > 0 ? '+' : '';
    const color = r.delta > 0 ? 'var(--neon)' : 'var(--red)';
    const newPts = Math.max(0, r.player.pts + r.delta);
    const loserRank = getRankByPts(r.player.pts);
    const isProtected = !r.isWin && (loserRank.id === 'bronze' || loserRank.id === 'silver');
    const displayDelta = isProtected ? 0 : r.delta;
    const displayNewPts = isProtected ? r.player.pts : newPts;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;background:${r.isWin?'rgba(0,245,160,0.06)':'rgba(255,71,87,0.06)'};border:1px solid ${r.isWin?'rgba(0,245,160,0.2)':'rgba(255,71,87,0.15)'};margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:0.88rem;font-weight:600">${r.player.name}</span>
        ${r.isWin?'<span style="font-size:0.7rem;color:var(--neon)">🏆 ชนะ</span>':'<span style="font-size:0.7rem;color:var(--red)">❌ แพ้</span>'}
        ${isProtected ? '<span style="font-size:0.65rem;background:rgba(255,200,0,0.15);border:1px solid rgba(255,200,0,0.3);color:#ffcc00;border-radius:20px;padding:1px 6px">🛡️ Protected</span>' : ''}
        ${r.isWin && r.baseGain && r.delta > r.baseGain ? `<span style="font-size:0.65rem;background:rgba(255,100,0,0.15);border:1px solid rgba(255,100,0,0.3);color:#ff8c42;border-radius:20px;padding:1px 6px">${achBoostLabel(r.player)}</span>` : ''}
      </div>
      <div style="text-align:right">
        <div style="font-family:Rajdhani;font-weight:700;font-size:1.1rem;color:${isProtected?'var(--muted)':color}">${isProtected?'±0':(sign+r.delta)}</div>
        <div style="font-size:0.68rem;color:var(--muted)">${r.player.pts} → ${displayNewPts}</div>
      </div>
    </div>`;
  }).join('');

  const upsetHTML = upset ? `<div style="margin-bottom:12px;padding:8px 12px;border-radius:8px;background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.3);font-size:0.78rem;color:var(--gold);text-align:center">⚡ UPSET! ผู้ชนะมีแรงค์ต่ำกว่า → โบนัสคะแนนพิเศษ!</div>` : '';
  const multLabel = getScoreMultiplier(scoreW, scoreL);

  document.getElementById('finishModalContent').innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:2rem;margin-bottom:4px">🏆</div>
      <div style="font-size:1.1rem;font-weight:700;color:var(--neon)">${formatTeamNames(winners)} ชนะ!</div>
      <div style="font-size:1.8rem;font-family:'Rajdhani';font-weight:700;color:var(--text);margin:8px 0">${scoreW} - ${scoreL}</div>
      <div style="font-size:0.72rem;color:var(--muted)">Score Multiplier: ${multLabel}x · ระบบ True ELO</div>
    </div>
    ${upsetHTML}
    <div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px;font-weight:600">📊 การเปลี่ยนแปลงคะแนน ELO</div>
    ${eloRowsHTML}
    <div style="margin-top:10px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);font-size:0.72rem;color:var(--muted);line-height:1.6">
      💡 <strong style="color:var(--text)">ELO คำนวณจาก:</strong> ช่องว่างคะแนน ELO ระหว่างคู่ + ความห่างของสกอร์ + จำนวนแมตช์สะสม
    </div>
    ${isAdminUser() ? '' : '<div style="margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(255,215,0,0.07);border:1px solid rgba(255,215,0,0.3);font-size:0.75rem;color:var(--gold);line-height:1.6">⏳ <strong>หมายเหตุ:</strong> คะแนนจะยังไม่เข้าทันที — Admin ต้องกด ✅ ยืนยัน ใน Admin Panel ภายใน 12 ชั่วโมง</div>'}`;
  openModal('finishModal');
  // เปลี่ยนข้อความปุ่มตาม role
  const saveBtn = document.getElementById('saveMatchBtn');
  if (saveBtn) {
    if (isAdminUser()) {
      saveBtn.textContent = '✅ บันทึกผล';
    } else {
      saveBtn.textContent = '📨 ส่งให้ Admin ยืนยัน';
    }
  }
}
async function saveMatch() {
  const sA = currentMatch.scoreA, sB = currentMatch.scoreB;
  const winTeam = currentMatch._winTeam || (sA > sB ? 'A' : 'B');
  const winners = currentMatch['team'+winTeam];
  const losers  = currentMatch['team'+(winTeam==='A'?'B':'A')];
  const scoreW  = currentMatch._scoreW  ?? (winTeam==='A' ? sA : sB);
  const scoreL  = currentMatch._scoreL  ?? (winTeam==='A' ? sB : sA);
  let gain, loss;

  // ใช้ค่า ELO ที่คำนวณไว้แล้วใน confirmFinish ถ้ามี ไม่งั้นคำนวณใหม่
  if (currentMatch._eloGain !== undefined) {
    gain = currentMatch._eloGain;
    loss = currentMatch._eloLoss;
  } else if (currentMatch.type === 'singles') {
    const w = winners[0], l = losers[0];
    ({ gain, loss } = calcElo(w.pts, l.pts, w.wins+w.losses, l.wins+l.losses, scoreW, scoreL));
  } else {
    ({ perWinner: gain, perLoser: loss } = calcEloTeam(winners, losers, scoreW, scoreL));
  }

  // King's Challenge detection
  const _kcData = getKingChallenge();
  let _kcActive = false, _kcChallengerId = null;
  if (_kcData && Date.now() - _kcData.ts < 86400000) {
    const _kingSorted2 = [...db.players].sort((a,b)=>b.pts-a.pts);
    const _kingMatch = _kingSorted2[0] && _kingSorted2[0].pts >= 3000 ? _kingSorted2[0] : null;
    if (_kingMatch) {
      const kingInLosers = losers.some(p => p.id === _kingMatch.id);
      const challengerInWinners = winners.some(p => p.id === _kcData.id);
      const kingInWinners = winners.some(p => p.id === _kingMatch.id);
      const challengerInLosers = losers.some(p => p.id === _kcData.id);
      if (kingInLosers && challengerInWinners) {
        _kcActive = true; _kcChallengerId = _kcData.id;
        localStorage.removeItem('badminton_kc');
        setTimeout(() => toast(`🤺 ${_kcData.name} ท้าชิง King สำเร็จ! +50 ELO โบนัส!`, 'success', 5000), 1200);
      } else if (kingInWinners && challengerInLosers) {
        localStorage.removeItem('badminton_kc');
        setTimeout(() => toast(`👑 ${_kingMatch.name} ปกป้องบัลลังก์! ${_kcData.name} ท้าชิงไม่สำเร็จ`, 'info', 4000), 1200);
      }
    }
  }

  toast('กำลังบันทึก...', 'info');
  try {
    if (isAdminUser()) {
      // Admin → บันทึกคะแนนทันที
      for (const p of winners) { const pl = db.players.find(x=>x.id===p.id); const boostedGain = applyAchBoost(gain, pl); const kcBonus = (_kcActive && pl.id === _kcChallengerId) ? 50 : 0; const oldPts = pl.pts; const newPts = Math.max(0, pl.pts + boostedGain + kcBonus); await dbUpdatePlayer(p.id, { pts: newPts, wins: pl.wins + 1 }); if (currentUser && pl.id === currentUser.id) { checkAndShowRankUp(oldPts, newPts, pl.name, boostedGain + kcBonus); } }
      for (const p of losers)  {
        const pl = db.players.find(x=>x.id===p.id);
        const loserRank = getRankByPts(pl.pts);
        // Bronze & Silver ไม่โดนลบแต้มเมื่อแพ้
        if (loserRank.id === 'bronze' || loserRank.id === 'silver') {
          await dbUpdatePlayer(p.id, { losses: pl.losses + 1 });
        } else {
          const actualLoss = Math.min(loss, pl.pts);
          await dbUpdatePlayer(p.id, { pts: Math.max(0, pl.pts - actualLoss), losses: pl.losses + 1 });
        }
      }
      await dbAddMatch({ type: currentMatch.type, teamA: currentMatch.teamA.map(p=>({id:p.id,name:p.name})), teamB: currentMatch.teamB.map(p=>({id:p.id,name:p.name})), scoreA: sA, scoreB: sB, winTeam, pts: { gain, loss } });
      await loadAll();
      closeModal('finishModal');
      currentMatch = null;
      closeRefOverlay();
      document.getElementById('matchPlaying').classList.add('hidden');
      document.getElementById('modePicker').classList.remove('hidden');
      document.getElementById('classicMode').classList.add('hidden');
      toast('บันทึกผลสำเร็จ! 🎉', 'success');
      renderMatchSetup();
      // Check achievements — แสดง popup เฉพาะ currentUser เท่านั้น
      setTimeout(() => {
        if (currentUser && db.players.find(x => x.id === currentUser.id)) {
          checkNewAchievements(currentUser.id);
        }
      }, 500);
    } else {
      // ผู้เล่นทั่วไป → ส่งรอ Admin ยืนยันก่อน ยังไม่บันทึกคะแนน
      await dbAddPending({ type: currentMatch.type, teamA: currentMatch.teamA.map(p=>({id:p.id,name:p.name})), teamB: currentMatch.teamB.map(p=>({id:p.id,name:p.name})), scoreA: sA, scoreB: sB, winTeam, pts: { gain, loss }, submittedBy: currentUser.id });
      await loadAll();
      closeModal('finishModal');
      currentMatch = null;
      closeRefOverlay();
      document.getElementById('matchPlaying').classList.add('hidden');
      document.getElementById('modePicker').classList.remove('hidden');
      document.getElementById('classicMode').classList.add('hidden');
      toast('📨 ส่งผลให้ Admin ยืนยันแล้ว รอ Admin อนุมัติก่อนคะแนนจะเข้า', 'success');
      renderMatchSetup();
    }
  } catch(e) {
    console.error('saveMatch error:', e);
    toast('❌ ' + (e.message || 'บันทึกไม่ได้ ดู Console สำหรับรายละเอียด'), 'error');
  }
}

async function renderHistory() {
  document.getElementById('histList').innerHTML = `<div class="text-muted" style="text-align:center;padding:20px">⏳ ${t('loading')}</div>`;
  try {
    // Fetch full history (up to 500) independently from the global 50-match cache
    await loadPlayers();
    const rows = await supaFetch('matches?order=played_at.desc&limit=500');
    const allMatches = rows.map(normalizeMatch);

    // Populate player filter
    const filterEl = document.getElementById('histFilterPlayer');
    if (filterEl) {
      const currentVal = filterEl.value;
      const options = db.players.map(p => `<option value="${p.id}" ${currentVal == p.id ? 'selected' : ''}>${p.name}</option>`).join('');
      filterEl.innerHTML = `<option value="">${t('all_players')}</option>` + options;
    }

    const filterPlayerId = filterEl ? parseInt(filterEl.value) : null;
    const filterType = document.getElementById('histFilterType') ? document.getElementById('histFilterType').value : '';

    let matches = allMatches;
    if (filterPlayerId) {
      matches = matches.filter(m => [...m.teamA, ...m.teamB].some(x => x.id === filterPlayerId));
    }
    if (filterType) {
      matches = matches.filter(m => m.type === filterType);
    }
    matches = matches.slice(0, 200);

    const html = matches.map(m => {
      const nameA = formatTeamNames(m.teamA), nameB = formatTeamNames(m.teamB);
      const winner = m.winTeam === 'A' ? nameA : nameB, loser = m.winTeam === 'A' ? nameB : nameA;
      const date = new Date(m.date).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'});
      const typeLabel = m.type === 'doubles' ? '👥 Doubles' : '👤 Singles';
      // Highlight if filtered player won/lost
      let resultHint = '';
      if (filterPlayerId) {
        const inA = m.teamA.some(x => x.id === filterPlayerId);
        const isWin = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
        resultHint = `<span style="font-size:0.72rem;font-weight:700;color:${isWin?'var(--neon)':'var(--red)'};margin-left:6px">${isWin?t('win_badge'):t('lose_badge')}</span>`;
      }
      const undoBtn = isAdminUser()
        ? `<button class="btn btn-ghost btn-sm" style="font-size:0.7rem;padding:3px 8px;color:var(--red);border-color:rgba(255,71,87,0.35)" onclick="undoMatch(${m.id})">↩ ย้อนกลับ</button>`
        : '';
      return `<div class="hist-item">
        <div class="hist-header">
          <div style="font-size:0.82rem;font-weight:600">${typeLabel}${resultHint}</div>
          <div style="display:flex;align-items:center;gap:6px"><div class="hist-date">${date}</div>${undoBtn}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span>🏆</span><span style="font-weight:700;color:var(--neon)">${winner}</span>
          <span style="font-family:'Rajdhani';font-size:1.1rem;font-weight:700;color:var(--text)"> ${m.scoreA}-${m.scoreB} </span>
          <span style="color:var(--muted);font-size:0.78rem">vs ${loser}</span>
        </div>
        <div class="hist-detail">+${m.pts.gain} / -${m.pts.loss} pts</div>
      </div>`;
    }).join('') || `<div class="text-muted" style="text-align:center;padding:20px">${t('no_history')}</div>`;
    const total = filterPlayerId || filterType ? matches.length : allMatches.length;
    document.getElementById('histList').innerHTML =
      `<div style="font-size:.72rem;color:var(--muted);text-align:right;margin-bottom:8px;padding-right:4px">${t('total_all')} ${total} ${t('matches_unit')}</div>` + html;
  } catch(e) { document.getElementById('histList').innerHTML = `<div class="text-muted" style="text-align:center;padding:20px">${t('load_fail')}</div>`; }
}

async function renderProfile() {
  if (!currentUser) return;
  try {
    await loadAll();
    const p = db.players.find(x=>x.id===currentUser.id) || currentUser;
    // ── Merge localStorage gacha fallback (ถ้า DB ยังไม่มี column) ──
    const _lsG = JSON.parse(localStorage.getItem('bmt_gacha_'+p.id)||'{}');
    if (!p.gachaFrame && _lsG.gacha_frame) p.gachaFrame = _lsG.gacha_frame;
    if (!p.gachaName  && _lsG.gacha_name)  p.gachaName  = _lsG.gacha_name;
    if (!p.gachaEmoji && _lsG.gacha_emoji) p.gachaEmoji = _lsG.gacha_emoji;
    currentUser = p;
    const rank = getRank(p.pts, p.id), colors = getAvatarColor(p.id), prog = rankProgress(p.pts);
    const av = getAvatar(p.id, p.name);
    const wr = p.wins + p.losses > 0 ? Math.round(p.wins/(p.wins+p.losses)*100) : 0;
    const rankPos = [...db.players].sort((a,b)=>b.pts-a.pts).findIndex(x=>x.id===p.id) + 1;
    // Track peak rank position
    const peakPosKey = 'badminton_peak_pos_' + p.id;
    let peakRankPos = parseInt(localStorage.getItem(peakPosKey) || rankPos);
    if (!localStorage.getItem(peakPosKey) || rankPos < peakRankPos) { peakRankPos = rankPos; localStorage.setItem(peakPosKey, rankPos); }
    // Total days played
    const totalDays = new Set(db.matches.filter(m=>[...m.teamA,...m.teamB].some(x=>x.id===p.id)).map(m=>new Date(m.date).toISOString().slice(0,10))).size;
    // ระบบติก=โชว์: ถ้าตั้งค่าแล้ว (pinnedAchs เป็น array) โชว์เฉพาะที่ติก, ถ้ายังไม่ตั้งค่า (null) โชว์ทั้งหมด
    const _profPins = p.pinnedAchs;
    const _profAch = (p.customAch||[]).filter(a => (_profPins === null || _profPins === undefined) ? true : _profPins.includes(a.id));
    const achHtml = _profAch.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">${_profAch.map(a=>`<div class="cach-badge cach-frame-${a.frame||'gold'}" title="${a.desc||''}" style="padding:4px 10px;font-size:0.72rem">${a.icon||'🏆'} ${a.title}</div>`).join('')}</div>` : '';
    document.getElementById('profileCard').innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar ${getGachaFrameClass(p)}" style="background:${av.bg};color:${av.fg};${av.fs?'font-size:'+av.fs:''};position:relative;isolation:isolate">${getGachaFrameInner(p)}${av.content}</div>
        <div><div class="profile-name ${getGachaNameClass(p)}">${p.name}</div><div class="mt-8" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="rank-badge ${rank.class}">${getRankLabel(p.pts,p.id)}</span><span style="font-size:0.78rem;font-weight:700;color:var(--muted)">${t('rank_pos')}${rankPos}</span></div>${p.isAdmin ? '<div class="mt-8"><span class="rank-badge" style="background:rgba(0,217,245,0.15);color:var(--neon2);border:1px solid rgba(0,217,245,0.3)">⚙️ Admin</span></div>' : ''}${achHtml}</div>
      </div>
      <div><div class="flex-between" style="margin-bottom:4px"><span class="text-muted" style="font-size:0.78rem">${t('rank_progress')} ${prog.next ? '→ '+prog.next.label : t('rank_max')}</span><span style="font-size:0.78rem;color:var(--neon)">${prog.pct}%</span></div><div class="progress-wrap" style="height:8px"><div class="progress-bar" style="width:${prog.pct}%;background:linear-gradient(90deg,var(--neon),var(--neon2))"></div></div></div>
      <div class="profile-stats">
        <div class="pstat"><div class="pstat-num">${p.pts}</div><div class="pstat-label">${t('pts')}</div></div>
        <div class="pstat"><div class="pstat-num" style="color:var(--neon)">${p.wins}</div><div class="pstat-label">${t('wins')}</div></div>
        <div class="pstat"><div class="pstat-num" style="color:var(--red)">${p.losses}</div><div class="pstat-label">${t('losses')}</div></div>
      </div>
      <div class="divider"></div>
      <div class="flex-between">
        <div class="pstat" style="width:48%;text-align:center"><div class="pstat-num" style="font-size:1.1rem;color:var(--gold)">${p.wins+p.losses}</div><div class="pstat-label">${t('total_m')}</div></div>
        <div class="pstat" style="width:48%;text-align:center"><div class="pstat-num" style="font-size:1.1rem;color:${wr>=50?'var(--neon)':'var(--red)'}">${wr}%</div><div class="pstat-label">${t('win_rate')}</div></div>
      </div>
      <div class="divider"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
        <div class="pstat"><div class="pstat-num" style="font-size:1.1rem;color:var(--neon)">#${rankPos}</div><div class="pstat-label">${t('cur_rank_pos')}</div></div>
        <div class="pstat"><div class="pstat-num" style="font-size:1.1rem;color:var(--gold)">#${peakRankPos}</div><div class="pstat-label">${t('peak_rank_pos')}</div></div>
        <div class="pstat"><div class="pstat-num" style="font-size:1.1rem;color:var(--neon2)">${totalDays}</div><div class="pstat-label">${t('days_played')}</div></div>
      </div>
      <div class="divider"></div>
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:6px;">📊 ${_lang === 'en' ? 'Days at Each Rank' : 'วันที่อยู่แต่ละอันดับ'}<div style="flex:1;height:1px;background:var(--glass-border);margin-left:6px;"></div></div>
      ${buildRankDaysHTML(p.id)}
      <div class="divider"></div>
      ${renderPrimeSSTitles(p)}
      <div class="divider" style="${(p.primeTitles||[]).length ? '' : 'display:none'}"></div>
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:6px;">📈 Ranking History<div style="flex:1;height:1px;background:var(--glass-border);margin-left:6px;"></div></div>
      ${buildRankingChart(p.id)}`;
    const myMatches = db.matches.filter(m => [...m.teamA,...m.teamB].some(x=>x.id===p.id)).slice(0, 20);
    document.getElementById('myHistList').innerHTML = myMatches.map(m => {
      const inA = m.teamA.some(x=>x.id===p.id), isWin = (inA && m.winTeam==='A') || (!inA && m.winTeam==='B');
      const opp = inA ? m.teamB : m.teamA, date = new Date(m.date).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'});
      return `<div class="hist-item"><div class="hist-header"><span class="hist-result ${isWin?'win':'lose'}">${isWin?t('win_label'):t('lose_label')}</span><span class="hist-date">${date}</span></div><div class="hist-detail">vs ${formatTeamNames(opp)} · ${m.scoreA}-${m.scoreB} · ${isWin?'+'+m.pts.gain:'-'+m.pts.loss} pts</div></div>`;
    }).join('') || `<div class="text-muted" style="text-align:center;padding:20px">${t('no_match')}</div>`;
  } catch(e) { console.error(e); }
}

async function renderAdmin() {
  if (!isAdminUser()) return;
  try {
    await loadAll();
    document.getElementById('adminStats').innerHTML = `<div class="stat-card"><div class="stat-num">${db.players.length}</div><div class="stat-label">${t('players_stat')}</div></div><div class="stat-card"><div class="stat-num">${db.matches.length}</div><div class="stat-label">${t('matches_stat')}</div></div><div class="stat-card"><div class="stat-num">${db.players.reduce((s,p)=>s+p.wins,0)}</div><div class="stat-label">${t('total_wins')}</div></div><div class="stat-card"><div class="stat-num">${db.players.length>0?Math.max(...db.players.map(p=>p.pts)):0}</div><div class="stat-label">${t('top_score')}</div></div>`;
    const sorted = [...db.players].sort((a,b)=>b.pts-a.pts);
    document.getElementById('adminPlayerList').innerHTML = sorted.map(p => {
      const rank = getRank(p.pts, p.id), colors = getAvatarColor(p.id);
      return `<div class="lb-item" style="margin-bottom:6px"><div class="lb-avatar ${getGachaFrameClass(p)}" style="background:${colors[1]};color:${colors[0]};position:relative;isolation:isolate">${getGachaFrameInner(p)}${getInitial(p.name)}</div><div class="lb-info"><div class="lb-name ${getGachaNameClass(p)}">${p.name} ${p.isAdmin?'<span style="color:var(--neon2);font-size:0.68rem">Admin</span>':''}</div><div style="margin-top:3px"><span class="rank-badge ${rank.class}" style="font-size:0.68rem">${getRankLabel(p.pts,p.id)}</span></div><div class="lb-stats">${p.wins}W ${p.losses}L · ${p.pts} pts</div></div><button class="btn btn-ghost btn-sm" onclick="openEditPlayer(${p.id})">${t('edit_btn')}</button></div>`;
    }).join('') || `<div class="text-muted">${t('no_players_list')}</div>`;
    await renderPendingList();
    renderCachAdmin(); // [FIXED] render immediately with cached data
    await migrateCachToSupabase(); // [FIXED] await migration so catalog is fully synced
    renderCachAdmin(); // [FIXED] re-render after migration to pick up any newly synced items
  } catch(e) { console.error(e); }
}

async function renderPendingList() {
  try {
    const rows = await dbGetPending();
    const badge = document.getElementById('pendingBadge');
    const list  = document.getElementById('pendingList');
    if (!rows || rows.length === 0) {
      badge.classList.add('hidden');
      list.innerHTML = `<div class="text-muted" style="text-align:center;padding:16px;font-size:0.83rem">${t('no_pending')}</div>`;
      return;
    }
    badge.textContent = rows.length;
    badge.classList.remove('hidden');
    list.innerHTML = rows.map(r => {
      const teamA = r.team_a, teamB = r.team_b;
      const nameA = formatTeamNames(teamA);
      const nameB = formatTeamNames(teamB);
      const winLabel = r.win_team === 'A' ? nameA : nameB;
      const submitter = db.players.find(p=>p.id===r.submitted_by);
      const submitterName = submitter ? submitter.name : t('unknown');
      const scoreA = r.score_a, scoreB = r.score_b;
      // preview ELO
      const winners = r.win_team === 'A' ? teamA : teamB;
      const losers  = r.win_team === 'A' ? teamB : teamA;
      const winPts  = winners.map(p => { const pl = db.players.find(x=>x.id===p.id); return pl ? pl.pts : 0; });
      const losePts = losers.map(p  => { const pl = db.players.find(x=>x.id===p.id); return pl ? pl.pts : 0; });
      const eloRows = [
        ...winners.map((p,i) => { const pl = db.players.find(x=>x.id===p.id); const bg = pl ? applyAchBoost(r.pts_gain, pl) : r.pts_gain; const lbl = pl ? achBoostLabel(pl) : ''; return `<span style="color:var(--neon)">+${bg}${lbl}</span> ${p.name} (${winPts[i]} → ${winPts[i]+bg})`; }),
        ...losers.map((p,i)  => `<span style="color:var(--red)">-${r.pts_loss}</span> ${p.name} (${losePts[i]} → ${Math.max(0,losePts[i]-r.pts_loss)})`)
      ].join(' · ');
      return `<div class="pending-item">
        <div class="pending-item-top">
          <div class="pending-item-teams">
            <div class="pending-item-name">${t('win_team')} ${winLabel}</div>
            <div class="pending-item-sub">${nameA} vs ${nameB} · ${t('submitted_by')} ${submitterName} · ⏱ ${t('expire_in')} ${(() => { const ms = new Date(r.created_at).getTime() + 12*60*60*1000 - Date.now(); const h = Math.floor(ms/3600000); const m = Math.floor((ms%3600000)/60000); return h > 0 ? h+t('hrs')+' '+m+t('mins') : m+t('mins'); })()}</div>
          </div>
          <div class="pending-item-score">${scoreA}-${scoreB}</div>
        </div>
        <div class="pending-item-elo">📊 ELO: ${eloRows}</div>
        <div class="pending-item-actions">
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="approvePending(${r.id})">${t('approve')}</button>
          <button class="btn btn-danger btn-sm" style="flex:1" onclick="rejectPending(${r.id})">${t('reject')}</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) { document.getElementById('pendingList').innerHTML = `<div class="text-muted" style="text-align:center;padding:12px;font-size:0.82rem">${t('load_fail')}</div>`; }
}

async function approvePending(pendingId) {
  try {
    const rows = await dbGetPending();
    const r = rows.find(x => x.id === pendingId);
    if (!r) return toast('ไม่พบรายการ', 'error');
    toast('กำลังยืนยัน...', 'info');
    const winners = r.win_team === 'A' ? r.team_a : r.team_b;
    const losers  = r.win_team === 'A' ? r.team_b : r.team_a;
    // King's Challenge detection
    const _kcAp = getKingChallenge();
    let _kcApActive = false, _kcApChallengerId = null;
    if (_kcAp && Date.now() - _kcAp.ts < 86400000) {
      const _kingSortedAp = [...db.players].sort((a,b)=>b.pts-a.pts);
      const _kingAp = _kingSortedAp[0] && _kingSortedAp[0].pts >= 3000 ? _kingSortedAp[0] : null;
      if (_kingAp) {
        const kingInWin = winners.some(p => p.id === _kingAp.id);
        const kingInLose = losers.some(p => p.id === _kingAp.id);
        const challInWin = winners.some(p => p.id === _kcAp.id);
        const challInLose = losers.some(p => p.id === _kcAp.id);
        if (kingInLose && challInWin) {
          _kcApActive = true; _kcApChallengerId = _kcAp.id;
          localStorage.removeItem('badminton_kc');
          setTimeout(() => toast(`🤺 ${_kcAp.name} ท้าชิง King สำเร็จ! +50 ELO โบนัส!`, 'success', 5000), 1200);
        } else if (kingInWin && challInLose) {
          localStorage.removeItem('badminton_kc');
          setTimeout(() => toast(`👑 ${_kingAp.name} ปกป้องบัลลังก์!`, 'info', 4000), 1200);
        }
      }
    }
    for (const p of winners) { const pl = db.players.find(x=>x.id===p.id); if(pl) { const boostedGain = applyAchBoost(r.pts_gain, pl); const kcBonus = (_kcApActive && pl.id === _kcApChallengerId) ? 50 : 0; const oldPts = pl.pts; const newPts = Math.max(0, pl.pts + boostedGain + kcBonus); await dbUpdatePlayer(p.id, { pts: newPts, wins: pl.wins + 1 }); if (currentUser && pl.id === currentUser.id) { checkAndShowRankUp(oldPts, newPts, pl.name, boostedGain + kcBonus); } } }
    for (const p of losers)  {
      const pl = db.players.find(x=>x.id===p.id);
      if(pl) {
        const loserRank = getRankByPts(pl.pts);
        if (loserRank.id === 'bronze' || loserRank.id === 'silver') {
          await dbUpdatePlayer(p.id, { losses: pl.losses + 1 });
        } else {
          const actualLoss = Math.min(r.pts_loss, pl.pts);
          await dbUpdatePlayer(p.id, { pts: Math.max(0, pl.pts - actualLoss), losses: pl.losses + 1 });
        }
      }
    }
    await dbAddMatch({ type: r.type, teamA: r.team_a, teamB: r.team_b, scoreA: r.score_a, scoreB: r.score_b, winTeam: r.win_team, pts: { gain: r.pts_gain, loss: r.pts_loss } });
    await dbDeletePending(pendingId);
    await loadAll();
    toast('✅ ยืนยันแมตช์สำเร็จ! คะแนนถูกบันทึกแล้ว 🎉', 'success');
    renderAdmin();
    // Check achievements — แสดง popup เฉพาะ currentUser เท่านั้น
    setTimeout(() => {
      if (currentUser && db.players.find(x => x.id === currentUser.id)) {
        checkNewAchievements(currentUser.id);
      }
    }, 500);
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function rejectPending(pendingId) {
  if (!confirm('ปฏิเสธแมตช์นี้? ผลการแข่งขันจะไม่ถูกบันทึก')) return;
  try {
    await dbDeletePending(pendingId);
    await loadAll();
    toast('ปฏิเสธแมตช์แล้ว ผลจะไม่ถูกบันทึก', 'info');
    renderAdmin();
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

async function undoMatch(matchId) {
  if (!isAdminUser()) return;
  // Load full match list to find this match
  const rows = await supaFetch('matches?order=played_at.desc&limit=500');
  const match = rows.map(normalizeMatch).find(m => m.id === matchId);
  if (!match) return toast('ไม่พบแมตช์', 'error');

  const winners = match.winTeam === 'A' ? match.teamA : match.teamB;
  const losers  = match.winTeam === 'A' ? match.teamB : match.teamA;
  const wNames  = winners.map(p => { const pl = db.players.find(x=>x.id===p.id); return pl ? pl.name : p.id; }).join(', ');
  const lNames  = losers.map(p  => { const pl = db.players.find(x=>x.id===p.id); return pl ? pl.name : p.id; }).join(', ');
  const date    = new Date(match.date).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'});

  if (!confirm(
    `ย้อนกลับแมตช์นี้?\n\n` +
    `ผู้ชนะ: ${wNames} → pts -${match.pts.gain}, wins -1\n` +
    `ผู้แพ้:  ${lNames} → pts +${match.pts.loss}, losses -1\n\n` +
    `วันที่: ${date}\n\nแมตช์จะถูกลบออกจากประวัติด้วย`
  )) return;

  try {
    toast('กำลังย้อนกลับแมตช์...', 'info');
    await loadPlayers();

    // Reverse winners: subtract gain, wins--
    for (const p of winners) {
      const pl = db.players.find(x=>x.id===p.id);
      if (!pl) continue;
      await dbUpdatePlayer(pl.id, {
        pts:  Math.max(0, pl.pts - match.pts.gain),
        wins: Math.max(0, pl.wins - 1)
      });
    }
    // Reverse losers: add back loss pts, losses--
    for (const p of losers) {
      const pl = db.players.find(x=>x.id===p.id);
      if (!pl) continue;
      await dbUpdatePlayer(pl.id, {
        pts:    pl.pts + match.pts.loss,
        losses: Math.max(0, pl.losses - 1)
      });
    }
    // Delete the match record
    await supaFetch('matches?id=eq.' + matchId, { method: 'DELETE', prefer: 'return=minimal' });
    await loadAll();
    renderHistory();
    renderLeaderboard();
    toast('ย้อนกลับแมตช์สำเร็จ ✅', 'success');
  } catch(e) { toast('ย้อนกลับไม่ได้: ' + e.message, 'error'); }
}

async function clearPlayerHistory(id) {
  const p = db.players.find(x=>x.id===id); if (!p) return;
  if (!confirm(`ล้างประวัติของ ${p.name}?\nจะรีเซ็ตทุกอย่าง: W/L, คะแนน, แมตช์ และ Achievement ทั้งหมด`)) return;
  try {
    toast('กำลังล้างประวัติ...', 'info');

    // 1. ล้าง DB ทั้ง prime_titles และ custom_ach ให้ว่างเปล่าสมบูรณ์
    await dbUpdatePlayer(id, {
      pts: 50,
      wins: 0,
      losses: 0,
      prime_titles: '[]',
      custom_ach: '[]'
    });

    // 2. ล้าง localStorage ทุก key ที่เก็บ badge/achievement ของผู้เล่นนี้
    ['badminton_cach_awards', 'badminton_ach_' + id].forEach(key => {
      try {
        if (key === 'badminton_cach_awards') {
          const obj = JSON.parse(localStorage.getItem(key) || '{}');
          delete obj[id];
          localStorage.setItem(key, JSON.stringify(obj));
        } else {
          localStorage.removeItem(key);
        }
      } catch(e) {}
    });

    // 3. ล้าง in-memory state ทันที
    const idx = db.players.findIndex(x => x.id === id);
    if (idx !== -1) {
      db.players[idx].customAch = [];
      db.players[idx].super1000Titles = 0;
      db.players[idx].pinnedAchs = null;
      db.players[idx].primeTitles = [];
      db.players[idx].pts = 50;
      db.players[idx].wins = 0;
      db.players[idx].losses = 0;
    }

    // 4. ลบแมตช์ แล้ว reload ทุกอย่างใหม่
    await dbDeleteMatchesByPlayer(id);
    await loadAll();
    closeModal('editPlayerModal');
    renderAdmin();
    renderLeaderboard();
    toast(`🗑️ ล้างประวัติ ${p.name} แล้ว (รวมทุก Achievement)`, 'success');
  } catch(e) { toast('ล้างไม่ได้: ' + e.message, 'error'); }
}

function openEditPlayer(id) {
  const p = db.players.find(x=>x.id===id); if (!p) return;
  document.getElementById('editPlayerId').value = id;
  document.getElementById('editPlayerName').value = p.name;
  document.getElementById('editPlayerPts').value = p.pts;
  document.getElementById('editPlayerPin').value = '';
  document.getElementById('editPlayerAdmin').value = p.isAdmin ? '1' : '0';
  document.getElementById('editPlayerGachaFrame').value = p.gachaFrame || '';
  document.getElementById('editPlayerGachaName').value = p.gachaName || '';
  openModal('editPlayerModal');
}
async function saveEditPlayer() {
  const id = parseInt(document.getElementById('editPlayerId').value);
  const p = db.players.find(x=>x.id===id); if (!p) return;
  const gachaFrame = document.getElementById('editPlayerGachaFrame').value;
  const gachaName = document.getElementById('editPlayerGachaName').value;
  const newFrame = (gachaFrame !== (p.gachaFrame || '')) && gachaFrame;
  const newName = (gachaName !== (p.gachaName || '')) && gachaName;
  const playerName = document.getElementById('editPlayerName').value.trim() || p.name;
  const data = { name: playerName, pts: Math.max(0, parseInt(document.getElementById('editPlayerPts').value) || 0), is_admin: document.getElementById('editPlayerAdmin').value === '1', gacha_frame: gachaFrame || null, gacha_name: gachaName || null };
  const newPin = document.getElementById('editPlayerPin').value.trim();
  if (newPin) data.pin = newPin;
  try {
    await dbUpdatePlayer(id, data);
    await loadPlayers();
    // ── Also add new item to the player's gacha_inventory so it appears in Avatar Builder ──
    if (newFrame || newName) {
      const inv = getGachaInventory(id);
      if (!inv.frames) inv.frames = [];
      if (!inv.names)  inv.names  = [];
      if (newFrame && !inv.frames.includes(gachaFrame)) inv.frames.push(gachaFrame);
      if (newName  && !inv.names.includes(gachaName))   inv.names.push(gachaName);
      _saveGachaInventoryToDB(id, inv); // async — fire and forget
    }
    closeModal('editPlayerModal'); renderAdmin(); toast('บันทึกสำเร็จ', 'success');
    // ── Show cosmetic reveal (cinematic for SECRET, normal card for others) ──
    if (newFrame || newName) {
      const isThunderGod  = gachaFrame === 'thundergod' || gachaName === 'thundergod';
      const isSolarEmperor = gachaFrame === 'solaremperor' || gachaName === 'solaremperor';
      if (isThunderGod) showThunderGodCinematic(playerName);
      else if (isSolarEmperor) showSolarEmperorAscension(playerName, false);
      else showGachaReveal(playerName, gachaFrame || null, gachaName || null);
    }
  } catch(e) {
    // Fallback: retry without gacha columns if DB schema is outdated
    if (/gacha_(frame|name)/.test(e.message || '')) {
      delete data.gacha_frame; delete data.gacha_name;
      try {
        await dbUpdatePlayer(id, data);
        await loadPlayers(); closeModal('editPlayerModal'); renderAdmin();
        toast('บันทึกแล้ว — แต่ Gacha effect ยังไม่มี column ใน DB (รัน ALTER TABLE ใน Admin → SQL)', 'info');
        return;
      } catch(e2) { toast('บันทึกไม่ได้: ' + e2.message, 'error'); return; }
    }
    toast('บันทึกไม่ได้: ' + e.message, 'error');
  }
}
async function deletePlayer() {
  const id = parseInt(document.getElementById('editPlayerId').value);
  if (!confirm('ลบผู้เล่นนี้?')) return;
  try { await dbDeletePlayer(id); await loadPlayers(); closeModal('editPlayerModal'); renderAdmin(); toast('ลบผู้เล่นแล้ว', 'info'); }
  catch(e) { toast('ลบไม่ได้: ' + e.message, 'error'); }
}
function resetAllData() { toast('ฟีเจอร์นี้ต้องลบผ่าน Supabase Dashboard ครับ', 'info'); }
function exportData() {
  const blob = new Blob([JSON.stringify({ players: db.players, matches: db.matches }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `badminton_backup_${Date.now()}.json`; a.click();
  toast('ส่งออกสำเร็จ', 'success');
}
function importData(e) { toast('Import ผ่าน Supabase Dashboard ครับ', 'info'); }

function openModal(id) { document.getElementById(id).classList.remove('hidden') }
function closeModal(id) { document.getElementById(id).classList.add('hidden') }
function cancelFinish() {
  closeModal('finishModal');
  if (currentMatch) {
    delete currentMatch._winTeam;
    delete currentMatch._scoreW;
    delete currentMatch._scoreL;
    delete currentMatch._eloGain;
    delete currentMatch._eloLoss;
  }
}
function showRankInfo() { openModal('rankModal') }

function toast(msg, type = 'info') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg;
  wrap.appendChild(el); setTimeout(() => el.remove(), 3000);
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (!document.getElementById('quickLoginCard').classList.contains('hidden')) { quickLogin(); return; }
  if (!document.getElementById('loginForm').classList.contains('hidden')) login();
});

// ── SPLASH SCREEN ──
window.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('splashScreen');
  setTimeout(() => {
    splash.classList.add('splash-hide');
    setTimeout(() => splash.remove(), 500);
  }, 1400);
  initQuickLogin();
});

// ── CURSOR GLOW (Liquid UI 2.0) ──
const liqCg = document.getElementById('liqCg');
document.addEventListener('mousemove', e => {
  liqCg.style.left = e.clientX + 'px';
  liqCg.style.top = e.clientY + 'px';
});

const CURRENT_VERSION = '6.0';

function showPatchNotes() {
  const bg = document.getElementById('patchModal');
  const box = document.getElementById('patchModalBox');
  bg.classList.remove('hidden');
  bg.classList.add('pm-in');
  box.classList.add('pm-in');
}

function closePatchNotes(e) {
  if (e && e.target !== document.getElementById('patchModal')) return;
  _animatePatchClose();
}

function _animatePatchClose() {
  const bg = document.getElementById('patchModal');
  const box = document.getElementById('patchModalBox');
  bg.classList.remove('pm-in');
  box.classList.remove('pm-in');
  bg.classList.add('pm-out');
  box.classList.add('pm-out');
  setTimeout(() => {
    bg.classList.add('hidden');
    bg.classList.remove('pm-out');
    box.classList.remove('pm-out');
  }, 220);
}

function markPatchRead() {
  localStorage.setItem('badminton_patch_read', CURRENT_VERSION);
  document.getElementById('updateBadge').classList.add('hidden');
  _animatePatchClose();
  toast('รับทราบอัปเดตแล้ว 🎉', 'success');
}

function checkPatchBadge() {
  const read = localStorage.getItem('badminton_patch_read');
  if (read !== CURRENT_VERSION) {
    document.getElementById('updateBadge').classList.remove('hidden');
  }
}

loadTheme();
setStyle(localStorage.getItem('badminton_style') || 'glass');
checkPatchBadge();
applyLang();

