// Admin V2 — Tournament Studio (js/admin/tournaments.js)
// Series -> Events -> Entrants. A `tournament_series` row is a NEW concept;
// each event underneath it is still a plain `tournaments` row, created
// through the exact same dbTournamentCreate() (js/tournament.js) the legacy
// admin panel already uses — this module does not reimplement bracket
// generation, registration validation, or the knockout engine (that's
// untouched, and stays reachable via "เปิดในหน้า Tournament (เดิม)" until the
// Bracket Editor phase replaces it).
window.AdminV2 = window.AdminV2 || {};

(function () {

  const EVENT_KINDS = [
    { id: 'ms', label: "ชายเดี่ยว", matchType: '1v1' },
    { id: 'ws', label: "หญิงเดี่ยว", matchType: '1v1' },
    { id: 'md', label: "ชายคู่", matchType: '2v2' },
    { id: 'wd', label: "หญิงคู่", matchType: '2v2' },
    { id: 'xd', label: "คู่ผสม", matchType: '2v2' },
    { id: 'custom', label: "กำหนดเอง", matchType: '1v1' },
  ];

  let seriesList = [];
  let tournamentsList = [];

  function eventsOf(seriesId) {
    return tournamentsList.filter(t => t.series_id === seriesId);
  }

  // ── List view ──
  async function loadData() {
    [seriesList, tournamentsList] = await Promise.all([AdminV2.api.listSeries(), AdminV2.api.listAllTournaments()]);
  }

  function seriesCardHTML(s) {
    const events = eventsOf(s.id);
    return `<div class="card av2-series-card" data-series="${s.id}">
      <div class="card-title">🏆 ${escapeHtml(s.name)} <span class="av2-badge ${s.status === 'active' ? 'av2-badge-gold' : ''}">${escapeHtml(s.status)}</span></div>
      ${s.event_date ? `<div class="av2-muted">📅 ${escapeHtml(s.event_date)}${s.location ? ' · 📍 ' + escapeHtml(s.location) : ''}</div>` : ''}
      <div style="margin-top:10px">
        ${events.length ? events.map(e => `<div class="av2-hist-row av2-event-row" data-event="${e.id}">${escapeHtml(e.event_label || e.name)} <span class="av2-muted">(${escapeHtml(e.tier || '')} · ${e.status})</span></div>`).join('')
          : '<div class="av2-muted">ยังไม่มีประเภทการแข่งขัน</div>'}
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px;width:auto" data-add-event="${s.id}">➕ เพิ่มประเภทการแข่งขัน</button>
    </div>`;
  }

  function legacyCardHTML() {
    const standalone = tournamentsList.filter(t => !t.series_id);
    if (!standalone.length) return '';
    return `<div class="card">
      <div class="card-title">📦 ทัวร์นาเมนต์เดี่ยว (ไม่ผูกกับ Series)</div>
      ${standalone.map(e => `<div class="av2-hist-row av2-event-row" data-event="${e.id}">${escapeHtml(e.name)} <span class="av2-muted">(${escapeHtml(e.tier || '')} · ${e.status})</span></div>`).join('')}
    </div>`;
  }

  async function renderList(container) {
    AdminV2.state(container, 'loading', {});
    try {
      await loadData();
      const body = document.createElement('div');
      body.className = 'av2-panel';
      body.innerHTML = `
        <div class="card">
          <button class="btn btn-primary btn-sm" id="av2NewSeriesBtn" style="width:auto">➕ สร้างทัวร์นาเมนต์ใหม่ (Series)</button>
        </div>
        ${seriesList.length ? seriesList.map(seriesCardHTML).join('') : ''}
        ${legacyCardHTML()}
        ${!seriesList.length && !tournamentsList.filter(t => !t.series_id).length ? '<div class="card"><div class="av2-muted" style="text-align:center;padding:20px">ยังไม่มี Tournament — เริ่มสร้างอันแรกได้เลย</div></div>' : ''}
      `;
      container.innerHTML = '';
      container.appendChild(body);

      document.getElementById('av2NewSeriesBtn').onclick = () => renderNewSeriesForm(container);
      container.querySelectorAll('[data-add-event]').forEach(btn => {
        btn.onclick = () => renderNewEventForm(container, Number(btn.dataset.addEvent));
      });
      container.querySelectorAll('[data-event]').forEach(row => {
        row.onclick = () => renderEventDetail(container, Number(row.dataset.event));
      });
    } catch (e) {
      AdminV2.state(container, 'error', { message: e.message, retry: () => renderList(container) });
    }
  }

  // ── Create series ──
  function renderNewSeriesForm(container) {
    container.innerHTML = `
      <div class="av2-panel">
        <div class="card">
          <div class="card-title">➕ สร้างทัวร์นาเมนต์ใหม่</div>
          <div class="form-group"><label>ชื่อทัวร์นาเมนต์</label><input class="inp" id="av2SeriesName" placeholder="เช่น คัดแบด 2569"></div>
          <div class="form-group"><label>รายละเอียด (ไม่บังคับ)</label><input class="inp" id="av2SeriesDesc"></div>
          <div class="form-group"><label>วันที่ (ไม่บังคับ)</label><input class="inp" type="date" id="av2SeriesDate"></div>
          <div class="form-group"><label>สถานที่ (ไม่บังคับ)</label><input class="inp" id="av2SeriesLocation"></div>
          <div style="display:flex;gap:10px;margin-top:10px">
            <button class="btn btn-ghost" id="av2SeriesCancel">ยกเลิก</button>
            <button class="btn btn-primary" id="av2SeriesSave">บันทึก แล้วเพิ่มประเภทการแข่งขัน →</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('av2SeriesCancel').onclick = () => renderList(container);
    document.getElementById('av2SeriesSave').onclick = async () => {
      const name = document.getElementById('av2SeriesName').value.trim();
      if (!name) { toast('กรุณากรอกชื่อทัวร์นาเมนต์', 'error'); return; }
      try {
        const s = await AdminV2.api.createSeries({
          name,
          description: document.getElementById('av2SeriesDesc').value.trim() || null,
          event_date: document.getElementById('av2SeriesDate').value || null,
          location: document.getElementById('av2SeriesLocation').value.trim() || null,
        });
        toast('สร้าง Series สำเร็จ ✅', 'success');
        await loadData();
        renderNewEventForm(container, s.id);
      } catch (e) { toast('สร้างไม่สำเร็จ: ' + e.message, 'error'); }
    };
  }

  // ── Add event to series ──
  function renderNewEventForm(container, seriesId) {
    const series = seriesList.find(s => s.id === seriesId);
    container.innerHTML = `
      <div class="av2-panel">
        <div class="card">
          <div class="card-title">➕ เพิ่มประเภทการแข่งขัน — ${series ? escapeHtml(series.name) : ''}</div>
          <div class="form-group"><label>ประเภท</label>
            <select class="inp" id="av2EventKind">${EVENT_KINDS.map(k => `<option value="${k.id}">${escapeHtml(k.label)}</option>`).join('')}</select>
          </div>
          <div class="form-group"><label>ระดับ (Tier)</label>
            <select class="inp" id="av2EventTier"><option value="Regular">Regular</option><option value="Super 500">Super 500</option></select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="form-group"><label>จำนวนกลุ่ม</label><input class="inp" type="number" id="av2EventNumGroups" value="2" min="1"></div>
            <div class="form-group"><label>ผู้เล่น/ทีมต่อกลุ่ม</label><input class="inp" type="number" id="av2EventPerGroup" value="4" min="2"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:10px">
            <button class="btn btn-ghost" id="av2EventCancel">← กลับ</button>
            <button class="btn btn-primary" id="av2EventSave">สร้างประเภทการแข่งขัน</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('av2EventCancel').onclick = () => renderList(container);
    document.getElementById('av2EventSave').onclick = async () => {
      const kindId = document.getElementById('av2EventKind').value;
      const kind = EVENT_KINDS.find(k => k.id === kindId);
      const tier = document.getElementById('av2EventTier').value;
      const numGroups = parseInt(document.getElementById('av2EventNumGroups').value, 10) || 2;
      const perGroup = parseInt(document.getElementById('av2EventPerGroup').value, 10) || 4;
      const letters = Array.from({ length: numGroups }, (_, i) => String.fromCharCode(65 + i));
      let groups;
      if (kind.matchType === '2v2') {
        const slots = {};
        letters.forEach(l => { slots[l] = Array.from({ length: perGroup }, () => [null, null]); });
        groups = [{ _meta: true, matchType: '2v2' }, { _config: true, matchType: '2v2', numGroups, teamsPerGroup: perGroup, registrationOpen: true, slots }];
      } else {
        const slots = {};
        letters.forEach(l => { slots[l] = Array(perGroup).fill(null); });
        groups = [{ _meta: true, matchType: '1v1' }, { _config: true, numGroups, playersPerGroup: perGroup, registrationOpen: true, slots }];
      }
      try {
        const eventName = (series ? series.name + ' — ' : '') + kind.label;
        const created = await dbTournamentCreate(eventName, tier, kind.matchType, groups);
        if (created && created.id) {
          await AdminV2.api.setTournamentEventMeta(created.id, { series_id: seriesId, event_kind: kind.id, event_label: kind.label });
        }
        toast('สร้างประเภทการแข่งขันสำเร็จ ✅', 'success');
        renderList(container);
      } catch (e) { toast('สร้างไม่สำเร็จ: ' + e.message, 'error'); }
    };
  }

  // ── Event detail: entrants ──
  function flattenEntrants(tournament) {
    const groups = getTournamentGroups(tournament);
    const cfg = getTournamentConfig(tournament);
    const isDoubles = getTournamentMatchType(tournament) === '2v2';
    const entrants = [];
    if (cfg && cfg.slots) {
      for (const [letter, group] of Object.entries(cfg.slots)) {
        group.forEach((slot, idx) => {
          if (isDoubles) {
            (slot || [null, null]).forEach((pid, sub) => {
              if (pid) entrants.push({ group: letter, slotIdx: idx, subIdx: sub, playerId: pid });
            });
          } else if (slot) {
            entrants.push({ group: letter, slotIdx: idx, subIdx: null, playerId: slot });
          }
        });
      }
    }
    return { entrants, isDoubles, groups, cfg };
  }

  function nextEmptySlot(cfg, isDoubles) {
    for (const [letter, group] of Object.entries(cfg.slots || {})) {
      for (let idx = 0; idx < group.length; idx++) {
        if (isDoubles) {
          const pair = group[idx] || [null, null];
          if (pair[0] === null) return { group: letter, slotIdx: idx, subIdx: 0 };
          if (pair[1] === null) return { group: letter, slotIdx: idx, subIdx: 1 };
        } else if (group[idx] === null) {
          return { group: letter, slotIdx: idx, subIdx: null };
        }
      }
    }
    return null;
  }

  async function renderEventDetail(container, tournamentId) {
    AdminV2.state(container, 'loading', {});
    try {
      const t = tournamentsList.find(x => x.id === tournamentId) || await dbGetTournamentById(tournamentId);
      const { entrants, isDoubles, cfg } = flattenEntrants(t);
      const playerName = (id) => (db.players.find(p => p.id === id) || {}).name || ('#' + id);

      const body = document.createElement('div');
      body.className = 'av2-panel';
      body.innerHTML = `
        <div class="card">
          <button class="btn btn-ghost btn-sm" id="av2EventBack" style="width:auto;margin-bottom:10px">← กลับ</button>
          <div class="card-title">${escapeHtml(t.event_label || t.name)} <span class="av2-badge">${escapeHtml(t.tier || '')}</span></div>
          <div class="av2-muted">สถานะ: ${escapeHtml(t.status)} · ประเภท: ${isDoubles ? 'คู่' : 'เดี่ยว'}</div>
          <div class="av2-muted" style="margin-top:8px">การจัดสาย/บันทึกผลแบบเต็ม ยังอยู่ที่หน้า Tournament เดิม (จะย้ายมาที่นี่ใน Bracket Editor เฟสถัดไป) —
            <a href="#" id="av2GoLegacyTournament" style="color:var(--neon2)">เปิดในหน้า Tournament เดิม →</a>
          </div>
        </div>
        <div class="card">
          <div class="card-title">👥 ผู้เข้าแข่งขัน (${entrants.length})</div>
          <div id="av2EntrantList">${entrants.length ? entrants.map(e =>
            `<div class="av2-hist-row">${e.group}${e.slotIdx + 1}${e.subIdx !== null ? '.' + (e.subIdx + 1) : ''} — ${escapeHtml(playerName(e.playerId))}
              <button class="btn btn-ghost btn-sm" style="margin-left:8px;width:auto;color:var(--red)" data-remove="${e.playerId}">ลบ</button>
            </div>`).join('') : '<div class="av2-muted">ยังไม่มีผู้เข้าแข่งขัน</div>'}
          </div>
          <div class="av2-players-toolbar" style="margin-top:12px">
            <select class="inp" id="av2AddEntrantPlayer"><option value="">— เลือกผู้เล่นเพื่อเพิ่ม —</option>${[...db.players].sort((a, b) => b.pts - a.pts).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select>
            <button class="btn btn-primary btn-sm" id="av2AddEntrantBtn" style="width:auto">➕ เพิ่ม</button>
          </div>
        </div>
      `;
      container.innerHTML = '';
      container.appendChild(body);

      document.getElementById('av2EventBack').onclick = (ev) => { ev.preventDefault(); renderList(container); };
      document.getElementById('av2GoLegacyTournament').onclick = (ev) => { ev.preventDefault(); showSection('tournament'); };

      container.querySelectorAll('[data-remove]').forEach(btn => {
        btn.onclick = () => {
          const reason = window.prompt('เหตุผลในการนำผู้เล่นออก (จำเป็น):', '');
          if (!reason || !reason.trim()) { toast('ต้องกรอกเหตุผล', 'error'); return; }
          AdminV2.confirm({
            level: 'confirm', title: 'ยืนยันการนำผู้เล่นออก', body: playerName(Number(btn.dataset.remove)),
            onConfirm: async () => {
              try { await AdminV2.api.unregisterEntrant(tournamentId, Number(btn.dataset.remove), reason.trim()); toast('นำออกสำเร็จ ✅', 'success'); renderEventDetail(container, tournamentId); }
              catch (e) { toast('ไม่สำเร็จ: ' + e.message, 'error'); }
            },
          });
        };
      });

      document.getElementById('av2AddEntrantBtn').onclick = async () => {
        const pid = Number(document.getElementById('av2AddEntrantPlayer').value);
        if (!pid) { toast('เลือกผู้เล่นก่อน', 'error'); return; }
        const slot = nextEmptySlot(cfg, isDoubles);
        if (!slot) { toast('ไม่มีช่องว่างเหลือแล้ว', 'error'); return; }
        try {
          await AdminV2.api.registerEntrant(tournamentId, slot.group, slot.slotIdx, slot.subIdx, pid, 'เพิ่มโดย Admin ผ่าน Tournament Studio');
          toast('เพิ่มผู้เข้าแข่งขันสำเร็จ ✅', 'success');
          renderEventDetail(container, tournamentId);
        } catch (e) { toast('ไม่สำเร็จ: ' + e.message, 'error'); }
      };
    } catch (e) {
      AdminV2.state(container, 'error', { message: e.message, retry: () => renderEventDetail(container, tournamentId) });
    }
  }

  AdminV2.tournaments = {
    render(container) {
      loadAll(); // ensure db.players is fresh for name lookups
      renderList(container);
    },
  };

})();
