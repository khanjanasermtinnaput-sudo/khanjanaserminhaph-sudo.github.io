// ── Knockout-stage engine for the (single) round-robin tournament format ────
// Generalizes what used to be a hardcoded 2/3/4-group Grand-Final-only
// knockout (_buildKnockoutSection in tournament.js) into a real generated
// bracket tree of any size, reusing the bye-safe seeding algorithm and
// atomic auto-advancing result RPC originally built for a (now retired)
// separate "Single Elimination" tournament format — entrants here are each
// group's WINNER (from calculateGroupStandings, computed in tournament.js),
// not a flat registered-player list. Also owns the full-screen BWF-style
// spectator bracket viewer and the reward-granting UI. Reuses tournament.js's
// own helpers (getTeamByAnchor/getTeamDisplayName/calculateGroupStandings/
// getTournamentGroups/getTournamentMatchType/dbGetTournamentMatches/
// dbGetTournamentById/isAdminUser/currentUser/esc/toast/economyErrCode via
// _tourRegErrText) rather than duplicating them.

async function dbTournamentGenerateKnockout(tournamentId, entrants) {
  return supaFetch('rpc/rpc_tournament_generate_knockout', {
    method: 'POST',
    body: JSON.stringify({ p_tournament_id: tournamentId, p_entrants: entrants })
  });
}
async function dbTournamentSubmitKnockoutResult(tournamentId, matchId, games, winnerSide, idempotencyKey) {
  return supaFetch('rpc/rpc_tournament_submit_knockout_result', {
    method: 'POST',
    body: JSON.stringify({
      p_tournament_id: tournamentId, p_match_id: matchId, p_games: games,
      p_winner_side: winnerSide ?? null, p_idempotency_key: idempotencyKey ?? null
    })
  });
}
async function dbTournamentCompleteSingleGroup(tournamentId, winnerId) {
  return supaFetch('rpc/rpc_tournament_complete_single_group', {
    method: 'POST',
    body: JSON.stringify({ p_tournament_id: tournamentId, p_winner_id: winnerId })
  });
}
async function dbTournamentCorrectKnockoutResult(tournamentId, matchId, games, winnerSide, reason) {
  return supaFetch('rpc/rpc_tournament_correct_knockout_result', {
    method: 'POST',
    body: JSON.stringify({
      p_tournament_id: tournamentId, p_match_id: matchId, p_games: games,
      p_winner_side: winnerSide ?? null, p_reason: reason
    })
  });
}
async function dbTournamentGrantRewards(tournamentId) {
  return supaFetch('rpc/rpc_tournament_grant_rewards', {
    method: 'POST',
    body: JSON.stringify({ p_tournament_id: tournamentId })
  });
}

// ── Live referee (21-pt/best-of-3 point counter). Winner is always
// recomputed server-side by rpc_tournament_submit_knockout_result; this UI
// only decides WHEN a match looks finished client-side for UX. Fully
// separate global state from tournament.js's own group-stage _ref* Referee
// (which still posts to rpc_tournament_submit_group_result, untouched). ──
let _koRefState = null;

