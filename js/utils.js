const AVATAR_COLORS = [['#00f5a0','#004d32'],['#00d9f5','#003d4d'],['#ffd700','#4d3e00'],['#ff6b35','#4d1f0f'],['#b044f0','#3a0d5c'],['#48d1cc','#0d3d3c'],['#ff4757','#4d0d15'],['#7bed9f','#1a4d2d']];
function getAvatarColor(id) { return AVATAR_COLORS[(id-1) % AVATAR_COLORS.length] }
function getInitial(name) { return name ? name.charAt(0).toUpperCase() : '?' }

// ── 3% Gacha frame inner HTML (particles + glow layers) ──
const GACHA_FRAME_INNER = {
  void: '<div class="gf-glow"></div><div class="gf-crackle"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div>',
  halo: '<div class="gf-glow"></div><div class="gf-aura"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div>',
  blaze: '<div class="gf-glow"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div>',
  ice: '<div class="gf-glow"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div>',
  rainbow: '',
  robot: '<div class="gf-robot-gear">⚙️</div>',
  solaremperor: '<div class="se-bg"></div><div class="se-stars"></div><div class="se-stars2"></div><div class="se-ring"></div><div class="se-sweep"></div><div class="se-sweep2"></div><div class="se-flare"></div><div class="se-flare"></div><div class="se-sp"></div><div class="se-sp"></div><div class="se-sp"></div><div class="se-sp"></div>',
  solar: '<div class="se-bg"></div><div class="se-stars"></div><div class="se-stars2"></div><div class="se-ring"></div><div class="se-sweep"></div><div class="se-sweep2"></div><div class="se-flare"></div><div class="se-flare"></div><div class="se-sp"></div><div class="se-sp"></div><div class="se-sp"></div><div class="se-sp"></div>',
  thundergod: '<div class="gf-glow"></div><div class="gf-ring"></div><div class="gf-ring2"></div><div class="gf-bolt"></div><div class="gf-bolt"></div><div class="gf-bolt"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div>',
};
// Backward-compat alias: old 'solar' key maps to new 'solaremperor'
function _resolveFrameKey(f) { return (f === 'solar') ? 'solaremperor' : f; }
function _resolveNameKey(n)  { return (n === 'solar') ? 'solaremperor' : n; }

// ── Liquid UI profile frame (lightweight, GPU-only: transform + opacity) ──
// Rotating ring + soft pulse glow + a few orbiting particles. Injected as child
// layers so it never collides with gacha frame ::before/::after pseudo-elements.
// Used only on hero avatars (Profile page + leaderboard #1) and only when the
// player has NOT equipped a gacha frame, so the two systems never stack.
const LIQUID_FRAME_INNER =
  '<i class="lf-glow"></i><i class="lf-ring"></i>' +
  '<i class="lf-p"></i><i class="lf-p"></i><i class="lf-p"></i><i class="lf-p"></i><i class="lf-p"></i>';
function getLiquidFrameInner() { return LIQUID_FRAME_INNER; }
// Returns extra class for the avatar element e.g. "gf-void"
function getGachaFrameClass(player) {
  const raw = player && player.gachaFrame;
  if (raw === 'thundergod') return ''; // replaced by rotating_arcs avatar effect
  const f = _resolveFrameKey(raw);
  if (!f || !(f in GACHA_FRAME_INNER)) return '';
  return 'gf-' + f;
}
// Returns inner HTML to inject inside the avatar element for particles/glow
function getGachaFrameInner(player) {
  const raw = player && player.gachaFrame;
  if (raw === 'thundergod') return ''; // replaced by rotating_arcs avatar effect
  const f = _resolveFrameKey(raw);
  return (f && (f in GACHA_FRAME_INNER)) ? GACHA_FRAME_INNER[f] : '';
}
// Returns extra class for the name element e.g. "gn-void"
function getGachaNameClass(player) {
  const raw = player && player.gachaName;
  if (raw === 'thundergod') return ''; // replaced by rotating_arcs avatar effect
  const n = _resolveNameKey(raw);
  if (!n || !['void','halo','blaze','ice','solaremperor'].includes(n)) return '';
  return 'gn-' + n;
}
// Resolve player by id from db.players (for gacha lookup from minimal player refs in match data)
function resolveGachaPlayer(p) {
  if (!p) return null;
  // Try db first
  let full = (p.gachaFrame !== undefined || p.gachaName !== undefined)
    ? p
    : ((db.players || []).find(x => x.id === p.id) || p);
  // Fallback: merge localStorage gacha if DB column missing
  if (!full.gachaFrame || !full.gachaName) {
    try {
      const ls = JSON.parse(localStorage.getItem('bmt_gacha_' + full.id) || '{}');
      if (!full.gachaFrame && ls.gacha_frame) full = Object.assign({}, full, { gachaFrame: ls.gacha_frame });
      if (!full.gachaName  && ls.gacha_name)  full = Object.assign({}, full, { gachaName:  ls.gacha_name });
    } catch(e) {}
  }
  return full;
}
// Render an array of team players as "Name1 & Name2" with per-name gacha class applied
function formatTeamNames(team, sep) {
  sep = sep || ' & ';
  return (team || []).map(pm => {
    const full = resolveGachaPlayer(pm);
    const cls = getGachaNameClass(full);
    return cls ? `<span class="${cls}">${pm.name}</span>` : pm.name;
  }).join(sep);
}
// Show 3% pull reveal overlay (called after admin assigns frame/name)
const GACHA_THEME = {
  void:  { label:'🌑 VOID ABYSS',     name:'Void Corruption',   color:'#cc88ff', color2:'#aa44ff', color3:'#7700bb', bg:'linear-gradient(135deg,#1a0030,#0c0018)',          border:'#9900dd', glow:'rgba(150,0,220,0.6)', glow2:'rgba(100,0,180,0.3)' },
  halo:  { label:'✨ CELESTIAL HALO', name:'Celestial Script',  color:'#ffe566', color2:'#ffd700', color3:'#ffaa00', bg:'linear-gradient(135deg,#3a2a00,#1c1500)',          border:'#ffd700', glow:'rgba(255,200,0,0.6)',  glow2:'rgba(255,160,0,0.3)' },
  blaze: { label:'🔥 CRIMSON BLAZE',  name:'Blaze Script',       color:'#ff7744', color2:'#ff4400', color3:'#cc2200', bg:'linear-gradient(135deg,#3a0500,#1c0200)',          border:'#ff4400', glow:'rgba(255,80,0,0.6)',    glow2:'rgba(200,30,0,0.3)' },
  ice:   { label:'❄️ PHANTOM ICE',    name:'Ice Script',         color:'#88ddff', color2:'#00ccff', color3:'#0088cc', bg:'linear-gradient(135deg,#001530,#000a1c)',          border:'#0088cc', glow:'rgba(0,180,255,0.6)',   glow2:'rgba(0,120,200,0.3)' },
  solaremperor: { label:'👑 SOLAR EMPEROR', name:'Solar Emperor', color:'#FFD700', color2:'#FFE566', color3:'#FFAA00', bg:'linear-gradient(135deg,#050810,#0B1020)', border:'#FFD700', glow:'rgba(255,215,0,0.75)', glow2:'rgba(255,170,0,0.38)' },
  solar: { label:'👑 SOLAR EMPEROR', name:'Solar Emperor', color:'#FFD700', color2:'#FFE566', color3:'#FFAA00', bg:'linear-gradient(135deg,#050810,#0B1020)', border:'#FFD700', glow:'rgba(255,215,0,0.75)', glow2:'rgba(255,170,0,0.38)' },
  thundergod: { label:'⚡ SECRET: THUNDER GOD', name:'Thunder God', color:'#00d4ff', color2:'#0099ee', color3:'#0055cc', bg:'linear-gradient(135deg,#000c1a,#000510)', border:'#00aaff', glow:'rgba(0,180,255,0.75)', glow2:'rgba(0,120,200,0.38)' },
};
function showGachaReveal(playerName, frame, name) {
  const overlay = document.getElementById('gachaRevealOverlay');
  if (!overlay) return;
  // Choose theme: frame wins; else name; else default
  const theme = GACHA_THEME[frame] || GACHA_THEME[name] || GACHA_THEME.void;
  const card = document.getElementById('grCard');
  card.style.setProperty('--gr-color', theme.color);
  card.style.setProperty('--gr-color2', theme.color2);
  card.style.setProperty('--gr-color3', theme.color3);
  card.style.setProperty('--gr-bg', theme.bg);
  card.style.setProperty('--gr-border', theme.border);
  card.style.setProperty('--gr-glow', theme.glow);
  card.style.setProperty('--gr-glow2', theme.glow2);
  card.style.background = theme.bg;
  card.style.borderColor = theme.border;
  // Apply same on shockwave colors
  overlay.style.setProperty('--gr-color', theme.color);
  overlay.style.setProperty('--gr-color2', theme.color2);
  overlay.style.setProperty('--gr-color3', theme.color3);
  // Frame demo
  const demo = document.getElementById('grFrameDemo');
  const _grFrame = _resolveFrameKey(frame);
  const _grName  = _resolveNameKey(name);
  demo.className = 'gr-frame-demo' + (_grFrame ? ' gf-'+_grFrame : '');
  demo.innerHTML = (_grFrame && GACHA_FRAME_INNER[_grFrame] ? GACHA_FRAME_INNER[_grFrame] : '') + (playerName ? playerName.charAt(0).toUpperCase() : '?');
  demo.style.background = theme.bg;
  // Name
  const nameEl = document.getElementById('grName');
  nameEl.className = 'gr-name' + (_grName ? ' gn-'+_grName : '');
  nameEl.textContent = playerName || '—';
  // Labels
  document.getElementById('grLabel').textContent = '★ 3% RATE ★';
  const parts = [];
  if (frame) parts.push('Frame: ' + theme.label);
  if (name) parts.push('Name: ' + (GACHA_THEME[name] ? GACHA_THEME[name].name : name));
  document.getElementById('grRarity').textContent = parts.join(' · ') || 'ULTRA RARE';
  document.getElementById('grRate').textContent = 'ULTRA RARE';
  overlay.classList.add('show');
  // Reset card animation
  card.style.animation = 'none';
  void card.offsetHeight;
  card.style.animation = '';
}
function closeGachaReveal() {
  const overlay = document.getElementById('gachaRevealOverlay');
  if (overlay) overlay.classList.remove('show');
  if (typeof window._gachaRevealOnClose === 'function') {
    const cb = window._gachaRevealOnClose;
    window._gachaRevealOnClose = null;
    setTimeout(cb, 200);
  }
}

