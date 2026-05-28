/* ===== GRAPHIFY DASHBOARD — Main render logic ===== */
(function() {
  'use strict';

  /* ── Animated counter ── */
  function countUp(el, target, duration) {
    if (!el) return;
    duration = duration || 900;
    const start = 0, step = 16;
    let cur = start, steps = duration / step;
    const inc = target / steps;
    const t = setInterval(() => {
      cur = Math.min(cur + inc, target);
      el.textContent = Math.round(cur).toLocaleString();
      if (cur >= target) clearInterval(t);
    }, step);
  }

  /* ── Hero stats ── */
  function renderHero() {
    const el = document.getElementById('gfHeroGrid');
    if (!el) return;
    const players = (window.db && db.players) ? db.players : [];
    const matches = (window.db && db.matches) ? db.matches : [];
    const total = players.length;
    const totalM = matches.length;
    const ranked = [...players].sort((a,b) => (b.pts||0) - (a.pts||0));
    const top = ranked[0];
    const avgPts = total ? Math.round(players.reduce((s,p) => s + (p.pts||0), 0) / total) : 0;

    const pills = [
      { icon: '👥', val: total,  lbl: 'Players',    c: '#00f5a0' },
      { icon: '⚔️', val: totalM, lbl: 'Matches',    c: '#00d9f5' },
      { icon: '🏆', val: top ? top.pts || 0 : 0, lbl: top ? top.name.split(' ')[0] : 'Top Player', c: '#ffd700' },
      { icon: '📊', val: avgPts, lbl: 'Avg ELO',    c: '#b044f0' },
    ];

    el.innerHTML = pills.map(p =>
      `<div class="gf-pill" style="--gf-c:${p.c}">
        <div class="gf-pill-icon">${p.icon}</div>
        <div class="gf-pill-val" data-val="${p.val}">0</div>
        <div class="gf-pill-lbl">${p.lbl}</div>
      </div>`
    ).join('');

    el.querySelectorAll('.gf-pill-val').forEach(v => {
      countUp(v, parseInt(v.dataset.val) || 0, 800);
    });
  }

  /* ── Top players ── */
  function renderTopPlayers() {
    const el = document.getElementById('gfTopPlayers');
    if (!el) return;
    const players = (window.db && db.players) ? db.players : [];
    if (!players.length) {
      el.innerHTML = '<div class="gf-empty"><div class="gf-empty-icon">👥</div>No players yet</div>';
      return;
    }
    const sorted = [...players].sort((a,b) => (b.pts||0) - (a.pts||0)).slice(0, 8);
    const maxPts = sorted[0] ? (sorted[0].pts || 1) : 1;

    el.innerHTML = sorted.map((p, i) => {
      const rankClass = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
      const rankEmoji = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
      const wr = (p.wins||0) + (p.losses||0) > 0
        ? Math.round((p.wins||0) / ((p.wins||0) + (p.losses||0)) * 100) : 0;
      const barW = Math.round(((p.pts||0) / maxPts) * 100);
      const colors = typeof getAvatarColor === 'function' ? getAvatarColor(p.id) : ['#00f5a0','#004d32'];
      const init = typeof getInitial === 'function' ? getInitial(p.name) : (p.name||'?')[0].toUpperCase();
      const rank = typeof getRankByPts === 'function' ? getRankByPts(p.pts||0) : null;
      const delay = i * 60;
      return `<div class="gf-player-row" style="animation-delay:${delay}ms">
        <div class="gf-pr-rank ${rankClass}">${rankEmoji}</div>
        <div class="gf-pr-av" style="background:${colors[1]};color:${colors[0]}">${init}</div>
        <div class="gf-pr-info">
          <div class="gf-pr-name">${p.name}</div>
          <div class="gf-pr-sub">${rank ? rank.name : ''} · W${p.wins||0}/L${p.losses||0} · ${wr}% WR</div>
        </div>
        <div class="gf-pr-bar-wrap"><div class="gf-pr-bar" data-w="${barW}"></div></div>
        <div class="gf-pr-pts">${(p.pts||0).toLocaleString()}</div>
      </div>`;
    }).join('');

    /* Animate progress bars after paint */
    requestAnimationFrame(() => {
      el.querySelectorAll('.gf-pr-bar').forEach(bar => {
        bar.style.width = bar.dataset.w + '%';
      });
    });
  }

  /* ── AI insights ── */
  function renderAIInsights() {
    const el = document.getElementById('gfAIPanel');
    if (!el) return;
    const players = (window.db && db.players) ? db.players : [];
    const matches = (window.db && db.matches) ? db.matches : [];
    const insights = [];

    /* Top performer by win rate (min 3 games) */
    const qualified = players.filter(p => (p.wins||0) + (p.losses||0) >= 3);
    if (qualified.length) {
      const best = qualified.reduce((a,b) =>
        ((b.wins||0)/((b.wins||0)+(b.losses||0))) > ((a.wins||0)/((a.wins||0)+(a.losses||0))) ? b : a
      );
      const wr = Math.round((best.wins||0)/((best.wins||0)+(best.losses||0))*100);
      insights.push({ em:'🎯', t:`Top Performer: ${best.name}`, d:`${wr}% win rate across ${(best.wins||0)+(best.losses||0)} matches` });
    }

    /* Rising star — most pts, low total games */
    const newbies = players.filter(p => (p.wins||0)+(p.losses||0) <= 10 && (p.pts||0) > 1000);
    if (newbies.length) {
      const star = newbies.sort((a,b) => (b.pts||0)-(a.pts||0))[0];
      insights.push({ em:'🌟', t:`Rising Star: ${star.name}`, d:`${star.pts} pts in just ${(star.wins||0)+(star.losses||0)} matches — impressive!` });
    }

    /* Most active player */
    if (players.length) {
      const active = [...players].sort((a,b) => ((b.wins||0)+(b.losses||0)) - ((a.wins||0)+(a.losses||0)))[0];
      if ((active.wins||0)+(active.losses||0) > 0) {
        insights.push({ em:'⚡', t:`Most Active: ${active.name}`, d:`${(active.wins||0)+(active.losses||0)} total matches played this season` });
      }
    }

    /* High ELO player */
    const king = players.find(p => (p.pts||0) >= 2000);
    if (king) {
      insights.push({ em:'👑', t:`King of Badminton: ${king.name}`, d:`Reigning at ${king.pts} ELO — challenge them for bonus points!` });
    } else {
      const leader = players.sort ? [...players].sort((a,b)=>(b.pts||0)-(a.pts||0))[0] : null;
      if (leader) {
        const gap = 2000 - (leader.pts||0);
        if (gap > 0) insights.push({ em:'🏆', t:`ELO Leader: ${leader.name}`, d:`${leader.pts} pts — ${gap} pts away from King status` });
      }
    }

    /* Recent match frequency */
    if (matches.length) {
      const week = 7 * 86400000;
      const recent = matches.filter(m => {
        const ts = m.date || m.played_at || m.created_at;
        return ts && (Date.now() - new Date(ts).getTime()) < week;
      }).length;
      if (recent > 0) insights.push({ em:'📅', t:`This Week's Activity`, d:`${recent} match${recent===1?'':'es'} played in the last 7 days` });
    }

    const header = `<div class="gf-ai-head">
      <div class="gf-ai-ico">🤖</div>
      <div class="gf-ai-lbl">AI Insights</div>
      <div class="gf-ai-badge">LIVE</div>
    </div>`;

    if (!insights.length) {
      el.innerHTML = header + `<div class="gf-empty"><div class="gf-empty-icon">🔍</div>Play more matches to generate insights!</div>`;
      return;
    }
    el.innerHTML = header + insights.slice(0, 5).map((ins, i) =>
      `<div class="gf-insight" style="animation-delay:${i*80}ms">
        <div class="gf-insight-em">${ins.em}</div>
        <div class="gf-insight-body">
          <div class="gf-insight-t">${ins.t}</div>
          <div class="gf-insight-d">${ins.d}</div>
        </div>
      </div>`
    ).join('');
  }

  /* ── Activity timeline ── */
  function renderTimeline() {
    const el = document.getElementById('gfTimeline');
    if (!el) return;
    const matches = (window.db && db.matches) ? db.matches : [];
    const header = `<div class="gf-sec-row" style="margin-bottom:13px">
      <div class="gf-sec-dot" style="background:var(--neon2);box-shadow:0 0 8px var(--neon2)"></div>
      <div class="gf-sec-title">Activity Timeline</div>
    </div>`;

    if (!matches.length) {
      el.innerHTML = header + `<div class="gf-empty"><div class="gf-empty-icon">📋</div>No matches recorded yet</div>`;
      return;
    }

    const recent = [...matches]
      .sort((a,b) => {
        const ta = new Date(a.date||a.played_at||a.created_at||0).getTime();
        const tb = new Date(b.date||b.played_at||b.created_at||0).getTime();
        return tb - ta;
      })
      .slice(0, 12);

    el.innerHTML = header + recent.map((m, i) => {
      const ts = m.date || m.played_at || m.created_at;
      const timeStr = ts ? new Date(ts).toLocaleDateString('th-TH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
      const teamA = Array.isArray(m.teamA) ? m.teamA.map(p => p.name||p).join(' & ') : (m.teamA||'Team A');
      const teamB = Array.isArray(m.teamB) ? m.teamB.map(p => p.name||p).join(' & ') : (m.teamB||'Team B');
      const sa = m.scoreA ?? m.score_a ?? '?';
      const sb = m.scoreB ?? m.score_b ?? '?';
      const isDoubles = Array.isArray(m.teamA) && m.teamA.length > 1;
      const dotClass = sa !== '?' ? (sa > sb ? 'w' : sa < sb ? 'l' : 'd') : 'd';
      const dotEmoji = dotClass === 'w' ? '✅' : dotClass === 'l' ? '❌' : '🏸';
      return `<div class="gf-tl-item" style="animation-delay:${i*45}ms">
        <div class="gf-tl-dot ${dotClass}">${dotEmoji}</div>
        <div class="gf-tl-info">
          <div class="gf-tl-match">${isDoubles?'2v2':'1v1'} · ${teamA} vs ${teamB}</div>
          <div class="gf-tl-score">${sa} – ${sb}</div>
          <div class="gf-tl-time">${timeStr}</div>
        </div>
      </div>`;
    }).join('');
  }

  /* ── Main render ── */
  window.renderDashboard = function() {
    if (typeof gfDestroyCharts === 'function') gfDestroyCharts();
    renderHero();
    renderTopPlayers();
    renderAIInsights();
    renderTimeline();
    /* Charts: slight delay so canvas is visible */
    setTimeout(() => {
      if (typeof gfInitWinRateChart  === 'function') gfInitWinRateChart('gfWinChart');
      if (typeof gfInitRankingChart  === 'function') gfInitRankingChart('gfRankChart');
      if (typeof gfInitActivityChart === 'function') gfInitActivityChart('gfActivityChart');
    }, 80);
  };

})();
