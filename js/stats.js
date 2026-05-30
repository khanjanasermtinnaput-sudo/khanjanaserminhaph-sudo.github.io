// ============================================================
// ===== STATS PAGE =====
// Personal rank summary + multi-player "score race" chart
// (pts over time, smooth lines — the "แบบ B" style)
// ============================================================

// Distinct line colors indexed by leaderboard position (mockup palette)
const SR_COLORS = ['#00f5a0','#00d9f5','#ffd700','#ff5d8f','#b044f0','#ff9f43','#36c5f0','#ff6b35','#7bed9f','#a78bff'];

// View state (persist across re-renders within a session)
let _statsRange = 30;  // 7 / 30 / 0(all)
let _statsTopN  = 8;   // 5 / 8 / 10 (capped to player count)

async function renderStats() {
  const host = document.getElementById('statsSection');
  if (!host || !currentUser) return;
  const isEn = _lang === 'en';
  host.innerHTML = `<div class="lb-page"><div class="sr-loading">⏳ ${isEn ? 'Loading stats…' : 'กำลังโหลดสถิติ…'}</div></div>`;
  try {
    // Default cache holds only 50 matches — load full history so the
    // pts-over-time reconstruction is accurate for every player.
    const [rows] = await Promise.all([
      supaFetch('matches?order=played_at.desc&limit=1000'),
      loadPlayers()
    ]);
    db.matches = rows.map(normalizeMatch);
  } catch (e) { /* fall back to whatever is already cached */ }
  host.innerHTML = _buildStatsPage();
}

function _buildStatsPage() {
  const isEn = _lang === 'en';
  const me = db.players.find(x => x.id === currentUser.id) || currentUser;
  return `
  <div class="lb-page">
    <div class="lb-hero">
      <div class="lb-hero-title"><small>Badminton Club</small>${isEn ? '📊 Stats' : '📊 สถิติ'}</div>
    </div>
    ${buildPersonalRankCard(me)}
    <div class="card lb-glass sr-card">
      <div class="card-title">${isEn ? '📈 Score Race' : '📈 กราฟคะแนนผู้เล่น'}</div>
      <div class="sr-sub">${isEn ? 'Compare each player\'s points (pts) over time' : 'เปรียบเทียบคะแนน (pts) ของผู้เล่นแต่ละคนตามช่วงเวลา'}</div>
      <div id="srChartHost">${_buildScoreRaceInner(_statsRange, _statsTopN)}</div>
    </div>
  </div>`;
}

