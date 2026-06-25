// ==================== PLAYER PROFILE BOTTOM SHEET ====================
// ── King crown badge: glowing PNG crown + full sparkle canvas (rank King) ──
// Falls back to the 👑 emoji if assets/crown.png isn't present yet.
let _kingCrownRaf = null;
function _kingCrownHTML() {
  return `<div class="king-crown">
    <canvas class="kc-spark" id="kcSparkCanvas"></canvas>
    <img class="kc-img" src="${typeof CROWN_SRC!=='undefined'?CROWN_SRC:'assets/crown.png'}" alt="crown">
  </div>`;
}
function _initKingCrownSparkles(canvas) {
  if (_kingCrownRaf) { cancelAnimationFrame(_kingCrownRaf); _kingCrownRaf = null; }
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth || 120;
  const H = canvas.height = canvas.offsetHeight || 96;
  const CX = W / 2, CY = H * 0.6;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ps = [];
  function mk() {
    const ang = rand(0, Math.PI * 2), rad = rand(8, Math.max(W, H) * 0.52), life = rand(0.5, 2);
    return {
      x: CX + Math.cos(ang) * rad, y: CY + Math.sin(ang) * rad * 0.7,
      size: rand(0.8, 2.8), alpha: rand(0.2, 1), life, age: rand(0, life),
      vx: rand(-0.25, 0.25), vy: rand(-0.6, -0.08),
      color: `hsl(${rand(40, 55)},${rand(80, 100)}%,${rand(80, 100)}%)`,
      star: Math.random() < 0.5
    };
  }
  for (let i = 0; i < 56; i++) ps.push(mk());
  let last = performance.now();
  function loop(now) {
    const dt = (now - last) / 1000; last = now;
    ctx.clearRect(0, 0, W, H);
    ps.forEach((p, i) => {
      p.age += dt; p.x += p.vx; p.y += p.vy;
      if (p.age >= p.life) { ps[i] = mk(); return; }
      const t = p.age / p.life;
      const a = (t < 0.3 ? t / 0.3 : t > 0.7 ? (1 - t) / 0.3 : 1) * p.alpha;
      ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 6;
      const s = p.size * (1 - t * 0.4);
      if (p.star) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.age * 1.5); ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const r = k % 2 === 0 ? s : s * 0.35, ang = k * Math.PI / 4;
          k === 0 ? ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r) : ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
        }
        ctx.closePath(); ctx.fill(); ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    });
    _kingCrownRaf = requestAnimationFrame(loop);
  }
  _kingCrownRaf = requestAnimationFrame(loop);
}

