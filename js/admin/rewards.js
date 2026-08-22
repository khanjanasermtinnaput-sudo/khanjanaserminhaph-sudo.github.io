// Admin V2 — Rewards Center (js/admin/rewards.js)
// Single-player or bulk coin grants through rpc_admin_grant_currency
// (supabase_admin_v2_achievements.sql), replacing the raw `coins` PATCH in
// the legacy adminGiveCoins() (index.html). Only coins are exposed here —
// ELO adjustment already has its own dedicated, reason-required flow in the
// Player Manager drawer (js/admin/players.js), so it is not duplicated here.
window.AdminV2 = window.AdminV2 || {};

(function () {

  function render(container) {
    loadAll().then(() => {
      const sorted = [...db.players].sort((a, b) => b.pts - a.pts);
      container.innerHTML = `
        <div class="av2-panel">
          <div class="card">
            <div class="card-title">🎁 มอบเหรียญ</div>
            <div class="form-group"><label>เลือกผู้เล่น (เลือกได้หลายคน)</label>
              <select class="inp" id="av2RewardPlayers" multiple size="10">${sorted.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.pts} ELO, ${p.coins} เหรียญ)</option>`).join('')}</select>
            </div>
            <div class="av2-muted" style="font-size:0.75rem">กด Ctrl (หรือ Cmd บน Mac) ค้างไว้เพื่อเลือกหลายคน</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
              <input class="inp" id="av2RewardAmount" type="number" placeholder="จำนวนเหรียญ เช่น 100 หรือ -50">
              <input class="inp" id="av2RewardReason" placeholder="เหตุผล (จำเป็น)">
            </div>
            <button class="btn btn-primary btn-sm" id="av2RewardGiveBtn" style="margin-top:10px;width:auto">มอบเหรียญ</button>
          </div>
        </div>
      `;
      document.getElementById('av2RewardGiveBtn').onclick = () => {
        const ids = [...document.getElementById('av2RewardPlayers').selectedOptions].map(o => Number(o.value));
        const amount = parseInt(document.getElementById('av2RewardAmount').value, 10);
        const reason = document.getElementById('av2RewardReason').value.trim();
        if (!ids.length) { toast('เลือกผู้เล่นอย่างน้อย 1 คน', 'error'); return; }
        if (!amount) { toast('กรอกจำนวนเหรียญ', 'error'); return; }
        if (!reason) { toast('กรุณากรอกเหตุผล', 'error'); return; }
        AdminV2.confirm({
          level: 'confirm', title: 'ยืนยันการมอบเหรียญ',
          body: `${ids.length} คน: ${amount > 0 ? '+' : ''}${amount} เหรียญ\nเหตุผล: ${reason}`,
          onConfirm: async () => {
            try {
              await AdminV2.api.grantCurrency(ids, amount, reason);
              toast(`มอบเหรียญสำเร็จ (${ids.length} คน) ✅`, 'success');
              render(container);
            } catch (e) { toast('ไม่สำเร็จ: ' + e.message, 'error'); }
          },
        });
      };
    });
  }

  AdminV2.rewards = { render };

})();