// ── Personal rank summary card (อันดับส่วนตัว) ──
function buildPersonalRankCard(p) {
  const isEn = _lang === 'en';
  const sorted = [...db.players].sort((a, b) => b.pts - a.pts);
  const total = sorted.length;
  const pos = sorted.findIndex(x => x.id === p.id) + 1;
  const rank = getRank(p.pts, p.id);
  const av = getAvatar(p.id, p.name);
  const wr = (p.wins + p.losses) > 0 ? Math.round(p.wins / (p.wins + p.losses) * 100) : 0;

  // Daily rank movement (set by leaderboard render; may be absent on first visit)
  const delta = (window.lbRankDelta && window.lbRankDelta[p.id]) || 0;
  const deltaTxt = delta > 0
    ? `<span class="sr-up">▲ ${delta}</span>`
    : delta < 0
      ? `<span class="sr-down">▼ ${Math.abs(delta)}</span>`
      : `<span class="sr-flat">—</span>`;

  // Gap to the player directly above
  const above = pos > 1 ? sorted[pos - 2] : null;
  const gap = above ? Math.max(0, above.pts - p.pts) : 0;
  const gapLine = above
    ? `<div class="sr-gap">${isEn
        ? `<b>${gap}</b> pts to overtake <b>${above.name}</b> (#${pos - 1})`
        : `อีก <b>${gap}</b> pts จะแซง <b>${above.name}</b> ขึ้นอันดับ #${pos - 1}`}</div>`
    : `<div class="sr-gap sr-gap-top">${isEn ? '👑 You are #1 — defend your throne!' : '👑 คุณคืออันดับ 1 — ป้องกันบัลลังก์ไว้!'}</div>`;

  return `
  <div class="card lb-glass sr-me">
    <div class="sr-me-head">
      <div class="sr-me-av" style="background:${av.bg};color:${av.fg};${av.fs ? 'font-size:' + av.fs : ''}">${av.content}</div>
      <div class="sr-me-info">
        <div class="sr-me-label">${isEn ? 'YOUR RANK' : 'อันดับของคุณ'}</div>
        <div class="sr-me-name">${p.name}</div>
        <div><span class="rank-badge ${rank.class}">${getRankLabel(p.pts, p.id)}</span></div>
      </div>
      <div class="sr-me-pos">
        <div class="sr-me-pos-num">#${pos}</div>
        <div class="sr-me-pos-total">/ ${total}</div>
        <div class="sr-me-delta">${deltaTxt}</div>
      </div>
    </div>
    <div class="sr-me-stats">
      <div class="sr-me-stat"><div class="sr-me-stat-n">${p.pts}</div><div class="sr-me-stat-l">pts</div></div>
      <div class="sr-me-stat"><div class="sr-me-stat-n">${p.wins}</div><div class="sr-me-stat-l">${isEn ? 'Win' : 'ชนะ'}</div></div>
      <div class="sr-me-stat"><div class="sr-me-stat-n">${p.losses}</div><div class="sr-me-stat-l">${isEn ? 'Loss' : 'แพ้'}</div></div>
      <div class="sr-me-stat"><div class="sr-me-stat-n">${wr}%</div><div class="sr-me-stat-l">Win%</div></div>
    </div>
    ${gapLine}
    <div class="sr-me-chart-label">${isEn ? '📉 Your points over time' : '📉 คะแนนของคุณตามช่วงเวลา'}</div>
    ${typeof buildRankingChart === 'function' ? buildRankingChart(p.id) : ''}
  </div>`;
}

// ── data: matches for a player, ascending by time ──
function _srPlayerMatches(pid) {
  return db.matches
    .filter(m => [...m.teamA, ...m.teamB].some(x => x.id === pid))
    .sort((a, b) => a.date - b.date);
}

// Reconstruct pts AFTER each match by walking backwards from current pts.
// Returns { startVal: pts before first match, pts: [{t, v} forward order] }
function _srTimeline(p) {
  const ms = _srPlayerMatches(p.id);
  let walk = p.pts;
  const pts = [];
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    pts.unshift({ t: m.date, v: walk });
    const inA = m.teamA.some(x => x.id === p.id);
    const win = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
    walk = win ? Math.max(0, walk - (m.pts?.gain || 0)) : Math.min(walk + (m.pts?.loss || 0), 9999);
  }
  return { startVal: walk, pts };
}

// pts as of time t: value after the last match at or before t (else starting value)
function _srPtsAt(tl, t) {
  let v = tl.startVal;
  for (const pt of tl.pts) { if (pt.t <= t) v = pt.v; else break; }
  return v;
}

// Monotone cubic Hermite interpolation (Fritsch–Carlson) for a list of {x,y}.
// Unlike Catmull-Rom this never overshoots between data points, so flat stretches
// stay flat and sharp single-match jumps don't create loops/tangles.
function _srMonotone(pts) {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` : '';
  if (n === 2) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
  const dx = [], dy = [], slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    slope[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
  }
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = (slope[i - 1] * slope[i] <= 0) ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  // Limit tangents so each segment stays monotone (no overshoot)
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i], s = a * a + b * b;
    if (s > 9) { const tau = 3 / Math.sqrt(s); m[i] = tau * a * slope[i]; m[i + 1] = tau * b * slope[i]; }
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3, c1y = pts[i].y + m[i] * dx[i] / 3;
    const c2x = pts[i + 1].x - dx[i] / 3, c2y = pts[i + 1].y - m[i + 1] * dx[i] / 3;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return d;
}

// ── controls: time-range + Top-N pills ──
function _srControls(rangeDays, topN) {
  const isEn = _lang === 'en';
  const rOpts = isEn ? [[7, '7d'], [30, '30d'], [0, 'All']] : [[7, '7 วัน'], [30, '30 วัน'], [0, 'ทั้งหมด']];
  const total = db.players.length;
  const allN = [5, 8, 10];
  let nOpts = allN.filter(v => v < total);
  const cap = allN.find(v => v >= total);
  nOpts.push(cap || allN[allN.length - 1]);
  nOpts = [...new Set(nOpts)];
  const rPills = rOpts.map(([v, l]) =>
    `<button class="rk-range-btn${(rangeDays || 0) === v ? ' on' : ''}" onclick="setStatsRange(${v})">${l}</button>`).join('');
  const nPills = nOpts.map(v =>
    `<button class="rk-range-btn${topN === v ? ' on' : ''}" onclick="setStatsTopN(${v})">Top ${v}</button>`).join('');
  return `<div class="sr-controls"><div class="rk-range">${rPills}</div><div class="rk-range sr-topn">${nPills}</div></div>`;
}

