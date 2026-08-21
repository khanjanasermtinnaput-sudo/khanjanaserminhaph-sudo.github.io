// ============================================================
// ===== FEATURE: SEASON RESET =====
// ============================================================
const SEASON_RESET_PTS = {
  king: 1000, master: 800, diamond: 500, platinum: 300, gold: 200,
  silver: null, bronze: null  // null = ไม่โดนรี
};

function getSeasonResetPts(rankId) { return SEASON_RESET_PTS[rankId] ?? null; }

function getDaysUntilReset() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const diff = next - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ── PRIME SS SEASON TITLE HELPERS ──────────────────────────────
function getPrimeSSeasonLabel(year, month) {
  // May 2026 = SS1 (feature launch month)
  const diff = (year - 2026) * 12 + (month - 4);
  return 'SS' + Math.max(1, diff + 1);
}
function getAwardedSSLabel() {
  // At reset time, award label for the season that just ended (= previous month)
  const now = new Date();
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  return getPrimeSSeasonLabel(y, m);
}
function renderPrimeSSTitles(player) {
  const titles = (player && Array.isArray(player.primeTitles)) ? player.primeTitles : [];
  if (!titles.length) return '';
  const badges = titles.map(ss => `
    <div class="prime-ss-wrap">
      <div class="prime-ss-badge">
        <div class="prime-star"></div><div class="prime-star"></div>
        <div class="prime-star"></div><div class="prime-star"></div>
        <div class="prime-star"></div><div class="prime-star"></div>
        <span class="prime-ss-crown">👑</span>
        <span class="prime-ss-text">Prime ${ss}</span>
      </div>
    </div>`).join('');
  return `<div class="prime-ss-section">
    <div class="prime-ss-label">🏅 Season Titles</div>
    <div class="prime-ss-list">${badges}</div>
  </div>`;
}

// ── CUSTOM ACHIEVEMENT SYSTEM ──────────────────────────────────
const CACH_KEY = 'badminton_cach_catalog';
const CACH_KEY_BAK = 'badminton_cach_catalog_bak';
const CACH_DELETED_KEY = 'bmt_cach_deleted';
function _getCachDeleted() { try { return new Set(JSON.parse(localStorage.getItem(CACH_DELETED_KEY)||'[]')); } catch(e) { return new Set(); } }
function _addCachDeleted(id) { const s = _getCachDeleted(); s.add(id); localStorage.setItem(CACH_DELETED_KEY, JSON.stringify([...s])); }

function getCachCatalog() {
  const out = [];
  const seen = new Set();
  const add = (item) => { if (item && item.id && !seen.has(item.id)) { out.push(item); seen.add(item.id); } };
  // 1. Supabase shared catalog — รวมจาก _catalogShared ของแอดมิน "ทุกคน"
  if (typeof db !== 'undefined' && db.players && db.players.length) {
    for (const p of [...db.players].sort((a,b)=>a.id-b.id)) {
      if (p._catalogShared && Array.isArray(p._catalogShared)) {
        for (const item of p._catalogShared) add(item);
      }
    }
  }
  // 2. Primary localStorage key
  try { for (const item of JSON.parse(localStorage.getItem(CACH_KEY)||'[]')) add(item); } catch(e) {}
  // 3. Backup localStorage key
  try { for (const item of JSON.parse(localStorage.getItem(CACH_KEY_BAK)||'[]')) add(item); } catch(e) {}
  // 4. Last-resort reconstruct from player awards — skip explicitly deleted IDs
  if (typeof db !== 'undefined' && db.players) {
    const _deleted = _getCachDeleted();
    for (const p of db.players) {
      for (const a of (p.customAch||[])) {
        if (a && a.id && !a.id.startsWith('sys_') && !_deleted.has(a.id))
          add({ id:a.id, icon:a.icon||'🏆', title:a.title||'', desc:a.desc||'', frame:a.frame||'gold' });
      }
    }
  }
  return out;
}

