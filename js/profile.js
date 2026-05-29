// ==================== PLAYER PROFILE BOTTOM SHEET ====================
function openPlayerProfile(playerId) {
  const p = db.players.find(x => x.id === playerId);
  if (!p) return;

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

  // ELO Timeline SVG
  const chartSVG = buildEloChart(eloHistory);

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
        <div class="pp2-h2h-name ${getGachaNameClass(oppP)}">${h.name}</div>
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
      <div style="flex:1"><div style="font-weight:600;font-size:0.88rem" class="${getGachaNameClass(bpP)}">${bestPartner.name}</div><div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${bestPartner.games} ${t('matches_with')} · ${t('won')} ${pwr}%</div></div>
      <div style="font-family:'Rajdhani';font-size:1rem;font-weight:700;color:var(--neon)">${bestPartner.wins}W</div>
    </div>`;
  })() : `<div class="text-muted" style="font-size:0.8rem;padding:8px 0">${t('no_doubles')}</div>`;

  // Match History mini
  const histHTML = myMatches.slice(0, 8).map(m => {
    const inA = m.teamA.some(x => x.id === p.id);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    const opp = inA ? m.teamB : m.teamA;
    const date = new Date(m.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
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

  const html = `
  <div class="pp-overlay" id="ppOverlayEl" onclick="closePlayerProfile(event)">    <div class="pp-sheet2" id="ppSheet2">
      <div class="pp2-handle"></div>
      <div class="pp2-hero">
        <div class="pp2-av ${getGachaFrameClass(p)}" style="background:${colors[1]};color:${colors[0]}">
          ${getGachaFrameInner(p)}${getInitial(p.name)}
          <div class="pp2-av-ring" style="background:${rankGradients[rank.id] || rankGradients.bronze}"></div>
          ${rank.id === 'king' && _resolveFrameKey(p.gachaFrame) !== 'solaremperor' ? '<div style="position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:1.5rem;z-index:5;filter:drop-shadow(0 2px 8px rgba(255,215,0,0.9));animation:kingCrownFloat 2.2s ease-in-out infinite;pointer-events:none">👑</div>' : ''}
        </div>
        <div class="pp2-hero-text">
          <div class="pp2-name ${getGachaNameClass(p)}">${p.name}</div>
          <div style="margin-top:4px;display:flex;flex-wrap:wrap;align-items:center;gap:5px"><span class="rank-badge ${rank.class}">${getRankLabel(p.pts,p.id)}</span>${(p.customAch||[]).map(a=>`<span class="cach-badge cach-frame-${a.frame||'gold'}" title="${a.desc||''}" style="font-size:0.62rem;padding:2px 8px;line-height:1.4">${a.icon||'🏆'} ${a.title}</span>`).join('')}</div>
          <div class="pp2-elo">${p.pts} <span style="font-size:0.72rem;color:var(--muted)">${t('pts')}</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
            <div style="text-align:center;padding:8px 6px;background:rgba(255,255,255,0.05);border-radius:12px;border:1px solid var(--glass-border)">
              <div style="font-size:0.62rem;color:var(--muted);margin-bottom:4px;letter-spacing:0.03em">${t('cur_rank_pos')}</div>
              <div style="font-family:'Rajdhani';font-size:1.5rem;font-weight:700;color:var(--neon);line-height:1">#${rankPos}</div>
              <span class="rank-badge ${rank.class}" style="font-size:0.58rem;margin-top:4px;display:inline-block">${rank.label}</span>
            </div>
            <div style="text-align:center;padding:8px 6px;background:rgba(255,255,255,0.05);border-radius:12px;border:1px solid ${peakPos < rankPos?'rgba(255,215,0,0.4)':'var(--glass-border)'}">
              <div style="font-size:0.62rem;color:var(--muted);margin-bottom:4px;letter-spacing:0.03em">${t('peak_rank_pos')}${peakPos < rankPos?' 👑':''}</div>
              <div style="font-family:'Rajdhani';font-size:1.5rem;font-weight:700;color:var(--gold);line-height:1">#${peakPos}</div>
              <span class="rank-badge ${peakRank.class}" style="font-size:0.58rem;margin-top:4px;display:inline-block">${peakRank.label}</span>
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

        <div class="pp2-sec">${t('ranking_hist')}</div>
        ${buildRankingChart(p.id)}

        <div class="pp2-sec">${t('elo_timeline')}</div>
        ${chartSVG}

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
          const kingPlayer = sorted2[0] && sorted2[0].pts >= 3000 ? sorted2[0] : null;
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
}

