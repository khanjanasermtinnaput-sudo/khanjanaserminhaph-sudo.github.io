// ── Level / EXP UI (V1 — Profile card, level-up modal, reward claim) ──────
// Server/DB half lives in supabase_level_system.sql + js/exp-engine.js.
// This file only renders state and calls the RPC wrappers in js/db.js —
// it never computes or trusts a client-side EXP amount.

// Full Lv5–100 reward ladder — MUST match the CASE in rpc_claim_level_reward
// (supabase_level_system_v2_rewards.sql) exactly. Hybrid sourcing: early/mid
// tiers reuse existing gacha cosmetics; 'title' rewards write prime_titles
// server-side; Lv50/90/100 use new bespoke frames (styles.css "LEVEL REWARD
// FRAMES"). Lv100 additionally grants two extra titles (Legend, Hall of Fame)
// alongside its frame — see claim_extra_titles handling in claimLevelRewardUI.
const LEVEL_REWARDS = [
  { id: 'lvl5',   level: 5,   type: 'gacha_emoji', value: '🏸',        label_th: 'ตรา Beginner',      label_en: 'Beginner Badge' },
  { id: 'lvl10',  level: 10,  type: 'gacha_frame', value: 'ice',       label_th: 'กรอบโปรไฟล์',       label_en: 'Profile Frame' },
  { id: 'lvl15',  level: 15,  type: 'gacha_emoji', value: '🔥',        label_th: 'อีโมจิแชท',         label_en: 'Chat Emoji' },
  { id: 'lvl20',  level: 20,  type: 'gacha_frame', value: 'robot',     label_th: 'อวตารพิเศษ',        label_en: 'Special Avatar' },
  { id: 'lvl25',  level: 25,  type: 'gacha_name',  value: 'blaze',     label_th: 'สีชื่อพิเศษ',        label_en: 'Name Color' },
  { id: 'lvl30',  level: 30,  type: 'title',       value: 'Skilled Player', label_th: 'ฉายา: Skilled Player', label_en: 'Title: Skilled Player' },
  { id: 'lvl40',  level: 40,  type: 'gacha_emoji', value: '⚡',        label_th: 'ตราเคลื่อนไหว',      label_en: 'Animated Badge' },
  { id: 'lvl50',  level: 50,  type: 'gacha_frame', value: 'lvlgolden', label_th: 'กรอบทองคำ',         label_en: 'Golden Frame' },
  { id: 'lvl60',  level: 60,  type: 'gacha_frame', value: 'rainbow',   label_th: 'โปรไฟล์เคลื่อนไหว',  label_en: 'Animated Profile' },
  { id: 'lvl75',  level: 75,  type: 'title',       value: 'Elite',     label_th: 'ฉายา: Elite',       label_en: 'Title: Elite' },
  { id: 'lvl90',  level: 90,  type: 'gacha_frame', value: 'lvlaura',   label_th: 'ออร่าตำนาน',        label_en: 'Legend Aura' },
  { id: 'lvl100', level: 100, type: 'gacha_frame', value: 'lvllegend', label_th: 'กรอบตำนาน + ฉายา Legend + Hall of Fame', label_en: 'Legend Frame + Legend Title + Hall of Fame' },
];

const _EXP_SOURCE_ICON = {
  match_complete: '🏸', match_win: '🏸', match_lose: '🏸',
  tournament: '🏆', daily_login: '📅', daily_mission: '🎯',
  reward: '⭐', level_up: '🎉', prestige: '👑',
};
function _expSourceLabel(source) {
  if (source === 'match_complete') return t('exp_src_complete');
  if (source === 'match_win') return t('exp_src_win');
  if (source === 'match_lose') return t('exp_src_lose');
  if (source === 'daily_login') return t('exp_src_login');
  if (source === 'daily_mission') return t('exp_src_mission');
  if (source === 'tournament') return t('exp_src_tournament');
  if (source === 'level_up') return t('exp_src_levelup');
  if (source === 'prestige') return t('exp_src_prestige');
  return source;
}

