// ── Global store: tournament data keyed by id (avoids JSON-in-onclick quoting bugs) ──
const _tourStore = {};

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
  wins.forEach(m => { if (!m.date) return; const _d = new Date(m.date); if (!isNaN(_d)) counts[_d.getDay()]++; });
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
// ── [Phase 3] Server-authoritative tournament create/register RPCs ──
// Replace dbCreateTournament's raw POST and the racy claimTournamentSlot ->
// _patchTournamentConfig read-modify-write with SECURITY DEFINER RPCs
// (session_uid()-scoped, row-locked). See supabase_tournament_registration.sql.
async function dbTournamentCreate(name, tier, matchType, groups, maxParticipants, registrationDeadline) {
  return supaFetch('rpc/rpc_tournament_create', {
    method: 'POST',
    body: JSON.stringify({
      p_name: name, p_tier: tier, p_match_type: matchType,
      p_groups: groups, p_max_participants: maxParticipants ?? null, p_registration_deadline: registrationDeadline ?? null
    })
  });
}
async function dbTournamentRegister(tournamentId, group, slotIdx, subIdx, partnerId) {
  return supaFetch('rpc/rpc_tournament_register', {
    method: 'POST',
    body: JSON.stringify({
      p_tournament_id: tournamentId, p_group: group ?? null, p_slot_idx: slotIdx ?? null,
      p_sub_idx: subIdx ?? null, p_partner_id: partnerId ?? null
    })
  });
}
async function dbTournamentUnregister(tournamentId) {
  return supaFetch('rpc/rpc_tournament_unregister', { method: 'POST', body: JSON.stringify({ p_tournament_id: tournamentId }) });
}
// Thai-friendly text for the registration RPC error codes (economyErrCode pulls
// the code out of the thrown PostgREST error body, same helper economy.js uses).
const _TOUR_REG_ERR_TEXT = {
  not_authenticated: 'กรุณาเข้าสู่ระบบก่อน',
  not_authorized: 'เฉพาะแอดมินเท่านั้น',
  tournament_not_found: 'ไม่พบ Tournament',
  tournament_not_active: 'Tournament นี้ปิดไปแล้ว',
  registration_not_configured: 'ยังไม่เปิดรับสมัคร',
  registration_closed: 'ปิดรับสมัครแล้ว',
  deadline_passed: 'หมดเขตรับสมัครแล้ว',
  tournament_full: 'ผู้เข้าแข่งขันเต็มแล้ว',
  already_registered: 'คุณสมัครไปแล้ว',
  not_registered: 'คุณยังไม่ได้สมัคร',
  slot_taken: 'ช่องนี้มีคนสมัครแล้ว',
  invalid_partner: 'เลือกคู่หูไม่ถูกต้อง (ต้องไม่ใช่ตัวเอง และยังไม่มีคู่)',
  invalid_slot: 'ช่องสมัครไม่ถูกต้อง',
  invalid_group: 'สายไม่ถูกต้อง',
  invalid_format: 'รูปแบบทัวร์นาเมนต์ไม่ถูกต้อง',
  invalid_match_type: 'ประเภทการแข่งขันไม่ถูกต้อง',
  invalid_name: 'กรุณากรอกชื่อทัวร์นาเมนต์',
  invalid_max_participants: 'จำนวนผู้เข้าแข่งขันสูงสุดต้องอยู่ระหว่าง 2-32',
};
function _tourRegErrText(e) {
  const code = economyErrCode(e);
  return _TOUR_REG_ERR_TEXT[code] || code || 'ไม่สำเร็จ';
}
async function dbGetTournamentMatches(tournamentId) {
  try { return await supaFetch(`tournament_matches?tournament_id=eq.${tournamentId}&order=played_at.asc`); } catch(e) { return []; }
}
// ── [Phase 7] Routed through rpc_tournament_submit_group_result /
// rpc_tournament_delete instead of a raw client PostgREST write — same
// names/signatures/no-meaningful-return-value contract as before, so every
// existing call site (_refFinish, confirmCancelTournament, the HoF delete
// flow) is unchanged. See supabase_tournament_lockdown.sql. ──
async function dbAddTournamentMatch(tournamentId, groupLetter, playerA, playerB, scoreA, scoreB, winnerId) {
  await supaFetch('rpc/rpc_tournament_submit_group_result', {
    method: 'POST',
    body: JSON.stringify({
      p_tournament_id: tournamentId, p_group_letter: groupLetter, p_player_a: playerA, p_player_b: playerB,
      p_score_a: scoreA, p_score_b: scoreB, p_winner_id: winnerId
    })
  });
}

