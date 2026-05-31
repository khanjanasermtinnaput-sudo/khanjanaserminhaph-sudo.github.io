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
        <div>${getRankBadgeSVG(p.pts,p.id,36)}</div>
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

// ── horizontal bar-race chart ──
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
    let earliest = now;
    players.forEach(p => { const ms = _srPlayerMatches(p.id); if (ms.length) earliest = Math.min(earliest, ms[0].date); });
    t0 = earliest < now ? earliest - 1000 : now - 7 * 86400000;
  }
  if (now - t0 < 60000) t0 = now - 86400000;

  const timelines = players.map(p => _srTimeline(p));

  // Build row data: current score + score at period start (for delta)
  const rows = players.map((p, i) => {
    const scoreBefore = _srPtsAt(timelines[i], t0);
    const delta = p.pts - scoreBefore;
    return { player: p, color: SR_COLORS[i % SR_COLORS.length], isMe: p.id === currentUser.id, score: p.pts, delta };
  }).sort((a, b) => b.score - a.score);

  const maxScore = Math.max(...rows.map(r => r.score), 1);

  // SVG layout
  const RH = 34, GAP = 5;
  const PL = 8, PR = 8, PT = 14, PB = 10;
  const RANK_W = 26, NAME_W = 108, BAR_W = 220, SCORE_W = 48, DELTA_W = 44;
  const W = PL + RANK_W + NAME_W + BAR_W + SCORE_W + DELTA_W + PR;
  const H = PT + rows.length * (RH + GAP) - GAP + PB;

  const barX = PL + RANK_W + NAME_W;

  let svgRows = '';
  rows.forEach((r, i) => {
    const y = PT + i * (RH + GAP);
    const cy = y + RH / 2 + 1;
    const bw = (r.score / maxScore) * BAR_W;
    const dStr = r.delta > 0 ? `▲${r.delta}` : r.delta < 0 ? `▼${Math.abs(r.delta)}` : '—';
    const dCol = r.delta > 0 ? '#00f5a0' : r.delta < 0 ? '#ff5d8f' : 'rgba(255,255,255,0.3)';
    const short = r.player.name.length > 11 ? r.player.name.slice(0, 10) + '…' : r.player.name;

    // row bg
    svgRows += `<rect x="${PL}" y="${y}" width="${W - PL - PR}" height="${RH}" rx="7" fill="${r.isMe ? 'rgba(0,245,160,0.08)' : 'rgba(255,255,255,0.03)'}"/>`;
    // rank badge
    svgRows += `<text x="${PL + RANK_W - 2}" y="${cy + 4}" fill="rgba(255,255,255,0.45)" font-size="12" font-weight="700" text-anchor="end" font-family="Rajdhani,sans-serif">#${i + 1}</text>`;
    // name
    svgRows += `<text x="${PL + RANK_W + 6}" y="${cy + 4}" fill="${r.isMe ? '#00f5a0' : 'rgba(255,255,255,0.9)'}" font-size="${r.isMe ? 12 : 11.5}" font-weight="${r.isMe ? '800' : '600'}" font-family="Rajdhani,sans-serif">${short}</text>`;
    // bar track
    svgRows += `<rect x="${barX}" y="${y + 9}" width="${BAR_W}" height="${RH - 18}" rx="4" fill="rgba(255,255,255,0.06)"/>`;
    // bar fill with gradient-like opacity
    if (bw > 0) {
      svgRows += `<rect x="${barX}" y="${y + 9}" width="${bw.toFixed(1)}" height="${RH - 18}" rx="4" fill="${r.color}" opacity="${r.isMe ? '1' : '0.78'}"/>`;
      // score label inside bar if wide enough, else outside
      if (bw > 36) {
        svgRows += `<text x="${barX + bw - 5}" y="${cy + 4}" fill="rgba(0,0,0,0.7)" font-size="11" font-weight="800" text-anchor="end" font-family="Rajdhani,sans-serif">${r.score}</text>`;
      } else {
        svgRows += `<text x="${barX + bw + 6}" y="${cy + 4}" fill="${r.color}" font-size="11" font-weight="800" font-family="Rajdhani,sans-serif">${r.score}</text>`;
      }
    }
    // delta
    svgRows += `<text x="${barX + BAR_W + SCORE_W}" y="${cy + 4}" fill="${dCol}" font-size="10" font-weight="700" text-anchor="end" font-family="Rajdhani,sans-serif">${dStr}</text>`;
  });

  // column header
  const periodLabel = rangeDays > 0
    ? (isEn ? `Last ${rangeDays} days` : `${rangeDays} วันที่ผ่านมา`)
    : (isEn ? 'All time' : 'ทั้งหมด');
  const hdrY = PT - 3;
  const header = `<text x="${barX + BAR_W + SCORE_W}" y="${hdrY}" fill="rgba(255,255,255,0.28)" font-size="8.5" text-anchor="end" font-family="Rajdhani,sans-serif">${periodLabel}</text>`;

  return `${controls}
  <div class="sr-chart-wrap" style="margin-top:6px">
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">
      <defs>
        <filter id="srGlow2" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${header}
      ${svgRows}
    </svg>
  </div>`;
}