// ── ⚡ SECRET: THUNDER GOD Cinematic ──────────────────────────
function showThunderGodCinematic(playerName) {
  const initial = playerName ? playerName.charAt(0).toUpperCase() : '⚡';
  let ov = document.getElementById('tgCinematic');
  if (!ov) { ov = document.createElement('div'); ov.id = 'tgCinematic'; document.body.appendChild(ov); }
  ov.innerHTML = `
    <div class="tc-bg" id="tcBg"></div>
    <div class="tc-storm"></div>
    <div class="tc-scanlines"></div>
    <div class="tc-flash" id="tcFlash"></div>
    <div class="tc-bolt-main" id="tcBolt"></div>
    <div class="tc-ring" id="tcRing1"></div>
    <div class="tc-ring tc-ring2" id="tcRing2"></div>
    <div class="tc-ring tc-ring3" id="tcRing3"></div>
    <div class="tc-avatar-wrap" id="tcAvatarWrap">
      <div class="tc-avatar gf-thundergod" id="tcAvatar">
        <div class="gf-glow"></div><div class="gf-ring"></div><div class="gf-ring2"></div>
        <div class="gf-bolt"></div><div class="gf-bolt"></div><div class="gf-bolt"></div>
        <div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div>
        <span class="tc-glitch-layer">${initial}</span>${initial}
      </div>
    </div>
    <div class="tc-secret-text" id="tcSecretText">⚡ &nbsp;SECRET: THUNDER GOD&nbsp; ⚡</div>
    <div class="tc-player-name gn-thundergod" id="tcPlayerName">${playerName||'—'}</div>
    <div class="tc-hint">— tap to close —</div>`;
  // Spawn sparks
  for (let i = 0; i < 30; i++) {
    const s = document.createElement('div');
    const ang = Math.random() * Math.PI * 2;
    const dst = 60 + Math.random() * 110;
    s.style.cssText = `position:absolute;border-radius:50%;pointer-events:none;will-change:transform,opacity;`
      + `left:${10+Math.random()*80}%;top:${8+Math.random()*84}%;`
      + `width:${1+Math.random()*3}px;height:${1+Math.random()*3}px;`
      + `background:${Math.random()<.55?'#00d4ff':Math.random()<.5?'#fff':'#44ffff'};`
      + `--dx:${(Math.cos(ang)*dst).toFixed(1)}px;--dy:${(Math.sin(ang)*dst).toFixed(1)}px;`
      + `animation:tcSpark ${(.25+Math.random()*.65).toFixed(2)}s ease-out ${(Math.random()*3).toFixed(2)}s infinite;`;
    ov.appendChild(s);
  }
  // Electric arc rings (background atmosphere)
  for (let i = 0; i < 5; i++) {
    const a = document.createElement('div');
    const sz = 50 + i * 35;
    a.style.cssText = `position:absolute;top:calc(50% - ${sz/2}px);left:calc(50% - ${sz/2}px);`
      + `width:${sz}px;height:${sz}px;border-radius:50%;pointer-events:none;will-change:opacity;z-index:8;`
      + `border:1.5px solid rgba(0,${145+i*18},255,${(.45-i*.06).toFixed(2)});`
      + `animation:tcArc ${(.55+i*.18).toFixed(2)}s ease-in-out ${(i*.1).toFixed(2)}s infinite;`;
    ov.appendChild(a);
  }
  ov.classList.add('active');
  ov.style.opacity = '0'; ov.style.transition = 'opacity .4s';
  ov.onclick = closeTgCinematic;
  requestAnimationFrame(() => requestAnimationFrame(() => { ov.style.opacity = '1'; }));
  const G = id => document.getElementById(id);
  // Sequence
  setTimeout(() => { const b=G('tcBg'); if(b) b.style.animation='tgShake .35s ease-in-out'; }, 320);
  setTimeout(() => { const bo=G('tcBolt'); if(bo) bo.style.animation='tcBoltIn .7s ease-out forwards'; }, 720);
  setTimeout(() => {
    const fl=G('tcFlash'); if(fl) fl.style.animation='tcFlash .55s ease-out forwards';
    const b=G('tcBg'); if(b){ b.style.animation='none'; void b.offsetHeight; b.style.animation='tgShake .22s ease-in-out 3'; }
  }, 940);
  setTimeout(() => { const b=G('tcBg'); if(b) b.style.animation=''; }, 1200);
  setTimeout(() => { const r=G('tcRing1'); if(r) r.style.animation='tcRingExpand 1.05s ease-out forwards'; }, 1060);
  setTimeout(() => { const r=G('tcRing2'); if(r) r.style.animation='tcRingExpand 1.15s ease-out forwards'; }, 1210);
  setTimeout(() => { const r=G('tcRing3'); if(r) r.style.animation='tcRingExpand 1.25s ease-out forwards'; }, 1360);
  setTimeout(() => { const w=G('tcAvatarWrap'); if(w) w.style.animation='tcAvatarReveal .95s cubic-bezier(.175,.885,.32,1.275) forwards'; }, 1480);
  setTimeout(() => { const t=G('tcSecretText'); if(t) t.style.animation='tcSecretReveal .55s cubic-bezier(.175,.885,.32,1.275) forwards,tcSecretPulse 2s ease-in-out .55s infinite'; }, 1950);
  setTimeout(() => { const n=G('tcPlayerName'); if(n) n.style.animation='tcNameReveal .65s cubic-bezier(.175,.885,.32,1.275) forwards'; }, 2550);
}
function closeTgCinematic() {
  const ov = document.getElementById('tgCinematic');
  if (!ov || !ov.classList.contains('active')) return;
  ov.style.transition = 'opacity .35s'; ov.style.opacity = '0';
  setTimeout(() => {
    ov.classList.remove('active'); ov.style.transition = ''; ov.style.opacity = '';
    if (typeof window._tgCinematicOnClose === 'function') {
      const cb = window._tgCinematicOnClose; window._tgCinematicOnClose = null; cb();
    }
  }, 360);
}