async function openPlayerProfile(playerId) {
  const p = db.players.find(x => x.id === playerId);
  if (!p) return;

  // ถ้าผู้เล่นมีสถิติแต่ match ไม่อยู่ใน cache 50 รายการ ให้โหลดทั้งหมด
  const inCache = db.matches.some(m => [...m.teamA, ...m.teamB].some(x => x.id === p.id));
  if (!inCache && (p.wins + p.losses) > 0) {
    try {
      const rows = await supaFetch('matches?order=played_at.desc&limit=1000');
      db.matches = rows.map(normalizeMatch);
    } catch(e) {}
  }

  const myMatches = db.matches.filter(m => [...m.teamA, ...m.teamB].some(x => x.id === p.id));
  const rank = getRank(p.pts, p.id);
  const colors = getAvatarColor(p.id);
  const wr = p.wins + p.losses > 0 ? Math.round(p.wins / (p.wins + p.losses) * 100) : 0;

  // Current leaderboard position
  const rankPos = [...db.players].sort((a,b)=>b.pts-a.pts).findIndex(x=>x.id===p.id) + 1;
  // Track peak position in localStorage
  const _ppk = 'badminton_peak_pos_' + p.id;
  let peakPos = parseInt(localStorage.getItem(_ppk) || rankPos);
  if (!localStorage.getItem(_ppk) || rankPos < peakPos) { peakPos = rankPos; localStorage.setItem(_ppk, rankPos); }

  // Peak rank from ELO history
  const eloHistory = buildEloHistory(p.id);
  const peakElo = eloHistory.length ? Math.max(...eloHistory) : p.pts;
  const peakRank = getRankByPts(peakElo);
  const isPeakHigher = RANKS.findIndex(r=>r.id===peakRank.id) < RANKS.findIndex(r=>r.id===rank.id);

  // Form — last 10
  const last10 = myMatches.slice(0, 10);
  const formDots = last10.map(m => {
    const inA = m.teamA.some(x => x.id === p.id);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    return `<div class="pp2-dot ${win ? 'w' : 'l'}">${win ? 'W' : 'L'}</div>`;
  }).join('') || `<span style="color:var(--muted);font-size:0.78rem">${t('no_match')}</span>`;


  // Head-to-Head
  const h2hMap = {};
  myMatches.forEach(m => {
    const inA = m.teamA.some(x => x.id === p.id);
    const myTeam = inA ? m.teamA : m.teamB;
    const oppTeam = inA ? m.teamB : m.teamA;
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    oppTeam.forEach(opp => {
      if (!h2hMap[opp.id]) h2hMap[opp.id] = { name: opp.name, id: opp.id, w: 0, l: 0 };
      win ? h2hMap[opp.id].w++ : h2hMap[opp.id].l++;
    });
  });
  const h2hList = Object.values(h2hMap).sort((a, b) => (b.w + b.l) - (a.w + a.l)).slice(0, 4);
  const h2hHTML = h2hList.map(h => {
    const total = h.w + h.l;
    const pct = total > 0 ? Math.round(h.w / total * 100) : 0;
    const oppColors = getAvatarColor(h.id);
    const oppP = (db.players||[]).find(x=>x.id===h.id) || h;
    return `<div class="pp2-h2h">
      <div class="pp2-partner-av ${getGachaFrameClass(oppP)}" style="background:${oppColors[1]};color:${oppColors[0]};width:32px;height:32px;font-size:0.82rem;flex-shrink:0;position:relative;isolation:isolate">${getGachaFrameInner(oppP)}${getInitial(h.name)}</div>
      <div style="flex:1;min-width:0">
        <div class="pp2-h2h-name ${getGachaNameClass(oppP)}">${esc(h.name)}</div>
        <div class="pp2-h2h-bar-wrap"><div class="pp2-h2h-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="pp2-h2h-score" style="color:${pct>=50?'var(--neon)':'var(--red)'}">${h.w}W ${h.l}L</div>
    </div>`;
  }).join('') || `<div class="text-muted" style="font-size:0.8rem;padding:8px 0">${t('no_data')}</div>`;

  // Best partner
  const partnerMap = {};
  myMatches.forEach(m => {
    const inA = m.teamA.some(x => x.id === p.id);
    const myTeam = inA ? m.teamA : m.teamB;
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    myTeam.filter(x => x.id !== p.id).forEach(partner => {
      if (!partnerMap[partner.id]) partnerMap[partner.id] = { name: partner.name, id: partner.id, games: 0, wins: 0 };
      partnerMap[partner.id].games++;
      if (win) partnerMap[partner.id].wins++;
    });
  });
  const bestPartner = Object.values(partnerMap).sort((a, b) => b.wins - a.wins)[0];
  const partnerHTML = bestPartner ? (() => {
    const pc = getAvatarColor(bestPartner.id);
    const pwr = bestPartner.games > 0 ? Math.round(bestPartner.wins / bestPartner.games * 100) : 0;
    const bpP = (db.players||[]).find(x=>x.id===bestPartner.id) || bestPartner;
    return `<div class="pp2-partner">
      <div class="pp2-partner-av ${getGachaFrameClass(bpP)}" style="background:${pc[1]};color:${pc[0]};position:relative;isolation:isolate">${getGachaFrameInner(bpP)}${getInitial(bestPartner.name)}</div>
      <div style="flex:1"><div style="font-weight:600;font-size:0.88rem" class="${getGachaNameClass(bpP)}">${esc(bestPartner.name)}</div><div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${bestPartner.games} ${t('matches_with')} · ${t('won')} ${pwr}%</div></div>
      <div style="font-family:'Rajdhani';font-size:1rem;font-weight:700;color:var(--neon)">${bestPartner.wins}W</div>
    </div>`;
  })() : `<div class="text-muted" style="font-size:0.8rem;padding:8px 0">${t('no_doubles')}</div>`;

  // Match History mini
  const histHTML = myMatches.slice(0, 8).map(m => {
    const inA = m.teamA.some(x => x.id === p.id);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    const opp = inA ? m.teamB : m.teamA;
    const _md = m.date ? new Date(m.date) : null;
    const date = (_md && !isNaN(_md)) ? _md.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
    return `<div class="pp2-hist">
      <div class="pp2-hist-res ${win ? 'w' : 'l'}">${win ? t('win_label') : t('lose_label')}</div>
      <div style="flex:1;color:var(--muted)">vs ${formatTeamNames(opp)}</div>
      <div style="font-family:'Rajdhani';font-weight:700;font-size:0.88rem">${m.scoreA}-${m.scoreB}</div>
      <div style="font-size:0.7rem;color:var(--muted);white-space:nowrap">${date}</div>
    </div>`;
  }).join('') || `<div class="text-muted" style="font-size:0.8rem;padding:8px 0">${t('no_match')}</div>`;

  const rankGradients = {
    king: 'linear-gradient(135deg,#ffd700,#ffaa00)',
    master: 'linear-gradient(135deg,#ff6b35,#ff4500)',
    diamond: 'linear-gradient(135deg,#b044f0,#7b1fa2)',
    platinum: 'linear-gradient(135deg,#48d1cc,#009688)',
    gold: 'linear-gradient(135deg,#ffd700,#ff8f00)',
    silver: 'linear-gradient(135deg,#a8b8c8,#7a8a9a)',
    bronze: 'linear-gradient(135deg,#cd7f32,#a0522d)'
  };

  const _hasTG = p.ownedEffects && p.ownedEffects.includes('rotating_arcs');
  const html = `
  <div class="pp-overlay" id="ppOverlayEl" onclick="closePlayerProfile(event)">    <div class="pp-sheet2" id="ppSheet2">
      <div class="pp2-handle"></div>
      <div class="pp2-hero" id="pp2HeroEl" style="${_hasTG ? 'position:relative;isolation:isolate;border-radius:18px;padding:18px;margin:-4px;' : ''}">
        ${_hasTG ? '<div class="tcf-hero-glow"></div>' : ''}
        ${_hasTG ? thunderGodAvatarHTML(getAvatar(p.id, p.name).content, 80, colors[1], colors[0]) : `<div class="pp2-av ${getGachaFrameClass(p)}" style="background:${colors[1]};color:${colors[0]};position:relative;isolation:isolate">${getGachaFrameInner(p)}${getInitial(p.name)}${!getGachaFrameClass(p)?`<div class="pp2-av-ring" style="background:${rankGradients[rank.id]||rankGradients.bronze}"></div>`:''}${rank.id==='king'&&_resolveFrameKey(p.gachaFrame)!=='solaremperor'?_kingCrownHTML():''}</div>`}
        <div class="pp2-hero-text">
          <div class="pp2-name ${getGachaNameClass(p)}">${esc(p.name)}</div>
          ${getPresenceHTML(p) ? `<div style="margin-top:4px">${getPresenceHTML(p)}</div>` : ''}
          <div style="margin-top:4px;display:flex;flex-wrap:wrap;align-items:center;gap:5px">${getRankBadgeSVG(p.pts,p.id,64)}${(p.customAch||[]).map(a=>`<span class="cach-badge cach-frame-${a.frame||'gold'}" title="${esc(a.desc||'')}" style="font-size:0.62rem;padding:2px 8px;line-height:1.4">${esc(a.icon||'🏆')} ${esc(a.title)}</span>`).join('')}</div>
          <div class="pp2-elo">${p.pts} <span style="font-size:0.72rem;color:var(--muted)">${t('pts')}</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
            <div style="text-align:center;padding:8px 6px;background:rgba(255,255,255,0.05);border-radius:12px;border:1px solid var(--glass-border)">
              <div style="font-size:0.62rem;color:var(--muted);margin-bottom:4px;letter-spacing:0.03em">${t('cur_rank_pos')}</div>
              <div style="font-family:'Rajdhani';font-size:1.5rem;font-weight:700;color:var(--neon);line-height:1">#${rankPos}</div>
              ${getRankBadgeSVG(p.pts,p.id,36)}
            </div>
            <div style="text-align:center;padding:8px 6px;background:rgba(255,255,255,0.05);border-radius:12px;border:1px solid ${peakPos < rankPos?'rgba(255,215,0,0.4)':'var(--glass-border)'}">
              <div style="font-size:0.62rem;color:var(--muted);margin-bottom:4px;letter-spacing:0.03em">${t('peak_rank_pos')}${peakPos < rankPos?' 👑':''}</div>
              <div style="font-family:'Rajdhani';font-size:1.5rem;font-weight:700;color:var(--gold);line-height:1">#${peakPos}</div>
              ${getRankBadgeSVG(peakElo,p.id,36)}
            </div>
          </div>
        </div>
        <button class="pp2-close" onclick="closePlayerProfile()">✕</button>
      </div>
      <div class="pp2-body">
        <div class="pp2-stats">
          <div class="pp2-stat"><div class="pp2-stat-n">${p.wins + p.losses}</div><div class="pp2-stat-l">${t('matches_with').split(' ')[0]||'แมตช์'}</div></div>
          <div class="pp2-stat"><div class="pp2-stat-n" style="color:var(--neon)">${p.wins}</div><div class="pp2-stat-l">${t('wins')}</div></div>
          <div class="pp2-stat"><div class="pp2-stat-n" style="color:var(--red)">${p.losses}</div><div class="pp2-stat-l">${t('losses')}</div></div>
          <div class="pp2-stat"><div class="pp2-stat-n" style="color:${wr>=50?'var(--neon)':'var(--red)'}">${wr}%</div><div class="pp2-stat-l">${t('win_rate')}</div></div>
        </div>

        <div class="pp2-sec">${t('form_10')}</div>
        <div class="pp2-form">${formDots}</div>

        <div class="pp2-sec">📊 ${_lang === 'en' ? 'Days at Each Rank' : 'วันที่อยู่แต่ละอันดับ'}</div>
        ${buildRankDaysHTML(p.id)}

        <div class="pp2-sec">${t('ranking_hist')}</div>
        ${buildRankingChart(p.id)}

        ${(() => {
          const kh = _getKingHistory(p.id);
          if (!kh || !kh.firstDate) return '';
          const firstDateStr = new Date(kh.firstDate).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit' });
          const lastDateStr  = kh.lastDate ? new Date(kh.lastDate).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit' }) : firstDateStr;
          const isCurrentKing = (() => { try { const s=JSON.parse(localStorage.getItem('badminton_king_tracker')||'null'); return s && s.id === p.id; } catch(e){return false;} })();
          return `
          <div style="background:linear-gradient(135deg,rgba(255,215,0,0.07),rgba(255,170,0,0.04));border:1px solid rgba(255,215,0,0.25);border-radius:14px;padding:12px 14px;margin-bottom:4px">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
              <span style="font-size:1.1rem;filter:drop-shadow(0 0 6px rgba(255,215,0,0.8))">👑</span>
              <span style="font-size:0.8rem;font-weight:700;color:#FFD700;letter-spacing:0.06em;text-transform:uppercase">King History</span>
              ${isCurrentKing ? '<span style="margin-left:auto;font-size:0.6rem;background:rgba(255,215,0,0.15);color:#FFD700;border:1px solid rgba(255,215,0,0.3);border-radius:20px;padding:2px 8px;font-weight:600">👑 REIGNING</span>' : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center">
              <div style="padding:7px 4px;background:rgba(0,0,0,0.2);border-radius:10px">
                <div style="font-size:0.6rem;color:rgba(255,230,100,0.6);margin-bottom:3px">First Crown</div>
                <div style="font-size:0.72rem;font-weight:700;color:#FFE566">${firstDateStr}</div>
              </div>
              <div style="padding:7px 4px;background:rgba(0,0,0,0.2);border-radius:10px">
                <div style="font-size:0.6rem;color:rgba(255,230,100,0.6);margin-bottom:3px">Reigns</div>
                <div style="font-family:'Rajdhani';font-size:1.2rem;font-weight:700;color:#FFD700;line-height:1">${kh.reignCount || 1}</div>
              </div>
              <div style="padding:7px 4px;background:rgba(0,0,0,0.2);border-radius:10px">
                <div style="font-size:0.6rem;color:rgba(255,230,100,0.6);margin-bottom:3px">Peak ELO</div>
                <div style="font-family:'Rajdhani';font-size:1.2rem;font-weight:700;color:#FFCC33;line-height:1">${kh.maxElo || p.pts}</div>
              </div>
            </div>
          </div>`;
        })()}

        <div class="pp2-sec">${t('h2h')}</div>
        ${h2hHTML}

        <div class="pp2-sec">${t('best_partner')}</div>
        ${partnerHTML}

        <div class="pp2-sec">${t('recent_hist')}</div>
        ${histHTML}
        ${(() => {
          const sorted2 = db.players && db.players.length ? [...db.players].sort((a,b)=>b.pts-a.pts) : [];
          const kingPlayer = sorted2[0] && sorted2[0].pts >= 2000 ? sorted2[0] : null;
          const kc = getKingChallenge();
          const isPendingChallenger = kc && kc.id === p.id;
          if (!kingPlayer || kingPlayer.id === p.id) return '';
          const label = isPendingChallenger ? '🤺 ยกเลิกการท้าชิง King' : `🤺 ท้าชิง King (${kingPlayer.name})`;
          return `<button class="kc-btn${isPendingChallenger?' kc-active':''}" onclick="declareKingChallenge(${p.id},'${p.name.replace(/'/g,"\\'")}')">
            ${label}<small style="display:block;font-size:0.65rem;font-weight:400;margin-top:3px;opacity:0.75">${isPendingChallenger?'ยกเลิกการท้าชิงที่รอดำเนินการ':'ชนะ King ครั้งถัดไป = +50 ELO โบนัส'}</small>
          </button>`;
        })()}
      </div>
    </div>
  </div>`;

  const overlay = document.getElementById('ppOverlay');
  overlay.innerHTML = html;
  overlay.style.display = 'block';
  document.body.dataset.ppLock = '1';
  document.body.style.overflow = 'hidden';
  // Apply ThunderCardFrame to hero section for Thunder God players
  if (_hasTG) {
    const heroEl = document.getElementById('pp2HeroEl');
    if (heroEl) applyThunderCardFrame(heroEl, 18, 2.5, true);
  }
  // Start the King crown sparkles once the sheet is in the DOM (King only).
  const kcCanvas = document.getElementById('kcSparkCanvas');
  if (kcCanvas) requestAnimationFrame(() => _initKingCrownSparkles(kcCanvas));
}

