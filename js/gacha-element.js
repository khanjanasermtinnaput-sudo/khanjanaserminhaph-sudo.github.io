// ── Gacha Element System — SVG SMIL only, no Canvas/rAF loops ──────────────
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  const GACHA_ELEMENTS = [
    { id: 'earth',     name: 'TERRA ดิน',   emoji: '🌍', rarity: 'Common',
      rarityTh: 'ธรรมดา',    rate: 70,
      c: { ring: '#c8932a', ring2: '#8B6914', glow: '#e8c56a', text: '#fde68a', bg: '#2d1f08' } },
    { id: 'water',     name: 'AQUA น้ำ',    emoji: '💧', rarity: 'Uncommon',
      rarityTh: 'หายากกลาง', rate: 12.5,
      c: { ring: '#38bdf8', ring2: '#0ea5e9', glow: '#7dd3fc', text: '#e0f2fe', bg: '#082030' } },
    { id: 'wind',      name: 'ZEPHYR ลม',   emoji: '🌀', rarity: 'Uncommon',
      rarityTh: 'หายากกลาง', rate: 12.5,
      c: { ring: '#34d399', ring2: '#10b981', glow: '#6ee7b7', text: '#d1fae5', bg: '#062018' } },
    { id: 'fire',      name: 'IGNIS ไฟ',    emoji: '🔥', rarity: 'Mythic',
      rarityTh: 'มิธิก',     rate: 2.45,
      c: { ring: '#f97316', ring2: '#dc2626', glow: '#fb923c', text: '#fed7aa', bg: '#2d0f04' } },
    { id: 'lightning', name: 'VOLT สายฟ้า', emoji: '⚡', rarity: 'Mythic',
      rarityTh: 'มิธิก',     rate: 2.45,
      c: { ring: '#fbbf24', ring2: '#f59e0b', glow: '#fde68a', text: '#fef9c3', bg: '#201800' } },
    { id: 'yinyang',   name: 'YIN YANG',    emoji: '☯️', rarity: 'Secret',
      rarityTh: 'ซีเคร็ต',   rate: 0.1,
      c: { ring: '#ffffff', ring2: '#000000', glow: '#c4b5fd', text: 'split',   bg: '#0a0a12' } },
  ];

  let gachaState = { pulling: false };
  let _geUidCtr  = 0;
  function _uid() { return ++_geUidCtr; }

  // ── CSS injection ─────────────────────────────────────────────────────────────
  (function () {
    const s = document.createElement('style');
    s.textContent = `
@keyframes geShimmerFlow{from{background-position:-300% center}to{background-position:300% center}}
@keyframes geWindLetters{0%,100%{letter-spacing:2px}50%{letter-spacing:8px}}
@keyframes geLightFlicker{0%,88%,100%{opacity:1;text-shadow:0 0 8px #ffe066,0 0 16px #ffc107}89%,93%{opacity:.15;text-shadow:none}91%,95%{opacity:1;text-shadow:0 0 8px #ffe066,0 0 16px #ffc107}}
@keyframes geBlink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes gePopIn{from{opacity:0;transform:scale(.3) rotate(-8deg)}to{opacity:1;transform:scale(1) rotate(0)}}
@keyframes geBadgePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes geIdleBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.ge-idle-orb{width:110px;height:110px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#2a2a5a,#0e0e1a);border:3px solid #2a2a4a;display:flex;align-items:center;justify-content:center;font-size:44px;box-shadow:0 0 0 6px #1a1a3022,0 8px 24px #00000088;animation:geIdleBob 2.5s ease-in-out infinite}
.ge-pull-btn{font-family:'Fredoka One',cursive;font-size:20px;letter-spacing:3px;padding:14px 52px;background:linear-gradient(180deg,#4a4aff,#2a2acf);color:#fff;border:none;border-radius:12px;cursor:pointer;width:100%;box-shadow:0 6px 0 #1a1a8f,0 8px 20px #4a4aff44,inset 0 1px 0 rgba(255,255,255,.3);transition:transform .08s,box-shadow .08s;-webkit-text-stroke:1px #1a1a8f;paint-order:stroke fill}
.ge-pull-btn:hover{transform:translateY(-2px);box-shadow:0 8px 0 #1a1a8f,0 12px 28px #4a4aff55,inset 0 1px 0 rgba(255,255,255,.3)}
.ge-pull-btn:active{transform:translateY(4px);box-shadow:0 2px 0 #1a1a8f,0 4px 12px #4a4aff33,inset 0 1px 0 rgba(255,255,255,.3)}
.ge-pull-btn:disabled{opacity:.5;cursor:default;transform:none;box-shadow:0 6px 0 #1a1a8f}
.ge-name-block{text-align:center;width:100%}
.ge-name{font-family:'Fredoka One',cursive;font-size:22px;letter-spacing:2px;display:inline-block;paint-order:stroke fill;-webkit-text-stroke:2px #0e0e1a}
.ge-shimmer{animation:geShimmerFlow 2.5s linear infinite;-webkit-text-stroke:0}
.ge-shimmer-fast{animation:geShimmerFlow 1.5s linear infinite;-webkit-text-stroke:0}
.ge-wind-letters{animation:geWindLetters 2s ease-in-out infinite}
.ge-flicker{animation:geLightFlicker 2.5s ease-in-out infinite}
.ge-rarity{font-family:'Press Start 2P',monospace;font-size:6px;letter-spacing:3px;display:block;margin-top:4px}
.ge-badge{font-family:'Press Start 2P',monospace;font-size:6px;padding:3px 8px;border-radius:4px;display:inline-block;margin-bottom:4px}
.ge-badge-secret{background:#1a0a2e;color:#c4b5fd;border:2px solid #7c3aed;animation:geBadgePulse 1.5s ease-in-out infinite}
.ge-badge-mythic{background:#1a0a00}
.ge-pull-btn-10{background:linear-gradient(180deg,#7c3aed,#5b21b6)!important;box-shadow:0 6px 0 #3b0764,0 8px 20px #7c3aed44,inset 0 1px 0 rgba(255,255,255,.3)!important}
.ge-pull-btn-10:hover{box-shadow:0 8px 0 #3b0764,0 12px 28px #7c3aed55,inset 0 1px 0 rgba(255,255,255,.3)!important}
.ge-coin-bal{text-align:center;padding:8px 12px;background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.2);border-radius:10px;font-size:.82rem;font-weight:700;color:#fbbf24;margin-bottom:14px}
.ge-r10-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:10px;opacity:0;animation:gePopIn .4s cubic-bezier(.34,1.56,.64,1) forwards}
    `;
    document.head.appendChild(s);
  }());

  // ── localStorage helpers ───────────────────────────────────────────────────────
  function _geGetData(pid) {
    try { return JSON.parse(localStorage.getItem('bmt_gacha_' + pid) || '{}'); } catch (e) { return {}; }
  }
  function _geSetData(pid, patch) {
    try {
      const d = _geGetData(pid);
      localStorage.setItem('bmt_gacha_' + pid, JSON.stringify(Object.assign({}, d, patch)));
    } catch (e) {}
  }
  function _geGetInventory(pid) {
    const d = _geGetData(pid);
    try { return JSON.parse(d.elementInventory || '[]'); } catch (e) { return []; }
  }

  // ── SVG helpers ───────────────────────────────────────────────────────────────
  function _mkEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }
  function _mkCirc(cx, cy, r, fill, stroke, sw) {
    return _mkEl('circle', { cx, cy, r, fill, stroke, 'stroke-width': sw });
  }
  function _mkRoot(W) {
    const s = _mkEl('svg', { width: W, height: W, viewBox: `0 0 ${W} ${W}` });
    s.style.cssText = 'position:absolute;inset:0;z-index:3;overflow:visible;pointer-events:none;';
    return s;
  }
  function _anim(el, a) { el.appendChild(_mkEl('animate', a)); return el; }
  function _atAnim(el, a) { el.appendChild(_mkEl('animateTransform', a)); return el; }

  // ── Frame builders (SVG SMIL only) ───────────────────────────────────────────

  function _frameEarth(el, W) {
    const svg = _mkRoot(W), cx = W / 2, cy = W / 2, r = W / 2 - 4;
    svg.appendChild(_mkCirc(cx, cy, r + 3, 'none', '#0e0e1a', 4));
    svg.appendChild(_mkCirc(cx, cy, r, 'none', el.c.ring, 6));
    // spinning hex dots
    const g = _mkEl('g');
    _atAnim(g, { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `360 ${cx} ${cy}`, dur: '8s', repeatCount: 'indefinite' });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, px = cx + Math.cos(a) * (r - 2), py = cy + Math.sin(a) * (r - 2);
      g.appendChild(_mkEl('rect', { x: px - 4, y: py - 4, width: 8, height: 8, fill: el.c.ring, rx: 2, stroke: '#0e0e1a', 'stroke-width': 1.5 }));
    }
    svg.appendChild(g);
    // corner squares
    [[cx, 4], [cx, W - 4], [4, cy], [W - 4, cy]].forEach(([ox, oy], i) => {
      const sq = _mkEl('rect', { x: ox - 5, y: oy - 5, width: 10, height: 10, fill: el.c.ring2, rx: 2, stroke: '#0e0e1a', 'stroke-width': 1.5 });
      _anim(sq, { attributeName: 'opacity', values: '0.5;1;0.5', dur: `${1.4 + i * 0.2}s`, repeatCount: 'indefinite' });
      svg.appendChild(sq);
    });
    return svg;
  }

  function _frameWater(el, W) {
    const svg = _mkRoot(W), cx = W / 2, cy = W / 2, r = W / 2 - 5, circ = 2 * Math.PI * r;
    svg.appendChild(_mkCirc(cx, cy, r + 3, 'none', '#0e0e1a', 5));
    const ring = _mkCirc(cx, cy, r, 'none', el.c.ring, 5);
    ring.setAttribute('stroke-dasharray', `${circ * 0.6} ${circ * 0.4}`);
    _atAnim(ring, { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `360 ${cx} ${cy}`, dur: '4s', repeatCount: 'indefinite' });
    svg.appendChild(ring);
    const ring2 = _mkCirc(cx, cy, r - 9, 'none', el.c.ring2, 3);
    ring2.setAttribute('stroke-dasharray', `${circ * 0.3} ${circ * 0.7}`);
    _atAnim(ring2, { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `-360 ${cx} ${cy}`, dur: '3s', repeatCount: 'indefinite' });
    svg.appendChild(ring2);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 4, ox = cx + Math.cos(a) * (r - 1), oy = cy + Math.sin(a) * (r - 1);
      const d = _mkCirc(ox, oy, 5, el.c.glow, '#0e0e1a', 2);
      _anim(d, { attributeName: 'r', values: '4;6;4', dur: `${1 + i * 0.3}s`, repeatCount: 'indefinite' });
      svg.appendChild(d);
    }
    return svg;
  }

  function _frameWind(el, W) {
    const svg = _mkRoot(W), cx = W / 2, cy = W / 2, r = W / 2 - 5;
    [{ r, sw: 5, color: el.c.ring, dash: '80 30', dur: '2s', dir: 1 },
     { r: r - 9, sw: 3, color: el.c.ring2, dash: '50 40', dur: '1.5s', dir: -1 },
     { r: r - 17, sw: 2, color: el.c.glow, dash: '30 50', dur: '1s', dir: 1 }
    ].forEach(o => {
      svg.appendChild(_mkCirc(cx, cy, o.r + 2, 'none', '#0e0e1a', o.sw + 2));
      const arc = _mkCirc(cx, cy, o.r, 'none', o.color, o.sw);
      arc.setAttribute('stroke-dasharray', o.dash);
      arc.setAttribute('stroke-linecap', 'round');
      _atAnim(arc, { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `${o.dir * 360} ${cx} ${cy}`, dur: o.dur, repeatCount: 'indefinite' });
      svg.appendChild(arc);
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 8, tx = cx + Math.cos(a) * (r + 2), ty = cy + Math.sin(a) * (r + 2), s = 7;
      const tri = _mkEl('polygon', { points: `${tx},${ty - s} ${tx - s * 0.6},${ty + s * 0.5} ${tx + s * 0.6},${ty + s * 0.5}`, fill: el.c.glow, stroke: '#0e0e1a', 'stroke-width': 1.5 });
      _atAnim(tri, { attributeName: 'transform', type: 'rotate', from: `0 ${tx} ${ty}`, to: `360 ${tx} ${ty}`, dur: `${1.4 + i * 0.2}s`, repeatCount: 'indefinite' });
      svg.appendChild(tri);
    }
    return svg;
  }

  function _frameFire(el, W) {
    const svg = _mkRoot(W), cx = W / 2, cy = W / 2, r = W / 2 - 5;
    const glowBig = _mkCirc(cx, cy, r + 8, 'none', '#dc2626', 22);
    glowBig.setAttribute('opacity', '0.18'); glowBig.style.filter = 'blur(10px)';
    _anim(glowBig, { attributeName: 'opacity', values: '0.1;0.28;0.1', dur: '1.2s', repeatCount: 'indefinite' });
    _anim(glowBig, { attributeName: 'stroke-width', values: '18;32;18', dur: '1.2s', repeatCount: 'indefinite' });
    svg.appendChild(glowBig);
    const glowIn = _mkCirc(cx, cy, r, 'none', '#f97316', 14);
    glowIn.setAttribute('opacity', '0.3'); glowIn.style.filter = 'blur(5px)';
    _anim(glowIn, { attributeName: 'opacity', values: '0.2;0.5;0.2', dur: '0.9s', repeatCount: 'indefinite' });
    svg.appendChild(glowIn);
    svg.appendChild(_mkCirc(cx, cy, r + 3, 'none', '#0e0e1a', 5));
    const ring = _mkCirc(cx, cy, r, 'none', el.c.ring, 7);
    _anim(ring, { attributeName: 'stroke-width', values: '5;10;5', dur: '0.8s', repeatCount: 'indefinite' });
    _anim(ring, { attributeName: 'stroke', values: '#f97316;#dc2626;#fbbf24;#f97316', dur: '1.2s', repeatCount: 'indefinite' });
    svg.appendChild(ring);
    // 8 big morphing flames
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, tipR = r + 20 + (i % 2) * 8;
      const tx = cx + Math.cos(a) * tipR, ty = cy + Math.sin(a) * tipR;
      const b1x = cx + Math.cos(a - 0.28) * (r - 2), b1y = cy + Math.sin(a - 0.28) * (r - 2);
      const b2x = cx + Math.cos(a + 0.28) * (r - 2), b2y = cy + Math.sin(a + 0.28) * (r - 2);
      const mx  = cx + Math.cos(a + 0.12) * (r + 10), my = cy + Math.sin(a + 0.12) * (r + 10);
      const t2x = cx + Math.cos(a + 0.08) * (tipR - 6), t2y = cy + Math.sin(a + 0.08) * (tipR - 6);
      const m2x = cx + Math.cos(a - 0.1)  * (r + 8),   m2y = cy + Math.sin(a - 0.1)  * (r + 8);
      const flm = _mkEl('polygon', {
        points: `${tx},${ty} ${mx},${my} ${b1x},${b1y} ${b2x},${b2y}`,
        fill: i % 3 === 0 ? '#fbbf24' : i % 3 === 1 ? '#f97316' : '#dc2626',
        stroke: '#0e0e1a', 'stroke-width': 1.5, 'stroke-linejoin': 'round'
      });
      const d = (i * 0.1).toFixed(2);
      _anim(flm, { attributeName: 'points', dur: '0.6s', begin: `${d}s`, repeatCount: 'indefinite',
        values: `${tx},${ty} ${mx},${my} ${b1x},${b1y} ${b2x},${b2y};${t2x},${t2y} ${m2x},${m2y} ${b1x},${b1y} ${b2x},${b2y};${tx},${ty} ${mx},${my} ${b1x},${b1y} ${b2x},${b2y}` });
      _anim(flm, { attributeName: 'opacity', values: '0.8;1;0.6;1;0.8', dur: '0.6s', begin: `${d}s`, repeatCount: 'indefinite' });
      svg.appendChild(flm);
    }
    // 8 inner small flames interleaved
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      const tx = cx + Math.cos(a) * (r + 10), ty = cy + Math.sin(a) * (r + 10);
      const b1x = cx + Math.cos(a - 0.18) * (r - 1), b1y = cy + Math.sin(a - 0.18) * (r - 1);
      const b2x = cx + Math.cos(a + 0.18) * (r - 1), b2y = cy + Math.sin(a + 0.18) * (r - 1);
      const flm2 = _mkEl('polygon', { points: `${tx},${ty} ${b1x},${b1y} ${b2x},${b2y}`, fill: '#fbbf24', stroke: '#0e0e1a', 'stroke-width': 1 });
      const d2 = (i * 0.08 + 0.05).toFixed(2);
      _anim(flm2, { attributeName: 'opacity', values: '0.5;1;0.3;0.9;0.5', dur: '0.5s', begin: `${d2}s`, repeatCount: 'indefinite' });
      svg.appendChild(flm2);
    }
    // 12 ember sparks
    const eColors = ['#fbbf24', '#f97316', '#ffffff', '#fde68a'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const sx = cx + Math.cos(a) * (r + 4), sy = cy + Math.sin(a) * (r + 4);
      const ex = cx + Math.cos(a + 0.3) * (r + 28), ey = cy + Math.sin(a + 0.3) * (r + 28);
      const em = _mkCirc(sx, sy, 2, eColors[i % 4], 'none', 0);
      const d = (i * 0.15).toFixed(2);
      _atAnim(em, { attributeName: 'transform', type: 'translate', values: `0,0;${ex - sx},${ey - sy}`, dur: '0.8s', begin: `${d}s`, repeatCount: 'indefinite' });
      _anim(em, { attributeName: 'opacity', values: '0;1;1;0', dur: '0.8s', begin: `${d}s`, repeatCount: 'indefinite' });
      _anim(em, { attributeName: 'r', values: '2;1;0', dur: '0.8s', begin: `${d}s`, repeatCount: 'indefinite' });
      svg.appendChild(em);
    }
    return svg;
  }

  function _frameLightning(el, W) {
    const svg = _mkRoot(W), cx = W / 2, cy = W / 2, r = W / 2 - 5;
    const glowBig = _mkCirc(cx, cy, r + 8, 'none', '#fbbf24', 20);
    glowBig.setAttribute('opacity', '0.15'); glowBig.style.filter = 'blur(10px)';
    _anim(glowBig, { attributeName: 'opacity', values: '0.08;0.25;0.04;0.2;0.08', dur: '1.5s', repeatCount: 'indefinite' });
    _anim(glowBig, { attributeName: 'stroke-width', values: '16;28;10;24;16', dur: '1.5s', repeatCount: 'indefinite' });
    svg.appendChild(glowBig);
    const glowIn = _mkCirc(cx, cy, r, 'none', '#ffffff', 8);
    glowIn.setAttribute('opacity', '0.1'); glowIn.style.filter = 'blur(4px)';
    _anim(glowIn, { attributeName: 'opacity', values: '0.05;0.2;0.02;0.15;0.05', dur: '0.8s', repeatCount: 'indefinite' });
    svg.appendChild(glowIn);
    svg.appendChild(_mkCirc(cx, cy, r + 3, 'none', '#0e0e1a', 5));
    const ring = _mkCirc(cx, cy, r, 'none', el.c.ring, 5);
    ring.setAttribute('stroke-dasharray', '6 8');
    ring.setAttribute('stroke-linecap', 'square');
    _atAnim(ring, { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `360 ${cx} ${cy}`, dur: '1.5s', repeatCount: 'indefinite' });
    _anim(ring, { attributeName: 'opacity', values: '1;0.05;1;1;0.1;1;0.6;1', dur: '1.2s', repeatCount: 'indefinite' });
    _anim(ring, { attributeName: 'stroke', values: `${el.c.ring};#ffffff;${el.c.ring};${el.c.ring2};${el.c.ring}`, dur: '1.2s', repeatCount: 'indefinite' });
    svg.appendChild(ring);
    // 6 zigzag bolts
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sx = cx + Math.cos(a) * (r - 2), sy = cy + Math.sin(a) * (r - 2);
      const z1x = cx + Math.cos(a + 0.18) * (r + 7),   z1y = cy + Math.sin(a + 0.18) * (r + 7);
      const z2x = cx + Math.cos(a - 0.14) * (r + 14),  z2y = cy + Math.sin(a - 0.14) * (r + 14);
      const ex  = cx + Math.cos(a + 0.06) * (r + 22),  ey  = cy + Math.sin(a + 0.06) * (r + 22);
      const pts = `${sx},${sy} ${z1x},${z1y} ${z2x},${z2y} ${ex},${ey}`;
      svg.appendChild(_mkEl('polyline', { points: pts, fill: 'none', stroke: '#0e0e1a', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      const bEl = _mkEl('polyline', { points: pts, fill: 'none', stroke: '#fef9c3', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      const d = (i * 0.18).toFixed(2);
      _anim(bEl, { attributeName: 'opacity', values: '0;1;1;0;0;0.8;1;0', dur: '1s', begin: `${d}s`, repeatCount: 'indefinite' });
      _anim(bEl, { attributeName: 'stroke-width', values: '1.5;3;1.5;2.5', dur: '1s', begin: `${d}s`, repeatCount: 'indefinite' });
      _anim(bEl, { attributeName: 'stroke', values: '#fef9c3;#ffffff;#fbbf24;#fef9c3', dur: '1s', begin: `${d}s`, repeatCount: 'indefinite' });
      svg.appendChild(bEl);
      const spark = _mkCirc(ex, ey, 4, '#ffffff', '#fbbf24', 1.5);
      _anim(spark, { attributeName: 'opacity', values: '0;1;1;0', dur: '1s', begin: `${d}s`, repeatCount: 'indefinite' });
      _anim(spark, { attributeName: 'r', values: '2;5;2', dur: '1s', begin: `${d}s`, repeatCount: 'indefinite' });
      svg.appendChild(spark);
    }
    // 12 small spike ornaments on ring
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const ox = cx + Math.cos(a) * (r + 1), oy = cy + Math.sin(a) * (r + 1);
      const ix = cx + Math.cos(a) * (r - 8),  iy = cy + Math.sin(a) * (r - 8);
      const lx = cx + Math.cos(a - 0.22) * (r - 4), ly = cy + Math.sin(a - 0.22) * (r - 4);
      const spike = _mkEl('polygon', { points: `${ox},${oy} ${lx},${ly} ${ix},${iy}`, fill: i % 2 === 0 ? el.c.ring : '#fff', stroke: '#0e0e1a', 'stroke-width': 1 });
      const d2 = (i % 4 * 0.15).toFixed(2);
      _anim(spike, { attributeName: 'opacity', values: '1;0.05;1;0.5;1', dur: '1.4s', begin: `${d2}s`, repeatCount: 'indefinite' });
      svg.appendChild(spike);
    }
    // 8 electric arc dots scattered around ring
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const ox = cx + Math.cos(a) * (r + 16), oy = cy + Math.sin(a) * (r + 16);
      const arc = _mkCirc(ox, oy, 3, '#fef9c3', '#fbbf24', 1);
      const d3 = (i * 0.13).toFixed(2);
      _anim(arc, { attributeName: 'opacity', values: '0;0;1;0;0;1;1;0', dur: '1.2s', begin: `${d3}s`, repeatCount: 'indefinite' });
      _anim(arc, { attributeName: 'r', values: '1;3;1', dur: '1.2s', begin: `${d3}s`, repeatCount: 'indefinite' });
      svg.appendChild(arc);
    }
    return svg;
  }

  function _frameYinYang(el, W) {
    const uid = _uid(), svg = _mkRoot(W), cx = W / 2, cy = W / 2, R = W / 2 - 6;
    const idYY = `geYY_${uid}`, idL = `geL_${uid}`, idR = `geR_${uid}`;
    // aura layer 1: big soft purple glow, slow breathe
    const a1 = _mkCirc(cx, cy, R + 18, 'none', '#a78bfa', 28);
    a1.setAttribute('opacity', '0.07'); a1.style.filter = 'blur(8px)';
    _anim(a1, { attributeName: 'opacity', values: '0.04;0.13;0.04', dur: '3s', repeatCount: 'indefinite' });
    _anim(a1, { attributeName: 'stroke-width', values: '22;36;22', dur: '3s', repeatCount: 'indefinite' });
    svg.appendChild(a1);
    // aura layer 2: white glow ring, faster
    const a2 = _mkCirc(cx, cy, R + 10, 'none', '#ffffff', 14);
    a2.setAttribute('opacity', '0.1'); a2.style.filter = 'blur(4px)';
    _anim(a2, { attributeName: 'opacity', values: '0.06;0.2;0.06', dur: '2s', repeatCount: 'indefinite' });
    _anim(a2, { attributeName: 'stroke-width', values: '10;20;10', dur: '2s', repeatCount: 'indefinite' });
    svg.appendChild(a2);
    // aura layer 3: purple sharp ring, shimmer
    const a3 = _mkCirc(cx, cy, R + 4, 'none', '#c4b5fd', 4);
    a3.setAttribute('opacity', '0.35');
    _anim(a3, { attributeName: 'opacity', values: '0.2;0.6;0.2', dur: '1.6s', repeatCount: 'indefinite' });
    _anim(a3, { attributeName: 'stroke-width', values: '3;6;3', dur: '1.6s', repeatCount: 'indefinite' });
    svg.appendChild(a3);
    // aura layer 4: spinning dashed ring
    const a4 = _mkCirc(cx, cy, R + 8, 'none', '#e9d5ff', 3);
    a4.setAttribute('stroke-dasharray', '12 8'); a4.setAttribute('opacity', '0.25');
    _atAnim(a4, { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `360 ${cx} ${cy}`, dur: '6s', repeatCount: 'indefinite' });
    _anim(a4, { attributeName: 'opacity', values: '0.1;0.35;0.1', dur: '2.5s', repeatCount: 'indefinite' });
    svg.appendChild(a4);
    // aura layer 5: counter-spinning dashed ring
    const a5 = _mkCirc(cx, cy, R + 12, 'none', '#f1f5f9', 2);
    a5.setAttribute('stroke-dasharray', '8 16'); a5.setAttribute('opacity', '0.15');
    _atAnim(a5, { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `-360 ${cx} ${cy}`, dur: '4s', repeatCount: 'indefinite' });
    _anim(a5, { attributeName: 'opacity', values: '0.08;0.22;0.08', dur: '3s', repeatCount: 'indefinite' });
    svg.appendChild(a5);
    // comic outline
    svg.appendChild(_mkCirc(cx, cy, R + 4, 'none', '#0e0e1a', 6));
    // defs — unique IDs per instance prevent clipPath collisions
    const defs = _mkEl('defs');
    const mkClip = (id, x, y, w, h) => { const cp = _mkEl('clipPath', { id }); cp.appendChild(_mkEl('rect', { x, y, width: w, height: h })); return cp; };
    const cpYY = _mkEl('clipPath', { id: idYY }); cpYY.appendChild(_mkCirc(cx, cy, R, '#fff', 'none', 0)); defs.appendChild(cpYY);
    defs.appendChild(mkClip(idL, 0, 0, cx, W));
    defs.appendChild(mkClip(idR, cx, 0, cx, W));
    svg.appendChild(defs);
    // yin yang body
    const g = _mkEl('g', { 'clip-path': `url(#${idYY})` });
    g.appendChild(_mkEl('path', { d: `M ${cx} ${cy - R} A ${R} ${R} 0 0 0 ${cx} ${cy + R} Z`, fill: '#111' }));
    g.appendChild(_mkEl('path', { d: `M ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${cx} ${cy + R} Z`, fill: '#eee' }));
    const sr = R / 2;
    g.appendChild(_mkCirc(cx, cy - sr, sr,       '#eee', 'none', 0));
    g.appendChild(_mkCirc(cx, cy + sr, sr,       '#111', 'none', 0));
    g.appendChild(_mkCirc(cx, cy - sr, sr * 0.28,'#111', 'none', 0));
    g.appendChild(_mkCirc(cx, cy + sr, sr * 0.28,'#eee', 'none', 0));
    svg.appendChild(g);
    // split ring: black left / white right
    const rBk = _mkCirc(cx, cy, R, 'none', '#111', 5); rBk.setAttribute('clip-path', `url(#${idL})`); svg.appendChild(rBk);
    const rWh = _mkCirc(cx, cy, R, 'none', '#eee', 5); rWh.setAttribute('clip-path', `url(#${idR})`); svg.appendChild(rWh);
    // thin separator line down the middle
    const sep = _mkEl('line', { x1: cx, y1: cy - R - 2, x2: cx, y2: cy + R + 2, stroke: '#88888866', 'stroke-width': 1 });
    svg.appendChild(sep);
    // 8 floating star ornaments with opacity + scale pulse
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, ox = cx + Math.cos(a) * (R + 16), oy = cy + Math.sin(a) * (R + 16);
      const star = _mkEl('polygon', { points: _yyStarPts(ox, oy, 4, 4, 1.8), fill: i % 2 === 0 ? '#fff' : '#c4b5fd', opacity: '0.7' });
      const delay = (i * 0.25).toFixed(2);
      _anim(star, { attributeName: 'opacity', values: '0.3;1;0.3', dur: '2s', begin: `${delay}s`, repeatCount: 'indefinite' });
      _atAnim(star, { attributeName: 'transform', type: 'scale', additive: 'sum', values: '1;1.4;1', dur: '2s', begin: `${delay}s`, repeatCount: 'indefinite', 'transform-origin': `${ox} ${oy}` });
      svg.appendChild(star);
    }
    return svg;
  }

  function _yyStarPts(cx, cy, spikes, outer, inner) {
    let pts = '';
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner, a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      pts += `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r} `;
    }
    return pts.trim();
  }

  // ── PUBLIC: renderElementFrame(elementId, sizePx) ────────────────────────────
  function renderElementFrame(elementId, sizePx) {
    const el = GACHA_ELEMENTS.find(e => e.id === elementId);
    if (!el) return null;
    const W = sizePx || 130;
    switch (el.id) {
      case 'earth':     return _frameEarth(el, W);
      case 'water':     return _frameWater(el, W);
      case 'wind':      return _frameWind(el, W);
      case 'fire':      return _frameFire(el, W);
      case 'lightning': return _frameLightning(el, W);
      case 'yinyang':   return _frameYinYang(el, W);
      default:          return null;
    }
  }
  window.renderElementFrame = renderElementFrame;

  // ── Name HTML ─────────────────────────────────────────────────────────────────
  function _buildNameHtml(el) {
    const uid = _uid();
    let badge = '';
    if (el.rarity === 'Secret')
      badge = `<div class="ge-badge ge-badge-secret">✦ SECRET ✦</div>`;
    else if (el.rarity === 'Mythic')
      badge = `<div class="ge-badge ge-badge-mythic" style="color:${el.c.glow};border:2px solid ${el.c.ring}">★ MYTHIC ★</div>`;

    let nameSpan = '';
    if (el.id === 'earth') {
      nameSpan = `<span class="ge-name" style="color:${el.c.text};text-shadow:0 0 8px ${el.c.glow}66;">${el.name}</span>`;
    } else if (el.id === 'water') {
      nameSpan = `<span class="ge-name ge-shimmer" style="background-image:linear-gradient(90deg,${el.c.ring},${el.c.text},${el.c.glow},${el.c.text},${el.c.ring});background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${el.name}</span>`;
    } else if (el.id === 'wind') {
      nameSpan = `<span class="ge-name ge-wind-letters" style="color:${el.c.text};">${el.name}</span>`;
    } else if (el.id === 'fire') {
      nameSpan = `<span class="ge-name ge-shimmer-fast" style="background-image:linear-gradient(90deg,#dc2626,#f97316,#fbbf24,#f97316,#dc2626);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 6px #f97316);">${el.name}</span>`;
    } else if (el.id === 'lightning') {
      nameSpan = `<span class="ge-name ge-flicker" style="color:${el.c.text};">${el.name}</span>`;
    } else if (el.id === 'yinyang') {
      // split text: left half white, right half black — unique clipPath IDs
      nameSpan = `<span class="ge-name" style="-webkit-text-stroke:0;filter:drop-shadow(0 0 8px #a78bfa66);display:inline-flex;align-items:center;justify-content:center;">
        <svg width="180" height="36" overflow="visible" style="display:block">
          <defs>
            <clipPath id="geNcL_${uid}"><rect x="0" y="0" width="90" height="36"/></clipPath>
            <clipPath id="geNcR_${uid}"><rect x="90" y="0" width="90" height="36"/></clipPath>
          </defs>
          <text x="90" y="28" text-anchor="middle" font-family="Fredoka One,cursive" font-size="20"
            clip-path="url(#geNcL_${uid})" fill="#ffffff" stroke="#0e0e1a" stroke-width="2" paint-order="stroke fill" letter-spacing="2">YIN YANG</text>
          <text x="90" y="28" text-anchor="middle" font-family="Fredoka One,cursive" font-size="20"
            clip-path="url(#geNcR_${uid})" fill="#111111" stroke="#cccccc" stroke-width="2" paint-order="stroke fill" letter-spacing="2">YIN YANG</text>
        </svg></span>`;
    }
    return `<div class="ge-name-block">${badge}${nameSpan}<span class="ge-rarity" style="color:${el.c.glow}">— ${el.rarityTh} · ${el.rate}% —</span></div>`;
  }

  // ── Roll (fallback to earth if float rounding fails) ─────────────────────────
  function _gachaRoll() {
    let r = Math.random() * 100;
    for (const el of GACHA_ELEMENTS) { r -= el.rate; if (r <= 0) return el; }
    return GACHA_ELEMENTS[0];
  }

  // ── SVG burst (SMIL one-shot, fill="freeze", cleared after 1.8s) ─────────────
  function _geBurst(el) {
    let svg = document.getElementById('geBurstSvg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'geBurstSvg';
      svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9998;overflow:visible;';
      document.body.appendChild(svg);
    }
    svg.innerHTML = '';
    const W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H / 2;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const count = el.rarity === 'Secret' ? 50 : el.rarity === 'Mythic' ? 30 : 16;
    const textColor = el.c.text === 'split' ? '#c4b5fd' : el.c.text;
    const colors = [el.c.ring, el.c.ring2 || el.c.ring, el.c.glow, textColor];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 200;
      const tx = Math.cos(angle) * dist, ty = Math.sin(angle) * dist;
      const size = Math.random() * 6 + 2, color = colors[Math.floor(Math.random() * colors.length)];
      const dur = (0.5 + Math.random() * 0.8).toFixed(2), delay = (Math.random() * 0.15).toFixed(2);
      const rect = _mkEl('rect', { x: cx - size / 2, y: cy - size / 2, width: size, height: size, fill: color, rx: el.rarity === 'Secret' ? size / 2 : 0 });
      rect.innerHTML = `<animateTransform attributeName="transform" type="translate" values="0,0;${tx},${ty}" dur="${dur}s" begin="${delay}s" fill="freeze"/>
        <animate attributeName="opacity" values="1;0" dur="${dur}s" begin="${delay}s" fill="freeze"/>`;
      svg.appendChild(rect);
    }
    setTimeout(() => { svg.innerHTML = ''; }, 1800);
  }

  // ── Inventory render ──────────────────────────────────────────────────────────
  function _geRenderInventory() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const pid = currentUser.id;
    const inv = _geGetInventory(pid);
    const card = document.getElementById('geInventoryCard');
    const list = document.getElementById('geInventoryList');
    if (!card || !list) return;
    if (!inv.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const d = _geGetData(pid);
    const equipped = d.equippedElement || null;
    list.innerHTML = inv.map(elId => {
      const el = GACHA_ELEMENTS.find(e => e.id === elId);
      if (!el) return '';
      const isEq   = equipped === elId;
      const rc     = el.rarity === 'Secret' ? '#c4b5fd' : el.rarity === 'Mythic' ? el.c.glow : el.c.text === 'split' ? '#c4b5fd' : el.c.text;
      const emojiTxt = (el.id === 'yinyang' && d.hideEmoji) ? '' : el.emoji;
      const emojiBtn = (el.id === 'yinyang' && isEq)
        ? `<button onclick="window.geToggleEmoji()" style="padding:4px 8px;font-size:0.65rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:var(--muted);cursor:pointer;font-family:inherit">${d.hideEmoji ? 'แสดง' : 'ซ่อน'} Emoji</button>`
        : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--glass-border)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="position:relative;width:44px;height:44px;flex-shrink:0" id="geInvT_${elId}_${pid}">
            <div style="width:36px;height:36px;border-radius:50%;background:#1a1a3a;display:flex;align-items:center;justify-content:center;font-size:18px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2">${emojiTxt}</div>
          </div>
          <div>
            <div style="font-size:.82rem;font-weight:700;color:${rc}">${el.name}</div>
            <div style="font-size:.7rem;color:var(--muted)">${el.rarityTh} · ${el.rate}%</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${emojiBtn}
          <button onclick="window.geEquip('${elId}')" style="padding:5px 12px;font-size:.72rem;border-radius:20px;border:1px solid ${isEq ? 'rgba(168,85,247,.8)' : 'rgba(168,85,247,.25)'};background:${isEq ? 'rgba(168,85,247,.2)' : 'rgba(168,85,247,.07)'};color:${isEq ? '#c084fc' : 'var(--muted)'};cursor:pointer;font-family:inherit;transition:all .2s">${isEq ? '✓ ใช้อยู่' : 'ใส่'}</button>
        </div>
      </div>`;
    }).join('');
    // Inject small frames into inventory thumbnails after DOM is ready
    requestAnimationFrame(() => {
      inv.forEach(elId => {
        const wrap = document.getElementById(`geInvT_${elId}_${pid}`);
        if (!wrap || wrap.querySelector('svg')) return;
        const svgF = renderElementFrame(elId, 44);
        if (svgF) wrap.appendChild(svgF);
      });
    });
  }

  // ── Show result card ──────────────────────────────────────────────────────────
  function _geShowResult(el) {
    // flash (CSS transition — no rAF loop)
    let flash = document.getElementById('geFlash');
    if (!flash) {
      flash = document.createElement('div');
      flash.id = 'geFlash';
      flash.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0;';
      document.body.appendChild(flash);
    }
    flash.style.background  = el.c.glow;
    flash.style.transition  = 'none';
    flash.style.opacity     = '0.7';
    setTimeout(() => { flash.style.transition = 'opacity .7s ease-out'; flash.style.opacity = '0'; }, 80);

    _geBurst(el);

    const idle   = document.getElementById('geIdle');
    const result = document.getElementById('geResult');
    if (idle) idle.style.display = 'none';
    if (!result) return;
    result.innerHTML = '';
    result.style.display = 'flex';
    result.style.animation = 'none';
    void result.offsetWidth;
    result.style.animation = 'gePopIn .5s cubic-bezier(.34,1.56,.64,1) forwards';

    // avatar + frame wrap
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:160px;height:160px;flex-shrink:0;';
    const avatar = document.createElement('div');
    avatar.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:122px;height:122px;border-radius:50%;background:radial-gradient(circle at 40% 35%,${el.c.bg},#0e0e1a);display:flex;align-items:center;justify-content:center;font-size:52px;z-index:2;box-shadow:0 0 0 3px #0e0e1a,0 4px 0 3px #00000066;`;
    let emojiShow = el.emoji;
    if (el.id === 'yinyang' && typeof currentUser !== 'undefined' && currentUser) {
      const d = _geGetData(currentUser.id); if (d.hideEmoji) emojiShow = '';
    }
    avatar.textContent = emojiShow;
    const frame = renderElementFrame(el.id, 160);
    wrap.appendChild(avatar);
    if (frame) wrap.appendChild(frame);
    result.appendChild(wrap);

    const nameDiv = document.createElement('div');
    nameDiv.innerHTML = _buildNameHtml(el);
    result.appendChild(nameDiv);

    // equip zone
    const ez = document.getElementById('geEquipZone');
    if (ez && typeof currentUser !== 'undefined' && currentUser) {
      ez.style.display = '';
      const isEq = _geGetData(currentUser.id).equippedElement === el.id;
      ez.innerHTML = `<div style="font-size:.78rem;color:var(--muted);margin-bottom:8px">${isEq ? '✅ Equip แล้ว' : 'ต้องการ Equip Element นี้?'}</div>
        ${!isEq ? `<button onclick="window.geEquipFromPull('${el.id}')" style="padding:8px 24px;font-family:'Fredoka One',cursive;font-size:16px;letter-spacing:2px;border-radius:12px;border:none;background:linear-gradient(135deg,${el.c.ring},${el.c.ring2 || el.c.ring});color:#fff;cursor:pointer;box-shadow:0 4px 0 ${(el.c.ring2 || el.c.ring)}88">⚡ EQUIP</button>` : ''}`;
    }
  }

  // ── Coin helpers ──────────────────────────────────────────────────────────────
  function _geEffectiveCoins() {
    if (typeof currentUser === 'undefined' || !currentUser) return 0;
    if (typeof getEffectiveCoins === 'function') return getEffectiveCoins(currentUser.id);
    const pl = (typeof db !== 'undefined') && db.players && db.players.find(x => x.id === currentUser.id);
    return pl ? (pl.coins || 0) : 0;
  }
  async function _geSpendCoins(cost) {
    if (typeof dbAddCoins === 'function') {
      await dbAddCoins(currentUser.id, -cost);
    } else {
      if (typeof _setLsCoins === 'function') _setLsCoins(currentUser.id, _geEffectiveCoins() - cost);
    }
  }
  function _geUpdateCoinBal() {
    const el = document.getElementById('geCoinBal');
    if (!el) return;
    const coins = _geEffectiveCoins();
    const loggedIn = typeof currentUser !== 'undefined' && currentUser;
    el.textContent = loggedIn ? `🪙 ${coins} เหรียญ` : '🪙 กรุณาเข้าสู่ระบบ';
    const b1 = document.getElementById('gePullBtn'), b10 = document.getElementById('gePull10Btn');
    if (b1)  b1.disabled  = !loggedIn || coins < 5  || gachaState.pulling;
    if (b10) b10.disabled = !loggedIn || coins < 50 || gachaState.pulling;
  }

  // ── x10 result grid ───────────────────────────────────────────────────────────
  function _geShowResults10(results) {
    const idle = document.getElementById('geIdle');
    const result = document.getElementById('geResult');
    const ez = document.getElementById('geEquipZone');
    if (idle) idle.style.display = 'none';
    if (ez) ez.style.display = 'none';
    if (!result) return;

    const rarityRank = { Secret: 0, Mythic: 1, Uncommon: 2, Common: 3 };
    const best = [...results].sort((a, b) => rarityRank[a.rarity] - rarityRank[b.rarity])[0];
    _geBurst(best);
    let flash = document.getElementById('geFlash');
    if (!flash) { flash = document.createElement('div'); flash.id = 'geFlash'; flash.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0;'; document.body.appendChild(flash); }
    flash.style.background = best.c.glow; flash.style.transition = 'none'; flash.style.opacity = '0.5';
    setTimeout(() => { flash.style.transition = 'opacity .7s ease-out'; flash.style.opacity = '0'; }, 80);

    result.style.display = 'block';
    result.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;width:100%">
        ${results.map((el, i) => {
          const rc = el.rarity === 'Secret' ? '#c4b5fd' : el.rarity === 'Mythic' ? el.c.glow : el.c.text === 'split' ? '#c4b5fd' : el.c.text;
          const isBest = el === best;
          return `<div class="ge-r10-card" style="background:${el.c.bg};border:1px solid ${el.c.ring}${isBest ? '' : '44'};${isBest ? `box-shadow:0 0 10px ${el.c.glow}66;` : ''}animation-delay:${(i * 0.06).toFixed(2)}s" id="geR10C_${i}">
            <div style="position:relative;width:56px;height:56px;flex-shrink:0" id="geR10F_${i}">
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:40px;height:40px;border-radius:50%;background:${el.c.bg};display:flex;align-items:center;justify-content:center;font-size:18px;z-index:2">${el.emoji}</div>
            </div>
            <div style="font-size:.58rem;font-weight:700;color:${rc};text-align:center;line-height:1.3;word-break:break-word">${el.name}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:10px;text-align:center;font-size:.72rem;color:var(--muted)">
        Best: <span style="color:${best.c.glow};font-weight:700">${best.name}</span>
        ${best.rarity !== 'Common' ? `<span style="color:${best.c.glow}"> · ${best.rarityTh}</span>` : ''}
      </div>`;

    requestAnimationFrame(() => {
      results.forEach((el, i) => {
        const wrap = document.getElementById(`geR10F_${i}`);
        if (!wrap || wrap.querySelector('svg')) return;
        const svgF = renderElementFrame(el.id, 56);
        if (svgF) wrap.appendChild(svgF);
      });
    });
  }

  // ── Pull ──────────────────────────────────────────────────────────────────────
  async function _pull(count) {
    const n = (count === 10) ? 10 : 1;
    const cost = n * 5;
    if (gachaState.pulling) return;

    if (typeof currentUser === 'undefined' || !currentUser) {
      if (typeof toast === 'function') toast('กรุณาเข้าสู่ระบบก่อน', 'error');
      return;
    }
    if (_geEffectiveCoins() < cost) {
      if (typeof toast === 'function') toast(`เหรียญไม่พอ (ต้องการ ${cost}🪙)`, 'error');
      return;
    }

    gachaState.pulling = true;
    const b1 = document.getElementById('gePullBtn'), b10 = document.getElementById('gePull10Btn');
    if (b1)  { b1.disabled = true;  b1.textContent  = '...'; }
    if (b10) { b10.disabled = true; b10.textContent = '...'; }

    await new Promise(r => setTimeout(r, 300));

    // Deduct coins
    try { await _geSpendCoins(cost); } catch (e) {}

    // Roll
    const results = [];
    for (let i = 0; i < n; i++) results.push(_gachaRoll());

    // Save inventory
    const pid = currentUser.id;
    const inv = _geGetInventory(pid);
    results.forEach(el => { if (!inv.includes(el.id)) inv.push(el.id); });
    const d = _geGetData(pid);
    if (!d.equippedElement) {
      const first = results[0];
      _geSetData(pid, { elementInventory: JSON.stringify(inv), equippedElement: first.id, element: first.id });
    } else {
      _geSetData(pid, { elementInventory: JSON.stringify(inv) });
    }

    if (n === 1) {
      _geShowResult(results[0]);
    } else {
      _geShowResults10(results);
    }

    await new Promise(r => setTimeout(r, n === 1 ? 600 : 800));
    if (b1)  { b1.disabled  = false; b1.textContent  = '⚡ PULL x1 (5🪙)'; }
    if (b10) { b10.disabled = false; b10.textContent = '✦ PULL x10 (50🪙)'; }
    gachaState.pulling = false;
    _geUpdateCoinBal();
    _geRenderInventory();
  }

  // ── Equip helpers ─────────────────────────────────────────────────────────────
  function _geEquip(elId) {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    _geSetData(currentUser.id, { equippedElement: elId, element: elId });
    _geRenderInventory();
    if (typeof renderLeaderboard === 'function') renderLeaderboard();
    else if (typeof renderProfile === 'function') renderProfile();
  }

  function _geEquipFromPull(elId) {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    _geSetData(currentUser.id, { equippedElement: elId, element: elId });
    const el = GACHA_ELEMENTS.find(e => e.id === elId);
    const ez = document.getElementById('geEquipZone');
    if (ez) ez.innerHTML = `<div style="color:var(--neon);font-size:.82rem">✅ Equip ${el ? el.name : elId} สำเร็จ!</div>`;
    _geRenderInventory();
    if (typeof toast === 'function') toast(`✅ Equip ${el ? el.name : elId}!`, 'success');
  }

  function _geToggleEmoji() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const d = _geGetData(currentUser.id);
    _geSetData(currentUser.id, { hideEmoji: !d.hideEmoji });
    _geRenderInventory();
    if (typeof renderProfile === 'function') renderProfile();
  }

  // ── Tab render ────────────────────────────────────────────────────────────────
  function gachaRenderTab() {
    const sec = document.getElementById('gachaSection');
    if (!sec) return;
    if (!sec.dataset.init) {
      sec.dataset.init = '1';
      sec.innerHTML = `<main>
        <div class="card">
          <div class="card-title" style="font-family:'Fredoka One',cursive;letter-spacing:2px;font-size:1.25rem">✦ ELEMENT GACHA ✦</div>
          <div style="font-family:'Press Start 2P',monospace;font-size:7px;color:var(--muted);letter-spacing:3px;text-align:center;margin-bottom:20px">SUMMON YOUR ELEMENT DESTINY</div>
          <div id="geStage" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:240px;margin-bottom:16px">
            <div id="geIdle" style="display:flex;flex-direction:column;align-items:center;gap:12px">
              <div class="ge-idle-orb">🎴</div>
              <div style="font-family:'Press Start 2P',monospace;font-size:7px;color:#3a3a6a;animation:geBlink 1.2s step-end infinite">PRESS PULL</div>
            </div>
            <div id="geResult" style="display:none;flex-direction:column;align-items:center;gap:16px"></div>
          </div>
          <div id="geEquipZone" style="display:none;margin-bottom:14px;padding:12px;background:rgba(168,85,247,.06);border:1px solid rgba(168,85,247,.2);border-radius:12px;text-align:center"></div>
          <div class="ge-coin-bal" id="geCoinBal">🪙 — เหรียญ</div>
          <div style="display:flex;gap:8px;margin-bottom:4px">
            <button class="ge-pull-btn" id="gePullBtn" onclick="window.gachaPull(1)" style="flex:1;font-size:16px">⚡ PULL x1 (5🪙)</button>
            <button class="ge-pull-btn ge-pull-btn-10" id="gePull10Btn" onclick="window.gachaPull(10)" style="flex:1;font-size:16px">✦ PULL x10 (50🪙)</button>
          </div>
          <div style="margin-top:14px;padding:10px 12px;background:rgba(0,0,0,.15);border-radius:10px;font-size:.7rem;color:var(--muted);line-height:2.2;text-align:center">
            <span style="color:#c8932a">🌍 70%</span> ดิน &nbsp;·&nbsp;
            <span style="color:#38bdf8">💧 12.5%</span> น้ำ &nbsp;·&nbsp;
            <span style="color:#34d399">🌀 12.5%</span> ลม &nbsp;·&nbsp;
            <span style="color:#f97316">🔥 2.45%</span> ไฟ &nbsp;·&nbsp;
            <span style="color:#fbbf24">⚡ 2.45%</span> สายฟ้า &nbsp;·&nbsp;
            <span style="color:#c4b5fd">☯️ 0.1%</span> YIN YANG
          </div>
        </div>
        <div class="card" id="geInventoryCard" style="display:none;border-color:rgba(168,85,247,.3)">
          <div class="card-title" style="color:#c084fc">📦 Element คลัง</div>
          <div id="geInventoryList"></div>
        </div>
      </main>`;
    }
    _geUpdateCoinBal();
    _geRenderInventory();
  }

  // ── LB frame injection (called from lbRenderBoard monkey-patch) ──────────────
  function _geInjectLBFrames(data) {
    if (!data || !data.length) return;
    const items = document.querySelectorAll('#lbBoardList .lb-br');
    items.forEach((row, i) => {
      const p = data[i];
      if (!p) return;
      const av = row.querySelector('.lb-rav');
      if (!av || av.dataset.geInject) return;
      av.dataset.geInject = '1';
      const d = _geGetData(p.id);
      if (!d.equippedElement) return;
      const svgF = renderElementFrame(d.equippedElement, 40);
      if (svgF) av.appendChild(svgF);
    });
  }

  function _geInjectPodiumFrames() {
    if (typeof lbAllPlayers === 'undefined' || !lbAllPlayers.length) return;
    const sorted   = [...lbAllPlayers].sort((a, b) => b.pts - a.pts);
    const top3     = sorted.slice(0, 3);
    const podOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
    document.querySelectorAll('#lbPodium .lb-pod-av').forEach((av, i) => {
      if (av.dataset.geInject) return;
      av.dataset.geInject = '1';
      const p = podOrder[i]; if (!p) return;
      const d = _geGetData(p.id); if (!d.equippedElement) return;
      const svgF = renderElementFrame(d.equippedElement, 64);
      if (svgF) av.appendChild(svgF);
    });
  }

  // ── Profile frame injection ───────────────────────────────────────────────────
  function _geInjectProfileFrame() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const av = document.querySelector('#profileCard .profile-avatar');
    if (!av || av.dataset.geInject) return;
    av.dataset.geInject = '1';
    const d = _geGetData(currentUser.id);
    if (!d.equippedElement) return;
    const svgF = renderElementFrame(d.equippedElement, 130);
    if (svgF) av.appendChild(svgF);
    if (d.equippedElement === 'yinyang' && d.hideEmoji) {
      av.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = ''; });
    }
  }

  // ── Monkey-patches (run immediately — all scripts already loaded) ─────────────

  // showSection: handle 'gacha' tab + activate nav button
  (function () {
    const orig = typeof showSection === 'function' ? showSection : null;
    if (!orig) return;
    showSection = function (name) {
      orig(name);
      if (name === 'gacha') {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const nb = document.getElementById('navGacha');
        if (nb) nb.classList.add('active');
        gachaRenderTab();
      }
    };
  }());

  // lbRenderBoard: inject element frames into board rows
  (function () {
    const orig = typeof lbRenderBoard === 'function' ? lbRenderBoard : null;
    if (!orig) return;
    lbRenderBoard = function (data, animate) {
      orig(data, animate);
      requestAnimationFrame(() => _geInjectLBFrames(data));
    };
  }());

  // renderLeaderboard: inject frames into podium after animation settles
  (function () {
    const orig = typeof renderLeaderboard === 'function' ? renderLeaderboard : null;
    if (!orig) return;
    renderLeaderboard = async function () {
      await orig();
      setTimeout(_geInjectPodiumFrames, 400);
    };
  }());

  // renderProfile: inject frame after profile card HTML is set
  (function () {
    const orig = typeof renderProfile === 'function' ? renderProfile : null;
    if (!orig) return;
    renderProfile = async function () {
      await orig();
      requestAnimationFrame(_geInjectProfileFrame);
    };
  }());

  // ── Public API ────────────────────────────────────────────────────────────────
  window.gachaPull       = (n) => _pull(n);
  window.geEquip         = _geEquip;
  window.geEquipFromPull = _geEquipFromPull;
  window.geToggleEmoji   = _geToggleEmoji;
  window.gachaRenderTab  = gachaRenderTab;

}());