function getAvatar(pid, name) {
  const sv = getCustomAvatar(pid);
  const cols = getAvatarColor(pid);
  if (sv.emoji || sv.color) return { bg: sv.color||cols[1], fg: sv.color?'#fff':cols[0], content: sv.emoji||getInitial(name), fs: '1.4rem' };
  return { bg: cols[1], fg: cols[0], content: getInitial(name), fs: '' };
}

function toggleDayNight() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('dnEmoji').textContent = isDark ? '🌙' : '☀️';
  localStorage.setItem('badminton_theme', isDark ? 'light' : 'dark');
}
function setStyle(style) {
  document.documentElement.setAttribute('data-style', style);
  document.getElementById('styleGlass').classList.toggle('active', style === 'glass');
  document.getElementById('styleLite').classList.toggle('active', style === 'lite');
  localStorage.setItem('badminton_style', style);
}
// Heuristic: very low RAM only → default to lite style for smoothness.
// Only used when the user has NOT explicitly chosen a style; their toggle always wins.
// Threshold: <= 1 GB only (old phones/tablets). 4-core PCs / 4 GB RAM = glass by default.
function _isLowEndDevice() {
  const mem = navigator.deviceMemory;
  return typeof mem === 'number' && mem <= 1;
}
function loadTheme() {
  const t = localStorage.getItem('badminton_theme') || 'dark';
  let sRaw = localStorage.getItem('badminton_style');
  if (sRaw === null) sRaw = _isLowEndDevice() ? 'lite' : 'glass'; // soft default, not persisted
  const s = sRaw === 'classic' ? 'glass' : sRaw;
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-style', s);
  document.getElementById('styleGlass').classList.toggle('active', s === 'glass');
  document.getElementById('styleLite').classList.toggle('active', s === 'lite');
  document.getElementById('dnEmoji').textContent = t === 'dark' ? '🌙' : '☀️';
  document.getElementById('dayNightToggle').checked = t === 'light';
}

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(name + 'Section').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  // Use ID map so position-based lookup isn't thrown off by hidden mailbox button
  const navIdMap = { leaderboard:'navLb', stats:'navStats', match:'navMatch', tournament:'navTour', history:'navHist', profile:'navProfile', admin:'adminNavBtn' };
  const activeBtn = document.getElementById(navIdMap[name]);
  if (activeBtn) activeBtn.classList.add('active');
  if (name === 'leaderboard') renderLeaderboard();
  if (name === 'stats') renderStats();
  if (name === 'match') renderMatchSetup();
  if (name === 'tournament') renderTournamentTab();
  if (name === 'history') renderHistory();
  if (name === 'profile') renderProfile();
  if (name === 'admin') renderAdmin();
}
function switchLoginTab(tab) {
  document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
  document.querySelectorAll('#loginSection .tab').forEach((b,i) => { b.classList.toggle('active', (i===0 && tab==='login') || (i===1 && tab==='register')); });
}
function switchMatchTab(tab) {
  document.getElementById('singlesSetup').classList.toggle('hidden', tab !== 'singles');
  document.getElementById('doublesSetup').classList.toggle('hidden', tab !== 'doubles');
  document.querySelectorAll('#matchSection .tab').forEach((b,i) => { b.classList.toggle('active', (i===0 && tab==='singles') || (i===1 && tab==='doubles')); });
  window._matchSel = { mode: tab, A: [], B: [] };
  renderPlayerGrid();
}