// [FIXED] saveCachCatalog — writes to both localStorage keys, logs errors visibly
async function saveCachCatalog(c) {
  const json = JSON.stringify(c);
  localStorage.setItem(CACH_KEY, json);
  localStorage.setItem(CACH_KEY_BAK, json); // [NEW] dual-write for resilience
  // Sync to Supabase via lowest-ID admin (or lowest-ID player) prime_titles
  if (typeof db === 'undefined' || !db.players || !db.players.length) return;
  const admins = db.players.filter(p => p.isAdmin === 1);
  const holder = [...(admins.length ? admins : db.players)].sort((a,b) => a.id - b.id)[0];
  if (!holder) return;
  try {
    holder._catalogShared = c;
    const ptStr = buildPlayerPrimeTitles(holder, { catalog: c });
    await dbUpdatePlayer(holder.id, { prime_titles: ptStr });
    // รวมศูนย์: ล้าง catalog ออกจากแอดมินคนอื่นที่เคยถือไว้ ให้เหลือแหล่งเดียว (holder)
    // ป้องกัน catalog ซ้ำ/ลบไม่ออกข้ามแอดมิน
    for (const p of db.players) {
      if (p.id !== holder.id && p._catalogShared && p._catalogShared.length) {
        p._catalogShared = [];
        try { await dbUpdatePlayer(p.id, { prime_titles: buildPlayerPrimeTitles(p, { catalog: [] }) }); } catch(e) {}
      }
    }
  } catch(e) {
    // [FIXED] Log warning instead of silent fail — helps debugging
    console.warn('[Achievement] Supabase sync failed (prime_titles column may be missing):', e.message);
  }
}

const CACH_FRAME_COLOR = { gold:'#ffd700', silver:'#c8c8c8', bronze:'#cd7f32' };
const CACH_FRAME_LABEL = { gold:'🥇 ทอง', silver:'🥈 เงิน', bronze:'🥉 ทองแดง' };

async function toggleTourAchAward(achId, playerId, give) {
  const player = db.players.find(p => p.id === playerId);
  if (!player) return;
  const achDef = typeof TOUR_ACH_DEFS !== 'undefined'
    ? Object.values(TOUR_ACH_DEFS).find(a => a.id === achId) : null;
  if (!achDef && give) { toast('ไม่พบ Achievement นี้', 'error'); return; }
  let cur = [...(player.customAch || [])];
  if (give) {
    if (!cur.some(a => a.id === achId))
      cur.push({ id: achDef.id, icon: achDef.icon, title: achDef.title, desc: achDef.desc, frame: achDef.frame });
  } else {
    cur = cur.filter(a => a.id !== achId);
  }
  saveCachAwardLS(playerId, cur);
  player.customAch = cur;
  try {
    await dbUpdatePlayer(playerId, { prime_titles: buildPlayerPrimeTitles(player, { awards: cur }) });
  } catch(e) {
    try { await dbUpdatePlayer(playerId, { custom_ach: JSON.stringify(cur) }); } catch(e2) {}
  }
  toast(give ? `✅ มอบ "${achDef?.title || achId}" ให้ ${player.name} แล้ว` : `❌ ยกเลิก Achievement ของ ${player.name}`, 'success');
  await loadPlayers();
  if (currentUser) currentUser = db.players.find(p => p.id === currentUser.id) || currentUser;
  renderCachAdmin();
}

