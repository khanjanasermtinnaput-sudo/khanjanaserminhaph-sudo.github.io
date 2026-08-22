// Admin V2 — BWF Bracket Editor (js/admin/bracket.js)
// A thin orchestrator, not a new renderer: bracket display reuses the
// existing openBracketFullscreen() (.brmx-* viewer, js/tournament-knockout.js)
// completely unchanged — it already has an isAdmin flag that turns on the
// referee/correct-result buttons. This module's only real job is the part
// that didn't exist before: launching rpc_admin_tournament_generate_draw
// (supabase_admin_v2_draw.sql) with entrants pulled from the event's
// registered slots (js/admin/tournaments.js) and an admin-chosen BYE mode.
window.AdminV2 = window.AdminV2 || {};

(function () {

  const BYE_MODES = [
    { id: 'random', label: 'สุ่ม (Random)' },
    { id: 'seeded', label: 'ตามอันดับ (Seeded) — มืออันดับดีได้ Bye ก่อน' },
    { id: 'manual', label: 'กำหนดเอง (Manual)' },
  ];

  // entrants: [{ playerId, label, seed? }] — singles: one row per player.
  // doubles: one row per TEAM, playerId is the anchor per the existing
  // convention (js/tournament.js getTeamByAnchor) — the partner is not a
  // separate bracket slot, same as the rest of this app.
  async function openDrawFlow(tournamentId, entrants) {
    if (!entrants.length) {
      AdminV2.confirm({ level: 'confirm', title: 'ยังไม่มีผู้เข้าแข่งขัน', body: 'เพิ่มผู้เข้าแข่งขันก่อนสร้างสาย', confirmLabel: 'ตกลง', onConfirm: () => {} });
      return;
    }
    if (entrants.length > 32) {
      toast('รองรับสูงสุด 32 คน/ทีมต่อสาย', 'error');
      return;
    }

    const host = document.createElement('div');
    host.innerHTML = `
      <div class="form-group"><label>วิธีจัด BYE</label>
        <select class="inp" id="av2DrawByeMode">${BYE_MODES.map(m => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('')}</select>
      </div>
      <div id="av2DrawSeedRows"></div>
    `;

    AdminV2.drawer({
      title: `🎲 สร้างสายการแข่งขัน (${entrants.length} คน/ทีม)`,
      body: host.innerHTML,
      actions: `<button class="btn btn-ghost" id="av2DrawCancel">ยกเลิก</button><button class="btn btn-primary" id="av2DrawGo">สร้างสาย</button>`,
      onMount: () => {
        const modeSel = document.getElementById('av2DrawByeMode');
        const seedRowsEl = document.getElementById('av2DrawSeedRows');
        function renderSeedRows() {
          const mode = modeSel.value;
          if (mode === 'random') { seedRowsEl.innerHTML = ''; return; }
          if (mode === 'seeded') {
            seedRowsEl.innerHTML = `<div class="av2-muted" style="margin:8px 0">กำหนดอันดับ (1 = ดีที่สุด, ได้ Bye ก่อน)</div>` +
              entrants.map((e, i) => `<div class="av2-hist-row">${escapeHtml(e.label)} <input class="inp" type="number" data-seed="${e.playerId}" value="${i + 1}" style="width:70px;display:inline-block;margin-left:8px"></div>`).join('');
          } else {
            seedRowsEl.innerHTML = `<div class="av2-muted" style="margin:8px 0">เลือกผู้ที่จะได้ Bye</div>` +
              entrants.map(e => `<label class="av2-checkbox-label" style="display:flex;margin:4px 0"><input type="checkbox" data-bye="${e.playerId}"> ${escapeHtml(e.label)}</label>`).join('');
          }
        }
        modeSel.onchange = renderSeedRows;
        renderSeedRows();

        document.getElementById('av2DrawCancel').onclick = () => AdminV2.closeDrawer();
        document.getElementById('av2DrawGo').onclick = () => {
          const mode = modeSel.value;
          const size = (() => { let s = 1; while (s < entrants.length) s *= 2; return s; })();
          const byesNeeded = size - entrants.length;

          let payload;
          if (mode === 'seeded') {
            payload = entrants.map(e => ({ winnerId: e.playerId, seed: Number(document.querySelector(`[data-seed="${e.playerId}"]`).value) || 999 }));
          } else if (mode === 'manual') {
            const checked = [...document.querySelectorAll('[data-bye]:checked')].map(cb => Number(cb.dataset.bye));
            if (checked.length !== byesNeeded) { toast(`ต้องเลือกผู้ได้ Bye ให้ครบ ${byesNeeded} คน/ทีม (ตอนนี้เลือก ${checked.length})`, 'error'); return; }
            payload = entrants.map(e => ({ winnerId: e.playerId, bye: checked.includes(e.playerId) }));
          } else {
            payload = entrants.map(e => ({ winnerId: e.playerId }));
          }

          AdminV2.confirm({
            level: 'confirm', title: 'ยืนยันสร้างสายการแข่งขัน',
            body: `${entrants.length} คน/ทีม — วิธีจัด BYE: ${BYE_MODES.find(m => m.id === mode).label}\nหลังสร้างแล้วจะแก้ไขรายชื่อผู้เข้าแข่งขันไม่ได้`,
            onConfirm: async () => {
              try {
                // Doubles: also record a legacy-shaped {teams:[{playerIds:[anchor,partner]}]}
                // group so getTeamByAnchor()/_koMatchPlayerLabel() (js/tournament.js,
                // js/tournament-knockout.js — both unchanged) can resolve "Anchor / Partner"
                // in the bracket viewer. Without this the bracket would still work
                // correctly (advancement only ever uses the anchor id) but would only
                // display the anchor's own name, not the pair.
                const withPartner = entrants.filter(e => e.partnerId);
                if (withPartner.length) {
                  const t = await dbGetTournamentById(tournamentId);
                  const teamsGroup = { letter: 'DRAW', matchType: '2v2', teams: withPartner.map(e => ({ playerIds: [e.playerId, e.partnerId] })) };
                  const newGroups = (t.groups || []).filter(g => g.letter !== 'DRAW').concat([teamsGroup]);
                  await AdminV2.api.setTournamentEventMeta(tournamentId, { groups: newGroups });
                }
                await supaFetch('rpc/rpc_admin_tournament_generate_draw', {
                  method: 'POST',
                  body: JSON.stringify({ p_tournament_id: tournamentId, p_entrants: payload, p_bye_placement: mode }),
                });
                AdminV2.closeDrawer();
                toast('สร้างสายการแข่งขันสำเร็จ 🏆', 'success');
                if (typeof AdminV2._onDrawDone === 'function') AdminV2._onDrawDone();
              } catch (e) { toast('สร้างสายไม่สำเร็จ: ' + e.message, 'error'); }
            },
          });
        };
      },
    });
  }

  async function viewBracket(tournamentId) {
    const t = await dbGetTournamentById(tournamentId);
    if (!t) { toast('ไม่พบทัวร์นาเมนต์', 'error'); return; }
    if (t.status === 'completed' && (t.groups || []).some(g => g._hof && g.auto_qualified)) {
      const hof = t.groups.find(g => g._hof);
      AdminV2.confirm({ level: 'confirm', title: '🏆 ผ่านเข้ารอบอัตโนมัติ', body: `${hof.champion_name} ผ่านเข้ารอบโดยอัตโนมัติ (มีผู้เข้าแข่งขันคนเดียว) — ไม่มีการแข่งขันเกิดขึ้น`, confirmLabel: 'ตกลง', onConfirm: () => {} });
      return;
    }
    const matches = await dbGetTournamentMatches(tournamentId);
    const koMatches = matches.filter(m => m.round_index !== null);
    if (!koMatches.length) { toast('ยังไม่ได้สร้างสายการแข่งขัน', 'info'); return; }
    openBracketFullscreen(tournamentId, t.event_label || t.name, koMatches, t.groups || [], t.tier, isAdminUser(), false);
  }

  AdminV2.bracket = { openDrawFlow, viewBracket, BYE_MODES };

})();
