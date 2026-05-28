/* ===== GRAPHIFY CHARTS — Chart.js wrapper (lazy loaded) ===== */
(function() {
  'use strict';

  const CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
  let _loaded = false, _pending = [];
  const _instances = {};

  function loadChart(cb) {
    if (_loaded) { cb(); return; }
    if (typeof Chart !== 'undefined') { _loaded = true; cb(); return; }
    _pending.push(cb);
    if (_pending.length > 1) return;
    const s = document.createElement('script');
    s.src = CDN;
    s.onload = () => {
      _loaded = true;
      _pending.forEach(fn => fn());
      _pending = [];
    };
    s.onerror = () => { _pending = []; };
    document.head.appendChild(s);
  }

  function themeColors() {
    const dark = document.documentElement.dataset.theme !== 'light';
    return {
      text:  dark ? '#f0f2f8' : '#111827',
      muted: dark ? '#7a8aaa' : '#5a6a88',
      grid:  dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
      neon:   '#00f5a0',
      neon2:  '#00d9f5',
      purple: '#b044f0',
      gold:   '#ffd700',
    };
  }

  function baseFont() {
    return { family: "'Rajdhani', 'Sarabun', sans-serif", size: 11 };
  }

  function destroy(id) {
    if (_instances[id]) { try { _instances[id].destroy(); } catch(e) {} delete _instances[id]; }
  }
  window.gfDestroyCharts = function() {
    Object.keys(_instances).forEach(destroy);
  };

  /* ── Win Rate Doughnut ── */
  window.gfInitWinRateChart = function(canvasId) {
    loadChart(() => {
      destroy(canvasId);
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const players = (window.db && db.players) ? [...db.players] : [];
      const top = players.filter(p => (p.wins||0) + (p.losses||0) >= 1)
                         .sort((a,b) => (b.wins||0) - (a.wins||0)).slice(0, 5);
      if (!top.length) return;
      const c = themeColors();
      const COLORS = [c.neon, c.neon2, c.purple, c.gold, '#ff6b35'];
      _instances[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: top.map(p => p.name),
          datasets: [{
            data: top.map(p => p.wins || 0),
            backgroundColor: COLORS.map(x => x + 'cc'),
            borderColor: COLORS,
            borderWidth: 1.5,
            hoverOffset: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          animation: { duration: 900, easing: 'easeOutCubic' },
          plugins: {
            legend: {
              position: 'right',
              labels: { color: c.text, font: baseFont(), padding: 10, boxWidth: 10, boxHeight: 10 },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.label}: ${ctx.raw} wins`,
              },
            },
          },
        },
      });
    });
  };

  /* ── Rankings Horizontal Bar ── */
  window.gfInitRankingChart = function(canvasId) {
    loadChart(() => {
      destroy(canvasId);
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const players = (window.db && db.players) ? [...db.players] : [];
      const top = players.sort((a,b) => (b.pts||0) - (a.pts||0)).slice(0, 8);
      if (!top.length) return;
      const c = themeColors();
      const max = top[0].pts || 1;
      const GRAD_COLORS = top.map((_, i) => {
        const t = i / (top.length - 1 || 1);
        return `hsl(${160 - t * 80}, 80%, ${55 - t * 15}%)`;
      });
      _instances[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: top.map(p => p.name),
          datasets: [{
            data: top.map(p => p.pts || 0),
            backgroundColor: GRAD_COLORS.map(x => x.replace(')', ', 0.8)').replace('hsl', 'hsla')),
            borderColor: GRAD_COLORS,
            borderWidth: 1,
            borderRadius: 4,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 800, easing: 'easeOutCubic' },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw} pts` } },
          },
          scales: {
            x: {
              grid: { color: c.grid },
              ticks: { color: c.muted, font: baseFont() },
              max: max + Math.ceil(max * 0.12),
            },
            y: {
              grid: { display: false },
              ticks: { color: c.text, font: baseFont() },
            },
          },
        },
      });
    });
  };

  /* ── Match Activity Line ── */
  window.gfInitActivityChart = function(canvasId) {
    loadChart(() => {
      destroy(canvasId);
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const matches = (window.db && db.matches) ? db.matches : [];
      const days = 14;
      const now = Date.now();
      const buckets = {};
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now - i * 86400000);
        buckets[d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })] = 0;
      }
      matches.forEach(m => {
        const ts = m.date || m.played_at || m.created_at;
        if (!ts) return;
        const d = new Date(ts);
        if (now - d.getTime() > days * 86400000) return;
        const key = d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
        if (key in buckets) buckets[key]++;
      });
      const labels = Object.keys(buckets);
      const data = Object.values(buckets);
      const c = themeColors();
      _instances[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Matches',
            data,
            borderColor: c.neon,
            backgroundColor: c.neon + '18',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: c.neon,
            pointBorderColor: c.neon + 'aa',
            fill: true,
            tension: 0.4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 900, easing: 'easeOutCubic' },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: c.grid }, ticks: { color: c.muted, font: baseFont(), maxRotation: 0, maxTicksLimit: 7 } },
            y: { grid: { color: c.grid }, ticks: { color: c.muted, font: baseFont(), precision: 0 } },
          },
        },
      });
    });
  };
})();