function buildTourAchItemHTML(achDef, players) {
  const col = CACH_FRAME_COLOR[achDef.frame] || '#ffd700';
  const awardedIds = new Set(players.filter(p => (p.customAch||[]).some(a => a.id === achDef.id)).map(p => p.id));
  const playerChecks = players.map(p => {
    const has = awardedIds.has(p.id);
    return `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.78rem;padding:5px 9px;border-radius:8px;border:1px solid ${has?col:'var(--glass-border)'};background:${has?`rgba(${achDef.frame==='gold'?'255,215,0':achDef.frame==='silver'?'192,192,192':'205,127,50'},0.08)`:'var(--btn-glass)'};transition:all .15s">
      <input type="checkbox" ${has?'checked':''} onchange="toggleTourAchAward('${achDef.id}',${p.id},this.checked)" style="accent-color:${col}">
      <span>${getAvatar(p.id,p.name).content}</span> ${esc(p.name)}
    </label>`;
  }).join('');
  return `<div style="border:1px solid ${col}30;border-radius:12px;padding:12px;margin-bottom:10px;background:${col}06">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div class="cach-badge cach-frame-${achDef.frame}" style="pointer-events:none;flex-shrink:0">
        <span class="cach-icon">${esc(achDef.icon)}</span><span class="cach-text">${esc(achDef.title)}</span>
      </div>
      <div style="flex:1;min-width:0;font-size:0.73rem;color:var(--muted)">${esc(achDef.desc)}</div>
    </div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:7px">มอบให้ผู้เล่น (${awardedIds.size > 0 ? awardedIds.size + ' คนได้รับแล้ว' : 'ยังไม่ได้มอบ'}):</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${playerChecks}</div>
  </div>`;
}

function renderCachAdmin() {
  const body = document.getElementById('cachAdminBody');
  if (!body) return;
  const catalog = getCachCatalog();
  const players = [...db.players].sort((a,b) => b.pts - a.pts);
  const frameOpts = ['gold','silver','bronze'].map(f =>
    `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.82rem;padding:5px 10px;border-radius:8px;border:1px solid var(--glass-border);background:var(--btn-glass)">
      <input type="radio" name="cachFrame" value="${f}" ${f==='gold'?'checked':''}> <span style="color:${CACH_FRAME_COLOR[f]};font-weight:700">${CACH_FRAME_LABEL[f]}</span>
    </label>`).join('');

  // Tournament achievements section
  const tourAchHTML = (typeof TOUR_ACH_DEFS !== 'undefined')
    ? Object.values(TOUR_ACH_DEFS).map(a => buildTourAchItemHTML(a, players)).join('')
    : '<div class="text-muted" style="font-size:0.8rem;padding:8px">โหลด tournament module ไม่สำเร็จ</div>';

  body.innerHTML = `
    <div style="font-size:0.78rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--gold);margin-bottom:10px;padding:8px 12px;background:rgba(255,215,0,0.06);border-radius:8px;border-left:3px solid var(--gold)">🏆 Tournament Achievements — มอบ/ยกเลิกได้ทันที</div>
    ${tourAchHTML}
    <div style="border-top:1px solid var(--glass-border);margin:18px 0 14px"></div>
    <div style="font-size:0.78rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--neon);margin-bottom:12px;padding:8px 12px;background:rgba(0,245,160,0.06);border-radius:8px;border-left:3px solid var(--neon)">🎖️ Custom Achievements — สร้างรางวัลเอง</div>
    <div style="display:grid;grid-template-columns:80px 1fr;gap:8px;margin-bottom:8px">
      <div class="form-group" style="margin:0"><label style="font-size:0.7rem;color:var(--muted)">Icon</label>
        <input class="inp" id="cachIconInp" placeholder="🏆" maxlength="6" style="font-size:1.5rem;text-align:center;padding:8px 4px"></div>
      <div class="form-group" style="margin:0"><label style="font-size:0.7rem;color:var(--muted)">ชื่อ Achievement</label>
        <input class="inp" id="cachTitleInp" placeholder="ชื่อรางวัล..."></div>
    </div>
    <div class="form-group" style="margin-bottom:10px"><label style="font-size:0.7rem;color:var(--muted)">คำอธิบาย (ไม่บังคับ)</label>
      <input class="inp" id="cachDescInp" placeholder="รายละเอียด..."></div>
    <div style="margin-bottom:12px">
      <div style="font-size:0.7rem;color:var(--muted);margin-bottom:6px">กรอบ</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">${frameOpts}</div>
    </div>
    <button class="btn btn-primary btn-sm" onclick="createCachDef()" style="margin-bottom:18px">➕ สร้าง Achievement</button>
    ${catalog.length ? `
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--muted);margin-bottom:10px">Achievements ที่สร้างไว้</div>
      ${catalog.map(a => buildCachItemHTML(a, players)).join('')}
    ` : '<div class="text-muted" style="text-align:center;padding:10px;font-size:0.8rem">ยังไม่มี Achievement · กรอกด้านบนแล้วกดสร้าง</div>'}`;
}

