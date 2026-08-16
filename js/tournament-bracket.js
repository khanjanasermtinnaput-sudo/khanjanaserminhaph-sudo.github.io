// ── Single Elimination tournament format (Phases 4-5) ────────────────────────
// Additive companion to tournament.js: adds create/register/generate-bracket/
// record-result UI for the new "single_elimination" format (up to 32
// entrants/teams, real bracket tree + atomic auto-advancing result submission
// via rpc_tournament_generate_bracket / rpc_tournament_submit_result) without
// touching the existing round_robin_groups creation/registration/knockout/
// Referee code at all. The full BWF-style spectator bracket viewer (a later
// phase) will replace _seRenderMatchListHTML's plain round list below with a
// proper connected tree — this phase focuses on correct data flow (create →
// register → generate → record results → auto-advance → champion), reusing
// tournament.js's own DB helpers (dbTournamentCreate/Register/Unregister,
// dbGetTournaments, dbGetTournamentMatches, getTournamentConfig/
// getTournamentMatchType, isAdminUser/currentUser/esc/toast) rather than
// duplicating them.

async function dbTournamentGenerateBracket(tournamentId) {
  return supaFetch('rpc/rpc_tournament_generate_bracket', {
    method: 'POST',
    body: JSON.stringify({ p_tournament_id: tournamentId })
  });
}
async function dbTournamentSubmitResult(tournamentId, matchId, games, winnerSide, idempotencyKey) {
  return supaFetch('rpc/rpc_tournament_submit_result', {
    method: 'POST',
    body: JSON.stringify({
      p_tournament_id: tournamentId, p_match_id: matchId, p_games: games,
      p_winner_side: winnerSide ?? null, p_idempotency_key: idempotencyKey ?? null
    })
  });
}
async function dbTournamentGrantRewards(tournamentId) {
  return supaFetch('rpc/rpc_tournament_grant_rewards', {
    method: 'POST',
    body: JSON.stringify({ p_tournament_id: tournamentId })
  });
}

// ── [Phase 5] Live referee (adapted from tournament.js's _ref* state machine —
// kept fully separate/global-state-isolated so the round-robin referee flow,
// which posts to dbAddTournamentMatch, is never touched). Winner is always
// recomputed server-side from the submitted games by rpc_tournament_submit_result;
// this UI only decides WHEN a match looks finished client-side for UX. ──
let _seRefState = null;

