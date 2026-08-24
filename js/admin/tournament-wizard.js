// Admin V2 — Tournament creation wizard (js/admin/tournament-wizard.js)
//
// Replaces the pre-V2 journey where creating a Series saved only the series
// row and then sent the admin to a form that made ONE event at a time, with no
// competition mode, no advancement rule, no scoring preset, and number inputs
// that had a minimum but no maximum.
//
// Six steps. Steps 1-5 build a draft entirely client-side; step 5 publishes the
// whole thing through rpc_admin_create_series_with_events, which validates the
// complete payload before its first insert. A partial series - two of five
// events, or events with a half-filled doubles pair - is therefore not a state
// this screen can produce. Step 6 hands off to the operations dashboard.
//
// Validation is TournamentValidation (js/tournament/validation.js), the same
// rules the server enforces, so errors appear beside the field instead of
// arriving as a failed request.
window.AdminV2 = window.AdminV2 || {};

(function () {
  'use strict';

  var V = window.TournamentValidation;
  var Svc = window.TournamentService;
  var Draw = window.TournamentDraw;
  var Scoring = window.TournamentScoring;

  var DRAFT_KEY = 'av2_tournament_wizard_draft';

  var STEPS = [
    { id: 1, label: 'ข้อมูลพื้นฐาน' },
    { id: 2, label: 'ประเภทการแข่งขัน' },
    { id: 3, label: 'ผู้เข้าแข่งขัน' },
    { id: 4, label: 'ตัวอย่างสาย' },
    { id: 5, label: 'ตรวจสอบและสร้าง' },
    { id: 6, label: 'ศูนย์ควบคุม' }
  ];

  var state = null;
  var host = null;
  var players = [];
  var playersById = {};
  var busy = false;

  // ── draft persistence ──────────────────────────────────────────────────────
  // The server draft is authoritative once created; this only protects an
  // unsaved wizard against an accidental reload.
  function saveDraft() {
    try {
      if (state && state.step < 6) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), state: state }));
      }
    } catch (e) { /* private mode, quota — a lost draft is not worth a crash */ }
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      // a draft older than a day is noise, not a rescue
      if (!d || !d.state || (Date.now() - d.at) > 86400000) return null;
      return d;
    } catch (e) { return null; }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  function blankState() {
    return {
      step: 1,
      series: {
        name: '', description: '', purpose: 'championship',
        event_date: '', starts_at: '', ends_at: '', location: '',
        court_count: 2, registration_deadline: '', organizer_contact: '',
        is_public: true
      },
      events: V.buildDefaultEvents('championship'),
      // entries[event_kind] = [{ player_ids:[...] }]
      entries: {},
      created: null
    };
  }

  // ── small helpers ──────────────────────────────────────────────────────────
  function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

  function enabledEvents() {
    return state.events.filter(function (e) { return e.enabled !== false; });
  }

  function entriesFor(kind) { return state.entries[kind] || []; }

  function entryCount(kind) { return entriesFor(kind).length; }

  function capacityFor(ev) {
    if (ev.structure === 'knockout_only') return ev.capacity || 32;
    return (ev.group_count || 0) * (ev.teams_per_group || 0);
  }

  function playerName(id) {
    var p = playersById[id];
    return p ? (p.nickname || p.name) : ('#' + id);
  }

  function announce(msg) {
    var el = document.getElementById('avwStatus');
    if (el) el.textContent = msg;
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  function render() {
    if (!host) return;
    var stepper = STEPS.map(function (s) {
      var cls = s.id === state.step ? 'avw-step avw-step-current'
        : (s.id < state.step ? 'avw-step avw-step-done' : 'avw-step');
      return '<li class="' + cls + '" aria-current="' + (s.id === state.step ? 'step' : 'false') + '">' +
        '<span class="avw-step-no">' + (s.id < state.step ? '✓' : s.id) + '</span>' +
        '<span class="avw-step-label">' + esc(s.label) + '</span></li>';
    }).join('');

    var body = '';
    if (state.step === 1) body = renderStep1();
    else if (state.step === 2) body = renderStep2();
    else if (state.step === 3) body = renderStep3();
    else if (state.step === 4) body = renderStep4();
    else if (state.step === 5) body = renderStep5();
    else body = renderStep6();

    host.innerHTML =
      '<div class="avw">' +
        '<div class="avw-head">' +
          '<button type="button" class="btn btn-ghost btn-sm avw-back-to-list" id="avwExit">← กลับไปรายการแข่งขัน</button>' +
          '<h2 class="avw-title">สร้างรายการแข่งขัน</h2>' +
        '</div>' +
        '<ol class="avw-stepper">' + stepper + '</ol>' +
        '<div class="avw-status" id="avwStatus" role="status" aria-live="polite"></div>' +
        '<div class="avw-body">' + body + '</div>' +
        renderActionBar() +
      '</div>';

    wire();
  }

  function renderActionBar() {
    if (state.step === 6) {
      return '<div class="avw-actions">' +
        '<button type="button" class="btn btn-primary" id="avwFinish">เสร็จสิ้น</button></div>';
    }
    var nextLabel = state.step === 5 ? '🚀 สร้างรายการแข่งขัน' : 'ถัดไป →';
    return '<div class="avw-actions">' +
      (state.step > 1
        ? '<button type="button" class="btn btn-ghost" id="avwPrev">← ย้อนกลับ</button>'
        : '<span></span>') +
      '<button type="button" class="btn btn-primary" id="avwNext">' + nextLabel + '</button>' +
      '</div>';
  }

  // ── step 1: basics ─────────────────────────────────────────────────────────
  function renderStep1() {
    var s = state.series;
    return '' +
      '<div class="avw-card">' +
        '<div class="avw-field">' +
          '<label for="avwName">ชื่อรายการแข่งขัน <span class="avw-req">*</span></label>' +
          '<input class="inp" id="avwName" value="' + esc(s.name) + '" ' +
            'placeholder="เช่น ศึกชิงแชมป์ประจำปี 2569" autocomplete="off">' +
          '<div class="avw-err" id="avwNameErr"></div>' +
        '</div>' +
        '<div class="avw-field">' +
          '<label for="avwDesc">รายละเอียด</label>' +
          '<textarea class="inp" id="avwDesc" rows="2">' + esc(s.description) + '</textarea>' +
        '</div>' +
        '<fieldset class="avw-field avw-fieldset">' +
          '<legend>รูปแบบรายการ <span class="avw-req">*</span></legend>' +
          '<div class="avw-radio-row">' +
            purposeOption('championship', '🏆 แข่งขันชิงแชมป์',
              'หาแชมป์ รองแชมป์ และอันดับ 3') +
            purposeOption('selection', '🎯 โหมดคัดตัว',
              'คัดผู้เล่นตามจำนวนที่กำหนด พร้อมรายชื่อสำรอง') +
          '</div>' +
        '</fieldset>' +
        '<div class="avw-grid2">' +
          '<div class="avw-field"><label for="avwDate">วันที่แข่ง</label>' +
            '<input class="inp" type="date" id="avwDate" value="' + esc(s.event_date) + '"></div>' +
          '<div class="avw-field"><label for="avwVenue">สถานที่</label>' +
            '<input class="inp" id="avwVenue" value="' + esc(s.location) + '" placeholder="เช่น ยิมเนเซียม A"></div>' +
          '<div class="avw-field"><label for="avwCourts">จำนวนคอร์ต</label>' +
            '<input class="inp" type="number" id="avwCourts" min="1" max="64" value="' + (s.court_count || 1) + '"></div>' +
          '<div class="avw-field"><label for="avwDeadline">ปิดรับสมัคร</label>' +
            '<input class="inp" type="datetime-local" id="avwDeadline" value="' + esc(s.registration_deadline) + '"></div>' +
        '</div>' +
        '<div class="avw-field"><label for="avwContact">ผู้จัด / ติดต่อ</label>' +
          '<input class="inp" id="avwContact" value="' + esc(s.organizer_contact) + '"></div>' +
        '<div class="avw-check"><input type="checkbox" id="avwPublic"' +
          (s.is_public ? ' checked' : '') + '>' +
          '<label for="avwPublic">เปิดให้ทุกคนเห็นรายการนี้</label></div>' +
      '</div>';
  }

  // Same sibling-plus-for pattern as the enable switches: a radio nested inside
  // its own label loses its change event to the label's re-dispatch.
  function purposeOption(id, label, hint) {
    var on = state.series.purpose === id;
    return '<div class="avw-radio' + (on ? ' avw-radio-on' : '') + '">' +
      '<input type="radio" id="avwPurpose_' + id + '" name="avwPurpose" value="' + id + '"' +
        (on ? ' checked' : '') + ' aria-describedby="avwPurposeHint_' + id + '">' +
      '<label class="avw-radio-label" for="avwPurpose_' + id + '">' + esc(label) + '</label>' +
      '<span class="avw-radio-hint" id="avwPurposeHint_' + id + '">' + esc(hint) + '</span></div>';
  }

  // ── step 2: the five-event matrix, all on one screen ───────────────────────
  function renderStep2() {
    var isSelection = state.series.purpose === 'selection';
    var rows = state.events.map(function (ev, i) { return eventRow(ev, i, isSelection); }).join('');

    return '' +
      '<div class="avw-card">' +
        '<p class="avw-hint">ทุกประเภทเปิดใช้งานไว้ให้แล้ว ปิดประเภทที่ไม่ต้องการได้ ' +
          'และตั้งค่าแต่ละประเภทแยกจากกันได้อิสระ</p>' +
        '<div class="avw-bulk">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avwApplyAll">' +
            'ใช้การตั้งค่าของประเภทแรกกับทุกประเภทที่เปิด</button>' +
          '<span class="avw-hint-inline">ขนาดทีมถูกกำหนดตามประเภท จะไม่ถูกคัดลอก</span>' +
        '</div>' +
        '<div class="avw-matrix">' + rows + '</div>' +
      '</div>';
  }

  function eventRow(ev, idx, isSelection) {
    var on = ev.enabled !== false;
    var r = V.validateEvent(ev, state.series.purpose);
    var hasGroups = ev.structure === 'groups_knockout' || ev.structure === 'groups_only';
    var errFor = function (field) {
      var e = r.errors.filter(function (x) { return x.field === field; })[0];
      return e ? '<div class="avw-err">' + esc(thaiFor(e.code)) + '</div>' : '';
    };

    return '' +
      '<div class="avw-row' + (on ? '' : ' avw-row-off') + (r.ok ? '' : ' avw-row-bad') + '" data-idx="' + idx + '">' +
        '<div class="avw-row-head">' +
          // The input is a SIBLING of its label, associated by for/id. Nesting a
          // checkbox inside its own <label> makes the label re-dispatch the
          // activation to the input: the box toggles visually but the change
          // event is swallowed, so the screen ends up lying about the state.
          '<div class="avw-switch">' +
            '<input type="checkbox" id="avwEn' + idx + '" data-ev="enabled" data-idx="' + idx + '"' +
              (on ? ' checked' : '') + '>' +
            '<label for="avwEn' + idx + '" class="avw-row-title">' + esc(ev.event_label) + '</label>' +
          '</div>' +
          '<span class="avw-badge">' + (ev.team_size === 2 ? 'ทีมละ 2 คน' : 'เดี่ยว') + '</span>' +
          (r.ok ? '' : '<span class="avw-badge avw-badge-bad">ตั้งค่าไม่ถูกต้อง</span>') +
        '</div>' +
        (on ? '<div class="avw-row-body">' +
          '<div class="avw-field"><label for="avwStruct' + idx + '">รูปแบบ</label>' +
            '<select class="inp" id="avwStruct' + idx + '" data-ev="structure" data-idx="' + idx + '">' +
              Object.keys(V.STRUCTURES).map(function (k) {
                return '<option value="' + k + '"' + (ev.structure === k ? ' selected' : '') + '>' +
                  esc(V.STRUCTURES[k]) + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="avw-field"><label for="avwPreset' + idx + '">โครงสร้าง</label>' +
            '<select class="inp" id="avwPreset' + idx + '" data-ev="preset" data-idx="' + idx + '"' +
              (hasGroups ? '' : ' disabled') + '>' +
              Object.keys(V.PRESETS).map(function (k) {
                return '<option value="' + k + '"' + (ev.preset === k ? ' selected' : '') + '>' +
                  esc(V.PRESETS[k].label) + '</option>';
              }).join('') +
            '</select></div>' +
          (hasGroups ? '' +
            '<div class="avw-field"><label for="avwG' + idx + '">จำนวนกลุ่ม (1-8)</label>' +
              '<input class="inp" type="number" min="1" max="8" id="avwG' + idx + '" ' +
                'data-ev="group_count" data-idx="' + idx + '" value="' + (ev.group_count || '') + '"' +
                (ev.preset !== 'custom' ? ' readonly' : '') + '>' + errFor('group_count') + '</div>' +
            '<div class="avw-field"><label for="avwT' + idx + '">ทีมต่อกลุ่ม (2-8)</label>' +
              '<input class="inp" type="number" min="2" max="8" id="avwT' + idx + '" ' +
                'data-ev="teams_per_group" data-idx="' + idx + '" value="' + (ev.teams_per_group || '') + '"' +
                (ev.preset !== 'custom' ? ' readonly' : '') + '>' + errFor('teams_per_group') + '</div>' +
            '<div class="avw-field"><label for="avwA' + idx + '">ผ่านเข้ารอบ/กลุ่ม</label>' +
              '<input class="inp" type="number" min="1" max="8" id="avwA' + idx + '" ' +
                'data-ev="advance_per_group" data-idx="' + idx + '" value="' + (ev.advance_per_group || '') + '">' +
              errFor('advance_per_group') + '</div>'
            : '<div class="avw-field"><label for="avwCap' + idx + '">จำนวนทีมสูงสุด</label>' +
              '<input class="inp" type="number" min="2" max="32" id="avwCap' + idx + '" ' +
                'data-ev="capacity" data-idx="' + idx + '" value="' + (ev.capacity || 8) + '"></div>') +
          '<div class="avw-field"><label for="avwSc' + idx + '">การนับคะแนน</label>' +
            '<select class="inp" id="avwSc' + idx + '" data-ev="scoring_preset" data-idx="' + idx + '">' +
              ['bwf_standard', 'one_game_21'].map(function (k) {
                return '<option value="' + k + '"' + (ev.scoring_preset === k ? ' selected' : '') + '>' +
                  esc(Scoring.PRESET_LABELS[k]) + '</option>';
              }).join('') +
            '</select></div>' +
          (isSelection ? '' +
            '<div class="avw-field"><label for="avwSel' + idx + '">คัดเลือก (ทีม)</label>' +
              '<input class="inp" type="number" min="1" id="avwSel' + idx + '" ' +
                'data-ev="selected_count" data-idx="' + idx + '" value="' + (ev.selected_count || 1) + '">' +
              errFor('selected_count') + '</div>' +
            '<div class="avw-field"><label for="avwRes' + idx + '">สำรอง (ทีม)</label>' +
              '<input class="inp" type="number" min="0" id="avwRes' + idx + '" ' +
                'data-ev="reserve_count" data-idx="' + idx + '" value="' + (ev.reserve_count || 0) + '"></div>'
            : '') +
          '<div class="avw-row-summary">รับ ' + capacityFor(ev) + ' ทีม' +
            (hasGroups ? ' · ' + Draw.expectedMatchCount(ev.group_count, ev.teams_per_group) +
              ' แมตช์รอบแบ่งกลุ่ม' : '') +
            (ev.structure === 'groups_knockout'
              ? ' · ผ่านเข้ารอบ ' + (ev.group_count * ev.advance_per_group) + ' ทีม' : '') +
          '</div>' +
          (r.warnings.length
            ? '<div class="avw-warn">⚠ ' + r.warnings.map(function (w) { return esc(thaiFor(w.code)); }).join(' · ') + '</div>'
            : '') +
        '</div>' : '') +
      '</div>';
  }

  // Warnings are wizard-local copy; server errors come from TournamentErrors.
  var WARN_TEXT = {
    WARN_XD_GENDER_UNVERIFIED: 'คู่ผสม: ระบบไม่มีข้อมูลเพศของผู้เล่น ผู้ดูแลต้องตรวจสอบคู่เอง',
    WARN_SELECTION_EXCEEDS_FIELD: 'จำนวนที่คัดเลือกมากกว่าจำนวนทีมทั้งหมด'
  };

  function thaiFor(code) {
    if (WARN_TEXT[code]) return WARN_TEXT[code];
    return window.TournamentErrors ? window.TournamentErrors.toThai({ message: code }) : code;
  }

  // ── step 3: participants per event ─────────────────────────────────────────
  function renderStep3() {
    var evs = enabledEvents();
    if (!evs.length) return '<div class="avw-card">ยังไม่ได้เปิดประเภทการแข่งขัน</div>';

    return '<div class="avw-card">' +
      '<p class="avw-hint">เพิ่มผู้เข้าแข่งขันตอนนี้ หรือข้ามไปก่อนแล้วค่อยเพิ่มทีหลังก็ได้ ' +
        'ประเภทคู่ต้องเลือกผู้เล่น 2 คนเป็นหนึ่งทีม</p>' +
      evs.map(function (ev) { return participantBlock(ev); }).join('') +
      '</div>';
  }

  function participantBlock(ev) {
    var list = entriesFor(ev.event_kind);
    var cap = capacityFor(ev);
    var used = {};
    list.forEach(function (e) { e.player_ids.forEach(function (id) { used[id] = true; }); });

    var options = players
      .filter(function (p) { return !used[p.id]; })
      .map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.nickname || p.name) +
          (p.class_label ? ' (' + esc(p.class_label) + ')' : '') + '</option>';
      }).join('');

    var cards = list.map(function (e, i) {
      return '<li class="avw-team">' +
        '<span class="avw-team-names">' +
          e.player_ids.map(function (id) { return esc(playerName(id)); }).join(' / ') +
        '</span>' +
        '<button type="button" class="btn btn-ghost btn-sm avw-team-del" ' +
          'data-kind="' + ev.event_kind + '" data-i="' + i + '" ' +
          'aria-label="ลบทีม ' + esc(e.player_ids.map(playerName).join(' / ')) + '">✕</button>' +
        '</li>';
    }).join('');

    var full = list.length >= cap;

    return '<section class="avw-part">' +
      '<h3 class="avw-part-title">' + esc(ev.event_label) +
        '<span class="avw-count' + (full ? ' avw-count-full' : '') + '">' +
          list.length + ' / ' + cap + ' ทีม</span></h3>' +
      (full ? '<div class="avw-warn">ครบตามจำนวนที่รับแล้ว</div>' :
        '<div class="avw-add">' +
          '<label class="avw-sr" for="avwP1' + ev.event_kind + '">ผู้เล่นคนที่ 1</label>' +
          '<select class="inp" id="avwP1' + ev.event_kind + '"><option value="">— เลือกผู้เล่น —</option>' + options + '</select>' +
          (ev.team_size === 2
            ? '<label class="avw-sr" for="avwP2' + ev.event_kind + '">ผู้เล่นคนที่ 2</label>' +
              '<select class="inp" id="avwP2' + ev.event_kind + '"><option value="">— เลือกคู่ —</option>' + options + '</select>'
            : '') +
          '<button type="button" class="btn btn-primary btn-sm avw-add-btn" data-kind="' + ev.event_kind + '">เพิ่มทีม</button>' +
        '</div>') +
      '<div class="avw-err" id="avwPartErr' + ev.event_kind + '"></div>' +
      (list.length ? '<ul class="avw-teams">' + cards + '</ul>'
        : '<div class="avw-empty-inline">ยังไม่มีผู้เข้าแข่งขัน</div>') +
      '</section>';
  }

  // ── step 4: draw preview ───────────────────────────────────────────────────
  function renderStep4() {
    var evs = enabledEvents();
    return '<div class="avw-card">' +
      '<p class="avw-hint">นี่คือตัวอย่างการแบ่งกลุ่มจากรายชื่อปัจจุบัน ' +
        'การจับสลากจริงจะทำหลังสร้างรายการ และต้องกดเผยแพร่ก่อนผู้เล่นจึงจะเห็น</p>' +
      evs.map(function (ev) { return drawPreview(ev); }).join('') +
      '</div>';
  }

  function drawPreview(ev) {
    var list = entriesFor(ev.event_kind);
    var hasGroups = ev.structure === 'groups_knockout' || ev.structure === 'groups_only';

    if (!list.length) {
      return '<section class="avw-part"><h3 class="avw-part-title">' + esc(ev.event_label) + '</h3>' +
        '<div class="avw-empty-inline">ยังไม่มีผู้เข้าแข่งขัน — จับสลากได้หลังเพิ่มรายชื่อ</div></section>';
    }

    var labels = list.map(function (e) { return e.player_ids.map(playerName).join(' / '); });

    if (!hasGroups) {
      var size = Draw.bracketSize(list.length);
      var byes = Draw.byeCount(list.length);
      return '<section class="avw-part"><h3 class="avw-part-title">' + esc(ev.event_label) + '</h3>' +
        '<div class="avw-row-summary">น็อกเอาต์โดยตรง · ' + list.length + ' ทีม · สาย ' + size +
          ' · บาย ' + byes + ' ทีม · ' + (size - 1) + ' แมตช์</div>' +
        '<ul class="avw-teams">' + labels.map(function (n) {
          return '<li class="avw-team"><span class="avw-team-names">' + esc(n) + '</span></li>';
        }).join('') + '</ul></section>';
    }

    var groups = Draw.assignGroups(
      list.map(function (_, i) { return i; }), ev.group_count, { method: 'seeded' });

    return '<section class="avw-part"><h3 class="avw-part-title">' + esc(ev.event_label) + '</h3>' +
      '<div class="avw-row-summary">' + ev.group_count + ' กลุ่ม · ' +
        Draw.expectedMatchCount(ev.group_count, Math.ceil(list.length / ev.group_count)) +
        ' แมตช์โดยประมาณ</div>' +
      '<div class="avw-groups">' + groups.map(function (g) {
        return '<div class="avw-group"><div class="avw-group-letter">กลุ่ม ' + g.letter + '</div>' +
          '<ol class="avw-group-list">' + g.entries.map(function (e) {
            return '<li>' + esc(labels[e.entry_id]) + '</li>';
          }).join('') + '</ol></div>';
      }).join('') + '</div></section>';
  }

  // ── step 5: review and publish ─────────────────────────────────────────────
  function renderStep5() {
    var v = V.validateSeries(state.series, state.events);
    var evs = enabledEvents();

    var blocking = [];
    if (!v.ok) {
      v.errors.forEach(function (e) {
        blocking.push(e.event_kind ? (labelOf(e.event_kind) + ': ' + thaiFor(e.code)) : thaiFor(e.code));
      });
    }

    var info = [];
    v.warnings.forEach(function (w) {
      info.push(labelOf(w.event_kind) + ': ' + thaiFor(w.code));
    });
    evs.forEach(function (ev) {
      var n = entryCount(ev.event_kind);
      var cap = capacityFor(ev);
      if (n === 0) info.push(labelOf(ev.event_kind) + ': ยังไม่มีผู้เข้าแข่งขัน (เพิ่มภายหลังได้)');
      else if (n < cap) info.push(labelOf(ev.event_kind) + ': รายชื่อยังไม่เต็ม (' + n + '/' + cap + ')');
      if (n > cap) blocking.push(labelOf(ev.event_kind) + ': ผู้เข้าแข่งขันเกินจำนวนที่รับ (' + n + '/' + cap + ')');
    });

    var totalMatches = evs.reduce(function (sum, ev) {
      var n = entryCount(ev.event_kind);
      if (!n) return sum;
      if (ev.structure === 'knockout_only') return sum + (Draw.bracketSize(n) - 1);
      return sum + Draw.expectedMatchCount(ev.group_count, Math.ceil(n / ev.group_count));
    }, 0);

    state._blocking = blocking;

    return '<div class="avw-card">' +
      '<h3 class="avw-part-title">' + esc(state.series.name || '(ยังไม่ได้ตั้งชื่อ)') + '</h3>' +
      '<div class="avw-review-meta">' +
        '<div><span>รูปแบบ</span><strong>' +
          (state.series.purpose === 'selection' ? 'โหมดคัดตัว' : 'แข่งขันชิงแชมป์') + '</strong></div>' +
        '<div><span>วันที่</span><strong>' + esc(state.series.event_date || '—') + '</strong></div>' +
        '<div><span>สถานที่</span><strong>' + esc(state.series.location || '—') + '</strong></div>' +
        '<div><span>คอร์ต</span><strong>' + (state.series.court_count || '—') + '</strong></div>' +
        '<div><span>การมองเห็น</span><strong>' +
          (state.series.is_public ? 'สาธารณะ' : 'ส่วนตัว') + '</strong></div>' +
        '<div><span>แมตช์โดยประมาณ</span><strong>' + totalMatches + '</strong></div>' +
      '</div>' +

      '<table class="av2-table avw-review-table"><thead><tr>' +
        '<th>ประเภท</th><th>รูปแบบ</th><th>โครงสร้าง</th><th>ผู้เข้าแข่งขัน</th><th>คะแนน</th>' +
      '</tr></thead><tbody>' +
      state.events.map(function (ev) {
        if (ev.enabled === false) {
          return '<tr class="avw-tr-off"><td>' + esc(ev.event_label) + '</td>' +
            '<td colspan="4">ปิดใช้งาน</td></tr>';
        }
        var hasGroups = ev.structure === 'groups_knockout' || ev.structure === 'groups_only';
        return '<tr><td>' + esc(ev.event_label) + '</td>' +
          '<td>' + esc(V.STRUCTURES[ev.structure]) + '</td>' +
          '<td>' + (hasGroups ? ev.group_count + '×' + ev.teams_per_group +
            ' (ผ่าน ' + ev.advance_per_group + ')' : 'สูงสุด ' + (ev.capacity || 8)) + '</td>' +
          '<td>' + entryCount(ev.event_kind) + ' / ' + capacityFor(ev) + '</td>' +
          '<td>' + esc(Scoring.PRESET_LABELS[ev.scoring_preset] || ev.scoring_preset) + '</td></tr>';
      }).join('') +
      '</tbody></table>' +

      (blocking.length
        ? '<div class="avw-block"><strong>ต้องแก้ไขก่อนสร้าง</strong><ul>' +
          blocking.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>'
        : '<div class="avw-ok">✓ ตรวจสอบผ่าน พร้อมสร้างรายการแข่งขัน</div>') +

      (info.length
        ? '<div class="avw-warn"><strong>ข้อสังเกต (ไม่บล็อกการสร้าง)</strong><ul>' +
          info.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>'
        : '') +

      '<p class="avw-hint">รายการและทุกประเภทจะถูกสร้างพร้อมกันในครั้งเดียว ' +
        'ถ้ามีอะไรผิดพลาด จะไม่มีรายการค้างครึ่ง ๆ กลาง ๆ เกิดขึ้น</p>' +
      '</div>';
  }

  function labelOf(kind) {
    var e = state.events.filter(function (x) { return x.event_kind === kind; })[0];
    return e ? e.event_label : kind;
  }

  // ── step 6: created ────────────────────────────────────────────────────────
  function renderStep6() {
    var c = state.created || {};
    return '<div class="avw-card avw-done">' +
      '<div class="avw-done-icon">🎉</div>' +
      '<h3>สร้างรายการแข่งขันเรียบร้อย</h3>' +
      '<p class="avw-hint">สร้าง ' + ((c.events || []).length) + ' ประเภท พร้อมกันในทรานแซกชันเดียว</p>' +
      '<ul class="avw-teams">' + (c.events || []).map(function (e) {
        return '<li class="avw-team"><span class="avw-team-names">' + esc(labelOf(e.event_kind)) +
          '</span><span class="avw-count">' + (e.entries || 0) + ' ทีม</span></li>';
      }).join('') + '</ul>' +
      '<p class="avw-hint">ขั้นต่อไป: ยืนยันรายชื่อ จับสลาก แล้วเผยแพร่สายในหน้าจัดการรายการ</p>' +
      '</div>';
  }

  // ── wiring ─────────────────────────────────────────────────────────────────
  function wire() {
    var byId = function (id) { return document.getElementById(id); };

    var exit = byId('avwExit');
    if (exit) exit.onclick = function () { confirmExit(); };

    var prev = byId('avwPrev');
    if (prev) prev.onclick = function () { goTo(state.step - 1); };

    var next = byId('avwNext');
    if (next) next.onclick = function () { onNext(next); };

    var finish = byId('avwFinish');
    if (finish) finish.onclick = function () {
      clearDraft();
      AdminV2.go('tournaments');
    };

    if (state.step === 1) wireStep1();
    if (state.step === 2) wireStep2();
    if (state.step === 3) wireStep3();
  }

  function wireStep1() {
    var map = {
      avwName: 'name', avwDesc: 'description', avwDate: 'event_date',
      avwVenue: 'location', avwCourts: 'court_count',
      avwDeadline: 'registration_deadline', avwContact: 'organizer_contact'
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.oninput = function () {
        state.series[map[id]] = id === 'avwCourts' ? (parseInt(el.value, 10) || 0) : el.value;
        if (id === 'avwName') {
          var err = document.getElementById('avwNameErr');
          if (err) err.textContent = el.value.trim() ? '' : 'กรุณาตั้งชื่อรายการแข่งขัน';
        }
        saveDraft();
      };
    });

    var pub = document.getElementById('avwPublic');
    if (pub) pub.onchange = function () { state.series.is_public = pub.checked; saveDraft(); };

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="avwPurpose"]'), function (r) {
        r.onchange = function () {
          state.series.purpose = r.value;
          // selection mode needs a selected_count on every event
          state.events = state.events.map(function (ev) {
            var n = Object.assign({}, ev);
            if (state.series.purpose === 'selection') {
              if (!(n.selected_count >= 1)) n.selected_count = 2;
              if (n.reserve_count == null) n.reserve_count = 1;
            }
            return n;
          });
          saveDraft();
          render();
        };
      });
  }

  function wireStep2() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ev]'), function (el) {
      var idx = parseInt(el.dataset.idx, 10);
      var field = el.dataset.ev;
      var handler = function () {
        var ev = state.events[idx];
        if (field === 'enabled') ev.enabled = el.checked;
        else if (field === 'preset') state.events[idx] = V.applyPreset(ev, el.value);
        else if (field === 'structure') ev.structure = el.value;
        else if (field === 'scoring_preset') ev.scoring_preset = el.value;
        else ev[field] = parseInt(el.value, 10);
        saveDraft();
        render();
      };
      if (el.tagName === 'SELECT' || el.type === 'checkbox') el.onchange = handler;
      else el.onchange = handler;   // number inputs: commit on blur, not per keystroke
    });

    var applyAll = document.getElementById('avwApplyAll');
    if (applyAll) applyAll.onclick = function () {
      var evs = enabledEvents();
      if (evs.length < 2) return;
      var src = evs[0];
      state.events = state.events.map(function (ev) {
        if (ev.enabled === false || ev.event_kind === src.event_kind) return ev;
        return Object.assign({}, ev, {
          structure: src.structure, preset: src.preset,
          group_count: src.group_count, teams_per_group: src.teams_per_group,
          advance_per_group: src.advance_per_group,
          scoring_preset: src.scoring_preset, capacity: src.capacity,
          selected_count: src.selected_count, reserve_count: src.reserve_count
          // team_size deliberately not copied: it belongs to the category
        });
      });
      saveDraft();
      render();
      announce('คัดลอกการตั้งค่าจาก ' + src.event_label + ' ไปยังทุกประเภทที่เปิดแล้ว');
    };
  }

  function wireStep3() {
    Array.prototype.forEach.call(document.querySelectorAll('.avw-add-btn'), function (btn) {
      btn.onclick = function () {
        var kind = btn.dataset.kind;
        var ev = state.events.filter(function (x) { return x.event_kind === kind; })[0];
        var err = document.getElementById('avwPartErr' + kind);
        var p1 = document.getElementById('avwP1' + kind);
        var p2 = document.getElementById('avwP2' + kind);

        var ids = [];
        if (p1 && p1.value) ids.push(parseInt(p1.value, 10));
        if (ev.team_size === 2 && p2 && p2.value) ids.push(parseInt(p2.value, 10));

        var check = V.validateEntry({ player_ids: ids }, ev.team_size);
        if (!check.ok) {
          if (err) err.textContent = check.code === 'ERR_DOUBLES_DUPLICATE_MEMBER'
            ? 'ผู้เล่นคนเดียวกันซ้ำในทีมเดียว'
            : (ev.team_size === 2 ? 'ประเภทคู่ต้องเลือกผู้เล่น 2 คน' : 'กรุณาเลือกผู้เล่น');
          return;
        }
        if (err) err.textContent = '';

        state.entries[kind] = entriesFor(kind).concat([{ player_ids: ids }]);
        saveDraft();
        render();
        announce('เพิ่มทีมใน ' + ev.event_label + ' แล้ว รวม ' + entryCount(kind) + ' ทีม');
      };
    });

    Array.prototype.forEach.call(document.querySelectorAll('.avw-team-del'), function (btn) {
      btn.onclick = function () {
        var kind = btn.dataset.kind;
        var i = parseInt(btn.dataset.i, 10);
        var list = entriesFor(kind).slice();
        list.splice(i, 1);
        state.entries[kind] = list;
        saveDraft();
        render();
        announce('ลบทีมแล้ว');
      };
    });
  }

  // ── navigation ─────────────────────────────────────────────────────────────
  function goTo(step) {
    state.step = Math.max(1, Math.min(6, step));
    saveDraft();
    render();
    if (host && host.scrollIntoView) host.scrollIntoView({ block: 'start' });
  }

  function onNext(btn) {
    if (busy) return;

    if (state.step === 1) {
      if (!state.series.name.trim()) {
        var err = document.getElementById('avwNameErr');
        if (err) err.textContent = 'กรุณาตั้งชื่อรายการแข่งขัน';
        var n = document.getElementById('avwName');
        if (n) n.focus();
        announce('กรุณาตั้งชื่อรายการแข่งขันก่อนไปขั้นถัดไป');
        return;
      }
      return goTo(2);
    }

    if (state.step === 2) {
      var v = V.validateSeries(state.series, state.events);
      if (!v.ok) {
        // render() rebuilds the status node, so the announcement has to come
        // after it or a screen reader never hears why the step did not advance
        render();
        announce('มีประเภทที่ตั้งค่าไม่ถูกต้อง กรุณาแก้ไขก่อนไปขั้นถัดไป');
        var bad = host.querySelector('.avw-row-bad');
        if (bad && bad.scrollIntoView) bad.scrollIntoView({ block: 'center' });
        return;
      }
      return goTo(3);
    }

    if (state.step === 3) return goTo(4);
    if (state.step === 4) return goTo(5);
    if (state.step === 5) return publish(btn);
  }

  async function publish(btn) {
    if (state._blocking && state._blocking.length) {
      announce('ยังมีข้อผิดพลาดที่ต้องแก้ไขก่อนสร้าง');
      return;
    }

    busy = true;
    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = 'กำลังสร้าง...';
    announce('กำลังสร้างรายการแข่งขัน');

    try {
      var payload = state.events.map(function (ev) {
        var out = {
          event_kind: ev.event_kind,
          event_label: ev.event_label,
          enabled: ev.enabled !== false,
          structure: ev.structure,
          scoring_preset: ev.scoring_preset,
          entries: entriesFor(ev.event_kind)
        };
        if (ev.structure === 'groups_knockout' || ev.structure === 'groups_only') {
          out.group_count = ev.group_count;
          out.teams_per_group = ev.teams_per_group;
          out.advance_per_group = ev.advance_per_group;
        } else {
          out.capacity = ev.capacity;
        }
        if (state.series.purpose === 'selection') {
          out.selected_count = ev.selected_count;
          out.reserve_count = ev.reserve_count;
        }
        return out;
      });

      var series = Object.assign({}, state.series);
      // empty datetime-local strings must not reach a timestamptz cast
      ['event_date', 'registration_deadline', 'starts_at', 'ends_at'].forEach(function (k) {
        if (!series[k]) delete series[k];
      });

      state.created = await Svc.createSeriesWithEvents(series, payload);
      clearDraft();
      goTo(6);
      announce('สร้างรายการแข่งขันเรียบร้อย');   // after goTo: it re-renders
    } catch (e) {
      btn.disabled = false;
      btn.textContent = original;
      var msg = (e && e.thai) || 'สร้างรายการไม่สำเร็จ';
      if (e && e.detail) msg += ' (' + e.detail + ')';
      announce(msg);
      if (window.toast) toast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  function confirmExit() {
    var dirty = state.step < 6 && (state.series.name.trim() || Object.keys(state.entries).length);
    if (!dirty) { clearDraft(); return AdminV2.go('tournaments'); }

    AdminV2.confirm({
      level: 'warn',
      title: 'ออกจากการสร้างรายการ?',
      body: 'ข้อมูลที่กรอกไว้จะถูกเก็บเป็นฉบับร่างในเครื่องนี้ และกู้คืนได้เมื่อกลับเข้ามาใหม่',
      confirmLabel: 'ออก',
      onConfirm: function () { AdminV2.go('tournaments'); }
    });
  }

  // ── entry point ────────────────────────────────────────────────────────────
  AdminV2.tournamentWizard = {
    async open(container, opts) {
      host = container;
      busy = false;
      AdminV2.state(host, 'loading', { message: 'กำลังเตรียมตัวช่วยสร้างรายการ...' });

      try {
        players = await AdminV2.api.listPlayersAll();
        players = players.filter(function (p) { return !p.deletedAt && !p.deleted_at; });
        playersById = {};
        players.forEach(function (p) { playersById[p.id] = p; });
      } catch (e) {
        players = []; playersById = {};
      }

      var draft = (opts && opts.fresh) ? null : loadDraft();
      if (draft) {
        state = draft.state;
        // a resumed draft must never land on the "created" screen
        if (state.step >= 6) state.step = 5;
        render();
        announce('กู้คืนฉบับร่างที่ค้างไว้แล้ว');
      } else {
        state = blankState();
        render();
      }
    },

    hasDraft() { return !!loadDraft(); },
    discardDraft() { clearDraft(); },

    // exposed for tests / debugging
    _state() { return state; }
  };
})();
