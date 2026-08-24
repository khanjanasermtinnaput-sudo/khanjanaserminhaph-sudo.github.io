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
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-ghost btn-sm" style="width:auto" data-add-event="${s.id}">➕ เพิ่มประเภทการแข่งขัน</button>
        <button class="btn btn-ghost btn-sm" style="width:auto" data-ai-import="${s.id}">✨ AI Import รายชื่อ</button>
      </div>
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
          <button class="btn btn-primary btn-sm" id="av2NewSeriesBtn" style="width:auto">➕ สร้างรายการแข่งขัน</button>
          ${AdminV2.tournamentWizard && AdminV2.tournamentWizard.hasDraft()
            ? `<div class="av2-muted" style="margin-top:8px;font-size:0.8rem">
                 มีฉบับร่างที่ยังสร้างไม่เสร็จค้างอยู่ — กดปุ่มด้านบนเพื่อทำต่อ
                 <button class="btn btn-ghost btn-sm" id="av2DiscardDraft" style="width:auto;margin-left:6px">ทิ้งฉบับร่าง</button>
               </div>`
            : ''}
        </div>
        ${seriesList.length ? seriesList.map(seriesCardHTML).join('') : ''}
        ${legacyCardHTML()}
        ${!seriesList.length && !tournamentsList.filter(t => !t.series_id).length ? '<div class="card"><div class="av2-muted" style="text-align:center;padding:20px">ยังไม่มี Tournament — เริ่มสร้างอันแรกได้เลย</div></div>' : ''}
      `;
      container.innerHTML = '';
      container.appendChild(body);

      // The six-step wizard is the way a competition gets created now: it builds
      // the whole series client-side and publishes it in ONE transaction, so a
      // partial series cannot result. renderNewSeriesForm below is the pre-V2
      // one-event-at-a-time path, still reachable for adding an event to an
      // existing series until Phase 4 replaces that too.
      document.getElementById('av2NewSeriesBtn').onclick = () => {
        if (AdminV2.tournamentWizard) AdminV2.tournamentWizard.open(container);
        else renderNewSeriesForm(container);
      };
      const discardBtn = document.getElementById('av2DiscardDraft');
      if (discardBtn) discardBtn.onclick = () => {
        AdminV2.tournamentWizard.discardDraft();
        renderList(container);
      };
      container.querySelectorAll('[data-add-event]').forEach(btn => {
        btn.onclick = () => renderNewEventForm(container, Number(btn.dataset.addEvent));
      });
      container.querySelectorAll('[data-ai-import]').forEach(btn => {
        btn.onclick = () => renderAIImportPaste(container, Number(btn.dataset.aiImport));
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
      const koMatches = t.status !== 'active' ? [] : await dbGetTournamentMatches(tournamentId).then(ms => ms.filter(m => m.round_index !== null)).catch(() => []);
      const hasBracket = koMatches.length > 0 || (t.status === 'completed');

      const body = document.createElement('div');
      body.className = 'av2-panel';
      body.innerHTML = `
        <div class="card">
          <button class="btn btn-ghost btn-sm" id="av2EventBack" style="width:auto;margin-bottom:10px">← กลับ</button>
          <div class="card-title">${escapeHtml(t.event_label || t.name)} <span class="av2-badge">${escapeHtml(t.tier || '')}</span></div>
          <div class="av2-muted">สถานะ: ${escapeHtml(t.status)} · ประเภท: ${isDoubles ? 'คู่' : 'เดี่ยว'}</div>
          <div style="display:flex;gap:8px;margin-top:10px">
            ${hasBracket
              ? `<button class="btn btn-primary btn-sm" id="av2ViewBracket" style="width:auto">🏆 ดูสาย Bracket</button>`
              : `<button class="btn btn-primary btn-sm" id="av2GenerateDraw" style="width:auto">🎲 สร้างสายการแข่งขัน</button>`}
            <a href="#" id="av2GoLegacyTournament" style="color:var(--neon2);align-self:center;font-size:0.82rem">เปิดในหน้า Tournament เดิม →</a>
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

      const viewBtn = document.getElementById('av2ViewBracket');
      if (viewBtn) viewBtn.onclick = () => AdminV2.bracket.viewBracket(tournamentId);
      const genBtn = document.getElementById('av2GenerateDraw');
      if (genBtn) genBtn.onclick = () => {
        const drawEntrants = isDoubles
          ? entrants.filter(e => e.subIdx === 0).map(e => {
              const partner = entrants.find(x => x.group === e.group && x.slotIdx === e.slotIdx && x.subIdx === 1);
              return { playerId: e.playerId, partnerId: partner ? partner.playerId : null, label: playerName(e.playerId) + (partner ? ' / ' + playerName(partner.playerId) : '') };
            })
          : entrants.map(e => ({ playerId: e.playerId, label: playerName(e.playerId) }));
        AdminV2._onDrawDone = () => renderEventDetail(container, tournamentId);
        AdminV2.bracket.openDrawFlow(tournamentId, drawEntrants);
      };

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

  // ── AI Import: paste → parse → match → preview → admin confirm → write ──
  // AI never writes the database directly (see the plan) — parseRosterText/
  // matchPlayer (js/admin/roster-parse.js, js/admin/roster-match.js) are pure
  // functions with zero DB access; only confirmAIImport(), which runs solely
  // on the admin's explicit click, calls any Supabase RPC. There is
  // deliberately no "create new player" option here yet — an unmatched row
  // can only be manually matched to an existing player or skipped; adding
  // account creation from an unverified paste is a bigger decision than this
  // pass, so it's left out rather than rushed.
  function renderAIImportPaste(container, seriesId) {
    const series = seriesList.find(s => s.id === seriesId);
    container.innerHTML = `
      <div class="av2-panel">
        <div class="card">
          <div class="card-title">✨ AI Import รายชื่อ — ${series ? escapeHtml(series.name) : ''}</div>
          <div class="av2-muted" style="margin-bottom:8px">วางรายชื่อจากแชท ระบบจะแยกประเภท/ชื่อ/ชื่อเล่น/ห้อง/คู่ให้อัตโนมัติ — ไม่มีอะไรถูกบันทึกจนกว่าจะกด "ยืนยันนำเข้า"</div>
          <textarea class="inp" id="av2ImportPaste" rows="10" placeholder="ชายเดี่ยว&#10;ปฐวี ทับทิมแดง โน๊ต 4/9&#10;ชานุกูล ศรีทองกุล กาฟิวส์ 4/7" style="font-family:inherit;resize:vertical"></textarea>
          <div style="display:flex;gap:10px;margin-top:10px">
            <button class="btn btn-ghost" id="av2ImportCancel">ยกเลิก</button>
            <button class="btn btn-primary" id="av2ImportParse">แยกข้อมูล →</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('av2ImportCancel').onclick = () => renderList(container);
    document.getElementById('av2ImportParse').onclick = async () => {
      const text = document.getElementById('av2ImportPaste').value;
      if (!text.trim()) { toast('วางรายชื่อก่อน', 'error'); return; }
      await loadAll();
      const parsed = AdminV2.rosterParse.parseRosterText(text);
      if (!parsed.events.length) { toast('แยกข้อมูลไม่ได้ — ตรวจสอบว่ามีหัวข้อประเภทการแข่งขัน (เช่น ชายเดี่ยว) หรือไม่', 'error'); return; }
      renderAIImportPreview(container, seriesId, parsed);
    };
  }

  function matchRow(parsedPlayer) {
    const m = AdminV2.rosterMatch.matchPlayer(
      { fullName: parsedPlayer.fullName, nickname: parsedPlayer.nickname, classLabel: parsedPlayer.classLabel },
      db.players
    );
    return { parsed: parsedPlayer, match: m, chosenId: m.tier === 'exact' ? m.candidates[0].player.id : null, skip: false };
  }

  function renderAIImportPreview(container, seriesId, parsed) {
    const rowsState = parsed.events.map(ev => ({
      kind: ev.kind, label: ev.label, doubles: ev.doubles,
      singles: ev.doubles ? [] : ev.players.map(matchRow),
      pairs: ev.doubles ? ev.pairs.map(pair => [matchRow(pair[0]), pair[1] ? matchRow(pair[1]) : null]) : [],
    }));

    function rowHTML(row, rowId) {
      const p = row.parsed;
      const badge = row.match.tier === 'exact' ? `<span class="av2-badge av2-badge-gold">✓ ${escapeHtml(row.match.candidates[0].player.name)}</span>`
        : row.match.tier === 'none' ? `<span class="av2-badge av2-badge-red">⚠ ไม่พบผู้เล่น</span>`
        : `<span class="av2-badge">⚠ ไม่แน่ใจ — เลือกด้านล่าง</span>`;
      const options = row.match.candidates.map(c => `<option value="${c.player.id}" ${row.chosenId === c.player.id ? 'selected' : ''}>${escapeHtml(c.player.name)} (${Math.round(c.score * 100)}%)</option>`).join('');
      return `<div class="av2-hist-row" data-row="${rowId}">
        ${escapeHtml(p.fullName || p.raw)}${p.nickname ? ' (' + escapeHtml(p.nickname) + ')' : ''} ${p.classLabel ? '· ' + escapeHtml(p.classLabel) : '<span class="av2-muted">· ไม่มีห้อง</span>'} ${badge}
        ${row.match.candidates.length ? `<select class="inp" data-choose="${rowId}" style="display:inline-block;width:auto;margin-left:8px"><option value="">— ไม่เลือก / ข้าม —</option>${options}</select>` : ''}
        <label class="av2-checkbox-label" style="display:inline-flex;margin-left:8px"><input type="checkbox" data-skip="${rowId}" ${row.skip ? 'checked' : ''}> ข้ามรายนี้</label>
      </div>`;
    }

    let rowCounter = 0;
    const rowRefs = [];
    function eventBlockHTML(ev) {
      const parts = [];
      if (ev.doubles) {
        ev.pairs.forEach(pair => {
          parts.push('<div style="border-left:2px solid var(--glass-border);padding-left:10px;margin-bottom:8px">');
          const id1 = rowCounter++; rowRefs[id1] = pair[0]; parts.push(rowHTML(pair[0], id1));
          if (pair[1]) { const id2 = rowCounter++; rowRefs[id2] = pair[1]; parts.push(rowHTML(pair[1], id2)); }
          else parts.push('<div class="av2-muted" style="padding-left:4px">⚠ ไม่มีคู่</div>');
          parts.push('</div>');
        });
      } else {
        ev.singles.forEach(row => { const id = rowCounter++; rowRefs[id] = row; parts.push(rowHTML(row, id)); });
      }
      const kindMeta = EVENT_KINDS.find(k => k.id === ev.kind);
      return `<div class="card"><div class="card-title">${escapeHtml(kindMeta ? kindMeta.label : ev.label)}</div>${parts.join('')}</div>`;
    }

    const warningsHTML = parsed.warnings.length
      ? `<div class="card" style="border-color:rgba(255,215,0,0.3)"><div class="card-title" style="color:var(--gold)">⚠️ คำเตือน (${parsed.warnings.length})</div>${parsed.warnings.map(w => `<div class="av2-muted" style="font-size:0.8rem">${escapeHtml(w.message)}</div>`).join('')}</div>`
      : '';

    container.innerHTML = `<div class="av2-panel">
      ${warningsHTML}
      ${rowsState.map(eventBlockHTML).join('')}
      <div class="card">
        <button class="btn btn-ghost" id="av2ImportBack" style="width:auto">← กลับ</button>
        <button class="btn btn-primary" id="av2ImportConfirm" style="width:auto;margin-left:10px">✅ ยืนยันนำเข้า</button>
      </div>
    </div>`;

    container.querySelectorAll('[data-choose]').forEach(sel => {
      sel.onchange = () => { rowRefs[Number(sel.dataset.choose)].chosenId = sel.value ? Number(sel.value) : null; };
    });
    container.querySelectorAll('[data-skip]').forEach(cb => {
      cb.onchange = () => { rowRefs[Number(cb.dataset.skip)].skip = cb.checked; };
    });
    document.getElementById('av2ImportBack').onclick = () => renderAIImportPaste(container, seriesId);
    document.getElementById('av2ImportConfirm').onclick = () => confirmAIImport(container, seriesId, rowsState);
  }

  function nextEmptyPairSlot(planCfg) {
    for (const [letter, group] of Object.entries(planCfg.slots || {})) {
      for (let idx = 0; idx < group.length; idx++) {
        const pv = group[idx] || [null, null];
        if (pv[0] === null && pv[1] === null) return { group: letter, slotIdx: idx };
      }
    }
    return null;
  }

  async function ensureEventForKind(seriesId, kindKey, neededSlots) {
    let t = tournamentsList.find(x => x.series_id === seriesId && x.event_kind === kindKey);
    if (t) return t;
    const kindMeta = EVENT_KINDS.find(k => k.id === kindKey);
    const series = seriesList.find(s => s.id === seriesId);
    const numGroups = Math.max(1, Math.ceil(neededSlots / 4));
    const perGroup = Math.max(2, Math.ceil(neededSlots / numGroups));
    const letters = Array.from({ length: numGroups }, (_, i) => String.fromCharCode(65 + i));
    let groups;
    if (kindMeta.matchType === '2v2') {
      const slots = {}; letters.forEach(l => { slots[l] = Array.from({ length: perGroup }, () => [null, null]); });
      groups = [{ _meta: true, matchType: '2v2' }, { _config: true, matchType: '2v2', numGroups, teamsPerGroup: perGroup, registrationOpen: true, slots }];
    } else {
      const slots = {}; letters.forEach(l => { slots[l] = Array(perGroup).fill(null); });
      groups = [{ _meta: true, matchType: '1v1' }, { _config: true, numGroups, playersPerGroup: perGroup, registrationOpen: true, slots }];
    }
    const eventName = (series ? series.name + ' — ' : '') + kindMeta.label;
    const created = await dbTournamentCreate(eventName, 'Regular', kindMeta.matchType, groups);
    if (created && created.id) {
      await AdminV2.api.setTournamentEventMeta(created.id, { series_id: seriesId, event_kind: kindKey, event_label: kindMeta.label });
      tournamentsList.push({ ...created, series_id: seriesId, event_kind: kindKey, event_label: kindMeta.label, groups });
    }
    return created;
  }

  async function importEventEntrants(seriesId, kindKey, confirmedSingleIds, confirmedPairIds) {
    const neededSlots = confirmedSingleIds.length + confirmedPairIds.length * 2;
    if (neededSlots === 0) return { created: 0, errors: [] };
    const t = await ensureEventForKind(seriesId, kindKey, neededSlots);
    if (!t) return { created: 0, errors: ['สร้างประเภทการแข่งขันไม่สำเร็จ'] };
    const fresh = await dbGetTournamentById(t.id);
    const cfg = getTournamentConfig(fresh);
    const isDoubles = getTournamentMatchType(fresh) === '2v2';
    const planCfg = JSON.parse(JSON.stringify(cfg));
    const plan = [];
    const errors = [];

    if (isDoubles) {
      for (const pair of confirmedPairIds) {
        const slot = nextEmptyPairSlot(planCfg);
        if (!slot) { errors.push(`ที่นั่งไม่พอสำหรับคู่ (${pair[0]} + ${pair[1]})`); continue; }
        plan.push({ group: slot.group, slotIdx: slot.slotIdx, subIdx: 0, playerId: pair[0] });
        plan.push({ group: slot.group, slotIdx: slot.slotIdx, subIdx: 1, playerId: pair[1] });
        planCfg.slots[slot.group][slot.slotIdx] = [pair[0], pair[1]];
      }
    } else {
      for (const pid of confirmedSingleIds) {
        const slot = nextEmptySlot(planCfg, false);
        if (!slot) { errors.push(`ที่นั่งไม่พอสำหรับผู้เล่น #${pid}`); continue; }
        plan.push({ ...slot, playerId: pid });
        planCfg.slots[slot.group][slot.slotIdx] = pid;
      }
    }

    let created = 0;
    for (const p of plan) {
      try {
        await AdminV2.api.registerEntrant(t.id, p.group, p.slotIdx, p.subIdx, p.playerId, 'นำเข้าโดย AI Import');
        created++;
      } catch (e) { errors.push(`ผู้เล่น #${p.playerId}: ${e.message}`); }
    }
    return { created, errors };
  }

  async function confirmAIImport(container, seriesId, rowsState) {
    let totalCreated = 0;
    const allErrors = [];
    for (const ev of rowsState) {
      const confirmedSingleIds = ev.singles.filter(r => !r.skip && r.chosenId).map(r => r.chosenId);
      const confirmedPairIds = ev.pairs.filter(([a, b]) => b && !a.skip && !b.skip && a.chosenId && b.chosenId).map(([a, b]) => [a.chosenId, b.chosenId]);
      const { created, errors } = await importEventEntrants(seriesId, ev.kind, confirmedSingleIds, confirmedPairIds);
      totalCreated += created;
      allErrors.push(...errors);
    }
    if (totalCreated) toast(`นำเข้าสำเร็จ ${totalCreated} รายการ ✅`, 'success');
    if (allErrors.length) toast(`มีข้อผิดพลาด ${allErrors.length} รายการ — ${allErrors[0]}`, 'error');
    if (!totalCreated && !allErrors.length) toast('ไม่มีรายการที่ยืนยัน (ทุกแถวถูกข้ามหรือยังไม่ได้จับคู่)', 'info');
    renderList(container);
  }

  AdminV2.tournaments = {
    render(container) {
      loadAll(); // ensure db.players is fresh for name lookups
      renderList(container);
    },
  };

})();