function buildCachItemHTML(ach, players) {
  const col = CACH_FRAME_COLOR[ach.frame] || '#ffd700';
  const awardedIds = new Set(players.filter(p => (p.customAch||[]).some(a=>a.id===ach.id)).map(p=>p.id));
  const playerChecks = players.map(p => `
    <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.78rem;padding:5px 9px;border-radius:8px;border:1px solid ${awardedIds.has(p.id)?col:'var(--glass-border)'};background:${awardedIds.has(p.id)?`rgba(${ach.frame==='gold'?'255,215,0':ach.frame==='silver'?'192,192,192':'205,127,50'},0.08)`:'var(--btn-glass)'};transition:all .15s">
      <input type="checkbox" ${awardedIds.has(p.id)?'checked':''} onchange="toggleCachAward('${ach.id}',${p.id},this.checked)" style="accent-color:${col}">
      <span>${getAvatar(p.id,p.name).content}</span> ${esc(p.name)}
    </label>`).join('');
  return `<div style="border:1px solid ${col}30;border-radius:12px;padding:12px;margin-bottom:10px;background:${col}06">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div class="cach-badge cach-frame-${ach.frame}" style="pointer-events:none;flex-shrink:0">
        <span class="cach-icon">${esc(ach.icon)}</span><span class="cach-text">${esc(ach.title)}</span>
      </div>
      <div style="flex:1;min-width:0;font-size:0.73rem;color:var(--muted)">${esc(ach.desc||'ไม่มีคำอธิบาย')}</div>
      <button class="btn btn-ghost btn-sm" style="color:var(--red);padding:4px 8px" onclick="deleteCachDef('${ach.id}')">🗑️</button>
    </div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:7px">มอบให้ผู้เล่น (${awardedIds.size > 0 ? awardedIds.size + ' คนได้รับแล้ว' : 'ยังไม่ได้มอบ'}):</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${playerChecks}</div>
  </div>`;
}

function createCachDef() {
  const icon = (document.getElementById('cachIconInp')?.value.trim()||'🏆');
  const title = document.getElementById('cachTitleInp')?.value.trim();
  const desc = document.getElementById('cachDescInp')?.value.trim()||'';
  const frame = document.querySelector('input[name="cachFrame"]:checked')?.value||'gold';
  if (!title) { toast('กรุณาใส่ชื่อ Achievement', 'error'); return; }
  const catalog = getCachCatalog();
  catalog.push({ id:'cach_'+Date.now(), icon, title, desc, frame });
  saveCachCatalog(catalog);
  document.getElementById('cachIconInp').value='';
  document.getElementById('cachTitleInp').value='';
  document.getElementById('cachDescInp').value='';
  renderCachAdmin();
  toast(`🎖️ สร้าง "${title}" แล้ว!`, 'success');
}

async function deleteCachDef(achId) {
  // Track deletion so getCachCatalog source #4 won't reconstruct it from player awards
  _addCachDeleted(achId);
  // 1. ลบออกจาก catalog (localStorage + Supabase)
  await saveCachCatalog(getCachCatalog().filter(a => a.id !== achId));
  // 2. ลบออกจาก customAch ของผู้เล่นทุกคน — อัปเดตทั้ง prime_titles และ custom_ach column
  const affected = db.players.filter(p => (p.customAch||[]).some(a => a.id === achId));
  await Promise.all(affected.map(async player => {
    const cur = (player.customAch||[]).filter(a => a.id !== achId);
    saveCachAwardLS(player.id, cur);
    player.customAch = cur;
    try {
      await dbUpdatePlayer(player.id, {
        prime_titles: buildPlayerPrimeTitles(player, { awards: cur }),
        custom_ach: JSON.stringify(cur)
      });
    } catch(e) {
      try { await dbUpdatePlayer(player.id, { custom_ach: JSON.stringify(cur) }); } catch(e2) {}
    }
  }));
  renderCachAdmin();
  toast('ลบ Achievement แล้ว' + (affected.length ? ` (ลบออกจาก ${affected.length} ผู้เล่นด้วย)` : ''), 'info');
}

