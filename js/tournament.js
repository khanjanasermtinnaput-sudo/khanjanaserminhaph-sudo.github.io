// ── Global store: tournament data keyed by id (avoids JSON-in-onclick quoting bugs) ──
const _tourStore = {};

// ── 5. FORM INDICATOR ─────────────────────────────────────
function getFormIndicator(playerId) {
  const myMatches = db.matches.filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId));
  const last5 = myMatches.slice(0, 5);
  if (last5.length < 3) return { arrow: '→', cls: 'neutral' };
  let wins = 0, losses = 0;
  last5.forEach(m => {
    const inA = m.teamA.some(x => x.id === playerId);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    win ? wins++ : losses++;
  });
  if (wins >= 3) return { arrow: '↑', cls: 'up' };
  if (losses >= 3) return { arrow: '↓', cls: 'down' };
  return { arrow: '→', cls: 'neutral' };
}

// ── 6. BEST DAY OF WEEK ───────────────────────────────────
function getBestDayOfWeek(playerId) {
  const thDays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const myMatches = db.matches.filter(m => [...m.teamA, ...m.teamB].some(x => x.id === playerId));
  const wins = myMatches.filter(m => {
    const inA = m.teamA.some(x => x.id === playerId);
    return (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
  });
  if (!wins.length) return null;
  const counts = [0,0,0,0,0,0,0];
  wins.forEach(m => { counts[new Date(m.date).getDay()]++; });
  const maxDay = counts.indexOf(Math.max(...counts));
  return thDays[maxDay];
}

// ── 7 & 9. PITY SYSTEM + TILT WARNING ────────────────────
async function checkPitySystem(playerId, isWin) {
  try {
    const pl = db.players.find(x => x.id === playerId);
    if (!pl) return false;
    const newConsecLosses = isWin ? 0 : (pl.consecutiveLosses || 0) + 1;
    await dbUpdatePlayer(playerId, { consecutive_losses: newConsecLosses });
    pl.consecutiveLosses = newConsecLosses;
    if (!isWin && newConsecLosses >= 3 && currentUser && playerId === currentUser.id) {
      setTimeout(() => toast('⚠️ Tilt Warning! แพ้ 3 ติดแล้ว พักก่อนนะ!', 'error'), 1500);
    }
    if (!isWin && newConsecLosses >= 5) {
      await dbAddCoins(playerId, 5);
      if (currentUser && playerId === currentUser.id) {
        setTimeout(() => toast('😤 Pity! แพ้ 5 ติด +5 🪙', 'success'), 2000);
        return true;
      }
    }
    return false;
  } catch(e) { console.warn('checkPitySystem error:', e.message); return false; }
}

// ── 8. FIRST BLOOD ────────────────────────────────────────
async function checkFirstBlood(playerId) {
  try {
    const today = new Date().toISOString().slice(0,10);
    const todayWins = db.matches.filter(m => {
      if (!m.date) return false;
      const d = new Date(m.date).toISOString().slice(0,10);
      if (d !== today) return false;
      const inA = m.teamA.some(x => x.id === playerId);
      return (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    });
    if (todayWins.length === 0) {
      await dbAddCoins(playerId, 5);
      if (currentUser && playerId === currentUser.id) {
        setTimeout(() => toast('🩸 First Blood! ชนะแมตช์แรกวันนี้ +5 🪙', 'success'), 1000);
      }
    }
  } catch(e) { console.warn('checkFirstBlood error:', e.message); }
}

// ── 10. RACE TO GRAND FINAL ───────────────────────────────
function getTop4GrandFinal() {
  return [...db.players].sort((a,b) => b.pts - a.pts).slice(0, 4).map(p => p.id);
}
function isLastWeekOfMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() >= lastDay - 6;
}
function getGrandFinalBadge(playerId) {
  const top4 = getTop4GrandFinal();
  if (!top4.includes(playerId)) return '';
  return isLastWeekOfMonth()
    ? '<span class="gf-badge">🏆 Grand Final</span>'
    : '<span class="gf-badge">🏆 Top 4</span>';
}

// ── 11. TOURNAMENT BRACKET ────────────────────────────────

// ── DB helpers (unchanged) ──
async function dbGetTournaments() {
  try { return await supaFetch('tournaments?status=eq.active&order=created_at.desc'); } catch(e) { return []; }
}
async function dbCompleteTournament(id, hofMeta) {
  const t = await dbGetTournamentById(id);
  let groups = [];
  try { groups = typeof t?.groups === 'string' ? JSON.parse(t.groups) : (t?.groups || []); } catch(e) {}
  groups = groups.filter(g => !g._hof);
  groups.push({ _hof: true, ...hofMeta });
  await supaFetch(`tournaments?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed', groups: JSON.stringify(groups) }), prefer: 'return=minimal' });
}
async function dbGetHOFTournaments() {
  try { return await supaFetch('tournaments?status=eq.completed&order=created_at.desc&limit=50'); } catch(e) { return []; }
}
async function dbCreateTournament(name, tier, groups) {
  const rows = await supaFetch('tournaments', { method: 'POST', body: JSON.stringify({ name, tier, groups: JSON.stringify(groups) }) });
  return rows[0];
}
async function dbGetTournamentMatches(tournamentId) {
  try { return await supaFetch(`tournament_matches?tournament_id=eq.${tournamentId}&order=played_at.asc`); } catch(e) { return []; }
}
async function dbAddTournamentMatch(tournamentId, groupLetter, playerA, playerB, scoreA, scoreB, winnerId) {
  await supaFetch('tournament_matches', { method: 'POST', body: JSON.stringify({ tournament_id: tournamentId, group_letter: groupLetter, player_a: playerA, player_b: playerB, score_a: scoreA, score_b: scoreB, winner_id: winnerId }), prefer: 'return=minimal' });
}

// ── [NEW] Delete tournament + all its matches ──
async function dbDeleteTournament(tournamentId) {
  await supaFetch(`tournament_matches?tournament_id=eq.${tournamentId}`, { method: 'DELETE', prefer: 'return=minimal' });
  await supaFetch(`tournaments?id=eq.${tournamentId}`, { method: 'DELETE', prefer: 'return=minimal' });
}

// ── Fetch a single tournament by ID ──
async function dbGetTournamentById(id) {
  try {
    const rows = await supaFetch(`tournaments?id=eq.${id}`);
    return rows && rows[0] ? rows[0] : null;
  } catch(e) { return null; }
}

// ── Resolve stored tournament data (store first, DB fallback) ──
async function _resolveTourData(tournamentId) {
  if (_tourStore[tournamentId]) return _tourStore[tournamentId];
  const t = await dbGetTournamentById(tournamentId);
  if (!t) return null;
  let groups = [];
  try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
  const stored = { groups, matchType: getTournamentMatchType(groups), tier: t.tier, name: t.name };
  _tourStore[tournamentId] = stored;
  return stored;
}

// ── [NEW] Read match type from groups array (_meta sentinel) ──
function getTournamentMatchType(groups) {
  if (!Array.isArray(groups)) return '1v1';
  const meta = groups.find(g => g._meta);
  return meta?.matchType || '1v1';
}

// ── [NEW] Return actual groups, skipping sentinel entries ──
function getTournamentGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.filter(g => !g._meta && !g._hof && !g._config);
}

// ── [NEW] Get registration config if present ──
function getTournamentConfig(groups) {
  if (!Array.isArray(groups)) return null;
  return groups.find(g => g._config) || null;
}

// ── [NEW] Find a 2v2 team by its anchor (playerIds[0]) ──
function getTeamByAnchor(groups, anchorId) {
  for (const grp of getTournamentGroups(groups)) {
    if (grp.teams) {
      const t = grp.teams.find(team => team.playerIds && team.playerIds[0] === anchorId);
      if (t) return t;
    }
  }
  return null;
}

// ── [NEW] Human-readable team name: "A: Alice + Bob" (or "Alice + Bob" for legacy) ──
function getTeamDisplayName(team, players) {
  if (!team || !team.playerIds) return '—';
  const names = team.playerIds.map(id => players.find(p => p.id === id)?.name || '?').join(' + ');
  return team.name ? `${team.name}: ${names}` : names;
}

// ── calculateGroupStandings: full standings with h2h, scoreDiff ──
function calculateGroupStandings(grp, tMatches, matchType) {
  const grpLetter = grp.letter;
  const grpMatches = tMatches.filter(m => m.group_letter === grpLetter);

  let entries;
  if (matchType === '2v2' && grp.teams) {
    entries = grp.teams.map(team => ({
      id: team.playerIds[0],
      label: getTeamDisplayName(team, db.players),
      team,
      wins: 0, losses: 0, points: 0,
      scoreFor: 0, scoreAgainst: 0, scoreDiff: 0
    }));
  } else {
    entries = (grp.playerIds || [])
      .map(id => db.players.find(p => p.id === id))
      .filter(Boolean)
      .map(p => ({
        id: p.id, label: p.name,
        wins: 0, losses: 0, points: 0,
        scoreFor: 0, scoreAgainst: 0, scoreDiff: 0
      }));
  }

  for (const m of grpMatches) {
    const eA = entries.find(e => e.id === m.player_a);
    const eB = entries.find(e => e.id === m.player_b);
    if (!eA || !eB) continue;
    const sa = Number(m.score_a) || 0, sb = Number(m.score_b) || 0;
    eA.scoreFor += sa; eA.scoreAgainst += sb;
    eB.scoreFor += sb; eB.scoreAgainst += sa;
    if (m.winner_id === eA.id) { eA.wins++; eA.points += 2; eB.losses++; }
    else { eB.wins++; eB.points += 2; eA.losses++; }
  }
  entries.forEach(e => { e.scoreDiff = e.scoreFor - e.scoreAgainst; });

  // Sort: wins DESC → points DESC → h2h → scoreDiff
  entries.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.points !== a.points) return b.points - a.points;
    // head-to-head
    const h2h = grpMatches.find(m =>
      (m.player_a === a.id && m.player_b === b.id) ||
      (m.player_a === b.id && m.player_b === a.id)
    );
    if (h2h) {
      if (h2h.winner_id === b.id) return 1;
      if (h2h.winner_id === a.id) return -1;
    }
    return b.scoreDiff - a.scoreDiff;
  });
  return entries;
}

// ── [NEW] Render Singles / Doubles badge ──
function renderModeBadge(matchType) {
  return matchType === '2v2'
    ? `<span class="t-mode-badge t-mode-doubles">⚔️ Doubles</span>`
    : `<span class="t-mode-badge t-mode-singles">🏸 Singles</span>`;
}

// ── [NEW] Show confirm-cancel modal ──
function confirmCancelTournament(tournamentId, tournamentName) {
  document.getElementById('tCancelModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'tCancelModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid rgba(255,60,60,.4);border-radius:18px;padding:24px 20px;max-width:320px;width:90%;text-align:center;box-shadow:0 0 40px rgba(255,60,60,.15)">
      <div style="font-size:2rem;margin-bottom:8px">⚠️</div>
      <div style="font-size:1rem;font-weight:700;margin-bottom:6px">ยกเลิก Tournament?</div>
      <div style="font-size:0.82rem;color:var(--muted);margin-bottom:18px">
        <strong style="color:var(--text)">"${tournamentName}"</strong><br>
        จะถูกลบพร้อมผลการแข่งขันทั้งหมด<br>ไม่สามารถกู้คืนได้
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--glass-border);font-size:0.82rem"
          onclick="document.getElementById('tCancelModal').remove()">ปิด</button>
        <button class="btn" style="flex:1;background:rgba(255,60,60,.15);border:1px solid rgba(255,60,60,.5);color:#ff6060;font-size:0.82rem"
          onclick="cancelTournament(${tournamentId})">🗑️ ยืนยันลบ</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ── [NEW] Execute tournament deletion ──
async function cancelTournament(tournamentId) {
  document.getElementById('tCancelModal')?.remove();
  try {
    toast('กำลังลบ Tournament...', 'info');
    await dbDeleteTournament(tournamentId);
    toast('ลบ Tournament เรียบร้อย ✅', 'success');
    renderTournamentSection();
  } catch(e) { toast('ลบไม่ได้: ' + e.message, 'error'); }
}

// ════════════════════════════════════════════════════════════
// [NEW] TOURNAMENT REWARD & CHAMPION DECLARATION SYSTEM
// ════════════════════════════════════════════════════════════

// Coin rewards per tournament tier
const TOUR_COIN_REWARDS = { 'Regular': 100, 'Super 500': 500, 'Super 1000': 1000 };

// System achievement templates (auto-awarded, stored as customAch)
const TOUR_ACH_DEFS = {
  regular:    { id:'sys_tour_regular',  icon:'🏆', title:'Tournament Champion',    desc:'ชนะ Regular Tournament',        frame:'bronze' },
  super500:   { id:'sys_tour_s500',     icon:'🥈', title:'Super 500 Champion',      desc:'ชนะ Super 500 Tournament',      frame:'silver' },
  super1000:  { id:'sys_tour_s1000',    icon:'👑', title:'Super 1000 Champion',     desc:'ชนะ Super 1000 Tournament',     frame:'gold'   },
  doubles:    { id:'sys_tour_doubles',  icon:'⚔️', title:'Doubles Champion',        desc:'ชนะ Tournament โหมด 2v2',      frame:'gold'   },
  grandfinal: { id:'sys_tour_gf_ss1',  icon:'🏆', title:'Grand Final SS1',         desc:'แชมป์ Grand Final Season 1',    frame:'gold'   },
};

// ── [NEW] Get Super 1000 title count from player ──
function getS1000Titles(player) { return player?.super1000Titles || 0; }

// ── [NEW] Increment Super 1000 titles counter and save to DB ──
async function incrementS1000Titles(playerId) {
  const pl = db.players.find(x => x.id === playerId);
  if (!pl) return;
  pl.super1000Titles = (pl.super1000Titles || 0) + 1;
  try {
    const ptStr = buildPlayerPrimeTitles(pl, { s1000: pl.super1000Titles });
    await dbUpdatePlayer(playerId, { prime_titles: ptStr });
  } catch(e) { console.warn('[S1000] save failed:', e.message); }
}

// ── [NEW] Auto-award a system tournament achievement to player(s) ──
async function awardTournamentAchievement(playerIds, achDef) {
  for (const pid of playerIds) {
    const pl = db.players.find(x => x.id === pid);
    if (!pl) continue;
    let cur = [...(pl.customAch || [])];
    if (cur.some(a => a.id === achDef.id)) continue; // already has this achievement
    cur.push({ id: achDef.id, icon: achDef.icon, title: achDef.title, desc: achDef.desc, frame: achDef.frame });
    pl.customAch = cur;
    // Save to localStorage + Supabase
    try { saveCachAwardLS(pid, cur); } catch(e) {}
    try {
      const ptStr = buildPlayerPrimeTitles(pl, { awards: cur });
      await dbUpdatePlayer(pid, { prime_titles: ptStr });
    } catch(e) {
      try { await dbUpdatePlayer(pid, { custom_ach: JSON.stringify(cur) }); } catch(e2) {}
    }
  }
}

// ── Show "ประกาศแชมป์" confirmation modal (sync show → async populate) ──
function confirmDeclareChampion(tournamentId) {
  document.getElementById('tChampModal')?.remove();

  // Show modal immediately (synchronous) so user gets instant feedback
  const modal = document.createElement('div');
  modal.id = 'tChampModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)';
  modal.innerHTML = `
    <div id="tChampInner" style="background:var(--card);border:1px solid rgba(255,215,0,.4);border-radius:18px;padding:24px 20px;max-width:340px;width:90%;text-align:center;box-shadow:0 0 50px rgba(255,215,0,.12)">
      <div style="font-size:1.5rem;margin-bottom:8px">⏳</div>
      <div style="font-size:0.85rem;color:var(--muted)">กำลังโหลดข้อมูล...</div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Async: load data and populate modal content
  _populateChampModal(tournamentId, modal);
}

async function _populateChampModal(tournamentId, modal) {
  try {
    const stored = await _resolveTourData(tournamentId);
    if (!stored) {
      document.getElementById('tChampModal')?.remove();
      alert('ไม่พบข้อมูล Tournament (id=' + tournamentId + ')');
      return;
    }
    const { groups, matchType, tier: tierName } = stored;
    const realGroups = getTournamentGroups(groups);

    let gfWinnerId = null;
    try {
      const tms = await dbGetTournamentMatches(tournamentId);
      const gfMatch = tms.find(m => m.group_letter === 'GF');
      if (gfMatch) gfWinnerId = gfMatch.winner_id;
    } catch(e) {}

    let winnerOpts = '';
    if (matchType === '2v2') {
      for (const grp of realGroups) {
        if (!grp.teams) continue;
        for (const team of grp.teams) {
          const label = getTeamDisplayName(team, db.players);
          winnerOpts += `<option value="${team.playerIds[0]}">${label} (Group ${grp.letter})</option>`;
        }
      }
    } else {
      for (const grp of realGroups) {
        for (const pid of (grp.playerIds || [])) {
          const pl = db.players.find(x => x.id === pid);
          if (pl) winnerOpts += `<option value="${pl.id}">${pl.name} (Group ${grp.letter})</option>`;
        }
      }
    }
    if (!winnerOpts) winnerOpts = '<option value="">— ไม่มีผู้เล่น —</option>';

    const coins = TOUR_COIN_REWARDS[tierName] || 100;
    const tierColor = tierName === 'Super 1000' ? '#ffd700' : tierName === 'Super 500' ? '#c8c8c8' : '#cd7f32';
    const gfBadge = gfWinnerId
      ? `<div style="font-size:0.72rem;background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.3);border-radius:8px;padding:5px 10px;margin-bottom:10px;color:var(--gold)">🏆 ตรวจพบผล Grand Final — เลือกอัตโนมัติแล้ว</div>`
      : '';

    const inner = document.getElementById('tChampInner');
    if (!inner) return;
    inner.innerHTML = `
      <div style="font-size:2rem;margin-bottom:6px">👑</div>
      <div style="font-size:1rem;font-weight:700;margin-bottom:4px">ประกาศแชมป์</div>
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px">
        <span style="color:${tierColor};font-weight:700">${tierName}</span> · รางวัล
        <span style="color:#ffd700;font-weight:700">+${coins} 🪙</span> ต่อคน
      </div>
      ${gfBadge}
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;text-align:left">เลือกผู้ชนะ:</div>
      <select class="inp" id="tChampWinnerSel" style="margin-bottom:14px;font-size:0.82rem">${winnerOpts}</select>
      <div style="display:flex;gap:10px">
        <button class="btn" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--glass-border);font-size:0.82rem"
          onclick="document.getElementById('tChampModal').remove()">ปิด</button>
        <button class="btn" style="flex:1;background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.5);color:#ffd700;font-size:0.82rem"
          onclick="executeDeclareChampion(${tournamentId})">👑 ยืนยัน</button>
      </div>`;

    if (gfWinnerId) {
      const sel = document.getElementById('tChampWinnerSel');
      if (sel) sel.value = String(gfWinnerId);
    }
  } catch(e) {
    document.getElementById('tChampModal')?.remove();
    alert('Error: ' + e.message);
  }
}

// ── Execute champion declaration ──
async function executeDeclareChampion(tournamentId) {
  const sel = document.getElementById('tChampWinnerSel');
  const winnerAnchorId = sel ? parseInt(sel.value) : NaN;
  document.getElementById('tChampModal')?.remove();
  if (!winnerAnchorId || isNaN(winnerAnchorId)) { alert('กรุณาเลือกผู้ชนะ'); return; }

  let stored = _tourStore[tournamentId];
  if (!stored) {
    try { stored = await _resolveTourData(tournamentId); } catch(e) {}
  }
  if (!stored) { alert('ไม่พบข้อมูล Tournament (id=' + tournamentId + ')'); return; }
  const { groups, matchType, tier: tierName } = stored;

  const coins = TOUR_COIN_REWARDS[tierName] || 100;
  let winnerPlayerIds = [];
  if (matchType === '2v2') {
    const team = getTeamByAnchor(groups, winnerAnchorId);
    winnerPlayerIds = team?.playerIds || [winnerAnchorId];
  } else {
    winnerPlayerIds = [winnerAnchorId];
  }

  const savedRewards = getTournamentRewards(tournamentId) || {};
  const bonusCoins = savedRewards.bonusCoins || 0;
  const bonusPts   = savedRewards.bonusPts   || 0;
  const totalCoins = coins + bonusCoins;

  toast('กำลังมอบรางวัล...', 'info');

  // 1. Coins to winners (each step isolated — one failure won't abort the rest)
  for (const pid of winnerPlayerIds) {
    try { await dbAddCoins(pid, totalCoins); } catch(e) {}
    try {
      const pl = db.players.find(x => x.id === pid);
      if (pl) await dbSendMail(pid, 'coins', String(totalCoins),
        `🏆 ${tierName} Champion! +${bonusCoins > 0 ? coins + '+Bonus' + bonusCoins : totalCoins} 🪙`);
    } catch(e) {}
  }

  // 2. Bonus ELO pts
  if (bonusPts > 0) {
    for (const pid of winnerPlayerIds) {
      try {
        const pl = db.players.find(x => x.id === pid);
        if (pl) { const np = (pl.pts||0)+bonusPts; await dbUpdatePlayer(pid,{pts:np}); pl.pts=np; }
      } catch(e) {}
    }
  }

  // 3. Achievements
  const achKey = tierName === 'Super 1000' ? 'super1000' : tierName === 'Super 500' ? 'super500' : 'regular';
  try { await awardTournamentAchievement(winnerPlayerIds, TOUR_ACH_DEFS[achKey]); } catch(e) {}
  if (matchType === '2v2') {
    try { await awardTournamentAchievement(winnerPlayerIds, TOUR_ACH_DEFS.doubles); } catch(e) {}
  }

  // 4. GF achievement + runner-up reward (single fetch)
  try {
    const tms = await dbGetTournamentMatches(tournamentId);
    if (tms.some(m => m.group_letter === 'GF')) {
      try { await awardTournamentAchievement(winnerPlayerIds, TOUR_ACH_DEFS.grandfinal); } catch(e) {}
    }
    const gfMatch = tms.find(m => m.group_letter === 'GF');
    if (gfMatch) {
      const loserAnchor = gfMatch.winner_id === gfMatch.player_a ? gfMatch.player_b : gfMatch.player_a;
      const loserIds = matchType === '2v2'
        ? (getTeamByAnchor(groups, loserAnchor)?.playerIds || [loserAnchor])
        : [loserAnchor];
      const runnerCoins = Math.max(1, Math.floor(totalCoins / 2));
      for (const pid of loserIds) {
        try { await dbAddCoins(pid, runnerCoins); } catch(e) {}
        try {
          const pl = db.players.find(x => x.id === pid);
          if (pl) await dbSendMail(pid, 'coins', String(runnerCoins),
            `🥈 รองแชมป์ ${tierName}! +${runnerCoins} 🪙`);
        } catch(e) {}
      }
    }
  } catch(e) {}

  // 5. Super 1000 title counter
  if (tierName === 'Super 1000') {
    for (const pid of winnerPlayerIds) { try { await incrementS1000Titles(pid); } catch(e) {} }
  }

  const winnerNames = winnerPlayerIds.map(pid => db.players.find(x=>x.id===pid)?.name||'?').join(' & ');

  // 6. Mark tournament as completed (keep for Hall of Fame) instead of deleting
  let thirdPlaceName = '';
  try {
    let runnerUpName = '';
    let runnerUpIds = [];
    try {
      const _tms2 = await dbGetTournamentMatches(tournamentId);
      const _gf2 = _tms2.find(m => m.group_letter === 'GF');
      if (_gf2) {
        const _ruAnchor = _gf2.winner_id === _gf2.player_a ? _gf2.player_b : _gf2.player_a;
        runnerUpIds = matchType === '2v2' ? (getTeamByAnchor(groups, _ruAnchor)?.playerIds || [_ruAnchor]) : [_ruAnchor];
        runnerUpName = runnerUpIds.map(pid => db.players.find(x=>x.id===pid)?.name||'?').join(' & ');
      }
      // คำนวณอันดับ 3 จากคะแนนรอบกลุ่มสูงสุด (ยกเว้นแชมป์และรองแชมป์)
      const excludeIds = new Set([...winnerPlayerIds, ...runnerUpIds]);
      const allStandings = [];
      for (const grp of getTournamentGroups(groups)) {
        const standings = calculateGroupStandings(grp, _tms2, matchType);
        for (const entry of standings) {
          if (!excludeIds.has(entry.id)) allStandings.push(entry);
        }
      }
      allStandings.sort((a, b) => b.points !== a.points ? b.points - a.points : b.wins - a.wins);
      if (allStandings.length > 0) {
        const thirdEntry = allStandings[0];
        const thirdIds = matchType === '2v2' ? (getTeamByAnchor(groups, thirdEntry.id)?.playerIds || [thirdEntry.id]) : [thirdEntry.id];
        thirdPlaceName = thirdIds.map(pid => db.players.find(x=>x.id===pid)?.name||'?').join(' & ');
        const thirdCoins = Math.max(1, Math.floor(totalCoins / 4));
        for (const pid of thirdIds) {
          try { await dbAddCoins(pid, thirdCoins); } catch(e) {}
          try {
            const pl = db.players.find(x => x.id === pid);
            if (pl) await dbSendMail(pid, 'coins', String(thirdCoins),
              `🥉 อันดับ 3 ${tierName}! +${thirdCoins} 🪙`);
          } catch(e) {}
        }
      }
    } catch(e) {}
    await dbCompleteTournament(tournamentId, {
      champion_ids: winnerPlayerIds,
      champion_name: winnerNames,
      runner_up_name: runnerUpName,
      third_place_name: thirdPlaceName,
      tier: tierName,
      match_type: matchType,
      ended_at: new Date().toISOString(),
    });
  } catch(e) {
    try { await dbDeleteTournament(tournamentId); } catch(e2) {}
  }
  delete _tourStore[tournamentId];

  // 7. Reload + refresh UI
  try { await loadPlayers(); } catch(e) {}
  try { if (typeof renderLeaderboard === 'function') renderLeaderboard(); } catch(e) {}
  if (document.getElementById('tournamentTabContent')) renderTournamentTab();

  const ptsMsg = bonusPts > 0 ? ` +${bonusPts} pts` : '';
  toast(`👑 ${winnerNames} ชนะ ${tierName}! +${totalCoins} 🪙${ptsMsg}`, 'success');
  if (thirdPlaceName) setTimeout(() => toast(`🥉 อันดับ 3: ${thirdPlaceName}`, 'info'), 1500);

  renderTournamentSection();
}

// ── Helper: collect all participant player IDs from groups ──
function getAllParticipantIds(groups, matchType) {
  const ids = new Set();
  for (const grp of getTournamentGroups(groups)) {
    if (matchType === '2v2' && grp.teams) {
      for (const team of grp.teams) {
        for (const pid of (team.playerIds || [])) ids.add(pid);
      }
    } else {
      for (const pid of (grp.playerIds || [])) ids.add(pid);
    }
  }
  return [...ids];
}

// ════════════════════════════════════════════════════════════
// TOURNAMENT REWARD MANAGER
// ════════════════════════════════════════════════════════════

function getTournamentRewards(tournamentId) {
  try {
    const raw = localStorage.getItem(`t_rewards_${tournamentId}`);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function saveTournamentRewards(tournamentId, rewards) {
  localStorage.setItem(`t_rewards_${tournamentId}`, JSON.stringify(rewards));
}

function openRewardManager(tournamentId, tierName) {
  document.getElementById('tRewardModal')?.remove();
  const saved = getTournamentRewards(tournamentId) || {};
  const tierCoins = TOUR_COIN_REWARDS[tierName] || 100;
  const bonusCoins = saved.bonusCoins || 0;
  const bonusPts   = saved.bonusPts   || 0;
  const hasCup     = saved.hasCup     || false;
  const hasMvp     = saved.hasMvp     || false;
  const customNote = saved.customNote || '';

  const modal = document.createElement('div');
  modal.id = 'tRewardModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid rgba(255,215,0,.4);border-radius:18px;padding:22px 18px;max-width:360px;width:92%;box-shadow:0 0 60px rgba(255,215,0,.1)">
      <div style="font-size:1rem;font-weight:700;margin-bottom:4px">🎁 จัดการรางวัล</div>
      <div style="font-size:0.75rem;color:var(--muted);margin-bottom:14px">Tournament · <span style="color:var(--gold)">${tierName}</span> · รางวัลพื้นฐาน <span style="color:var(--gold);font-weight:700">+${tierCoins} 🪙</span></div>

      <div class="reward-mgr-row">
        <div class="reward-mgr-label">💰 Bonus เหรียญ</div>
        <input class="inp" type="number" id="rm_bonusCoins" value="${bonusCoins}" min="0" style="flex:1;font-size:0.82rem;padding:6px 8px">
        <span style="font-size:0.75rem;color:var(--muted)">🪙</span>
      </div>
      <div class="reward-mgr-row">
        <div class="reward-mgr-label">⭐ Bonus Pts</div>
        <input class="inp" type="number" id="rm_bonusPts" value="${bonusPts}" min="0" style="flex:1;font-size:0.82rem;padding:6px 8px">
        <span style="font-size:0.75rem;color:var(--muted)">pts</span>
      </div>
      <div class="reward-mgr-row">
        <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer">
          <input type="checkbox" id="rm_hasCup" ${hasCup ? 'checked' : ''}> 🏆 ถ้วยรางวัล
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer;margin-left:16px">
          <input type="checkbox" id="rm_hasMvp" ${hasMvp ? 'checked' : ''}> 🌟 MVP Award
        </label>
      </div>
      <div class="reward-mgr-row" style="flex-direction:column;align-items:flex-start">
        <div class="reward-mgr-label" style="width:auto;margin-bottom:4px">📝 Custom Note</div>
        <input class="inp" type="text" id="rm_customNote" value="${customNote.replace(/"/g,'&quot;')}" placeholder="เช่น เสื้อทีม, สปอนเซอร์..." style="width:100%;font-size:0.8rem">
      </div>

      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--glass-border);font-size:0.8rem"
          onclick="document.getElementById('tRewardModal').remove()">ปิด</button>
        <button class="btn btn-primary" style="flex:1;font-size:0.8rem;background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.5);color:#ffd700"
          onclick="_saveRewardsFromModal(${tournamentId})">💾 บันทึก</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function _saveRewardsFromModal(tournamentId) {
  const rewards = {
    bonusCoins:  parseInt(document.getElementById('rm_bonusCoins')?.value) || 0,
    bonusPts:    parseInt(document.getElementById('rm_bonusPts')?.value)   || 0,
    hasCup:      document.getElementById('rm_hasCup')?.checked   || false,
    hasMvp:      document.getElementById('rm_hasMvp')?.checked   || false,
    customNote:  (document.getElementById('rm_customNote')?.value || '').trim(),
  };
  saveTournamentRewards(tournamentId, rewards);
  document.getElementById('tRewardModal')?.remove();
  toast('บันทึกรางวัลแล้ว ✅', 'success');
  renderTournamentSection();
}

function renderRewardCards(tournamentId, tierName) {
  const saved = getTournamentRewards(tournamentId);
  if (!saved) return '';
  const tierCoins = TOUR_COIN_REWARDS[tierName] || 100;
  const totalCoins = tierCoins + (saved.bonusCoins || 0);
  let cards = '';
  cards += `<div class="reward-card"><div class="reward-icon">🪙</div><div class="reward-info"><div class="reward-title">${totalCoins.toLocaleString()} เหรียญ</div><div class="reward-desc">รางวัลพื้นฐาน ${tierCoins}${saved.bonusCoins ? ` + Bonus ${saved.bonusCoins}` : ''}</div></div></div>`;
  if (saved.bonusPts > 0) cards += `<div class="reward-card"><div class="reward-icon">⭐</div><div class="reward-info"><div class="reward-title">+${saved.bonusPts} ELO Points</div><div class="reward-desc">Bonus rank points สำหรับแชมป์</div></div></div>`;
  if (saved.hasCup) cards += `<div class="reward-card"><div class="reward-icon">🏆</div><div class="reward-info"><div class="reward-title">ถ้วยรางวัล</div><div class="reward-desc">Trophy สำหรับแชมป์</div></div></div>`;
  if (saved.hasMvp) cards += `<div class="reward-card"><div class="reward-icon">🌟</div><div class="reward-info"><div class="reward-title">MVP Award</div><div class="reward-desc">Most Valuable Player of the Tournament</div></div></div>`;
  if (saved.customNote) cards += `<div class="reward-card"><div class="reward-icon">📝</div><div class="reward-info"><div class="reward-title">Special Prize</div><div class="reward-desc">${saved.customNote}</div></div></div>`;
  return cards ? `<div style="margin-top:10px">${cards}</div>` : '';
}

// ── 2v2 team builder ──────────────────────────────────────────────────────────
let _t2v2TeamCount = 0;

function onTournamentModeChange() { _updateTournamentCreateForm(); }

function _updateTournamentCreateForm() {
  const tier = document.getElementById('tournamentTier')?.value || 'Regular';
  const mode = document.getElementById('tournamentMatchType')?.value || '1v1';
  // Registration mode: Regular/Super 500 + 1v1 only
  const isRegMode = (tier === 'Regular' || tier === 'Super 500') && mode === '1v1';
  const d1  = document.getElementById('tournamentPlayerSelect1v1');
  const d2  = document.getElementById('tournamentPlayerSelect2v2');
  const dr  = document.getElementById('tournamentRegDesign');
  if (dr) dr.style.display = isRegMode ? '' : 'none';
  if (d1) d1.style.display = (!isRegMode && mode === '1v1') ? '' : 'none';
  if (d2) d2.style.display = mode === '2v2' ? '' : 'none';
  if (mode === '2v2') _init2v2Teams();
  if (isRegMode) _updateRegTotal();
}

function _updateRegTotal() {
  const ng = parseInt(document.getElementById('tourNumGroups')?.value) || 2;
  const pp = parseInt(document.getElementById('tourPlayersPerGroup')?.value) || 4;
  const el = document.getElementById('tourRegTotal');
  if (el) el.textContent = `รับสมัคร: ${ng * pp} คน (${ng} กลุ่ม × ${pp} คน)`;
}

function _init2v2Teams() {
  _t2v2TeamCount = 0;
  const list = document.getElementById('t2v2_teams_list');
  if (list) list.innerHTML = '';
  _add2v2Team(); _add2v2Team();
}

function _add2v2Team() {
  if (_t2v2TeamCount >= 8) { toast('สูงสุด 8 ทีม', 'error'); return; }
  const idx = _t2v2TeamCount++;
  const letter = 'ABCDEFGHIJKLMNOP'[idx];
  const list = document.getElementById('t2v2_teams_list');
  if (!list) return;
  const pOpts = db.players.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const div = document.createElement('div');
  div.className = 't2v2-team-row';
  div.style.cssText = 'border:1px solid var(--glass-border);border-radius:12px;padding:10px 12px;margin-bottom:8px;position:relative';
  div.innerHTML = `
    <div style="font-size:0.75rem;font-weight:700;color:var(--neon2);margin-bottom:8px">⚔️ Team ${letter}</div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <select class="inp t2v2-p0" style="flex:1;min-width:100px;font-size:0.76rem">${pOpts}</select>
      <span style="color:var(--muted);font-size:0.7rem">+</span>
      <select class="inp t2v2-p1" style="flex:1;min-width:100px;font-size:0.76rem">${pOpts}</select>
    </div>
    ${idx >= 2 ? `<button onclick="this.closest('.t2v2-team-row').remove()" style="position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;border:1px solid rgba(255,60,60,0.4);background:rgba(255,60,60,0.1);color:rgba(255,100,100,0.9);font-size:0.7rem;cursor:pointer">✕</button>` : ''}
  `;
  list.appendChild(div);
}

function _get2v2Teams() {
  const teams = [];
  document.querySelectorAll('.t2v2-team-row').forEach((row, i) => {
    teams.push({
      name: 'ABCDEFGHIJKLMNOP'[i],
      playerIds: [
        parseInt(row.querySelector('.t2v2-p0')?.value),
        parseInt(row.querySelector('.t2v2-p1')?.value),
      ]
    });
  });
  return teams;
}

async function recordFixture(tournamentId, groupLetter, anchorA, anchorB) {
  const fid = `f_${tournamentId}_${groupLetter}_${anchorA}_${anchorB}`;
  const sa = parseInt(document.getElementById(`${fid}_sa`)?.value);
  const sb = parseInt(document.getElementById(`${fid}_sb`)?.value);
  if (isNaN(sa) || isNaN(sb)) return toast('กรุณากรอกสกอร์', 'error');
  if (sa === sb) return toast('ผลเสมอไม่ได้ (ต้องมีผู้ชนะ)', 'error');
  const winnerId = sa > sb ? anchorA : anchorB;
  try {
    await dbAddTournamentMatch(tournamentId, groupLetter, anchorA, anchorB, sa, sb, winnerId);
    toast('บันทึกแมตช์แล้ว ✅', 'success');
    renderTournamentSection();
  } catch(e) { toast('บันทึกไม่ได้: ' + e.message, 'error'); }
}

// ── TOURNAMENT HALL OF FAME ────────────────────────────────────────────────
let _hofAllRows = [], _hofActiveTab = 'all';

async function openTournamentHoF() {
  document.getElementById('tourHofBg')?.remove();
  const bg = document.createElement('div');
  bg.id = 'tourHofBg';
  bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:800;display:flex;align-items:center;justify-content:center;padding:16px';
  bg.innerHTML = `
    <div style="background:var(--bg2);border:1px solid rgba(255,215,0,0.2);border-radius:24px;width:100%;max-width:440px;max-height:86vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:18px 18px 0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div style="font-family:'Rajdhani',sans-serif;font-size:1.3rem;font-weight:700;background:linear-gradient(135deg,#ffd700,#fff4a3);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">🏛️ ทำเนียบแชมป์</div>
        <button onclick="document.getElementById('tourHofBg').remove()" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);cursor:pointer;font-size:0.9rem;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <div id="hofTabRow" style="display:flex;gap:6px;padding:12px 16px 8px;overflow-x:auto;flex-shrink:0;scrollbar-width:none">
        ${[['all','ทั้งหมด'],['Super 1000','👑 S1000'],['Super 500','🥈 S500'],['Regular','🏸 Regular']].map(([v,l]) =>
          `<button data-tier="${v}" onclick="_hofSwitchTab('${v}')" style="flex-shrink:0;padding:5px 13px;border-radius:20px;border:1px solid var(--glass-border);background:${v==='all'?'var(--neon)':'var(--btn-glass)'};color:${v==='all'?'#000':'var(--muted)'};font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:all 0.18s">${l}</button>`
        ).join('')}
      </div>
      <div id="tourHofList" style="overflow-y:auto;flex:1;padding:0 14px 16px">
        <div style="text-align:center;color:var(--muted);padding:24px">⏳ กำลังโหลด...</div>
      </div>
    </div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  try {
    _hofAllRows = await dbGetHOFTournaments();
    _hofActiveTab = 'all';
    _hofRenderList();
  } catch(e) {
    const el = document.getElementById('tourHofList');
    if (el) el.innerHTML = `<div style="text-align:center;color:var(--red);padding:20px;font-size:0.82rem">โหลดไม่ได้: ${e.message}</div>`;
  }
}

function _hofSwitchTab(tier) {
  _hofActiveTab = tier;
  document.querySelectorAll('#hofTabRow button').forEach(b => {
    const active = b.dataset.tier === tier;
    b.style.background = active ? 'var(--neon)' : 'var(--btn-glass)';
    b.style.color = active ? '#000' : 'var(--muted)';
    b.style.borderColor = active ? 'var(--neon)' : 'var(--glass-border)';
  });
  _hofRenderList();
}

function _hofRenderList() {
  const el = document.getElementById('tourHofList');
  if (!el) return;
  const rows = _hofActiveTab === 'all' ? _hofAllRows : _hofAllRows.filter(r => r.tier === _hofActiveTab);
  if (!rows.length) { el.innerHTML = `<div style="text-align:center;color:var(--muted);padding:28px;font-size:0.84rem">ยังไม่มีทัวร์นาเมนต์ใน tier นี้</div>`; return; }
  const tierIcon = t => t === 'Super 1000' ? '👑' : t === 'Super 500' ? '🥈' : '🏸';
  const tierBg   = t => t === 'Super 1000' ? 'rgba(255,215,0,0.07)' : t === 'Super 500' ? 'rgba(192,192,192,0.06)' : 'rgba(205,127,50,0.06)';
  const tierBd   = t => t === 'Super 1000' ? 'rgba(255,215,0,0.28)' : t === 'Super 500' ? 'rgba(192,192,192,0.22)' : 'rgba(205,127,50,0.22)';
  el.innerHTML = rows.map(r => {
    let hof = {};
    try { const g = typeof r.groups==='string'?JSON.parse(r.groups):(r.groups||[]); hof = g.find(x=>x._hof)||{}; } catch(e){}
    const date = (hof.ended_at||r.created_at) ? new Date(hof.ended_at||r.created_at).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) : '';
    const mTag = hof.match_type==='2v2'
      ? '<span style="font-size:0.58rem;background:rgba(0,217,245,0.12);border:1px solid rgba(0,217,245,0.3);color:var(--neon2);border-radius:20px;padding:1px 5px">2v2</span>'
      : '<span style="font-size:0.58rem;background:rgba(0,245,160,0.09);border:1px solid rgba(0,245,160,0.22);color:var(--neon);border-radius:20px;padding:1px 5px">1v1</span>';
    return `<div onclick="_hofOpenDetail(${r.id})" style="border:1px solid ${tierBd(r.tier)};border-radius:14px;background:${tierBg(r.tier)};padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:opacity 0.15s" onmouseover="this.style.opacity='.75'" onmouseout="this.style.opacity='1'">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
        <div style="display:flex;align-items:center;gap:6px">
          <span>${tierIcon(r.tier)}</span>
          <span style="font-weight:700;font-size:0.88rem">${r.name}</span>
          ${mTag}
        </div>
        <span style="font-size:0.62rem;color:var(--muted)">${date}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:0.72rem;background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.3);color:var(--gold);border-radius:20px;padding:1px 8px">🏆 ${hof.champion_name||'?'}</span>
        ${hof.runner_up_name?`<span style="font-size:0.68rem;color:var(--muted)">🥈 ${hof.runner_up_name}</span>`:''}
      </div>
      <div style="text-align:right;margin-top:5px;font-size:0.6rem;color:var(--muted)">ดูรายละเอียด →</div>
    </div>`;
  }).join('');
}

async function _hofOpenDetail(tournamentId) {
  const r = _hofAllRows.find(x => x.id === tournamentId);
  if (!r) return;
  let hof = {}, groups = [];
  try {
    const g = typeof r.groups==='string'?JSON.parse(r.groups):(r.groups||[]);
    hof = g.find(x=>x._hof)||{};
    groups = g.filter(x=>!x._hof&&!x._meta);
  } catch(e){}
  const matchType = hof.match_type||'1v1';
  const tierIcon = r.tier==='Super 1000'?'👑':r.tier==='Super 500'?'🥈':'🏸';
  const date = (hof.ended_at||r.created_at) ? new Date(hof.ended_at||r.created_at).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) : '';
  const pName = id => db.players.find(x=>x.id===id)?.name||`#${id}`;

  const listEl = document.getElementById('tourHofList');
  if (!listEl) return;
  listEl.innerHTML = `
    <button onclick="_hofRenderList()" style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:20px;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);font-size:0.74rem;cursor:pointer;margin-bottom:10px">← กลับ</button>
    <div style="border:1px solid rgba(255,215,0,0.22);border-radius:16px;background:rgba(255,215,0,0.04);padding:14px;margin-bottom:12px;text-align:center">
      <div style="font-size:1.6rem;margin-bottom:4px">${tierIcon}</div>
      <div style="font-weight:700;font-size:1rem;margin-bottom:6px">${r.name}</div>
      <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:0.66rem;color:var(--gold)">${r.tier}</span>
        <span style="font-size:0.66rem;color:var(--muted)">${matchType==='2v2'?'⚔️ 2v2':'🏸 1v1'}</span>
        ${date?`<span style="font-size:0.66rem;color:var(--muted)">${date}</span>`:''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:${hof.third_place_name ? '1fr 1fr 1fr' : '1fr 1fr'};gap:8px;margin-bottom:12px">
      <div style="border:1px solid rgba(255,215,0,0.3);border-radius:12px;background:rgba(255,215,0,0.07);padding:10px;text-align:center">
        <div style="font-size:1.3rem">🏆</div>
        <div style="font-size:0.65rem;color:var(--muted);margin-bottom:2px">แชมป์</div>
        <div style="font-weight:700;font-size:0.82rem;color:var(--gold)">${hof.champion_name||'?'}</div>
      </div>
      <div style="border:1px solid rgba(192,192,192,0.2);border-radius:12px;background:rgba(192,192,192,0.05);padding:10px;text-align:center">
        <div style="font-size:1.3rem">🥈</div>
        <div style="font-size:0.65rem;color:var(--muted);margin-bottom:2px">รองแชมป์</div>
        <div style="font-weight:700;font-size:0.82rem;color:var(--silver)">${hof.runner_up_name||'?'}</div>
      </div>
      ${hof.third_place_name ? `<div style="border:1px solid rgba(205,127,50,0.2);border-radius:12px;background:rgba(205,127,50,0.05);padding:10px;text-align:center">
        <div style="font-size:1.3rem">🥉</div>
        <div style="font-size:0.65rem;color:var(--muted);margin-bottom:2px">อันดับ 3</div>
        <div style="font-weight:700;font-size:0.82rem;color:#cd7f32">${hof.third_place_name}</div>
      </div>` : ''}
    </div>
    <div id="hofDetailBody" style="color:var(--muted);text-align:center;padding:14px;font-size:0.82rem">⏳ โหลดผลแมตช์...</div>`;

  try {
    const tms = await dbGetTournamentMatches(tournamentId);
    const detEl = document.getElementById('hofDetailBody');
    if (!detEl) return;

    // Collect participants
    const pIds = new Set();
    if (hof.champion_ids) hof.champion_ids.forEach(id => pIds.add(id));
    groups.forEach(grp => {
      if (matchType==='2v2'&&grp.teams) grp.teams.forEach(t=>(t.playerIds||[]).forEach(id=>pIds.add(id)));
      else (grp.playerIds||[]).forEach(id=>pIds.add(id));
    });
    tms.forEach(m=>{pIds.add(m.player_a);pIds.add(m.player_b);});

    const mRow = m => {
      const wA = m.winner_id===m.player_a;
      return `<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:10px;background:var(--card);margin-bottom:5px;font-size:0.77rem">
        <span style="flex:1;text-align:right;font-weight:${wA?700:400};color:${wA?'var(--neon)':'var(--text)'}">${pName(m.player_a)}</span>
        <span style="font-family:'Rajdhani',sans-serif;font-weight:700;color:var(--muted);min-width:44px;text-align:center">${m.score_a??'-'} - ${m.score_b??'-'}</span>
        <span style="flex:1;text-align:left;font-weight:${!wA?700:400};color:${!wA?'var(--neon)':'var(--text)'}">${pName(m.player_b)}</span>
      </div>`;
    };

    let html = `<div style="font-size:0.68rem;font-weight:700;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;margin-bottom:7px">👥 ผู้เข้าร่วม</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px">
        ${[...pIds].map(id=>`<span style="font-size:0.71rem;padding:2px 9px;border-radius:20px;background:var(--card);border:1px solid var(--glass-border)">${pName(id)}</span>`).join('')}
      </div>`;

    const groupMs = tms.filter(m=>m.group_letter!=='GF'&&m.group_letter!=='SF');
    const finalMs = tms.filter(m=>m.group_letter==='GF'||m.group_letter==='SF');

    if (groupMs.length) {
      const byG = {};
      groupMs.forEach(m=>{(byG[m.group_letter]=byG[m.group_letter]||[]).push(m);});
      html += `<div style="font-size:0.68rem;font-weight:700;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px">📊 รอบกลุ่ม</div>`;
      for (const [ltr,ms] of Object.entries(byG)) {
        html += `<div style="font-size:0.71rem;color:var(--neon2);font-weight:700;margin:6px 0 4px">Group ${ltr}</div>${ms.map(mRow).join('')}`;
      }
    }
    if (finalMs.length) {
      html += `<div style="font-size:0.68rem;font-weight:700;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;margin:12px 0 8px">🏆 รอบ Final</div>`;
      html += finalMs.map(m=>{
        const lbl = m.group_letter==='GF'?'Grand Final':'Semi Final';
        return `<div style="font-size:0.65rem;color:var(--gold);font-weight:700;margin:5px 0 3px">${lbl}</div>`+mRow(m);
      }).join('');
    }
    if (!groupMs.length&&!finalMs.length) html += `<div style="text-align:center;color:var(--muted);font-size:0.78rem;padding:10px">ไม่พบข้อมูลแมตช์</div>`;

    detEl.innerHTML = html;
  } catch(e) {
    const detEl = document.getElementById('hofDetailBody');
    if (detEl) detEl.innerHTML = `<div style="color:var(--red);font-size:0.78rem;text-align:center;padding:12px">โหลดไม่ได้: ${e.message}</div>`;
  }
}

async function renderTournamentSection() {
  const container = document.getElementById('tournamentAdminSection');
  if (!container) return;

  // Player dropdown options shared across 2v2 selects
  const pOpts = db.players.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  let html = `<div style="margin-bottom:12px;display:flex;justify-content:flex-end">
    <button onclick="openTournamentHoF()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:50px;border:1px solid rgba(255,215,0,0.35);background:rgba(255,215,0,0.07);color:var(--gold);font-size:0.78rem;font-weight:700;cursor:pointer">🏛️ ทำเนียบแชมป์</button>
  </div>
  <div style="margin-bottom:12px">
    <div style="font-size:0.83rem;color:var(--muted);margin-bottom:8px">สร้าง Tournament ใหม่</div>
    <input class="inp" id="tournamentName" placeholder="ชื่อทัวร์นาเมนต์" style="margin-bottom:8px">
    <select class="inp" id="tournamentTier" style="margin-bottom:8px" onchange="_updateTournamentCreateForm()">
      <option value="Regular">Regular</option>
      <option value="Super 500">Super 500</option>
      <option value="Super 1000">Super 1000</option>
    </select>
    <select class="inp" id="tournamentMatchType" style="margin-bottom:10px" onchange="_updateTournamentCreateForm()">
      <option value="1v1">🏸 1v1 — Singles</option>
      <option value="2v2">⚔️ 2v2 — Doubles</option>
    </select>

    <!-- Registration design: Regular/Super 500 + 1v1 only -->
    <div id="tournamentRegDesign">
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px">ออกแบบกลุ่ม — ผู้เล่นจะลงสมัครเอง:</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1;min-width:110px">
          <div style="font-size:0.72rem;color:var(--muted);margin-bottom:4px">จำนวนกลุ่ม</div>
          <select class="inp" id="tourNumGroups" style="font-size:0.82rem" onchange="_updateRegTotal()">
            <option value="1">1 กลุ่ม</option>
            <option value="2" selected>2 กลุ่ม</option>
            <option value="3">3 กลุ่ม</option>
            <option value="4">4 กลุ่ม</option>
          </select>
        </div>
        <div style="flex:1;min-width:110px">
          <div style="font-size:0.72rem;color:var(--muted);margin-bottom:4px">คนต่อกลุ่ม</div>
          <select class="inp" id="tourPlayersPerGroup" style="font-size:0.82rem" onchange="_updateRegTotal()">
            <option value="3">3 คน</option>
            <option value="4" selected>4 คน</option>
            <option value="5">5 คน</option>
            <option value="6">6 คน</option>
            <option value="8">8 คน</option>
          </select>
        </div>
      </div>
      <div id="tourRegTotal" style="font-size:0.75rem;color:var(--neon);margin-bottom:10px">รับสมัคร: 8 คน (2 กลุ่ม × 4 คน)</div>
    </div>

    <!-- Super 1000 admin-picks: 1v1 checkboxes -->
    <div id="tournamentPlayerSelect1v1" style="display:none">
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px">เลือกผู้เล่น 4–16 คน (จัดกลุ่มอัตโนมัติ):</div>
      <div id="tournamentPlayerSelect" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${db.players.map(p => `<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem;cursor:pointer"><input type="checkbox" value="${p.id}" id="tp_${p.id}"> ${p.name}</label>`).join('')}
      </div>
    </div>

    <!-- 2v2 dynamic team builder -->
    <div id="tournamentPlayerSelect2v2" style="display:none">
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px">สร้างทีม (A, B, C...) · อย่างน้อย 2 ทีม · Round-Robin อัตโนมัติ:</div>
      <div id="t2v2_teams_list"></div>
      <button onclick="_add2v2Team()" style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:20px;border:1px solid var(--neon);background:rgba(0,245,160,0.07);color:var(--neon);font-size:0.76rem;cursor:pointer;margin-top:2px;margin-bottom:8px">+ เพิ่มทีม</button>
    </div>

    <button class="btn btn-primary btn-sm" style="width:auto" onclick="createTournament()">🏆 สร้าง Tournament</button>
  </div>`;

  try {
    const tournaments = await dbGetTournaments();
    const activeTournaments = tournaments.filter(t => t.status !== 'completed');
    if (activeTournaments.length) {
      html += `<div class="divider"></div><div style="font-size:0.83rem;font-weight:600;margin-bottom:8px">🏆 Tournaments</div>`;
      for (const t of activeTournaments) {
        let groups = [];
        try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
        const matchType = getTournamentMatchType(groups);
        const cfg = getTournamentConfig(groups);
        _tourStore[t.id] = { groups, matchType, tier: t.tier, name: t.name };
        const tierBadge = t.tier === 'Super 1000' ? '🥇' : t.tier === 'Super 500' ? '🥈' : '🏸';
        const safeName = t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");

        if (cfg?.registrationOpen) {
          // ── Open registration: show sign-up status + start button ──
          const regs = cfg.registrations || [];
          const max = cfg.numGroups * cfg.playersPerGroup;
          const pct = Math.round(regs.length / max * 100);
          html += `<div class="tournament-group" style="margin-bottom:16px;position:relative">
            <button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕ ยกเลิก</button>
            <div class="tournament-group-title" style="padding-right:90px">
              ${tierBadge} ${t.name} ${renderModeBadge(matchType)}
              <span style="font-size:0.64rem;background:rgba(0,245,160,0.12);border:1px solid rgba(0,245,160,0.3);border-radius:20px;padding:1px 7px;color:var(--neon);margin-left:6px">📋 รับสมัคร</span>
            </div>
            <div style="margin:8px 0">
              <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                <span style="font-size:0.82rem;font-weight:700"><span style="color:var(--neon)">${regs.length}</span>/${max} คน</span>
                <span style="font-size:0.72rem;color:var(--muted)">${cfg.numGroups} กลุ่ม · ${cfg.playersPerGroup} คน/กลุ่ม</span>
              </div>
              <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:var(--neon);border-radius:3px"></div>
              </div>
            </div>
            ${regs.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">${regs.map(id=>`<span style="font-size:0.72rem;padding:2px 9px;border-radius:20px;background:var(--card);border:1px solid var(--glass-border)">${db.players.find(p=>p.id===id)?.name||'?'}</span>`).join('')}</div>` : `<div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px">ยังไม่มีผู้สมัคร</div>`}
            <button class="btn btn-primary btn-sm" style="width:auto;${regs.length<4?'opacity:.5;pointer-events:none':''}" ${regs.length<4?'disabled':''} onclick="startTournament(${t.id})">▶ เริ่มการแข่งขัน (${regs.length} คน)</button>
          </div>`;
        } else {
          // ── Bracket in progress ──
          const champBtn = `<button class="btn btn-primary btn-sm" style="padding:3px 10px;font-size:0.72rem;width:auto;background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.5);color:#ffd700" onclick="confirmDeclareChampion(${t.id})">👑 ประกาศแชมป์</button>`;
          const rewardBtn = `<button class="btn btn-sm" style="padding:3px 10px;font-size:0.72rem;width:auto;background:rgba(255,165,0,.12);border:1px solid rgba(255,165,0,.4);color:#ffb347;margin-right:6px" onclick="openRewardManager(${t.id},'${t.tier}')">🎁 จัดการรางวัล</button>`;
          html += `<div class="tournament-group" style="margin-bottom:16px;position:relative">
            <button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕ ยกเลิก</button>
            <div class="tournament-group-title" style="padding-right:90px">
              ${tierBadge} ${t.name} ${renderModeBadge(matchType)}
              <span style="font-size:0.68rem;color:var(--muted)">[${t.tier}]</span>
            </div>
            ${renderRewardCards(t.id, t.tier)}
            ${await renderTournamentBracket(t, groups)}
            <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--glass-border);display:flex;align-items:center;justify-content:flex-end">${rewardBtn}${champBtn}</div>
          </div>`;
        }
      }
    }
  } catch(e) {}
  container.innerHTML = html;
}