function closePlayerProfile(e) {
  if (e && e.target !== document.getElementById('ppOverlayEl')) return;
  if (_kingCrownRaf) { cancelAnimationFrame(_kingCrownRaf); _kingCrownRaf = null; }
  const overlayEl = document.getElementById('ppOverlayEl');
  const sheet = document.getElementById('ppSheet2');
  if (!overlayEl) return;
  overlayEl.classList.add('pp-closing');
  if (sheet) sheet.style.animation = 'ppDown 0.22s ease forwards';
  setTimeout(() => {
    document.getElementById('ppOverlay').style.display = 'none';
    document.getElementById('ppOverlay').innerHTML = '';
    delete document.body.dataset.ppLock;
    if (!document.body.dataset.ruLock && !document.body.dataset.refLock) document.body.style.overflow = '';
  }, 220);
}

function buildEloHistory(playerId) {
  // reconstruct ELO from oldest to newest
  const playerMatches = [...db.matches].filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId)).reverse();
  const p = db.players.find(x => x.id === playerId);
  if (!p) return [];
  // Walk backwards from current pts to estimate starting points
  let pts = p.pts;
  const history = [];
  const reversed = [...playerMatches].reverse();
  reversed.forEach(m => {
    const inA = m.teamA.some(x => x.id === playerId);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    history.push(pts);
    pts = win ? Math.max(0, pts - m.pts.gain) : Math.min(pts + m.pts.loss, 9999);
  });
  history.reverse();
  history.push(p.pts); // current
  return history.length > 1 ? history : [p.pts];
}