const CACH_AWARDS_LS = 'badminton_cach_awards';
function getCachAwardsLS() { try { return JSON.parse(localStorage.getItem(CACH_AWARDS_LS)||'{}'); } catch(e) { return {}; } }
function saveCachAwardLS(playerId, cur) { const all = getCachAwardsLS(); all[playerId] = cur; localStorage.setItem(CACH_AWARDS_LS, JSON.stringify(all)); }

// Migrate localStorage awards + catalog up to Supabase (one-time per session)
async function migrateCachToSupabase() {
  if (sessionStorage.getItem('cach_migrated')) return;
  sessionStorage.setItem('cach_migrated', '1');
  // 1. Award migration: push localStorage per-player awards into prime_titles
  const ls = getCachAwardsLS();
  for (const [pid, awards] of Object.entries(ls)) {
    if (!awards || !awards.length) continue;
    const pl = db.players.find(p => p.id === Number(pid));
    if (!pl) continue;
    // Skip only if Supabase already has a __cach: entry for this player
    // (we detect this via _catalogShared NOT mattering — but customAch came from somewhere)
    // We re-write to be safe and idempotent.
    try {
      pl.customAch = awards;
      const ptStr = buildPlayerPrimeTitles(pl, { awards });
      await dbUpdatePlayer(Number(pid), { prime_titles: ptStr });
    } catch(e) { /* silent */ }
  }
  // 2. Catalog migration: merge local + shared + reconstructed; push up if local adds anything new
  try {
    const sharedHolder = [...db.players].sort((a,b)=>a.id-b.id).find(p => p._catalogShared && Array.isArray(p._catalogShared) && p._catalogShared.length);
    const sharedCount = sharedHolder ? sharedHolder._catalogShared.length : 0;
    const merged = getCachCatalog();
    if (merged.length > sharedCount) {
      await saveCachCatalog(merged);
      // Re-render admin if visible so the catalog list updates
      const adminVisible = document.getElementById('adminSection') && document.getElementById('adminSection').classList.contains('active');
      if (adminVisible) renderCachAdmin();
    }
  } catch(e) { /* silent */ }
}

async function toggleCachAward(achId, playerId, give) {
  const player = db.players.find(p=>p.id===playerId);
  if (!player) return;
  const achDef = getCachCatalog().find(a=>a.id===achId);
  if (!achDef && give) { toast('ไม่พบ Achievement นี้', 'error'); return; }
  let cur = [...(player.customAch||[])];
  if (give) {
    if (!cur.some(a=>a.id===achId)) cur.push({id:achDef.id,icon:achDef.icon,title:achDef.title,desc:achDef.desc,frame:achDef.frame});
  } else {
    cur = cur.filter(a=>a.id!==achId);
  }
  // Save to localStorage (instant local update)
  saveCachAwardLS(playerId, cur);
  player.customAch = cur;
  // Save to Supabase via prime_titles column (preserves catalog if this is holder)
  try {
    const ptStr = buildPlayerPrimeTitles(player, { awards: cur });
    await dbUpdatePlayer(playerId, { prime_titles: ptStr });
  } catch(e) {
    try { await dbUpdatePlayer(playerId, { custom_ach: JSON.stringify(cur) }); } catch(e2) {}
    toast('⚠️ sync บางส่วนอาจไม่ครบ', 'info');
  }
  toast(give ? `✅ มอบ "${achDef?.title}" ให้ ${player.name} แล้ว` : `❌ ยกเลิก Achievement ของ ${player.name}`, 'success');
  await loadPlayers();
  if (currentUser) currentUser = db.players.find(p => p.id === currentUser.id) || currentUser;
  renderCachAdmin();
}

