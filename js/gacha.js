// ── COIN SYSTEM ────────────────────────────────────────
// Never throws. Returns true when the DB write succeeded — callers use the
// return value to fall back to the localStorage coin shadow when it didn't.
async function dbAddCoins(playerId, amount) {
  try {
    const pl = db.players.find(x => x.id === playerId);
    if (!pl) return false;
    const newCoins = Math.max(0, (pl.coins || 0) + amount);
    await dbUpdatePlayer(playerId, { coins: newCoins });
    pl.coins = newCoins;
    return true;
  } catch(e) { console.warn('dbAddCoins failed:', e.message); return false; }
}

async function awardMatchCoins(allPlayerIds) {
  for (const pid of allPlayerIds) {
    try { await dbAddCoins(pid, 2); } catch(e) {}
  }
}

// ── 3. GACHA PULL SYSTEM ──────────────────────────────────
const GACHA_EMOJIS = ['🏸','🔥','⚡','🌟','💥','🎯','🦅','🌊','🎪','⚔️','🛡️','🎮'];

// ── Gacha Inventory: แสดง/เปลี่ยน Frame/Name ที่มีในคลัง ──
function getGachaInventory(userId) {
  // Merge localStorage + DB inventory so items persist across devices
  let ls = {};
  try { ls = JSON.parse(localStorage.getItem('bmt_gacha_inv_' + userId) || '{}'); } catch(e) {}
  const pl = db.players.find(x => x.id === userId);
  const dbInv = pl ? (pl._dbGachaInv || {}) : {};
  const frames  = [...new Set([...(ls.frames||[]),  ...(dbInv.frames||[])])];
  const names   = [...new Set([...(ls.names||[]),   ...(dbInv.names||[])])];
  const emojis  = [...new Set([...(ls.emojis||[]),  ...(dbInv.emojis||[])])];
  const effects = [...new Set([...(ls.effects||[]), ...(dbInv.effects||[])])];
  return { frames, names, emojis, effects };
}