// ===== PENDING RANK-UP NOTIFICATIONS (สำหรับผู้เล่นที่ Admin อนุมัติตอนออฟไลน์) =====

function checkPendingRankUps() {
  if (!currentUser) return;
  const key = 'badminton_rankup_queue';
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
  const mine = queue.filter(x => x.playerId === currentUser.id);
  const rest  = queue.filter(x => x.playerId !== currentUser.id);
  if (mine.length > 0) {
    localStorage.setItem(key, JSON.stringify(rest));
    mine.forEach(item => {
      const rc = RANKS_DATA_RU[item.rankId];
      if (rc) showRankUp(rc, item.playerName, item.gainPts);
    });
  }
}

// Session-level dedup: remember the highest pts level we already showed a rank-up for this session.
const _ruShownPts = {};

// Cross-device rank-up detection: compares stored pts baseline vs current DB pts.
// Triggers when admin records a match for the player on a different device.
function checkSelfRankUpFromDB() {
  if (!currentUser) return;
  const me = db.players.find(p => p.id === currentUser.id);
  if (!me) return;
  const key = `badminton_lastpts_${currentUser.id}`;
  const stored = localStorage.getItem(key);
  const lastPts = stored !== null ? parseInt(stored, 10) : null;
  // Always refresh baseline
  localStorage.setItem(key, String(me.pts));
  if (lastPts === null || !Number.isFinite(lastPts)) return;
  if (me.pts <= lastPts) return;
  // Session dedup: skip if we already showed an animation for this pts level this session
  if (_ruShownPts[currentUser.id] >= me.pts) return;
  _ruShownPts[currentUser.id] = me.pts;
  checkAndShowRankUp(lastPts, me.pts, me.name, me.pts - lastPts);
}