function normalizePlayer(p) {
  const CACH_PFX = '__cach:';
  const CATALOG_PFX = '__catalog:';
  const HOF_PFX = '__hof:';
  const S1000_PFX = '__s1000:';
  const ACHPINS_PFX = '__achpins:';
  let pt = []; try { pt = JSON.parse(p.prime_titles || '[]'); } catch(e) {}
  const cachEntry    = pt.find(t => typeof t === 'string' && t.startsWith(CACH_PFX));
  const catalogEntry = pt.find(t => typeof t === 'string' && t.startsWith(CATALOG_PFX));
  const hofEntry     = pt.find(t => typeof t === 'string' && t.startsWith(HOF_PFX));
  const s1000Entry   = pt.find(t => typeof t === 'string' && t.startsWith(S1000_PFX));
  const achpinsEntry = pt.find(t => typeof t === 'string' && t.startsWith(ACHPINS_PFX));
  const realPt = pt.filter(t => !(typeof t === 'string' && (t.startsWith(CACH_PFX) || t.startsWith(CATALOG_PFX) || t.startsWith(HOF_PFX) || t.startsWith(S1000_PFX) || t.startsWith(ACHPINS_PFX))));
  let ca = [];
  if (cachEntry) { try { ca = JSON.parse(cachEntry.slice(CACH_PFX.length)); } catch(e) {} }
  if (!ca.length) { try { ca = JSON.parse(p.custom_ach || '[]'); } catch(e) {} }
  if (!ca.length) { try { const ls = getCachAwardsLS(); if (ls[p.id]) ca = ls[p.id]; } catch(e) {} }
  let catalogShared = null;
  if (catalogEntry) { try { catalogShared = JSON.parse(catalogEntry.slice(CATALOG_PFX.length)); } catch(e) {} }
  let hofShared = null;
  if (hofEntry) { try { hofShared = JSON.parse(hofEntry.slice(HOF_PFX.length)); } catch(e) {} }
  let super1000Titles = 0;
  if (s1000Entry) { try { super1000Titles = Math.max(0, parseInt(s1000Entry.slice(S1000_PFX.length)) || 0); } catch(e) {} }
  // null = no setting (show all customAch by default); array = specific pinned IDs
  let pinnedAchs = null;
  if (achpinsEntry) { try { pinnedAchs = JSON.parse(achpinsEntry.slice(ACHPINS_PFX.length)); } catch(e) {} }
  // ── localStorage gacha fallback (ถ้า DB column ยังไม่มี) ──
  let _lsGacha = {};
  try { _lsGacha = JSON.parse(localStorage.getItem('bmt_gacha_' + p.id) || '{}'); } catch(e) {}
  const _gFrame = p.gacha_frame || _lsGacha.gacha_frame || null;
  const _gName  = p.gacha_name  || _lsGacha.gacha_name  || null;
  const _gEmoji = p.gacha_emoji || _lsGacha.gacha_emoji  || null;
  let _dbInv = {}; try { _dbInv = JSON.parse(p.gacha_inventory || '{}'); } catch(e) {}
  let _ownedEffects = [];
  try { _ownedEffects = JSON.parse(p.owned_effects || '[]'); } catch(e) {}
  // localStorage fallback
  if (!_ownedEffects.length) {
    try { const _lsInvEf = JSON.parse(localStorage.getItem('bmt_gacha_inv_' + p.id) || '{}'); if (_lsInvEf.effects && _lsInvEf.effects.length) _ownedEffects = _lsInvEf.effects; } catch(e) {}
  }
  // Auto-migrate: old thundergod frame/name → rotating_arcs
  if ((_gFrame === 'thundergod' || _gName === 'thundergod') && !_ownedEffects.includes('rotating_arcs')) {
    _ownedEffects = [..._ownedEffects, 'rotating_arcs'];
  }
  return { id: p.id, name: p.name, pin: p.pin, pts: p.pts, wins: p.wins, losses: p.losses, isAdmin: (p.is_admin === true || p.is_admin === 1) ? 1 : 0, primeTitles: realPt, customAch: ca, _catalogShared: catalogShared, _hofShared: hofShared, gachaFrame: _gFrame, gachaName: _gName, coins: p.coins || 0, gachaEmoji: _gEmoji, consecutiveLosses: p.consecutive_losses || 0, _dbGachaInv: _dbInv, super1000Titles, pinnedAchs, ownedEffects: _ownedEffects };
}

// Build prime_titles JSON for save, preserving awards + catalog + hof hidden entries
function buildPlayerPrimeTitles(player, opts) {
  opts = opts || {};
  const CACH_PFX = '__cach:';
  const CATALOG_PFX = '__catalog:';
  const HOF_PFX = '__hof:';
  const S1000_PFX = '__s1000:';
  const ACHPINS_PFX = '__achpins:';
  const pt = [...(player.primeTitles || [])];
  const awards = opts.awards !== undefined ? opts.awards : (player.customAch || []);
  if (awards && awards.length > 0) pt.push(CACH_PFX + JSON.stringify(awards));
  const catalog = opts.catalog !== undefined ? opts.catalog : player._catalogShared;
  if (catalog && catalog.length > 0) pt.push(CATALOG_PFX + JSON.stringify(catalog));
  const hof = opts.hof !== undefined ? opts.hof : player._hofShared;
  if (hof && hof.length > 0) pt.push(HOF_PFX + JSON.stringify(hof));
  const s1000 = opts.s1000 !== undefined ? opts.s1000 : (player.super1000Titles || 0);
  if (s1000 > 0) pt.push(S1000_PFX + s1000);
  // Encode pinned achievement IDs for leaderboard display
  const pinnedAchs = opts.pinnedAchs !== undefined ? opts.pinnedAchs : player.pinnedAchs;
  if (pinnedAchs !== null && pinnedAchs !== undefined) pt.push(ACHPINS_PFX + JSON.stringify(pinnedAchs));
  return JSON.stringify(pt);
}
// ── HALL OF FAME ─────────────────────────────────────────────
function getHoF() {
  const out = [], seen = new Set();
  const add = item => {
    const key = (item.season||'') + '|' + (item.id||item.name||'');
    if (item && item.season && !seen.has(key)) { out.push(item); seen.add(key); }
  };
  if (typeof db !== 'undefined' && db.players && db.players.length) {
    const holder = [...db.players].sort((a,b)=>a.id-b.id).find(p => p._hofShared && p._hofShared.length);
    if (holder) for (const e of holder._hofShared) add(e);
  }
  try { for (const e of JSON.parse(localStorage.getItem('badminton_hof')||'[]')) add(e); } catch(x) {}
  return out.sort((a,b) => (b.season||'').localeCompare(a.season||''));
}
async function saveHoF(entries) {
  localStorage.setItem('badminton_hof', JSON.stringify(entries));
  if (!db.players || !db.players.length) return;
  const admins = db.players.filter(p => p.isAdmin === 1);
  const holder = [...(admins.length ? admins : db.players)].sort((a,b)=>a.id-b.id)[0];
  if (!holder) return;
  holder._hofShared = entries;
  try { await dbUpdatePlayer(holder.id, { prime_titles: buildPlayerPrimeTitles(holder, { hof: entries }) }); } catch(e) {}
}
function openHoF() {
  const hof = getHoF();
  const bg = document.getElementById('hofModalBg');
  const body = document.getElementById('hofBody');
  if (!bg || !body) return;
  body.innerHTML = hof.length ? hof.map(e => `
    <div class="hof-item${e.defended?' hof-def':''}">
      <div style="font-size:1.4rem">👑</div>
      <div class="hof-season">Prime ${e.season||'?'}</div>
      <div class="hof-name">${e.name||'?'}</div>
      ${e.defended ? '<div class="hof-shield">🛡️ Defended</div>' : ''}
      <div class="hof-pts">${(e.pts||0).toLocaleString()} pts</div>
    </div>`).join('') : `<div style="text-align:center;color:var(--muted);padding:20px">ยังไม่มีข้อมูล Season ที่ผ่านมา</div>`;
  bg.style.display = 'flex';
}
function closeHoF() { const bg = document.getElementById('hofModalBg'); if (bg) bg.style.display = 'none'; }

