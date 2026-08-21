// Admin V2 — Overview dashboard (js/admin/overview.js)
// "What requires my attention right now?" — spec §1. Every number here is
// read from data that already exists; nothing is fabricated to fill a tile
// (spec §3 Players note extends to every panel: don't invent fields).
window.AdminV2 = window.AdminV2 || {};

(function () {

  const QUICK_ACTIONS = [
    { icon: '➕', label: 'ผู้เล่นใหม่', route: 'players' },
    { icon: '🏆', label: 'ทัวร์นาเมนต์ใหม่', route: 'tournaments' },
    { icon: '👆', label: 'เริ่ม Referee', route: 'referee' },
    { icon: '🏅', label: 'สร้าง Achievement', route: 'achievements' },
    { icon: '📈', label: 'ปรับคะแนน', route: 'players' },
    { icon: '✨', label: 'AI Import', route: 'tournaments' },
  ];

  async function computeMetrics() {
    // loadMatches() caps at the newest 50 rows (js/db.js) — fine for "today"
    // at this club's volume, but would undercount on a very high-traffic day.
    await loadAll();
    const [pending, tournaments] = await Promise.all([
      dbGetPending().catch(() => []),
      dbGetTournaments().catch(() => []),
    ]);

    const todayStr = new Date().toDateString();
    const matchesToday = db.matches.filter(m => new Date(m.date).toDateString() === todayStr).length;
    const activeCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const activePlayers = db.players.filter(p => p.lastSeen && p.lastSeen >= activeCutoff).length;
    const runningTournaments = tournaments.filter(t => t.status === 'active').length;

    return {
      totalPlayers: db.players.length,
      activePlayers,
      matchesToday,
      pendingMatches: pending.length,
      runningTournaments,
    };
  }

  function tile(icon, value, label) {
    return `<div class="av2-tile"><div class="av2-tile-icon">${icon}</div><div class="av2-tile-value">${value}</div><div class="av2-tile-label">${escapeHtml(label)}</div></div>`;
  }

  function renderMetrics(el, m) {
    el.innerHTML = `
      <div class="av2-tiles">
        ${tile('👥', m.totalPlayers, 'ผู้เล่นทั้งหมด')}
        ${tile('🟢', m.activePlayers, 'ใช้งานใน 7 วันล่าสุด')}
        ${tile('🏸', m.matchesToday, 'แมตช์วันนี้')}
        ${tile('⏳', m.pendingMatches, 'รอ Admin ยืนยัน')}
        ${tile('🏆', m.runningTournaments, 'ทัวร์นาเมนต์ที่กำลังแข่ง')}
      </div>
    `;
  }

  function renderQuickActions(el) {
    el.innerHTML = `
      <div class="card-title">การทำงานด่วน</div>
      <div class="av2-quick-actions">
        ${QUICK_ACTIONS.map(a => `<button type="button" class="av2-quick-action" data-route="${a.route}"><span>${a.icon}</span>${escapeHtml(a.label)}</button>`).join('')}
      </div>
    `;
    el.querySelectorAll('[data-route]').forEach(btn => { btn.onclick = () => AdminV2.go(btn.dataset.route); });
  }

  AdminV2.overview = {
    render(container) {
      container.innerHTML = `
        <div class="av2-panel">
          <div id="av2OverviewMetrics"></div>
          <div class="card" id="av2OverviewActions"></div>
        </div>
      `;
      const metricsEl = document.getElementById('av2OverviewMetrics');
      const actionsEl = document.getElementById('av2OverviewActions');
      AdminV2.state(metricsEl, 'loading', { message: 'กำลังโหลดภาพรวม...' });
      renderQuickActions(actionsEl);

      computeMetrics()
        .then(m => renderMetrics(metricsEl, m))
        .catch(err => AdminV2.state(metricsEl, 'error', { message: err.message || 'โหลดภาพรวมไม่สำเร็จ', retry: () => AdminV2.overview.render(container) }));
    },
  };

})();
