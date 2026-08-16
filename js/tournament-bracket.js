// ── Single Elimination tournament format (Phase 4) ──────────────────────────
// Additive companion to tournament.js: adds create/register/generate-bracket
// UI for the new "single_elimination" format (up to 32 entrants/teams, real
// bracket tree via rpc_tournament_generate_bracket) without touching the
// existing round_robin_groups creation/registration/knockout code at all.
// The full BWF-style spectator bracket viewer (Phase 6) will replace
// _seRenderMatchListHTML's plain round list below with a proper connected
// tree — this phase focuses on correct data flow (create → register →
// generate → see who plays whom), reusing tournament.js's own DB helpers
// (dbTournamentCreate/Register/Unregister, dbGetTournaments,
// dbGetTournamentMatches, getTournamentConfig/getTournamentMatchType,
// isAdminUser/currentUser/esc/toast) rather than duplicating them.

async function dbTournamentGenerateBracket(tournamentId) {
  return supaFetch('rpc/rpc_tournament_generate_bracket', {
    method: 'POST',
    body: JSON.stringify({ p_tournament_id: tournamentId })
  });
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

function _seRenderMatchListHTML(matches, cfg, players) {
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
        html += `<div style="border:1px solid var(--glass-border);border-radius:10px;padding:6px 10px;margin-bottom:5px;font-size:0.78rem">
          <div style="${aWin ? 'color:var(--neon);font-weight:700' : ''}">${aWin ? '✓ ' : ''}${nameA}</div>
          <div style="${bWin ? 'color:var(--neon);font-weight:700' : ''}">${bWin ? '✓ ' : ''}${nameB}${scoreTxt}</div>
          ${m.is_bye ? '<div style="font-size:0.68rem;color:var(--muted)">BYE — ผ่านเข้ารอบอัตโนมัติ</div>' : ''}
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
      html += _seRenderMatchListHTML(matches, cfg, db.players);
    }
    html += `</div>`;
  }
  container.innerHTML = html;
}

function _seRefreshAll() {
  if (document.getElementById('seAdminList')) _seRenderList('seAdminList', true);
  if (document.getElementById('seTabList')) _seRenderList('seTabList', false);
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
      <div id="seAdminList"></div>`;
    container.appendChild(card);
  }
  _seRenderList('seAdminList', true);
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