function _seRefGameOver(a, b) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi >= 30) return true;
  if (hi >= 21 && hi - lo >= 2) return true;
  return false;
}
function seOpenReferee(tournamentId, matchId, idA, idB, labelA, labelB, winsNeeded) {
  if (!idA || !idB || idA === idB) return toast('แมตช์นี้ยังไม่มีผู้เล่นครบ', 'error');
  _seRefState = { tournamentId, matchId, idA, idB, labelA, labelB, winsNeeded, games: [], curA: 0, curB: 0 };
  _renderSeRefModal();
}
function _seRefPoint(side, delta) {
  if (!_seRefState) return;
  if (side === 'a') _seRefState.curA = Math.max(0, _seRefState.curA + delta);
  else _seRefState.curB = Math.max(0, _seRefState.curB + delta);
  _renderSeRefModal();
}
function _seRefCommitGame() {
  if (!_seRefState) return;
  if (!_seRefGameOver(_seRefState.curA, _seRefState.curB)) return;
  _seRefState.games.push({ a: _seRefState.curA, b: _seRefState.curB });
  _seRefState.curA = 0; _seRefState.curB = 0;
  _renderSeRefModal();
}
function _seRefGamesWon() {
  let wA = 0, wB = 0;
  for (const g of _seRefState.games) { if (g.a > g.b) wA++; else if (g.b > g.a) wB++; }
  return { wA, wB };
}
function _seRefClose() { _seRefState = null; document.getElementById('seRefModal')?.remove(); }
async function _seRefFinish() {
  if (!_seRefState) return;
  const need = _seRefState.winsNeeded || 1;
  const { wA, wB } = _seRefGamesWon();
  if (wA < need && wB < need) return toast(`ยังไม่จบแมตช์ (ต้องชนะ ${need} เกม)`, 'error');
  const winnerSide = wA > wB ? 'a' : 'b';
  const { tournamentId, matchId, games } = _seRefState;
  try {
    await dbTournamentSubmitResult(tournamentId, matchId, games, winnerSide, `se-${matchId}-${Date.now()}`);
    _seRefClose();
    toast('บันทึกผลแล้ว ✅', 'success');
    const wasFullscreen = !!document.getElementById('brmxOverlay');
    await _seRefreshAll();
    if (wasFullscreen) seOpenBracketFullscreen(tournamentId);
  } catch (e) { toast('บันทึกไม่ได้: ' + _tourRegErrText(e), 'error'); }
}
function _seRefRenderSide(side, btnDisabled) {
  const r = _seRefState;
  const cur = side === 'a' ? r.curA : r.curB;
  const label = side === 'a' ? r.labelA : r.labelB;
  const won = _seRefGamesWon();
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
      <button onclick="_seRefPoint('${side}',-1)" ${dis} style="width:42px;height:42px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);font-size:1.2rem;cursor:${cur2};opacity:${op}">−</button>
      <button onclick="_seRefPoint('${side}',1)" ${dis} style="width:56px;height:56px;border-radius:50%;border:1px solid ${color};background:${color}22;color:${color};font-size:1.6rem;font-weight:700;cursor:${cur2};opacity:${op}">+</button>
    </div>
  </div>`;
}
function _renderSeRefModal() {
  document.getElementById('seRefModal')?.remove();
  const r = _seRefState;
  if (!r) return;
  const need = r.winsNeeded || 1;
  const gameNo = r.games.length + 1;
  const over = _seRefGameOver(r.curA, r.curB);
  const { wA, wB } = _seRefGamesWon();
  const matchDone = wA >= need || wB >= need;
  const gameWinnerLabel = r.curA > r.curB ? r.labelA : r.labelB;
  const bestOfLabel = need === 2 ? 'Best of 3' : 'เกมเดียว';

  const gamesLog = r.games.map((g, i) =>
    `<span style="font-size:0.68rem;padding:2px 8px;border-radius:12px;background:var(--card);border:1px solid var(--glass-border);color:var(--muted)">เกม ${i + 1}: ${g.a}-${g.b}</span>`
  ).join('');

  let actionBtn = '';
  if (matchDone) {
    const champLabel = wA > wB ? r.labelA : r.labelB;
    actionBtn = `<button class="btn btn-primary" style="width:100%;background:rgba(255,215,0,.18);border:1px solid rgba(255,215,0,.5);color:#ffd700;font-weight:700" onclick="_seRefFinish()">💾 บันทึกผล · 🏆 ${champLabel} (${wA}-${wB})</button>`;
  } else if (over) {
    const winnerSideWins = (r.curA > r.curB ? wA : wB) + 1;
    const willFinish = winnerSideWins >= need;
    const nextLabel = willFinish ? '🏆 จบแมตช์' : '→ เกมต่อไป';
    actionBtn = `<button class="btn btn-primary" style="width:100%" onclick="_seRefCommitGame()">✅ จบเกม ${gameNo} (${gameWinnerLabel} ${r.curA}-${r.curB}) ${nextLabel}</button>`;
  } else {
    actionBtn = `<div style="text-align:center;font-size:0.7rem;color:var(--muted);padding:8px">กำลังแข่งเกมที่ ${gameNo} · ถึง 21 แต้ม (ห่าง 2) เกมจะจบอัตโนมัติ</div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'seRefModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:14px';
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid rgba(0,245,160,.3);border-radius:20px;padding:18px 16px;max-width:420px;width:100%;box-shadow:0 0 60px rgba(0,245,160,.12)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:0.95rem;font-weight:700">🎬 Referee · เกมที่ ${gameNo} <span style="font-size:0.66rem;font-weight:500;color:var(--muted)">(${bestOfLabel})</span></div>
        <button onclick="_seRefClose()" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--glass-border);background:var(--btn-glass);color:var(--muted);cursor:pointer">✕</button>
      </div>
      ${gamesLog ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">${gamesLog}</div>` : ''}
      <div style="display:flex;align-items:stretch;border:1px solid var(--glass-border);border-radius:14px;background:rgba(255,255,255,0.02);margin-bottom:12px">
        ${_seRefRenderSide('a', over || matchDone)}
        <div style="width:1px;background:var(--glass-border)"></div>
        ${_seRefRenderSide('b', over || matchDone)}
      </div>
      ${actionBtn}
    </div>`;
  document.body.appendChild(modal);
}

// ── [Phase 6] Full-screen BWF-style spectator bracket viewer ────────────────
// Connectors: matches are grouped into sibling pairs (round N's match i and
// i+1 always feed round N+1's match floor(i/2), by construction of
// rpc_tournament_generate_bracket) and each pair is wrapped in a bracket-
// shaped border (.brmx-pair) with a short stub pointing at the next round —
// geometrically correct regardless of content height, no pixel math needed.
function _seChunkPairs(matches) {
  const pairs = [];
  for (let i = 0; i < matches.length; i += 2) pairs.push(matches.slice(i, i + 2));
  return pairs;
}
function _brmxMatchCardHTML(m, cfg, players, tournamentId, tier, isAdmin) {
  const winsNeeded = tier === 'Super 1000' ? 2 : 1;
  const nameA = _seMatchPlayerLabel(cfg, players, m.player_a) || (m.status === 'pending' ? 'รอผู้ชนะ' : '—');
  const nameB = _seMatchPlayerLabel(cfg, players, m.player_b) || (m.status === 'pending' ? 'รอผู้ชนะ' : '—');
  const aWin = m.winner_id != null && m.winner_id === m.player_a;
  const bWin = m.winner_id != null && m.winner_id === m.player_b;
  const canRef = isAdmin && m.status === 'ready';
  return `<div class="brmx-match">
    <div class="brmx-row${aWin ? ' win' : ''}">${aWin ? '<span class="brmx-tick">✓</span>' : ''}<span class="brmx-name">${nameA}</span>${m.status === 'completed' ? `<span class="brmx-score">${m.score_a ?? 0}</span>` : ''}</div>
    <div class="brmx-row${bWin ? ' win' : ''}">${bWin ? '<span class="brmx-tick">✓</span>' : ''}<span class="brmx-name">${nameB}</span>${m.status === 'completed' ? `<span class="brmx-score">${m.score_b ?? 0}</span>` : ''}</div>
    ${m.is_bye ? '<div class="brmx-note">BYE — ผ่านเข้ารอบอัตโนมัติ</div>' : ''}
    ${canRef ? `<button class="brmx-refbtn" onclick="seOpenReferee(${tournamentId},${m.id},${m.player_a},${m.player_b},'${nameA.replace(/'/g, "\\'")}','${nameB.replace(/'/g, "\\'")}',${winsNeeded})">🎬 บันทึกผล</button>` : ''}
  </div>`;
}
function openBracketFullscreen(tournamentId, tournamentName, matches, cfg, tier, isAdmin) {
  document.getElementById('brmxOverlay')?.remove();
  const rounds = {};
  matches.forEach(m => { (rounds[m.round_index] = rounds[m.round_index] || []).push(m); });
  const roundIdxs = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const lastIdx = roundIdxs[roundIdxs.length - 1];
  const champion = matches.find(m => m.round_name === 'F' && m.status === 'completed');

  const roundsHTML = roundIdxs.map(ri => {
    const roundMatches = rounds[ri].sort((a, b) => (a.bracket_slot || '').localeCompare(b.bracket_slot || '', undefined, { numeric: true }));
    const label = roundMatches[0].round_name || `Round ${ri + 1}`;
    const pairs = _seChunkPairs(roundMatches);
    const pairsHTML = pairs.map(pair => `<div class="brmx-pair${pair.length === 2 ? ' brmx-haspartner' : ''}">${pair.map(m => _brmxMatchCardHTML(m, cfg, db.players, tournamentId, tier, isAdmin)).join('')}</div>`).join('');
    return `<div class="brmx-round${ri === lastIdx && !champion ? ' brmx-lastround' : ''}" id="brmxRound${ri}">
      <div class="brmx-roundlabel">${esc(label)}</div>
      <div class="brmx-pairs">${pairsHTML}</div>
    </div>`;
  }).join('');

  const champHTML = champion ? `<div class="brmx-round brmx-champcol brmx-lastround">
    <div class="brmx-roundlabel">Champion</div>
    <div class="brmx-champ-box"><div class="brmx-champ-medal">🏆</div><div class="brmx-champ-name">${_seMatchPlayerLabel(cfg, db.players, champion.winner_id)}</div></div>
  </div>` : '';

  const chipsHTML = roundIdxs.map(ri => `<button class="brmx-chip" onclick="_brmxScrollTo(${ri})">${esc(rounds[ri][0].round_name || `R${ri + 1}`)}</button>`).join('')
    + (champion ? `<button class="brmx-chip" onclick="document.getElementById('brmxBody').scrollTo({left:99999,behavior:'smooth'})">🏆</button>` : '');

  const overlay = document.createElement('div');
  overlay.id = 'brmxOverlay';
  overlay.className = 'brmx-overlay';
  overlay.innerHTML = `
    <div class="brmx-header">
      <div class="brmx-title">🥊 ${esc(tournamentName)}</div>
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
// through an inline handler) — reads the matches/cfg _seRenderList already
// fetched for this render pass instead of re-querying the DB again.
const _seViewCache = {};
function seOpenBracketFullscreen(tournamentId) {
  const cached = _seViewCache[tournamentId];
  if (!cached) return toast('ยังไม่มีข้อมูลสาย กรุณาลองใหม่', 'error');
  openBracketFullscreen(tournamentId, cached.name, cached.matches, cached.cfg, cached.tier, isAdminUser());
}

// ── Entrant / match player display helpers ──────────────────────────────────
function _seEntrantLabel(entry, players) {
  const p = players.find(x => x.id === entry.playerId);
  const pname = p ? esc(p.name) : `#${entry.playerId}`;
  if (entry.partnerId) {
    const p2 = players.find(x => x.id === entry.partnerId);
    return `${pname} + ${p2 ? esc(p2.name) : '#' + entry.partnerId}`;
  }
  return pname;
}
// player_a/player_b on a generated match row are always the registrant's own
// (anchor) id — for doubles, look up the partner from the tournament's
// entrant list (same "anchor id + members lookup" convention getTeamByAnchor
// already uses for the round-robin format, just against a flat list here).
function _seMatchPlayerLabel(cfg, players, playerId) {
  if (playerId == null) return null;
  const entry = (cfg?.entrants || []).find(e => e.playerId === playerId);
  if (entry) return _seEntrantLabel(entry, players);
  const p = players.find(x => x.id === playerId);
  return p ? esc(p.name) : `#${playerId}`;
}

function _seRenderMatchListHTML(matches, cfg, players, tournamentId, tier, isAdmin) {
  const winsNeeded = tier === 'Super 1000' ? 2 : 1;
  const rounds = {};
  matches.forEach(m => { (rounds[m.round_index] = rounds[m.round_index] || []).push(m); });
  const roundIdxs = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  let html = '<div style="display:flex;flex-direction:column;gap:10px">';
  for (const ri of roundIdxs) {
    const label = rounds[ri][0].round_name || `Round ${ri + 1}`;
    html += `<div><div style="font-size:0.74rem;font-weight:700;color:var(--neon2);margin-bottom:5px">${esc(label)}</div>`;
    rounds[ri]
      .sort((a, b) => (a.bracket_slot || '').localeCompare(b.bracket_slot || '', undefined, { numeric: true }))
      .forEach(m => {
        const nameA = _seMatchPlayerLabel(cfg, players, m.player_a) || 'รอผู้ชนะ';
        const nameB = _seMatchPlayerLabel(cfg, players, m.player_b) || 'รอผู้ชนะ';
        const aWin = m.winner_id != null && m.winner_id === m.player_a;
        const bWin = m.winner_id != null && m.winner_id === m.player_b;
        const scoreTxt = m.status === 'completed' ? ` (${m.score_a ?? 0}-${m.score_b ?? 0})` : '';
        const canRef = isAdmin && m.status === 'ready';
        html += `<div style="border:1px solid var(--glass-border);border-radius:10px;padding:6px 10px;margin-bottom:5px;font-size:0.78rem">
          <div style="${aWin ? 'color:var(--neon);font-weight:700' : ''}">${aWin ? '✓ ' : ''}${nameA}</div>
          <div style="${bWin ? 'color:var(--neon);font-weight:700' : ''}">${bWin ? '✓ ' : ''}${nameB}${scoreTxt}</div>
          ${m.is_bye ? '<div style="font-size:0.68rem;color:var(--muted)">BYE — ผ่านเข้ารอบอัตโนมัติ</div>' : ''}
          ${canRef ? `<button class="btn btn-primary btn-sm" style="width:auto;margin-top:6px;font-size:0.7rem" onclick="seOpenReferee(${tournamentId},${m.id},${m.player_a},${m.player_b},'${esc(nameA).replace(/'/g, "\\'")}','${esc(nameB).replace(/'/g, "\\'")}',${winsNeeded})">🎬 บันทึกผล</button>` : ''}
        </div>`;
      });
    html += `</div>`;
  }
  html += '</div>';
  return html;
}

// ── Shared list renderer (admin + public tab both call this, isAdmin toggles the actions) ──
async function _seRenderList(containerId, isAdmin) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let tournaments;
  try { tournaments = await dbGetTournaments(); } catch (e) { return; }
  const seTournaments = tournaments.filter(t => t.format === 'single_elimination');
  if (!seTournaments.length) { container.innerHTML = ''; return; }

  let html = '';
  for (const t of seTournaments) {
    let groups = [];
    try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch (e) {}
    const cfg = getTournamentConfig(groups);
    const matchType = getTournamentMatchType(groups);
    const tierBadge = t.tier === 'Super 1000' ? '🥇' : t.tier === 'Super 500' ? '🥈' : '🏸';
    const safeName = t.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');

    html += `<div class="tournament-group" style="margin-bottom:16px;position:relative">`;
    html += `<div class="tournament-group-title">${tierBadge} ${esc(t.name)} ${renderModeBadge(matchType)} <span style="font-size:0.64rem;background:rgba(0,217,245,0.12);border:1px solid rgba(0,217,245,0.3);border-radius:20px;padding:1px 7px;color:var(--neon2);margin-left:6px">🥊 แพ้คัดออก</span></div>`;

    let matches = [];
    try { matches = await dbGetTournamentMatches(t.id); } catch (e) {}
    const hasBracket = matches.length > 0;
    if (hasBracket) _seViewCache[t.id] = { matches, cfg, tier: t.tier, name: t.name };

    if (isAdmin) {
      html += `<button class="t-cancel-btn" style="position:absolute;top:10px;right:10px" onclick="confirmCancelTournament(${t.id},'${safeName}')">✕ ยกเลิก</button>`;
    }

    if (!hasBracket) {
      const entrants = cfg?.entrants || [];
      const n = entrants.length;
      const max = t.max_participants || 32;
      const deadlinePassed = t.registration_deadline && new Date(t.registration_deadline) < new Date();
      html += `<div style="font-size:0.82rem;font-weight:700;margin:8px 0 4px">📋 รับสมัคร <span style="color:var(--neon)">${n}</span>/${max}${t.registration_deadline ? ` · ปิดรับสมัคร ${new Date(t.registration_deadline).toLocaleString('th-TH')}` : ''}${deadlinePassed ? ' <span style="color:var(--red)">(หมดเขต)</span>' : ''}</div>`;
      html += `<div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px">${entrants.map(e => _seEntrantLabel(e, db.players)).join(', ') || 'ยังไม่มีผู้สมัคร'}</div>`;

      if (!isAdmin) {
        const myEntry = currentUser ? entrants.find(e => e.playerId === currentUser.id || e.partnerId === currentUser.id) : null;
        if (!currentUser) {
          html += `<div style="font-size:0.76rem;color:var(--muted)">เข้าสู่ระบบเพื่อสมัครแข่ง</div>`;
        } else if (myEntry) {
          html += `<button class="btn btn-sm" style="width:auto" onclick="seUnregister(${t.id})">ถอนสมัคร</button>`;
        } else if (n >= max || deadlinePassed) {
          html += `<div style="font-size:0.76rem;color:var(--muted)">ปิดรับสมัครแล้ว</div>`;
        } else if (matchType === '2v2') {
          const pOpts = db.players.filter(p => p.id !== currentUser.id).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
          html += `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <select class="inp" id="sePartner_${t.id}" style="flex:1;min-width:120px;font-size:0.8rem">${pOpts}</select>
            <button class="btn btn-primary btn-sm" style="width:auto" onclick="seRegister(${t.id},'2v2')">+ สมัคร (คู่)</button>
          </div>`;
        } else {
          html += `<button class="btn btn-primary btn-sm" style="width:auto" onclick="seRegister(${t.id},'1v1')">+ สมัคร</button>`;
        }
      } else if (n >= 2) {
        html += `<button class="btn btn-primary btn-sm" style="width:auto" onclick="seGenerateBracket(${t.id})">🎲 จับสาย (Generate Bracket)</button>`;
      } else {
        html += `<div style="font-size:0.76rem;color:var(--muted)">ต้องมีผู้สมัครอย่างน้อย 2 คน/ทีม</div>`;
      }
    } else {
      html += `<button class="t-viewbracket-btn" onclick="seOpenBracketFullscreen(${t.id})">🏆 ดูสาย Bracket แบบเต็มจอ</button>`;
      html += _seRenderMatchListHTML(matches, cfg, db.players, t.id, t.tier, isAdmin);
    }
    html += `</div>`;
  }
  container.innerHTML = html;
}

