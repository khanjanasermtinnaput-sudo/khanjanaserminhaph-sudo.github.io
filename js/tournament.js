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

// ── [NEW] Return actual groups, skipping the _meta sentinel ──
function getTournamentGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.filter(g => !g._meta);
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

// ── [NEW] Human-readable team name: "Alice + Bob" ──
function getTeamDisplayName(team, players) {
  if (!team || !team.playerIds) return '—';
  return team.playerIds.map(id => players.find(p => p.id === id)?.name || '?').join(' + ');
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
  try {
    // ดึง runner-up จาก GF match (ถ้ามี)
    let runnerUpName = '';
    try {
      const _tms2 = await dbGetTournamentMatches(tournamentId);
      const _gf2 = _tms2.find(m => m.group_letter === 'GF');
      if (_gf2) {
        const _ruAnchor = _gf2.winner_id === _gf2.player_a ? _gf2.player_b : _gf2.player_a;
        const _ruIds = matchType === '2v2' ? (getTeamByAnchor(groups, _ruAnchor)?.playerIds || [_ruAnchor]) : [_ruAnchor];
        runnerUpName = _ruIds.map(pid => db.players.find(x=>x.id===pid)?.name||'?').join(' & ');
      }
    } catch(e) {}
    await dbCompleteTournament(tournamentId, {
      champion_ids: winnerPlayerIds,
      champion_name: winnerNames,
      runner_up_name: runnerUpName,
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

  const ptsMsg = bonusPts > 0 ? ` +${bonusPts} pts` : '';
  toast(`👑 ${winnerNames} ชนะ ${tierName}! +${totalCoins} 🪙${ptsMsg}`, 'success');

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

// ── [NEW] Toggle Group B section in 2v2 create form ──
function toggle2v2GroupB(show) {
  const el = document.getElementById('t2v2_groupB_section');
  if (el) el.style.display = show ? '' : 'none';
}

// ── [NEW] Switch between 1v1 checkboxes and 2v2 team UI ──
function onTournamentModeChange() {
  const mode = document.getElementById('tournamentMatchType')?.value || '1v1';
  const d1 = document.getElementById('tournamentPlayerSelect1v1');
  const d2 = document.getElementById('tournamentPlayerSelect2v2');
  if (d1) d1.style.display = mode === '1v1' ? '' : 'none';
  if (d2) d2.style.display = mode === '2v2' ? '' : 'none';
}

// ── renderTournamentSection (updated: add matchType selector + 2v2 team UI) ──
async function openTournamentHoF() {
  // สร้าง modal HOF Tournament
  document.getElementById('tourHofBg')?.remove();
  const bg = document.createElement('div');
  bg.id = 'tourHofBg';
  bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:800;display:flex;align-items:center;justify-content:center;padding:16px';
  bg.innerHTML = `<div style="background:var(--bg2);border:1px solid rgba(255,215,0,0.25);border-radius:24px;width:100%;max-width:420px;max-height:82vh;overflow-y:auto;padding:0">
    <div style="padding:20px 20px 0;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'Rajdhani',sans-serif;font-size:1.3rem;font-weight:700;background:linear-gradient(135deg,#ffd700,#fff4a3);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">🏛️ ทำเนียบแชมป์</div>
      <button onclick="document.getElementById('tourHofBg').remove()" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);cursor:pointer;font-size:0.9rem;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <div id="tourHofBody" style="padding:4px 16px 20px"><div style="text-align:center;color:var(--muted);padding:20px">⏳ กำลังโหลด...</div></div>
  </div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);

  try {
    const rows = await dbGetHOFTournaments();
    const body = document.getElementById('tourHofBody');
    if (!body) return;
    if (!rows.length) { body.innerHTML = `<div style="text-align:center;color:var(--muted);padding:24px;font-size:0.85rem">ยังไม่มีทัวร์นาเมนต์ที่จบแล้ว</div>`; return; }
    const tierIcon = t => t === 'Super 1000' ? '👑' : t === 'Super 500' ? '🥈' : '🏸';
    const tierColor = t => t === 'Super 1000' ? 'var(--gold)' : t === 'Super 500' ? 'var(--silver)' : 'var(--rank-bronze)';
    body.innerHTML = rows.map(r => {
      let hof = {};
      try {
        const grps = typeof r.groups === 'string' ? JSON.parse(r.groups) : (r.groups || []);
        hof = grps.find(g => g._hof) || {};
      } catch(e) {}
      const endDate = hof.ended_at ? new Date(hof.ended_at).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) : new Date(r.created_at).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});
      const modeTag = hof.match_type === '2v2' ? '<span style="font-size:0.6rem;background:rgba(0,217,245,0.12);border:1px solid rgba(0,217,245,0.3);color:var(--neon2);border-radius:20px;padding:1px 6px">2v2</span>' : '';
      return `<div style="border:1px solid var(--glass-border);border-radius:14px;background:var(--card);padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:1.1rem">${tierIcon(r.tier)}</span>
            <span style="font-weight:700;font-size:0.9rem">${r.name}</span>
            ${modeTag}
          </div>
          <span style="font-size:0.65rem;color:var(--muted)">${endDate}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:0.75rem;background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.3);color:var(--gold);border-radius:20px;padding:1px 7px">🏆 ${hof.champion_name || '?'}</span>
          <span style="font-size:0.65rem;color:var(--muted);font-weight:600;padding:1px 6px;border-radius:10px;background:rgba(255,255,255,0.05)">${r.tier}</span>
        </div>
        ${hof.runner_up_name ? `<div style="font-size:0.7rem;color:var(--muted)">🥈 รองแชมป์: ${hof.runner_up_name}</div>` : ''}
      </div>`;
    }).join('');
  } catch(e) {
    const body = document.getElementById('tourHofBody');
    if (body) body.innerHTML = `<div style="text-align:center;color:var(--red);padding:20px;font-size:0.82rem">โหลดไม่ได้: ${e.message}</div>`;
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
    <select class="inp" id="tournamentTier" style="margin-bottom:8px">
      <option value="Regular">Regular</option>
      <option value="Super 500">Super 500</option>
      <option value="Super 1000">Super 1000</option>
    </select>
    <!-- [NEW] Match type selector: 1v1 Singles / 2v2 Doubles -->
    <select class="inp" id="tournamentMatchType" style="margin-bottom:10px" onchange="onTournamentModeChange()">
      <option value="1v1">🏸 1v1 — Singles</option>
      <option value="2v2">⚔️ 2v2 — Doubles</option>
    </select>

    <!-- [NEW] 1v1 player checkboxes (shown by default) -->
    <div id="tournamentPlayerSelect1v1">
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px">เลือกผู้เล่น 4-6 คน:</div>
      <div id="tournamentPlayerSelect" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${db.players.map(p => `<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem;cursor:pointer"><input type="checkbox" value="${p.id}" id="tp_${p.id}"> ${p.name}</label>`).join('')}
      </div>
    </div>

    <!-- [NEW] 2v2 team builder (hidden until mode = 2v2) -->
    <div id="tournamentPlayerSelect2v2" style="display:none">
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px">ระบุผู้เล่นในแต่ละทีม (ไม่ซ้ำกัน):</div>
      <div style="font-size:0.75rem;font-weight:700;color:var(--neon);margin-bottom:6px">📌 Group A</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
        <div class="t-team-box">
          <div class="t-team-label">⚔️ Team A1</div>
          <select class="inp" id="t2v2_A_0_0" style="margin-bottom:6px;font-size:0.76rem">${pOpts}</select>
          <select class="inp" id="t2v2_A_0_1" style="font-size:0.76rem">${pOpts}</select>
        </div>
        <div style="font-weight:700;color:var(--muted);padding:4px;align-self:center">vs</div>
        <div class="t-team-box">
          <div class="t-team-label">⚔️ Team A2</div>
          <select class="inp" id="t2v2_A_1_0" style="margin-bottom:6px;font-size:0.76rem">${pOpts}</select>
          <select class="inp" id="t2v2_A_1_1" style="font-size:0.76rem">${pOpts}</select>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:0.78rem;cursor:pointer;margin-bottom:8px">
        <input type="checkbox" id="t2v2_addGroupB" onchange="toggle2v2GroupB(this.checked)">
        เพิ่ม Group B (Group Stage)
      </label>
      <div id="t2v2_groupB_section" style="display:none">
        <div style="font-size:0.75rem;font-weight:700;color:var(--neon);margin-bottom:6px">📌 Group B</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
          <div class="t-team-box">
            <div class="t-team-label">⚔️ Team B1</div>
            <select class="inp" id="t2v2_B_0_0" style="margin-bottom:6px;font-size:0.76rem">${pOpts}</select>
            <select class="inp" id="t2v2_B_0_1" style="font-size:0.76rem">${pOpts}</select>
          </div>
          <div style="font-weight:700;color:var(--muted);padding:4px;align-self:center">vs</div>
          <div class="t-team-box">
            <div class="t-team-label">⚔️ Team B2</div>
            <select class="inp" id="t2v2_B_1_0" style="margin-bottom:6px;font-size:0.76rem">${pOpts}</select>
            <select class="inp" id="t2v2_B_1_1" style="font-size:0.76rem">${pOpts}</select>
          </div>
        </div>
      </div>
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
        // Store full data so onclick passes only id (avoids JSON double-quote breaking HTML attribute)
        _tourStore[t.id] = { groups, matchType, tier: t.tier, name: t.name };
        const tierBadge = t.tier === 'Super 1000' ? '🥇' : t.tier === 'Super 500' ? '🥈' : '🏸';
        const safeName = t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const champBtn = `<button class="btn btn-primary btn-sm" style="padding:3px 10px;font-size:0.72rem;width:auto;background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.5);color:#ffd700"
               onclick="confirmDeclareChampion(${t.id})">👑 ประกาศแชมป์</button>`;
        const rewardBtn = `<button class="btn btn-sm" style="padding:3px 10px;font-size:0.72rem;width:auto;background:rgba(255,165,0,.12);border:1px solid rgba(255,165,0,.4);color:#ffb347;margin-right:6px" onclick="openRewardManager(${t.id},'${t.tier}')">🎁 จัดการรางวัล</button>`;
        html += `<div class="tournament-group" style="margin-bottom:16px;position:relative">
          <button class="t-cancel-btn" style="position:absolute;top:10px;right:10px"
            onclick="confirmCancelTournament(${t.id},'${safeName}')">✕ ยกเลิก</button>
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
  } catch(e) {}
  container.innerHTML = html;
}

// ── renderTournamentBracket (v2: calculateGroupStandings + Grand Final / single-group logic) ──
async function renderTournamentBracket(tournament, groups) {
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

    const playerOpts = isDoubles
      ? (grp.teams || []).map(t => `<option value="${t.playerIds[0]}">${getTeamDisplayName(t, db.players)}</option>`).join('')
      : (grp.playerIds || []).map(id => { const p = db.players.find(x => x.id === id); return p ? `<option value="${p.id}">${p.name}</option>` : ''; }).join('');

    html += `<div style="margin-bottom:12px">
      <div style="font-size:0.8rem;font-weight:600;margin-bottom:5px">Group ${grpLetter} ${modeBadge}</div>
      <table class="tournament-table">
        <thead><tr><th>${colHeader}</th><th>W</th><th>L</th><th>Pts</th><th>Score</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:8px;font-size:0.78rem;color:var(--muted);margin-bottom:4px">บันทึกแมตช์ Group ${grpLetter}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <select class="inp" id="tm_pa_${tournament.id}_${grpLetter}" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${playerOpts}</select>
        <span style="font-size:0.8rem">vs</span>
        <select class="inp" id="tm_pb_${tournament.id}_${grpLetter}" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${playerOpts}</select>
        <input class="inp" type="number" id="tm_sa_${tournament.id}_${grpLetter}" placeholder="A" style="width:50px;font-size:0.76rem;padding:6px 8px" min="0">
        <span>-</span>
        <input class="inp" type="number" id="tm_sb_${tournament.id}_${grpLetter}" placeholder="B" style="width:50px;font-size:0.76rem;padding:6px 8px" min="0">
        <button class="btn btn-primary btn-sm" style="width:auto;font-size:0.72rem"
          onclick="recordTournamentMatch(${tournament.id},'${grpLetter}','${matchType}')">✅</button>
      </div>
    </div>`;
  }

  // ── Grand Final (multi-group) or single-group champion banner ──
  if (realGroups.length >= 2) {
    const groupWinners = realGroups.map(grp => {
      const st = calculateGroupStandings(grp, tMatches, matchType);
      return st[0] || null;
    }).filter(Boolean);

    if (groupWinners.length >= 2) {
      // Check if GF match already recorded (group_letter = 'GF')
      const gfMatch = tMatches.find(m => m.group_letter === 'GF');

      let gfContent = '';
      if (gfMatch) {
        // ── GF already played: show result ──
        const winEntry  = groupWinners.find(w => w.id === gfMatch.winner_id);
        const loseEntry = groupWinners.find(w => w.id !== gfMatch.winner_id);
        const winLabel  = winEntry?.label  || db.players.find(p => p.id === gfMatch.winner_id)?.name || '?';
        const loseLabel = loseEntry?.label || '?';
        const sa = gfMatch.score_a, sb = gfMatch.score_b;
        gfContent = `
          <div class="gf-result">
            <div style="font-size:0.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">ผลการแข่งขัน</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center">
              <span style="font-size:1.2rem">🏆</span>
              <span class="gf-winner" style="font-size:1rem">${winLabel}</span>
              <span style="font-family:'Rajdhani';font-size:1.1rem;font-weight:700;color:var(--gold)">${sa} – ${sb}</span>
              <span style="font-size:0.82rem;color:var(--muted)">${loseLabel}</span>
            </div>
            <div style="margin-top:6px;font-size:0.7rem;color:var(--neon);font-weight:600">✅ Grand Final เสร็จสิ้น · กด "ประกาศแชมป์" เพื่อมอบรางวัล + ฉายา Grand Final SS1</div>
          </div>`;
      } else {
        // ── GF not played yet: show matchup + score inputs ──
        const allOpts = groupWinners.map(w => `<option value="${w.id}">${w.label}</option>`).join('');
        const gfA = groupWinners[0], gfB = groupWinners[1];
        gfContent = `
          <div class="gf-match" style="margin-bottom:10px">
            🏆 <span class="gf-winner">${gfA.label}</span>
            <span class="gf-vs">vs</span>
            <span class="gf-winner">${gfB.label}</span>
            <span style="font-size:0.7rem;color:var(--muted)">— Grand Final</span>
          </div>
          <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px">⌨️ บันทึกผล Grand Final</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <select class="inp" id="tm_pa_${tournament.id}_GF" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${allOpts}</select>
            <span style="font-size:0.8rem">vs</span>
            <select class="inp" id="tm_pb_${tournament.id}_GF" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${allOpts}</select>
            <input class="inp" type="number" id="tm_sa_${tournament.id}_GF" placeholder="A" style="width:50px;font-size:0.76rem;padding:6px 8px" min="0">
            <span>-</span>
            <input class="inp" type="number" id="tm_sb_${tournament.id}_GF" placeholder="B" style="width:50px;font-size:0.76rem;padding:6px 8px" min="0">
            <button class="btn btn-sm" style="width:auto;font-size:0.72rem;background:rgba(255,215,0,.18);border:1px solid rgba(255,215,0,.5);color:#ffd700"
              onclick="recordTournamentMatch(${tournament.id},'GF','${matchType}')">🏆 บันทึก GF</button>
          </div>`;
      }

      html += `<div class="gf-bracket"><div class="gf-title">🏆 Grand Final</div>${gfContent}</div>`;
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
    // ── [NEW] Build 2v2 groups from dropdown selections ──
    const gv = id => parseInt(document.getElementById(id)?.value);
    const teamA1 = { playerIds: [gv('t2v2_A_0_0'), gv('t2v2_A_0_1')] };
    const teamA2 = { playerIds: [gv('t2v2_A_1_0'), gv('t2v2_A_1_1')] };
    const allA = teamA1.playerIds.concat(teamA2.playerIds);
    if (allA.some(isNaN)) return toast('กรุณาเลือกผู้เล่น Group A ให้ครบ', 'error');
    if (new Set(allA).size !== allA.length) return toast('ผู้เล่นใน Group A ต้องไม่ซ้ำกัน', 'error');

    // _meta sentinel stores matchType for future reads
    groups = [
      { _meta: true, matchType: '2v2' },
      { letter: 'A', matchType: '2v2', teams: [teamA1, teamA2] }
    ];

    // Optional Group B
    if (document.getElementById('t2v2_addGroupB')?.checked) {
      const teamB1 = { playerIds: [gv('t2v2_B_0_0'), gv('t2v2_B_0_1')] };
      const teamB2 = { playerIds: [gv('t2v2_B_1_0'), gv('t2v2_B_1_1')] };
      const allB = teamB1.playerIds.concat(teamB2.playerIds);
      if (allB.some(isNaN)) return toast('กรุณาเลือกผู้เล่น Group B ให้ครบ', 'error');
      const combined = allA.concat(allB);
      if (new Set(combined).size !== combined.length) return toast('ผู้เล่นซ้ำกันระหว่าง Group A และ B', 'error');
      groups.push({ letter: 'B', matchType: '2v2', teams: [teamB1, teamB2] });
    }

  } else {
    // ── 1v1: original logic (unchanged) ──
    const checked = Array.from(document.querySelectorAll('#tournamentPlayerSelect input:checked'))
      .map(x => parseInt(x.value));
    if (checked.length < 4 || checked.length > 6) return toast('เลือกผู้เล่น 4-6 คน', 'error');
    const half = Math.ceil(checked.length / 2);
    groups = [
      { letter: 'A', playerIds: checked.slice(0, half) },
      { letter: 'B', playerIds: checked.slice(half) },
    ];
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
  } catch(e) { toast('บันทึกไม่ได้: ' + e.message, 'error'); }
}