function _koRefGameOver(a, b) {
  return AdminV2.scoring.isGameOver(a, b);
}
function koOpenReferee(tournamentId, matchId, idA, idB, labelA, labelB, winsNeeded) {
  if (!idA || !idB || idA === idB) return toast('แมตช์นี้ยังไม่มีผู้เล่นครบ', 'error');
  _koRefState = { tournamentId, matchId, idA, idB, labelA, labelB, winsNeeded, games: [], curA: 0, curB: 0 };
  _renderKoRefModal();
}
function _koRefPoint(side, delta) {
  if (!_koRefState) return;
  if (side === 'a') _koRefState.curA = Math.max(0, _koRefState.curA + delta);
  else _koRefState.curB = Math.max(0, _koRefState.curB + delta);
  _renderKoRefModal();
}
function _koRefCommitGame() {
  if (!_koRefState) return;
  if (!_koRefGameOver(_koRefState.curA, _koRefState.curB)) return;
  _koRefState.games.push({ a: _koRefState.curA, b: _koRefState.curB });
  _koRefState.curA = 0; _koRefState.curB = 0;
  _renderKoRefModal();
}
function _koRefGamesWon() {
  let wA = 0, wB = 0;
  for (const g of _koRefState.games) { if (g.a > g.b) wA++; else if (g.b > g.a) wB++; }
  return { wA, wB };
}
function _koRefClose() { _koRefState = null; document.getElementById('koRefModal')?.remove(); }
async function _koRefFinish() {
  if (!_koRefState) return;
  const need = _koRefState.winsNeeded || 1;
  const { wA, wB } = _koRefGamesWon();
  if (wA < need && wB < need) return toast(`ยังไม่จบแมตช์ (ต้องชนะ ${need} เกม)`, 'error');
  const winnerSide = wA > wB ? 'a' : 'b';
  const { tournamentId, matchId, games } = _koRefState;
  try {
    await dbTournamentSubmitKnockoutResult(tournamentId, matchId, games, winnerSide, `ko-${matchId}-${Date.now()}`);
    // Knockout matches can be 1v1 or 2v2; matchType isn't in _koRefState, and
    // a recalc is a cheap, idempotent full rebuild at club-app scale, so it's
    // simplest to always fire it here rather than thread matchType through.
    if (typeof dbRecalcPartnerSystem === 'function') { try { await dbRecalcPartnerSystem(matchId); } catch(e) {} }
    _koRefClose();
    toast('บันทึกผลแล้ว ✅', 'success');
    const wasFullscreen = !!document.getElementById('brmxOverlay');
    renderTournamentSection();
    if (document.getElementById('tournamentTabContent')) renderTournamentTab();
    if (wasFullscreen) koOpenBracketFullscreen(tournamentId);
  } catch (e) { toast('บันทึกไม่ได้: ' + _tourRegErrText(e), 'error'); }
}
function _koRefRenderSide(side, btnDisabled) {
  const r = _koRefState;
  const cur = side === 'a' ? r.curA : r.curB;
  const label = side === 'a' ? r.labelA : r.labelB;
  const won = _koRefGamesWon();
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
      <button onclick="_koRefPoint('${side}',-1)" ${dis} style="width:42px;height:42px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);font-size:1.2rem;cursor:${cur2};opacity:${op}">−</button>
      <button onclick="_koRefPoint('${side}',1)" ${dis} style="width:56px;height:56px;border-radius:50%;border:1px solid ${color};background:${color}22;color:${color};font-size:1.6rem;font-weight:700;cursor:${cur2};opacity:${op}">+</button>
    </div>
  </div>`;
}
function _renderKoRefModal() {
  document.getElementById('koRefModal')?.remove();
  const r = _koRefState;
  if (!r) return;
  const need = r.winsNeeded || 1;
  const gameNo = r.games.length + 1;
  const over = _koRefGameOver(r.curA, r.curB);
  const { wA, wB } = _koRefGamesWon();
  const matchDone = wA >= need || wB >= need;
  const gameWinnerLabel = r.curA > r.curB ? r.labelA : r.labelB;
  const bestOfLabel = need === 2 ? 'Best of 3' : 'เกมเดียว';

  const gamesLog = r.games.map((g, i) =>
    `<span style="font-size:0.68rem;padding:2px 8px;border-radius:12px;background:var(--card);border:1px solid var(--glass-border);color:var(--muted)">เกม ${i + 1}: ${g.a}-${g.b}</span>`
  ).join('');

  let actionBtn = '';
  if (matchDone) {
    const champLabel = wA > wB ? r.labelA : r.labelB;
    actionBtn = `<button class="btn btn-primary" style="width:100%;background:rgba(255,215,0,.18);border:1px solid rgba(255,215,0,.5);color:#ffd700;font-weight:700" onclick="_koRefFinish()">💾 บันทึกผล · 🏆 ${champLabel} (${wA}-${wB})</button>`;
  } else if (over) {
    const winnerSideWins = (r.curA > r.curB ? wA : wB) + 1;
    const willFinish = winnerSideWins >= need;
    const nextLabel = willFinish ? '🏆 จบแมตช์' : '→ เกมต่อไป';
    actionBtn = `<button class="btn btn-primary" style="width:100%" onclick="_koRefCommitGame()">✅ จบเกม ${gameNo} (${gameWinnerLabel} ${r.curA}-${r.curB}) ${nextLabel}</button>`;
  } else {
    actionBtn = `<div style="text-align:center;font-size:0.7rem;color:var(--muted);padding:8px">กำลังแข่งเกมที่ ${gameNo} · ถึง 21 แต้ม (ห่าง 2) เกมจะจบอัตโนมัติ</div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'koRefModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:14px';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid rgba(0,245,160,.3);border-radius:20px;padding:18px 16px;max-width:420px;width:100%;box-shadow:0 0 60px rgba(0,245,160,.12)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:0.95rem;font-weight:700">🎬 Referee · เกมที่ ${gameNo} <span style="font-size:0.66rem;font-weight:500;color:var(--muted)">(${bestOfLabel})</span></div>
        <button onclick="_koRefClose()" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);cursor:pointer">✕</button>
      </div>
      ${gamesLog ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">${gamesLog}</div>` : ''}
      <div style="display:flex;align-items:stretch;border:1px solid var(--glass-border);border-radius:14px;background:rgba(255,255,255,0.02);margin-bottom:12px">
        ${_koRefRenderSide('a', over || matchDone)}
        <div style="width:1px;background:var(--glass-border)"></div>
        ${_koRefRenderSide('b', over || matchDone)}
      </div>
      ${actionBtn}
    </div>`;
  document.body.appendChild(modal);
}

// ── Match player name resolution — anchor id + members lookup, same
// convention as getTeamByAnchor already uses for round-robin group tables.
function _koMatchPlayerLabel(groups, players, playerId) {
  if (playerId == null) return null;
  const team = getTeamByAnchor(groups, playerId);
  if (team) return getTeamDisplayName(team, players);
  const p = players.find(x => x.id === playerId);
  return p ? esc(p.name) : `#${playerId}`;
}