function _levelUnclaimedRewards(player) {
  const claimed = player.rewardClaimed || [];
  return LEVEL_REWARDS.filter(r => player.level >= r.level && !claimed.includes(r.id));
}

// Counts completed tournaments where this player appears in the Hall of Fame
// champion_ids (see js/tournament.js dbCompleteTournament) — the only
// authoritative all-tier source; super1000Titles only covers Super 1000.
// Memoized for 60s per player so repeated profile renders don't re-fetch the
// whole completed-tournaments list (tournament completions are rare events).
let _tourWinsCache = { pid: null, at: 0, val: 0 };
async function _getTournamentWinsCount(playerId) {
  if (_tourWinsCache.pid === playerId && Date.now() - _tourWinsCache.at < 60000) return _tourWinsCache.val;
  try {
    const rows = typeof dbGetHOFTournaments === 'function' ? await dbGetHOFTournaments() : [];
    let count = 0;
    for (const t of rows) {
      let groups = [];
      try { groups = typeof t.groups === 'string' ? JSON.parse(t.groups) : (t.groups || []); } catch(e) {}
      const hof = Array.isArray(groups) ? groups.find(g => g && g._hof) : null;
      if (hof && Array.isArray(hof.champion_ids) && hof.champion_ids.includes(playerId)) count++;
    }
    _tourWinsCache = { pid: playerId, at: Date.now(), val: count };
    return count;
  } catch(e) { return 0; }
}

// ── Level History timeline: filter (today/week/month/all) + search + sort +
// load-more (offset pagination) + CSV export. Reads exp_logs via
// dbGetExpLogsPaged (js/db.js), which already indexes (player_id, created_at).
let _histState = { range: 'all', search: '', sortDesc: true, offset: 0, limit: 20, items: [], loading: false, hasMore: true };

function _histFromDateForRange(range) {
  const now = new Date();
  if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (range === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
  if (range === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d.toISOString(); }
  return null;
}

async function _loadHistoryPage(reset) {
  if (_histState.loading) return;
  _histState.loading = true;
  if (reset) { _histState.offset = 0; _histState.items = []; _histState.hasMore = true; }
  _renderHistoryList(true);
  const fromDate = _histFromDateForRange(_histState.range);
  const rows = await dbGetExpLogsPaged(_histState.offset, _histState.limit, fromDate);
  _histState.items = _histState.items.concat(rows);
  _histState.offset += rows.length;
  _histState.hasMore = rows.length === _histState.limit;
  _histState.loading = false;
  _renderHistoryList(false);
}

function setHistoryRange(range) {
  document.querySelectorAll('.lvl-hist-filter').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  _histState.range = range;
  _loadHistoryPage(true);
}
function setHistorySearch(term) { _histState.search = term || ''; _renderHistoryList(false); }
function toggleHistorySort() { _histState.sortDesc = !_histState.sortDesc; _renderHistoryList(false); }
function loadMoreHistory() { _loadHistoryPage(false); }

function exportHistory() {
  const rows = _histState.items;
  const csv = ['source,amount,level,total_exp,created_at']
    .concat(rows.map(r => [r.source, r.amount, r.level, r.total_exp, r.created_at].join(',')))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'level_history_' + (currentUser ? currentUser.name : 'export') + '.csv'; a.click();
  URL.revokeObjectURL(url);
}

function _renderHistoryList(loading) {
  const box = document.getElementById('lvlHistoryList');
  if (!box) return;
  if (loading && !_histState.items.length) {
    box.innerHTML = `<div class="hist-item" style="opacity:0.4">${t('loading')}</div>`.repeat(3);
    return;
  }
  let items = _histState.items.slice();
  if (_histState.search) {
    const q = _histState.search.toLowerCase();
    items = items.filter(r => _expSourceLabel(r.source).toLowerCase().includes(q) || String(r.source).toLowerCase().includes(q));
  }
  items.sort((a, b) => _histState.sortDesc ? new Date(b.created_at) - new Date(a.created_at) : new Date(a.created_at) - new Date(b.created_at));
  box.innerHTML = items.length ? items.map(l => `
    <div class="hist-item">
      <div class="hist-header">
        <span class="hist-result ${l.amount > 0 ? 'win' : ''}">${_EXP_SOURCE_ICON[l.source] || '⭐'} ${l.amount > 0 ? '+' + l.amount + ' EXP' : t('exp_src_levelup')}</span>
        <span class="hist-date">${new Date(l.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      <div class="hist-detail">${_expSourceLabel(l.source)} · Lv.${l.level}</div>
    </div>`).join('') : `<div class="text-muted" style="text-align:center;padding:10px;font-size:0.8rem">${t('no_match')}</div>`;
  const moreBtn = document.getElementById('lvlLoadMoreBtn');
  if (moreBtn) moreBtn.style.display = _histState.hasMore ? '' : 'none';
}

// Adds the cosmetic to the player's owned-inventory list (so it also shows up
// correctly in the Avatar Builder) then equips it via the existing gacha
// equip functions (js/gacha.js) — same mechanism gacha drops already use.
async function _grantAndEquipLevelCosmetic(type, value) {
  try {
    if (typeof getGachaInventory === 'function' && typeof _saveGachaInventoryToDB === 'function') {
      const inv = getGachaInventory(currentUser.id);
      const key = type === 'gacha_frame' ? 'frames' : type === 'gacha_name' ? 'names' : type === 'gacha_emoji' ? 'emojis' : null;
      if (key && !inv[key].includes(value)) {
        inv[key] = [...inv[key], value];
        localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(inv));
        await _saveGachaInventoryToDB(currentUser.id, inv);
      }
    }
    if (type === 'gacha_frame' && typeof equipGachaFrame === 'function') await equipGachaFrame(value);
    else if (type === 'gacha_name' && typeof equipGachaName === 'function') await equipGachaName(value);
    else if (type === 'gacha_emoji' && typeof equipGachaEmoji === 'function') await equipGachaEmoji(value);
  } catch(e) { console.warn('grantAndEquipLevelCosmetic failed:', e.message); }
}

