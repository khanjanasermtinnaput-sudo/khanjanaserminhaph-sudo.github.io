// ── 1. DIVISIONS I/II/III ─────────────────────────────────
function getRankLabel(pts, playerId) {
  const base = getRank(pts, playerId);
  if (base.id === 'king') return '👑 King';
  const divs = {
    bronze:   [[0,33,'III'],[34,66,'II'],[67,100,'I']],
    silver:   [[101,166,'III'],[167,233,'II'],[234,300,'I']],
    gold:     [[301,367,'III'],[368,433,'II'],[434,500,'I']],
    platinum: [[501,600,'III'],[601,700,'II'],[701,800,'I']],
    diamond:  [[801,1033,'III'],[1034,1266,'II'],[1267,1499,'I']],
    master:   [[1500,1999,'III'],[2000,2499,'II'],[2500,2999,'I']],
  };
  const icon = { bronze:'🥉', silver:'🥈', gold:'🥇', platinum:'💎', diamond:'💠', master:'🔥' };
  const name = { bronze:'Bronze', silver:'Silver', gold:'Gold', platinum:'Platinum', diamond:'Diamond', master:'Master' };
  const ranges = divs[base.id];
  if (!ranges) return base.label;
  for (const [lo, hi, div] of ranges) {
    if (pts >= lo && pts <= hi) return `${icon[base.id]} ${name[base.id]} ${div}`;
  }
  return base.label;
}

// ── 2. COIN SYSTEM ────────────────────────────────────────
async function dbAddCoins(playerId, amount) {
  try {
    const pl = db.players.find(x => x.id === playerId);
    if (!pl) return;
    const newCoins = Math.max(0, (pl.coins || 0) + amount);
    await dbUpdatePlayer(playerId, { coins: newCoins });
    pl.coins = newCoins;
  } catch(e) { console.warn('dbAddCoins failed:', e.message); }
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
    await dbUpdatePlayer(userId, { gacha_inventory: JSON.stringify(inv) });
    const pl = db.players.find(x => x.id === userId);
    if (pl) pl._dbGachaInv = inv;
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
  const effects = inv.effects || [];
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
  try {
    await dbUpdatePlayer(currentUser.id, { gacha_frame: val });
    await loadPlayers();
    renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
    renderProfile();
    toast('🖼️ เปลี่ยนกรอบเป็น ' + val + ' แล้ว!', 'success');
  } catch(e) { toast('เปลี่ยนไม่ได้: ' + e.message, 'error'); }
}
async function equipGachaEmoji(emoji) {
  if (!currentUser) return;
  try {
    await dbUpdatePlayer(currentUser.id, { gacha_emoji: emoji });
    await loadPlayers();
    const sv = getCustomAvatar(currentUser.id);
    sv.emoji = emoji;
    localStorage.setItem('bmt_av_' + currentUser.id, JSON.stringify(sv));
    renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
    renderProfile();
    toast('🎭 เปลี่ยน Avatar Emoji เป็น ' + emoji + ' แล้ว!', 'success');
  } catch(e) { toast('เปลี่ยนไม่ได้: ' + e.message, 'error'); }
}
async function equipGachaName(val) {
  if (!currentUser) return;
  try {
    await dbUpdatePlayer(currentUser.id, { gacha_name: val });
    await loadPlayers();
    renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
    renderProfile();
    toast('✨ เปลี่ยน Name Effect เป็น ' + val + ' แล้ว!', 'success');
  } catch(e) { toast('เปลี่ยนไม่ได้: ' + e.message, 'error'); }
}
async function equipGachaEffect(effectId) {
  if (!currentUser) return;
  try {
    const pl = db.players.find(x => x.id === currentUser.id);
    const owned = ((pl && pl.ownedEffects) || []).filter(e => e !== effectId);
    owned.push(effectId);
    await dbUpdatePlayer(currentUser.id, { owned_effects: JSON.stringify(owned) });
    await loadPlayers();
    renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
    renderProfile();
    toast('⚡ ใส่ Thunder God แล้ว!', 'success');
  } catch(e) { toast('ใส่ไม่ได้: ' + e.message, 'error'); }
}
async function unequipGachaEffect(effectId) {
  if (!currentUser) return;
  try {
    const pl = db.players.find(x => x.id === currentUser.id);
    const owned = ((pl && pl.ownedEffects) || []).filter(e => e !== effectId);
    await dbUpdatePlayer(currentUser.id, { owned_effects: JSON.stringify(owned) });
    await loadPlayers();
    renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
    renderProfile();
    toast('⚡ ถอด Thunder God แล้ว!', 'success');
  } catch(e) { toast('ถอดไม่ได้: ' + e.message, 'error'); }
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
  overlay.classList.add('show');
}

function closeGachaPull(e) {
  if (e && e.target !== document.getElementById('gachaPullOverlay')) return;
  document.getElementById('gachaPullOverlay').classList.remove('show');
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
  try {
    await dbAddCoins(currentUser.id, -2);
  } catch(e) {
    _setLsCoins(currentUser.id, _lsCoins(currentUser.id) - 2);
  }
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

