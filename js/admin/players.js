// Admin V2 — Player Manager (js/admin/players.js)
// List/search/filter + Player Detail drawer. Every privileged write here goes
// through the RPCs in js/admin/api.js (rpc_admin_*), never a raw PATCH —
// each one is logged server-side via log_admin_action (supabase_admin_v2_players.sql).
window.AdminV2 = window.AdminV2 || {};

(function () {

  let allPlayers = [];
  let filters = { q: '', classLabel: '', adminOnly: false, showDeleted: false };

  function rankOf(p) {
    const active = allPlayers.filter(x => !x.deletedAt).sort((a, b) => b.pts - a.pts);
    const idx = active.findIndex(x => x.id === p.id);
    return idx === -1 ? '—' : (idx + 1);
  }

  function applyFilters() {
    const q = filters.q.trim().toLowerCase();
    return allPlayers.filter(p => {
      const isDeleted = !!p.deletedAt;
      if (filters.showDeleted ? !isDeleted : isDeleted) return false;
      if (filters.classLabel && p.classLabel !== filters.classLabel) return false;
      if (filters.adminOnly && !p.isAdmin) return false;
      if (q && !((p.name || '').toLowerCase().includes(q) || (p.nickname || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function classOptions() {
    const set = new Set(allPlayers.map(p => p.classLabel).filter(Boolean));
    return [...set].sort();
  }

  function renderToolbar(el) {
    const classes = classOptions();
    el.innerHTML = `
      <div class="av2-players-toolbar">
        <input class="inp" id="av2PlayerSearch" placeholder="ค้นหาชื่อ / ชื่อเล่น..." value="${escapeHtml(filters.q)}">
        <select class="inp" id="av2PlayerClassFilter">
          <option value="">ทุกห้อง</option>
          ${classes.map(c => `<option value="${escapeHtml(c)}" ${filters.classLabel === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        <label class="av2-checkbox-label"><input type="checkbox" id="av2PlayerAdminOnly" ${filters.adminOnly ? 'checked' : ''}> Admin เท่านั้น</label>
        <label class="av2-checkbox-label"><input type="checkbox" id="av2PlayerShowDeleted" ${filters.showDeleted ? 'checked' : ''}> เฉพาะที่ถูกลบ</label>
      </div>
    `;
    document.getElementById('av2PlayerSearch').oninput = (e) => { filters.q = e.target.value; renderTable(); };
    document.getElementById('av2PlayerClassFilter').onchange = (e) => { filters.classLabel = e.target.value; renderTable(); };
    document.getElementById('av2PlayerAdminOnly').onchange = (e) => { filters.adminOnly = e.target.checked; renderTable(); };
    document.getElementById('av2PlayerShowDeleted').onchange = (e) => { filters.showDeleted = e.target.checked; renderTable(); };
  }

  function renderTable() {
    const el = document.getElementById('av2PlayerTableWrap');
    if (!el) return;
    const rows = applyFilters();
    AdminV2.table(el, {
      columns: [
        { key: 'name', label: 'ชื่อ', sortable: true, render: (p) => `${escapeHtml(p.name)}${p.nickname ? ` <span class="av2-muted">(${escapeHtml(p.nickname)})</span>` : ''}${p.deletedAt ? ' <span class="av2-badge av2-badge-red">ลบแล้ว</span>' : ''}${p.isAdmin ? ' <span class="av2-badge av2-badge-gold">Admin</span>' : ''}` },
        { key: 'classLabel', label: 'ห้อง', sortable: true, render: (p) => escapeHtml(p.classLabel || '—') },
        { key: 'pts', label: 'ELO', sortable: true, render: (p) => `${p.pts} <span class="av2-muted">#${rankOf(p)}</span>` },
        { key: 'wins', label: 'W/L', sortable: true, render: (p) => `${p.wins}/${p.losses}` },
        { key: 'coins', label: 'เหรียญ', sortable: true },
      ],
      rows,
      defaultSort: 'pts',
      pageSize: 25,
      emptyState: { icon: '👥', message: 'ไม่พบผู้เล่นตามเงื่อนไขที่ค้นหา' },
      onRowClick: (p) => openPlayerDrawer(p.id),
    });
  }

  // ── Quick point adjustment ──
  function renderPointAdjust(p) {
    return `
      <div class="av2-drawer-section">
        <div class="av2-drawer-section-title">📈 ปรับคะแนน ELO (ปัจจุบัน: ${p.pts})</div>
        <div class="av2-quick-adjust-row">
          <button class="btn btn-ghost btn-sm" data-adj="50">+50</button>
          <button class="btn btn-ghost btn-sm" data-adj="100">+100</button>
          <button class="btn btn-ghost btn-sm" data-adj="-50">-50</button>
          <input class="inp" id="av2AdjAmount" type="number" placeholder="กำหนดเอง" style="max-width:110px">
        </div>
        <input class="inp" id="av2AdjReason" placeholder="เหตุผล (จำเป็น) เช่น แก้ไขผลทัวร์นาเมนต์" style="margin-top:8px">
        <button class="btn btn-primary btn-sm" id="av2AdjSaveBtn" style="margin-top:8px;width:auto">บันทึกการปรับคะแนน</button>
      </div>
    `;
  }

  function wirePointAdjust(p, onDone) {
    const amountInput = document.getElementById('av2AdjAmount');
    document.querySelectorAll('[data-adj]').forEach(btn => {
      btn.onclick = () => { amountInput.value = btn.dataset.adj; };
    });
    document.getElementById('av2AdjSaveBtn').onclick = () => {
      const delta = parseInt(amountInput.value, 10);
      const reason = document.getElementById('av2AdjReason').value.trim();
      if (!delta || Number.isNaN(delta)) { toast('กรอกจำนวนคะแนนที่จะปรับ', 'error'); return; }
      if (!reason) { toast('กรุณากรอกเหตุผล', 'error'); return; }
      AdminV2.confirm({
        level: 'confirm',
        title: 'ยืนยันการปรับคะแนน',
        body: `${p.name}: ${p.pts} ${delta > 0 ? '+' : ''}${delta} = ${Math.max(0, p.pts + delta)}\nเหตุผล: ${reason}`,
        onConfirm: async () => {
          try {
            await AdminV2.api.adjustPoints(p.id, delta, reason);
            toast('ปรับคะแนนสำเร็จ ✅', 'success');
            onDone();
          } catch (e) { toast('ปรับคะแนนไม่สำเร็จ: ' + e.message, 'error'); }
        },
      });
    };
  }

  // ── Field edit (name / nickname / class) ──
  function renderFieldEdit(p) {
    return `
      <div class="av2-drawer-section">
        <div class="av2-drawer-section-title">✏️ แก้ไขข้อมูลผู้เล่น</div>
        <div class="form-group"><label>ชื่อจริง</label><input class="inp" id="av2FieldName" value="${escapeHtml(p.name)}"></div>
        <div class="form-group"><label>ชื่อเล่น</label><input class="inp" id="av2FieldNickname" value="${escapeHtml(p.nickname || '')}"></div>
        <div class="form-group"><label>ห้อง</label><input class="inp" id="av2FieldClass" value="${escapeHtml(p.classLabel || '')}" placeholder="เช่น 4/9"></div>
        <input class="inp" id="av2FieldReason" placeholder="เหตุผล (จำเป็น)" value="แก้ไขข้อมูลผู้เล่น">
        <button class="btn btn-ghost btn-sm" id="av2FieldSaveBtn" style="margin-top:8px;width:auto">💾 บันทึก</button>
      </div>
    `;
  }

  function wireFieldEdit(p, onDone) {
    document.getElementById('av2FieldSaveBtn').onclick = () => {
      const name = document.getElementById('av2FieldName').value.trim();
      const nickname = document.getElementById('av2FieldNickname').value.trim();
      const classLabel = document.getElementById('av2FieldClass').value.trim();
      const reason = document.getElementById('av2FieldReason').value.trim();
      if (!name) { toast('ชื่อห้ามว่าง', 'error'); return; }
      if (!reason) { toast('กรุณากรอกเหตุผล', 'error'); return; }
      AdminV2.confirm({
        level: 'confirm', title: 'ยืนยันการแก้ไขข้อมูล', body: `บันทึกข้อมูลของ ${p.name}?`,
        onConfirm: async () => {
          try {
            await AdminV2.api.setPlayerFields(p.id, { name, nickname, class_label: classLabel }, reason);
            toast('บันทึกสำเร็จ ✅', 'success');
            onDone();
          } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'error'); }
        },
      });
    };
  }

  // ── Admin permission toggle ──
  function renderAdminToggle(p) {
    return `
      <div class="av2-drawer-section">
        <div class="av2-drawer-section-title">🔑 สิทธิ์ Admin</div>
        <label class="av2-checkbox-label"><input type="checkbox" id="av2AdminToggle" ${p.isAdmin ? 'checked' : ''}> เป็น Admin</label>
        <input class="inp" id="av2AdminReason" placeholder="เหตุผล (จำเป็น)" style="margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="av2AdminSaveBtn" style="margin-top:8px;width:auto">บันทึกสิทธิ์</button>
      </div>
    `;
  }

  function wireAdminToggle(p, onDone) {
    document.getElementById('av2AdminSaveBtn').onclick = () => {
      const newVal = document.getElementById('av2AdminToggle').checked;
      const reason = document.getElementById('av2AdminReason').value.trim();
      if (newVal === !!p.isAdmin) { toast('ไม่มีการเปลี่ยนแปลง', 'info'); return; }
      if (!reason) { toast('กรุณากรอกเหตุผล', 'error'); return; }
      AdminV2.confirm({
        level: 'warn',
        title: newVal ? 'ยืนยันการให้สิทธิ์ Admin' : 'ยืนยันการถอดสิทธิ์ Admin',
        body: `${p.name}`,
        consequences: [newVal ? 'ผู้เล่นนี้จะสามารถเข้าถึง Admin ได้เต็มรูปแบบ รวมถึงข้อมูลผู้เล่นทุกคน' : 'ผู้เล่นนี้จะไม่สามารถเข้า Admin ได้อีก'],
        confirmLabel: newVal ? 'ให้สิทธิ์' : 'ถอดสิทธิ์',
        onConfirm: async () => {
          try {
            await AdminV2.api.setPlayerFields(p.id, { is_admin: newVal }, reason);
            toast('บันทึกสิทธิ์สำเร็จ ✅', 'success');
            onDone();
          } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'error'); }
        },
      });
    };
  }

  // ── Soft delete / restore ──
  function renderDangerZone(p) {
    if (p.deletedAt) {
      return `
        <div class="av2-drawer-section">
          <div class="av2-drawer-section-title" style="color:var(--red)">⚠️ ผู้เล่นนี้ถูกลบแล้ว</div>
          <div class="av2-muted" style="font-size:0.8rem;margin-bottom:8px">ลบเมื่อ ${new Date(p.deletedAt).toLocaleString('th-TH')}</div>
          <button class="btn btn-primary btn-sm" id="av2RestoreBtn" style="width:auto">♻️ กู้คืนผู้เล่น</button>
        </div>
      `;
    }
    return `
      <div class="av2-drawer-section">
        <div class="av2-drawer-section-title" style="color:var(--red)">⚠️ Danger Zone</div>
        <input class="inp" id="av2DeleteReason" placeholder="เหตุผลในการลบ (จำเป็น)">
        <button class="btn btn-danger btn-sm" id="av2DeleteBtn" style="margin-top:8px;width:auto">🗑️ ลบผู้เล่น (Soft Delete)</button>
      </div>
    `;
  }

  function wireDangerZone(p, onDone) {
    const restoreBtn = document.getElementById('av2RestoreBtn');
    if (restoreBtn) {
      restoreBtn.onclick = () => {
        AdminV2.confirm({
          level: 'confirm', title: 'ยืนยันการกู้คืน', body: `กู้คืน ${p.name} กลับมาแสดงในระบบ?`,
          onConfirm: async () => {
            try { await AdminV2.api.restorePlayer(p.id); toast('กู้คืนสำเร็จ ✅', 'success'); onDone(); }
            catch (e) { toast('กู้คืนไม่สำเร็จ: ' + e.message, 'error'); }
          },
        });
      };
      return;
    }
    document.getElementById('av2DeleteBtn').onclick = () => {
      const reason = document.getElementById('av2DeleteReason').value.trim();
      if (!reason) { toast('กรุณากรอกเหตุผล', 'error'); return; }
      AdminV2.confirm({
        level: 'warn', title: 'ยืนยันการลบผู้เล่น', body: `${p.name}`,
        consequences: ['ผู้เล่นนี้จะหายไปจาก Leaderboard และอันดับต่าง ๆ ทันที', 'ประวัติการแข่งขันเดิมยังคงอยู่ (ไม่ถูกลบ)', 'สามารถกู้คืนได้ภายหลังจากหน้านี้'],
        confirmLabel: 'ลบผู้เล่น',
        onConfirm: async () => {
          try { await AdminV2.api.softDeletePlayer(p.id, reason); toast('ลบผู้เล่นสำเร็จ ✅', 'success'); onDone(); }
          catch (e) { toast('ลบไม่สำเร็จ: ' + e.message, 'error'); }
        },
      });
    };
  }

  // ── Recent match history (read-only) ──
  async function renderHistorySection(p, container) {
    container.innerHTML = `<div class="av2-drawer-section"><div class="av2-drawer-section-title">📋 ประวัติการแข่งล่าสุด</div><div id="av2PlayerHist"></div></div>`;
    const histEl = document.getElementById('av2PlayerHist');
    AdminV2.state(histEl, 'loading', {});
    try {
      const matches = await AdminV2.api.recentMatchesForPlayer(p.id);
      if (!matches.length) { AdminV2.state(histEl, 'empty', { message: 'ยังไม่มีประวัติการแข่ง' }); return; }
      histEl.innerHTML = matches.slice(0, 10).map(m => {
        const onTeamA = (m.teamA || []).some(x => x.id === p.id);
        const won = (onTeamA && m.winTeam === 'A') || (!onTeamA && m.winTeam === 'B');
        const oppTeam = onTeamA ? m.teamB : m.teamA;
        const oppNames = (oppTeam || []).map(x => x.name).join(' & ');
        return `<div class="av2-hist-row"><span class="${won ? 'av2-hist-win' : 'av2-hist-loss'}">${won ? 'ชนะ' : 'แพ้'}</span> vs ${escapeHtml(oppNames)} · ${m.scoreA}-${m.scoreB} · <span class="av2-muted">${new Date(m.date).toLocaleDateString('th-TH')}</span></div>`;
      }).join('');
    } catch (e) {
      AdminV2.state(histEl, 'error', { message: e.message, retry: () => renderHistorySection(p, container) });
    }
  }

  function openPlayerDrawer(playerId) {
    const p = allPlayers.find(x => x.id === playerId);
    if (!p) return;
    const refresh = () => { loadAndRenderPlayers().then(() => openPlayerDrawer(playerId)); };

    AdminV2.drawer({
      title: `${p.name}${p.nickname ? ' (' + p.nickname + ')' : ''}`,
      body: `
        <div id="av2DrawerStats" class="av2-drawer-stats">
          <div>ELO <strong>${p.pts}</strong></div>
          <div>W/L <strong>${p.wins}/${p.losses}</strong></div>
          <div>เหรียญ <strong>${p.coins}</strong></div>
          <div>เลเวล <strong>${p.level}</strong></div>
        </div>
        ${renderPointAdjust(p)}
        ${renderFieldEdit(p)}
        ${renderAdminToggle(p)}
        <div id="av2DrawerHistorySection"></div>
        ${renderDangerZone(p)}
      `,
      onMount: () => {
        wirePointAdjust(p, refresh);
        wireFieldEdit(p, refresh);
        wireAdminToggle(p, refresh);
        wireDangerZone(p, refresh);
        renderHistorySection(p, document.getElementById('av2DrawerHistorySection'));
      },
    });
  }

  async function loadAndRenderPlayers() {
    allPlayers = await AdminV2.api.listPlayersAll();
    renderTable();
  }

  AdminV2.players = {
    render(container) {
      container.innerHTML = `
        <div class="av2-panel">
          <div class="card"><div id="av2PlayerToolbar"></div><div id="av2PlayerTableWrap"></div></div>
        </div>
      `;
      renderToolbar(document.getElementById('av2PlayerToolbar'));
      const tableWrap = document.getElementById('av2PlayerTableWrap');
      AdminV2.state(tableWrap, 'loading', { message: 'กำลังโหลดผู้เล่น...' });
      loadAndRenderPlayers().catch(e => AdminV2.state(tableWrap, 'error', { message: e.message, retry: () => AdminV2.players.render(container) }));
    },
  };

})();