// ── Knockout stage helpers ────────────────────────────────────────────────────
function _renderKnockoutStage(tournament, tMatches, stageId, stageLabel, leftEntry, rightEntry, matchType, readOnly) {
  const match = tMatches.find(m => m.group_letter === stageId);
  let content = '';
  if (match) {
    const wLabel = (leftEntry?.id === match.winner_id ? leftEntry : rightEntry)?.label
      || db.players.find(p => p.id === match.winner_id)?.name || '?';
    const lLabel = (leftEntry?.id !== match.winner_id ? leftEntry : rightEntry)?.label || '?';
    content = `<div class="gf-result">
      <div style="font-size:0.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">ผลการแข่งขัน</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center">
        <span style="font-size:1.1rem">🏆</span>
        <span class="gf-winner">${wLabel}</span>
        <span style="font-family:'Rajdhani';font-size:1rem;font-weight:700;color:var(--gold)">${match.score_a} – ${match.score_b}</span>
        <span style="font-size:0.8rem;color:var(--muted)">${lLabel}</span>
      </div>
      ${stageId === 'GF' ? `<div style="margin-top:5px;font-size:0.7rem;color:var(--neon);font-weight:600">✅ Grand Final เสร็จสิ้น · กด "ประกาศแชมป์" เพื่อมอบรางวัล</div>` : ''}
    </div>`;
  } else if (!readOnly && leftEntry && rightEntry) {
    const opts = [leftEntry, rightEntry].map(w => `<option value="${w.id}">${w.label}</option>`).join('');
    content = `<div class="gf-match" style="margin-bottom:10px">
        <span class="gf-winner">${leftEntry.label}</span><span class="gf-vs">vs</span><span class="gf-winner">${rightEntry.label}</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <select class="inp" id="tm_pa_${tournament.id}_${stageId}" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${opts}</select>
        <span style="font-size:0.8rem">vs</span>
        <select class="inp" id="tm_pb_${tournament.id}_${stageId}" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${opts}</select>
        <input class="inp" type="number" id="tm_sa_${tournament.id}_${stageId}" placeholder="A" style="width:50px;font-size:0.76rem;padding:6px 8px" min="0">
        <span>-</span>
        <input class="inp" type="number" id="tm_sb_${tournament.id}_${stageId}" placeholder="B" style="width:50px;font-size:0.76rem;padding:6px 8px" min="0">
        <button class="btn btn-sm" style="width:auto;font-size:0.72rem;background:rgba(255,215,0,.18);border:1px solid rgba(255,215,0,.5);color:#ffd700"
          onclick="recordTournamentMatch(${tournament.id},'${stageId}','${matchType}')">🏆 บันทึก</button>
      </div>`;
  } else if (!readOnly) {
    content = `<div style="font-size:0.75rem;color:var(--muted);padding:6px 0;text-align:center">⏳ รอผลรอบก่อนหน้า...</div>`;
  } else if (leftEntry && rightEntry) {
    content = `<div style="font-size:0.75rem;color:var(--muted);padding:6px 0;text-align:center">${leftEntry.label} vs ${rightEntry.label}</div>`;
  }
  return `<div class="gf-bracket" style="margin-bottom:8px"><div class="gf-title">${stageLabel}</div>${content}</div>`;
}