// ============================================================
// ===== FEATURE: STREAK SYSTEM =====
// ============================================================
function getPlayerStreak(playerId) {
  // Get consecutive wins from most recent matches
  const pMatches = [...db.matches]
    .filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId))
    .sort((a, b) => new Date(b.date || b.played_at) - new Date(a.date || a.played_at));

  let streak = 0;
  for (const m of pMatches) {
    const inA = m.teamA.some(x => x.id === playerId);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    if (win) streak++;
    else break;
  }
  return streak;
}

function hasStreakFire(playerId) {
  return getPlayerStreak(playerId) >= 5;
}

// ============================================================
// ===== FEATURE: NEMESIS (ศัตรูตัวฉกาจ) =====
// ============================================================
function getNemesis(playerId) {
  const pMatches = db.matches.filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId));
  const nemMap = {};
  pMatches.forEach(m => {
    const inA = m.teamA.some(x => x.id === playerId);
    const oppTeam = inA ? m.teamB : m.teamA;
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    oppTeam.forEach(opp => {
      if (!nemMap[opp.id]) nemMap[opp.id] = { id: opp.id, name: opp.name, losses: 0, wins: 0 };
      if (!win) nemMap[opp.id].losses++;
      else nemMap[opp.id].wins++;
    });
  });
  // nemesis = opponent you lose to the most (min 2 losses)
  const candidates = Object.values(nemMap).filter(x => x.losses >= 2);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.losses - a.losses)[0];
}

// ============================================================
// ===== FEATURE: RANK SCORE OVER TIME CHART (full SVG) =====
// ============================================================
function buildRankingChart(playerId, rangeDays) {
  return `<div id="rkHost_${playerId}">${_buildRankingChartInner(playerId, rangeDays)}</div>`;
}