async function _seRefreshAll() {
  if (document.getElementById('seAdminList')) await _seRenderList('seAdminList', true);
  if (document.getElementById('seTabList')) await _seRenderList('seTabList', false);
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function seCreateTournament() {
  const name = (document.getElementById('seName')?.value || '').trim();
  const tier = document.getElementById('seTier')?.value || 'Regular';
  const matchType = document.getElementById('seMatchType')?.value || '1v1';
  const maxParticipants = parseInt(document.getElementById('seMaxParticipants')?.value) || 0;
  const deadlineRaw = document.getElementById('seDeadline')?.value || '';
  if (!name) return toast('กรุณากรอกชื่อทัวร์นาเมนต์', 'error');
  if (maxParticipants < 2 || maxParticipants > 32) return toast('ผู้เข้าแข่งขันสูงสุดต้องอยู่ระหว่าง 2-32', 'error');
  const registrationDeadline = deadlineRaw ? new Date(deadlineRaw).toISOString() : null;
  const groups = [
    { _meta: true, matchType },
    { _config: true, matchType, registrationOpen: true, entrants: [] }
  ];
  try {
    toast('กำลังสร้าง...', 'info');
    await dbTournamentCreate(name, tier, matchType, 'single_elimination', groups, maxParticipants, registrationDeadline);
    toast('สร้าง Single Elimination แล้ว! 🥊', 'success');
    const nameInput = document.getElementById('seName');
    if (nameInput) nameInput.value = '';
    _seRefreshAll();
  } catch (e) { toast('สร้างไม่ได้: ' + _tourRegErrText(e), 'error'); }
}

async function seRegister(tournamentId, matchType) {
  if (!currentUser) return toast('กรุณาเข้าสู่ระบบก่อน', 'error');
  try {
    let partnerId = null;
    if (matchType === '2v2') {
      partnerId = parseInt(document.getElementById(`sePartner_${tournamentId}`)?.value);
      if (!partnerId) return toast('เลือกคู่หู', 'error');
    }
    await dbTournamentRegister(tournamentId, null, null, null, partnerId);
    toast('สมัครแล้ว ✅', 'success');
    _seRefreshAll();
  } catch (e) { toast('ไม่สำเร็จ: ' + _tourRegErrText(e), 'error'); }
}

async function seUnregister(tournamentId) {
  try {
    await dbTournamentUnregister(tournamentId);
    toast('ถอนสมัครแล้ว', 'success');
    _seRefreshAll();
  } catch (e) { toast('ไม่สำเร็จ: ' + _tourRegErrText(e), 'error'); }
}

async function seGenerateBracket(tournamentId) {
  if (!isAdminUser()) return;
  if (!confirm('จับสายแล้วจะปิดรับสมัครทันที ยืนยันหรือไม่?')) return;
  try {
    await dbTournamentGenerateBracket(tournamentId);
    toast('จับสายเรียบร้อย 🎲', 'success');
    _seRefreshAll();
  } catch (e) { toast('จับสายไม่ได้: ' + _tourRegErrText(e), 'error'); }
}

async function seGrantRewards(tournamentId, btnEl) {
  if (!isAdminUser()) return;
  if (btnEl) btnEl.disabled = true;
  try {
    const rows = await dbTournamentGrantRewards(tournamentId);
    const newlyGranted = (rows || []).filter(r => !r.already_granted);
    toast(newlyGranted.length ? `แจกรางวัลแล้ว ✅ (${newlyGranted.length} คน)` : 'แจกรางวัลไปแล้วก่อนหน้านี้', 'success');
    _seRenderRewardsPending();
  } catch (e) { toast('แจกรางวัลไม่ได้: ' + _tourRegErrText(e), 'error'); }
  finally { if (btnEl) btnEl.disabled = false; }
}

// ── Admin panel: recently-completed Single Elimination tournaments awaiting reward payout ──
async function _seRenderRewardsPending() {
  const container = document.getElementById('seRewardsList');
  if (!container || !isAdminUser()) return;
  let completed;
  try { completed = await dbGetHOFTournaments(); } catch (e) { return; }
  const seCompleted = (completed || []).filter(t => t.format === 'single_elimination').slice(0, 10);
  if (!seCompleted.length) { container.innerHTML = ''; return; }

  let html = `<div style="font-size:0.78rem;font-weight:700;color:var(--muted);margin:10px 0 6px">🎁 แจกรางวัลทัวร์นาเมนต์ที่จบแล้ว</div>`;
  for (const t of seCompleted) {
    let groups = [];
    try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch (e) {}
    const hof = groups.find(g => g._hof);
    const champName = hof?.champion_name ? esc(hof.champion_name) : '—';
    html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--glass-border);border-radius:10px;padding:8px 12px;margin-bottom:6px;font-size:0.78rem">
      <div>🏆 ${esc(t.name)} <span style="color:var(--gold)">${champName}</span></div>
      <button class="btn btn-sm" style="width:auto;font-size:0.7rem" onclick="seGrantRewards(${t.id}, this)">🎁 แจกรางวัล</button>
    </div>`;
  }
  container.innerHTML = html;
}

// ── Wire into the existing admin/public render entrypoints without touching
//    tournament.js's own round_robin_groups rendering logic ──
const _seOrigRenderTournamentSection = renderTournamentSection;
renderTournamentSection = async function () {
  await _seOrigRenderTournamentSection();
  const container = document.getElementById('tournamentAdminSection');
  if (!container) return;
  if (!document.getElementById('seAdminCard')) {
    const card = document.createElement('div');
    card.id = 'seAdminCard';
    card.className = 'card';
    card.style.marginTop = '16px';
    card.innerHTML = `<div class="card-title">🥊 Single Elimination (ใหม่) — สูงสุด 32 คน/ทีม</div>
      <div style="margin-bottom:12px">
        <input class="inp" id="seName" placeholder="ชื่อทัวร์นาเมนต์" style="margin-bottom:8px">
        <select class="inp" id="seTier" style="margin-bottom:8px">
          <option value="Regular">Regular</option>
          <option value="Super 500">Super 500</option>
          <option value="Super 1000">Super 1000</option>
        </select>
        <select class="inp" id="seMatchType" style="margin-bottom:8px">
          <option value="1v1">🏸 1v1 — Singles</option>
          <option value="2v2">⚔️ 2v2 — Doubles</option>
        </select>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:130px">
            <div style="font-size:0.72rem;color:var(--muted);margin-bottom:4px">ผู้เข้าแข่งขันสูงสุด (2-32)</div>
            <input class="inp" type="number" id="seMaxParticipants" min="2" max="32" value="16">
          </div>
          <div style="flex:1;min-width:160px">
            <div style="font-size:0.72rem;color:var(--muted);margin-bottom:4px">ปิดรับสมัคร (ไม่บังคับ)</div>
            <input class="inp" type="datetime-local" id="seDeadline">
          </div>
        </div>
        <button class="btn btn-primary btn-sm" style="width:auto" onclick="seCreateTournament()">🥊 สร้าง Single Elimination</button>
      </div>
      <div id="seAdminList"></div>
      <div id="seRewardsList"></div>`;
    container.appendChild(card);
  }
  _seRenderList('seAdminList', true);
  _seRenderRewardsPending();
};

const _seOrigRenderTournamentTab = renderTournamentTab;
renderTournamentTab = async function () {
  await _seOrigRenderTournamentTab();
  const container = document.getElementById('tournamentTabContent');
  if (!container) return;
  if (!document.getElementById('seTabList')) {
    const div = document.createElement('div');
    div.id = 'seTabList';
    container.appendChild(div);
  }
  _seRenderList('seTabList', false);
};
