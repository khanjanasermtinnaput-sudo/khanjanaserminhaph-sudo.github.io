// ── 4. MAILBOX SYSTEM ─────────────────────────────────────
async function dbGetMailbox(playerId) {
  try { return await supaFetch(`mailbox?player_id=eq.${playerId}&claimed=eq.false&order=created_at.desc`); } catch(e) { return []; }
}
async function dbSendMail(playerId, itemType, itemValue, message) {
  await supaFetch('mailbox', { method: 'POST', body: JSON.stringify({ player_id: playerId, item_type: itemType, item_value: itemValue, message: message || '' }), prefer: 'return=minimal' });
}
async function dbClaimMail(mailId) {
  await supaFetch(`mailbox?id=eq.${mailId}`, { method: 'PATCH', body: JSON.stringify({ claimed: true }) });
}

async function checkMailboxBadge() {
  if (!currentUser) return;
  const btn = document.getElementById('mailboxNavBtn');
  const dot = document.getElementById('mailboxDot');
  if (!btn) return;
  // ── แสดงปุ่มเสมอหลัง login — dot แดงเฉพาะเมื่อมีของ ──
  btn.style.display = '';
  try {
    const items = await dbGetMailbox(currentUser.id);
    const hasItems = items && items.length > 0;
    if (dot) dot.classList.toggle('show', hasItems);
  } catch(e) { /* แสดงปุ่มอยู่ แต่ไม่มี dot */ }
}

function openMailbox() {
  const overlay = document.getElementById('mailboxOverlay');
  if (!overlay) return;
  overlay.classList.add('show');
  renderMailboxList();
}

function closeMailbox(e) {
  if (e && e.target !== document.getElementById('mailboxOverlay')) return;
  const overlay = document.getElementById('mailboxOverlay');
  if (overlay) overlay.classList.remove('show');
}