async function claimLevelRewardUI(rewardId) {
  try {
    const res = await dbClaimLevelReward(rewardId);
    await _grantAndEquipLevelCosmetic(res.cosmetic_type, res.cosmetic_value);
    await loadPlayers();
    await renderProfile();
    toast('🎁 ' + (_lang === 'en' ? 'Reward claimed!' : 'รับรางวัลสำเร็จ!'), 'success');
  } catch(e) {
    toast('❌ ' + (e.message || 'claim failed'), 'error');
  }
}

// ── Prestige (self-serve at Lv100+; see rpc_prestige) ─────────────────────
async function promptPrestige() {
  const p = db.players.find(x => x.id === currentUser.id);
  if (!p || p.level < 100) return;
  const msg = _lang === 'en'
    ? `Prestige now? Your level resets to 1 and current-cycle EXP resets to 0.\nLifetime EXP, stats, achievements, history, and every claimed reward are kept.\nYou'll become Prestige ${p.prestige + 1}.`
    : `รับ Prestige ตอนนี้หรือไม่? เลเวลจะกลับเป็น 1 และ EXP รอบปัจจุบันจะรีเซ็ต\nEXP สะสมตลอดชีพ, สถิติ, ความสำเร็จ, ประวัติ และรางวัลที่รับแล้วจะไม่หาย\nคุณจะได้ Prestige ${p.prestige + 1}`;
  if (!confirm(msg)) return;
  try {
    const res = await dbPrestige();
    await loadPlayers();
    await renderProfile();
    showPrestigeCelebration(res.prestige);
  } catch(e) {
    toast('❌ ' + (e.message || 'prestige failed'), 'error');
  }
}