function _buildKnockoutSection(tournament, tMatches, winners, matchType, readOnly) {
  if (winners.length < 2) return '';
  const _mw = (sid, a, b) => { const m = tMatches.find(x => x.group_letter === sid); return m ? (m.winner_id === a?.id ? a : b) : null; };
  if (winners.length === 2)
    return _renderKnockoutStage(tournament, tMatches, 'GF', '🏆 Grand Final', winners[0], winners[1], matchType, readOnly);
  if (winners.length === 3)
    return _renderKnockoutStage(tournament, tMatches, 'SF', '⚔️ Semi Final', winners[0], winners[1], matchType, readOnly)
      + _renderKnockoutStage(tournament, tMatches, 'GF', '🏆 Grand Final', _mw('SF', winners[0], winners[1]), winners[2], matchType, readOnly);
  // 4 groups
  return _renderKnockoutStage(tournament, tMatches, 'SF1', '⚔️ Semi Final 1', winners[0], winners[1], matchType, readOnly)
    + _renderKnockoutStage(tournament, tMatches, 'SF2', '⚔️ Semi Final 2', winners[2], winners[3], matchType, readOnly)
    + _renderKnockoutStage(tournament, tMatches, 'GF', '🏆 Grand Final', _mw('SF1', winners[0], winners[1]), _mw('SF2', winners[2], winners[3]), matchType, readOnly);
}

