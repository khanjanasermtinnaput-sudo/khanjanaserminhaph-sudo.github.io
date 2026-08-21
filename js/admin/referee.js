// Admin V2 — Referee Center (js/admin/referee.js)
// A dedicated launch point for scoring — it does NOT rebuild the scoreboard.
// Standalone matches reuse the exact same currentMatch + showMatchPlaying() +
// selectPlayMode('referee') pipeline the player-facing match screen already
// uses (js/leaderboard.js), so the fullscreen #refOverlay, its BWF rules
// (now via AdminV2.scoring), its timer (js/rankup.js), and its localStorage
// reload-resume all keep working completely unchanged — only the player
// picker here is new. Tournament matches launch via the existing
// koOpenReferee()/openRefereeFromSelects() (js/tournament-knockout.js,
// js/tournament.js).
window.AdminV2 = window.AdminV2 || {};

(function () {

  function playerOptions(selectedId) {
    const sorted = [...db.players].sort((a, b) => b.pts - a.pts);
    return sorted.map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name)} (${p.pts})</option>`).join('');
  }

  // Builds currentMatch exactly like startSingles()/startDoubles() do
  // (js/leaderboard.js:368-386), then hands off to the real, unmodified
  // referee flow.
  function launchStandalone(type, ids) {
    const find = (id) => db.players.find(p => p.id === id);
    const teamA = type === 'singles' ? [find(ids.a1)].filter(Boolean) : [find(ids.a1), find(ids.a2)].filter(Boolean);
    const teamB = type === 'singles' ? [find(ids.b1)].filter(Boolean) : [find(ids.b1), find(ids.b2)].filter(Boolean);
    const needed = type === 'singles' ? 1 : 2;
    if (teamA.length !== needed || teamB.length !== needed) { toast('เลือกผู้เล่นให้ครบ', 'error'); return; }
    const allIds = [...teamA, ...teamB].map(p => p.id);
    if (new Set(allIds).size !== allIds.length) { toast('เลือกผู้เล่นซ้ำกันไม่ได้', 'error'); return; }

    currentMatch = { type, teamA, teamB, scoreA: 0, scoreB: 0 };
    showMatchPlaying();
    selectPlayMode('referee');
  }

  function renderStandaloneLauncher(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🏸 เริ่ม Referee — แมตช์เดี่ยว</div>
        <div class="av2-ref-picker-row">
          <select class="inp" id="av2RefSingleA"><option value="">— ผู้เล่น A —</option>${playerOptions()}</select>
          <span class="av2-muted">VS</span>
          <select class="inp" id="av2RefSingleB"><option value="">— ผู้เล่น B —</option>${playerOptions()}</select>
        </div>
        <button class="btn btn-primary btn-sm" id="av2RefSingleGo" style="margin-top:10px;width:auto">👆 เริ่ม Referee</button>
      </div>
      <div class="card">
        <div class="card-title">🏸 เริ่ม Referee — แมตช์คู่</div>
        <div class="av2-ref-picker-row">
          <select class="inp" id="av2RefDblA1"><option value="">— A1 —</option>${playerOptions()}</select>
          <select class="inp" id="av2RefDblA2"><option value="">— A2 —</option>${playerOptions()}</select>
        </div>
        <div class="av2-muted" style="text-align:center;margin:4px 0">VS</div>
        <div class="av2-ref-picker-row">
          <select class="inp" id="av2RefDblB1"><option value="">— B1 —</option>${playerOptions()}</select>
          <select class="inp" id="av2RefDblB2"><option value="">— B2 —</option>${playerOptions()}</select>
        </div>
        <button class="btn btn-primary btn-sm" id="av2RefDblGo" style="margin-top:10px;width:auto">👆 เริ่ม Referee</button>
      </div>
    `;
    document.getElementById('av2RefSingleGo').onclick = () => {
      launchStandalone('singles', {
        a1: Number(document.getElementById('av2RefSingleA').value) || null,
        b1: Number(document.getElementById('av2RefSingleB').value) || null,
      });
    };
    document.getElementById('av2RefDblGo').onclick = () => {
      launchStandalone('doubles', {
        a1: Number(document.getElementById('av2RefDblA1').value) || null,
        a2: Number(document.getElementById('av2RefDblA2').value) || null,
        b1: Number(document.getElementById('av2RefDblB1').value) || null,
        b2: Number(document.getElementById('av2RefDblB2').value) || null,
      });
    };
  }

  // Ready tournament matches (round_index not null, status='ready'). Reuses
  // the existing koOpenReferee — this club's tournament_matches table has no
  // rows yet in production, so this path renders honestly empty until a
  // tournament actually reaches this state (Tournament Studio, Phase 4+).
  async function renderTournamentReady(el) {
    AdminV2.state(el, 'loading', {});
    try {
      const rows = await supaFetch('tournament_matches?status=eq.ready&round_index=not.is.null&order=round_index.asc&limit=50');
      if (!rows.length) {
        AdminV2.state(el, 'empty', { icon: '🏆', message: 'ไม่มีแมตช์ทัวร์นาเมนต์ที่พร้อมตัดสินตอนนี้' });
        return;
      }
      const tIds = [...new Set(rows.map(r => r.tournament_id))];
      const tRows = await supaFetch('tournaments?id=in.(' + tIds.join(',') + ')');
      const tById = Object.fromEntries(tRows.map(t => [t.id, t]));
      el.innerHTML = rows.map(m => {
        const t = tById[m.tournament_id];
        const groups = t ? (t.groups || []) : [];
        const labelA = typeof _koMatchPlayerLabel === 'function' ? _koMatchPlayerLabel(groups, db.players, m.player_a) : ('#' + m.player_a);
        const labelB = typeof _koMatchPlayerLabel === 'function' ? _koMatchPlayerLabel(groups, db.players, m.player_b) : ('#' + m.player_b);
        const winsNeeded = t && AdminV2.scoring.winsNeededForTier(t.tier);
        return `<div class="av2-hist-row">${escapeHtml(t ? t.name : '?')} · ${escapeHtml(m.round_name || '')} — ${escapeHtml(labelA)} vs ${escapeHtml(labelB)}
          <button class="btn btn-ghost btn-sm" style="margin-left:8px;width:auto" data-tid="${m.tournament_id}" data-mid="${m.id}" data-a="${m.player_a}" data-b="${m.player_b}" data-la="${escapeHtml(labelA)}" data-lb="${escapeHtml(labelB)}" data-need="${winsNeeded}">เปิด Referee</button>
        </div>`;
      }).join('');
      el.querySelectorAll('[data-mid]').forEach(btn => {
        btn.onclick = () => koOpenReferee(Number(btn.dataset.tid), Number(btn.dataset.mid), Number(btn.dataset.a), Number(btn.dataset.b), btn.dataset.la, btn.dataset.lb, Number(btn.dataset.need));
      });
    } catch (e) {
      AdminV2.state(el, 'error', { message: e.message, retry: () => renderTournamentReady(el) });
    }
  }

  AdminV2.referee = {
    render(container) {
      container.innerHTML = `
        <div class="av2-panel">
          <div id="av2RefStandalone"></div>
          <div class="card"><div class="card-title">🏆 แมตช์ทัวร์นาเมนต์ที่พร้อมตัดสิน</div><div id="av2RefTournamentReady"></div></div>
        </div>
      `;
      loadAll().then(() => renderStandaloneLauncher(document.getElementById('av2RefStandalone')));
      renderTournamentReady(document.getElementById('av2RefTournamentReady'));
    },
  };

})();
