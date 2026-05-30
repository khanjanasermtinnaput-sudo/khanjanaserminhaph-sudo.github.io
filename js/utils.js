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
  solaremperor: '<div class="se-bg"></div><div class="se-stars"></div><div class="se-stars2"></div><div class="se-ring"></div><div class="se-sweep"></div><div class="se-sweep2"></div><div class="se-flare"></div><div class="se-flare"></div><div class="se-crown"></div><div class="se-sp"></div><div class="se-sp"></div><div class="se-sp"></div><div class="se-sp"></div>',
  solar: '<div class="se-bg"></div><div class="se-stars"></div><div class="se-stars2"></div><div class="se-ring"></div><div class="se-sweep"></div><div class="se-sweep2"></div><div class="se-flare"></div><div class="se-flare"></div><div class="se-crown"></div><div class="se-sp"></div><div class="se-sp"></div><div class="se-sp"></div><div class="se-sp"></div>',
  thundergod: '<div class="gf-glow"></div><div class="gf-ring"></div><div class="gf-ring2"></div><div class="gf-bolt"></div><div class="gf-bolt"></div><div class="gf-bolt"></div><div class="gf-p"></div><div class="gf-p"></div><div class="gf-p"></div>',
};
// Backward-compat alias: old 'solar' key maps to new 'solaremperor'
function _resolveFrameKey(f) { return (f === 'solar') ? 'solaremperor' : f; }
function _resolveNameKey(n)  { return (n === 'solar') ? 'solaremperor' : n; }
// Returns extra class for the avatar element e.g. "gf-void"
function getGachaFrameClass(player) {
  const raw = player && player.gachaFrame;
  const f = _resolveFrameKey(raw);
  if (!f || !(f in GACHA_FRAME_INNER)) return '';
  return 'gf-' + f;
}
// Returns inner HTML to inject inside the avatar element for particles/glow
function getGachaFrameInner(player) {
  const raw = player && player.gachaFrame;
  const f = _resolveFrameKey(raw);
  return (f && (f in GACHA_FRAME_INNER)) ? GACHA_FRAME_INNER[f] : '';
}
// Returns extra class for the name element e.g. "gn-void"
function getGachaNameClass(player) {
  const raw = player && player.gachaName;
  const n = _resolveNameKey(raw);
  if (!n || !['void','halo','blaze','ice','thundergod','solaremperor'].includes(n)) return '';
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
function loadTheme() {
  const t = localStorage.getItem('badminton_theme') || 'dark';
  const sRaw = localStorage.getItem('badminton_style') || 'glass';
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
  if (tab === 'doubles') renderDoublesPlayers();
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
  return { id: p.id, name: p.name, pin: p.pin, pts: p.pts, wins: p.wins, losses: p.losses, isAdmin: (p.is_admin === true || p.is_admin === 1) ? 1 : 0, primeTitles: realPt, customAch: ca, _catalogShared: catalogShared, _hofShared: hofShared, gachaFrame: _gFrame, gachaName: _gName, coins: p.coins || 0, gachaEmoji: _gEmoji, consecutiveLosses: p.consecutive_losses || 0, _dbGachaInv: _dbInv, super1000Titles, pinnedAchs };
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