async function _saveGachaInventoryToDB(userId, inv) {
  try {
    const pl = db.players.find(x => x.id === userId);
    // Merge with existing _dbGachaInv so fields from different subsystems don't overwrite each other
    const existing = (pl && pl._dbGachaInv) ? Object.assign({}, pl._dbGachaInv) : {};
    const merged = Object.assign(existing, inv);
    await dbUpdatePlayer(userId, { gacha_inventory: JSON.stringify(merged) });
    if (pl) pl._dbGachaInv = merged;
  } catch(e) { /* localStorage already saved */ }
}
function renderGachaInventory() {
  const el = document.getElementById('gachaInventoryBox');
  if (!el || !currentUser) return;
  const inv = getGachaInventory(currentUser.id);
  const pl = db.players.find(x => x.id === currentUser.id) || {};
  const curFrame = pl.gachaFrame || null;
  const curName  = pl.gachaName  || null;
  const frameLabels = { void:'🌑 Void Abyss', halo:'✨ Celestial Halo', blaze:'🔥 Crimson Blaze', ice:'❄️ Phantom Ice', solar:'☀️ Solar Crown' };
  const nameLabels  = { void:'🌑 Void Corruption', halo:'✨ Celestial Script', blaze:'🔥 Blaze Script', ice:'❄️ Ice Script', solar:'☀️ Solar Script' };
  const frames  = inv.frames  || (curFrame ? [curFrame] : []);
  const names   = inv.names   || (curName  ? [curName]  : []);
  // An equipped effect is always owned — merge so an active effect always keeps its unequip button
  const effects = [...new Set([...(inv.effects || []), ...(pl.ownedEffects || [])])];
  if (!frames.length && !names.length && !effects.length) { el.innerHTML = '<div class="text-muted" style="font-size:0.78rem;text-align:center;padding:8px">ยังไม่มี Ultra Rare ในคลัง</div>'; return; }
  let html = '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:8px;font-weight:600">📦 คลัง Ultra Rare — แตะเพื่อเปลี่ยน</div>';
  if (frames.length) {
    html += '<div style="font-size:0.68rem;color:var(--muted);margin-bottom:5px">FRAME</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">';
    frames.forEach(f => {
      const active = (f === curFrame);
      html += `<button onclick="equipGachaFrame('${f}')" style="padding:5px 11px;border-radius:20px;border:1px solid ${active?'rgba(168,85,247,0.8)':'rgba(168,85,247,0.25)'};background:${active?'rgba(168,85,247,0.2)':'rgba(168,85,247,0.07)'};color:${active?'#c084fc':'var(--muted)'};font-size:0.75rem;cursor:pointer;font-family:inherit;transition:all .2s">${frameLabels[f]||f} ${active?'✓':''}</button>`;
    });
    html += '</div>';
  }
  if (names.length) {
    html += '<div style="font-size:0.68rem;color:var(--muted);margin-bottom:5px">NAME EFFECT</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">';
    names.forEach(n => {
      const active = (n === curName);
      html += `<button onclick="equipGachaName('${n}')" style="padding:5px 11px;border-radius:20px;border:1px solid ${active?'rgba(168,85,247,0.8)':'rgba(168,85,247,0.25)'};background:${active?'rgba(168,85,247,0.2)':'rgba(168,85,247,0.07)'};color:${active?'#c084fc':'var(--muted)'};font-size:0.75rem;cursor:pointer;font-family:inherit;transition:all .2s">${nameLabels[n]||n} ${active?'✓':''}</button>`;
    });
    html += '</div>';
  }
  if (effects.length) {
    const efxLabels = { rotating_arcs: '⚡ Thunder God' };
    const curEffects = pl.ownedEffects || [];
    html += '<div style="font-size:0.68rem;color:var(--muted);margin-bottom:5px">AVATAR EFFECT</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    effects.forEach(e => {
      const active = curEffects.includes(e);
      html += `<button onclick="${active ? `unequipGachaEffect('${e}')` : `equipGachaEffect('${e}')`}" style="padding:5px 11px;border-radius:20px;border:1px solid ${active?'rgba(0,212,255,0.8)':'rgba(0,212,255,0.25)'};background:${active?'rgba(0,212,255,0.15)':'rgba(0,212,255,0.05)'};color:${active?'#00d4ff':'var(--muted)'};font-size:0.75rem;cursor:pointer;font-family:inherit;transition:all .2s">${efxLabels[e]||e}${active?' ✓':''}</button>`;
    });
    html += '</div>';
  }
  el.innerHTML = html;
}
async function equipGachaFrame(val) {
  if (!currentUser) return;
  const pl = db.players.find(x => x.id === currentUser.id);
  const isEquipped = pl && pl.gachaFrame === val;
  try {
    await dbUpdatePlayer(currentUser.id, { gacha_frame: isEquipped ? null : val });
    const _gInv = getGachaInventory(currentUser.id);
    _gInv.equippedFrame = isEquipped ? null : val;
    localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(_gInv));
    _saveGachaInventoryToDB(currentUser.id, _gInv);
    await loadPlayers();
    renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
    renderProfile();
    toast(isEquipped ? '🖼️ ถอดกรอบแล้ว' : `🖼️ ใส่กรอบ ${val} แล้ว!`, 'success');
  } catch(e) { toast('เปลี่ยนไม่ได้: ' + e.message, 'error'); }
}
async function equipGachaEmoji(emoji) {
  if (!currentUser) return;
  const pl = db.players.find(x => x.id === currentUser.id);
  const isEquipped = pl && pl.gachaEmoji === emoji;
  try {
    await dbUpdatePlayer(currentUser.id, { gacha_emoji: isEquipped ? null : emoji });
    await loadPlayers();
    if (!isEquipped) {
      const sv = getCustomAvatar(currentUser.id);
      sv.emoji = emoji;
      localStorage.setItem('bmt_av_' + currentUser.id, JSON.stringify(sv));
    }
    renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
    renderProfile();
    toast(isEquipped ? '🎭 ถอด Emoji แล้ว' : `🎭 ใส่ ${emoji} แล้ว!`, 'success');
  } catch(e) { toast('เปลี่ยนไม่ได้: ' + e.message, 'error'); }
}
async function equipGachaName(val) {
  if (!currentUser) return;
  const pl = db.players.find(x => x.id === currentUser.id);
  const isEquipped = pl && pl.gachaName === val;
  try {
    await dbUpdatePlayer(currentUser.id, { gacha_name: isEquipped ? null : val });
    const _gInv = getGachaInventory(currentUser.id);
    _gInv.equippedName = isEquipped ? null : val;
    localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(_gInv));
    _saveGachaInventoryToDB(currentUser.id, _gInv);
    await loadPlayers();
    renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
    renderProfile();
    toast(isEquipped ? '✨ ถอด Name Effect แล้ว' : `✨ ใส่ ${val} Name Effect แล้ว!`, 'success');
  } catch(e) { toast('เปลี่ยนไม่ได้: ' + e.message, 'error'); }
}
async function equipGachaEffect(effectId) {
  if (!currentUser) return;
  const pl = db.players.find(x => x.id === currentUser.id);
  // Only ONE effect can be active at a time — replace instead of append
  const owned = [effectId];
  localStorage.setItem('bmt_owned_effects_' + currentUser.id, JSON.stringify(owned));
  if (pl) pl.ownedEffects = owned;
  const gInv = getGachaInventory(currentUser.id);
  gInv.equippedEffects = owned;
  localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(gInv));
  _saveGachaInventoryToDB(currentUser.id, gInv);
  try { await dbUpdatePlayer(currentUser.id, { owned_effects: JSON.stringify(owned) }); } catch(e) {}
  await loadPlayers();
  renderGachaInventory();
  if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
  renderProfile();
  toast('⚡ ใส่ Thunder God แล้ว!', 'success');
}
async function unequipGachaEffect(effectId) {
  if (!currentUser) return;
  const pl = db.players.find(x => x.id === currentUser.id);
  const owned = ((pl && pl.ownedEffects) || []).filter(e => e !== effectId);
  localStorage.setItem('bmt_owned_effects_' + currentUser.id, JSON.stringify(owned));
  if (pl) pl.ownedEffects = owned;
  const gInv = getGachaInventory(currentUser.id);
  gInv.equippedEffects = owned;
  localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(gInv));
  _saveGachaInventoryToDB(currentUser.id, gInv);
  try { await dbUpdatePlayer(currentUser.id, { owned_effects: JSON.stringify(owned) }); } catch(e) {}
  await loadPlayers();
  renderGachaInventory();
  if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
  renderProfile();
  toast('⚡ ถอด Thunder God แล้ว!', 'success');
}
function openGachaPull() {
  if (!currentUser) return;
  const overlay = document.getElementById('gachaPullOverlay');
  if (!overlay) return;
  const pl = db.players.find(x => x.id === currentUser.id);
  const coins = pl ? (pl.coins || 0) : 0;
  document.getElementById('gachaPullBalance').textContent = `💰 เหรียญของคุณ: ${coins} 🪙`;
  document.getElementById('gachaPullResult').innerHTML = '<div class="text-muted" style="font-size:0.82rem">กด Pull เพื่อลุ้น!</div>';
  const btn = document.getElementById('gachaPullBtn');
  if (btn) btn.disabled = coins < 2;
  const btn10 = document.getElementById('gachaPullBtn10');
  if (btn10) btn10.disabled = coins < 20;
  overlay.classList.add('show');
}