// ── Full-screen BWF-style spectator bracket viewer ──────────────────────────
// Connectors: matches are grouped into sibling pairs (round N's match i and
// i+1 always feed round N+1's match floor(i/2), by construction of
// rpc_tournament_generate_knockout) and each pair is wrapped in a bracket
// -shaped border (.brmx-pair) with a short stub pointing at the next round —
// geometrically correct regardless of content height, no pixel math needed.
function _koChunkPairs(matches) {
  const pairs = [];
  for (let i = 0; i < matches.length; i += 2) pairs.push(matches.slice(i, i + 2));
  return pairs;
}
function _brmxMatchCardHTML(m, groups, players, tournamentId, tier, isAdmin) {
  const winsNeeded = tier === 'Super 1000' ? 2 : 1;
  const nameA = _koMatchPlayerLabel(groups, players, m.player_a) || m.placeholderA || (m.status === 'pending' ? 'รอผู้ชนะ' : '—');
  const nameB = _koMatchPlayerLabel(groups, players, m.player_b) || m.placeholderB || (m.status === 'pending' ? 'รอผู้ชนะ' : '—');
  const aWin = m.winner_id != null && m.winner_id === m.player_a;
  const bWin = m.winner_id != null && m.winner_id === m.player_b;
  const canRef = isAdmin && m.status === 'ready';
  const canCorrect = isAdmin && m.status === 'completed';
  return `<div class="brmx-match">
    <div class="brmx-row${aWin ? ' win' : ''}">${aWin ? '<span class="brmx-tick">✓</span>' : ''}<span class="brmx-name">${nameA}</span>${m.status === 'completed' ? `<span class="brmx-score">${m.score_a ?? 0}</span>` : ''}</div>
    <div class="brmx-row${bWin ? ' win' : ''}">${bWin ? '<span class="brmx-tick">✓</span>' : ''}<span class="brmx-name">${nameB}</span>${m.status === 'completed' ? `<span class="brmx-score">${m.score_b ?? 0}</span>` : ''}</div>
    ${m.is_bye ? '<div class="brmx-note">BYE — ผ่านเข้ารอบอัตโนมัติ</div>' : ''}
    ${canRef ? `<button class="brmx-refbtn" onclick="koOpenReferee(${tournamentId},${m.id},${m.player_a},${m.player_b},'${nameA.replace(/'/g, "\\'")}','${nameB.replace(/'/g, "\\'")}',${winsNeeded})">🎬 บันทึกผล</button>` : ''}
    ${canCorrect ? `<button class="brmx-refbtn" style="background:rgba(255,165,0,.1);border-color:rgba(255,165,0,.4);color:#ffb347" onclick="koOpenCorrectResult(${tournamentId},${m.id},'${nameA.replace(/'/g, "\\'")}','${nameB.replace(/'/g, "\\'")}',${winsNeeded})">✏️ แก้ไขผล</button>` : ''}
  </div>`;
}
function openBracketFullscreen(tournamentId, tournamentName, matches, groups, tier, isAdmin, isPreview = false) {
  document.getElementById('brmxOverlay')?.remove();
  const rounds = {};
  matches.forEach(m => { (rounds[m.round_index] = rounds[m.round_index] || []).push(m); });
  const roundIdxs = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const lastIdx = roundIdxs[roundIdxs.length - 1];
  const champion = matches.find(m => m.round_name === 'F' && m.status === 'completed');

  const roundsHTML = roundIdxs.map(ri => {
    const roundMatches = rounds[ri].sort((a, b) => (a.bracket_slot || '').localeCompare(b.bracket_slot || '', undefined, { numeric: true }));
    const label = roundMatches[0].round_name || `Round ${ri + 1}`;
    const pairs = _koChunkPairs(roundMatches);
    const pairsHTML = pairs.map(pair => `<div class="brmx-pair${pair.length === 2 ? ' brmx-haspartner' : ''}">${pair.map(m => _brmxMatchCardHTML(m, groups, db.players, tournamentId, tier, isAdmin)).join('')}</div>`).join('');
    return `<div class="brmx-round${ri === lastIdx && !champion ? ' brmx-lastround' : ''}" id="brmxRound${ri}">
      <div class="brmx-roundlabel">${esc(label)}</div>
      <div class="brmx-pairs">${pairsHTML}</div>
    </div>`;
  }).join('');

  const champHTML = champion ? `<div class="brmx-round brmx-champcol brmx-lastround">
    <div class="brmx-roundlabel">Champion</div>
    <div class="brmx-champ-box"><div class="brmx-champ-medal">🏆</div><div class="brmx-champ-name">${_koMatchPlayerLabel(groups, db.players, champion.winner_id)}</div></div>
  </div>` : '';

  const chipsHTML = roundIdxs.map(ri => `<button class="brmx-chip" onclick="_brmxScrollTo(${ri})">${esc(rounds[ri][0].round_name || `R${ri + 1}`)}</button>`).join('')
    + (champion ? `<button class="brmx-chip" onclick="document.getElementById('brmxBody').scrollTo({left:99999,behavior:'smooth'})">🏆</button>` : '');

  const overlay = document.createElement('div');
  overlay.id = 'brmxOverlay';
  overlay.className = 'brmx-overlay';
  overlay.innerHTML = `
    <div class="brmx-header">
      <div class="brmx-title">🏆 ${esc(tournamentName)}${isPreview ? ' <span style="font-size:0.6rem;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(255,165,0,.15);border:1px solid rgba(255,165,0,.4);color:#ffb347;margin-left:8px;vertical-align:middle">👁️ พรีวิว — ยังไม่ยืนยัน</span>' : ''}</div>
      <button class="brmx-close" aria-label="ปิด" onclick="closeBracketFullscreen()">✕</button>
    </div>
    <div class="brmx-chips">${chipsHTML}</div>
    <div class="brmx-body" id="brmxBody">
      <div class="brmx-rounds">${roundsHTML}${champHTML}</div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _brmxEscHandler);
  overlay.querySelector('.brmx-close').focus();
}
function _brmxScrollTo(ri) {
  document.getElementById('brmxRound' + ri)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
}
function _brmxEscHandler(e) { if (e.key === 'Escape') closeBracketFullscreen(); }
function closeBracketFullscreen() {
  document.getElementById('brmxOverlay')?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _brmxEscHandler);
}