function showPrestigeCelebration(prestigeNum) {
  _ensureLevelUpModal();
  document.getElementById('lvlUpName').textContent = currentUser ? currentUser.name : '';
  document.getElementById('lvlUpLevel').innerHTML = `👑 Prestige ${prestigeNum}`;
  document.getElementById('lvlUpExpCounter').parentElement.style.display = 'none';
  document.getElementById('lvlUpRewardBox').innerHTML =
    `<div class="rank-badge" style="margin:3px;background:rgba(255,215,0,0.15);color:var(--gold);border:1px solid rgba(255,215,0,0.4)">👑 ${_lang === 'en' ? 'Prestige Badge Unlocked' : 'ปลดล็อกตรา Prestige'}</div>`;
  openModal('levelUpModal');
  _spawnCelebrationFx();
}

// ── Profile card injection ───────────────────────────────────────────────
const _origRenderProfileForLevels = renderProfile;
renderProfile = async function () {
  await _origRenderProfileForLevels();
  if (!currentUser || !document.getElementById('profileCard')) return;
  const p = db.players.find(x => x.id === currentUser.id);
  if (!p) return;

  const prog = expEngine.expProgress(p.totalExp || 0);
  const unclaimed = _levelUnclaimedRewards(p);
  const nextReward = LEVEL_REWARDS.find(r => r.level > p.level);
  const matches = (p.wins || 0) + (p.losses || 0);
  const winRate = matches > 0 ? Math.round((p.wins / matches) * 100) : 0;
  const curStreak = typeof getPlayerStreak === 'function' ? getPlayerStreak(p.id) : (p.consecutiveWins || 0);

  let box = document.getElementById('levelCard');
  if (!box) {
    box = document.createElement('div');
    box.id = 'levelCard';
    box.className = 'card';
    document.getElementById('profileCard').appendChild(box);
  }

  box.innerHTML = `
    <div class="card-title">⭐ ${t('level')}</div>
    <div class="flex-between" style="align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:6px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="rank-badge" style="background:rgba(0,245,160,0.12);color:var(--neon);border:1px solid rgba(0,245,160,0.3)">Lv.${p.level}</span>
        ${p.prestige > 0 ? `<span class="rank-badge" style="background:rgba(255,215,0,0.15);color:var(--gold);border:1px solid rgba(255,215,0,0.4);text-shadow:0 0 8px rgba(255,215,0,0.6)">👑 Prestige ${p.prestige}</span>` : ''}
      </div>
      <span style="font-size:0.78rem;color:var(--muted)">${prog.currentExp}/${prog.requiredExp} EXP (${prog.pct.toFixed(0)}%)</span>
    </div>
    <div class="progress-wrap" style="height:8px"><div class="progress-bar" id="lvlExpBar" style="width:0%;background:linear-gradient(90deg,var(--neon),var(--neon2))"></div></div>
    <div style="font-size:0.72rem;color:var(--muted);margin-top:6px">${t('total_exp')}: ${p.totalExp} · ${t('lifetime_exp')}: ${p.lifetimeExp}</div>
    ${nextReward ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${t('next_reward')}: Lv.${nextReward.level} — ${esc(_lang === 'en' ? nextReward.label_en : nextReward.label_th)}</div>` : ''}
    ${unclaimed.length ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${unclaimed.map(r => `<button class="btn btn-primary btn-sm" onclick="claimLevelRewardUI('${r.id}')">🎁 ${t('claim')}: ${esc(_lang === 'en' ? r.label_en : r.label_th)}</button>`).join('')}</div>` : ''}
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="if(typeof showSection==='function')showSection('levelrewards')">🏆 ${t('view_all_rewards')}</button>
      ${p.level >= 100 ? `<button class="btn btn-primary btn-sm" style="background:linear-gradient(90deg,var(--gold),#ffb300)" onclick="promptPrestige()">👑 ${t('prestige_btn')}</button>` : ''}
    </div>
    <div class="divider"></div>
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">📊 ${t('statistics')}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">
      <div class="pstat"><div class="pstat-num">${matches}</div><div class="pstat-label">${t('total_matches')}</div></div>
      <div class="pstat"><div class="pstat-num" style="color:var(--neon)">${p.wins || 0}</div><div class="pstat-label">${t('wins')}</div></div>
      <div class="pstat"><div class="pstat-num" style="color:var(--red)">${p.losses || 0}</div><div class="pstat-label">${t('losses')}</div></div>
      <div class="pstat"><div class="pstat-num" style="color:${winRate >= 50 ? 'var(--neon)' : 'var(--red)'}">${winRate}%</div><div class="pstat-label">${t('win_rate')}</div></div>
      <div class="pstat"><div class="pstat-num" style="color:var(--gold)" id="lvlTourWins">…</div><div class="pstat-label">${t('tournament_wins')}</div></div>
      <div class="pstat"><div class="pstat-num">${curStreak}</div><div class="pstat-label">${t('cur_streak')}</div></div>
      <div class="pstat"><div class="pstat-num" style="color:var(--gold)">${p.bestWinStreak || 0}</div><div class="pstat-label">${t('best_streak')}</div></div>
      <div class="pstat"><div class="pstat-num">${p.highestLevel || 1}</div><div class="pstat-label">${t('highest_level')}</div></div>
      <div class="pstat"><div class="pstat-num">${p.lifetimeExp || 0}</div><div class="pstat-label">${t('lifetime_exp')}</div></div>
    </div>
    <div class="divider"></div>
    <div class="flex-between" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted)">📜 ${t('exp_history')}</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:0.7rem" onclick="toggleHistorySort()">↕ ${t('sort')}</button>
        <button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:0.7rem" onclick="exportHistory()">⬇ ${t('export')}</button>
      </div>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
      ${['all', 'today', 'week', 'month'].map(r => `<button class="btn btn-ghost btn-sm lvl-hist-filter${r === 'all' ? ' active' : ''}" data-range="${r}" style="padding:3px 10px;font-size:0.7rem" onclick="setHistoryRange('${r}')">${t('filter_' + r)}</button>`).join('')}
    </div>
    <input type="text" placeholder="${t('search_history')}" class="inp" style="margin-bottom:8px;font-size:0.8rem;padding:6px 10px" oninput="setHistorySearch(this.value)">
    <div id="lvlHistoryList"></div>
    <button id="lvlLoadMoreBtn" class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px;display:none" onclick="loadMoreHistory()">${t('load_more')}</button>
  `;
  requestAnimationFrame(() => {
    const bar = document.getElementById('lvlExpBar');
    if (bar) bar.style.width = prog.pct + '%';
  });
  _loadHistoryPage(true);
  // Tournament-wins tile fills asynchronously so the card paints instantly
  // instead of blocking on the completed-tournaments fetch (memoized above).
  _getTournamentWinsCount(p.id).then(n => {
    const el = document.getElementById('lvlTourWins');
    if (el) el.textContent = n;
  }).catch(() => {});
};

