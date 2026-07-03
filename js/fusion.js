/* ═══════════════════════════════════════════════════════════════
   BK CLUB — FUSION LAB (System 1)
   Database-driven recipes (fusion_recipes). Combine several DIFFERENT
   owned items into a rarer one. All validation + the atomic swap happen
   server-side in fuse_items() (SECURITY DEFINER, acting player resolved
   from the x-player-token header — clients can't fuse another player's
   items or forge a balance). Secret recipes stay masked until discovered.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  let recipes = [];
  let busy = false;

  const ERR_TH = {
    insufficient_coins: 'เหรียญไม่พอ',
    already_owns_output: 'คุณมีไอเทมผลลัพธ์นี้อยู่แล้ว',
    not_authenticated: 'กรุณาเข้าสู่ระบบใหม่',
    recipe_not_found: 'ไม่พบสูตร',
    player_not_found: 'ไม่พบผู้เล่น',
  };
  function errMsg(e) {
    const code = (typeof economyErrCode === 'function') ? economyErrCode(e) : (e && e.message) || '';
    if (ERR_TH[code]) return ERR_TH[code];
    if (/^missing_input:/.test(code)) return 'ขาดวัตถุดิบ: ' + code.split(':')[1];
    return code || 'หลอมไม่สำเร็จ';
  }

  function injectStyles() {
    if (document.getElementById('fu-styles')) return;
    const s = document.createElement('style');
    s.id = 'fu-styles';
    s.textContent = `
      .fu-recipe{border-radius:16px;border:1px solid rgba(168,85,247,.22);
        background:rgba(168,85,247,.05);padding:14px;margin-bottom:12px;position:relative;overflow:hidden}
      .fu-recipe.fu-ready{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.06)}
      .fu-recipe.fu-secret{border-color:rgba(0,212,255,.3);background:rgba(0,212,255,.05)}
      .fu-title{font-weight:700;font-size:.92rem;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px}
      .fu-cost{font-size:.75rem;color:var(--gold,#fbbf24);flex-shrink:0}
      .fu-flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .fu-chip{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:66px;
        padding:9px 8px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.02)}
      .fu-chip.fu-miss{opacity:.45;filter:grayscale(1)}
      .fu-chip.fu-have{border-color:var(--cc,#34d399)}
      .fu-chip-glyph{font-size:1.4rem;line-height:1}
      .fu-chip-name{font-size:.6rem;color:var(--muted);text-align:center;line-height:1.2;
        max-width:70px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .fu-chip-tick{font-size:.6rem}
      .fu-arrow{font-size:1.1rem;color:#c084fc;flex-shrink:0}
      .fu-out{border-width:2px}
      .fu-btn{width:100%;margin-top:12px;padding:11px;border-radius:12px;border:none;cursor:pointer;
        font-family:'Fredoka One',cursive;letter-spacing:1px;font-size:.95rem;
        background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;transition:filter .2s}
      .fu-btn:disabled{opacity:.4;cursor:not-allowed;filter:grayscale(.4)}
      .fu-btn.fu-go{background:linear-gradient(135deg,#059669,#34d399)}
      .fu-hint{font-size:.68rem;color:var(--muted);text-align:center;margin-top:7px}
      .fu-secret-q{font-size:2rem;text-align:center;padding:6px}
      .fu-log-row{display:flex;align-items:center;gap:8px;font-size:.76rem;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)}
      .fu-log-row:last-child{border-bottom:none}
      .fu-log-time{margin-left:auto;color:var(--muted);font-size:.68rem}
      @keyframes fuBurst{0%{transform:scale(.4);opacity:0}45%{transform:scale(1.15);opacity:1}100%{transform:scale(1);opacity:1}}
      .fu-burst{position:fixed;inset:0;z-index:9998;display:grid;place-items:center;background:rgba(0,0,0,.6);backdrop-filter:blur(3px)}
      .fu-burst-card{text-align:center;animation:fuBurst .6s cubic-bezier(.2,1.4,.4,1) both;padding:26px 34px;
        border-radius:20px;border:1px solid var(--bc,#c084fc);background:rgba(20,10,35,.9);box-shadow:0 0 40px var(--bc,#c084fc)}
      .fu-burst-glyph{font-size:3.4rem;line-height:1}
      .fu-burst-name{font-family:'Fredoka One',cursive;margin-top:8px;font-size:1.1rem}
      .fu-burst-sub{font-size:.72rem;color:var(--muted);margin-top:4px}
    `;
    document.head.appendChild(s);
  }

  function glyphOf(item, fallback) {
    if (!item) return fallback || '❔';
    if (item.category === 'emoji' || item.category === 'element') return item.value;
    const m = item.label.match(/^\s*(\p{Emoji})/u);
    return m ? m[1] : (fallback || '❔');
  }
  function labelOf(item, k, v) { return item ? item.label.replace(/^\s*\p{Emoji}️?\s*/u, '') : v; }

  function chip(k, v, owned, isOutput, outLabel, outRarity) {
    const item = window.getCatalogByInv ? window.getCatalogByInv(k, v) : null;
    const rarity = isOutput ? (outRarity || (item && item.rarity)) : (item && item.rarity);
    const meta = window.catalogRarityMeta(rarity || 'common');
    const glyph = glyphOf(item, isOutput ? '✨' : '❔');
    const nm = isOutput ? (outLabel ? outLabel.replace(/^\s*\p{Emoji}️?\s*/u, '') : labelOf(item, k, v)) : labelOf(item, k, v);
    const cls = isOutput ? 'fu-chip fu-out fu-have' : ('fu-chip ' + (owned ? 'fu-have' : 'fu-miss'));
    return `<div class="${cls}" style="--cc:${meta.color}${isOutput ? ';border-color:' + meta.color : ''}">
      <span class="fu-chip-glyph">${glyph}</span>
      <span class="fu-chip-name" style="${isOutput || owned ? 'color:' + meta.color : ''}">${nm}</span>
      ${isOutput ? '' : `<span class="fu-chip-tick">${owned ? '✅' : '🔒'}</span>`}
    </div>`;
  }

  function render() {
    injectStyles();
    const sec = document.getElementById('fusionSection');
    if (!sec) return;
    if (typeof currentUser === 'undefined' || !currentUser) {
      sec.innerHTML = '<main><div class="card"><div class="text-muted" style="text-align:center;padding:24px">กรุณาเข้าสู่ระบบ</div></div></main>';
      return;
    }
    const coins = (typeof getEffectiveCoins === 'function') ? getEffectiveCoins(currentUser.id)
      : ((db.players.find(p => p.id === currentUser.id) || {}).coins || 0);

    let cards = '';
    recipes.forEach(r => {
      if (r.secret && !r.discovered) {
        cards += `<div class="fu-recipe fu-secret">
          <div class="fu-title"><span>❔ สูตรลับ</span><span class="fu-cost">🪙 ${r.coin_cost}</span></div>
          <div class="fu-secret-q">🔒</div>
          <div class="fu-hint">รวบรวมวัตถุดิบที่ถูกต้องเพื่อค้นพบสูตรนี้</div>
        </div>`;
        return;
      }
      const inputs = r.inputs || [];
      const flow = inputs.map((inp, i) => {
        const owned = ownsInput(inp.k, inp.v);
        return chip(inp.k, inp.v, owned, false) + (i < inputs.length - 1 ? '<span class="fu-arrow">+</span>' : '');
      }).join('');
      const out = r.output || {};
      const canFuse = r.owns_all && coins >= r.coin_cost;
      const ready = r.owns_all;
      cards += `<div class="fu-recipe ${ready ? 'fu-ready' : ''}">
        <div class="fu-title"><span>${r.secret ? '🔓 ' : ''}${r.name}</span><span class="fu-cost">🪙 ${r.coin_cost}</span></div>
        <div class="fu-flow">${flow}<span class="fu-arrow">➜</span>${chip(out.k, out.v, true, true, out.label, out.rarity)}</div>
        <button class="fu-btn ${canFuse ? 'fu-go' : ''}" ${canFuse ? '' : 'disabled'} data-recipe="${r.id}">
          ${r.owns_all ? '🔨 หลอม' : 'ขาดวัตถุดิบ'}${(r.owns_all && coins < r.coin_cost) ? ' (เหรียญไม่พอ)' : ''}
        </button>
      </div>`;
    });

    sec.innerHTML = `<main>
      <div class="lb-hero"><div class="lb-hero-title"><small>Badminton Club</small>🔬 Fusion Lab</div></div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-size:.8rem;color:var(--muted)">หลอมไอเทมหลายชิ้นเป็นของหายากกว่า</div>
          <div style="font-weight:700">🪙 <span id="fuCoinBal">${coins}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title" style="font-size:.9rem;color:#c084fc">⚗️ สูตรการหลอม</div>
        ${cards || '<div class="text-muted" style="text-align:center;padding:16px;font-size:.8rem">ยังไม่มีสูตร</div>'}
      </div>
      <div class="card">
        <div class="card-title" style="font-size:.9rem">📜 ประวัติการหลอม</div>
        <div id="fuLog"><div class="text-muted" style="text-align:center;padding:12px;font-size:.78rem">⏳ กำลังโหลด...</div></div>
      </div>
    </main>`;

    sec.querySelectorAll('.fu-btn[data-recipe]').forEach(btn => {
      btn.addEventListener('click', () => doFuse(btn.getAttribute('data-recipe')));
    });
    loadLog();
  }

  function ownsInput(k, v) {
    if (!currentUser || typeof window.getOwnedSets !== 'function') return false;
    const sets = window.getOwnedSets(currentUser.id);
    const s = sets[k];
    return !!(s && s.has(window.catalogCanonValue(v)));
  }

  async function loadRecipes() {
    try { recipes = await dbListFusionRecipes(); }
    catch (e) { recipes = []; console.warn('[fusion] list failed:', e && e.message); }
  }

  async function loadLog() {
    const el = document.getElementById('fuLog');
    if (!el || !currentUser) return;
    try {
      const rows = await dbGetFusionLog(currentUser.id, 15);
      if (!rows || !rows.length) { el.innerHTML = '<div class="text-muted" style="text-align:center;padding:10px;font-size:.76rem">ยังไม่มีประวัติ</div>'; return; }
      el.innerHTML = rows.map(row => {
        const item = window.getCatalogByInv ? window.getCatalogByInv(row.output_k, row.output_v) : null;
        const meta = window.catalogRarityMeta(item ? item.rarity : 'common');
        const when = new Date(row.fused_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        return `<div class="fu-log-row">
          <span>${glyphOf(item, '✨')}</span>
          <span style="color:${meta.color}">${item ? item.label : row.output_v}</span>
          <span class="fu-log-time">🪙${row.coins_spent} · ${when}</span>
        </div>`;
      }).join('');
    } catch (e) { el.innerHTML = '<div class="text-muted" style="text-align:center;padding:10px;font-size:.76rem">โหลดประวัติไม่ได้</div>'; }
  }

  async function doFuse(recipeId) {
    if (busy) return;
    const r = recipes.find(x => x.id === recipeId);
    if (!r) return;
    if (!confirm('ยืนยันการหลอม "' + r.name + '"?\nวัตถุดิบจะถูกใช้ไปและใช้ 🪙 ' + r.coin_cost)) return;
    busy = true;
    try {
      const res = await dbFuseItems(recipeId);
      if (res && res.ok) {
        if (typeof loadPlayers === 'function') await loadPlayers();
        burst(res.output);
        if (typeof toast === 'function') toast('✨ หลอมสำเร็จ!', 'success');
        await loadRecipes();
        render();
        // refresh sibling systems
        if (typeof window.economyRefresh === 'function') { window.FUSION_STATS = undefined; window.economyRefresh(); }
      } else {
        if (typeof toast === 'function') toast('หลอมไม่สำเร็จ', 'error');
      }
    } catch (e) {
      if (typeof toast === 'function') toast('⚠️ ' + errMsg(e), 'error');
    } finally { busy = false; }
  }

  function burst(output) {
    if (!output) return;
    const item = window.getCatalogByInv ? window.getCatalogByInv(output.k, output.v) : null;
    const meta = window.catalogRarityMeta(output.rarity || (item && item.rarity) || 'legendary');
    const el = document.createElement('div');
    el.className = 'fu-burst';
    el.innerHTML = `<div class="fu-burst-card" style="--bc:${meta.color}">
      <div class="fu-burst-glyph">${glyphOf(item, '✨')}</div>
      <div class="fu-burst-name" style="color:${meta.color}">${output.label || (item && item.label) || output.v}</div>
      <div class="fu-burst-sub">${meta.label} · หลอมสำเร็จ</div>
    </div>`;
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  async function renderTab() {
    injectStyles();
    await loadRecipes();
    render();
  }
  window.fusionRenderTab = renderTab;

  function patchRouter() {
    if (window.__fuRouted) return;
    if (typeof showSection !== 'function') return;
    window.__fuRouted = true;
    const orig = showSection;
    showSection = function (name) {
      orig(name);
      if (name === 'fusion') renderTab();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchRouter);
  else patchRouter();
})();