// Trigger from a plain onclick="" attribute (can't pass live arrays/objects
// through an inline handler) — populated by whichever render pass last drew
// this tournament's card (renderTournamentSection/renderTournamentTab in
// tournament.js), read here instead of re-querying the DB again.
const _koViewCache = {};
function koOpenBracketFullscreen(tournamentId) {
  const cached = _koViewCache[tournamentId];
  if (!cached) return toast('ยังไม่มีข้อมูลสาย กรุณาลองใหม่', 'error');
  openBracketFullscreen(tournamentId, cached.name, cached.matches, cached.groups, cached.tier, isAdminUser());
}
// Same pattern as _koViewCache, but for the client-only preview shape
// (_koBuildPreviewMatches in tournament.js) — kept in a separate cache so a
// tournament that already has a real generated bracket never gets its cache
// clobbered by a stale preview from an earlier render pass, or vice versa.
const _koPreviewCache = {};
function koOpenBracketPreview(tournamentId) {
  const cached = _koPreviewCache[tournamentId];
  if (!cached) return toast('ยังไม่มีข้อมูลสาย กรุณาลองใหม่', 'error');
  openBracketFullscreen(tournamentId, cached.name, cached.matches, cached.groups, cached.tier, false, true);
}

// ── Correction modal: admin safety net now that champion declaration is
// fully automatic. Reuses the same point-counter UI as the Referee, just
// posts to the correction RPC with a required reason instead. ──
let _koCorrectState = null;
function koOpenCorrectResult(tournamentId, matchId, labelA, labelB, winsNeeded) {
  _koCorrectState = { tournamentId, matchId, labelA, labelB, winsNeeded, games: [], curA: 0, curB: 0 };
  _renderKoCorrectModal();
}
function _koCorrectPoint(side, delta) {
  if (!_koCorrectState) return;
  if (side === 'a') _koCorrectState.curA = Math.max(0, _koCorrectState.curA + delta);
  else _koCorrectState.curB = Math.max(0, _koCorrectState.curB + delta);
  _renderKoCorrectModal();
}
function _koCorrectCommitGame() {
  if (!_koCorrectState) return;
  if (!_koRefGameOver(_koCorrectState.curA, _koCorrectState.curB)) return;
  _koCorrectState.games.push({ a: _koCorrectState.curA, b: _koCorrectState.curB });
  _koCorrectState.curA = 0; _koCorrectState.curB = 0;
  _renderKoCorrectModal();
}
function _koCorrectClose() { _koCorrectState = null; document.getElementById('koCorrectModal')?.remove(); }
async function _koCorrectFinish() {
  if (!_koCorrectState) return;
  const need = _koCorrectState.winsNeeded || 1;
  let wA = 0, wB = 0;
  for (const g of _koCorrectState.games) { if (g.a > g.b) wA++; else if (g.b > g.a) wB++; }
  if (wA < need && wB < need) return toast(`ยังไม่จบแมตช์ (ต้องชนะ ${need} เกม)`, 'error');
  const reason = (document.getElementById('koCorrectReason')?.value || '').trim();
  if (!reason) return toast('กรุณาระบุเหตุผลที่แก้ไข', 'error');
  const winnerSide = wA > wB ? 'a' : 'b';
  const { tournamentId, matchId, games } = _koCorrectState;
  try {
    await dbTournamentCorrectKnockoutResult(tournamentId, matchId, games, winnerSide, reason);
    _koCorrectClose();
    toast('แก้ไขผลแล้ว ✅', 'success');
    const wasFullscreen = !!document.getElementById('brmxOverlay');
    renderTournamentSection();
    if (document.getElementById('tournamentTabContent')) renderTournamentTab();
    if (wasFullscreen) koOpenBracketFullscreen(tournamentId);
  } catch (e) { toast('แก้ไขไม่ได้: ' + _tourRegErrText(e), 'error'); }
}
function _renderKoCorrectModal() {
  document.getElementById('koCorrectModal')?.remove();
  const r = _koCorrectState;
  if (!r) return;
  const gamesLog = r.games.map((g, i) =>
    `<span style="font-size:0.68rem;padding:2px 8px;border-radius:12px;background:var(--card);border:1px solid var(--glass-border);color:var(--muted)">เกม ${i + 1}: ${g.a}-${g.b}</span>`
  ).join('');
  const modal = document.createElement('div');
  modal.id = 'koCorrectModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:14px';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid rgba(255,165,0,.4);border-radius:20px;padding:18px 16px;max-width:420px;width:100%">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:0.95rem;font-weight:700;color:#ffb347">✏️ แก้ไขผลแมตช์ที่บันทึกแล้ว</div>
        <button onclick="_koCorrectClose()" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);cursor:pointer">✕</button>
      </div>
      <div style="font-size:0.72rem;color:var(--muted);margin-bottom:10px">กรอกผลที่ถูกต้องใหม่ทั้งหมด — ถ้ารอบถัดไปเล่นจบแล้ว หรือแจกรางวัลไปแล้ว จะแก้ไขไม่ได้</div>
      ${gamesLog ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">${gamesLog}</div>` : ''}
      <div style="display:flex;align-items:stretch;border:1px solid var(--glass-border);border-radius:14px;background:rgba(255,255,255,0.02);margin-bottom:10px">
        ${_koCorrectRenderSide('a')}
        <div style="width:1px;background:var(--glass-border)"></div>
        ${_koCorrectRenderSide('b')}
      </div>
      <input class="inp" id="koCorrectReason" placeholder="เหตุผลที่แก้ไข (จำเป็น)" style="margin-bottom:10px;font-size:0.8rem">
      <button class="btn btn-primary" style="width:100%;background:rgba(255,165,0,.18);border:1px solid rgba(255,165,0,.5);color:#ffb347" onclick="_koCorrectCommitOrFinish()">✅ บันทึกเกมนี้ / แก้ไขผล</button>
    </div>`;
  document.body.appendChild(modal);
}
function _koCorrectRenderSide(side) {
  const r = _koCorrectState;
  const cur = side === 'a' ? r.curA : r.curB;
  const label = side === 'a' ? r.labelA : r.labelB;
  const color = side === 'a' ? 'var(--neon)' : 'var(--neon2)';
  return `<div style="flex:1;text-align:center;padding:8px">
    <div style="font-size:0.78rem;font-weight:700;color:${color};margin-bottom:4px;min-height:2.2em;display:flex;align-items:center;justify-content:center">${label}</div>
    <div style="font-family:'Rajdhani',sans-serif;font-size:3rem;font-weight:700;line-height:1;color:${color}">${cur}</div>
    <div style="display:flex;gap:6px;justify-content:center;margin-top:8px">
      <button onclick="_koCorrectPoint('${side}',-1)" style="width:36px;height:36px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);font-size:1.1rem;cursor:pointer">−</button>
      <button onclick="_koCorrectPoint('${side}',1)" style="width:48px;height:48px;border-radius:50%;border:1px solid ${color};background:${color}22;color:${color};font-size:1.4rem;font-weight:700;cursor:pointer">+</button>
    </div>
  </div>`;
}
function _koCorrectCommitOrFinish() {
  const { curA, curB, winsNeeded } = _koCorrectState;
  if (_koRefGameOver(curA, curB)) {
    _koCorrectState.games.push({ a: curA, b: curB });
    _koCorrectState.curA = 0; _koCorrectState.curB = 0;
    let wA = 0, wB = 0;
    for (const g of _koCorrectState.games) { if (g.a > g.b) wA++; else if (g.b > g.a) wB++; }
    if (wA >= (winsNeeded || 1) || wB >= (winsNeeded || 1)) { _koCorrectFinish(); return; }
    _renderKoCorrectModal();
  } else {
    toast('แต้มยังไม่ถึงเกณฑ์จบเกม', 'error');
  }
}

// ── Knockout generation / single-group completion triggers ─────────────────
// Standings (and thus each group's "winner") are computed client-side via
// tournament.js's own calculateGroupStandings — the server only validates
// that the claimed winner actually belongs to the group and every group
// match is complete, it does not re-run the head-to-head tiebreak itself.
// See rpc_tournament_generate_knockout's header comment for why.
async function koGenerateKnockout(tournamentId) {
  if (!isAdminUser()) return;
  try {
    const t = await dbGetTournamentById(tournamentId);
    let groups = [];
    try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch (e) {}
    const matchType = getTournamentMatchType(groups);
    const realGroups = getTournamentGroups(groups);
    const tMatches = await dbGetTournamentMatches(tournamentId);
    const entrants = [];
    for (const grp of realGroups) {
      const standings = calculateGroupStandings(grp, tMatches, matchType);
      if (standings[0]) entrants.push({ group: grp.letter, winnerId: standings[0].id });
    }
    if (entrants.length < 2) return toast('ต้องมีอย่างน้อย 2 กลุ่มที่แข่งขันครบแล้ว', 'error');
    // AdminV2.confirm, not the native confirm(): a leftover from before this
    // legacy knockout path was migrated to the AdminV2 dialog primitives.
    // AdminV2.confirm has no cancel callback (cancel just closes the dialog),
    // so the follow-through has to live inside onConfirm rather than after an
    // awaited boolean.
    AdminV2.confirm({
      level: 'warn',
      title: 'จับสายน็อกเอาต์?',
      body: `จับสาย Knockout จาก ${entrants.length} กลุ่ม หลังจากนี้จะแก้ผลรอบกลุ่มไม่ได้แล้ว`,
      confirmLabel: 'จับสาย',
      onConfirm: async () => {
        try {
          await dbTournamentGenerateKnockout(tournamentId, entrants);
          toast('จับสาย Knockout เรียบร้อย 🎲', 'success');
          renderTournamentSection();
          if (document.getElementById('tournamentTabContent')) renderTournamentTab();
        } catch (e) { toast('จับสายไม่ได้: ' + _tourRegErrText(e), 'error'); }
      },
    });
  } catch (e) { toast('จับสายไม่ได้: ' + _tourRegErrText(e), 'error'); }
}
function koCompleteSingleGroup(tournamentId, winnerId) {
  if (!isAdminUser() || !winnerId) return;
  AdminV2.confirm({
    level: 'warn',
    title: 'ยืนยันแชมป์นี้?',
    body: 'หลังจากนี้จะแก้ไขไม่ได้',
    confirmLabel: 'ยืนยันแชมป์',
    onConfirm: async () => {
      try {
        await dbTournamentCompleteSingleGroup(tournamentId, winnerId);
        toast('ประกาศแชมป์แล้ว 🏆', 'success');
        renderTournamentSection();
        if (document.getElementById('tournamentTabContent')) renderTournamentTab();
      } catch (e) { toast('ไม่สำเร็จ: ' + _tourRegErrText(e), 'error'); }
    },
  });
}

// ── Reward granting UI: recently-completed tournaments awaiting payout ─────
async function koGrantRewards(tournamentId, btnEl) {
  if (!isAdminUser()) return;
  if (btnEl) btnEl.disabled = true;
  try {
    const rows = await dbTournamentGrantRewards(tournamentId);
    const newlyGranted = (rows || []).filter(r => !r.already_granted);
    toast(newlyGranted.length ? `แจกรางวัลแล้ว ✅ (${newlyGranted.length} คน)` : 'แจกรางวัลไปแล้วก่อนหน้านี้', 'success');
    if (newlyGranted.length) await koPostGrantFollowUp(tournamentId, rows);
    koRenderRewardsPending();
  } catch (e) { toast('แจกรางวัลไม่ได้: ' + _tourRegErrText(e), 'error'); }
  finally { if (btnEl) btnEl.disabled = false; }
}
// Achievements + mail aren't reward_grant() currencies — sent client-side
// after a successful (non-replayed) grant, gated on the same already_granted
// signal the RPC returns per recipient, so this stays idempotency-safe too.
async function koPostGrantFollowUp(tournamentId, rows) {
  const t = await dbGetTournamentById(tournamentId);
  if (!t) return;
  let groups = [];
  try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch (e) {}
  const matchType = getTournamentMatchType(groups);
  const achKey = t.tier === 'Super 1000' ? 'super1000' : t.tier === 'Super 500' ? 'super500' : 'regular';
  const roleLabel = { champion: '🏆 แชมป์', runner_up: '🥈 รองแชมป์', third_place: '🥉 อันดับ 3', participant: '🎖️ ผู้เข้าร่วม' };
  const championIds = rows.filter(r => r.role === 'champion' && !r.already_granted).map(r => r.player_id);
  if (championIds.length) {
    try { await awardTournamentAchievement(championIds, TOUR_ACH_DEFS[achKey]); } catch (e) {}
    if (matchType === '2v2') {
      try { await awardTournamentAchievement(championIds, TOUR_ACH_DEFS.doubles); } catch (e) {}
    }
  }
  for (const r of rows) {
    if (r.already_granted) continue;
    try {
      await dbSendMail(r.player_id, 'coins', String(r.coins_granted || 0),
        `${roleLabel[r.role] || r.role} ${esc(t.name)}! +${r.coins_granted || 0} 🪙${r.elo_granted ? ` +${r.elo_granted} ELO` : ''}`);
    } catch (e) {}
  }
}
async function koRenderRewardsPending() {
  const container = document.getElementById('tournamentRewardsList');
  if (!container || !isAdminUser()) return;
  let completed;
  try { completed = await dbGetHOFTournaments(); } catch (e) { return; }
  const pending = (completed || []).slice(0, 10);
  if (!pending.length) { container.innerHTML = ''; return; }

  let html = `<div style="font-size:0.78rem;font-weight:700;color:var(--muted);margin:10px 0 6px">🎁 แจกรางวัลทัวร์นาเมนต์ที่จบแล้ว</div>`;
  for (const t of pending) {
    let groups = [];
    try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch (e) {}
    const hof = groups.find(g => g._hof);
    const champName = hof?.champion_name ? esc(hof.champion_name) : '—';
    html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--glass-border);border-radius:10px;padding:8px 12px;margin-bottom:6px;font-size:0.78rem">
      <div>🏆 ${esc(t.name)} <span style="color:var(--gold)">${champName}</span></div>
      <button class="btn btn-sm" style="width:auto;font-size:0.7rem" onclick="koGrantRewards(${t.id}, this)">🎁 แจกรางวัล</button>
    </div>`;
  }
  container.innerHTML = html;
}
