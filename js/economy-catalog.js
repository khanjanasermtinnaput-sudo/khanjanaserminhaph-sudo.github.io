/* ═══════════════════════════════════════════════════════════════
   BK CLUB — ECONOMY CATALOG (shared backbone)
   Single source of truth for every obtainable cosmetic item.
   Collection Book, Fusion Lab, Marketplace and Economy Dashboard all
   read from window.GAME_CATALOG so a new item is added in ONE place.

   Storage reality this maps onto (see gacha.js / gacha-element.js):
     • frames  → players.gacha_inventory.frames[]   (equip: gacha_frame)
     • names   → players.gacha_inventory.names[]     (equip: gacha_name)
     • emojis  → players.gacha_inventory.emojis[]    (equip: gacha_emoji)
     • effects → players.owned_effects[] / .effects[]
     • elements→ players.gacha_inventory.elements[]  (equip: equippedElement)
   Each catalog item's { invKey, value } locates it in that inventory.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Rarity tiers (order drives sort + "rarest owned") ───────────
  const RARITY = {
    common:    { order: 0, label: 'Common',    th: 'ธรรมดา',    color: '#9ca3af' },
    uncommon:  { order: 1, label: 'Uncommon',  th: 'หายากกลาง', color: '#34d399' },
    rare:      { order: 2, label: 'Rare',      th: 'หายาก',     color: '#60a5fa' },
    epic:      { order: 3, label: 'Epic',      th: 'เอปิก',     color: '#c084fc' },
    mythic:    { order: 4, label: 'Mythic',    th: 'มิธิก',     color: '#f97316' },
    legendary: { order: 5, label: 'Legendary', th: 'เลเจนดารี', color: '#fbbf24' },
    secret:    { order: 6, label: 'Secret',    th: 'ซีเคร็ต',   color: '#00d4ff' },
  };
  function rarityMeta(r) { return RARITY[r] || RARITY.common; }
  function rarityOrder(r) { return rarityMeta(r).order; }

  // ── Categories ──────────────────────────────────────────────────
  const CATEGORIES = [
    { key: 'frame',   invKey: 'frames',   label: 'Frame',        th: 'กรอบ',       icon: '🖼️' },
    { key: 'name',    invKey: 'names',    label: 'Name Effect',  th: 'ชื่อเอฟเฟกต์', icon: '✨' },
    { key: 'emoji',   invKey: 'emojis',   label: 'Emoji',        th: 'อีโมจิ',      icon: '🎭' },
    { key: 'element', invKey: 'elements', label: 'Element',      th: 'ธาตุ',        icon: '☯️' },
    { key: 'effect',  invKey: 'effects',  label: 'Special',      th: 'เอฟเฟกต์',    icon: '⚡' },
  ];

  // helper to declare an item compactly
  function I(category, invKey, value, rarity, label) {
    return { id: category + ':' + value, category, invKey, value, rarity, label };
  }

  // ── THE CATALOG ─────────────────────────────────────────────────
  // (labels match the wording already shown in gacha.js / gacha-element.js)
  const CATALOG = [
    // Frames -------------------------------------------------------
    I('frame', 'frames', 'rainbow',      'uncommon', '🌈 Rainbow'),
    I('frame', 'frames', 'robot',        'uncommon', '🤖 Robot'),
    I('frame', 'frames', 'ice',          'rare',     '❄️ Phantom Ice'),
    I('frame', 'frames', 'blaze',        'rare',     '🔥 Crimson Blaze'),
    I('frame', 'frames', 'void',         'epic',     '🌑 Void Abyss'),
    I('frame', 'frames', 'halo',         'epic',     '✨ Celestial Halo'),
    I('frame', 'frames', 'solaremperor', 'secret',   '👑 Solar Emperor'),
    // Name effects -------------------------------------------------
    I('name', 'names', 'ice',          'rare',   '❄️ Ice Script'),
    I('name', 'names', 'blaze',        'rare',   '🔥 Blaze Script'),
    I('name', 'names', 'void',         'epic',   '🌑 Void Corruption'),
    I('name', 'names', 'halo',         'epic',   '✨ Celestial Script'),
    I('name', 'names', 'solaremperor', 'secret', '☀️ Solar Script'),
    // Emojis (common gacha pool) -----------------------------------
    I('emoji', 'emojis', '🏸', 'common', '🏸 Shuttlecock'),
    I('emoji', 'emojis', '🔥', 'common', '🔥 Fire'),
    I('emoji', 'emojis', '⚡', 'common', '⚡ Bolt'),
    I('emoji', 'emojis', '🌟', 'common', '🌟 Star'),
    I('emoji', 'emojis', '💥', 'common', '💥 Boom'),
    I('emoji', 'emojis', '🎯', 'common', '🎯 Target'),
    I('emoji', 'emojis', '🦅', 'common', '🦅 Eagle'),
    I('emoji', 'emojis', '🌊', 'common', '🌊 Wave'),
    // Elements -----------------------------------------------------
    I('element', 'elements', 'earth',     'common',   '🌍 TERRA ดิน'),
    I('element', 'elements', 'water',     'uncommon', '💧 AQUA น้ำ'),
    I('element', 'elements', 'wind',      'uncommon', '🌀 ZEPHYR ลม'),
    I('element', 'elements', 'fire',      'mythic',   '🔥 IGNIS ไฟ'),
    I('element', 'elements', 'lightning', 'mythic',   '⚡ VOLT สายฟ้า'),
    I('element', 'elements', 'yinyang',   'secret',   '☯️ YIN YANG'),
    // Special effects ----------------------------------------------
    I('effect', 'effects', 'rotating_arcs', 'secret', '⚡ Thunder God'),
  ];

  const byId = {};
  CATALOG.forEach(it => { byId[it.id] = it; });

  // Legacy value aliases so ownership checks match older data.
  // 'solar' was the old key for what is now 'solaremperor'.
  const VALUE_ALIASES = { solar: 'solaremperor' };
  function canon(v) { return VALUE_ALIASES[v] || v; }

  // ── Ownership: merge EVERY place an item can live ───────────────
  // Reuses getGachaInventory (LS+DB frames/names/emojis/effects), then
  // folds in element inventory + equipped scalar columns.
  function getOwnedSets(playerId) {
    const pl = (typeof db !== 'undefined' && db.players)
      ? db.players.find(x => x.id === playerId) : null;
    const base = (typeof getGachaInventory === 'function')
      ? getGachaInventory(playerId)
      : { frames: [], names: [], emojis: [], effects: [] };

    const sets = {
      frames:  new Set((base.frames  || []).map(canon)),
      names:   new Set((base.names   || []).map(canon)),
      emojis:  new Set(base.emojis   || []),
      effects: new Set(base.effects  || []),
      elements: new Set(),
    };

    // equipped scalars are always owned
    if (pl) {
      if (pl.gachaFrame) sets.frames.add(canon(pl.gachaFrame));
      if (pl.gachaName)  sets.names.add(canon(pl.gachaName));
      if (pl.gachaEmoji) sets.emojis.add(pl.gachaEmoji);
      (pl.ownedEffects || []).forEach(e => sets.effects.add(e));
      const dbInv = pl._dbGachaInv || {};
      (dbInv.elements || []).forEach(e => sets.elements.add(e));
    }
    // element system's own localStorage shadow (bmt_gacha_<id>)
    try {
      const raw = localStorage.getItem('bmt_gacha_' + playerId);
      if (raw) {
        const d = JSON.parse(raw);
        (d.elementInventory || []).forEach(e => sets.elements.add(e));
        if (d.equippedElement) sets.elements.add(d.equippedElement);
      }
    } catch (e) {}
    return sets;
  }

  function ownsItem(playerId, item, ownedSets) {
    const sets = ownedSets || getOwnedSets(playerId);
    const s = sets[item.invKey];
    return !!(s && s.has(canon(item.value)));
  }

  // ── Aggregate stats for the Collection Book ─────────────────────
  function getCollectionStats(playerId) {
    const sets = getOwnedSets(playerId);
    let owned = 0, rarest = null;
    const perCategory = {};
    CATEGORIES.forEach(c => { perCategory[c.key] = { owned: 0, total: 0 }; });

    CATALOG.forEach(it => {
      const has = ownsItem(playerId, it, sets);
      perCategory[it.category].total++;
      if (has) {
        owned++;
        perCategory[it.category].owned++;
        if (!rarest || rarityOrder(it.rarity) > rarityOrder(rarest.rarity)) rarest = it;
      }
    });
    const total = CATALOG.length;
    return {
      owned, total,
      pct: total ? Math.round((owned / total) * 100) : 0,
      rarest, perCategory,
    };
  }

  // ── Public API ──────────────────────────────────────────────────
  window.GAME_CATALOG   = CATALOG;
  window.CATALOG_BY_ID  = byId;
  window.CATALOG_RARITY = RARITY;
  window.CATALOG_CATEGORIES = CATEGORIES;
  window.catalogRarityMeta  = rarityMeta;
  window.catalogRarityOrder = rarityOrder;
  window.catalogCanonValue  = canon;
  window.getCatalogItem     = function (id) { return byId[id] || null; };
  window.getOwnedSets       = getOwnedSets;
  window.ownsCatalogItem    = ownsItem;
  window.getCollectionStats = getCollectionStats;
})();
