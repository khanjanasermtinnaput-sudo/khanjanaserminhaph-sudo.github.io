// ── Partner System — Double Rank leaderboard mode ───────────────────────────
// Reads the server-computed official pairing (supabase_partner_system.sql:
// pair_stats/player_partners, rebuilt by rpc_recalc_partner_system) via the
// v_official_pairs view. Never computes/stores partner relationships or the
// Double Rank score client-side beyond the trivial (p1.pts+p2.pts)/2 read
// from already-loaded db.players — the pairing itself is 100% server-side.
//
// Loads LAST (see index.html) so it wraps the fully-patched renderLeaderboard/
// lbRenderBoard/loadAll cleanly, same convention as dashboard.js/levels.js.

db.officialPairs = [];

async function loadPairs() {
  try { db.officialPairs = await supaFetch('v_official_pairs?select=*'); }
  catch(e) { console.warn('loadPairs failed:', e); db.officialPairs = []; }
}

// Wrap loadAll so officialPairs stays in sync with every players/matches refresh.
const _loadAllForPartners = loadAll;
loadAll = async function() {
  await _loadAllForPartners();
  await loadPairs();
};

async function dbRecalcPartnerSystem(matchId) {
  return supaFetch('rpc/rpc_recalc_partner_system', {
    method: 'POST',
    body: JSON.stringify({ p_trigger_match_id: matchId ?? null })
  });
}

// Returns {id, name} for a player's current official partner, or null.
function getOfficialPartner(playerId) {
  const row = db.officialPairs.find(r => r.player_id_low === playerId || r.player_id_high === playerId);
  if (!row) return null;
  const isLow = row.player_id_low === playerId;
  return { id: isLow ? row.player_id_high : row.player_id_low, name: isLow ? row.name_high : row.name_low, row };
}

// ── Single / Double Rank mode toggle ────────────────────────────────────────
window._lbMode = localStorage.getItem('badminton_lb_mode') === 'double' ? 'double' : 'single';