async function renderMailboxList() {
  const list = document.getElementById('mailboxList');
  if (!list || !currentUser) return;
  list.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px">⏳ กำลังโหลด...</div>';
  try {
    const items = await dbGetMailbox(currentUser.id);
    if (!items || items.length === 0) {
      list.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px">ไม่มีไอเทมในกล่องของขวัญ</div>';
      return;
    }
    const typeIcon = { coins:'🪙', elo:'📈', gacha_frame:'🖼️', gacha_emoji:'🎭', gacha_element:'✦', gacha_name:'✨', gacha_effect:'⚡' };
    const elNames  = { earth:'TERRA ดิน', water:'AQUA น้ำ', wind:'ZEPHYR ลม', fire:'IGNIS ไฟ', lightning:'VOLT สายฟ้า', yinyang:'YIN YANG' };
    const efxNames = { rotating_arcs:'Thunder God' };
    list.innerHTML = items.map(item => {
      const icon = typeIcon[item.item_type] || '🎁';
      const label = item.item_type === 'coins' ? `+${item.item_value} 🪙`
        : item.item_type === 'elo' ? `+${item.item_value} ELO`
        : item.item_type === 'gacha_frame' ? `🖼️ Frame: ${item.item_value}`
        : item.item_type === 'gacha_name' ? `✨ Name Effect: ${item.item_value}`
        : item.item_type === 'gacha_emoji' ? `🎭 Emoji: ${item.item_value}`
        : item.item_type === 'gacha_element' ? `✦ Element: ${elNames[item.item_value] || item.item_value}`
        : item.item_type === 'gacha_effect' ? `⚡ ${efxNames[item.item_value] || item.item_value}`
        : item.item_value;
      return `<div class="mailbox-item" id="mail_${item.id}">
        <div class="mailbox-item-icon">${icon}</div>
        <div class="mailbox-item-body">
          <div class="mailbox-item-title">${label}</div>
          <div class="mailbox-item-msg">${item.message || ''}</div>
        </div>
        <button class="mailbox-item-claim" onclick="claimMailItem(${item.id},'${item.item_type}','${String(item.item_value).replace(/'/g,'')}')">รับ</button>
      </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px">โหลดไม่ได้: ${e.message}</div>`;
  }
}

async function claimMailItem(mailId, itemType, itemValue) {
  if (!currentUser) return;
  const btn = document.querySelector(`#mail_${mailId} .mailbox-item-claim`);
  if (btn) btn.disabled = true;
  try {
    await dbClaimMail(mailId);
    const pl = db.players.find(x => x.id === currentUser.id);
    if (pl) {
      const _addToInv = (key, val) => {
        const inv = typeof getGachaInventory === 'function' ? getGachaInventory(currentUser.id) : {};
        if (!inv[key]) inv[key] = [];
        if (!inv[key].includes(val)) inv[key].push(val);
        localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(inv));
        if (typeof _saveGachaInventoryToDB === 'function') _saveGachaInventoryToDB(currentUser.id, inv);
      };
      if (itemType === 'coins') {
        await dbAddCoins(currentUser.id, parseInt(itemValue) || 0);
        toast(`🪙 รับ +${itemValue} เหรียญแล้ว!`, 'success');
      } else if (itemType === 'elo') {
        await dbUpdatePlayer(currentUser.id, { pts: (pl.pts || 0) + (parseInt(itemValue) || 0) });
        toast(`📈 รับ +${itemValue} ELO แล้ว!`, 'success');
      } else if (itemType === 'gacha_frame') {
        _addToInv('frames', itemValue);
        await dbUpdatePlayer(currentUser.id, { gacha_frame: itemValue });
        toast(`🖼️ รับ Frame: ${itemValue} แล้ว! (เข้า Inventory แล้ว)`, 'success');
      } else if (itemType === 'gacha_name') {
        _addToInv('names', itemValue);
        await dbUpdatePlayer(currentUser.id, { gacha_name: itemValue });
        toast(`✨ รับ Name Effect: ${itemValue} แล้ว! (เข้า Inventory แล้ว)`, 'success');
      } else if (itemType === 'gacha_emoji') {
        _addToInv('emojis', itemValue);
        await dbUpdatePlayer(currentUser.id, { gacha_emoji: itemValue });
        const sv = getCustomAvatar(currentUser.id);
        sv.emoji = itemValue;
        localStorage.setItem('bmt_av_' + currentUser.id, JSON.stringify(sv));
        toast(`${itemValue} รับ Emoji Avatar แล้ว! (เข้า Inventory แล้ว)`, 'success');
      } else if (itemType === 'gacha_element') {
        const elNames = { earth:'TERRA ดิน', water:'AQUA น้ำ', wind:'ZEPHYR ลม', fire:'IGNIS ไฟ', lightning:'VOLT สายฟ้า', yinyang:'YIN YANG' };
        if (typeof window._geAdminGrant === 'function') window._geAdminGrant(currentUser.id, itemValue);
        // Also save to gacha_inventory.elements for permanent storage
        _addToInv('elements', itemValue);
        toast(`✦ รับ Element: ${elNames[itemValue] || itemValue} แล้ว! (เข้า Inventory ถาวรแล้ว)`, 'success');
      } else if (itemType === 'gacha_effect') {
        const pUp = db.players.find(x => x.id === currentUser.id);
        if (pUp) {
          const efx = (pUp.ownedEffects || []).filter(e => e !== itemValue);
          efx.push(itemValue);
          await dbUpdatePlayer(currentUser.id, { owned_effects: JSON.stringify(efx) });
          pUp.ownedEffects = efx;
        }
        toast(`⚡ รับ Thunder God แล้ว!`, 'success');
      }
    }
    await loadPlayers();
    renderMailboxList();
    checkMailboxBadge();
    if (typeof renderGachaInventory === 'function') renderGachaInventory();
    if (typeof window._geRenderProfileInventory === 'function') window._geRenderProfileInventory();
  } catch(e) {
    toast('รับไม่ได้: ' + e.message, 'error');
    if (btn) btn.disabled = false;
  }
}