function closePlayerProfile(e) {
  if (e && e.target !== document.getElementById('ppOverlayEl')) return;
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

function buildEloChart(data) {
  if (data.length < 2) return '<div style="text-align:center;color:var(--muted);font-size:0.78rem;padding:10px 0">ยังไม่มีข้อมูลเพียงพอ</div>';
  const W = 500, H = 80, pad = 10;
  const min = Math.min(...data) - 5, max = Math.max(...data) + 5;
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  });
  const pathD = 'M' + pts.join(' L');
  const areaD = pathD + ` L${W - pad},${H} L${pad},${H} Z`;
  const last = data[data.length - 1], first = data[0];
  const trending = last >= first;
  const color = trending ? '#00f5a0' : '#ff4757';
  return `<svg class="pp2-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#eg)"/>
    <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${pts[pts.length-1].split(',')[0]}" cy="${pts[pts.length-1].split(',')[1]}" r="4" fill="${color}" opacity="0.9"/>
  </svg>`;
}

// ===== PENDING RANK-UP NOTIFICATIONS (สำหรับผู้เล่นที่ Admin อนุมัติตอนออฟไลน์) =====
// Helper: detect if a player crossed INTO King rank (for broadcasting king anim to everyone watching)
function didCrossIntoKing(oldPts, newPts, playerId) {
  let wasKing = false;
  if (oldPts >= 3000) {
    const sortedOld = [...db.players].sort((a, b) => b.pts - a.pts);
    wasKing = !!(sortedOld[0] && sortedOld[0].id === playerId);
  }
  let willBeKing = false;
  if (newPts >= 3000) {
    // Project the new state for this player
    const projected = db.players.map(p => p.id === playerId ? {...p, pts: newPts} : p);
    const sortedNew = [...projected].sort((a, b) => b.pts - a.pts);
    willBeKing = !!(sortedNew[0] && sortedNew[0].id === playerId);
  }
  return !wasKing && willBeKing;
}