// Re-render only the chart body when the user switches time range
function setRankChartRange(playerId, rangeDays) {
  const host = document.getElementById('rkHost_' + playerId);
  if (host) host.innerHTML = _buildRankingChartInner(playerId, rangeDays);
}

// Time-range pills (7d / 30d / all) — lets you focus on recent movement
function _rkRangeToggle(playerId, active) {
  const opts = _lang === 'en'
    ? [[7, '7d'], [30, '30d'], [0, 'All']]
    : [[7, '7 วัน'], [30, '30 วัน'], [0, 'ทั้งหมด']];
  return `<div class="rk-range">${opts.map(([v, l]) =>
    `<button class="rk-range-btn${(active || 0) === v ? ' on' : ''}" onclick="setRankChartRange(${playerId},${v})">${l}</button>`
  ).join('')}</div>`;
}

function _buildRankingChartInner(playerId, rangeDays) {
  // Reconstruct rank-score (pts) at each match point over time
  const p = db.players.find(x => x.id === playerId);
  if (!p) return '';

  const playerMatches = [...db.matches]
    .filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId))
    .sort((a, b) => new Date(a.date || a.played_at) - new Date(b.date || b.played_at));

  const _msg = m => `<div style="text-align:center;color:var(--muted);font-size:0.78rem;padding:14px 0">${m}</div>`;
  if (playerMatches.length < 2)
    return _msg(_lang === 'en' ? 'Not enough data yet (play at least 2 matches)' : 'ยังไม่มีข้อมูลเพียงพอ (ต้องเล่นอย่างน้อย 2 แมตช์)');

  // Walk backwards from current pts to reconstruct the forward score timeline
  let walk = p.pts;
  const after = []; // pts AFTER each match, in forward order
  const wins = [];  // true = win, false = loss for each match (forward order)
  [...playerMatches].reverse().forEach(m => {
    const inA = m.teamA.some(x => x.id === playerId);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    after.unshift(walk);
    wins.unshift(win);
    walk = win ? Math.max(0, walk - (m.pts?.gain || 0)) : Math.min(walk + (m.pts?.loss || 0), 9999);
  });
  const fullSeries  = [walk, ...after];  // index 0 = before first match
  const fullDates   = [null, ...playerMatches.map(m => new Date(m.date || m.played_at))];
  const fullResults = [null, ...wins];   // null = starting point, else true/false
  const N = fullSeries.length;

  // Default range: focus on the last 30 days when there is enough recent data
  if (rangeDays === undefined || rangeDays === null) {
    const cut30 = Date.now() - 30 * 86400000;
    const recent = fullDates.filter(d => d && d.getTime() >= cut30).length;
    rangeDays = recent >= 2 ? 30 : 0;
  }
  rangeDays = Number(rangeDays) || 0;
  const toggle = _rkRangeToggle(playerId, rangeDays);

  // Slice to the selected window (keep one anchor point just before it)
  let series = fullSeries, dates = fullDates, matchResults = fullResults;
  if (rangeDays > 0) {
    const cut = Date.now() - rangeDays * 86400000;
    let startIdx = -1;
    for (let i = 1; i < N; i++) { if (fullDates[i] && fullDates[i].getTime() >= cut) { startIdx = i; break; } }
    if (startIdx === -1)
      return toggle + _msg(_lang === 'en' ? 'No matches in this period' : 'ไม่มีแมตช์ในช่วงนี้');
    const from = Math.max(0, startIdx - 1);
    series       = fullSeries.slice(from);
    dates        = fullDates.slice(from);
    matchResults = fullResults.slice(from);
  }

  const n = series.length;
  if (n < 2)
    return toggle + _msg(_lang === 'en' ? 'Not enough data in this period' : 'ข้อมูลในช่วงนี้ไม่พอแสดงกราฟ');

  // Date for each series point (index 0 may be the pre-window anchor; null = "เริ่ม")
  const fmtDate = d => d ? d.toLocaleDateString(_lang === 'en' ? 'en-GB' : 'th-TH', { day: 'numeric', month: 'short' }) : (_lang === 'en' ? 'start' : 'เริ่ม');

  const startPts = series[0];
  const curPts  = series[n - 1];
  const peakPts = Math.max(...series);
  const peakIdx = series.lastIndexOf(peakPts);
  const lowPts  = Math.min(...series);
  const delta   = curPts - startPts;
  const improving = delta >= 0;
  const lineColor = improving ? '#00f5a0' : '#ff4757';

  // Y-axis scaling with headroom
  const rawRange = peakPts - lowPts;
  const padPts = Math.max(rawRange * 0.12, 8);
  let yMax = peakPts + padPts;
  let yMin = Math.max(0, lowPts - padPts);
  if (yMax - yMin < 1) { yMax = yMin + 1; }

  const W = 500, H = 170, padL = 42, padR = 16, padT = 16, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const toX = i => padL + (i / (n - 1)) * chartW;
  const toY = v => padT + (1 - (v - yMin) / (yMax - yMin)) * chartH;

  // Straight segments so every win (up) and loss (down) is visible as a distinct step
  const pathD = 'M' + series.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' L');

  // Area fill below the line
  const lx = toX(n - 1).toFixed(1), ly = toY(curPts).toFixed(1);
  const baseY = (padT + chartH).toFixed(1);
  const areaD = pathD + ` L${lx},${baseY} L${padL},${baseY} Z`;

  // Y-axis ticks (pts values)
  const yTickCount = 5;
  const yTicks = [];
  for (let i = 0; i < yTickCount; i++) {
    yTicks.push(Math.round(yMin + (i / (yTickCount - 1)) * (yMax - yMin)));
  }
  const yAxisSVG = [...new Set(yTicks)].map(v => {
    const y = toY(v);
    return `<text x="${padL - 6}" y="${y + 3.5}" fill="rgba(255,255,255,0.35)" font-size="9" text-anchor="end" font-family="Rajdhani,sans-serif" font-weight="600">${v}</text>`;
  }).join('');
  const gridSVG = [...new Set(yTicks)].map(v => {
    const y = toY(v).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="0.6" stroke-dasharray="2,4"/>`;
  }).join('');

  // Peak (all-time high) dashed gold line
  const peakY = toY(peakPts).toFixed(1);
  const peakLineSVG = `<line x1="${padL}" y1="${peakY}" x2="${padL + chartW}" y2="${peakY}" stroke="rgba(255,215,0,0.35)" stroke-width="1" stroke-dasharray="4,3"/>
    <text x="${padL + chartW}" y="${parseFloat(peakY) - 4}" fill="rgba(255,215,0,0.7)" font-size="8.5" text-anchor="end" font-family="Rajdhani,sans-serif" font-weight="700">🏔 ${peakPts}</text>`;

  // X-axis date labels
  const step = Math.max(1, Math.floor(n / 5));
  const xAxisSVG = series.map((_, i) => {
    if (i % step !== 0 && i !== n - 1) return '';
    const label = i === n - 1 ? (_lang === 'en' ? 'now' : 'ล่าสุด') : fmtDate(dates[i]);
    return `<text x="${toX(i).toFixed(1)}" y="${padT + chartH + 16}" fill="rgba(255,255,255,0.3)" font-size="8" text-anchor="middle" font-family="Rajdhani,sans-serif">${label}</text>`;
  }).join('');

  // Dots at each data point — green = win, red = loss, gold = peak
  const dotsSVG = series.map((v, i) => {
    const isPeak = i === peakIdx;
    const res = matchResults[i];
    const dotColor = isPeak ? '#ffd700' : res === true ? '#00f5a0' : res === false ? '#ff4757' : 'rgba(255,255,255,0.4)';
    const r = isPeak ? 4.5 : (res !== null ? 3 : 2);
    return `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="${r}" fill="${dotColor}" opacity="${isPeak ? 1 : 0.85}"/>`;
  }).join('');

  return `
  ${toggle}
  <div style="position:relative">
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">
      <defs>
        <linearGradient id="rkGrad_${playerId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.24"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="rkClip_${playerId}">
          <rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}"/>
        </clipPath>
      </defs>
      <!-- grid lines -->
      ${gridSVG}
      <!-- peak line -->
      ${peakLineSVG}
      <!-- area -->
      <path d="${areaD}" fill="url(#rkGrad_${playerId})" clip-path="url(#rkClip_${playerId})"/>
      <!-- line -->
      <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#rkClip_${playerId})"/>
      <!-- dots -->
      <g clip-path="url(#rkClip_${playerId})">${dotsSVG}</g>
      <!-- current point pulse -->
      <circle cx="${lx}" cy="${ly}" r="9" fill="${lineColor}" opacity="0.15"/>
      <circle cx="${lx}" cy="${ly}" r="5" fill="${lineColor}" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>
      <!-- y axis -->
      ${yAxisSVG}
      <!-- x axis -->
      ${xAxisSVG}
    </svg>
    <div style="display:flex;align-items:center;gap:12px;margin-top:8px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:5px;font-size:0.72rem;color:var(--muted)">
        <span style="font-family:'Rajdhani';font-weight:700;color:var(--text)">${curPts}</span> pts
      </div>
      <div style="display:flex;align-items:center;gap:5px;font-size:0.72rem;color:var(--muted)">
        🏔 สูงสุด <span style="font-family:'Rajdhani';font-weight:700;color:var(--gold)">${peakPts}</span>
      </div>
      <div style="margin-left:auto;font-family:'Rajdhani';font-size:0.95rem;font-weight:700;color:${lineColor}">
        ${improving ? '▲ +' : '▼ '}${delta} pts
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
      <div style="display:flex;align-items:center;gap:4px;font-size:0.68rem;color:var(--muted)"><span style="width:8px;height:8px;border-radius:50%;background:#00f5a0;display:inline-block"></span>${_lang==='en'?'Win':'ชนะ'}</div>
      <div style="display:flex;align-items:center;gap:4px;font-size:0.68rem;color:var(--muted)"><span style="width:8px;height:8px;border-radius:50%;background:#ff4757;display:inline-block"></span>${_lang==='en'?'Loss':'แพ้'}</div>
      <div style="display:flex;align-items:center;gap:4px;font-size:0.68rem;color:var(--muted)"><span style="width:8px;height:8px;border-radius:50%;background:#ffd700;display:inline-block"></span>${_lang==='en'?'Peak':'สูงสุด'}</div>
    </div>
  </div>`;
}

// ============================================================
// ===== FEATURE: RANK DAYS (days spent at each rank position) =====
// ============================================================
function calcRankDays(playerId) {
  const p = db.players.find(x => x.id === playerId);
  if (!p) return {};

  const playerMatches = [...db.matches]
    .filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId))
    .sort((a, b) => new Date(a.date || a.played_at) - new Date(b.date || b.played_at));

  if (!playerMatches.length) return {};

  // Reconstruct pts at each match point by walking backwards from current pts
  let pts = p.pts;
  const ptsHistory = [];
  [...playerMatches].reverse().forEach(m => {
    const inA = m.teamA.some(x => x.id === playerId);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    ptsHistory.unshift(pts);
    pts = win ? Math.max(0, pts - m.pts.gain) : Math.min(pts + m.pts.loss, 9999);
  });

  const otherPlayers = db.players.filter(x => x.id !== playerId);
  const rankHistory = ptsHistory.map(myPts => otherPlayers.filter(o => o.pts > myPts).length + 1);

  const rankDays = {};
  const now = Date.now();

  for (let i = 0; i < playerMatches.length; i++) {
    const rank = rankHistory[i];
    const startMs = new Date(playerMatches[i].date || playerMatches[i].played_at).getTime();
    const endMs = i + 1 < playerMatches.length
      ? new Date(playerMatches[i + 1].date || playerMatches[i + 1].played_at).getTime()
      : now;
    const days = Math.max(1, Math.round((endMs - startMs) / 86400000));
    rankDays[rank] = (rankDays[rank] || 0) + days;
  }

  return rankDays;
}

function buildRankDaysHTML(playerId) {
  const rankDays = calcRankDays(playerId);
  const entries = Object.entries(rankDays)
    .map(([rank, days]) => ({ rank: parseInt(rank), days }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);

  if (!entries.length) return `<div style="text-align:center;color:var(--muted);font-size:0.78rem;padding:8px 0">${t('no_data')}</div>`;

  const maxDays = Math.max(...entries.map(e => e.days));
  const rankColors = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };

  return entries.map(({ rank, days }) => {
    const pct = Math.round((days / maxDays) * 100);
    const color = rankColors[rank] || 'var(--neon)';
    const dayLabel = _lang === 'en' ? (days === 1 ? '1 day' : `${days} days`) : `${days} วัน`;
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <div style="font-family:'Rajdhani';font-weight:700;font-size:0.92rem;color:${color};min-width:28px">#${rank}</div>
      <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
      </div>
      <div style="font-family:'Rajdhani';font-size:0.82rem;font-weight:600;color:var(--muted);min-width:52px;text-align:right">${dayLabel}</div>
    </div>`;
  }).join('');
}