function closeGachaPull(e) {
  if (e && e.target !== document.getElementById('gachaPullOverlay')) return;
  document.getElementById('gachaPullOverlay').classList.remove('show');
}

// ── helper: one random roll — saves to inventory, returns result metadata ──
async function _gachaApplyRoll() {
  const roll = Math.random() * 100;
  let inv = getGachaInventory(currentUser.id);
  const invKey = 'bmt_gacha_inv_' + currentUser.id;

  if (roll < 0.1) {
    const eid = 'rotating_arcs';
    if (!inv.effects) inv.effects = [];
    if (!inv.effects.includes(eid)) inv.effects.push(eid);
    inv.equippedEffects = [eid];
    localStorage.setItem(invKey, JSON.stringify(inv));
    _saveGachaInventoryToDB(currentUser.id, inv);
    localStorage.setItem('bmt_owned_effects_' + currentUser.id, JSON.stringify([eid]));
    try { await dbUpdatePlayer(currentUser.id, { owned_effects: JSON.stringify([eid]) }); } catch(e) {}
    return { type: 'secret', icon: '⚡', color: '#00d4ff', text: 'THUNDER GOD' };

  } else if (roll < 3) {
    const picks = ['void_frame','halo_frame','blaze_name','ice_name'];
    const [val, col] = picks[Math.floor(Math.random() * picks.length)].split('_');
    if (!inv.frames) inv.frames = [];
    if (!inv.names) inv.names = [];
    if (col === 'frame' && !inv.frames.includes(val)) inv.frames.push(val);
    if (col === 'name'  && !inv.names.includes(val))  inv.names.push(val);
    localStorage.setItem(invKey, JSON.stringify(inv));
    _saveGachaInventoryToDB(currentUser.id, inv);
    const labels = { void:'🌑 Void', halo:'✨ Halo', blaze:'🔥 Blaze', ice:'❄️ Ice' };
    return { type: 'ultra', icon: '✨', color: '#c084fc', text: `${labels[val]||val} ${col === 'frame' ? 'Frame' : 'Name'}` };

  } else if (roll < 10) {
    const frame = Math.random() < 0.5 ? 'rainbow' : 'robot';
    if (!inv.frames) inv.frames = [];
    if (!inv.frames.includes(frame)) inv.frames.push(frame);
    localStorage.setItem(invKey, JSON.stringify(inv));
    _saveGachaInventoryToDB(currentUser.id, inv);
    return { type: 'frame', icon: frame === 'rainbow' ? '🌈' : '⚙️', color: '#60a5fa', text: (frame === 'rainbow' ? 'Rainbow' : 'Robot') + ' Frame' };

  } else if (roll < 30) {
    const emoji = GACHA_EMOJIS[Math.floor(Math.random() * GACHA_EMOJIS.length)];
    if (!inv.emojis) inv.emojis = [];
    if (!inv.emojis.includes(emoji)) inv.emojis.push(emoji);
    localStorage.setItem(invKey, JSON.stringify(inv));
    _saveGachaInventoryToDB(currentUser.id, inv);
    return { type: 'emoji', icon: emoji, color: '#94a3b8', text: emoji + ' Emoji' };

  } else {
    return { type: 'empty', icon: '💨', color: 'rgba(255,255,255,0.12)', text: 'ไม่ได้ของ' };
  }
}