// ── KING TRACKER / DETHRONED NOTIFICATION ────────────────────
function checkKingChange() {
  if (!db.players || !db.players.length) return;
  const sorted = [...db.players].sort((a,b) => b.pts - a.pts);
  const king = sorted[0] && sorted[0].pts >= 3000 ? sorted[0] : null;
  const stored = (() => { try { return JSON.parse(localStorage.getItem('badminton_king_tracker')||'null'); } catch(e) { return null; } })();
  if (king) {
    if (stored && stored.id !== king.id) {
      const seenKey = `badminton_dethroned_seen_${king.id}_${stored.id}`;
      if (!sessionStorage.getItem(seenKey)) {
        sessionStorage.setItem(seenKey, '1');
        setTimeout(() => toast(`👑 ${king.name} ปลดบัลลังก์ ${stored.name}! เจ้าแห่งสนามคนใหม่!`, 'success', 6000), 800);
      }
    }
    localStorage.setItem('badminton_king_tracker', JSON.stringify({ id: king.id, name: king.name }));
    // Auto-grant Solar Emperor prestige to current king (if it's the logged-in user)
    if (currentUser && king.id === currentUser.id) {
      _grantKingCosmetic(king);
    }
  } else {
    localStorage.removeItem('badminton_king_tracker');
  }
}

// ── SOLAR EMPEROR PRESTIGE HELPERS ───────────────────────────
function _getKingHistory(playerId) {
  try { return JSON.parse(localStorage.getItem('bmt_king_h_' + playerId) || 'null'); } catch(e) { return null; }
}
function _setKingHistory(playerId, data) {
  localStorage.setItem('bmt_king_h_' + playerId, JSON.stringify(data));
}
async function _grantKingCosmetic(king) {
  // Once per session guard — prevent double-fire
  const sessionKey = 'bmt_king_granted_' + king.id;
  if (sessionStorage.getItem(sessionKey)) return;
  sessionStorage.setItem(sessionKey, '1');

  // Update king history
  const now = Date.now();
  const hist = _getKingHistory(king.id) || {};
  const isFirstCrown = !hist.firstDate;
  hist.firstDate = hist.firstDate || now;
  hist.reignCount = (hist.reignCount || 0) + (isFirstCrown ? 1 : 0);
  hist.lastDate = now;
  hist.maxElo = Math.max(hist.maxElo || 0, king.pts || 0);
  _setKingHistory(king.id, hist);

  // Check if already owns solaremperor (permanent — never take away)
  const inv = getGachaInventory(king.id);
  const alreadyOwns = (inv.frames || []).includes('solaremperor') || (inv.names || []).includes('solaremperor');

  if (!alreadyOwns) {
    // Grant permanently
    if (!inv.frames) inv.frames = [];
    if (!inv.names)  inv.names  = [];
    if (!inv.frames.includes('solaremperor')) inv.frames.push('solaremperor');
    if (!inv.names.includes('solaremperor'))  inv.names.push('solaremperor');
    _saveGachaInventoryToDB(king.id, inv);

    // Equip solaremperor
    try {
      const lsKey = 'bmt_gacha_' + king.id;
      const ls = JSON.parse(localStorage.getItem(lsKey) || '{}');
      ls.gacha_frame = 'solaremperor';
      ls.gacha_name  = 'solaremperor';
      localStorage.setItem(lsKey, JSON.stringify(ls));
      await dbUpdatePlayer(king.id, { gacha_frame: 'solaremperor', gacha_name: 'solaremperor' });
      await loadPlayers();
    } catch(e) { /* non-blocking */ }

    // Show First Ascension cinematic
    setTimeout(() => showSolarEmperorAscension(king.name, true), 600);
  } else {
    // Already owns — still update reign count if new reign
    hist.reignCount = (hist.reignCount || 1);
    _setKingHistory(king.id, hist);
  }
}