// Sync toggle-button active state + podium visibility to the persisted mode
// immediately (this script loads at the end of <body>, after the leaderboard
// markup already exists) — renderLeaderboard() itself runs later on navigation.
(function _initLbModeUI() {
  document.querySelectorAll('.lb-mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === window._lbMode));
  const podWrap = document.getElementById('lbPodWrap');
  if (podWrap && window._lbMode === 'double') podWrap.style.display = 'none';
})();

function setLbMode(mode) {
  if (mode !== 'single' && mode !== 'double') return;
  window._lbMode = mode;
  localStorage.setItem('badminton_lb_mode', mode);
  document.querySelectorAll('.lb-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  const podWrap = document.getElementById('lbPodWrap');
  if (podWrap) podWrap.style.display = mode === 'double' ? 'none' : '';
  const bh = document.getElementById('lbBoardHeader');
  if (bh) bh.querySelector('.lb-bh-score-label') && (bh.querySelector('.lb-bh-score-label').textContent = mode === 'double' ? 'Double Score' : 'คะแนน');
  renderLeaderboard();
}

// ── Double Rank board rendering ──────────────────────────────────────────────
// Builds pair "rows" purely from db.players + db.officialPairs (never a
// stored score) sorted by live (p1.pts+p2.pts)/2, reusing the exact same
// .lb-br.lb-glass row shell (and its ripple/animation/base CSS) as the
// single-rank board, plus additive .lb-br-pair/.lb-rplyr-pair/... classes so
// single-rank rows are untouched.
function _buildOfficialPairsWithScore() {
  const byId = new Map(db.players.map(p => [p.id, p]));
  const pairs = [];
  for (const row of db.officialPairs) {
    const p1 = byId.get(row.player_id_low), p2 = byId.get(row.player_id_high);
    if (!p1 || !p2) continue; // deleted/inactive player — silently excluded, no crash
    const score = Math.round((p1.pts + p2.pts) / 2);
    pairs.push({ p1, p2, score, stats: row });
  }
  pairs.sort((a, b) => b.score - a.score);
  return pairs;
}

function lbRenderDoubleBoard(pairs) {
  const bl = document.getElementById('lbBoardList');
  bl.innerHTML = '';
  const isLite = document.documentElement.getAttribute('data-style') === 'lite';

  const half = (p) => {
    const av = getAvatar(p.id, p.name);
    return `<div class="lb-rplyr-half">
      <div style="position:relative;flex-shrink:0;isolation:isolate">
        <div class="lb-rav ${getGachaFrameClass(p)}" style="width:32px;height:32px;background:${av.bg};color:${av.fg};${av.fs?'font-size:'+av.fs:''};position:relative;isolation:isolate">${getGachaFrameInner(p)}${av.content}</div>
      </div>
      <div class="lb-rn-pair ${getGachaNameClass(p)}">${esc(p.name)}</div>
    </div>`;
  };

  pairs.forEach((pair, i) => {
    const { p1, p2, score, stats } = pair;
    const isMe = currentUser && (p1.id === currentUser.id || p2.id === currentUser.id);
    const matchesTogether = stats.matches_together || 0;
    const winRate = stats.win_rate_pct || 0;
    const posEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
    const row = document.createElement('div');
    row.className = `lb-br lb-glass lb-br-pair${isMe ? ' lbme' : ''}`;
    row.dataset.name = (p1.name + ' ' + p2.name).toLowerCase();
    row.style.animationDelay = (i * .06) + 's';
    row.innerHTML = `
      <div class="lb-rrank">${posEmoji || (i + 1)}</div>
      <div class="lb-rplyr-pair">
        ${half(p1)}
        <span class="lb-rplyr-sep">/</span>
        ${half(p2)}
      </div>
      <div class="lb-rst"><span class="lb-pts-val">${score.toLocaleString()}</span><small>Double Score</small></div>
      <div class="lb-rst">${matchesTogether}<small>คู่กัน</small></div>
      <div class="lb-rst">${winRate}%<small>Win rate</small></div>
      <div class="lb-rbadge"></div>
    `;
    row.addEventListener('click', e => {
      lbAddRipple(row, e);
    });
    bl.appendChild(row);
    if (!isLite) setTimeout(() => { row.classList.add('lbvis'); }, i * 60 + 80);
    else { row.classList.add('lbvis'); row.style.opacity = '1'; row.style.transform = 'none'; }
  });

  if (!pairs.length) {
    bl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:0.85rem">ยังไม่มีคู่ทางการ — ต้องมีประวัติแข่งคู่ก่อน</div>`;
  }
}

// Wrap renderLeaderboard: Single mode = fully original behavior (untouched).
// Double mode = independent render path over db.officialPairs, board-only
// (podium hidden — see setLbMode), never touching sort/scoring of Single Rank.
const _renderLeaderboardForPartners = renderLeaderboard;
renderLeaderboard = async function() {
  if (window._lbMode !== 'double') { await _renderLeaderboardForPartners(); return; }
  try {
    await loadAll();
    const pairs = _buildOfficialPairsWithScore();
    // Stat cards (players/matches/best win rate) stay mode-agnostic global
    // stats — same numbers as Single Rank — to avoid relabeling their fixed
    // HTML captions for a pair-specific stat.
    lbCountUp('lbStatPlayers', db.players.length, 900);
    lbCountUp('lbStatMatches', db.matches.length, 900);
    let bestWR = 0, bestWRName = '—';
    db.players.forEach(p => {
      const total = p.wins + p.losses;
      if (total >= 3) { const wr = Math.round(p.wins / total * 100); if (wr > bestWR) { bestWR = wr; bestWRName = p.name; } }
    });
    document.getElementById('lbStatWR').textContent = bestWR + '%';
    document.getElementById('lbStatWRName').textContent = bestWRName;
    lbRenderDoubleBoard(pairs);
  } catch(e) { console.error('renderLeaderboard (double mode) error:', e); }
};

// Inject a small "Partner: X" line under the name in Single Rank rows —
// purely additive, does not touch sort/scoring. Wraps whatever lbRenderBoard
// currently is (including any earlier patches, e.g. the form-badge one), so
// it always runs against the final rendered row set.
const _lbRenderBoardForPartners = lbRenderBoard;
lbRenderBoard = function(data, animate) {
  _lbRenderBoardForPartners(data, animate);
  if (!data || !data.length) return;
  const items = document.querySelectorAll('#lbBoardList .lb-br');
  items.forEach((row, i) => {
    const p = data[i];
    if (!p || row.querySelector('.lb-rpartner')) return;
    const partner = getOfficialPartner(p.id);
    if (!partner) return;
    const info = row.querySelector('.lb-rinfo');
    if (!info) return;
    const el = document.createElement('div');
    el.className = 'lb-rpartner';
    el.textContent = `Partner: ${partner.name}`;
    info.appendChild(el);
  });
};

// ── Post-match trigger wiring ────────────────────────────────────────────────
// Fires a best-effort server-side recalc right after a doubles match/pending
// approval is saved. Wraps the already-patched saveMatch/approvePending
// (coin/EXP wrapper in index.html) so it composes cleanly regardless of load
// order relative to that inline patch.
const _saveMatchForPartners = saveMatch;
saveMatch = async function() {
  // Non-admin saves go to pending_matches (not matches) and never set
  // _lastSavedMatchId, so gate on isAdminUser() too — same condition the
  // existing coin/EXP wrapper above already uses for the same reason.
  const wasDoubles = currentMatch && currentMatch.type === 'doubles' && isAdminUser();
  await _saveMatchForPartners();
  if (wasDoubles) { try { await dbRecalcPartnerSystem(_lastSavedMatchId); } catch(e) {} }
};

const _approvePendingForPartners = approvePending;
approvePending = async function(pendingId) {
  let wasDoubles = false;
  try { const rows = await dbGetPending(); wasDoubles = rows.find(x => x.id === pendingId)?.type === 'doubles'; } catch(e) {}
  await _approvePendingForPartners(pendingId);
  if (wasDoubles) { try { await dbRecalcPartnerSystem(_lastSavedMatchId); } catch(e) {} }
};
