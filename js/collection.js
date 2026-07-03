/* ═══════════════════════════════════════════════════════════════
   BK CLUB — COLLECTION BOOK (System 3)
   Read-only "dex" over the shared GAME_CATALOG. Shows owned vs missing
   items per category, completion %, and the rarest item owned.
   Zero DB writes — pure read of existing inventory. Safe by design.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── one-time scoped styles ──────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('cb-styles')) return;
    const s = document.createElement('style');
    s.id = 'cb-styles';
    s.textContent = `
      .cb-hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
      .cb-ring{--p:0;width:96px;height:96px;border-radius:50%;flex-shrink:0;
        background:conic-gradient(var(--neon,#0f8) calc(var(--p)*1%),rgba(255,255,255,.08) 0);
        display:grid;place-items:center;position:relative;transition:--p .8s ease}
      .cb-ring::after{content:'';position:absolute;inset:8px;border-radius:50%;background:var(--card-bg,#12121e)}
      .cb-ring-num{position:relative;z-index:1;font-family:'Fredoka One',cursive;font-size:1.35rem;line-height:1}
      .cb-ring-sub{position:relative;z-index:1;font-size:.6rem;color:var(--muted);letter-spacing:1px}
      .cb-hero-meta{flex:1;min-width:150px}
      .cb-hero-meta h3{font-family:'Fredoka One',cursive;letter-spacing:1px;margin:0 0 4px;font-size:1.1rem}
      .cb-rarest{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;
        font-size:.72rem;font-weight:600;border:1px solid;margin-top:4px}
      .cb-cat{margin-top:14px}
      .cb-cat-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
      .cb-cat-title{font-weight:700;font-size:.9rem;display:flex;align-items:center;gap:7px}
      .cb-cat-count{font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums}
      .cb-bar{height:5px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden;margin-bottom:12px}
      .cb-bar-fill{height:100%;border-radius:5px;transition:width .7s ease}
      .cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:9px}
      .cb-cell{position:relative;border-radius:14px;padding:12px 6px 9px;text-align:center;
        border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);
        transition:transform .18s ease,box-shadow .18s ease;overflow:hidden}
      .cb-cell.owned{cursor:default}
      .cb-cell.owned:hover{transform:translateY(-3px)}
      .cb-cell.missing{filter:grayscale(1);opacity:.5}
      .cb-cell-glyph{font-size:1.55rem;line-height:1;margin-bottom:6px;display:block}
      .cb-cell.missing .cb-cell-glyph{filter:blur(3px)}
      .cb-cell-name{font-size:.64rem;line-height:1.25;color:var(--muted);
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .cb-cell-rar{position:absolute;top:5px;right:6px;width:7px;height:7px;border-radius:50%}
      .cb-cell.owned::before{content:'';position:absolute;inset:0;border-radius:14px;
        border:1px solid var(--rc,#0f8);opacity:.55;pointer-events:none}
      .cb-cell-lock{position:absolute;top:6px;left:7px;font-size:.7rem;opacity:.8}
      .cb-legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;justify-content:center}
      .cb-leg{display:inline-flex;align-items:center;gap:5px;font-size:.68rem;color:var(--muted)}
      .cb-leg i{width:9px;height:9px;border-radius:50%}
    `;
    document.head.appendChild(s);
  }

  function cell(item, owned) {
    const meta = window.catalogRarityMeta(item.rarity);
    const glyph = (item.category === 'emoji' || item.category === 'element')
      ? item.value                                   // show the emoji/element char itself
      : (item.label.match(/^\s*(\p{Emoji})/u) ? RegExp.$1 : '❔'); // leading emoji of label
    const name = owned ? item.label.replace(/^\s*\p{Emoji}️?\s*/u, '') : '???';
    return `<div class="cb-cell ${owned ? 'owned' : 'missing'}" style="--rc:${meta.color}"
        title="${owned ? item.label + ' · ' + meta.label : 'ยังไม่ปลดล็อก'}">
        <span class="cb-cell-rar" style="background:${meta.color}"></span>
        ${owned ? '' : '<span class="cb-cell-lock">🔒</span>'}
        <span class="cb-cell-glyph">${owned ? glyph : '❔'}</span>
        <span class="cb-cell-name" style="${owned ? 'color:' + meta.color : ''}">${name}</span>
      </div>`;
  }

  function renderTab() {
    injectStyles();
    const sec = document.getElementById('collectionSection');
    if (!sec || !window.GAME_CATALOG) return;
    if (typeof currentUser === 'undefined' || !currentUser) {
      sec.innerHTML = '<main><div class="card"><div class="text-muted" style="text-align:center;padding:24px">กรุณาเข้าสู่ระบบ</div></div></main>';
      return;
    }
    const uid = currentUser.id;
    const stats = window.getCollectionStats(uid);
    const owned = window.getOwnedSets(uid);

    // hero
    let rarestHtml = '<span style="color:var(--muted);font-size:.75rem">ยังไม่มีไอเทม</span>';
    if (stats.rarest) {
      const m = window.catalogRarityMeta(stats.rarest.rarity);
      rarestHtml = `<span class="cb-rarest" style="color:${m.color};border-color:${m.color}55;background:${m.color}12">
        💎 ${stats.rarest.label} · ${m.label}</span>`;
    }
    let html = `<main>
      <div class="lb-hero"><div class="lb-hero-title"><small>Badminton Club</small>📖 Collection Book</div></div>
      <div class="card">
        <div class="cb-hero">
          <div class="cb-ring" style="--p:${stats.pct}">
            <span class="cb-ring-num">${stats.pct}%</span>
            <span class="cb-ring-sub">COMPLETE</span>
          </div>
          <div class="cb-hero-meta">
            <h3>${stats.owned} / ${stats.total} <span style="color:var(--muted);font-size:.8rem;font-family:inherit">ไอเทม</span></h3>
            <div style="font-size:.75rem;color:var(--muted);margin-bottom:2px">ไอเทมหายากที่สุดของคุณ</div>
            ${rarestHtml}
          </div>
        </div>
      </div>`;

    // per-category
    window.CATALOG_CATEGORIES.forEach(cat => {
      const items = window.GAME_CATALOG.filter(it => it.category === cat.key)
        .sort((a, b) => window.catalogRarityOrder(a.rarity) - window.catalogRarityOrder(b.rarity));
      if (!items.length) return;
      const pc = stats.perCategory[cat.key];
      const pct = pc.total ? Math.round(pc.owned / pc.total * 100) : 0;
      const done = pc.owned === pc.total && pc.total > 0;
      html += `<div class="card cb-cat">
        <div class="cb-cat-head">
          <div class="cb-cat-title">${cat.icon} ${cat.label} <span style="color:var(--muted);font-weight:400;font-size:.72rem">${cat.th}</span>${done ? ' <span style="color:var(--gold)">✓</span>' : ''}</div>
          <div class="cb-cat-count">${pc.owned}/${pc.total}</div>
        </div>
        <div class="cb-bar"><div class="cb-bar-fill" style="width:${pct}%;background:${done ? 'var(--gold,#fbbf24)' : 'var(--neon2,#0f8)'}"></div></div>
        <div class="cb-grid">${items.map(it => cell(it, owned[it.invKey] && owned[it.invKey].has(window.catalogCanonValue(it.value)))).join('')}</div>
      </div>`;
    });

    // rarity legend
    html += '<div class="card"><div class="cb-legend">';
    Object.keys(window.CATALOG_RARITY)
      .sort((a, b) => window.CATALOG_RARITY[a].order - window.CATALOG_RARITY[b].order)
      .forEach(k => {
        const m = window.CATALOG_RARITY[k];
        html += `<span class="cb-leg"><i style="background:${m.color}"></i>${m.label}</span>`;
      });
    html += '</div></div></main>';

    sec.innerHTML = html;
    // animate the ring after paint
    requestAnimationFrame(() => {
      const ring = sec.querySelector('.cb-ring');
      if (ring) { ring.style.setProperty('--p', '0'); requestAnimationFrame(() => ring.style.setProperty('--p', stats.pct)); }
    });
  }
  window.collectionRenderTab = renderTab;

  // Called by Fusion/Marketplace after a mutation so an already-open
  // Collection tab reflects the change immediately (same pattern as
  // economy.js's economyRefresh — no-op if the tab isn't currently visible,
  // since renderTab() runs fresh from live data on the next navigation anyway).
  window.collectionRefresh = function () {
    const sec = document.getElementById('collectionSection');
    if (sec && sec.classList.contains('active')) renderTab();
  };

  // ── hook into the section router (same pattern as gacha-element.js) ─
  function patchRouter() {
    if (window.__cbRouted) return;
    if (typeof showSection !== 'function') return;
    window.__cbRouted = true;
    const orig = showSection;
    showSection = function (name) {
      orig(name);
      if (name === 'collection') renderTab();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchRouter);
  else patchRouter();
})();