function renderSeasonBanner() {
  const days = getDaysUntilReset();
  const banner = document.getElementById('seasonBanner');
  const daysEl = document.getElementById('seasonDaysLeft');
  const nextEl = document.getElementById('seasonNextReset');
  if (!banner) return;
  banner.style.display = 'flex';
  daysEl.textContent = days <= 3 ? `${days} ${t('days_left')}!` : `${days} ${t('days_left')}`;
  daysEl.style.background = days <= 3 ? 'linear-gradient(135deg,#ff4757,#ff0000)' : 'linear-gradient(135deg,#ffd700,#ff8c00)';
  nextEl.textContent = `King→1000 · Master→800 · Diamond→500 · Platinum→300 · Gold→200 · Silver/Bronze ${t('no_reset')}`;

  // Season reset is driven by pg_cron on the server (CRIT-04).
  // Client polls the season_resets table to detect when a new reset has occurred.
  _checkServerSeasonReset();
}

async function _checkServerSeasonReset() {
  try {
    const latestReset = typeof dbGetLatestSeasonReset === 'function' ? await dbGetLatestSeasonReset() : null;
    if (!latestReset) return;
    const lastSeen = localStorage.getItem('badminton_season_reset_seen');
    if (lastSeen === latestReset) return;
    localStorage.setItem('badminton_season_reset_seen', latestReset);
    await performSeasonReset();
  } catch(e) { /* ignore */ }
}

// The actual pts-floor reset + King Prime-SS-title grant now runs server-side
// (rpc_apply_season_reset), atomically and race-proof: whichever session calls it
// first for a given season label wins, every other call is a no-op. This also
// fixes the reset silently failing for non-admin sessions under the players RLS
// lockdown (pts/prime_titles writes to OTHER players require admin or the RPC).
async function performSeasonReset() {
  try {
    const result = typeof dbApplySeasonReset === 'function' ? await dbApplySeasonReset() : null;
    if (!result || result.already_done) return;

    let kingTitle = '';
    if (result.king_id) {
      // Best-effort cosmetic polish only (Defended badge + Hall of Fame) — the
      // core title grant already happened server-side, so failures here are safe to ignore.
      try {
        await loadPlayers();
        const king = db.players.find(p => p.id === result.king_id);
        if (king) {
          const ssLabel = result.ss_label;
          const titles = [...(king.primeTitles || [])];
          const oneMonthAgo = new Date(); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
          const prevY = oneMonthAgo.getMonth() === 0 ? oneMonthAgo.getFullYear() - 1 : oneMonthAgo.getFullYear();
          const prevM = oneMonthAgo.getMonth() === 0 ? 11 : oneMonthAgo.getMonth() - 1;
          const prevSS = getPrimeSSeasonLabel(prevY, prevM);
          const defended = titles.includes(prevSS);
          if (defended && !titles.includes('🛡️ Season Defender')) {
            titles.push('🛡️ Season Defender');
            await dbUpdatePlayer(king.id, { prime_titles: buildPlayerPrimeTitles({...king, primeTitles: titles}) });
            kingTitle += ' 🛡️ Defended!';
          }
          kingTitle = ` · 👑 ${king.name} ได้รับ Prime ${ssLabel}!` + kingTitle;
          const hof = getHoF();
          if (!hof.find(e => e.season === ssLabel)) {
            hof.unshift({ id: king.id, name: king.name, season: ssLabel, pts: king.pts, defended });
            await saveHoF(hof);
          }
        }
      } catch(e) {}
    }

    await loadAll();
    toast(`🏆 Season Reset!${result.reset_count > 0 ? ` ${result.reset_count} คนถูกรีคะแนน` : ''}${kingTitle}`, 'success');
  } catch(e) { console.error('Season reset error:', e); }
}