// ── SOLAR EMPEROR ASCENSION CINEMATIC ────────────────────────
function showSolarEmperorAscension(playerName, isFirst, opts = {}) {
  // Remove stale instance if any
  const old = document.getElementById('seAscension');
  if (old) old.remove();
  const seTitle = opts.title || (isFirst ? 'FIRST ASCENSION' : 'SOLAR EMPEROR');
  const seSub   = opts.sub   || (isFirst ? 'เจ้าแห่งสนาม · ขึ้นสู่บัลลังก์ Solar Emperor' : 'กลับสู่บัลลังก์อีกครั้ง · King of Badminton');
  const seCrown = opts.crown || '👑';

  const el = document.createElement('div');
  el.id = 'seAscension';
  el.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;background:rgba(5,8,16,0)';
  el.innerHTML = `
    <style>
      @keyframes seaBgReveal{0%{background:rgba(5,8,16,0)}60%{background:rgba(5,8,16,0.97)}100%{background:rgba(5,8,16,0.97)}}
      @keyframes seaFlash{0%,100%{opacity:0}30%{opacity:1}60%{opacity:0}}
      @keyframes seaRingExpand{0%{transform:scale(0.2);opacity:1}100%{transform:scale(3.5);opacity:0}}
      @keyframes seaCrownDrop{0%{transform:translateY(-120px) scale(0.5);opacity:0}60%{transform:translateY(8px) scale(1.08);opacity:1}80%{transform:translateY(-4px) scale(0.97);opacity:1}100%{transform:translateY(0) scale(1);opacity:1}}
      @keyframes seaTitleReveal{0%{opacity:0;transform:scale(1.4);letter-spacing:0.6em}100%{opacity:1;transform:scale(1);letter-spacing:0.15em}}
      @keyframes seaNameIgnite{0%{opacity:0;filter:brightness(3) blur(6px)}50%{opacity:1;filter:brightness(1.8) blur(1px)}100%{opacity:1;filter:brightness(1) blur(0)}}
      @keyframes seaRayRot{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
      @keyframes seaSubReveal{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:translateY(0)}}
      #seAscension .sea-flash{position:absolute;inset:0;background:radial-gradient(circle,#fff9d6,#ffd700,transparent);opacity:0;pointer-events:none}
      #seAscension .sea-ring{position:absolute;top:50%;left:50%;width:200px;height:200px;margin:-100px;border-radius:50%;border:3px solid rgba(255,215,0,0.7);opacity:0;pointer-events:none}
      #seAscension .sea-rays{position:absolute;top:50%;left:50%;width:500px;height:500px;margin:-250px;border-radius:50%;background:conic-gradient(transparent 0deg,rgba(255,215,0,0.04) 5deg,transparent 10deg,transparent 30deg,rgba(255,225,100,0.06) 35deg,transparent 40deg,transparent 60deg,rgba(255,215,0,0.04) 65deg,transparent 70deg,transparent 90deg,rgba(255,225,100,0.06) 95deg,transparent 100deg,transparent 120deg,rgba(255,215,0,0.04) 125deg,transparent 130deg,transparent 150deg,rgba(255,225,100,0.06) 155deg,transparent 160deg,transparent 180deg,rgba(255,215,0,0.04) 185deg,transparent 190deg,transparent 210deg,rgba(255,225,100,0.06) 215deg,transparent 220deg,transparent 240deg,rgba(255,215,0,0.04) 245deg,transparent 250deg,transparent 270deg,rgba(255,225,100,0.06) 275deg,transparent 280deg,transparent 300deg,rgba(255,215,0,0.04) 305deg,transparent 310deg,transparent 330deg,rgba(255,225,100,0.06) 335deg,transparent 360deg);opacity:0;pointer-events:none}
      #seAscension .sea-card{display:flex;flex-direction:column;align-items:center;gap:12px;opacity:1}
      #seAscension .sea-crown{font-size:clamp(3rem,10vw,5.5rem);opacity:0;filter:drop-shadow(0 0 30px rgba(255,215,0,0.9))}
      #seAscension .sea-title{font-size:clamp(1.1rem,3.5vw,1.7rem);font-weight:900;color:#FFD700;text-transform:uppercase;letter-spacing:0.15em;opacity:0;text-shadow:0 0 24px rgba(255,215,0,0.9),0 0 48px rgba(255,200,0,0.5)}
      #seAscension .sea-name{font-size:clamp(1.4rem,4.5vw,2.3rem);font-weight:900;letter-spacing:2px;opacity:0;background:linear-gradient(90deg,#7a5500,#FFD700,#FFF4B5,#FFE566,#FFAA00,#FFD700,#7a5500);background-size:400% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-shadow:none;filter:drop-shadow(0 0 18px rgba(255,215,0,1))}
      #seAscension .sea-sub{font-size:clamp(0.75rem,2vw,0.95rem);color:rgba(255,230,150,0.75);letter-spacing:0.1em;opacity:0;text-align:center;max-width:280px}
      #seAscension .sea-hint{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);font-size:0.75rem;color:rgba(255,215,0,0.4);letter-spacing:0.08em;opacity:0;transition:opacity 1s}
    </style>
    <div class="sea-flash" id="seaFlash"></div>
    <div class="sea-ring" id="seaRing1"></div>
    <div class="sea-ring" id="seaRing2" style="width:320px;height:320px;margin:-160px;border-color:rgba(255,215,0,0.4)"></div>
    <div class="sea-rays" id="seaRays"></div>
    <div class="sea-card">
      <div class="sea-crown" id="seaCrown">${seCrown}</div>
      <div class="sea-title" id="seaTitle">${seTitle}</div>
      <div class="sea-name" id="seaName">${playerName}</div>
      <div class="sea-sub" id="seaSub">${seSub}</div>
    </div>
    <div class="sea-hint" id="seaHint">แตะเพื่อปิด</div>
  `;

  document.body.appendChild(el);

  // Sequence
  const $ = id => document.getElementById(id);
  const animate = (id, css, delay) => setTimeout(() => { const e=$('sea'+id.charAt(0).toUpperCase()+id.slice(1)); if(e) Object.assign(e.style,css); }, delay);

  // bg fade
  setTimeout(() => { el.style.animation='seaBgReveal 1.2s ease forwards'; }, 0);
  // flash
  setTimeout(() => { $('seaFlash').style.animation='seaFlash 0.7s ease forwards'; }, 400);
  // rays spin in
  setTimeout(() => { $('seaRays').style.opacity='1'; $('seaRays').style.animation='seaRayRot 20s linear infinite'; }, 700);
  // ring1 expand
  setTimeout(() => { $('seaRing1').style.animation='seaRingExpand 1s ease-out forwards'; }, 900);
  // ring2 expand (delay)
  setTimeout(() => { $('seaRing2').style.animation='seaRingExpand 1s ease-out forwards'; }, 1100);
  // crown drops
  setTimeout(() => { $('seaCrown').style.animation='seaCrownDrop 0.9s cubic-bezier(0.22,1,0.36,1) forwards'; }, 1300);
  // title reveals
  setTimeout(() => { $('seaTitle').style.animation='seaTitleReveal 0.7s ease-out forwards'; }, 2000);
  // name ignites
  setTimeout(() => { $('seaName').style.animation='seaNameIgnite 0.9s ease-out forwards'; }, 2600);
  // sub fades
  setTimeout(() => { $('seaSub').style.animation='seaSubReveal 0.6s ease-out forwards'; }, 3200);
  // hint appears
  setTimeout(() => { $('seaHint').style.opacity='0.7'; }, 4000);

  // Close on click/tap
  el.addEventListener('click', () => { el.style.transition='opacity 0.5s'; el.style.opacity='0'; setTimeout(()=>el.remove(),500); });
  // Auto-close after 9 seconds
  setTimeout(() => { if(document.getElementById('seAscension')) { el.style.transition='opacity 0.8s'; el.style.opacity='0'; setTimeout(()=>el.remove(),800); } }, 9000);
}

// ── KING'S CHALLENGE ─────────────────────────────────────────
function getKingChallenge() { try { return JSON.parse(localStorage.getItem('badminton_kc')||'null'); } catch(e) { return null; } }
function declareKingChallenge(challengerId, challengerName) {
  const existing = getKingChallenge();
  if (existing && existing.id === challengerId) {
    localStorage.removeItem('badminton_kc');
    toast('ยกเลิกการท้าชิงแล้ว', 'info');
  } else {
    localStorage.setItem('badminton_kc', JSON.stringify({ id: challengerId, name: challengerName, ts: Date.now() }));
    toast(`🤺 ${challengerName} ประกาศท้าชิง King แล้ว! ชนะ King ครั้งถัดไปได้ +50 ELO โบนัส`, 'success', 4000);
  }
  closePlayerProfile();
  renderLeaderboard();
}

// ══ SVG RANK BADGE SYSTEM ══════════════════════════════════
let _rbCnt = 0;