function _srMsg(m) {
  return `<div style="text-align:center;color:var(--muted);font-size:0.8rem;padding:26px 0">${m}</div>`;
}

function setStatsRange(r) {
  _statsRange = Number(r) || 0;
  const h = document.getElementById('srChartHost');
  if (h) h.innerHTML = _buildScoreRaceInner(_statsRange, _statsTopN);
}
function setStatsTopN(n) {
  _statsTopN = Number(n) || 8;
  const h = document.getElementById('srChartHost');
  if (h) h.innerHTML = _buildScoreRaceInner(_statsRange, _statsTopN);
}

// ── the multi-player score race chart (แบบ B) ──
function _buildScoreRaceInner(rangeDays, topN) {
  const isEn = _lang === 'en';
  const controls = _srControls(rangeDays, topN);
  const ranked = [...db.players].sort((a, b) => b.pts - a.pts);
  const players = ranked.slice(0, topN);
  if (players.length < 2) return controls + _srMsg(isEn ? 'Need at least 2 players' : 'ต้องมีผู้เล่นอย่างน้อย 2 คน');

  const now = Date.now();
  let t0;
  if (rangeDays > 0) {
    t0 = now - rangeDays * 86400000;
  } else {
    // all-time: just before the earliest match across the shown players
    let earliest = now;
    players.forEach(p => { const ms = _srPlayerMatches(p.id); if (ms.length) earliest = Math.min(earliest, ms[0].date); });
    t0 = earliest < now ? earliest - 1000 : now - 7 * 86400000;
  }
  if (now - t0 < 60000) t0 = now - 86400000; // guard against zero-width window

  // Reconstruct each player's pts timeline once
  const timelines = players.map(p => _srTimeline(p));

  // One ordinal slot per calendar day (last-match time of that day).
  // Grouping by day collapses a 20-match session into 1 clean data point
  // instead of 20 near-vertical wiggles that tangle into knots.
  const dayLastTime = new Map();
  timelines.forEach(tl => tl.pts.forEach(pt => {
    if (pt.t > t0 && pt.t < now) {
      const dk = Math.floor(pt.t / 86400000);
      if (!dayLastTime.has(dk) || pt.t > dayLastTime.get(dk)) dayLastTime.set(dk, pt.t);
    }
  }));
  const slotTimes = [t0, ...[...dayLastTime.values()].sort((a, b) => a - b), now];
  const S = slotTimes.length;

  const seriesList = players.map((p, i) => ({
    player: p,
    color: SR_COLORS[i % SR_COLORS.length],
    isMe: p.id === currentUser.id,
    vals: slotTimes.map(t => _srPtsAt(timelines[i], t))
  }));

  // y-range across every series, with headroom
  let yMin = Infinity, yMax = -Infinity;
  seriesList.forEach(s => s.vals.forEach(v => { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }));
  if (!isFinite(yMin)) { yMin = 0; yMax = 100; }
  const padV = Math.max((yMax - yMin) * 0.14, 12);
  yMax += padV; yMin = Math.max(0, yMin - padV);
  if (yMax - yMin < 1) yMax = yMin + 1;

  const W = 540, H = 320, padL = 46, padR = 92, padT = 18, padB = 30;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const toXi = j => padL + (S < 2 ? 0 : (j / (S - 1)) * chartW);
  const toY = v => padT + (1 - (v - yMin) / (yMax - yMin)) * chartH;

  // grid + y-axis
  const yTicks = [];
  for (let i = 0; i < 5; i++) yTicks.push(Math.round(yMin + (i / 4) * (yMax - yMin)));
  const gridSVG = [...new Set(yTicks)].map(v =>
    `<line x1="${padL}" y1="${toY(v).toFixed(1)}" x2="${padL + chartW}" y2="${toY(v).toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="0.6" stroke-dasharray="2,4"/>`).join('');
  const yAxisSVG = [...new Set(yTicks)].map(v =>
    `<text x="${padL - 7}" y="${(toY(v) + 3.5).toFixed(1)}" fill="rgba(255,255,255,0.35)" font-size="9" text-anchor="end" font-family="Rajdhani,sans-serif" font-weight="600">${v}</text>`).join('');

  // x-axis labels at evenly-spaced slots (date of that slot)
  const fmtDate = t => new Date(t).toLocaleDateString(isEn ? 'en-GB' : 'th-TH', { day: 'numeric', month: 'short' });
  const xTickCount = Math.min(5, S);
  let xAxisSVG = '';
  for (let k = 0; k < xTickCount; k++) {
    const j = xTickCount < 2 ? S - 1 : Math.round(k * (S - 1) / (xTickCount - 1));
    const label = j === S - 1 ? (isEn ? 'now' : 'ล่าสุด') : fmtDate(slotTimes[j]);
    const anchor = k === 0 ? 'start' : k === xTickCount - 1 ? 'end' : 'middle';
    xAxisSVG += `<text x="${toXi(j).toFixed(1)}" y="${padT + chartH + 16}" fill="rgba(255,255,255,0.32)" font-size="8" text-anchor="${anchor}" font-family="Rajdhani,sans-serif">${label}</text>`;
  }

  // lines + current-value dots + end labels
  let linesSVG = '', dotsSVG = '';
  const endLabels = [];
  seriesList.forEach(s => {
    const xy = s.vals.map((v, j) => ({ x: toXi(j), y: toY(v) }));
    const d = _srMonotone(xy);
    const w = s.isMe ? 3.4 : 2.4;
    linesSVG += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${s.isMe ? 1 : 0.9}" clip-path="url(#srClip)"${s.isMe ? ' filter="url(#srGlow)"' : ''}/>`;
    const last = xy[xy.length - 1];
    if (s.isMe) dotsSVG += `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="9" fill="${s.color}" opacity="0.16"/>`;
    dotsSVG += `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="${s.isMe ? 5 : 3.4}" fill="${s.color}" stroke="rgba(0,0,0,0.45)" stroke-width="1"/>`;
    endLabels.push({ y: last.y, color: s.color, name: s.player.name, isMe: s.isMe });
  });

  // de-collide end labels vertically so names stay readable
  endLabels.sort((a, b) => a.y - b.y);
  const minGap = 13;
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < minGap) endLabels[i].y = endLabels[i - 1].y + minGap;
  }
  const over = endLabels.length ? endLabels[endLabels.length - 1].y - (padT + chartH) : 0;
  if (over > 0) endLabels.forEach(l => l.y -= over);
  if (endLabels.length && endLabels[0].y < padT) {
    const up = padT - endLabels[0].y;
    endLabels.forEach(l => l.y += up);
  }
  const labelX = padL + chartW + 8;
  const endLabelSVG = endLabels.map(l => {
    const short = l.name.length > 7 ? l.name.slice(0, 7) + '…' : l.name;
    return `<text x="${labelX}" y="${(l.y + 3).toFixed(1)}" fill="${l.color}" font-size="9.5" font-family="Rajdhani,sans-serif" font-weight="${l.isMe ? '800' : '700'}">${short}${l.isMe ? ' ●' : ''}</text>`;
  }).join('');

  // legend with current pts
  const legend = seriesList.map(s =>
    `<div class="sr-leg${s.isMe ? ' sr-leg-me' : ''}"><span class="sr-leg-dot" style="background:${s.color}"></span><span class="sr-leg-name">${s.player.name}${s.isMe ? (isEn ? ' (you)' : ' (คุณ)') : ''}</span><span class="sr-leg-pts">${s.player.pts}</span></div>`).join('');

  return `
  ${controls}
  <div class="sr-chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">
      <defs>
        <clipPath id="srClip"><rect x="${padL - 1}" y="${padT - 8}" width="${chartW + 2}" height="${chartH + 16}"/></clipPath>
        <filter id="srGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${gridSVG}
      ${yAxisSVG}
      ${linesSVG}
      ${dotsSVG}
      ${endLabelSVG}
      ${xAxisSVG}
    </svg>
  </div>
  <div class="sr-legend">${legend}</div>`;
}
