// Admin V2 — Ranking Control (js/admin/rankings.js)
// Read-only by design. Point ADJUSTMENT already has its own reason-required,
// logged flow in the Player Manager drawer (Phase 2); season reset lives in
// Settings → Danger Zone (Phase 8); every adjustment's history is in the
// Activity Log (Phase 8). This view's only job is a focused look at current
// standings — singles from the same players list every other panel uses,
// doubles from v_pair_rankings (supabase_partner_system.sql), which already
// computes (p1.pts + p2.pts) / 2 server-side exactly as documented there.
window.AdminV2 = window.AdminV2 || {};

(function () {

  async function render(container) {
    AdminV2.state(container, 'loading', {});
    try {
      await loadAll();
      let pairs = [];
      try { pairs = await supaFetch('v_pair_rankings?order=double_rank_score.desc&limit=30'); } catch (e) { /* view may be unreachable — singles still renders */ }

      const singles = [...db.players].filter(p => !p.deletedAt).sort((a, b) => b.pts - a.pts).slice(0, 30);

      const el = document.createElement('div');
      el.className = 'av2-panel';
      el.innerHTML = `
        <div class="card">
          <div class="card-title">📈 อันดับเดี่ยว (Top ${singles.length})</div>
          ${singles.map((p, i) => `<div class="av2-hist-row">#${i + 1} ${escapeHtml(p.name)} <span class="av2-muted">· ${p.pts} ELO · ${p.wins}W ${p.losses}L</span></div>`).join('')}
        </div>
        <div class="card">
          <div class="card-title">📈 อันดับคู่ (Double Rank, Top ${pairs.length})</div>
          ${pairs.length ? pairs.map((pr, i) => `<div class="av2-hist-row">#${i + 1} ${escapeHtml(pr.name_low)} / ${escapeHtml(pr.name_high)} <span class="av2-muted">· ${pr.double_rank_score} · ${pr.matches_together} แมตช์ · WR ${pr.win_rate_pct}%</span></div>`).join('') : '<div class="av2-muted">ยังไม่มีข้อมูลคู่ (ต้องมีการแข่งขันประเภทคู่ก่อน)</div>'}
        </div>
      `;
      container.innerHTML = '';
      container.appendChild(el);
    } catch (e) {
      AdminV2.state(container, 'error', { message: e.message, retry: () => render(container) });
    }
  }

  AdminV2.rankings = { render };

})();