// ── renderTournamentBracket (v3: multi-group knockout + readOnly mode) ──────
async function renderTournamentBracket(tournament, groups, readOnly = false) {
  let html = '';
  const tMatches = await dbGetTournamentMatches(tournament.id);
  const matchType = getTournamentMatchType(groups);
  const realGroups = getTournamentGroups(groups);

  for (const grp of realGroups) {
    const grpLetter = grp.letter;
    const standings = calculateGroupStandings(grp, tMatches, matchType);
    const isDoubles = matchType === '2v2' && grp.teams;
    const colHeader = isDoubles ? 'ทีม' : 'ผู้เล่น';
    const modeBadge = isDoubles ? `<span class="t-mode-badge t-mode-doubles" style="font-size:0.64rem">Doubles</span>` : '';

    const rows = standings.map((s, idx) => {
      const rankEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx+1}.`;
      const topStyle = idx === 0 && s.wins > 0 ? ' style="background:rgba(255,215,0,0.05)"' : '';
      return `<tr${topStyle}><td style="font-weight:600">${rankEmoji} ${s.label}</td><td style="color:var(--neon)">${s.wins}</td><td style="color:var(--red)">${s.losses}</td><td style="color:var(--gold)">${s.points}</td><td style="font-size:0.72rem;color:var(--muted)">${s.scoreFor}-${s.scoreAgainst}</td></tr>`;
    }).join('');

    // Build record section: fixture grid (doubles) or free-entry form (singles) — hidden in read-only mode
    let recordSection = '';
    if (!readOnly) {
    if (isDoubles && grp.teams && grp.teams.length >= 2) {
      const teams = grp.teams;
      const grpDone = tMatches.filter(m => m.group_letter === grpLetter);
      const total = teams.length * (teams.length - 1) / 2;
      recordSection += `<div style="margin-top:10px">
        <div style="font-size:0.76rem;font-weight:600;color:var(--muted);margin-bottom:6px">📋 Fixtures · ${grpDone.length}/${total} แมตช์</div>`;
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          const tA = teams[i], tB = teams[j];
          const aA = tA.playerIds[0], aB = tB.playerIds[0];
          const lA = tA.name || String.fromCharCode(65 + i);
          const lB = tB.name || String.fromCharCode(65 + j);
          const dA = tA.playerIds.map(id => db.players.find(p=>p.id===id)?.name||'?').join('+');
          const dB = tB.playerIds.map(id => db.players.find(p=>p.id===id)?.name||'?').join('+');
          const rec = grpDone.find(m =>
            (m.player_a===aA && m.player_b===aB)||(m.player_a===aB && m.player_b===aA)
          );
          if (rec) {
            const wA = rec.winner_id === aA;
            const sa = rec.player_a===aA ? rec.score_a : rec.score_b;
            const sb = rec.player_a===aA ? rec.score_b : rec.score_a;
            recordSection += `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;background:rgba(0,245,160,0.04);border:1px solid var(--glass-border);margin-bottom:5px;font-size:0.75rem">
              <span style="flex:1;text-align:right;font-weight:${wA?700:400};color:${wA?'var(--neon)':'var(--text)'}">${lA}: ${dA}</span>
              <span style="font-family:'Rajdhani',sans-serif;font-weight:700;color:var(--gold);min-width:36px;text-align:center">${sa}-${sb}</span>
              <span style="flex:1;font-weight:${!wA?700:400};color:${!wA?'var(--neon)':'var(--text)'}">${lB}: ${dB}</span>
              <span style="color:var(--neon);font-size:0.6rem">✅</span>
            </div>`;
          } else {
            const fid = `f_${tournament.id}_${grpLetter}_${aA}_${aB}`;
            recordSection += `<div style="padding:7px 10px;border-radius:10px;border:1px dashed rgba(255,255,255,0.1);margin-bottom:5px">
              <div style="font-size:0.73rem;color:var(--muted);margin-bottom:5px">
                <span style="color:var(--text)">${lA}: ${dA}</span> <span>vs</span> <span style="color:var(--text)">${lB}: ${dB}</span>
              </div>
              <div style="display:flex;gap:5px;align-items:center">
                <input class="inp" type="number" id="${fid}_sa" placeholder="${lA}" style="width:52px;font-size:0.76rem;padding:5px 6px" min="0">
                <span style="color:var(--muted)">-</span>
                <input class="inp" type="number" id="${fid}_sb" placeholder="${lB}" style="width:52px;font-size:0.76rem;padding:5px 6px" min="0">
                <button class="btn btn-primary btn-sm" style="width:auto;font-size:0.72rem;padding:4px 10px"
                  onclick="recordFixture(${tournament.id},'${grpLetter}',${aA},${aB})">✅</button>
              </div>
            </div>`;
          }
        }
      }
      recordSection += '</div>';
    } else {
      // Singles: original free-entry form
      const playerOpts = (grp.playerIds || []).map(id => { const p = db.players.find(x => x.id === id); return p ? `<option value="${p.id}">${p.name}</option>` : ''; }).join('');
      recordSection = `<div style="margin-top:8px;font-size:0.78rem;color:var(--muted);margin-bottom:4px">บันทึกแมตช์ Group ${grpLetter}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <select class="inp" id="tm_pa_${tournament.id}_${grpLetter}" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${playerOpts}</select>
          <span style="font-size:0.8rem">vs</span>
          <select class="inp" id="tm_pb_${tournament.id}_${grpLetter}" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${playerOpts}</select>
          <input class="inp" type="number" id="tm_sa_${tournament.id}_${grpLetter}" placeholder="A" style="width:50px;font-size:0.76rem;padding:6px 8px" min="0">
          <span>-</span>
          <input class="inp" type="number" id="tm_sb_${tournament.id}_${grpLetter}" placeholder="B" style="width:50px;font-size:0.76rem;padding:6px 8px" min="0">
          <button class="btn btn-primary btn-sm" style="width:auto;font-size:0.72rem"
            onclick="recordTournamentMatch(${tournament.id},'${grpLetter}','${matchType}')">✅</button>
        </div>`;
    }
    } // end !readOnly

    html += `<div style="margin-bottom:12px">
      <div style="font-size:0.8rem;font-weight:600;margin-bottom:5px">Group ${grpLetter} ${modeBadge}</div>
      <table class="tournament-table">
        <thead><tr><th>${colHeader}</th><th>W</th><th>L</th><th>Pts</th><th>Score</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${recordSection}
    </div>`;
  }

  // ── Knockout stage (2→GF, 3→SF+GF, 4→SF1+SF2+GF) or single-group champion ──
  if (realGroups.length >= 2) {
    const groupWinners = realGroups.map(grp => calculateGroupStandings(grp, tMatches, matchType)[0] || null).filter(Boolean);
    if (groupWinners.length >= 2) {
      html += _buildKnockoutSection(tournament, tMatches, groupWinners, matchType, readOnly);
    }
  } else if (realGroups.length === 1) {
    const st = calculateGroupStandings(realGroups[0], tMatches, matchType);
    if (st[0] && st[0].wins > 0) {
      html += `<div class="champ-decided-banner"><div class="champ-decided-label">🏆 Champion decided by Group Ranking</div><div class="champ-decided-name">👑 ${st[0].label}</div><div style="font-size:0.72rem;color:var(--muted);margin-top:3px">${st[0].wins}W · ${st[0].losses}L · ${st[0].points} pts</div></div>`;
    }
  }

  return html;
}

// ── createTournament (updated: reads matchType, builds 1v1 or 2v2 groups) ──
async function createTournament() {
  const name = (document.getElementById('tournamentName')?.value || '').trim();
  const tier  = document.getElementById('tournamentTier')?.value || 'Regular';
  const matchType = document.getElementById('tournamentMatchType')?.value || '1v1';
  if (!name) return toast('กรุณากรอกชื่อทัวร์นาเมนต์', 'error');

  let groups = [];

  if (matchType === '2v2') {
    const teams = _get2v2Teams();
    if (teams.length < 2) return toast('ต้องมีอย่างน้อย 2 ทีม', 'error');
    const allIds = teams.flatMap(t => t.playerIds);
    if (allIds.some(isNaN)) return toast('กรุณาเลือกผู้เล่นในทุกทีมให้ครบ', 'error');
    if (new Set(allIds).size !== allIds.length) return toast('ผู้เล่นต้องไม่ซ้ำกันในทุกทีม', 'error');
    groups = [
      { _meta: true, matchType: '2v2' },
      { letter: 'A', matchType: '2v2', teams }
    ];

  } else if ((tier === 'Regular' || tier === 'Super 500')) {
    // ── Regular/Super 500 1v1: open registration, players sign up themselves ──
    const numGroups = parseInt(document.getElementById('tourNumGroups')?.value) || 2;
    const playersPerGroup = parseInt(document.getElementById('tourPlayersPerGroup')?.value) || 4;
    groups = [
      { _meta: true, matchType: '1v1' },
      { _config: true, numGroups, playersPerGroup, registrationOpen: true, registrations: [] }
    ];

  } else {
    // ── Super 1000 1v1: admin picks players ──
    const checked = Array.from(document.querySelectorAll('#tournamentPlayerSelect input:checked'))
      .map(x => parseInt(x.value));
    if (checked.length < 4 || checked.length > 16) return toast('เลือกผู้เล่น 4-16 คน', 'error');
    const numGroups = checked.length <= 4 ? 1 : checked.length <= 8 ? 2 : checked.length <= 12 ? 3 : 4;
    groups = Array.from({length: numGroups}, (_, i) => ({ letter: String.fromCharCode(65+i), playerIds: [] }));
    checked.forEach((id, i) => groups[i % numGroups].playerIds.push(id));
  }

  try {
    toast('กำลังสร้าง...', 'info');
    await dbCreateTournament(name, tier, groups);
    toast('สร้าง Tournament แล้ว! 🏆', 'success');
    renderTournamentSection();
  } catch(e) { toast('สร้างไม่ได้: ' + e.message, 'error'); }
}

// ── recordTournamentMatch (updated: supports both modes + coin award for 2v2) ──
async function recordTournamentMatch(tournamentId, groupLetter, matchType) {
  const pa = parseInt(document.getElementById(`tm_pa_${tournamentId}_${groupLetter}`)?.value);
  const pb = parseInt(document.getElementById(`tm_pb_${tournamentId}_${groupLetter}`)?.value);
  const sa = parseInt(document.getElementById(`tm_sa_${tournamentId}_${groupLetter}`)?.value);
  const sb = parseInt(document.getElementById(`tm_sb_${tournamentId}_${groupLetter}`)?.value);
  const mType = matchType || '1v1';
  if (!pa || !pb || pa === pb) return toast('เลือก' + (mType === '2v2' ? 'ทีม' : 'ผู้เล่น') + ' 2 ฝ่ายที่ต่างกัน', 'error');
  if (isNaN(sa) || isNaN(sb)) return toast('กรุณากรอกสกอร์', 'error');
  const winnerId = sa > sb ? pa : pb;
  try {
    await dbAddTournamentMatch(tournamentId, groupLetter, pa, pb, sa, sb, winnerId);

    // [NEW] Award coins to ALL players in the winning 2v2 team
    if (mType === '2v2' && isAdminUser()) {
      try {
        const allTs = await dbGetTournaments();
        const t = allTs.find(x => x.id === tournamentId);
        if (t) {
          let grps = [];
          try { grps = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
          const winTeam = getTeamByAnchor(grps, winnerId);
          if (winTeam?.playerIds) {
            await awardMatchCoins(winTeam.playerIds);
          }
        }
      } catch(e) { /* coin award is best-effort, don't block */ }
    }

    toast('บันทึก Tournament Match แล้ว!', 'success');
    renderTournamentSection();
    if (document.getElementById('tournamentTabContent')) renderTournamentTab();
  } catch(e) { toast('บันทึกไม่ได้: ' + e.message, 'error'); }
}

// ── Player self-registration ──────────────────────────────────────────────────
async function _patchTournamentConfig(tournamentId, newConfig) {
  const t = await dbGetTournamentById(tournamentId);
  if (!t) throw new Error('ไม่พบ Tournament');
  let gs = [];
  try { gs = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
  const newGs = gs.map(g => g._config ? newConfig : g);
  await supaFetch(`tournaments?id=eq.${tournamentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ groups: JSON.stringify(newGs) }),
    prefer: 'return=minimal'
  });
}

