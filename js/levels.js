// ── Level / EXP UI (V1 — Profile card, level-up modal, reward claim) ──────
// Server/DB half lives in supabase_level_system.sql + js/exp-engine.js.
// This file only renders state and calls the RPC wrappers in js/db.js —
// it never computes or trusts a client-side EXP amount.

// V1 reward map — MUST match the CASE in rpc_claim_level_reward exactly.
// Reuses existing item_catalog cosmetics (no new art in V1).
const LEVEL_REWARDS = [
  { id: 'lvl5',  level: 5,  type: 'gacha_emoji', value: '🏸',   label_th: 'ตรา Beginner',   label_en: 'Beginner Badge' },
  { id: 'lvl10', level: 10, type: 'gacha_frame', value: 'ice',   label_th: 'กรอบโปรไฟล์',    label_en: 'Profile Frame' },
  { id: 'lvl25', level: 25, type: 'gacha_name',  value: 'blaze', label_th: 'สีชื่อพิเศษ',     label_en: 'Name Color' },
  { id: 'lvl50', level: 50, type: 'gacha_frame', value: 'halo',  label_th: 'กรอบระดับสูง',    label_en: 'Higher-Tier Frame' },
];

function _expSourceLabel(source) {
  if (source === 'match_complete') return t('exp_src_complete');
  if (source === 'match_win') return t('exp_src_win');
  if (source === 'match_lose') return t('exp_src_lose');
  return source;
}

function _levelUnclaimedRewards(player) {
  const claimed = player.rewardClaimed || [];
  return LEVEL_REWARDS.filter(r => player.level >= r.level && !claimed.includes(r.id));
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
  const logs = await dbGetExpLogs(5);

  let box = document.getElementById('levelCard');
  if (!box) {
    box = document.createElement('div');
    box.id = 'levelCard';
    box.className = 'card';
    document.getElementById('profileCard').appendChild(box);
  }

  box.innerHTML = `
    <div class="card-title">⭐ ${t('level')}</div>
    <div class="flex-between" style="align-items:center;margin-bottom:4px">
      <span class="rank-badge" style="background:rgba(0,245,160,0.12);color:var(--neon);border:1px solid rgba(0,245,160,0.3)">Lv.${p.level}</span>
      <span style="font-size:0.78rem;color:var(--muted)">${prog.currentExp}/${prog.requiredExp} EXP (${prog.pct.toFixed(0)}%)</span>
    </div>
    <div class="progress-wrap" style="height:8px"><div class="progress-bar" id="lvlExpBar" style="width:0%;background:linear-gradient(90deg,var(--neon),var(--neon2))"></div></div>
    <div style="font-size:0.72rem;color:var(--muted);margin-top:6px">${t('total_exp')}: ${p.totalExp}</div>
    ${nextReward ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${t('next_reward')}: Lv.${nextReward.level} — ${esc(_lang === 'en' ? nextReward.label_en : nextReward.label_th)}</div>` : ''}
    ${unclaimed.length ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${unclaimed.map(r => `<button class="btn btn-primary btn-sm" onclick="claimLevelRewardUI('${r.id}')">🎁 ${t('claim')}: ${esc(_lang === 'en' ? r.label_en : r.label_th)}</button>`).join('')}</div>` : ''}
    <div class="divider"></div>
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">📜 ${t('exp_history')}</div>
    ${logs.length ? logs.map(l => `<div class="hist-item"><div class="hist-header"><span class="hist-result win">+${l.amount} EXP</span><span class="hist-date">${new Date(l.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span></div><div class="hist-detail">${_expSourceLabel(l.source)} · Lv.${l.level}</div></div>`).join('') : `<div class="text-muted" style="text-align:center;padding:10px;font-size:0.8rem">${t('no_match')}</div>`}
  `;
  requestAnimationFrame(() => {
    const bar = document.getElementById('lvlExpBar');
    if (bar) bar.style.width = prog.pct + '%';
  });
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
      <div style="font-size:2.4rem;margin:6px 0">⭐</div>
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
  const rewards = LEVEL_REWARDS.filter(r => r.level > info.old_level && r.level <= info.new_level);
  document.getElementById('lvlUpRewardBox').innerHTML = rewards.length
    ? rewards.map(r => `<div class="rank-badge" style="margin:3px;background:rgba(255,215,0,0.12);color:var(--gold);border:1px solid rgba(255,215,0,0.3)">🎁 ${esc(_lang === 'en' ? r.label_en : r.label_th)}</div>`).join('')
    : '';
  openModal('levelUpModal');
  lbCountUp('lvlUpExpCounter', expGained, 700);
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