// ============================================================
// ===== FEATURE: WIN RATE CHART (sparkline) =====
// ============================================================
function buildWinRateChart(playerId, width = 80, height = 32) {
  // Build rolling win rate over last N matches (windows of 5)
  const pMatches = [...db.matches]
    .filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId))
    .sort((a, b) => new Date(a.date || a.played_at) - new Date(b.date || b.played_at));

  if (pMatches.length < 3) return '';

  const windowSize = 3;
  const points = [];
  for (let i = windowSize - 1; i < pMatches.length; i++) {
    const window = pMatches.slice(Math.max(0, i - windowSize + 1), i + 1);
    const wins = window.filter(m => {
      const inA = m.teamA.some(x => x.id === playerId);
      return (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    }).length;
    points.push(wins / window.length);
  }

  if (points.length < 2) return '';

  const pad = 4;
  const W = width, H = height;
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - pad * 2));
  const ys = points.map(v => H - pad - v * (H - pad * 2));

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const areaD = pathD + ` L${xs[xs.length-1].toFixed(1)},${H} L${xs[0].toFixed(1)},${H} Z`;

  const last = points[points.length - 1];
  const first = points[0];
  const color = last >= first ? '#00f5a0' : '#ff4757';

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
    <defs>
      <linearGradient id="wrg_${playerId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#wrg_${playerId})"/>
    <path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${xs[xs.length-1].toFixed(1)}" cy="${ys[ys.length-1].toFixed(1)}" r="3" fill="${color}"/>
  </svg>`;
}

