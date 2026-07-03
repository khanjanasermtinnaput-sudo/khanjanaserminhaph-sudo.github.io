/* ═══════════════════════════════════════════════════════════════
   BK CLUB — MARKETPLACE (System 2)
   Player-driven economy. Listing escrows the item out of the seller's
   inventory; buying atomically transfers coins (minus 5% tax) and the item.
   Every mutation is a SECURITY DEFINER RPC authenticated by session_uid()
   with FOR UPDATE locks (race/double-buy safe). See supabase_marketplace.sql.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  let tab = 'browse';          // browse | sell | mine
  let listings = [];
  let myListings = [];
  let history = [];
  let filterCat = '';
  let filterRar = '';
  let sortMode = 'new';
  let busy = false;

  const ERR_TH = {
    insufficient_coins: 'เหรียญไม่พอ', already_owned: 'คุณมีไอเทมนี้อยู่แล้ว',
    cannot_buy_own: 'ซื้อของตัวเองไม่ได้', not_available: 'รายการนี้ถูกซื้อ/ยกเลิกไปแล้ว',
    listing_not_found: 'ไม่พบรายการ', not_owned: 'คุณไม่ได้เป็นเจ้าของไอเทมนี้',
    not_seller: 'ไม่ใช่รายการของคุณ', bad_price: 'ราคาไม่ถูกต้อง (1–1,000,000)',
    not_authenticated: 'กรุณาเข้าสู่ระบบใหม่',
  };
  function errMsg(e) {
    const code = (typeof economyErrCode === 'function') ? economyErrCode(e) : (e && e.message) || '';
    return ERR_TH[code] || code || 'ทำรายการไม่สำเร็จ';
  }

  function injectStyles() {
    if (document.getElementById('mk-styles')) return;
    const s = document.createElement('style');
    s.id = 'mk-styles';
    s.textContent = `
      .mk-tabs{display:flex;gap:6px;margin-bottom:12px}
      .mk-tab{flex:1;padding:9px;border-radius:12px;border:1px solid rgba(255,255,255,.1);
        background:rgba(255,255,255,.02);color:var(--muted);font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit}
      .mk-tab.on{background:rgba(168,85,247,.16);border-color:rgba(168,85,247,.5);color:#c084fc}
      .mk-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
      .mk-filters select,.mk-filters input{flex:1;min-width:92px;font-size:.76rem;padding:7px 9px;border-radius:9px;
        border:1px solid var(--glass-border,rgba(255,255,255,.12));background:var(--inp-bg,rgba(0,0,0,.2));color:var(--text)}
      .mk-list{display:grid;gap:9px}
      .mk-card{display:flex;align-items:center;gap:11px;padding:11px;border-radius:14px;
        border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02)}
      .mk-glyph{font-size:1.7rem;width:44px;height:44px;flex-shrink:0;display:grid;place-items:center;
        border-radius:12px;border:1px solid var(--rc,#888);background:rgba(255,255,255,.03)}
      .mk-body{flex:1;min-width:0}
      .mk-name{font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mk-meta{font-size:.68rem;color:var(--muted);margin-top:2px}
      .mk-price{font-weight:700;color:var(--gold,#fbbf24);font-size:.86rem;white-space:nowrap}
      .mk-act{padding:8px 14px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-weight:700;
        font-size:.8rem;color:#fff;background:linear-gradient(135deg,#059669,#34d399)}
      .mk-act.mk-cancel{background:linear-gradient(135deg,#b91c1c,#ef4444)}
      .mk-act:disabled{opacity:.4;cursor:not-allowed}
      .mk-sell-row{display:flex;align-items:center;gap:9px;padding:9px;border-radius:12px;
        border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.02);margin-bottom:8px}
      .mk-sell-row input{width:82px;font-size:.8rem;padding:7px;border-radius:9px;
        border:1px solid var(--glass-border,rgba(255,255,255,.12));background:var(--inp-bg,rgba(0,0,0,.2));color:var(--text)}
      .mk-empty{color:var(--muted);font-size:.8rem;text-align:center;padding:20px}
      .mk-hist-row{display:flex;align-items:center;gap:8px;font-size:.75rem;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)}
      .mk-hist-row:last-child{border-bottom:none}
      .mk-hist-price{margin-left:auto;color:var(--gold,#fbbf24);font-weight:600}
    `;
    document.head.appendChild(s);
  }

  function itemView(k, v) {
    const item = window.getCatalogByInv ? window.getCatalogByInv(k, v) : null;
    const meta = window.catalogRarityMeta(item ? item.rarity : 'common');
    let glyph = '❔';
    if (item) {
      if (item.category === 'emoji' || item.category === 'element') glyph = item.value;
      else { const m = item.label.match(/^\s*(\p{Emoji})/u); glyph = m ? m[1] : '❔'; }
    }
    return { item, meta, glyph, label: item ? item.label : v };
  }
  const sellerName = id => {
    const p = (typeof db !== 'undefined' && db.players) ? db.players.find(x => x.id === id) : null;
    return p ? p.name : ('#' + id);
  };
  const myCoins = () => (typeof getEffectiveCoins === 'function' && currentUser)
    ? getEffectiveCoins(currentUser.id)
    : ((db.players.find(p => p.id === (currentUser || {}).id) || {}).coins || 0);

  function browseCards() {
    let rows = listings.filter(l => !currentUser || l.seller_id !== currentUser.id);
    rows = rows.filter(l => {
      const iv = itemView(l.item_k, l.item_v);
      if (filterCat && (!iv.item || iv.item.category !== filterCat)) return false;
      if (filterRar && (!iv.item || iv.item.rarity !== filterRar)) return false;
      return true;
    });
    rows.sort((a, b) =>
      sortMode === 'lo' ? a.price - b.price :
      sortMode === 'hi' ? b.price - a.price :
      new Date(b.created_at) - new Date(a.created_at));
    if (!rows.length) return '<div class="mk-empty">ยังไม่มีรายการขายที่ตรงกับตัวกรอง</div>';
    const coins = myCoins();
    return '<div class="mk-list">' + rows.map(l => {
      const iv = itemView(l.item_k, l.item_v);
      const afford = coins >= l.price;
      return `<div class="mk-card">
        <div class="mk-glyph" style="--rc:${iv.meta.color}">${iv.glyph}</div>
        <div class="mk-body">
          <div class="mk-name" style="color:${iv.meta.color}">${iv.label}</div>
          <div class="mk-meta">${iv.meta.label} · โดย ${escHtml(sellerName(l.seller_id))}</div>
        </div>
        <div style="text-align:right">
          <div class="mk-price">🪙 ${l.price.toLocaleString()}</div>
          <button class="mk-act" data-buy="${l.id}" ${afford ? '' : 'disabled'} style="margin-top:5px">${afford ? 'ซื้อ' : 'เหรียญไม่พอ'}</button>
        </div>
      </div>`;
    }).join('') + '</div>';
  }

  function sellCards() {
    if (!currentUser) return '';
    const sets = window.getOwnedSets(currentUser.id);
    const owned = window.GAME_CATALOG.filter(it => {
      const s = sets[it.invKey];
      return s && s.has(window.catalogCanonValue(it.value));
    });
    if (!owned.length) return '<div class="mk-empty">คุณยังไม่มีไอเทมสำหรับขาย</div>';
    return owned.map(it => {
      const iv = itemView(it.invKey, it.value);
      return `<div class="mk-sell-row">
        <div class="mk-glyph" style="--rc:${iv.meta.color};font-size:1.3rem;width:38px;height:38px">${iv.glyph}</div>
        <div class="mk-body"><div class="mk-name" style="color:${iv.meta.color};font-size:.8rem">${iv.label}</div>
          <div class="mk-meta">${iv.meta.label}</div></div>
        <input type="number" min="1" max="1000000" placeholder="ราคา" id="mkprice_${it.invKey}_${cssId(it.value)}">
        <button class="mk-act" data-list="${it.invKey}|${it.value}">ขาย</button>
      </div>`;
    }).join('') + '<div class="mk-meta" style="text-align:center;margin-top:8px">ค่าธรรมเนียมลงขาย 🪙1 · ภาษีการขาย 5%</div>';
  }

  function mineCards() {
    if (!myListings.length) return '<div class="mk-empty">คุณไม่มีรายการขายที่เปิดอยู่</div>';
    return '<div class="mk-list">' + myListings.map(l => {
      const iv = itemView(l.item_k, l.item_v);
      return `<div class="mk-card">
        <div class="mk-glyph" style="--rc:${iv.meta.color}">${iv.glyph}</div>
        <div class="mk-body"><div class="mk-name" style="color:${iv.meta.color}">${iv.label}</div>
          <div class="mk-meta">${iv.meta.label} · กำลังขาย</div></div>
        <div style="text-align:right"><div class="mk-price">🪙 ${l.price.toLocaleString()}</div>
          <button class="mk-act mk-cancel" data-cancel="${l.id}" style="margin-top:5px">ยกเลิก</button></div>
      </div>`;
    }).join('') + '</div>';
  }

  function historyBlock() {
    if (!history.length) return '';
    return `<div class="card"><div class="card-title" style="font-size:.9rem">🧾 ขายล่าสุด</div>` +
      history.map(h => {
        const iv = itemView(h.item_k, h.item_v);
        return `<div class="mk-hist-row"><span>${iv.glyph}</span>
          <span style="color:${iv.meta.color}">${iv.label}</span>
          <span class="mk-hist-price">🪙 ${h.price.toLocaleString()}</span></div>`;
      }).join('') + '</div>';
  }

  function render() {
    injectStyles();
    const sec = document.getElementById('marketSection');
    if (!sec) return;
    if (typeof currentUser === 'undefined' || !currentUser) {
      sec.innerHTML = '<main><div class="card"><div class="mk-empty">กรุณาเข้าสู่ระบบ</div></div></main>';
      return;
    }
    let body = '';
    if (tab === 'browse') {
      const cats = (window.CATALOG_CATEGORIES || []).map(c => `<option value="${c.key}">${c.label}</option>`).join('');
      const rars = Object.keys(window.CATALOG_RARITY || {}).map(k => `<option value="${k}">${window.CATALOG_RARITY[k].label}</option>`).join('');
      body = `<div class="mk-filters">
          <select id="mkCat"><option value="">ทุกหมวด</option>${cats}</select>
          <select id="mkRar"><option value="">ทุกความหายาก</option>${rars}</select>
          <select id="mkSort"><option value="new">ใหม่สุด</option><option value="lo">ราคาต่ำ</option><option value="hi">ราคาสูง</option></select>
        </div>${browseCards()}`;
    } else if (tab === 'sell') {
      body = sellCards();
    } else {
      body = mineCards();
    }

    sec.innerHTML = `<main>
      <div class="lb-hero"><div class="lb-hero-title"><small>Badminton Club</small>🏪 Marketplace</div></div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:.8rem;color:var(--muted)">ซื้อ–ขายไอเทมกับเพื่อน</div>
          <div style="font-weight:700">🪙 ${myCoins().toLocaleString()}</div>
        </div>
        <div class="mk-tabs">
          <button class="mk-tab ${tab === 'browse' ? 'on' : ''}" data-tab="browse">🛒 ตลาด</button>
          <button class="mk-tab ${tab === 'sell' ? 'on' : ''}" data-tab="sell">🏷️ ขาย</button>
          <button class="mk-tab ${tab === 'mine' ? 'on' : ''}" data-tab="mine">📦 ของฉัน</button>
        </div>
        ${body}
      </div>
      ${tab === 'browse' ? historyBlock() : ''}
    </main>`;

    // wire controls
    sec.querySelectorAll('.mk-tab').forEach(b => b.addEventListener('click', () => { tab = b.getAttribute('data-tab'); render(); }));
    const cat = sec.querySelector('#mkCat'); if (cat) { cat.value = filterCat; cat.addEventListener('change', () => { filterCat = cat.value; render(); }); }
    const rar = sec.querySelector('#mkRar'); if (rar) { rar.value = filterRar; rar.addEventListener('change', () => { filterRar = rar.value; render(); }); }
    const srt = sec.querySelector('#mkSort'); if (srt) { srt.value = sortMode; srt.addEventListener('change', () => { sortMode = srt.value; render(); }); }
    sec.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => doBuy(+b.getAttribute('data-buy'))));
    sec.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => doCancel(+b.getAttribute('data-cancel'))));
    sec.querySelectorAll('[data-list]').forEach(b => b.addEventListener('click', () => {
      const [k, v] = b.getAttribute('data-list').split('|');
      const inp = sec.querySelector('#mkprice_' + k + '_' + cssId(v));
      doList(k, v, inp ? inp.value : '');
    }));
  }

  async function refreshData() {
    try {
      const [ls, mine, hist] = await Promise.all([
        dbGetListings(), currentUser ? dbGetMyListings(currentUser.id) : [], dbGetMarketHistory(12),
      ]);
      listings = ls || []; myListings = mine || []; history = hist || [];
    } catch (e) { console.warn('[market] load failed:', e && e.message); }
  }

  async function afterMutation() {
    if (typeof loadPlayers === 'function') await loadPlayers();
    await refreshData();
    render();
    if (typeof window.economyRefresh === 'function') { window.MARKET_STATS = undefined; window.economyRefresh(); }
    if (typeof window.collectionRefresh === 'function') window.collectionRefresh();
  }

  // After a successful sale, the sold item is gone server-side, but local
  // caches (bmt_gacha_<id> for elements, bmt_owned_effects_<id> / bmt_gacha_inv_<id>
  // for effects) are UNION-merged with the server on read — they only ever grow,
  // never shrink — so getOwnedSets() would keep showing the sold item as owned
  // on this device forever unless we actively strike it from those caches here.
  function reconcileLocalShadowOnSell(k, v) {
    if (!currentUser) return;
    try {
      if (k === 'elements') {
        const raw = localStorage.getItem('bmt_gacha_' + currentUser.id);
        if (raw) {
          const d = JSON.parse(raw);
          let inv = [];
          try { inv = JSON.parse(d.elementInventory || '[]'); } catch (e) {}
          d.elementInventory = JSON.stringify(inv.filter(e => e !== v));
          if (d.equippedElement === v) { d.equippedElement = null; d.element = null; }
          localStorage.setItem('bmt_gacha_' + currentUser.id, JSON.stringify(d));
        }
      } else if (k === 'effects') {
        const rawEff = localStorage.getItem('bmt_owned_effects_' + currentUser.id);
        if (rawEff !== null) {
          try {
            const arr = (JSON.parse(rawEff) || []).filter(e => e !== v);
            localStorage.setItem('bmt_owned_effects_' + currentUser.id, JSON.stringify(arr));
          } catch (e) {}
        }
        const rawInv = localStorage.getItem('bmt_gacha_inv_' + currentUser.id);
        if (rawInv) {
          try {
            const inv = JSON.parse(rawInv);
            if (Array.isArray(inv.effects)) inv.effects = inv.effects.filter(e => e !== v);
            if (Array.isArray(inv.equippedEffects)) inv.equippedEffects = inv.equippedEffects.filter(e => e !== v);
            localStorage.setItem('bmt_gacha_inv_' + currentUser.id, JSON.stringify(inv));
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  async function doBuy(id) {
    if (busy) return;
    const l = listings.find(x => x.id === id); if (!l) return;
    const iv = itemView(l.item_k, l.item_v);
    if (!confirm('ซื้อ "' + iv.label + '" ราคา 🪙 ' + l.price + ' ?')) return;
    busy = true;
    try {
      const r = await dbMarketBuy(id);
      if (r && r.ok) toastOk('✅ ซื้อสำเร็จ!'); else toastErr('⚠️ ทำรายการไม่สำเร็จ');
    } catch (e) {
      toastErr('⚠️ ' + errMsg(e));
    } finally {
      // always resync, even on an unexpected non-throwing/non-ok response —
      // otherwise a schema drift could leave a sold item showing as available
      await afterMutation();
      busy = false;
    }
  }
  async function doCancel(id) {
    if (busy) return;
    if (!confirm('ยกเลิกรายการขายนี้? ไอเทมจะถูกคืนเข้าคลัง')) return;
    busy = true;
    try {
      const r = await dbMarketCancel(id);
      if (r && r.ok) toastOk('↩️ ยกเลิกแล้ว'); else toastErr('⚠️ ทำรายการไม่สำเร็จ');
    } catch (e) {
      toastErr('⚠️ ' + errMsg(e));
    } finally {
      await afterMutation();
      busy = false;
    }
  }
  async function doList(k, v, rawPrice) {
    if (busy) return;
    // validate the RAW string, not a parseInt() result — parseInt("1e9",10)===1
    // and parseInt("10.99",10)===10, both of which would silently mis-price
    // the listing instead of surfacing an error.
    const trimmed = String(rawPrice == null ? '' : rawPrice).trim();
    if (!/^[0-9]+$/.test(trimmed)) { toastErr('กรุณาใส่ราคาเป็นจำนวนเต็ม 1–1,000,000 (ห้ามมีจุดทศนิยมหรือตัวอักษร)'); return; }
    const price = parseInt(trimmed, 10);
    if (price < 1 || price > 1000000) { toastErr('กรุณาใส่ราคา 1–1,000,000'); return; }
    const iv = itemView(k, v);
    if (!confirm('ลงขาย "' + iv.label + '" ราคา 🪙 ' + price + ' ?\n(ค่าธรรมเนียม 🪙1)')) return;
    busy = true;
    let ok = false;
    try {
      const r = await dbMarketList(k, v, price);
      ok = !!(r && r.ok);
      if (ok) { toastOk('🏷️ ลงขายแล้ว!'); tab = 'mine'; reconcileLocalShadowOnSell(k, v); }
      else toastErr('⚠️ ทำรายการไม่สำเร็จ');
    } catch (e) {
      toastErr('⚠️ ' + errMsg(e));
    } finally {
      if (ok) await afterMutation();
      busy = false;
    }
  }

  function toastOk(m) { if (typeof toast === 'function') toast(m, 'success'); }
  function toastErr(m) { if (typeof toast === 'function') toast(m, 'error'); }
  function escHtml(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function cssId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, c => 'u' + c.codePointAt(0)); }

  async function renderTab() {
    injectStyles();
    render();            // paint shell immediately
    await refreshData();
    render();
  }
  window.marketRenderTab = renderTab;

  function patchRouter() {
    if (window.__mkRouted) return;
    if (typeof showSection !== 'function') return;
    window.__mkRouted = true;
    const orig = showSection;
    showSection = function (name) {
      orig(name);
      if (name === 'market') renderTab();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchRouter);
  else patchRouter();
})();
