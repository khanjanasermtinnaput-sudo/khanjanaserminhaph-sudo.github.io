// Admin V2 — Match Control Center (js/admin/matches.js)
// Tabs reflect the real data model, not an invented one: `pending_matches`
// (awaiting approval), `matches` with status='completed', and status='voided'
// (js/admin/api.js listMatches / supabase_admin_v2_matches.sql). There is no
// separate "live" match table in this app (see the plan) — a truly-in-progress
// Referee session only exists in the scorer's own browser localStorage.
window.AdminV2 = window.AdminV2 || {};

(function () {

  let activeTab = 'pending';

  function teamLabel(team) {
    return (team || []).map(p => escapeHtml(p.name)).join(' & ');
  }

  function renderTabs(el) {
    const tabs = [
      { id: 'pending', label: '⏳ รอยืนยัน' },
      { id: 'completed', label: '✅ เสร็จสมบูรณ์' },
      { id: 'voided', label: '🗑️ ยกเลิกแล้ว' },
    ];
    el.innerHTML = tabs.map(t => `<button type="button" class="tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('');
    el.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => { activeTab = btn.dataset.tab; renderTabs(el); renderList(); };
    });
  }

  async function renderPending() {
    const el = document.getElementById('av2MatchList');
    AdminV2.state(el, 'loading', {});
    try {
      const pending = await dbGetPending();
      if (!pending.length) { AdminV2.state(el, 'empty', { icon: '⏳', message: 'ไม่มีรายการรอยืนยัน' }); return; }
      el.innerHTML = pending.map(m => {
        const teamA = m.team_a || [], teamB = m.team_b || [];
        return `<div class="av2-hist-row">
          ${m.type === 'doubles' ? '👥' : '👤'} ${teamLabel(teamA)} <strong>${m.score_a}-${m.score_b}</strong> ${teamLabel(teamB)}
          <span class="av2-muted">· ${new Date(m.created_at).toLocaleString('th-TH')}</span>
          <button class="btn btn-primary btn-sm" style="margin-left:8px;width:auto" data-approve="${m.id}">✅ อนุมัติ</button>
          <button class="btn btn-ghost btn-sm" style="width:auto" data-reject="${m.id}">❌ ปฏิเสธ</button>
        </div>`;
      }).join('');
      // Reuses the existing, already-admin-gated approvePending()/rejectPending()
      // pipeline (js/leaderboard.js) — ELO/coins/EXP/achievements/partner
      // recalc all stay exactly as they are; this panel is a nicer table+buttons
      // on top, not a re-implementation.
      el.querySelectorAll('[data-approve]').forEach(btn => { btn.onclick = () => approvePending(Number(btn.dataset.approve)).then(renderPending); });
      el.querySelectorAll('[data-reject]').forEach(btn => { btn.onclick = () => rejectPending(Number(btn.dataset.reject)).then(renderPending); });
    } catch (e) {
      AdminV2.state(el, 'error', { message: e.message, retry: renderPending });
    }
  }

  async function renderCompleted() {
    const el = document.getElementById('av2MatchList');
    AdminV2.state(el, 'loading', {});
    try {
      const matches = await AdminV2.api.listMatches('completed');
      if (!matches.length) { AdminV2.state(el, 'empty', { icon: '✅', message: 'ยังไม่มีแมตช์ที่บันทึกไว้' }); return; }
      el.innerHTML = matches.map(m => {
        const durTag = m.durationSeconds ? ` <span class="av2-muted">⏱ ${formatDurationThai(m.durationSeconds)}</span>` : '';
        return `<div class="av2-hist-row">
          ${m.type === 'doubles' ? '👥' : '👤'} ${teamLabel(m.teamA)} <strong>${m.scoreA}-${m.scoreB}</strong> ${teamLabel(m.teamB)}
          <span class="av2-muted">· ${new Date(m.date).toLocaleString('th-TH')}</span>${durTag}
          <button class="btn btn-ghost btn-sm" style="margin-left:8px;width:auto;color:var(--red)" data-void="${m.id}">🗑️ ยกเลิกผล</button>
        </div>`;
      }).join('');
      el.querySelectorAll('[data-void]').forEach(btn => { btn.onclick = () => openVoidFlow(Number(btn.dataset.void), matches); });
    } catch (e) {
      AdminV2.state(el, 'error', { message: e.message, retry: renderCompleted });
    }
  }

  async function renderVoided() {
    const el = document.getElementById('av2MatchList');
    AdminV2.state(el, 'loading', {});
    try {
      const matches = await AdminV2.api.listMatches('voided');
      if (!matches.length) { AdminV2.state(el, 'empty', { icon: '🗑️', message: 'ยังไม่มีแมตช์ที่ถูกยกเลิก' }); return; }
      el.innerHTML = matches.map(m => `<div class="av2-hist-row" style="opacity:0.7;text-decoration:line-through">
        ${teamLabel(m.teamA)} ${m.scoreA}-${m.scoreB} ${teamLabel(m.teamB)}
        <span class="av2-muted" style="text-decoration:none;display:block;font-size:0.75rem">ยกเลิกเมื่อ ${new Date(m.voidedAt).toLocaleString('th-TH')} · เหตุผล: ${escapeHtml(m.voidReason || '—')}</span>
      </div>`).join('');
    } catch (e) {
      AdminV2.state(el, 'error', { message: e.message, retry: renderVoided });
    }
  }

  function openVoidFlow(matchId, matches) {
    const m = matches.find(x => x.id === matchId);
    if (!m) return;
    // AdminV2.confirm's body is static text, not a form — collect the
    // mandatory reason first (native prompt(), same pattern already used at
    // 17 other call sites in this codebase), then show the real confirm.
    const reason = window.prompt('เหตุผลในการยกเลิกผล (จำเป็น):', '');
    if (!reason || !reason.trim()) { toast('ต้องกรอกเหตุผล — ยกเลิกการทำรายการ', 'error'); return; }
    AdminV2.confirm({
      level: 'warn',
      title: 'ยืนยันการยกเลิกผลแมตช์',
      body: `${teamLabel(m.teamA)} ${m.scoreA}-${m.scoreB} ${teamLabel(m.teamB)}\nเหตุผล: ${reason.trim()}`,
      consequences: [
        `คะแนน ELO ที่ได้/เสียจากแมตช์นี้ (+${m.pts.gain} / -${m.pts.loss}) จะถูกคืนค่าให้ตรงกับก่อนแข่งพอดี`,
        'สถิติแพ้ชนะ (W/L) ของทั้งสองฝั่งจะถูกคืนค่าเช่นกัน',
        'เหรียญ, EXP, และ Achievement ที่ได้จากแมตช์นี้ (ถ้ามี) จะไม่ถูกดึงกลับ — ต้องจัดการแยกด้วยตนเองถ้าจำเป็น',
      ],
      confirmLabel: 'ยกเลิกผล',
      onConfirm: async () => {
        try {
          await AdminV2.api.voidMatch(matchId, reason.trim());
          toast('ยกเลิกผลสำเร็จ ✅', 'success');
          renderCompleted();
        } catch (e) { toast('ยกเลิกไม่สำเร็จ: ' + e.message, 'error'); }
      },
    });
  }

  function renderList() {
    if (activeTab === 'pending') renderPending();
    else if (activeTab === 'completed') renderCompleted();
    else renderVoided();
  }

  AdminV2.matches = {
    render(container) {
      container.innerHTML = `
        <div class="av2-panel">
          <div class="card">
            <div class="tab-row" id="av2MatchTabs" style="margin-bottom:14px"></div>
            <div id="av2MatchList"></div>
          </div>
        </div>
      `;
      renderTabs(document.getElementById('av2MatchTabs'));
      renderList();
    },
  };

})();