// ── Level-up popup (lightweight modal + counter; no particle engine in V1) ─
let _lvlQueue = [];
let _lvlShowing = false;

function _ensureLevelUpModal() {
  if (document.getElementById('levelUpModal')) return;
  const div = document.createElement('div');
  div.id = 'levelUpModal';
  div.className = 'modal-bg hidden';
  div.onclick = () => closeLevelUpModal();
  div.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="text-align:center">
      <div class="modal-title">🎉 ${_lang === 'en' ? 'Level Up!' : 'เลเวลอัป!'}</div>
      <div class="lvl-up-star" style="font-size:2.4rem;margin:6px 0">⭐</div>
      <div style="font-size:1rem;color:var(--muted)" id="lvlUpName"></div>
      <div style="font-size:2rem;font-weight:800;color:var(--neon);margin:8px 0;text-shadow:0 0 20px var(--neon)" id="lvlUpLevel"></div>
      <div style="font-size:0.85rem;color:var(--muted)">+<span id="lvlUpExpCounter">0</span> EXP</div>
      <div id="lvlUpRewardBox" style="margin-top:12px"></div>
      <div class="modal-footer" style="justify-content:center">
        <button class="btn btn-primary btn-sm" onclick="closeLevelUpModal()">OK</button>
      </div>
    </div>`;
  document.body.appendChild(div);
}

function closeLevelUpModal() {
  closeModal('levelUpModal');
  _lvlShowing = false;
  setTimeout(_processLvlQueue, 300);
}

function queueLevelUp(playerName, info, expGained) {
  _lvlQueue.push({ playerName, info, expGained });
  _processLvlQueue();
}

function _processLvlQueue() {
  if (_lvlShowing || !_lvlQueue.length) return;
  _lvlShowing = true;
  const { playerName, info, expGained } = _lvlQueue.shift();
  _ensureLevelUpModal();
  document.getElementById('lvlUpName').textContent = playerName || '';
  document.getElementById('lvlUpLevel').textContent = 'Lv.' + info.new_level;
  document.getElementById('lvlUpExpCounter').parentElement.style.display = '';
  const rewards = LEVEL_REWARDS.filter(r => r.level > info.old_level && r.level <= info.new_level);
  document.getElementById('lvlUpRewardBox').innerHTML = rewards.length
    ? rewards.map(r => `<div class="rank-badge" style="margin:3px;background:rgba(255,215,0,0.12);color:var(--gold);border:1px solid rgba(255,215,0,0.3)">🎁 ${esc(_lang === 'en' ? r.label_en : r.label_th)}</div>`).join('')
    : '';
  openModal('levelUpModal');
  lbCountUp('lvlUpExpCounter', expGained, 700);
  _spawnCelebrationFx();
}

// Lightweight DOM-particle celebration (no canvas engine) for level-up and
// prestige. Skipped entirely in lite mode to match the app's perf convention
// (see styles.css [perf] blocks — gacha frames drop particles the same way).
function _spawnCelebrationFx() {
  if (document.documentElement.getAttribute('data-style') === 'lite') return;
  const modal = document.querySelector('#levelUpModal .modal');
  if (!modal) return;
  modal.querySelectorAll('.lvl-confetti').forEach(el => el.remove());
  const colors = ['#00f5a0', '#00d9f5', '#ffd700', '#ff4757', '#ba68c8'];
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = 'lvl-confetti';
    el.style.setProperty('--tx', (Math.random() * 200 - 100) + 'px');
    el.style.setProperty('--ty', (Math.random() * -140 - 40) + 'px');
    el.style.setProperty('--dur', (0.8 + Math.random() * 0.7) + 's');
    el.style.background = colors[i % colors.length];
    el.style.left = (40 + Math.random() * 20) + '%';
    modal.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

// Groups the raw RPC results by player (each player gets at most a
// 'complete' entry plus one of 'win'/'lose') into a per-player summary:
// total EXP gained this match and whether they leveled up.
const _EXP_SOURCE_AMOUNT = { complete: 30, win: 100, lose: 50 };
function _summarizeExpResults(results) {
  const byPlayer = {};
  for (const r of results) {
    if (!byPlayer[r.player_id]) byPlayer[r.player_id] = { firstOld: r.result.old_level, amount: 0, last: r.result };
    byPlayer[r.player_id].amount += (_EXP_SOURCE_AMOUNT[r.source] || 0);
    byPlayer[r.player_id].last = r.result;
  }
  return Object.entries(byPlayer).map(([pid, v]) => ({
    playerId: Number(pid),
    amount: v.amount,
    leveled: v.last.new_level > v.firstOld,
    info: { old_level: v.firstOld, new_level: v.last.new_level },
  }));
}

// Called by the EXP-award hooks in index.html right after dbAwardMatchExp().
function handleMatchExpResult(expRes) {
  if (!expRes || !expRes.results) return;
  _summarizeExpResults(expRes.results)
    .filter(s => s.leveled)
    .forEach(s => {
      const pl = db.players.find(p => p.id === s.playerId);
      queueLevelUp(pl ? pl.name : '', s.info, s.amount);
    });
}