// ── [NEW] Delete tournament + all its matches ──
async function dbDeleteTournament(tournamentId) {
  await supaFetch('rpc/rpc_tournament_delete', { method: 'POST', body: JSON.stringify({ p_tournament_id: tournamentId }) });
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
  return team.name ? `${esc(team.name)}: ${names}` : names;
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

// ── Per-game score detail (localStorage; DB stores only games-won) ──────────────
function _gameDetailKey(tid, group, idA, idB) {
  const lo = Math.min(idA, idB), hi = Math.max(idA, idB);
  return `tgame_${tid}_${group}_${lo}_${hi}`;
}
function _saveGameDetail(tid, group, idA, idB, games) {
  try { localStorage.setItem(_gameDetailKey(tid, group, idA, idB), JSON.stringify({ idA, idB, games })); } catch(e) {}
}
function _getGameDetail(tid, group, idA, idB) {
  try {
    const raw = localStorage.getItem(_gameDetailKey(tid, group, idA, idB));
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}
// Read-only เกม 1/2/3 summary boxes, oriented so left = playerA(=pa), right = playerB(=pb)
function _renderGameSummary(tid, group, pa, pb) {
  const det = _getGameDetail(tid, group, pa, pb);
  let games = [];
  if (det) {
    games = (det.idA === pa) ? det.games : det.games.map(g => ({ a: g.b, b: g.a }));
  }
  return `<div style="margin-top:4px">
    ${[0,1,2].map(i => {
      const g = games[i];
      const a = g ? g.a : '-', b = g ? g.b : '-';
      const wa = g && g.a > g.b, wb = g && g.b > g.a;
      return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">
        <span style="font-size:0.62rem;color:var(--muted);width:36px;flex-shrink:0">เกม ${i+1}</span>
        <span style="width:40px;text-align:center;font-size:0.78rem;font-weight:${wa?700:400};color:${wa?'var(--neon)':'var(--muted)'};font-family:'Rajdhani',sans-serif">${a}</span>
        <span style="color:var(--muted);font-size:0.75rem">-</span>
        <span style="width:40px;text-align:center;font-size:0.78rem;font-weight:${wb?700:400};color:${wb?'var(--neon)':'var(--muted)'};font-family:'Rajdhani',sans-serif">${b}</span>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Referee mode: live point counter (21-point rules, Best of 3) ────────────────
let _ref = null;
let _declaringChampion = false;

function _refLabel(tid, id, matchType) {
  if (matchType === '2v2') {
    const groups = _tourStore[tid]?.groups || [];
    const team = (typeof getTeamByAnchor === 'function') ? getTeamByAnchor(groups, id) : null;
    if (team) return getTeamDisplayName(team, db.players);
  }
  return db.players.find(p => p.id === id)?.name || '?';
}

function _refGameOver(a, b) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi >= 30) return true;          // hard cap at 30
  if (hi >= 21 && hi - lo >= 2) return true;
  return false;
}

function openReferee(tid, group, idA, idB, matchType) {
  if (!idA || !idB || idA === idB) return toast('เลือก 2 ฝ่ายที่ต่างกัน', 'error');
  // Best-of-3 (ชนะ 2 เกม) เฉพาะ Super 1000 · tier อื่นตัดสินเกมเดียว
  const tier = _tourStore[tid]?.tier;
  const winsNeeded = tier === 'Super 1000' ? 2 : 1;
  _ref = {
    tid, group, idA, idB, matchType, winsNeeded,
    labelA: _refLabel(tid, idA, matchType),
    labelB: _refLabel(tid, idB, matchType),
    games: [],     // committed games: {a, b}
    curA: 0, curB: 0
  };
  _renderRefModal();
}

function _refPoint(side, delta) {
  if (!_ref) return;
  if (side === 'a') _ref.curA = Math.max(0, _ref.curA + delta);
  else _ref.curB = Math.max(0, _ref.curB + delta);
  _renderRefModal();
}

function _refCommitGame() {
  if (!_ref) return;
  if (!_refGameOver(_ref.curA, _ref.curB)) return;
  _ref.games.push({ a: _ref.curA, b: _ref.curB });
  _ref.curA = 0; _ref.curB = 0;
  _renderRefModal();
}

function _refGamesWon() {
  let wA = 0, wB = 0;
  for (const g of _ref.games) { if (g.a > g.b) wA++; else if (g.b > g.a) wB++; }
  return { wA, wB };
}

function _refClose() { _ref = null; document.getElementById('refModal')?.remove(); }

async function _refFinish() {
  if (!_ref) return;
  const need = _ref.winsNeeded || 2;
  const { wA, wB } = _refGamesWon();
  if (wA < need && wB < need) return toast(`ยังไม่จบแมตช์ (ต้องชนะ ${need} เกม)`, 'error');
  const winnerId = wA > wB ? _ref.idA : _ref.idB;
  const { tid, group, idA, idB, matchType, games } = _ref;
  try {
    await dbAddTournamentMatch(tid, group, idA, idB, wA, wB, winnerId);
    _saveGameDetail(tid, group, idA, idB, games);
    if (matchType === '2v2' && isAdminUser()) {
      try {
        const groups = _tourStore[tid]?.groups || [];
        const winTeam = getTeamByAnchor(groups, winnerId);
        if (winTeam?.playerIds) await awardMatchCoins(winTeam.playerIds);
      } catch(e) {}
    }
    if (matchType === '2v2' && typeof dbRecalcPartnerSystem === 'function') {
      try { await dbRecalcPartnerSystem(null); } catch(e) {}
    }
    _refClose();
    toast('บันทึกผลแล้ว ✅', 'success');
    renderTournamentSection();
    if (document.getElementById('tournamentTabContent')) renderTournamentTab();
  } catch(e) { toast('บันทึกไม่ได้: ' + e.message, 'error'); }
}

function _refRenderSide(side, btnDisabled) {
  const r = _ref;
  const cur = side === 'a' ? r.curA : r.curB;
  const label = side === 'a' ? r.labelA : r.labelB;
  const won = _refGamesWon();
  const gamesWon = side === 'a' ? won.wA : won.wB;
  const color = side === 'a' ? 'var(--neon)' : 'var(--neon2)';
  const dis = btnDisabled ? 'disabled' : '';
  const cur2 = btnDisabled ? 'not-allowed' : 'pointer';
  const op = btnDisabled ? '0.38' : '1';
  return `<div style="flex:1;text-align:center;padding:8px">
    <div style="font-size:0.78rem;font-weight:700;color:${color};margin-bottom:4px;min-height:2.2em;display:flex;align-items:center;justify-content:center">${label}</div>
    <div style="font-size:0.6rem;color:var(--muted);margin-bottom:6px">ชนะ ${gamesWon} เกม</div>
    <div style="font-family:'Rajdhani',sans-serif;font-size:4rem;font-weight:700;line-height:1;color:${color}">${cur}</div>
    <div style="display:flex;gap:6px;justify-content:center;margin-top:10px">
      <button onclick="_refPoint('${side}',-1)" ${dis} style="width:42px;height:42px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);font-size:1.2rem;cursor:${cur2};opacity:${op}">−</button>
      <button onclick="_refPoint('${side}',1)" ${dis} style="width:56px;height:56px;border-radius:50%;border:1px solid ${color};background:${color}22;color:${color};font-size:1.6rem;font-weight:700;cursor:${cur2};opacity:${op}">+</button>
    </div>
  </div>`;
}

function _renderRefModal() {
  document.getElementById('refModal')?.remove();
  const r = _ref;
  if (!r) return;
  const need = r.winsNeeded || 2;
  const gameNo = r.games.length + 1;
  const over = _refGameOver(r.curA, r.curB);
  const { wA, wB } = _refGamesWon();
  const matchDone = wA >= need || wB >= need;
  const gameWinnerLabel = r.curA > r.curB ? r.labelA : r.labelB;
  const bestOfLabel = need === 2 ? 'Best of 3' : 'เกมเดียว';

  const gamesLog = r.games.map((g, i) =>
    `<span style="font-size:0.68rem;padding:2px 8px;border-radius:12px;background:var(--card);border:1px solid var(--glass-border);color:var(--muted)">เกม ${i+1}: ${g.a}-${g.b}</span>`
  ).join('');

  let actionBtn = '';
  if (matchDone) {
    const champLabel = wA > wB ? r.labelA : r.labelB;
    actionBtn = `<button class="btn btn-primary" style="width:100%;background:rgba(255,215,0,.18);border:1px solid rgba(255,215,0,.5);color:#ffd700;font-weight:700" onclick="_refFinish()">💾 บันทึกผล · 🏆 ${champLabel} (${wA}-${wB})</button>`;
  } else if (over) {
    // จะจบแมตช์ไหมถ้า commit เกมนี้
    const winnerSideWins = (r.curA > r.curB ? wA : wB) + 1;
    const willFinish = winnerSideWins >= need;
    const nextLabel = willFinish ? '🏆 จบแมตช์' : '→ เกมต่อไป';
    actionBtn = `<button class="btn btn-primary" style="width:100%" onclick="_refCommitGame()">✅ จบเกม ${gameNo} (${gameWinnerLabel} ${r.curA}-${r.curB}) ${nextLabel}</button>`;
  } else {
    actionBtn = `<div style="text-align:center;font-size:0.7rem;color:var(--muted);padding:8px">กำลังแข่งเกมที่ ${gameNo} · ถึง 21 แต้ม (ห่าง 2) เกมจะจบอัตโนมัติ</div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'refModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:14px';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid rgba(0,245,160,.3);border-radius:20px;padding:18px 16px;max-width:420px;width:100%;box-shadow:0 0 60px rgba(0,245,160,.12)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:0.95rem;font-weight:700">🎬 Referee · เกมที่ ${gameNo} <span style="font-size:0.66rem;font-weight:500;color:var(--muted)">(${bestOfLabel})</span></div>
        <button onclick="_refClose()" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);cursor:pointer">✕</button>
      </div>
      ${gamesLog ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">${gamesLog}</div>` : ''}
      <div style="display:flex;align-items:stretch;border:1px solid var(--glass-border);border-radius:14px;background:rgba(255,255,255,0.02);margin-bottom:12px">
        ${_refRenderSide('a', over || matchDone)}
        <div style="width:1px;background:var(--glass-border)"></div>
        ${_refRenderSide('b', over || matchDone)}
      </div>
      ${actionBtn}
    </div>`;
  document.body.appendChild(modal);
}

// Open referee from group 1v1 dropdowns
function openRefereeFromSelects(tid, group, matchType) {
  const a = parseInt(document.getElementById(`tm_pa_${tid}_${group}`)?.value);
  const b = parseInt(document.getElementById(`tm_pb_${tid}_${group}`)?.value);
  openReferee(tid, group, a, b, matchType);
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
    const ptStr = buildPlayerPrimeTitles(pl, { awards: pl.customAch, s1000: pl.super1000Titles });
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

// ── 2v2 team builder ──────────────────────────────────────────────────────────
let _t2v2TeamCount = 0;

function _updateTournamentCreateForm() {
  const tier = document.getElementById('tournamentTier')?.value || 'Regular';
  const mode = document.getElementById('tournamentMatchType')?.value || '1v1';
  // Registration mode: Regular/Super 500/Custom (both 1v1 and 2v2 use open registration)
  const isRegMode = (tier === 'Regular' || tier === 'Super 500' || tier === 'custom');
  const cf = document.getElementById('tournamentCustomFields');
  if (cf) cf.style.display = tier === 'custom' ? 'block' : 'none';
  const d1  = document.getElementById('tournamentPlayerSelect1v1');
  const d2  = document.getElementById('tournamentPlayerSelect2v2');
  const dr  = document.getElementById('tournamentRegDesign');
  if (dr) dr.style.display = isRegMode ? '' : 'none';
  if (d1) d1.style.display = (!isRegMode && mode === '1v1') ? '' : 'none';
  if (d2) d2.style.display = (!isRegMode && mode === '2v2') ? '' : 'none';
  if (!isRegMode && mode === '2v2') _init2v2Teams();
  const lbl = document.getElementById('tourPerGroupLabel');
  if (lbl) lbl.textContent = mode === '2v2' ? 'ทีมต่อกลุ่ม' : 'คนต่อกลุ่ม';
  if (isRegMode) { _updateRegTotal(); _updateRoundTypes(); }
}

// Knockout round-name lookup by bracket size — mirrors
// rpc_tournament_generate_knockout's server-side "case v_rounds ... end"
// table exactly, so this preview stays accurate for any group count.
const KO_ROUND_NAME_TABLE = {
  1: ['F'], 2: ['SF','F'], 3: ['QF','SF','F'], 4: ['R16','QF','SF','F'], 5: ['R32','R16','QF','SF','F']
};
const KO_ROUND_NAME_TH = { F: 'ชิงชนะเลิศ (F)', SF: 'รอบรอง (SF)', QF: 'รอบก่อนรอง (QF)', R16: 'รอบ 16 (R16)', R32: 'รอบ 32 (R32)' };
function _koRoundNamesForGroupCount(ng) {
  if (ng < 2) return [];
  let size = 1; while (size < ng) size *= 2;
  let rounds = 0, s = size; while (s > 1) { s /= 2; rounds++; }
  return KO_ROUND_NAME_TABLE[rounds] || ['F'];
}
// Auto-derived round types from group count (Group → Knockout rounds). Shown in the designer.
function _updateRoundTypes() {
  const el = document.getElementById('tourRoundTypes');
  if (!el) return;
  const ng = parseInt(document.getElementById('tourNumGroups')?.value) || 2;
  const rounds = ['รอบกลุ่ม (Group)', ..._koRoundNamesForGroupCount(ng).map(r => KO_ROUND_NAME_TH[r] || r)];
  el.innerHTML = `🧭 รอบแข่ง: ` + rounds.map(r => `<span class="t-round-chip">${r}</span>`).join(' <span style="color:var(--muted)">→</span> ');
}

// Client-side-only preview of the knockout bracket SHAPE, viewable any time
// (registration open, or group stage in progress) — not the real generated
// bracket (rpc_tournament_generate_knockout hasn't run yet, so there's no
// row to fetch). Leaf slots show "ผู้ชนะกลุ่ม X" placeholders, filling in a
// real name once that group already has a standings leader with a win; every
// later round is a plain "TBD" box. Fed into the same full-screen viewer via
// openBracketFullscreen(..., isPreview=true) — synthetic negative ids so they
// can never collide with real tournament_matches rows.
function _koBuildPreviewMatches(numGroups, realGroups, tMatches, matchType) {
  if (numGroups < 2) return [];
  let size = 1; while (size < numGroups) size *= 2;
  const roundNames = _koRoundNamesForGroupCount(numGroups);
  const leaders = realGroups.map(grp => {
    const hasMatch = tMatches.some(m => m.group_letter === grp.letter && (m.round_index == null));
    if (!hasMatch) return null;
    const st = calculateGroupStandings(grp, tMatches, matchType);
    return (st[0] && st[0].wins > 0) ? st[0] : null;
  });

  const matches = [];
  let idc = -1;
  const leafCount = size / 2;
  let prevIds = [];
  for (let i = 0; i < leafCount; i++) {
    const idxA = i * 2, idxB = i * 2 + 1;
    const grpA = realGroups[idxA], grpB = realGroups[idxB];
    const letterA = grpA ? grpA.letter : String.fromCharCode(65 + idxA);
    const letterB = grpB ? grpB.letter : String.fromCharCode(65 + idxB);
    const leaderA = idxA < numGroups ? leaders[idxA] : null;
    const leaderB = idxB < numGroups ? leaders[idxB] : null;
    const id = idc--;
    matches.push({
      id, round_index: 0, round_name: roundNames[0], bracket_slot: 'PK0-' + i,
      player_a: leaderA ? leaderA.id : null, player_b: leaderB ? leaderB.id : null,
      placeholderA: idxA < numGroups ? `ผู้ชนะกลุ่ม ${letterA}` : 'ว่าง',
      placeholderB: idxB < numGroups ? `ผู้ชนะกลุ่ม ${letterB}` : 'ว่าง',
      winner_id: null, status: 'pending', is_bye: false, score_a: null, score_b: null
    });
    prevIds.push(id);
  }
  let count = leafCount;
  for (let r = 1; r < roundNames.length; r++) {
    count = count / 2;
    const curIds = [];
    for (let i = 0; i < count; i++) {
      const id = idc--;
      matches.push({
        id, round_index: r, round_name: roundNames[r], bracket_slot: 'PK' + r + '-' + i,
        player_a: null, player_b: null, placeholderA: 'TBD', placeholderB: 'TBD',
        winner_id: null, status: 'pending', is_bye: false, score_a: null, score_b: null
      });
      curIds.push(id);
    }
    prevIds = curIds;
  }
  return matches;
}

function _updateRegTotal() {
  const mode = document.getElementById('tournamentMatchType')?.value || '1v1';
  const ng = parseInt(document.getElementById('tourNumGroups')?.value) || 2;
  const pp = parseInt(document.getElementById('tourPlayersPerGroup')?.value) || 4;
  const el = document.getElementById('tourRegTotal');
  if (!el) return;
  if (mode === '2v2') {
    el.textContent = `รับสมัคร: ${ng * pp} ทีม (${ng} กลุ่ม × ${pp} ทีม/กลุ่ม)`;
  } else {
    el.textContent = `รับสมัคร: ${ng * pp} คน (${ng} กลุ่ม × ${pp} คน)`;
  }
  _updateRoundTypes();
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
  const pOpts = db.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
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
    const safeName = (r.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `<div onclick="_hofOpenDetail(${r.id})" style="border:1px solid ${tierBd(r.tier)};border-radius:14px;background:${tierBg(r.tier)};padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:opacity 0.15s" onmouseover="this.style.opacity='.75'" onmouseout="this.style.opacity='1'">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
        <div style="display:flex;align-items:center;gap:6px">
          <span>${tierIcon(r.tier)}</span>
          <span style="font-weight:700;font-size:0.88rem">${esc(r.name)}</span>
          ${mTag}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:0.62rem;color:var(--muted)">${date}</span>
          ${isAdminUser() ? `<button onclick="event.stopPropagation();confirmDeleteHofTournament(${r.id},'${safeName}')" title="ลบประวัติ" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;border:1px solid rgba(255,60,60,0.4);background:rgba(255,60,60,0.1);color:#ff6060;font-size:0.72rem;cursor:pointer;line-height:1">🗑️</button>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:0.72rem;background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.3);color:var(--gold);border-radius:20px;padding:1px 8px">🏆 ${esc(hof.champion_name||'?')}</span>
        ${hof.runner_up_name?`<span style="font-size:0.68rem;color:var(--muted)">🥈 ${esc(hof.runner_up_name)}</span>`:''}
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
  const pName = id => esc(db.players.find(x=>x.id===id)?.name||`#${id}`);

  const listEl = document.getElementById('tourHofList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
      <button onclick="_hofRenderList()" style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:20px;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);font-size:0.74rem;cursor:pointer">← กลับ</button>
      ${isAdminUser() ? `<button onclick="confirmDeleteHofTournament(${r.id},'${(r.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:20px;border:1px solid rgba(255,60,60,0.4);background:rgba(255,60,60,0.1);color:#ff6060;font-size:0.74rem;font-weight:600;cursor:pointer">🗑️ ลบ</button>` : ''}
    </div>
    <div style="border:1px solid rgba(255,215,0,0.22);border-radius:16px;background:rgba(255,215,0,0.04);padding:14px;margin-bottom:12px;text-align:center">
      <div style="font-size:1.6rem;margin-bottom:4px">${tierIcon}</div>
      <div style="font-weight:700;font-size:1rem;margin-bottom:6px">${esc(r.name)}</div>
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
        <div style="font-weight:700;font-size:0.82rem;color:var(--gold)">${esc(hof.champion_name||'?')}</div>
      </div>
      <div style="border:1px solid rgba(192,192,192,0.2);border-radius:12px;background:rgba(192,192,192,0.05);padding:10px;text-align:center">
        <div style="font-size:1.3rem">🥈</div>
        <div style="font-size:0.65rem;color:var(--muted);margin-bottom:2px">รองแชมป์</div>
        <div style="font-weight:700;font-size:0.82rem;color:var(--silver)">${esc(hof.runner_up_name||'?')}</div>
      </div>
      ${hof.third_place_name ? `<div style="border:1px solid rgba(205,127,50,0.2);border-radius:12px;background:rgba(205,127,50,0.05);padding:10px;text-align:center">
        <div style="font-size:1.3rem">🥉</div>
        <div style="font-size:0.65rem;color:var(--muted);margin-bottom:2px">อันดับ 3</div>
        <div style="font-weight:700;font-size:0.82rem;color:#cd7f32">${esc(hof.third_place_name)}</div>
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
      const det = _getGameDetail(tournamentId, m.group_letter, m.player_a, m.player_b);
      let gamesHtml = '';
      if (det && det.games && det.games.length) {
        const games = (det.idA === m.player_a) ? det.games : det.games.map(g=>({a:g.b,b:g.a}));
        gamesHtml = `<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;margin-top:4px">
          ${games.map((g,i)=>`<span style="font-size:0.62rem;padding:1px 7px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);color:var(--muted)">เกม ${i+1}: ${g.a}-${g.b}</span>`).join('')}
        </div>`;
      }
      return `<div style="padding:7px 10px;border-radius:10px;background:var(--card);margin-bottom:5px">
        <div style="display:flex;align-items:center;gap:6px;font-size:0.77rem">
          <span style="flex:1;text-align:right;font-weight:${wA?700:400};color:${wA?'var(--neon)':'var(--text)'}">${pName(m.player_a)}</span>
          <span style="font-family:'Rajdhani',sans-serif;font-weight:700;color:var(--muted);min-width:44px;text-align:center">${m.score_a??'-'} - ${m.score_b??'-'}</span>
          <span style="flex:1;text-align:left;font-weight:${!wA?700:400};color:${!wA?'var(--neon)':'var(--text)'}">${pName(m.player_b)}</span>
        </div>
        ${gamesHtml}
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

// ── Delete a completed tournament from Hall of Fame (admin) ──
function confirmDeleteHofTournament(tournamentId, name) {
  document.getElementById('hofDelModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'hofDelModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:16px';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid rgba(255,60,60,.4);border-radius:18px;padding:20px 18px;max-width:340px;width:100%;text-align:center">
      <div style="font-size:1.8rem;margin-bottom:6px">🗑️</div>
      <div style="font-size:0.95rem;font-weight:700;margin-bottom:6px">ลบประวัติทัวร์นาเมนต์?</div>
      <div style="font-size:0.8rem;color:var(--muted);margin-bottom:16px">"${name}" จะถูกลบออกจากทำเนียบแชมป์ถาวร พร้อมผลแมตช์ทั้งหมด — ย้อนกลับไม่ได้</div>
      <div style="display:flex;gap:8px">
        <button class="btn" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--glass-border);font-size:0.8rem" onclick="document.getElementById('hofDelModal').remove()">ยกเลิก</button>
        <button class="btn" style="flex:1;font-size:0.8rem;background:rgba(255,60,60,.16);border:1px solid rgba(255,60,60,.5);color:#ff6060;font-weight:700" onclick="executeDeleteHofTournament(${tournamentId})">ลบถาวร</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function executeDeleteHofTournament(tournamentId) {
  document.getElementById('hofDelModal')?.remove();
  try {
    toast('กำลังลบ...', 'info');

    // ── Rollback achievements & S1000 titles for champion players ──
    const delRow = _hofAllRows.find(r => r.id === tournamentId);
    let delHof = {};
    if (delRow) {
      try {
        const g = typeof delRow.groups === 'string' ? JSON.parse(delRow.groups) : (delRow.groups || []);
        delHof = g.find(x => x._hof) || {};
      } catch(e) {}
    }

    let champIds = Array.isArray(delHof.champion_ids) ? [...delHof.champion_ids] : [];

    // Fallback: if champion_ids not stored (older tournament), resolve from champion_name
    if (champIds.length === 0 && delHof.champion_name) {
      const names = delHof.champion_name.split(' & ').map(s => s.trim()).filter(Boolean);
      for (const pl of db.players) {
        if (names.includes(pl.name)) champIds.push(pl.id);
      }
    }

    if (champIds.length > 0) {
      // Count remaining wins per player from HOF rows that are NOT being deleted
      const remainingRows = _hofAllRows.filter(r => r.id !== tournamentId);
      const winCounts = {};
      for (const pid of champIds) winCounts[pid] = { regular: 0, s500: 0, s1000: 0, doubles: 0, gf: 0 };

      for (const row of remainingRows) {
        let rHof = {};
        try {
          const g = typeof row.groups === 'string' ? JSON.parse(row.groups) : (row.groups || []);
          rHof = g.find(x => x._hof) || {};
        } catch(e) {}
        const rChampIds = Array.isArray(rHof.champion_ids) ? rHof.champion_ids : [];
        const rTier = rHof.tier || row.tier || '';
        const rMatchType = rHof.match_type || '1v1';
        for (const pid of champIds) {
          if (!rChampIds.includes(pid)) continue;
          if (rTier === 'Super 1000') winCounts[pid].s1000++;
          else if (rTier === 'Super 500') winCounts[pid].s500++;
          else winCounts[pid].regular++;
          if (rMatchType === '2v2') winCounts[pid].doubles++;
        }
      }

      // Update each champion's customAch and super1000Titles
      for (const pid of champIds) {
        const pl = db.players.find(x => x.id === pid);
        if (!pl) continue;
        const counts = winCounts[pid];

        // Determine which sys_tour achievements should be kept
        const keepMap = {
          'sys_tour_s1000':   counts.s1000   > 0,
          'sys_tour_s500':    counts.s500    > 0,
          'sys_tour_regular': counts.regular > 0,
          'sys_tour_doubles': counts.doubles > 0,
        };

        let cur = [...(pl.customAch || [])];
        const filtered = cur.filter(a => !(a.id in keepMap) || keepMap[a.id]);
        const achChanged = filtered.length !== cur.length;
        if (achChanged) pl.customAch = filtered;

        const newS1000 = counts.s1000;
        pl.super1000Titles = newS1000;

        // Always save to DB to ensure both badge and counter are cleared
        try {
          const ptStr = buildPlayerPrimeTitles(pl, { awards: pl.customAch, s1000: newS1000 });
          await dbUpdatePlayer(pid, { prime_titles: ptStr });
        } catch(e) { console.warn('[HOFDel] player rollback failed:', e.message); }
      }
    }

    await dbDeleteTournament(tournamentId);
    _hofAllRows = _hofAllRows.filter(r => r.id !== tournamentId);
    toast('ลบประวัติแล้ว ✅', 'success');
    _hofRenderList();
  } catch(e) { toast('ลบไม่ได้: ' + e.message, 'error'); }
}

async function renderTournamentSection() {
  const container = document.getElementById('tournamentAdminSection');
  if (!container) return;

  // Player dropdown options shared across 2v2 selects
  const pOpts = db.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

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
      <option value="custom">⚙️ Custom</option>
    </select>
    <select class="inp" id="tournamentMatchType" style="margin-bottom:10px" onchange="_updateTournamentCreateForm()">
      <option value="1v1">🏸 1v1 — Singles</option>
      <option value="2v2">⚔️ 2v2 — Doubles</option>
    </select>

    <!-- Custom level config -->
    <div id="tournamentCustomFields" style="display:none;margin-bottom:10px">
      <input class="inp" id="tournamentCustomName" placeholder="ชื่อระดับ (เช่น Club Night)" style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:6px">
        <input class="inp" type="number" id="tournamentCustomCoins" placeholder="เหรียญรางวัลแชมป์" min="0" value="300" style="flex:1">
        <span style="font-size:0.75rem;color:var(--muted)">🪙 / แชมป์</span>
      </div>
    </div>

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
            <option value="5">5 กลุ่ม</option>
            <option value="6">6 กลุ่ม</option>
            <option value="7">7 กลุ่ม</option>
            <option value="8">8 กลุ่ม</option>
          </select>
        </div>
        <div style="flex:1;min-width:110px">
          <div id="tourPerGroupLabel" style="font-size:0.72rem;color:var(--muted);margin-bottom:4px">คนต่อกลุ่ม</div>
          <select class="inp" id="tourPlayersPerGroup" style="font-size:0.82rem" onchange="_updateRegTotal()">
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4" selected>4</option>
            <option value="5">5</option>
            <option value="6">6</option>
            <option value="8">8</option>
          </select>
        </div>
      </div>
      <div id="tourRegTotal" style="font-size:0.75rem;color:var(--neon);margin-bottom:8px">รับสมัคร: 8 คน (2 กลุ่ม × 4 คน)</div>
      <div id="tourRoundTypes" class="t-rounds-preview"></div>
    </div>

    <!-- Super 1000 admin-picks: 1v1 checkboxes -->
    <div id="tournamentPlayerSelect1v1" style="display:none">
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px">เลือกผู้เล่น 4–16 คน (จัดกลุ่มอัตโนมัติ):</div>
      <div id="tournamentPlayerSelect" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${db.players.map(p => `<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem;cursor:pointer"><input type="checkbox" value="${p.id}" id="tp_${p.id}"> ${esc(p.name)}</label>`).join('')}
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
        const safeName = t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');

        if (cfg?.registrationOpen) {
          // ── Open registration (admin view): slot table + start button ──
          const slots = cfg.slots || {};
          const is2v2Reg = cfg.matchType === '2v2';
          const filled = is2v2Reg
            ? Object.values(slots).flatMap(g=>g).filter(tm=>tm[0]&&tm[1]).length
            : Object.values(slots).flat().filter(Boolean).length;
          const totalSlots = Object.values(slots).reduce((s,g)=>s+g.length,0);
          const pct = totalSlots ? Math.round(filled/totalSlots*100) : 0;
          const unitLabel = is2v2Reg ? 'ทีม' : 'คน';
          const perLabel = is2v2Reg ? `${cfg.teamsPerGroup} ทีม/กลุ่ม` : `${cfg.playersPerGroup} คน/กลุ่ม`;
          const canStart = filled >= 2;
          _koPreviewCache[t.id] = { matches: _koBuildPreviewMatches(cfg.numGroups, [], [], matchType), groups, tier: t.tier, name: t.name };
          html += `<div class="tournament-group" style="margin-bottom:16px;position:relative">
            <button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕ ยกเลิก</button>
            <div class="tournament-group-title" style="padding-right:90px">
              ${tierBadge} ${esc(t.name)} ${renderModeBadge(matchType)}
              <span style="font-size:0.64rem;background:rgba(0,245,160,0.12);border:1px solid rgba(0,245,160,0.3);border-radius:20px;padding:1px 7px;color:var(--neon);margin-left:6px">📋 รับสมัคร</span>
            </div>
            <div style="margin:8px 0">
              <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                <span style="font-size:0.82rem;font-weight:700"><span style="color:var(--neon)">${filled}</span>/${totalSlots} ${unitLabel}</span>
                <span style="font-size:0.72rem;color:var(--muted)">${cfg.numGroups} กลุ่ม · ${perLabel}</span>
              </div>
              <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:var(--neon);border-radius:3px"></div>
              </div>
            </div>
            ${cfg.drawPreview ? _renderDrawPreview(cfg) : _renderRegSlotTable(cfg, t.id, true)}
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              ${cfg.drawPreview
                ? `<button class="btn btn-sm t-draw-confirm" style="width:auto" onclick="confirmDraw(${t.id})">✅ ยืนยันสาย (Lock)</button>
                   <button class="btn btn-sm t-draw-redraw" style="width:auto" onclick="runDraw(${t.id})">🎲 สุ่มใหม่</button>`
                : `<button class="btn btn-sm t-draw-btn" style="width:auto;${!canStart?'opacity:.5;pointer-events:none':''}" ${!canStart?'disabled':''} onclick="runDraw(${t.id})">🎲 สุ่มคู่แข่ง (${filled} ${unitLabel})</button>`}
              <button class="btn btn-sm" style="width:auto" onclick="koOpenBracketPreview(${t.id})">👁️ ดูสาย (พรีวิว)</button>
            </div>
          </div>`;
        } else {
          // ── Bracket in progress — renderTournamentBracket renders group
          // tables + the generalized knockout section (generate/view/record),
          // rewards are granted separately via the tournamentRewardsList panel
          // once the tournament auto-completes ──
          html += `<div class="tournament-group" style="margin-bottom:16px;position:relative">
            <button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕ ยกเลิก</button>
            <div class="tournament-group-title" style="padding-right:90px">
              ${tierBadge} ${esc(t.name)} ${renderModeBadge(matchType)}
              <span style="font-size:0.68rem;color:var(--muted)">[${t.tier}]</span>
            </div>
            ${await renderTournamentBracket(t, groups)}
          </div>`;
        }
      }
    }
  } catch(e) {}
  html += `<div class="divider"></div><div id="tournamentRewardsList"></div>`;
  container.innerHTML = html;
  try { koRenderRewardsPending(); } catch(e) {}
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
      return `<tr${topStyle}><td style="font-weight:600">${rankEmoji} ${esc(s.label)}</td><td style="color:var(--neon)">${s.wins}</td><td style="color:var(--red)">${s.losses}</td><td style="color:var(--gold)">${s.points}</td><td style="font-size:0.72rem;color:var(--muted)">${s.scoreFor}-${s.scoreAgainst}</td></tr>`;
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
            recordSection += `<div style="padding:6px 10px;border-radius:10px;background:rgba(0,245,160,0.04);border:1px solid var(--glass-border);margin-bottom:5px">
              <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem">
                <span style="flex:1;text-align:right;font-weight:${wA?700:400};color:${wA?'var(--neon)':'var(--text)'}">${lA}: ${dA}</span>
                <span style="font-family:'Rajdhani',sans-serif;font-weight:700;color:var(--gold);min-width:36px;text-align:center">${sa}-${sb}</span>
                <span style="flex:1;font-weight:${!wA?700:400};color:${!wA?'var(--neon)':'var(--text)'}">${lB}: ${dB}</span>
                <span style="color:var(--neon);font-size:0.6rem">✅</span>
              </div>
              ${_renderGameSummary(tournament.id, grpLetter, aA, aB)}
            </div>`;
          } else {
            recordSection += `<div style="padding:7px 10px;border-radius:10px;border:1px dashed rgba(255,255,255,0.1);margin-bottom:5px">
              <div style="font-size:0.73rem;color:var(--muted);margin-bottom:6px">
                <span style="color:var(--text)">${lA}: ${dA}</span> <span>vs</span> <span style="color:var(--text)">${lB}: ${dB}</span>
              </div>
              <button class="btn btn-primary btn-sm" style="width:100%;font-size:0.72rem;padding:5px 10px"
                onclick="openReferee(${tournament.id},'${grpLetter}',${aA},${aB},'2v2')">🎬 นับคะแนน (Referee)</button>
            </div>`;
          }
        }
      }
      recordSection += '</div>';
    } else {
      // Singles: recorded-match summaries + free-entry referee form
      const playerOpts = (grp.playerIds || []).map(id => { const p = db.players.find(x => x.id === id); return p ? `<option value="${p.id}">${esc(p.name)}</option>` : ''; }).join('');
      const grpRecs = tMatches.filter(m => m.group_letter === grpLetter);
      let recList = '';
      for (const rec of grpRecs) {
        const nameA = db.players.find(p=>p.id===rec.player_a)?.name || '?';
        const nameB = db.players.find(p=>p.id===rec.player_b)?.name || '?';
        const wA = rec.winner_id === rec.player_a;
        recList += `<div style="padding:6px 10px;border-radius:10px;background:rgba(0,245,160,0.04);border:1px solid var(--glass-border);margin-bottom:5px">
          <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem">
            <span style="flex:1;text-align:right;font-weight:${wA?700:400};color:${wA?'var(--neon)':'var(--text)'}">${nameA}</span>
            <span style="font-family:'Rajdhani',sans-serif;font-weight:700;color:var(--gold);min-width:36px;text-align:center">${rec.score_a}-${rec.score_b}</span>
            <span style="flex:1;font-weight:${!wA?700:400};color:${!wA?'var(--neon)':'var(--text)'}">${nameB}</span>
            <span style="color:var(--neon);font-size:0.6rem">✅</span>
          </div>
          ${_renderGameSummary(tournament.id, grpLetter, rec.player_a, rec.player_b)}
        </div>`;
      }
      recordSection = `<div style="margin-top:8px">
        ${recList ? `<div style="font-size:0.76rem;font-weight:600;color:var(--muted);margin-bottom:6px">📋 ผลแมตช์ที่บันทึกแล้ว</div>${recList}` : ''}
        <div style="font-size:0.78rem;color:var(--muted);margin:8px 0 4px">บันทึกแมตช์ใหม่ Group ${grpLetter}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          <select class="inp" id="tm_pa_${tournament.id}_${grpLetter}" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${playerOpts}</select>
          <span style="font-size:0.8rem">vs</span>
          <select class="inp" id="tm_pb_${tournament.id}_${grpLetter}" style="flex:1;min-width:100px;font-size:0.76rem;padding:6px 8px">${playerOpts}</select>
        </div>
        <button class="btn btn-primary btn-sm" style="width:100%;font-size:0.74rem"
          onclick="openRefereeFromSelects(${tournament.id},'${grpLetter}','${matchType}')">🎬 นับคะแนน (Referee)</button>`;
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

  // ── Knockout stage: a real generated bracket (any group count) or
  // single-group champion — replaces the old hardcoded 2/3/4-group tail ──
  const koMatches = tMatches.filter(m => m.round_index !== null && m.round_index !== undefined);
  const groupComplete = grp => {
    const size = grp.teams ? grp.teams.length : (grp.playerIds || []).length;
    if (size < 2) return false;
    const needed = size * (size - 1) / 2;
    const done = tMatches.filter(m => m.group_letter === grp.letter && m.status === 'completed' && (m.round_index === null || m.round_index === undefined)).length;
    return done >= needed;
  };

  if (realGroups.length >= 2) {
    if (koMatches.length > 0) {
      _koViewCache[tournament.id] = { matches: koMatches, groups, tier: tournament.tier, name: tournament.name };
      const champion = koMatches.find(m => m.round_name === 'F' && m.status === 'completed');
      const doneCount = koMatches.filter(m => m.status === 'completed' || m.status === 'bye').length;
      html += `<div class="t-bk-wrap"><div class="t-bk-heading">🏆 รอบน็อคเอาท์ (สาย)</div>
        <div style="text-align:center;padding:12px">
          ${champion
            ? `<div class="champ-decided-banner"><div class="champ-decided-label">🏆 Champion</div><div class="champ-decided-name">👑 ${esc(_koMatchPlayerLabel(groups, db.players, champion.winner_id))}</div></div>`
            : `<div style="font-size:0.8rem;color:var(--muted);margin-bottom:10px">การแข่งขันกำลังดำเนินอยู่ — ${doneCount}/${koMatches.length} แมตช์เสร็จแล้ว</div>`}
          <button class="btn btn-primary btn-sm" style="width:auto" onclick="koOpenBracketFullscreen(${tournament.id})">🏆 ดูสาย Bracket แบบเต็มจอ</button>
        </div>
      </div>`;
    } else {
      const allComplete = realGroups.every(groupComplete);
      const numGroups = realGroups.length;
      _koPreviewCache[tournament.id] = { matches: _koBuildPreviewMatches(numGroups, realGroups, tMatches, matchType), groups, tier: tournament.tier, name: tournament.name };
      html += `<div class="t-bk-wrap"><div class="t-bk-heading">🏆 รอบน็อคเอาท์ (สาย)</div>
        <div style="text-align:center;padding:12px">`;
      if (!readOnly) {
        if (allComplete) {
          html += `<div style="font-size:0.8rem;color:var(--muted);margin-bottom:10px">ทุกกลุ่มแข่งครบแล้ว พร้อมจับสาย Knockout</div>
          <button class="btn btn-primary btn-sm" style="width:auto;margin-bottom:8px" onclick="koGenerateKnockout(${tournament.id})">🎲 สร้างสาย Knockout</button><br>`;
        } else {
          html += `<div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px">รอทุกกลุ่มแข่งขันให้ครบก่อนถึงจะจับสาย Knockout ได้</div>`;
        }
      }
      html += `<button class="btn btn-sm" style="width:auto" onclick="koOpenBracketPreview(${tournament.id})">👁️ ดูสาย (พรีวิว)</button>
        </div>
      </div>`;
    }
  } else if (realGroups.length === 1) {
    const grp = realGroups[0];
    const hof = groups.find(g => g._hof);
    if (hof) {
      html += `<div class="champ-decided-banner"><div class="champ-decided-label">🏆 Champion decided by Group Ranking</div><div class="champ-decided-name">👑 ${esc(hof.champion_name)}</div></div>`;
    } else {
      const st = calculateGroupStandings(grp, tMatches, matchType);
      if (st[0] && st[0].wins > 0) {
        html += `<div class="champ-decided-banner"><div class="champ-decided-label">🏆 Champion decided by Group Ranking</div><div class="champ-decided-name">👑 ${st[0].label}</div><div style="font-size:0.72rem;color:var(--muted);margin-top:3px">${st[0].wins}W · ${st[0].losses}L · ${st[0].points} pts</div></div>`;
        if (!readOnly && isAdminUser() && groupComplete(grp)) {
          html += `<div style="text-align:center;margin-top:8px"><button class="btn btn-primary btn-sm" style="width:auto" onclick="koCompleteSingleGroup(${tournament.id}, ${st[0].id})">👑 ยืนยันแชมป์</button></div>`;
        }
      }
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

  // Custom level: admin-defined label + champion coin reward (open-registration like Regular)
  const isCustom = tier === 'custom';
  const customName  = (document.getElementById('tournamentCustomName')?.value || '').trim();
  const customCoins = parseInt(document.getElementById('tournamentCustomCoins')?.value) || 100;
  const effectiveTier = isCustom ? (customName || 'Custom') : tier;

  let groups = [];

  if (tier === 'Regular' || tier === 'Super 500' || isCustom) {
    // ── Regular/Super 500: slot-based open registration ──
    const numGroups = parseInt(document.getElementById('tourNumGroups')?.value) || 2;
    const perGroup = parseInt(document.getElementById('tourPlayersPerGroup')?.value) || 4;
    const letters = Array.from({length: numGroups}, (_, i) => String.fromCharCode(65+i));
    if (matchType === '2v2') {
      const slots = {};
      letters.forEach(l => { slots[l] = Array.from({length: perGroup}, () => [null, null]); });
      groups = [
        { _meta: true, matchType: '2v2' },
        { _config: true, matchType: '2v2', numGroups, teamsPerGroup: perGroup, registrationOpen: true, slots }
      ];
    } else {
      const slots = {};
      letters.forEach(l => { slots[l] = Array(perGroup).fill(null); });
      groups = [
        { _meta: true, matchType: '1v1' },
        { _config: true, numGroups, playersPerGroup: perGroup, registrationOpen: true, slots }
      ];
    }

  } else if (matchType === '2v2') {
    // ── Super 1000 2v2: admin builds teams ──
    const teams = _get2v2Teams();
    if (teams.length < 2) return toast('ต้องมีอย่างน้อย 2 ทีม', 'error');
    const allIds = teams.flatMap(t => t.playerIds);
    if (allIds.some(isNaN)) return toast('กรุณาเลือกผู้เล่นในทุกทีมให้ครบ', 'error');
    if (new Set(allIds).size !== allIds.length) return toast('ผู้เล่นต้องไม่ซ้ำกันในทุกทีม', 'error');
    groups = [
      { _meta: true, matchType: '2v2' },
      { letter: 'A', matchType: '2v2', teams }
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
    const created = await dbTournamentCreate(name, effectiveTier, matchType, groups);
    // Custom tier has no row in tournament_reward_tiers — persist the chosen champion
    // coin amount into reward_overrides so rpc_tournament_grant_rewards picks it up
    // (runner-up/third/participant pct fall back to the RPC's hardcoded defaults).
    if (isCustom && created?.id) {
      try {
        await supaFetch(`tournaments?id=eq.${created.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ reward_overrides: JSON.stringify({ champion_coins: customCoins }) }),
          prefer: 'return=minimal'
        });
      } catch(e) {}
    }
    toast('สร้าง Tournament แล้ว! 🏆', 'success');
    renderTournamentSection();
  } catch(e) { toast('สร้างไม่ได้: ' + _tourRegErrText(e), 'error'); }
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

// ── Slot-based registration ────────────────────────────────────────────────────

async function claimTournamentSlot(tournamentId, group, slotIdx, subIdx) {
  if (!currentUser) return toast('กรุณาเข้าสู่ระบบก่อน', 'error');
  try {
    const t = await dbGetTournamentById(tournamentId);
    let gs = [];
    try { gs = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
    const cfg = getTournamentConfig(gs);
    if (!cfg?.registrationOpen) return toast('ปิดรับสมัครแล้ว', 'error');
    const slots = cfg.slots || {};
    const is2v2 = cfg.matchType === '2v2';

    // Find if current user already has a slot
    let mySlot = null;
    outer: for (const [g, gSlots] of Object.entries(slots)) {
      if (is2v2) {
        for (let i = 0; i < gSlots.length; i++) {
          for (let s = 0; s < 2; s++) {
            if (gSlots[i][s] === currentUser.id) { mySlot = { g, i, s }; break outer; }
          }
        }
      } else {
        const idx = gSlots.indexOf(currentUser.id);
        if (idx !== -1) { mySlot = { g, idx }; break; }
      }
    }

    const targetVal = is2v2 ? slots[group]?.[slotIdx]?.[subIdx] : slots[group]?.[slotIdx];

    if (targetVal === currentUser.id) {
      // Click own slot → unregister (server finds + clears it, atomically)
      await dbTournamentUnregister(tournamentId);
      toast('ถอนสมัครแล้ว', 'success');
    } else if (targetVal !== null && targetVal !== undefined) {
      return toast('ช่องนี้มีคนสมัครแล้ว', 'error');
    } else if (mySlot) {
      return toast('คุณสมัครไปแล้ว กดที่ช่องของตัวเองเพื่อถอนสมัคร', 'error');
    } else {
      await dbTournamentRegister(tournamentId, group, slotIdx, is2v2 ? subIdx : null, null);
      toast('สมัครแล้ว ✅', 'success');
    }
    renderTournamentTab();
    if (document.getElementById('tournamentAdminSection')) renderTournamentSection();
  } catch(e) { toast('ไม่สำเร็จ: ' + _tourRegErrText(e), 'error'); }
}

function _renderRegSlotTable(cfg, tournamentId, isAdmin) {
  const slots = cfg.slots || {};
  const is2v2 = cfg.matchType === '2v2';
  const pName = id => esc(db.players.find(p => p.id === id)?.name || `#${id}`);
  const groups = Object.keys(slots).sort();

  // Find current user's slot
  let mySlot = null;
  if (currentUser) {
    outer: for (const [g, gSlots] of Object.entries(slots)) {
      if (is2v2) {
        for (let i = 0; i < gSlots.length; i++) {
          for (let s = 0; s < 2; s++) {
            if (gSlots[i][s] === currentUser.id) { mySlot = true; break outer; }
          }
        }
      } else {
        if (gSlots.includes(currentUser.id)) { mySlot = true; break; }
      }
    }
  }

  // Partner System: if the player has an official partner and hasn't
  // registered yet, suggest the specific empty team-slot where their
  // partner already claimed a seat — a UI hint only, never auto-registers
  // (the player still must click the empty seat themselves via the normal
  // claimTournamentSlot flow).
  let suggestSlot = null, suggestPartnerName = null;
  if (is2v2 && currentUser && !mySlot && typeof getOfficialPartner === 'function') {
    const partner = getOfficialPartner(currentUser.id);
    if (partner) {
      outer2: for (const [g, gSlots] of Object.entries(slots)) {
        for (let i = 0; i < gSlots.length; i++) {
          const team = gSlots[i];
          const partnerIdx = team.indexOf(partner.id);
          if (partnerIdx !== -1) {
            const otherIdx = partnerIdx === 0 ? 1 : 0;
            if (team[otherIdx] === null || team[otherIdx] === undefined) {
              suggestSlot = { g, i, s: otherIdx };
              suggestPartnerName = partner.name;
              break outer2;
            }
          }
        }
      }
    }
  }

  const cols = Math.min(groups.length, 4);
  let html = '';
  if (suggestSlot) {
    html += `<div style="background:rgba(0,245,160,0.08);border:1px solid rgba(0,245,160,0.3);border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:0.76rem;color:var(--neon)">
      💡 แนะนำ: <b>${esc(suggestPartnerName)}</b> คู่ทางการของคุณอยู่ทีม ${suggestSlot.i + 1} สาย ${suggestSlot.g} — กดช่องที่ว่างเพื่อจับคู่
    </div>`;
  }
  html += `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;margin-bottom:12px">`;

  for (const grp of groups) {
    const gSlots = slots[grp] || [];
    html += `<div>
      <div style="font-size:0.72rem;font-weight:700;color:var(--neon2);text-align:center;padding:4px;margin-bottom:5px;background:rgba(100,220,255,0.07);border-radius:6px;letter-spacing:.06em">สาย ${grp}</div>`;

    if (is2v2) {
      gSlots.forEach((team, tIdx) => {
        const p0 = team[0], p1 = team[1];
        html += `<div style="border:1px solid var(--glass-border);border-radius:8px;padding:5px 6px;margin-bottom:5px">
          <div style="font-size:0.6rem;color:var(--muted);margin-bottom:3px">ทีม ${tIdx+1}</div>`;
        [0, 1].forEach(sIdx => {
          const pid = team[sIdx];
          const isMe = currentUser && pid === currentUser.id;
          const isEmpty = pid === null || pid === undefined;
          const canClaim = currentUser && isEmpty && !mySlot;
          const isSuggested = suggestSlot && suggestSlot.g === grp && suggestSlot.i === tIdx && suggestSlot.s === sIdx;
          html += `<div onclick="claimTournamentSlot(${tournamentId},'${grp}',${tIdx},${sIdx})"
            style="padding:5px 8px;border-radius:6px;margin-bottom:2px;font-size:0.74rem;
            cursor:${canClaim||isMe?'pointer':'default'};
            background:${isMe?'rgba(0,245,160,0.12)':isEmpty?'rgba(255,255,255,0.03)':'rgba(255,255,255,0.06)'};
            border:1px solid ${isMe?'rgba(0,245,160,0.5)':isSuggested?'var(--neon)':isEmpty?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.12)'};
            ${isSuggested ? 'box-shadow:0 0 0 1px var(--neon) inset;' : ''}
            color:${isMe?'var(--neon)':isEmpty?'var(--muted)':'var(--text)'}">
            ${isMe ? `✓ ${pName(pid)}` : isEmpty ? (canClaim ? `<span style="color:var(--neon)">${isSuggested ? '💡 ' : '+ '}สมัคร</span>` : 'ว่าง') : pName(pid)}
          </div>`;
        });
        html += `</div>`;
      });
    } else {
      gSlots.forEach((pid, idx) => {
        const isMe = currentUser && pid === currentUser.id;
        const isEmpty = pid === null || pid === undefined;
        const canClaim = currentUser && isEmpty && !mySlot;
        html += `<div onclick="claimTournamentSlot(${tournamentId},'${grp}',${idx},-1)"
          style="padding:6px 10px;border-radius:8px;margin-bottom:4px;font-size:0.78rem;
          cursor:${canClaim||isMe?'pointer':'default'};
          background:${isMe?'rgba(0,245,160,0.12)':isEmpty?'rgba(255,255,255,0.03)':'rgba(255,255,255,0.06)'};
          border:1px solid ${isMe?'rgba(0,245,160,0.5)':isEmpty?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.12)'};
          color:${isMe?'var(--neon)':isEmpty?'var(--muted)':'var(--text)'}">
          ${isMe ? `✓ ${pName(pid)}` : isEmpty ? (canClaim ? '<span style="color:var(--neon)">+ สมัคร</span>' : 'ว่าง') : pName(pid)}
        </div>`;
      });
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

// ════════════════════════════════════════════════════════════
// [NEW] BWF-STYLE RANDOM DRAW + READ-ONLY BRACKET MODAL
// Source of truth = Supabase config (so preview is synced to all
// users); localStorage holds an admin-side draft copy only.
// ════════════════════════════════════════════════════════════

// Fisher-Yates shuffle (returns a new array)
function _shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a random group assignment from a registration config's filled slots.
// 1v1 → { A:[pid,...], B:[...] }   ·   2v2 → { A:[[p,p],...], ... }
function _drawAssign(cfg) {
  const is2v2 = cfg.matchType === '2v2';
  const letters = Object.keys(cfg.slots || {}).sort();
  const preview = {};
  letters.forEach(l => { preview[l] = []; });
  if (!letters.length) return preview;
  if (is2v2) {
    const teams = [];
    Object.values(cfg.slots).forEach(g => g.forEach(tm => { if (tm[0] && tm[1]) teams.push([tm[0], tm[1]]); }));
    _shuffle(teams).forEach((tm, i) => preview[letters[i % letters.length]].push(tm));
  } else {
    const players = [];
    Object.values(cfg.slots).forEach(g => g.forEach(pid => { if (pid != null) players.push(pid); }));
    _shuffle(players).forEach((pid, i) => preview[letters[i % letters.length]].push(pid));
  }
  return preview;
}

// Admin: run / re-run the random draw → store preview on Supabase + localStorage draft
async function runDraw(tournamentId) {
  if (!isAdminUser()) return;
  try {
    const t = await dbGetTournamentById(tournamentId);
    let gs = []; try { gs = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
    const cfg = getTournamentConfig(gs);
    if (!cfg) return toast('ไม่พบการตั้งค่า', 'error');
    const preview = _drawAssign(cfg);
    const total = Object.values(preview).reduce((s, g) => s + g.length, 0);
    if (total < 2) return toast('ต้องมีอย่างน้อย 2 ฝ่าย', 'error');
    cfg.drawPreview = preview;
    cfg.drawLocked = false;
    await _patchTournamentConfig(tournamentId, cfg);
    try { localStorage.setItem(`tournament_draw_${tournamentId}`, JSON.stringify(preview)); } catch(e) {}
    delete _tourStore[tournamentId];
    toast('🎲 สุ่มสายแล้ว — ตรวจดูก่อนกดยืนยัน', 'success');
    renderTournamentTab();
    if (document.getElementById('tournamentAdminSection')) renderTournamentSection();
  } catch(e) { toast('สุ่มไม่ได้: ' + e.message, 'error'); }
}

// Admin: confirm the previewed draw → lock bracket (commit groups, close registration)
async function confirmDraw(tournamentId) {
  if (!isAdminUser()) return;
  try {
    const t = await dbGetTournamentById(tournamentId);
    let gs = []; try { gs = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
    const cfg = getTournamentConfig(gs);
    if (!cfg?.drawPreview) return toast('ยังไม่ได้สุ่มสาย', 'error');
    const is2v2 = cfg.matchType === '2v2';
    const groupEntries = Object.entries(cfg.drawPreview).sort().map(([letter, members]) =>
      is2v2
        ? { letter, matchType: '2v2', teams: members.map(tm => ({ playerIds: tm })) }
        : { letter, playerIds: members }
    );
    const finalCfg = { ...cfg, registrationOpen: false, drawLocked: true };
    delete finalCfg.drawPreview;
    const newGs = [ ...gs.filter(g => g._meta), finalCfg, ...groupEntries ];
    await supaFetch(`tournaments?id=eq.${tournamentId}`, {
      method: 'PATCH', body: JSON.stringify({ groups: JSON.stringify(newGs) }), prefer: 'return=minimal'
    });
    try { localStorage.removeItem(`tournament_draw_${tournamentId}`); } catch(e) {}
    delete _tourStore[tournamentId];
    toast('🔒 ยืนยันสายแล้ว เริ่มการแข่งขัน! 🏆', 'success');
    renderTournamentTab();
    if (document.getElementById('tournamentAdminSection')) renderTournamentSection();
  } catch(e) { toast('ยืนยันไม่ได้: ' + e.message, 'error'); }
}

// Read-only matchup preview shown to ALL users before the bracket is locked
function _renderDrawPreview(cfg) {
  const preview = cfg.drawPreview;
  if (!preview) return '';
  const is2v2 = cfg.matchType === '2v2';
  const pName = id => esc(db.players.find(p => p.id === id)?.name || `#${id}`);
  const letters = Object.keys(preview).sort();
  const cols = Math.min(letters.length, 4);
  let body = `<div class="t-draw-grid" style="grid-template-columns:repeat(${cols},1fr)">`;
  for (const l of letters) {
    body += `<div class="t-draw-col"><div class="t-draw-col-h">สาย ${l}</div>`;
    (preview[l] || []).forEach((m, i) => {
      const label = is2v2 ? (Array.isArray(m) ? m.map(pName).join(' + ') : pName(m)) : pName(m);
      body += `<div class="t-draw-cell">${i + 1}. ${label}</div>`;
    });
    body += `</div>`;
  }
  body += `</div>`;
  return `<div class="t-draw-wrap">
    <div class="t-draw-heading">🎲 ผลการสุ่มสาย (รอ Admin ยืนยัน)</div>
    ${body}
  </div>`;
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
    // ทุก tier โชว์ให้ทุกคนเห็น — Super 1000 admin จัดเอง (คนทั่วไปดูได้แต่สมัครไม่ได้)
    const visible = tournaments.filter(t => t.status !== 'completed');

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
        const safeName = t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const header = `<div class="tournament-group-title">${tierBadge} ${esc(t.name)} ${renderModeBadge(matchType)}<span style="font-size:0.68rem;color:var(--muted);margin-left:4px">[${t.tier}]</span></div>`;

        html += `<div class="tournament-group" style="margin-bottom:16px;position:relative;border-color:${tierColor}">`;

        if (cfg?.registrationOpen) {
          // ── REGISTRATION PHASE ──────────────────────────────────────────────
          const slots = cfg.slots || {};
          const is2v2Reg = cfg.matchType === '2v2';
          const totalSlots = Object.values(slots).reduce((s,g)=>s+g.length,0);
          const filled = is2v2Reg
            ? Object.values(slots).flatMap(g=>g).filter(tm=>tm[0]&&tm[1]).length
            : Object.values(slots).flat().filter(Boolean).length;
          const pct = totalSlots ? Math.round(filled / totalSlots * 100) : 0;
          const unitLabel = is2v2Reg ? 'ทีม' : 'คน';
          const perLabel = is2v2Reg ? `${cfg.teamsPerGroup} ทีม/กลุ่ม` : `${cfg.playersPerGroup} คน/กลุ่ม`;
          if (isAdmin) {
            html += `<button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕</button>`;
          }
          html += header;
          html += `<div style="margin:10px 0 8px">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px">
              <span style="font-size:0.82rem;font-weight:700">📋 รับสมัคร <span style="color:var(--neon)">${filled}</span>/${totalSlots} ${unitLabel}</span>
              <span style="font-size:0.72rem;color:var(--muted)">${cfg.numGroups} กลุ่ม · ${perLabel}</span>
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:var(--neon);border-radius:3px;transition:width .3s"></div>
            </div>
          </div>`;
          if (!currentUser) {
            html += `<div style="font-size:0.76rem;color:var(--muted);margin-bottom:8px">เข้าสู่ระบบเพื่อสมัครแข่ง</div>`;
          }
          html += cfg.drawPreview ? _renderDrawPreview(cfg) : _renderRegSlotTable(cfg, t.id, isAdmin);
          _koPreviewCache[t.id] = { matches: _koBuildPreviewMatches(cfg.numGroups, [], [], matchType), groups, tier: t.tier, name: t.name };
          html += `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">`;
          if (isAdmin) {
            const canStart = filled >= 2;
            html += cfg.drawPreview
              ? `<button class="btn btn-sm t-draw-confirm" style="width:auto" onclick="confirmDraw(${t.id})">✅ ยืนยันสาย (Lock)</button>
                 <button class="btn btn-sm t-draw-redraw" style="width:auto" onclick="runDraw(${t.id})">🎲 สุ่มใหม่</button>`
              : `<button class="btn btn-sm t-draw-btn" style="width:auto${!canStart?';opacity:.45;pointer-events:none':''}" ${!canStart?'disabled':''} onclick="runDraw(${t.id})">🎲 สุ่มคู่แข่ง (${filled} ${unitLabel})</button>`;
          }
          html += `<button class="btn btn-sm" style="width:auto" onclick="koOpenBracketPreview(${t.id})">👁️ ดูสาย (พรีวิว)</button>
          </div>`;

        } else {
          // ── BRACKET PHASE — renderTournamentBracket renders group tables +
          // the generalized knockout section (generate/view/record); rewards
          // are granted via the tournamentRewardsList panel once auto-completed ──
          if (isAdmin) {
            html += `<button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕</button>`;
            html += `<div class="tournament-group-title" style="padding-right:60px">${tierBadge} ${esc(t.name)} ${renderModeBadge(matchType)}<span style="font-size:0.68rem;color:var(--muted);margin-left:4px">[${t.tier}]</span></div>`;
            html += await renderTournamentBracket(t, groups, false);
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

