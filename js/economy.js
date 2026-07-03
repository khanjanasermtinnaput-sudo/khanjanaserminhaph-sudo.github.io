/* ═══════════════════════════════════════════════════════════════
   BK CLUB — ECONOMY DASHBOARD (System 4)
   Read-only, real-time-ready aggregation over the whole player base and
   the shared GAME_CATALOG. Recomputes from live db.players every time it
   is shown, and exposes window.economyRefresh() so Fusion / Marketplace
   can trigger an update after a transaction.
   Market/Fusion tiles read window.MARKET_STATS / window.FUSION_STATS if
   those systems have populated them; otherwise they show a "soon" state.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function injectStyles() {
    if (document.getElementById('ec-styles')) return;
    const s = document.createElement('style');
    s.id = 'ec-styles';
    s.textContent = `
      .ec-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
      .ec-tile{border-radius:16px;padding:14px 14px 12px;border:1px solid rgba(255,255,255,.08);
        background:rgba(255,255,255,.02);position:relative;overflow:hidden}
      .ec-tile-ic{font-size:1.15rem;line-height:1}
      .ec-tile-val{font-family:'Fredoka One',cursive;font-size:1.5rem;line-height:1.1;margin:6px 0 2px}
      .ec-tile-lbl{font-size:.7rem;color:var(--muted)}
      .ec-tile-sub{font-size:.64rem;color:var(--muted);margin-top:3px;opacity:.8}
      .ec-soon{opacity:.55}
      .ec-soon .ec-tile-val{font-size:1.05rem;color:var(--muted)}
      .ec-row{display:flex;align-items:center;gap:10px;margin-bottom:9px}
      .ec-row-rank{width:20px;text-align:center;font-size:.8rem;color:var(--muted);flex-shrink:0}
      .ec-row-body{flex:1;min-width:0}
      .ec-row-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:3px}
      .ec-row-name{font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ec-row-num{font-size:.75rem;color:var(--muted);flex-shrink:0;font-variant-numeric:tabular-nums}
      .ec-mini{height:5px;border-radius:5px;background:rgba(255,255,255,.07);overflow:hidden}
      .ec-mini-fill{height:100%;border-radius:5px;transition:width .7s ease}
      .ec-rar{display:flex;flex-wrap:wrap;gap:7px}
      .ec-rar-chip{display:flex;align-items:center;gap:6px;font-size:.72rem;padding:5px 10px;border-radius:20px;
        border:1px solid;font-variant-numeric:tabular-nums}
      .ec-rar-chip i{width:8px;height:8px;border-radius:50%}
      .ec-empty{color:var(--muted);font-size:.78rem;text-align:center;padding:14px}
    `;
    document.head.appendChild(s);
  }

  function compute() {
    const players = (typeof db !== 'undefined' && db.players) ? db.players : [];
    const cat = window.GAME_CATALOG || [];
    const ownCount = {}; cat.forEach(it => ownCount[it.id] = 0);
    const rarityInstances = {};
    let totalCoins = 0, totalItems = 0, collectors = 0;

    players.forEach(p => {
      totalCoins += (p.coins || 0);
      const sets = window.getOwnedSets(p.id);
      let owns = 0;
      cat.forEach(it => {
        const set = sets[it.invKey];
        if (set && set.has(window.catalogCanonValue(it.value))) {
          ownCount[it.id]++; owns++;
          rarityInstances[it.rarity] = (rarityInstances[it.rarity] || 0) + 1;
        }
      });
      totalItems += owns;
      if (owns > 0) collectors++;
    });

    const mostOwned = cat.map(it => ({ it, n: ownCount[it.id] }))
      .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 6);
    let rarest = null;
    cat.forEach(it => {
      if (ownCount[it.id] > 0 &&
        (!rarest || window.catalogRarityOrder(it.rarity) > window.catalogRarityOrder(rarest.rarity)))
        rarest = it;
    });
    const rarestHolders = rarest ? ownCount[rarest.id] : 0;
    const coinLeaders = [...players].sort((a, b) => (b.coins || 0) - (a.coins || 0))
      .filter(p => (p.coins || 0) > 0).slice(0, 5);

    return { players: players.length, totalCoins, totalItems, collectors,
      mostOwned, rarest, rarestHolders, rarityInstances, coinLeaders };
  }

  function tile(icon, val, lbl, sub, soon) {
    return `<div class="ec-tile${soon ? ' ec-soon' : ''}">
      <div class="ec-tile-ic">${icon}</div>
      <div class="ec-tile-val">${val}</div>
      <div class="ec-tile-lbl">${lbl}</div>
      ${sub ? `<div class="ec-tile-sub">${sub}</div>` : ''}
    </div>`;
  }
  const fmt = n => (n || 0).toLocaleString();

  function renderTab() {
    injectStyles();
    const sec = document.getElementById('economySection');
    if (!sec || !window.GAME_CATALOG) return;
    const d = compute();

    const market = window.MARKET_STATS || null;   // populated by Marketplace phase
    const fusion = window.FUSION_STATS || null;    // populated by Fusion phase

    const rarestChip = d.rarest
      ? (() => { const m = window.catalogRarityMeta(d.rarest.rarity);
          return `<span style="color:${m.color}">${d.rarest.label}</span>`; })()
      : '<span style="color:var(--muted)">—</span>';

    let html = `<main>
      <div class="lb-hero"><div class="lb-hero-title"><small>Badminton Club</small>📊 Economy</div></div>

      <div class="card">
        <div class="ec-tiles">
          ${tile('🪙', fmt(d.totalCoins), 'เหรียญหมุนเวียนทั้งหมด', d.players + ' ผู้เล่น')}
          ${tile('📦', fmt(d.totalItems), 'ไอเทมในระบบ', d.collectors + ' นักสะสม')}
          ${tile('💎', rarestChip, 'ไอเทมหายากที่สุด', d.rarest ? ('มี ' + d.rarestHolders + ' คนถือครอง') : '')}
          ${tile('🎴', fmt(window.GAME_CATALOG.length), 'ไอเทมทั้งหมดในแคตตาล็อก', 'ที่หาได้')}
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="font-size:.9rem">🔄 Fusion &amp; 🏪 Market</div>
        <div class="ec-tiles">
          ${fusion
            ? tile('🔄', fmt(fusion.count), 'จำนวนการหลอม', (fusion.itemsCreated || 0) + ' ไอเทมใหม่')
            : tile('🔄', 'เร็วๆ นี้', 'Fusion Lab', 'ยังไม่เปิด', true)}
          ${market
            ? tile('🏪', fmt(market.volume), 'มูลค่าตลาดรวม', (market.activeListings || 0) + ' รายการขาย')
            : tile('🏪', 'เร็วๆ นี้', 'Marketplace', 'ยังไม่เปิด', true)}
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="font-size:.9rem">🏆 ไอเทมยอดนิยม (ถือครองมากสุด)</div>
        ${d.mostOwned.length ? d.mostOwned.map((x, i) => {
          const m = window.catalogRarityMeta(x.it.rarity);
          const pct = d.players ? Math.round(x.n / d.players * 100) : 0;
          return `<div class="ec-row">
            <div class="ec-row-rank">${i + 1}</div>
            <div class="ec-row-body">
              <div class="ec-row-top">
                <div class="ec-row-name" style="color:${m.color}">${x.it.label}</div>
                <div class="ec-row-num">${x.n} คน</div>
              </div>
              <div class="ec-mini"><div class="ec-mini-fill" style="width:${pct}%;background:${m.color}"></div></div>
            </div>
          </div>`;
        }).join('') : '<div class="ec-empty">ยังไม่มีใครมีไอเทม</div>'}
      </div>

      <div class="card">
        <div class="card-title" style="font-size:.9rem">🎨 การกระจายตามความหายาก</div>
        <div class="ec-rar">
          ${Object.keys(window.CATALOG_RARITY)
            .sort((a, b) => window.CATALOG_RARITY[a].order - window.CATALOG_RARITY[b].order)
            .map(k => { const m = window.CATALOG_RARITY[k]; const n = d.rarityInstances[k] || 0;
              return `<span class="ec-rar-chip" style="color:${m.color};border-color:${m.color}55;background:${m.color}10">
                <i style="background:${m.color}"></i>${m.label} · ${n}</span>`; }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="font-size:.9rem">🪙 ผู้ถือเหรียญสูงสุด</div>
        ${d.coinLeaders.length ? d.coinLeaders.map((p, i) => {
          const medal = ['🥇', '🥈', '🥉'][i] || (i + 1);
          const max = d.coinLeaders[0].coins || 1;
          const pct = Math.round((p.coins || 0) / max * 100);
          return `<div class="ec-row">
            <div class="ec-row-rank">${medal}</div>
            <div class="ec-row-body">
              <div class="ec-row-top">
                <div class="ec-row-name">${(typeof esc === 'function' ? esc(p.name) : p.name)}</div>
                <div class="ec-row-num">🪙 ${fmt(p.coins)}</div>
              </div>
              <div class="ec-mini"><div class="ec-mini-fill" style="width:${pct}%;background:var(--gold,#fbbf24)"></div></div>
            </div>
          </div>`;
        }).join('') : '<div class="ec-empty">ยังไม่มีข้อมูลเหรียญ</div>'}
      </div>
    </main>`;

    sec.innerHTML = html;
  }
  window.economyRenderTab = renderTab;
  window.economyRefresh = function () {
    const sec = document.getElementById('economySection');
    if (sec && sec.classList.contains('active')) renderTab();
  };

  function patchRouter() {
    if (window.__ecRouted) return;
    if (typeof showSection !== 'function') return;
    window.__ecRouted = true;
    const orig = showSection;
    showSection = function (name) {
      orig(name);
      if (name === 'economy') renderTab();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchRouter);
  else patchRouter();
})();
