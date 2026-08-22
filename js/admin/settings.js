// Admin V2 — Settings + Danger Zone (js/admin/settings.js)
// Spec §20 is explicit: no SQL, no raw database internals shown to admins —
// only useful health signals. Also explicit: never claim something works
// when it doesn't, so this reports Realtime honestly (js/notifications.js's
// subscription early-returns every time in production because
// window.supabaseClient is never assigned — the app runs on polling, not
// Realtime — see the plan) rather than showing a false green checkmark.
window.AdminV2 = window.AdminV2 || {};

(function () {

  async function renderHealth(el) {
    AdminV2.state(el, 'loading', {});
    const t0 = performance.now();
    try {
      await supaFetch('players?select=id&limit=1');
      const ms = Math.round(performance.now() - t0);
      el.innerHTML = `
        <div class="av2-hist-row">🗄️ ฐานข้อมูล (Supabase) <span style="color:var(--neon)">✓ เชื่อมต่อได้</span> <span class="av2-muted">(${ms}ms)</span></div>
        <div class="av2-hist-row">📡 Realtime <span class="av2-muted">ไม่ได้ใช้งาน — แอปใช้ polling แทน (ดู js/notifications.js)</span></div>
      `;
    } catch (e) {
      el.innerHTML = `<div class="av2-hist-row">🗄️ ฐานข้อมูล (Supabase) <span style="color:var(--red)">✗ เชื่อมต่อไม่ได้</span> — ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderDangerZone(el) {
    el.innerHTML = `
      <div class="card" style="border-color:rgba(255,71,87,0.3)">
        <div class="card-title" style="color:var(--red)">⚠️ Danger Zone</div>

        <div style="padding:10px 0;border-bottom:1px solid var(--glass-border)">
          <div style="font-weight:600">🔄 รีเซ็ตซีซัน</div>
          <div class="av2-muted" style="font-size:0.8rem;margin:4px 0 8px">ลดคะแนนผู้เล่นตามระดับ (King→1000, Master→800, ...) ทำงานครั้งเดียวต่อซีซัน (idempotent) — ปกติทำงานอัตโนมัติทุกต้นเดือนอยู่แล้ว</div>
          <button class="btn btn-danger btn-sm" id="av2DangerSeasonReset" style="width:auto">รีเซ็ตซีซันตอนนี้</button>
        </div>

        <div style="padding:10px 0">
          <div style="font-weight:600">🗑️ ลบทัวร์นาเมนต์</div>
          <div class="av2-muted" style="font-size:0.8rem;margin:4px 0 8px">ลบถาวร รวมถึงผลการแข่งขันทั้งหมดของทัวร์นาเมนต์นั้น — กู้คืนไม่ได้</div>
          <select class="inp" id="av2DangerTournamentSelect" style="margin-bottom:8px"></select>
          <button class="btn btn-danger btn-sm" id="av2DangerDeleteTournament" style="width:auto">ลบทัวร์นาเมนต์</button>
        </div>
      </div>
    `;

    AdminV2.api.listAllTournaments().then(rows => {
      const sel = document.getElementById('av2DangerTournamentSelect');
      sel.innerHTML = rows.length
        ? rows.map(t => `<option value="${t.id}">${escapeHtml(t.event_label || t.name)} (${escapeHtml(t.status)})</option>`).join('')
        : '<option value="">— ไม่มีทัวร์นาเมนต์ —</option>';
    });

    document.getElementById('av2DangerSeasonReset').onclick = () => {
      AdminV2.confirm({
        level: 'typed', title: 'ยืนยันรีเซ็ตซีซัน', typedPhrase: 'RESET SEASON',
        body: 'การกระทำนี้จะลดคะแนนผู้เล่นตามระดับทันที',
        consequences: ['ทำงานครั้งเดียวต่อซีซัน — ถ้าซีซันนี้รีเซ็ตไปแล้วจะไม่มีผลซ้ำ', 'ไม่สามารถย้อนกลับคะแนนที่ถูกลดได้'],
        confirmLabel: 'รีเซ็ตซีซัน',
        onConfirm: async () => {
          try { await dbApplySeasonReset(); toast('รีเซ็ตซีซันสำเร็จ ✅', 'success'); }
          catch (e) { toast('ไม่สำเร็จ: ' + e.message, 'error'); }
        },
      });
    };

    document.getElementById('av2DangerDeleteTournament').onclick = () => {
      const sel = document.getElementById('av2DangerTournamentSelect');
      const id = Number(sel.value);
      if (!id) { toast('เลือกทัวร์นาเมนต์ก่อน', 'error'); return; }
      const label = sel.options[sel.selectedIndex].textContent;
      AdminV2.confirm({
        level: 'typed', title: 'ยืนยันลบทัวร์นาเมนต์', typedPhrase: 'DELETE',
        body: label,
        consequences: ['ลบถาวร รวมถึงผลการแข่งขัน สาย Bracket และประวัติทั้งหมด', 'ไม่สามารถกู้คืนได้'],
        confirmLabel: 'ลบถาวร',
        onConfirm: async () => {
          try { await AdminV2.api.deleteTournament(id); toast('ลบทัวร์นาเมนต์สำเร็จ ✅', 'success'); renderDangerZone(el); }
          catch (e) { toast('ไม่สำเร็จ: ' + e.message, 'error'); }
        },
      });
    };
  }

  function render(container) {
    container.innerHTML = `
      <div class="av2-panel">
        <div class="card"><div class="card-title">🩺 สถานะระบบ</div><div id="av2SettingsHealth"></div></div>
        <div id="av2SettingsDanger"></div>
      </div>
    `;
    renderHealth(document.getElementById('av2SettingsHealth'));
    renderDangerZone(document.getElementById('av2SettingsDanger'));
  }

  AdminV2.settings = { render };

})();
