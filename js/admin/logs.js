// Admin V2 — Activity Log (js/admin/logs.js)
// Reads admin_actions — an append-only table (supabase_admin_security.sql,
// enforced by a BEFORE UPDATE/DELETE trigger) that already existed server-
// side with zero client references before this project. Every RPC added in
// Phases 2-7 calls log_admin_action(); this is the first UI that reads it
// back. Read-only by design — there is nothing to edit in an audit log.
window.AdminV2 = window.AdminV2 || {};

(function () {

  const ACTION_LABELS = {
    adjust_points: '📈 ปรับคะแนน', set_player_fields: '✏️ แก้ไขข้อมูลผู้เล่น',
    soft_delete_player: '🗑️ ลบผู้เล่น', restore_player: '♻️ กู้คืนผู้เล่น',
    void_match: '🗑️ ยกเลิกผลแมตช์', register_entrant: '➕ เพิ่มผู้เข้าแข่งขัน',
    unregister_entrant: '➖ นำผู้เข้าแข่งขันออก', admin_tournament_generate_draw: '🎲 สร้างสายการแข่งขัน',
    create_achievement: '🏅 สร้าง Achievement', archive_achievement: '🗄️ เก็บ Achievement เข้าคลัง',
    grant_achievement: '🎁 มอบ Achievement', revoke_achievement: '↩️ เพิกถอน Achievement',
    grant_currency: '🪙 มอบเหรียญ',
  };

  function actionLabel(a) { return ACTION_LABELS[a] || a; }

  async function render(container) {
    AdminV2.state(container, 'loading', {});
    try {
      const [rows] = await Promise.all([AdminV2.api.listAdminActions(200), loadAll()]);
      const adminName = (id) => (db.players.find(p => p.id === id) || {}).name || ('#' + id);
      if (!rows.length) { AdminV2.state(container, 'empty', { icon: '📜', message: 'ยังไม่มีบันทึกกิจกรรม' }); return; }

      const body = document.createElement('div');
      body.className = 'av2-panel';
      body.innerHTML = `<div class="card">
        <div class="card-title">📜 บันทึกกิจกรรม Admin (ล่าสุด ${rows.length} รายการ)</div>
        ${rows.map(r => `<div class="av2-hist-row">
          <strong>${escapeHtml(actionLabel(r.action))}</strong>
          <span class="av2-muted">· โดย ${escapeHtml(adminName(r.admin_id))} · ${new Date(r.created_at).toLocaleString('th-TH')}</span>
          ${r.new_data ? `<div class="av2-muted" style="font-size:0.75rem;margin-top:2px">${escapeHtml(JSON.stringify(r.new_data))}</div>` : ''}
        </div>`).join('')}
      </div>`;
      container.innerHTML = '';
      container.appendChild(body);
    } catch (e) {
      AdminV2.state(container, 'error', { message: e.message, retry: () => render(container) });
    }
  }

  AdminV2.logs = { render };

})();