function _rbShield(fill1, fill2, stroke, roman, romanColor) {
  const id = ++_rbCnt;
  return `<div class="shield-wrap"><svg class="shield-svg" viewBox="0 0 64 74" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sg${id}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="${fill1}"/><stop offset="100%" stop-color="${fill2}"/></linearGradient></defs><path d="M32 2 L62 12 L62 40 Q62 62 32 72 Q2 62 2 40 L2 12 Z" fill="url(#sg${id})" stroke="${stroke}" stroke-width="2"/><path d="M32 9 L55 17 L55 40 Q55 57 32 65 Q9 57 9 40 L9 17 Z" fill="none" stroke="${fill1}" stroke-width="1.2" opacity="0.5"/><path d="M32 9 L55 17 L55 28 Q44 22 32 22 Q20 22 9 28 L9 17 Z" fill="white" opacity="0.08"/><text x="32" y="44" font-family="Georgia,serif" font-size="18" font-weight="700" text-anchor="middle" fill="${romanColor}" letter-spacing="2">${roman}</text></svg></div>`;
}
function _rbGold(roman) {
  const id = ++_rbCnt;
  return `<div class="gold-wrap"><svg width="80" height="64" viewBox="0 0 80 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gg${id}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffe060"/><stop offset="50%" stop-color="#f0c040"/><stop offset="100%" stop-color="#a07000"/></linearGradient></defs><path d="M22 32 Q10 20 4 12 Q8 16 12 22 Q6 18 2 8 Q10 14 16 24 Q12 16 14 6 Q18 16 18 28 Z" fill="#f0c040" opacity="0.85"/><path d="M58 32 Q70 20 76 12 Q72 16 68 22 Q74 18 78 8 Q70 14 64 24 Q68 16 66 6 Q62 16 62 28 Z" fill="#f0c040" opacity="0.85"/><rect x="20" y="12" width="40" height="40" rx="5" fill="url(#gg${id})" stroke="#8a6000" stroke-width="1.5"/><rect x="26" y="18" width="28" height="28" rx="3" fill="none" stroke="#ffe060" stroke-width="1" opacity="0.6"/><text x="40" y="38" font-family="Georgia,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#5a3800" letter-spacing="2">${roman}</text></svg></div>`;
}
function _rbPlat(roman) {
  const id = ++_rbCnt;
  return `<div class="plat-wrap"><svg width="84" height="70" viewBox="0 0 84 70" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="pg${id}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#90e8f8"/><stop offset="100%" stop-color="#208898"/></linearGradient></defs><path d="M24 35 Q14 26 6 20 Q10 24 14 30 Q8 26 4 16 Q12 22 18 32 Q14 22 16 12 Q20 22 20 33 Z" fill="#70d0e0" opacity="0.8"/><path d="M60 35 Q70 26 78 20 Q74 24 70 30 Q76 26 80 16 Q72 22 66 32 Q70 22 68 12 Q64 22 64 33 Z" fill="#70d0e0" opacity="0.8"/><polygon points="42,6 68,21 68,49 42,64 16,49 16,21" fill="url(#pg${id})" stroke="#106878" stroke-width="1.5"/><polygon points="42,14 60,24 60,46 42,56 24,46 24,24" fill="none" stroke="#b0f0ff" stroke-width="1" opacity="0.5"/><text x="42" y="40" font-family="Georgia,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#004858" letter-spacing="2">${roman}</text></svg></div>`;
}
function _rbDiamond(roman) {
  const id = ++_rbCnt;
  const sp = [{x:8,y:8,s:0.0},{x:74,y:8,s:0.3},{x:4,y:50,s:0.6},{x:78,y:50,s:0.9},{x:42,y:2,s:0.15},{x:42,y:66,s:0.5}]
    .map((p,i)=>`<div class="rb-sparkle" style="left:${p.x}px;top:${p.y}px;width:5px;height:5px;background:#c0a0ff;animation-delay:${p.s}s;animation-duration:${1.2+i*0.15}s"></div>`).join('');
  return `<div class="diamond-wrap"><svg width="84" height="70" viewBox="0 0 84 70" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="dg${id}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#c0a0ff"/><stop offset="50%" stop-color="#8060e0"/><stop offset="100%" stop-color="#3020a0"/></linearGradient></defs><path d="M24 35 Q14 26 6 20 Q10 24 14 30 Q8 26 4 16 Q12 22 18 32 Q14 22 16 12 Q20 22 20 33 Z" fill="#9070e0" opacity="0.8"/><path d="M60 35 Q70 26 78 20 Q74 24 70 30 Q76 26 80 16 Q72 22 66 32 Q70 22 68 12 Q64 22 64 33 Z" fill="#9070e0" opacity="0.8"/><polygon points="42,6 68,21 68,49 42,64 16,49 16,21" fill="url(#dg${id})" stroke="#6040c0" stroke-width="1.5"/><polygon points="42,14 60,24 60,46 42,56 24,46 24,24" fill="none" stroke="#e0d0ff" stroke-width="1" opacity="0.5"/><line x1="10" y1="10" x2="16" y2="16" stroke="#e0d0ff" stroke-width="1" opacity="0.6"/><line x1="74" y1="10" x2="68" y2="16" stroke="#e0d0ff" stroke-width="1" opacity="0.6"/><line x1="10" y1="60" x2="16" y2="54" stroke="#e0d0ff" stroke-width="1" opacity="0.6"/><line x1="74" y1="60" x2="68" y2="54" stroke="#e0d0ff" stroke-width="1" opacity="0.6"/><text x="42" y="40" font-family="Georgia,serif" font-size="16" font-weight="700" text-anchor="middle" fill="#f0e8ff" letter-spacing="2">${roman}</text></svg>${sp}</div>`;
}
function _rbMaster() {
  const id = ++_rbCnt;
  const fires = [{x:20,y:56,d:0.0,dur:0.7},{x:30,y:60,d:0.1,dur:0.9},{x:42,y:62,d:0.2,dur:0.8},{x:54,y:60,d:0.05,dur:1.0},{x:64,y:56,d:0.3,dur:0.75},{x:14,y:46,d:0.4,dur:0.85},{x:70,y:46,d:0.15,dur:0.95}]
    .map(f=>`<div class="rb-fire" style="left:${f.x}px;top:${f.y}px;width:8px;height:12px;background:linear-gradient(#ffe060,#ff4000);animation-delay:${f.d}s;animation-duration:${f.dur}s"></div>`).join('');
  return `<div class="master-wrap"><svg width="84" height="84" viewBox="0 0 84 84" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="mg${id}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#ff6020"/><stop offset="100%" stop-color="#a01000"/></linearGradient></defs><polygon points="42,8 70,24 70,56 42,72 14,56 14,24" fill="url(#mg${id})" stroke="#601000" stroke-width="2"/><polygon points="42,16 62,28 62,52 42,64 22,52 22,28" fill="none" stroke="#ff8040" stroke-width="1" opacity="0.5"/><polygon points="42,22 46,34 58,34 49,41 52,53 42,46 32,53 35,41 26,34 38,34" fill="#f0c040" stroke="#8a5000" stroke-width="1.2"/></svg>${fires}</div>`;
}
function _rbKing() {
  const sparks = Array.from({length:10},(_,i)=>{
    const a=i*36, r=38, dx=Math.round(Math.cos(a*Math.PI/180)*r), dy=Math.round(Math.sin(a*Math.PI/180)*r);
    return `<div class="rb-gold-sparkle" style="left:45px;top:45px;--dx:${dx}px;--dy:${dy}px;animation-delay:${(i*0.12).toFixed(2)}s;animation-duration:${(1.0+i*0.08).toFixed(2)}s"></div>`;
  }).join('');
  return `<div class="king-wrap"><div class="king-glow"></div><svg width="90" height="90" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" class="king-swing"><path d="M94.52 21.81c2.44-1.18 4.13-3.67 4.13-6.56a7.28 7.28 0 0 0-14.56 0c0 2.93 1.73 5.44 4.22 6.6c-2.88 15.6-7.3 27.21-23.75 29.69c0 0 4.43 22.15 25.15 22.15s22.82-21.93 22.82-21.93c-16.81.86-18.23-20.27-18.01-29.95z" fill="#f19534"/><path d="M34.74 21.81c-2.44-1.18-4.13-3.67-4.13-6.56a7.28 7.28 0 0 1 14.56 0c0 2.93-1.73 5.44-4.22 6.6c2.88 15.6 7.3 27.21 23.75 29.69c0 0-4.43 22.15-25.15 22.15S16.74 51.77 16.74 51.77c16.8.85 18.22-20.28 18-29.96z" fill="#f19534"/><path d="M119.24 16.86c-3.33-.45-6.51 2.72-7.09 7.06c-.36 2.71.37 5.24 1.78 6.87l-2.4 9.95s-3.67 23.51-22.21 28.15C74.5 72.6 69.13 45.47 67.83 37.09c2.82-1.4 4.77-4.3 4.77-7.67c0-4.73-3.83-8.56-8.56-8.56s-8.56 3.83-8.56 8.56c0 3.39 1.98 6.32 4.85 7.7c-1.03 8.27-5.57 34.5-21.57 31.76c-16.24-2.79-23.33-30.14-24.97-37.58c1.95-1.6 3.04-4.42 2.64-7.45c-.58-4.35-4.02-7.47-7.68-6.98c-3.66.49-6.15 4.41-5.57 8.75c.42 3.16 2.36 5.67 4.79 6.62l12.72 79.03s11.1 8.77 43.35 8.77s43.35-8.77 43.35-8.77l12.75-79.24c2.06-1.08 3.68-3.51 4.08-6.49c.59-4.35-1.64-8.23-4.98-8.68z" fill="#ffca28"/><ellipse cx="64.44" cy="88.3" rx="9.74" ry="11.61" fill="#26a69a"/><path d="M64.44 79.56c.38.42.72 1.19 0 2.69s-4.6 3.53-5.31 3.94c-.71.42-1.18.23-1.4.06c-1.05-.84-.65-2.74.03-3.9c1.46-2.51 4.55-5.1 6.68-2.79z" fill="#69f0ae"/><path d="M118.09 78.8c1.56-8.63-4.24-10.79-4.24-10.79s-3.74-.68-5.5 9.03c-1.76 9.7 1.98 10.38 1.98 10.38s6.19.01 7.76-8.62z" fill="#26a69a"/><path d="M9.76 79.06C8.19 70.44 14 68.27 14 68.27s3.74-.68 5.5 9.03c1.76 9.7-1.98 10.38-1.98 10.38s-6.2.01-7.76-8.62z" fill="#26a69a"/><path d="M99.99 87.16c-.69 3.93-3.84 6.66-7.05 6.1c-3.21-.56-3.65-3.91-2.96-7.84c.69-3.93 2.24-6.94 5.44-6.38c3.21.56 5.26 4.2 4.57 8.12z" fill="#f44336"/><path d="M30.43 87.16c.69 3.93 3.84 6.66 7.05 6.1s3.65-3.91 2.96-7.84c-.69-3.93-2.24-6.94-5.44-6.38s-5.25 4.2-4.57 8.12z" fill="#f44336"/><path d="M109.15 98.21c-5.99 3-19.73 10.99-45.1 10.99s-39.11-7.99-45.1-10.99c0 0-2.15 1.15-2.15 2.35v9.21c0 1.23.65 2.36 1.71 2.99c4.68 2.76 18.94 9.28 45.55 9.28s40.87-6.52 45.55-9.28a3.475 3.475 0 0 0 1.71-2.99v-9.21c-.02-1.2-2.17-2.35-2.17-2.35z" fill="#ffca28"/><path d="M39.6 110.84c2.8.55 3.65.79 3.46 2.35c-.39 3.07-6.76 2.34-10.53 1.35c-7.79-2.05-9.37-4.21-9.37-6.14c0-1.77 1.36-1.98 3.46-1.24c2.51.89 6.39 2.39 12.98 3.68z" fill="#fff59d"/><path d="M109.15 100.23s-16.57 9.38-45.1 9.38s-45.1-9.38-45.1-9.38" fill="none" stroke="#f19534" stroke-width="4" stroke-linecap="round" stroke-miterlimit="10"/></svg>${sparks}</div>`;
}