async function doGachaPull10() {
  if (!currentUser) return;
  const pl = db.players.find(x => x.id === currentUser.id);
  const totalCoins = getEffectiveCoins(currentUser.id);
  if (!pl || totalCoins < 20) { toast('เหรียญไม่พอ (ต้องการ 20🪙)', 'error'); return; }
  const btn10 = document.getElementById('gachaPullBtn10');
  const btn1  = document.getElementById('gachaPullBtn');
  if (btn10) btn10.disabled = true;
  if (btn1)  btn1.disabled  = true;

  const _paid10 = await dbAddCoins(currentUser.id, -20);
  if (!_paid10) _setLsCoins(currentUser.id, _lsCoins(currentUser.id) - 20);
  await loadPlayers();

  const results = [];
  for (let i = 0; i < 10; i++) results.push(await _gachaApplyRoll());

  const resultEl = document.getElementById('gachaPullResult');
  if (resultEl) {
    const gridHtml = results.map(r =>
      `<div style="border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 2px;border:1px solid ${r.type!=='empty'?r.color:'rgba(255,255,255,0.07)'};background:${r.type!=='empty'?r.color+'18':'rgba(0,0,0,0.15)'}">
        <div style="font-size:1.25rem;line-height:1">${r.icon}</div>
        ${r.type!=='empty'?`<div style="font-size:0.42rem;color:${r.color};text-align:center;line-height:1.2;word-break:break-all">${r.text}</div>`:''}
      </div>`
    ).join('');
    const hasSecret = results.some(r => r.type === 'secret');
    resultEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;width:100%;margin-bottom:6px">${gridHtml}</div>
      ${hasSecret ? `<div style="color:#00d4ff;font-weight:700;font-size:0.82rem;letter-spacing:.05em;animation:tgNameFlicker 1s ease-in-out infinite">⚡ THUNDER GOD ได้แล้ว!</div>` : ''}`;
  }

  const newCoins = getEffectiveCoins(currentUser.id);
  const balEl = document.getElementById('gachaPullBalance');
  if (balEl) balEl.textContent = `💰 เหรียญของคุณ: ${newCoins} 🪙`;
  if (btn10) btn10.disabled = newCoins < 20;
  if (btn1)  btn1.disabled  = newCoins < 2;
  const pcEl = document.getElementById('profileCoinBalance');
  if (pcEl) pcEl.textContent = newCoins;
  if (typeof renderGachaInventory === 'function') renderGachaInventory();

  const gotSecret = results.find(r => r.type === 'secret');
  if (gotSecret) {
    setTimeout(() => {
      document.getElementById('gachaPullOverlay').classList.remove('show');
      showThunderGodCinematic(currentUser.name);
    }, 1800);
  }
}

// ── Coin localStorage fallback (ใช้เมื่อ DB column ยังไม่มี) ──
function _lsCoins(pid) { return parseInt(localStorage.getItem('bmt_coins_'+pid)||'0'); }
function _setLsCoins(pid,v){ localStorage.setItem('bmt_coins_'+pid, Math.max(0,v)); }
function getEffectiveCoins(pid) {
  const pl = db.players.find(x=>x.id===pid);
  const dbC = pl ? (pl.coins||0) : 0;
  return dbC > 0 ? dbC : _lsCoins(pid);
}

async function doGachaPull() {
  if (!currentUser) return;
  const pl = db.players.find(x => x.id === currentUser.id);
  const totalCoins = getEffectiveCoins(currentUser.id);
  if (!pl || totalCoins < 2) { toast('เหรียญไม่พอ (ต้องการ 2🪙)', 'error'); return; }
  const btn = document.getElementById('gachaPullBtn');
  if (btn) btn.disabled = true;

  // หัก 2 coins (DB + localStorage fallback)
  const _paid1 = await dbAddCoins(currentUser.id, -2);
  if (!_paid1) _setLsCoins(currentUser.id, _lsCoins(currentUser.id) - 2);
  await loadPlayers();
  const plUpdated = db.players.find(x => x.id === currentUser.id);

  const roll = Math.random() * 100;
  let result = null;

  if (roll < 0.1) {
    // ── ⚡ SECRET: THUNDER GOD 0.1% — avatar_effect: rotating_arcs ──
    const effectId = 'rotating_arcs';
    // 1. Save to inventory (effects array)
    const invKey = 'bmt_gacha_inv_' + currentUser.id;
    let inv = getGachaInventory(currentUser.id);
    if (!inv.effects) inv.effects = [];
    if (!inv.effects.includes(effectId)) inv.effects.push(effectId);
    localStorage.setItem(invKey, JSON.stringify(inv));
    _saveGachaInventoryToDB(currentUser.id, inv);
    // 2. Save owned_effects to DB
    try {
      await dbUpdatePlayer(currentUser.id, { owned_effects: JSON.stringify([effectId]) });
      await loadPlayers();
    } catch(e) {
      // fallback: persist in localStorage inventory (already saved above)
      console.warn('owned_effects save failed:', e.message);
    }
    result = { type: 'secret', val: effectId, text: '⚡ THUNDER GOD ⚡' };
    // 3. Show rotating arcs preview in result card then launch cinematic
    const resultElS = document.getElementById('gachaPullResult');
    if (resultElS) resultElS.innerHTML = `
      <div style="transform:scale(0.65);transform-origin:center top;margin:-8px 0 -26px;pointer-events:none">
        <div class="lightning-avatar-wrap">
          <div class="lightning-arc lightning-arc-1"></div>
          <div class="lightning-arc lightning-arc-2"></div>
          <div class="lightning-arc lightning-arc-3"></div>
          <div class="lightning-dot"></div><div class="lightning-dot"></div>
          <div class="lightning-dot"></div><div class="lightning-dot"></div>
          <div class="lightning-avatar" style="font-size:1.9rem">${getInitial(currentUser.name)}</div>
        </div>
      </div>
      <div class="gacha-pull-value" style="color:#00d4ff;font-size:1rem;letter-spacing:.1em;margin-top:4px">⚡ THUNDER GOD — 0.1%</div>
      <div style="font-size:.72rem;color:rgba(0,200,255,.7);margin-top:3px;letter-spacing:.08em">ได้แล้ว!</div>`;
    setTimeout(() => {
      document.getElementById('gachaPullOverlay').classList.remove('show');
      window._tgCinematicOnClose = function() {
        if (typeof renderProfile === 'function') renderProfile();
        if (typeof renderGachaInventory === 'function') renderGachaInventory();
      };
      showThunderGodCinematic(currentUser.name);
    }, 900);

  } else if (roll < 3) {
    // ── ULTRA RARE 3% ──
    const ultraRolls = ['void_frame','halo_frame','blaze_name','ice_name'];
    const pick = ultraRolls[Math.floor(Math.random() * 4)];
    const [val, col] = pick.split('_');

    // ── 1. บันทึกลง inventory (localStorage + DB ถาวร) ──
    const invKey = 'bmt_gacha_inv_' + currentUser.id;
    let inv = getGachaInventory(currentUser.id);
    if (!inv.frames) inv.frames = [];
    if (!inv.names)  inv.names  = [];
    if (col === 'frame' && !inv.frames.includes(val)) inv.frames.push(val);
    if (col === 'name'  && !inv.names.includes(val))  inv.names.push(val);
    if (col === 'frame') inv.equippedFrame = val;
    else inv.equippedName = val;
    localStorage.setItem(invKey, JSON.stringify(inv));
    _saveGachaInventoryToDB(currentUser.id, inv); // async, ไม่ต้อง await

    // ── 2. บันทึกลง DB: equip ชิ้นนี้เสมอ (replace — user เปลี่ยนเองได้จากคลัง) ──
    try {
      const updateData = col === 'frame' ? { gacha_frame: val } : { gacha_name: val };
      await dbUpdatePlayer(currentUser.id, updateData);
      await loadPlayers();
    } catch(e) {
      toast('⚠️ บันทึก DB ไม่ได้ บันทึก local ชั่วคราวแทน (รัน ALTER TABLE ใน Admin → SQL)', 'info');
    }

    result = { type: 'ultra', val, col, text: `✨ ULTRA RARE! ${col==='frame'?val+' Frame':val+' Name Effect'}` };

    // ── 3. บันทึกลง bmt_gacha_ (equip ทันที) ──
    try {
      const lsKey = 'bmt_gacha_' + currentUser.id;
      const lsData = JSON.parse(localStorage.getItem(lsKey)||'{}');
      if (col === 'frame') lsData.gacha_frame = val;
      else lsData.gacha_name = val;
      localStorage.setItem(lsKey, JSON.stringify(lsData));
    } catch(e) {}

    // ── 4. แสดงผล ──
    const resultEl = document.getElementById('gachaPullResult');
    if (resultEl) resultEl.innerHTML = `<div style="font-size:2rem">⭐</div><div class="gacha-pull-value" style="color:#c084fc;font-size:1.1rem">✨ ULTRA RARE!</div><div style="font-size:0.8rem;color:var(--muted);margin-top:4px">${result.text.replace('✨ ULTRA RARE! ','')}</div>`;
    setTimeout(() => {
      document.getElementById('gachaPullOverlay').classList.remove('show');
      // ── เมื่อ tap/close reveal → เปิด Avatar Builder ให้เห็น animation ทันที ──
      const origClose = window._gachaRevealOnClose;
      window._gachaRevealOnClose = function() {
        window._gachaRevealOnClose = origClose;
        if (document.getElementById('profileSection') && !document.getElementById('profileSection').classList.contains('hidden')) {
          openAvatarBuilder();
        }
      };
      showGachaReveal(currentUser.name, col==='frame'?val:null, col==='name'?val:null);
      if (typeof renderGachaInventory === 'function') renderGachaInventory();
    }, 1200);

  } else if (roll < 10) {
    // ── REGULAR FRAME 7% ──
    const frame = Math.random() < 0.5 ? 'rainbow' : 'robot';
    // บันทึกลง inventory (สะสม)
    const invF = getGachaInventory(currentUser.id);
    if (!invF.frames) invF.frames = [];
    if (!invF.frames.includes(frame)) invF.frames.push(frame);
    invF.equippedFrame = frame;
    localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(invF));
    _saveGachaInventoryToDB(currentUser.id, invF);
    // equip
    try { await dbUpdatePlayer(currentUser.id, { gacha_frame: frame }); await loadPlayers(); }
    catch(e) { const d=JSON.parse(localStorage.getItem('bmt_gacha_'+currentUser.id)||'{}'); d.gacha_frame=frame; localStorage.setItem('bmt_gacha_'+currentUser.id,JSON.stringify(d)); }
    result = { type: 'frame', text: `${frame==='rainbow'?'🌈 Rainbow':'⚙️ Robot'} Frame ได้แล้ว!`, frame };

  } else if (roll < 30) {
    // ── EMOJI 20% ──
    const emoji = GACHA_EMOJIS[Math.floor(Math.random() * GACHA_EMOJIS.length)];
    // บันทึกลง inventory (สะสม)
    const invE = getGachaInventory(currentUser.id);
    if (!invE.emojis) invE.emojis = [];
    if (!invE.emojis.includes(emoji)) invE.emojis.push(emoji);
    localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(invE));
    _saveGachaInventoryToDB(currentUser.id, invE);
    // equip
    try { await dbUpdatePlayer(currentUser.id, { gacha_emoji: emoji }); await loadPlayers(); }
    catch(e) { const d=JSON.parse(localStorage.getItem('bmt_gacha_'+currentUser.id)||'{}'); d.gacha_emoji=emoji; localStorage.setItem('bmt_gacha_'+currentUser.id,JSON.stringify(d)); }
    const sv = getCustomAvatar(currentUser.id);
    sv.emoji = emoji;
    localStorage.setItem('bmt_av_' + currentUser.id, JSON.stringify(sv));
    result = { type: 'emoji', text: `${emoji} Emoji Avatar ได้แล้ว!`, emoji };

  } else {
    // ── ไม่ได้ของ 70% ──
    result = { type: 'empty', text: '💨 ไม่ได้ของ...' };
  }

  // แสดงผลลัพธ์ (ยกเว้น ultra/secret ที่แสดงแล้ว)
  if (result && result.type !== 'ultra' && result.type !== 'secret') {
    const resultEl = document.getElementById('gachaPullResult');
    if (resultEl) {
      const icons = { frame: result.frame==='rainbow'?'🌈':'⚙️', emoji: result.emoji||'😎', empty: '💨' };
      resultEl.innerHTML = `<div class="gacha-pull-result">${icons[result.type]}</div>
        <div class="gacha-pull-value" style="color:var(--neon)">${result.text}</div>`;
    }
  }
  const newCoins = getEffectiveCoins(currentUser.id);
  const balEl = document.getElementById('gachaPullBalance');
  if (balEl) balEl.textContent = `💰 เหรียญของคุณ: ${newCoins} 🪙`;
  if (btn && result && result.type !== 'ultra' && result.type !== 'secret') btn.disabled = newCoins < 2;
  // อัพเดท profile coin balance
  const pcEl = document.getElementById('profileCoinBalance');
  if (pcEl) pcEl.textContent = newCoins;
}