async function registerForTournament(tournamentId) {
  if (!currentUser) return toast('กรุณาเข้าสู่ระบบก่อน', 'error');
  try {
    const t = await dbGetTournamentById(tournamentId);
    let gs = [];
    try { gs = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
    const cfg = getTournamentConfig(gs);
    if (!cfg?.registrationOpen) return toast('ปิดรับสมัครแล้ว', 'error');
    const regs = cfg.registrations || [];
    const max = cfg.numGroups * cfg.playersPerGroup;
    if (regs.includes(currentUser.id)) return toast('คุณสมัครไปแล้ว', 'error');
    if (regs.length >= max) return toast(`เต็มแล้ว (${max} คน)`, 'error');
    cfg.registrations = [...regs, currentUser.id];
    await _patchTournamentConfig(tournamentId, cfg);
    toast('สมัครแข่งแล้ว ✅', 'success');
    renderTournamentTab();
  } catch(e) { toast('สมัครไม่ได้: ' + e.message, 'error'); }
}

async function unregisterFromTournament(tournamentId) {
  if (!currentUser) return;
  try {
    const t = await dbGetTournamentById(tournamentId);
    let gs = [];
    try { gs = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
    const cfg = getTournamentConfig(gs);
    if (!cfg?.registrationOpen) return toast('ปิดรับสมัครแล้ว', 'error');
    cfg.registrations = (cfg.registrations || []).filter(id => id !== currentUser.id);
    await _patchTournamentConfig(tournamentId, cfg);
    toast('ถอนสมัครแล้ว', 'success');
    renderTournamentTab();
  } catch(e) { toast('ถอนสมัครไม่ได้: ' + e.message, 'error'); }
}

async function startTournament(tournamentId) {
  try {
    const t = await dbGetTournamentById(tournamentId);
    let gs = [];
    try { gs = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
    const cfg = getTournamentConfig(gs);
    if (!cfg) return toast('ไม่พบการตั้งค่า', 'error');
    const regs = cfg.registrations || [];
    if (regs.length < 4) return toast(`ต้องมีผู้เล่นอย่างน้อย 4 คน (ตอนนี้ ${regs.length} คน)`, 'error');
    // Distribute registrations into groups (round-robin)
    const numGroups = Math.min(cfg.numGroups, Math.max(1, Math.ceil(regs.length / (cfg.playersPerGroup || 4))));
    const groupEntries = Array.from({length: numGroups}, (_, i) => ({ letter: String.fromCharCode(65+i), playerIds: [] }));
    regs.forEach((id, i) => groupEntries[i % numGroups].playerIds.push(id));
    const newGs = [
      ...gs.filter(g => g._meta),
      { ...cfg, registrationOpen: false },
      ...groupEntries
    ];
    await supaFetch(`tournaments?id=eq.${tournamentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ groups: JSON.stringify(newGs) }),
      prefer: 'return=minimal'
    });
    delete _tourStore[tournamentId];
    toast('เริ่มการแข่งขันแล้ว! 🏆', 'success');
    renderTournamentTab();
    if (document.getElementById('tournamentAdminSection')) renderTournamentSection();
  } catch(e) { toast('เริ่มไม่ได้: ' + e.message, 'error'); }
}

// ── Tournament Tab (public view for all users) ────────────────────────────────
async function renderTournamentTab() {
  const container = document.getElementById('tournamentTabContent');
  if (!container) return;
  const isAdmin = isAdminUser();

  let html = `<div style="margin-bottom:12px;display:flex;justify-content:flex-end">
    <button onclick="openTournamentHoF()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:50px;border:1px solid rgba(255,215,0,0.35);background:rgba(255,215,0,0.07);color:var(--gold);font-size:0.78rem;font-weight:700;cursor:pointer">🏛️ ทำเนียบแชมป์</button>
  </div>`;

  try {
    const tournaments = await dbGetTournaments();
    const visible = tournaments.filter(t => t.status !== 'completed' && (isAdmin || t.tier !== 'Super 1000'));

    if (!visible.length) {
      html += `<div style="text-align:center;color:var(--muted);padding:36px 16px">
        <div style="font-size:2.8rem;margin-bottom:10px">🏸</div>
        <div style="font-size:0.88rem;font-weight:600">ยังไม่มีทัวร์นาเมนต์ที่กำลังแข่งขัน</div>
        <div style="font-size:0.76rem;margin-top:6px">ติดตาม Admin ประกาศทัวร์นาเมนต์ใหม่ได้เลย</div>
      </div>`;
    } else {
      for (const t of visible) {
        let groups = [];
        try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
        const matchType = getTournamentMatchType(groups);
        const cfg = getTournamentConfig(groups);
        _tourStore[t.id] = { groups, matchType, tier: t.tier, name: t.name };
        const tierBadge = t.tier === 'Super 1000' ? '🥇' : t.tier === 'Super 500' ? '🥈' : '🏸';
        const tierColor = t.tier === 'Super 1000' ? 'rgba(255,215,0,0.35)' : t.tier === 'Super 500' ? 'rgba(192,192,192,0.25)' : 'rgba(205,127,50,0.25)';
        const safeName = t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const header = `<div class="tournament-group-title">${tierBadge} ${t.name} ${renderModeBadge(matchType)}<span style="font-size:0.68rem;color:var(--muted);margin-left:4px">[${t.tier}]</span></div>`;

        html += `<div class="tournament-group" style="margin-bottom:16px;position:relative;border-color:${tierColor}">`;

        if (cfg?.registrationOpen) {
          // ── REGISTRATION PHASE ──────────────────────────────────────────────
          const regs = cfg.registrations || [];
          const max = cfg.numGroups * cfg.playersPerGroup;
          const pct = Math.round(regs.length / max * 100);
          const isRegistered = currentUser && regs.includes(currentUser.id);
          const isFull = regs.length >= max;
          if (isAdmin) {
            html += `<button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕</button>`;
          }
          html += header;
          html += `<div style="margin:10px 0 8px">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px">
              <span style="font-size:0.82rem;font-weight:700">📋 รับสมัคร <span style="color:var(--neon)">${regs.length}</span>/${max} คน</span>
              <span style="font-size:0.72rem;color:var(--muted)">${cfg.numGroups} กลุ่ม · ${cfg.playersPerGroup} คน/กลุ่ม</span>
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:var(--neon);border-radius:3px;transition:width .3s"></div>
            </div>
          </div>`;
          if (regs.length) {
            html += `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">
              ${regs.map(id => {
                const n = db.players.find(p => p.id === id)?.name || `#${id}`;
                const me = currentUser && id === currentUser.id;
                return `<span style="font-size:0.72rem;padding:2px 9px;border-radius:20px;background:var(--card);border:1px solid ${me?'var(--neon)':'var(--glass-border)'};color:${me?'var(--neon)':'var(--text)'}">${n}${me?' ✓':''}</span>`;
              }).join('')}
            </div>`;
          } else {
            html += `<div style="font-size:0.78rem;color:var(--muted);margin-bottom:12px">ยังไม่มีผู้สมัคร · เป็นคนแรกเลย!</div>`;
          }
          html += `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">`;
          if (currentUser) {
            if (isRegistered) {
              html += `<button class="btn btn-sm" style="width:auto;background:rgba(255,60,60,0.1);border:1px solid rgba(255,60,60,0.4);color:#ff6060;font-size:0.8rem" onclick="unregisterFromTournament(${t.id})">✕ ถอนสมัคร</button>`;
            } else {
              html += `<button class="btn btn-primary btn-sm" style="width:auto;font-size:0.8rem${isFull?';opacity:.5;pointer-events:none':''}" ${isFull?'disabled':''} onclick="registerForTournament(${t.id})">${isFull?'เต็มแล้ว':'🏸 สมัครแข่ง'}</button>`;
            }
          } else {
            html += `<span style="font-size:0.76rem;color:var(--muted)">เข้าสู่ระบบเพื่อสมัครแข่ง</span>`;
          }
          if (isAdmin) {
            html += `<button class="btn btn-sm" style="width:auto;font-size:0.78rem;background:rgba(0,245,160,.1);border:1px solid rgba(0,245,160,.35);color:var(--neon)${regs.length<4?';opacity:.45;pointer-events:none':''}" ${regs.length<4?'disabled':''} onclick="startTournament(${t.id})">▶ เริ่มการแข่งขัน (${regs.length} คน)</button>`;
          }
          html += `</div>`;

        } else {
          // ── BRACKET PHASE ───────────────────────────────────────────────────
          if (isAdmin) {
            const champBtn = `<button class="btn btn-primary btn-sm" style="padding:3px 10px;font-size:0.72rem;width:auto;background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.5);color:#ffd700" onclick="confirmDeclareChampion(${t.id})">👑 ประกาศแชมป์</button>`;
            const rewardBtn = `<button class="btn btn-sm" style="padding:3px 10px;font-size:0.72rem;width:auto;background:rgba(255,165,0,.12);border:1px solid rgba(255,165,0,.4);color:#ffb347;margin-right:6px" onclick="openRewardManager(${t.id},'${t.tier}')">🎁 รางวัล</button>`;
            html += `<button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕</button>`;
            html += `<div class="tournament-group-title" style="padding-right:60px">${tierBadge} ${t.name} ${renderModeBadge(matchType)}<span style="font-size:0.68rem;color:var(--muted);margin-left:4px">[${t.tier}]</span></div>`;
            html += renderRewardCards(t.id, t.tier);
            html += await renderTournamentBracket(t, groups, false);
            html += `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--glass-border);display:flex;align-items:center;justify-content:flex-end">${rewardBtn}${champBtn}</div>`;
          } else {
            html += header;
            html += await renderTournamentBracket(t, groups, true);
          }
        }

        html += `</div>`;
      }
    }
  } catch(e) {
    html += `<div style="color:var(--red);padding:16px;font-size:0.82rem;text-align:center">โหลดไม่ได้: ${e.message}</div>`;
  }

  container.innerHTML = html;
}