function getRankBadgeSVG(pts, playerId, size) {
  size = size || 36;
  const rank = getRank(pts, playerId != null ? playerId : -999);
  const tier = rank.id;
  let level = 'I';
  const _dm = {
    bronze:   [[0,33,'III'],[34,66,'II'],[67,100,'I']],
    silver:   [[101,166,'III'],[167,233,'II'],[234,300,'I']],
    gold:     [[301,367,'III'],[368,433,'II'],[434,500,'I']],
    platinum: [[501,600,'III'],[601,700,'II'],[701,800,'I']],
    diamond:  [[801,1033,'III'],[1034,1266,'II'],[1267,1499,'I']],
  };
  if (_dm[tier]) { for (const [lo,hi,d] of _dm[tier]) { if (pts>=lo && pts<=hi) { level=d; break; } } }
  const opacity = level==='III' ? 0.7 : level==='II' ? 0.85 : 1.0;
  const nativeMax = tier==='king' ? 90 : (tier==='bronze'||tier==='silver') ? 74 : 84;
  const scale = (size / nativeMax).toFixed(3);
  let inner = '';
  if (tier==='bronze')        inner = _rbShield('#e09040','#8a4010','#6a2800', level, '#fffacc');
  else if (tier==='silver')   inner = _rbShield('#c8d8e8','#405060','#304050', level, '#1a2830');
  else if (tier==='gold')     inner = _rbGold(level);
  else if (tier==='platinum') inner = _rbPlat(level);
  else if (tier==='diamond')  inner = _rbDiamond(level);
  else if (tier==='master')   inner = _rbMaster();
  else if (tier==='king')     inner = _rbKing();
  const op = (tier==='king'||tier==='master') ? 1 : opacity;
  return `<span style="display:inline-block;width:${size}px;height:${size}px;overflow:hidden;vertical-align:middle;flex-shrink:0;line-height:0;opacity:${op}"><span style="display:block;transform:scale(${scale});transform-origin:0 0">${inner}</span></span>`;
}

// ── Initialize theme/style (runs last, after all scripts load) ──────────
// loadTheme() was previously called in leaderboard.js before utils.js loaded,
// causing ReferenceError. Moved here so it runs once utils.js is ready.
loadTheme();

function getRankBadgeSVGTier(tier, size) {
  size = size || 36;
  const nativeMax = tier==='king' ? 90 : (tier==='bronze'||tier==='silver') ? 74 : 84;
  const scale = (size / nativeMax).toFixed(3);
  let inner = '';
  if (tier==='bronze')        inner = _rbShield('#e09040','#8a4010','#6a2800','I','#fffacc');
  else if (tier==='silver')   inner = _rbShield('#c8d8e8','#405060','#304050','I','#1a2830');
  else if (tier==='gold')     inner = _rbGold('I');
  else if (tier==='platinum') inner = _rbPlat('I');
  else if (tier==='diamond')  inner = _rbDiamond('I');
  else if (tier==='master')   inner = _rbMaster();
  else if (tier==='king')     inner = _rbKing();
  return `<span style="display:inline-block;width:${size}px;height:${size}px;overflow:hidden;vertical-align:middle;flex-shrink:0;line-height:0"><span style="display:block;transform:scale(${scale});transform-origin:0 0">${inner}</span></span>`;
}