function queueRankUpForPlayer(playerId, oldPts, newPts, playerName, gainPts) {
  const key = 'badminton_rankup_queue';
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
  const oldRank = getRankByPts(oldPts);
  const newRank = getRankByPts(newPts);
  const rankOrder = ['bronze','silver','gold','platinum','diamond','master','king'];
  let effectiveOldRankId = oldRank.id;
  if (oldRank.id === 'master' && oldPts >= 3000) {
    const sorted = [...db.players].sort((a, b) => b.pts - a.pts);
    if (sorted[0] && sorted[0].name === playerName) effectiveOldRankId = 'king';
  }
  let effectiveNewRankId = newRank.id;
  if (newRank.id === 'master' && newPts >= 3000) {
    const sorted = [...db.players].sort((a, b) => b.pts - a.pts);
    if (sorted[0] && sorted[0].name === playerName) effectiveNewRankId = 'king';
  }
  const oldIdx = rankOrder.indexOf(effectiveOldRankId);
  const newIdx = rankOrder.indexOf(effectiveNewRankId);
  if (newIdx > oldIdx) {
    queue.push({ playerId, rankId: effectiveNewRankId, playerName, gainPts });
    localStorage.setItem(key, JSON.stringify(queue));
  }
}

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
// ===== FEATURE: RANKING HISTORY CHART (full SVG) =====
// ============================================================
function buildRankingChart(playerId) {
  // Reconstruct pts at each match point (same logic as buildEloHistory)
  const p = db.players.find(x => x.id === playerId);
  if (!p) return '';

  const playerMatches = [...db.matches]
    .filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId))
    .sort((a, b) => new Date(a.date || a.played_at) - new Date(b.date || b.played_at));

  if (playerMatches.length < 2) return '<div style="text-align:center;color:var(--muted);font-size:0.78rem;padding:14px 0">ยังไม่มีข้อมูลเพียงพอ (ต้องเล่นอย่างน้อย 2 แมตช์)</div>';

  // Build pts timeline by walking backwards from current pts
  let pts = p.pts;
  const ptsHistory = [];
  const reversedMatches = [...playerMatches].reverse();
  reversedMatches.forEach(m => {
    const inA = m.teamA.some(x => x.id === playerId);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    ptsHistory.unshift(pts);
    pts = win ? Math.max(0, pts - m.pts.gain) : Math.min(pts + m.pts.loss, 9999);
  });
  ptsHistory.push(p.pts); // current

  // Convert pts → leaderboard position at each point
  // For each historical pts value, compute position among all players
  // (simulate what other players' pts would be at that relative time — approximation:
  //  use current pts of others since we don't have full history for everyone)
  const otherPlayers = db.players.filter(x => x.id !== playerId);

  const rankHistory = ptsHistory.map(myPts => {
    // Count how many others have more pts than myPts (position = count + 1)
    const ahead = otherPlayers.filter(o => o.pts > myPts).length;
    return ahead + 1;
  });

  const totalPlayers = db.players.length;
  const minRank = 1;
  const maxRank = Math.max(...rankHistory, totalPlayers);

  const W = 500, H = 160, padL = 36, padR = 16, padT = 14, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = rankHistory.length;

  // Y: rank 1 = top, higher rank number = lower
  function toX(i) { return padL + (i / (n - 1)) * chartW; }
  function toY(rank) {
    // rank 1 → y = padT (top), rank maxRank → y = padT + chartH (bottom)
    return padT + ((rank - minRank) / (maxRank - minRank || 1)) * chartH;
  }

  const pathPts = rankHistory.map((r, i) => `${toX(i).toFixed(1)},${toY(r).toFixed(1)}`);
  const pathD   = 'M' + pathPts.join(' L');

  const currentRank = rankHistory[n - 1];
  const firstRank   = rankHistory[0];
  // Improving = rank number going down (closer to 1)
  const improving   = currentRank <= firstRank;
  const lineColor   = improving ? '#00f5a0' : '#ff4757';

  // Area fill — goes downward (worse rank direction = bottom of chart)
  const lx = toX(n - 1).toFixed(1), ly = toY(currentRank).toFixed(1);
  const areaD = pathD + ` L${lx},${(padT + chartH).toFixed(1)} L${padL},${(padT + chartH).toFixed(1)} Z`;

  // Y-axis: show rank numbers (1, 2, 3 ...)
  const yTicks = [];
  const tickCount = Math.min(maxRank, 6);
  for (let i = 0; i < tickCount; i++) {
    const r = Math.round(minRank + (i / (tickCount - 1)) * (maxRank - minRank));
    yTicks.push(r);
  }
  const yAxisSVG = [...new Set(yTicks)].map(r => {
    const y = toY(r);
    return `<text x="${padL - 5}" y="${y + 3.5}" fill="rgba(255,255,255,0.35)" font-size="9" text-anchor="end" font-family="Rajdhani,sans-serif" font-weight="600">#${r}</text>`;
  }).join('');

  // Dashed grid lines for each rank tick
  const gridSVG = [...new Set(yTicks)].map(r => {
    const y = toY(r).toFixed(1);
    const isFirst = r === 1;
    return `<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="${isFirst ? 'rgba(255,215,0,0.3)' : 'rgba(255,255,255,0.06)'}" stroke-width="${isFirst ? 1 : 0.6}" stroke-dasharray="${isFirst ? '4,3' : '2,4'}"/>`;
  }).join('');

  // #1 zone highlight
  const rank1Y    = toY(1).toFixed(1);
  const rank2Y    = toY(Math.min(2, maxRank)).toFixed(1);
  const band1H    = Math.abs(parseFloat(rank2Y) - parseFloat(rank1Y));

  // X-axis labels
  const step = Math.max(1, Math.floor(n / 5));
  const xAxisSVG = rankHistory.map((_, i) => {
    if (i % step !== 0 && i !== n - 1) return '';
    const label = i === 0 ? 'เริ่ม' : i === n - 1 ? 'ล่าสุด' : `#${i}`;
    return `<text x="${toX(i).toFixed(1)}" y="${padT + chartH + 15}" fill="rgba(255,255,255,0.3)" font-size="8" text-anchor="middle" font-family="Rajdhani,sans-serif">${label}</text>`;
  }).join('');

  // Dots at each data point (small)
  const dotsSVG = rankHistory.map((r, i) => {
    const isFirst = r === 1;
    return `<circle cx="${toX(i).toFixed(1)}" cy="${toY(r).toFixed(1)}" r="${isFirst ? 4 : 2.5}" fill="${isFirst ? '#ffd700' : lineColor}" opacity="${isFirst ? 1 : 0.6}"/>`;
  }).join('');

  return `
  <div style="position:relative">
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">
      <defs>
        <linearGradient id="rkGrad_${playerId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="rkClip_${playerId}">
          <rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}"/>
        </clipPath>
      </defs>
      <!-- #1 band highlight -->
      <rect x="${padL}" y="${rank1Y}" width="${chartW}" height="${Math.max(band1H, 8)}" fill="rgba(255,215,0,0.07)" clip-path="url(#rkClip_${playerId})"/>
      <!-- grid lines -->
      ${gridSVG}
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
    <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:5px;font-size:0.7rem;color:var(--muted)">
        <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="rgba(255,215,0,0.9)"/></svg>
        <span>อันดับ 1</span>
      </div>
      <div style="font-size:0.7rem;color:var(--muted)">จาก ${totalPlayers} คน</div>
      <div style="margin-left:auto;font-family:'Rajdhani';font-size:0.9rem;font-weight:700;color:${lineColor}">
        ${improving ? '▲' : '▼'} อันดับ #${currentRank}
      </div>
    </div>
  </div>`;
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

