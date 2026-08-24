// Admin V2 — Roster and Draw Studio (js/admin/tournament-draw.js)
//
// The post-creation half of the tournament journey: manage an event's roster,
// then draw the groups and publish them.
//
// Two rules this screen exists to enforce, both of which the pre-V2 flow could
// not:
//   * An entry is a TEAM. A doubles pair renders as one card carrying two
//     players, and an incomplete pair blocks the event from reaching
//     roster_ready rather than quietly producing a broken entrant later.
//   * A draw is a DRAFT until it is published. The client proposes an
//     assignment (TournamentDraw, pure and unit-tested); rpc_admin_assign_groups
//     re-validates it server-side and stores it as a new version, and nothing
//     is public until rpc_admin_publish_draw runs.
//
// Every drag has a keyboard-accessible equivalent: each team card carries a
// "move to group" select, so the draw is completable without a pointer.
window.AdminV2 = window.AdminV2 || {};

(function () {
  'use strict';

  var Svc = window.TournamentService;
  var Draw = window.TournamentDraw;
  var V = window.TournamentValidation;

  var host = null;
  var eventId = null;
  var ev = null;          // the tournaments row
  var entries = [];       // shaped entries
  var groups = [];        // tournament_groups + embedded group entries
  var players = [];
  var playersById = {};
  var assignment = null;  // { A: [entryId,...], B: [...] , unassigned: [...] }
  var history = [];       // undo stack of assignments
  var future = [];        // redo stack
  var drawSeed = null;
  var drawMethod = 'random';
  var busy = false;

  function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

  function announce(msg) {
    var el = document.getElementById('avdStatus');
    if (el) el.textContent = msg;
  }

  function fail(e, fallback) {
    var msg = (e && e.thai) || fallback || 'ทำรายการไม่สำเร็จ';
    if (e && e.detail) msg += ' (' + e.detail + ')';
    if (window.toast) toast(msg, 'error');
    announce(msg);
  }

  function groupLetters() {
    return groups.map(function (g) { return g.letter; });
  }

  function activeEntries() {
    return entries.filter(function (e) { return e.status === 'registered'; });
  }

  // ── load ───────────────────────────────────────────────────────────────────
  async function load() {
    AdminV2.state(host, 'loading', { message: 'กำลังโหลดข้อมูลรายการ...' });
    try {
      if (!players.length) {
        players = await AdminV2.api.listPlayersAll();
        players = players.filter(function (p) { return !p.deletedAt && !p.deleted_at; });
        playersById = {};
        players.forEach(function (p) { playersById[p.id] = p; });
      }
      ev = await Svc.getEvent(eventId);
      if (!ev) throw new Error('ไม่พบประเภทการแข่งขันนี้');
      entries = await Svc.listEntries(eventId, playersById);
      groups = await Svc.listGroups(eventId);
      buildAssignmentFromServer();
      render();
    } catch (e) {
      AdminV2.state(host, 'error', {
        message: (e && e.thai) || e.message, retry: function () { load(); }
      });
    }
  }

  function buildAssignmentFromServer() {
    assignment = { unassigned: [] };
    groupLetters().forEach(function (l) { assignment[l] = []; });

    var placed = {};
    groups.forEach(function (g) {
      (g.tournament_group_entries || [])
        .slice()
        .sort(function (a, b) { return a.slot - b.slot; })
        .forEach(function (ge) {
          if (!assignment[g.letter]) assignment[g.letter] = [];
          assignment[g.letter].push(ge.entry_id);
          placed[ge.entry_id] = true;
        });
    });
    activeEntries().forEach(function (e) {
      if (!placed[e.id]) assignment.unassigned.push(e.id);
    });
    history = [];
    future = [];
  }

  function snapshot() {
    history.push(JSON.stringify(assignment));
    if (history.length > 30) history.shift();
    future = [];
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function render() {
    var locked = ['group_stage', 'knockout', 'completed', 'selection_completed', 'cancelled']
      .indexOf(ev.lifecycle_status) !== -1;
    var hasGroupStage = ev.structure === 'groups_knockout' || ev.structure === 'groups_only';

    host.innerHTML =
      '<div class="avd">' +
        '<div class="avd-head">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avdBack">← กลับ</button>' +
          '<div>' +
            '<h2 class="avd-title">' + esc(ev.name || ev.event_label || 'ประเภทการแข่งขัน') + '</h2>' +
            '<div class="avd-sub">' +
              '<span class="avd-chip">' + esc(Svc.LIFECYCLE_LABELS[ev.lifecycle_status] || ev.lifecycle_status) + '</span>' +
              '<span class="avd-chip">' + esc(V.STRUCTURES[ev.structure] || ev.structure) + '</span>' +
              (hasGroupStage
                ? '<span class="avd-chip">' + ev.group_count + '×' + ev.teams_per_group +
                  ' · ผ่าน ' + ev.advance_per_group + '</span>' : '') +
              '<span class="avd-chip">' + (ev.team_size === 2 ? 'ทีมละ 2 คน' : 'เดี่ยว') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="avd-status" id="avdStatus" role="status" aria-live="polite"></div>' +
        renderNextAction(locked) +
        renderRoster(locked) +
        (hasGroupStage ? renderDraw(locked) : '') +
      '</div>';

    wire(locked, hasGroupStage);
  }

  function renderNextAction(locked) {
    var next = Svc.nextAdminAction(ev);
    if (!next) return '';
    var hint = {
      roster_ready: 'ตรวจรายชื่อให้ครบทุกทีมก่อน แล้วล็อกรายชื่อเพื่อเริ่มจับสลาก',
      draw: 'จัดทีมลงกลุ่มแล้วบันทึกเป็นร่าง',
      publish: 'เผยแพร่สายให้ผู้เล่นเห็น',
      start: 'สร้างตารางแข่งรอบแบ่งกลุ่ม',
      knockout: 'รอบแบ่งกลุ่มครบแล้ว สร้างสายน็อกเอาต์จากผู้ผ่านเข้ารอบ'
    }[next.to] || '';

    return '<div class="avd-next">' +
      '<div><strong>ขั้นต่อไป:</strong> ' + esc(next.label) +
        (hint ? '<div class="avd-next-hint">' + esc(hint) + '</div>' : '') + '</div>' +
      '<button type="button" class="btn btn-primary btn-sm" id="avdNextAction" data-to="' +
        next.to + '">' + esc(next.label) + '</button></div>';
  }

  // ── roster ─────────────────────────────────────────────────────────────────
  function renderRoster(locked) {
    var active = activeEntries();
    var inactive = entries.filter(function (e) { return e.status !== 'registered'; });
    var cap = ev.max_participants ||
      ((ev.group_count || 0) * (ev.teams_per_group || 0)) || null;
    var incomplete = active.filter(function (e) { return !e.complete; });

    var used = {};
    active.forEach(function (e) {
      e.members.forEach(function (m) { used[m.player_id] = true; });
    });
    var options = players.filter(function (p) { return !used[p.id]; })
      .map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.nickname || p.name) +
          (p.class_label ? ' (' + esc(p.class_label) + ')' : '') + '</option>';
      }).join('');

    return '<section class="avd-card">' +
      '<div class="avd-card-head">' +
        '<h3>ผู้เข้าแข่งขัน <span class="avd-count">' + active.length +
          (cap ? ' / ' + cap : '') + ' ทีม</span></h3>' +
        '<div class="avd-card-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avdExportCsv">ส่งออก CSV</button>' +
          (locked ? '' : '<button type="button" class="btn btn-ghost btn-sm" id="avdImportCsv">นำเข้า CSV</button>') +
        '</div>' +
      '</div>' +

      (incomplete.length
        ? '<div class="avd-warn">มี ' + incomplete.length + ' ทีมที่ยังไม่ครบผู้เล่น — ' +
          'ต้องแก้ให้ครบก่อนล็อกรายชื่อ</div>'
        : '') +

      (locked ? '' :
        '<div class="avd-add">' +
          '<label class="avd-sr" for="avdP1">ผู้เล่นคนที่ 1</label>' +
          '<select class="inp" id="avdP1"><option value="">— เลือกผู้เล่น —</option>' + options + '</select>' +
          (ev.team_size === 2
            ? '<label class="avd-sr" for="avdP2">ผู้เล่นคนที่ 2</label>' +
              '<select class="inp" id="avdP2"><option value="">— เลือกคู่ —</option>' + options + '</select>'
            : '') +
          '<button type="button" class="btn btn-primary btn-sm" id="avdAddEntry">เพิ่มทีม</button>' +
        '</div>' +
        '<div class="avd-err" id="avdAddErr"></div>') +

      (active.length
        ? '<ul class="avd-list">' + active.map(function (e) { return entryCard(e, locked); }).join('') + '</ul>'
        : '<div class="avd-empty">ยังไม่มีผู้เข้าแข่งขัน</div>') +

      (inactive.length
        ? '<details class="avd-inactive"><summary>ถอนตัว / ปรับแพ้ (' + inactive.length + ')</summary>' +
          '<ul class="avd-list">' + inactive.map(function (e) { return entryCard(e, locked); }).join('') + '</ul>' +
          '</details>'
        : '') +
    '</section>';
  }

  // A doubles pair is ONE card listing both players — never a row per player.
  function entryCard(e, locked) {
    var STATUS = {
      registered: 'ลงแข่ง', waitlisted: 'สำรอง',
      withdrawn: 'ถอนตัว', disqualified: 'ปรับแพ้'
    };
    return '<li class="avd-item' + (e.complete ? '' : ' avd-item-bad') + '">' +
      '<div class="avd-item-main">' +
        '<div class="avd-item-name">' + esc(e.display_name) +
          (e.seed ? '<span class="avd-seed">มือวาง ' + e.seed + '</span>' : '') + '</div>' +
        '<div class="avd-item-meta">' +
          '<span class="avd-chip avd-chip-sm">' + esc(STATUS[e.status] || e.status) + '</span>' +
          (e.awaiting_partner ? '<span class="avd-chip avd-chip-sm avd-chip-warn">รอคู่ตอบรับ</span>' : '') +
          (e.complete ? '' : '<span class="avd-chip avd-chip-sm avd-chip-bad">ทีมไม่ครบ</span>') +
          '<span class="avd-item-players">' +
            e.members.map(function (m) { return esc(m.full_name); }).join(' + ') + '</span>' +
        '</div>' +
      '</div>' +
      (locked ? '' :
        '<div class="avd-item-actions">' +
          (e.status === 'registered'
            ? '<button type="button" class="btn btn-ghost btn-sm avd-sub" data-entry="' + e.id + '" ' +
                'aria-label="เปลี่ยนตัวใน ' + esc(e.display_name) + '">เปลี่ยนตัว</button>' +
              '<button type="button" class="btn btn-ghost btn-sm avd-withdraw" data-entry="' + e.id + '" ' +
                'aria-label="ถอน ' + esc(e.display_name) + '">ถอน</button>'
            : '<button type="button" class="btn btn-ghost btn-sm avd-restore" data-entry="' + e.id + '" ' +
                'aria-label="คืนสถานะ ' + esc(e.display_name) + '">คืนสถานะ</button>') +
        '</div>') +
    '</li>';
  }

  // ── draw ───────────────────────────────────────────────────────────────────
  function renderDraw(locked) {
    var letters = groupLetters();
    var canDraw = ['roster_ready', 'draw_ready'].indexOf(ev.lifecycle_status) !== -1;

    var cols = letters.map(function (l) {
      var ids = assignment[l] || [];
      var over = ids.length > ev.teams_per_group;
      return '<div class="avd-group' + (over ? ' avd-group-over' : '') + '" data-group="' + l + '">' +
        '<div class="avd-group-head">กลุ่ม ' + l +
          '<span class="avd-count">' + ids.length + '/' + ev.teams_per_group + '</span></div>' +
        '<ol class="avd-group-list" data-group="' + l + '">' +
          ids.map(function (id, i) { return slotCard(id, l, i, locked || !canDraw); }).join('') +
        '</ol></div>';
    }).join('');

    var un = assignment.unassigned || [];

    return '<section class="avd-card">' +
      '<div class="avd-card-head">' +
        '<h3>จับสลากกลุ่ม</h3>' +
        (canDraw && !locked ? '<div class="avd-card-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avdRandom">สุ่ม</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avdSeeded">จัดตามมือวาง</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avdClear">ล้าง</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avdUndo">เลิกทำ</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avdRedo">ทำซ้ำ</button>' +
        '</div>' : '') +
      '</div>' +

      (canDraw && !locked
        ? '<p class="avd-hint">ลากทีมเข้ากลุ่มได้ หรือใช้เมนู “ย้ายไป” บนการ์ดแต่ละทีม ' +
          'ซึ่งใช้งานด้วยคีย์บอร์ดได้เหมือนกัน · การจับสลากจะถูกบันทึกเป็นร่างจนกว่าจะกดเผยแพร่</p>'
        : '<p class="avd-hint">' +
          (locked ? 'การแข่งขันเริ่มแล้ว แก้สายไม่ได้' : 'ต้องล็อกรายชื่อก่อนจึงจะจับสลากได้') + '</p>') +

      '<div class="avd-draw">' +
        '<div class="avd-unassigned">' +
          '<div class="avd-group-head">ยังไม่จัดกลุ่ม<span class="avd-count">' + un.length + '</span></div>' +
          '<ol class="avd-group-list" data-group="unassigned">' +
            un.map(function (id, i) { return slotCard(id, 'unassigned', i, locked || !canDraw); }).join('') +
          '</ol>' +
        '</div>' +
        '<div class="avd-groups">' + cols + '</div>' +
      '</div>' +

      (canDraw && !locked
        ? '<div class="avd-draw-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" id="avdSaveDraw">บันทึกร่างการจับสลาก</button>' +
          (ev.lifecycle_status === 'draw_ready'
            ? '<button type="button" class="btn btn-primary btn-sm" id="avdPublish">เผยแพร่สาย</button>' : '') +
          '</div>'
        : '') +
    '</section>';
  }

  function slotCard(entryId, group, index, readonly) {
    var e = entries.filter(function (x) { return x.id === entryId; })[0];
    var name = e ? e.display_name : ('#' + entryId);
    var targets = ['unassigned'].concat(groupLetters());

    return '<li class="avd-slot" draggable="' + (readonly ? 'false' : 'true') + '" ' +
        'data-entry="' + entryId + '" data-from="' + group + '">' +
      '<span class="avd-slot-no">' + (group === 'unassigned' ? '•' : (index + 1)) + '</span>' +
      '<span class="avd-slot-name">' + esc(name) + '</span>' +
      (readonly ? '' :
        '<label class="avd-sr" for="avdMove' + entryId + '">ย้าย ' + esc(name) + ' ไปกลุ่ม</label>' +
        '<select class="avd-move" id="avdMove' + entryId + '" data-entry="' + entryId + '">' +
          targets.map(function (t) {
            return '<option value="' + t + '"' + (t === group ? ' selected' : '') + '>' +
              (t === 'unassigned' ? 'ยังไม่จัดกลุ่ม' : 'กลุ่ม ' + t) + '</option>';
          }).join('') +
        '</select>') +
    '</li>';
  }

  // ── moves ──────────────────────────────────────────────────────────────────
  // Returns the message to announce rather than announcing itself: render()
  // rebuilds the aria-live node, so anything said before it is never heard.
  function moveEntry(entryId, toGroup) {
    Object.keys(assignment).forEach(function (k) {
      assignment[k] = assignment[k].filter(function (id) { return id !== entryId; });
    });
    if (!assignment[toGroup]) assignment[toGroup] = [];
    assignment[toGroup].push(entryId);

    var e = entries.filter(function (x) { return x.id === entryId; })[0];
    return (e ? e.display_name : 'ทีม') + ' ย้ายไป ' +
      (toGroup === 'unassigned' ? 'ยังไม่จัดกลุ่ม' : 'กลุ่ม ' + toGroup) + ' แล้ว';
  }

  function autoAssign(method) {
    snapshot();
    var pool = activeEntries().slice();
    if (method === 'seeded') {
      pool.sort(function (a, b) {
        var as = a.seed == null ? 9999 : a.seed;
        var bs = b.seed == null ? 9999 : b.seed;
        return as - bs || a.id - b.id;
      });
    }
    drawSeed = method === 'random' ? Math.floor(Math.random() * 2147483647) : 1;
    drawMethod = method;

    var built = Draw.assignGroups(pool.map(function (e) { return e.id; }),
      groups.length, { method: method, seed: drawSeed });

    assignment = { unassigned: [] };
    groupLetters().forEach(function (l) { assignment[l] = []; });
    built.forEach(function (g) {
      assignment[g.letter] = g.entries.map(function (x) { return x.entry_id; });
    });
    render();
    announce(method === 'random' ? 'สุ่มจับสลากแล้ว' : 'จัดกลุ่มตามมือวางแล้ว');
  }

  // ── wiring ─────────────────────────────────────────────────────────────────
  function wire(locked, hasGroupStage) {
    var byId = function (id) { return document.getElementById(id); };

    var back = byId('avdBack');
    if (back) back.onclick = function () { AdminV2.go('tournaments'); };

    var next = byId('avdNextAction');
    if (next) next.onclick = function () { doNextAction(next); };

    var add = byId('avdAddEntry');
    if (add) add.onclick = function () { addEntry(add); };

    var exp = byId('avdExportCsv');
    if (exp) exp.onclick = exportCsv;
    var imp = byId('avdImportCsv');
    if (imp) imp.onclick = importCsv;

    host.querySelectorAll('.avd-withdraw').forEach(function (b) {
      b.onclick = function () { changeEntryStatus(Number(b.dataset.entry), 'withdrawn'); };
    });
    host.querySelectorAll('.avd-restore').forEach(function (b) {
      b.onclick = function () { changeEntryStatus(Number(b.dataset.entry), 'registered'); };
    });
    host.querySelectorAll('.avd-sub').forEach(function (b) {
      b.onclick = function () { openSubstitute(Number(b.dataset.entry)); };
    });

    if (!hasGroupStage) return;

    var r = byId('avdRandom'); if (r) r.onclick = function () { autoAssign('random'); };
    var s = byId('avdSeeded'); if (s) s.onclick = function () { autoAssign('seeded'); };
    var c = byId('avdClear');
    if (c) c.onclick = function () {
      snapshot();
      var all = activeEntries().map(function (e) { return e.id; });
      assignment = { unassigned: all };
      groupLetters().forEach(function (l) { assignment[l] = []; });
      render();
      announce('ล้างการจัดกลุ่มแล้ว');
    };

    var u = byId('avdUndo');
    if (u) u.onclick = function () {
      if (!history.length) return announce('ไม่มีอะไรให้เลิกทำ');
      future.push(JSON.stringify(assignment));
      assignment = JSON.parse(history.pop());
      render();
      announce('เลิกทำแล้ว');
    };
    var rd = byId('avdRedo');
    if (rd) rd.onclick = function () {
      if (!future.length) return announce('ไม่มีอะไรให้ทำซ้ำ');
      history.push(JSON.stringify(assignment));
      assignment = JSON.parse(future.pop());
      render();
      announce('ทำซ้ำแล้ว');
    };

    // keyboard-accessible move — the required equivalent of dragging
    host.querySelectorAll('.avd-move').forEach(function (sel) {
      sel.onchange = function () {
        snapshot();
        var msg = moveEntry(Number(sel.dataset.entry), sel.value);
        render();
        announce(msg);
        // keep the keyboard user where they were after the list rebuilds
        var again = document.getElementById('avdMove' + sel.dataset.entry);
        if (again) again.focus();
      };
    });

    // pointer drag and drop
    host.querySelectorAll('.avd-slot[draggable="true"]').forEach(function (el) {
      el.ondragstart = function (e) {
        e.dataTransfer.setData('text/plain', el.dataset.entry);
        el.classList.add('avd-dragging');
      };
      el.ondragend = function () { el.classList.remove('avd-dragging'); };
    });
    host.querySelectorAll('.avd-group-list').forEach(function (list) {
      list.ondragover = function (e) { e.preventDefault(); list.classList.add('avd-drop'); };
      list.ondragleave = function () { list.classList.remove('avd-drop'); };
      list.ondrop = function (e) {
        e.preventDefault();
        list.classList.remove('avd-drop');
        var id = Number(e.dataTransfer.getData('text/plain'));
        if (!id) return;
        snapshot();
        var msg = moveEntry(id, list.dataset.group);
        render();
        announce(msg);
      };
    });

    var save = byId('avdSaveDraw');
    if (save) save.onclick = function () { saveDraw(save); };
    var pub = byId('avdPublish');
    if (pub) pub.onclick = function () { publishDraw(pub); };
  }

  // ── actions ────────────────────────────────────────────────────────────────
  async function doNextAction(btn) {
    var to = btn.dataset.to;
    if (to === 'draw') {
      var el = host.querySelector('.avd-draw');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      return announce('จัดทีมลงกลุ่มด้านล่าง แล้วกดบันทึกร่างการจับสลาก');
    }
    if (to === 'publish') return publishDraw(btn);

    var map = { roster_ready: 'roster_ready', start: 'group_stage' };
    if (to === 'knockout') return generateKnockout(btn);
    if (to === 'start') return startGroupStage(btn);

    await withBusy(btn, async function () {
      await Svc.setLifecycle(eventId, map[to], ev.lock_version, null);
      await load();
      announce('อัปเดตสถานะแล้ว');
    });
  }

  async function withBusy(btn, fn) {
    if (busy) return;
    busy = true;
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังทำงาน...'; }
    try {
      await fn();
    } catch (e) {
      fail(e);
      if (btn) { btn.disabled = false; btn.textContent = label; }
    } finally {
      busy = false;
    }
  }

  async function startGroupStage(btn) {
    await withBusy(btn, async function () {
      var res = await Svc.generateGroupMatches(eventId, 'grp-' + eventId + '-' + (ev.draw_seed || 0));
      await load();
      announce(res.replayed
        ? 'มีตารางแข่งอยู่แล้ว (' + res.existing + ' แมตช์)'
        : 'สร้างตารางรอบแบ่งกลุ่ม ' + res.created + ' แมตช์แล้ว');
    });
  }

  async function generateKnockout(btn) {
    await withBusy(btn, async function () {
      var res = await Svc.generateKnockout(eventId, 'ko-' + eventId + '-' + Date.now());
      await load();
      announce(res.auto_qualified_entry
        ? 'มีผู้ผ่านเข้ารอบเพียงทีมเดียว จึงผ่านเข้ารอบอัตโนมัติ'
        : 'สร้างสายน็อกเอาต์ ' + res.created + ' แมตช์จาก ' + res.entries + ' ทีมแล้ว');
    });
  }

  async function addEntry(btn) {
    var err = document.getElementById('avdAddErr');
    var p1 = document.getElementById('avdP1');
    var p2 = document.getElementById('avdP2');
    var ids = [];
    if (p1 && p1.value) ids.push(Number(p1.value));
    if (ev.team_size === 2 && p2 && p2.value) ids.push(Number(p2.value));

    var check = V.validateEntry({ player_ids: ids }, ev.team_size);
    if (!check.ok) {
      if (err) err.textContent = check.code === 'ERR_DOUBLES_DUPLICATE_MEMBER'
        ? 'ผู้เล่นคนเดียวกันซ้ำในทีมเดียว'
        : (ev.team_size === 2 ? 'ประเภทคู่ต้องเลือกผู้เล่น 2 คน' : 'กรุณาเลือกผู้เล่น');
      return;
    }
    if (err) err.textContent = '';

    await withBusy(btn, async function () {
      await Svc.importEntries(eventId, [{ player_ids: ids }], ev.lock_version, false);
      await load();
      announce('เพิ่มทีมแล้ว');
    });
  }

  function changeEntryStatus(entryId, status) {
    var e = entries.filter(function (x) { return x.id === entryId; })[0];
    AdminV2.drawer({
      title: status === 'withdrawn' ? 'ถอนทีมออกจากรายการ' : 'คืนสถานะทีม',
      body:
        '<p class="avd-hint">' + esc(e ? e.display_name : '') + '</p>' +
        '<div class="avw-field"><label for="avdReason">เหตุผล (จำเป็น)</label>' +
        '<input class="inp" id="avdReason" placeholder="เช่น ผู้เล่นบาดเจ็บ"></div>' +
        '<div class="avd-err" id="avdReasonErr"></div>',
      actions: '<button type="button" class="btn btn-ghost btn-sm" id="avdCancel">ยกเลิก</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="avdConfirm">ยืนยัน</button>',
      onMount: function () {
        document.getElementById('avdCancel').onclick = AdminV2.closeDrawer;
        var ok = document.getElementById('avdConfirm');
        ok.onclick = async function () {
          var reason = (document.getElementById('avdReason').value || '').trim();
          if (!reason) {
            document.getElementById('avdReasonErr').textContent = 'กรุณาระบุเหตุผล';
            return;
          }
          await withBusy(ok, async function () {
            await Svc.setEntryStatus(entryId, status, reason);
            AdminV2.closeDrawer();
            await load();
            announce(status === 'withdrawn' ? 'ถอนทีมแล้ว' : 'คืนสถานะทีมแล้ว');
          });
        };
      }
    });
  }

  function openSubstitute(entryId) {
    var e = entries.filter(function (x) { return x.id === entryId; })[0];
    if (!e) return;
    var inEvent = {};
    activeEntries().forEach(function (x) {
      x.members.forEach(function (m) { inEvent[m.player_id] = true; });
    });

    AdminV2.drawer({
      title: 'เปลี่ยนตัวผู้เล่น',
      body:
        '<p class="avd-hint">' + esc(e.display_name) + '</p>' +
        '<div class="avw-field"><label for="avdOut">ผู้เล่นที่ออก</label>' +
          '<select class="inp" id="avdOut">' + e.members.map(function (m) {
            return '<option value="' + m.player_id + '">' + esc(m.full_name) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="avw-field"><label for="avdIn">ผู้เล่นที่เข้า</label>' +
          '<select class="inp" id="avdIn">' + players.filter(function (p) { return !inEvent[p.id]; })
            .map(function (p) {
              return '<option value="' + p.id + '">' + esc(p.nickname || p.name) + '</option>';
            }).join('') + '</select></div>' +
        '<div class="avw-field"><label for="avdSubReason">เหตุผล (จำเป็น)</label>' +
          '<input class="inp" id="avdSubReason" placeholder="เช่น ผู้เล่นเดิมบาดเจ็บ"></div>' +
        '<div class="avd-err" id="avdSubErr"></div>',
      actions: '<button type="button" class="btn btn-ghost btn-sm" id="avdSubCancel">ยกเลิก</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="avdSubOk">เปลี่ยนตัว</button>',
      onMount: function () {
        document.getElementById('avdSubCancel').onclick = AdminV2.closeDrawer;
        var ok = document.getElementById('avdSubOk');
        ok.onclick = async function () {
          var reason = (document.getElementById('avdSubReason').value || '').trim();
          if (!reason) {
            document.getElementById('avdSubErr').textContent = 'กรุณาระบุเหตุผล';
            return;
          }
          await withBusy(ok, async function () {
            await Svc.substituteMember(entryId,
              Number(document.getElementById('avdOut').value),
              Number(document.getElementById('avdIn').value), reason);
            AdminV2.closeDrawer();
            await load();
            announce('เปลี่ยนตัวเรียบร้อย');
          });
        };
      }
    });
  }

  async function saveDraw(btn) {
    var payload = groupLetters().map(function (l) {
      return {
        letter: l,
        entries: (assignment[l] || []).map(function (id, i) {
          var e = entries.filter(function (x) { return x.id === id; })[0];
          return { entry_id: id, slot: i + 1, seed: e ? e.seed : null };
        })
      };
    });

    var placed = payload.reduce(function (n, g) { return n + g.entries.length; }, 0);
    if (placed < 2) return announce('ต้องจัดอย่างน้อย 2 ทีมลงกลุ่มก่อน');

    var over = payload.filter(function (g) { return g.entries.length > ev.teams_per_group; });
    if (over.length) {
      return announce('กลุ่ม ' + over.map(function (g) { return g.letter; }).join(', ') +
        ' มีทีมเกินจำนวนที่กำหนด');
    }

    await withBusy(btn, async function () {
      var res = await Svc.assignGroups(eventId, payload,
        drawSeed || Math.floor(Math.random() * 2147483647), ev.lock_version, drawMethod);
      await load();
      announce('บันทึกร่างการจับสลากแล้ว (เวอร์ชัน ' + res.draw_version +
        ') — ยังไม่เผยแพร่ให้ผู้เล่นเห็น');
    });
  }

  function publishDraw(btn) {
    AdminV2.confirm({
      level: 'confirm',
      title: 'เผยแพร่สายการแข่งขัน?',
      body: 'ผู้เล่นจะเห็นการแบ่งกลุ่มทันทีหลังเผยแพร่',
      confirmLabel: 'เผยแพร่',
      onConfirm: async function () {
        await withBusy(btn, async function () {
          var versions = await Svc.listDrawVersions(eventId);
          if (!versions.length) return announce('ยังไม่มีร่างการจับสลากให้เผยแพร่');
          await Svc.publishDraw(eventId, versions[0].version);
          await load();
          announce('เผยแพร่สายแล้ว');
        });
      }
    });
  }

  // ── CSV ────────────────────────────────────────────────────────────────────
  function exportCsv() {
    var rows = [['entry_id', 'status', 'seed', 'player_1', 'player_2']];
    entries.forEach(function (e) {
      rows.push([e.id, e.status, e.seed || '',
        (e.members[0] && e.members[0].full_name) || '',
        (e.members[1] && e.members[1].full_name) || '']);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');

    // BOM so Excel opens Thai names in the right encoding
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'roster-' + eventId + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    announce('ส่งออกรายชื่อเป็น CSV แล้ว');
  }

  function importCsv() {
    AdminV2.drawer({
      title: 'นำเข้ารายชื่อ',
      body:
        '<p class="avd-hint">วางรายชื่อ บรรทัดละหนึ่งทีม ' +
          (ev.team_size === 2 ? 'ใช้เครื่องหมายจุลภาคคั่นผู้เล่นสองคน' : '') + '</p>' +
        '<textarea class="inp" id="avdCsvText" rows="8" ' +
          'placeholder="' + (ev.team_size === 2 ? 'สมชาย, สมหญิง' : 'สมชาย') + '"></textarea>' +
        '<div class="avd-err" id="avdCsvErr"></div>' +
        '<div id="avdCsvPreview"></div>',
      actions: '<button type="button" class="btn btn-ghost btn-sm" id="avdCsvCancel">ยกเลิก</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="avdCsvOk">นำเข้า</button>',
      onMount: function () {
        document.getElementById('avdCsvCancel').onclick = AdminV2.closeDrawer;
        var ok = document.getElementById('avdCsvOk');
        ok.onclick = async function () {
          var text = document.getElementById('avdCsvText').value || '';
          var parsed = parseRosterLines(text);
          if (parsed.errors.length) {
            document.getElementById('avdCsvErr').innerHTML =
              parsed.errors.map(function (e) { return esc(e); }).join('<br>');
            return;
          }
          if (!parsed.entries.length) {
            document.getElementById('avdCsvErr').textContent = 'ไม่พบรายชื่อ';
            return;
          }
          await withBusy(ok, async function () {
            var res = await Svc.importEntries(eventId, parsed.entries, ev.lock_version, false);
            AdminV2.closeDrawer();
            await load();
            var msg = 'นำเข้า ' + res.inserted + ' ทีม';
            if (res.rejected && res.rejected.length) msg += ' · ข้าม ' + res.rejected.length + ' รายการ';
            announce(msg);
            if (window.toast) toast(msg, res.rejected && res.rejected.length ? 'info' : 'success');
          });
        };
      }
    });
  }

  // Names resolved against the club roster; anything ambiguous is reported
  // rather than guessed, matching the AI-import behaviour.
  function parseRosterLines(text) {
    var entriesOut = [], errors = [];
    var used = {};
    activeEntries().forEach(function (e) {
      e.members.forEach(function (m) { used[m.player_id] = true; });
    });

    text.split(/\r?\n/).forEach(function (line, i) {
      var raw = line.trim().replace(/^"|"$/g, '');
      if (!raw) return;
      var parts = raw.split(/[,;\t]/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length !== ev.team_size) {
        errors.push('บรรทัด ' + (i + 1) + ': ต้องมีผู้เล่น ' + ev.team_size + ' คน');
        return;
      }
      var ids = [];
      for (var j = 0; j < parts.length; j++) {
        var hit = players.filter(function (p) {
          return (p.name || '').toLowerCase() === parts[j].toLowerCase() ||
                 (p.nickname || '').toLowerCase() === parts[j].toLowerCase();
        });
        if (hit.length !== 1) {
          errors.push('บรรทัด ' + (i + 1) + ': ไม่พบผู้เล่นชื่อ "' + parts[j] + '" หรือมีชื่อซ้ำกัน');
          return;
        }
        if (used[hit[0].id]) {
          errors.push('บรรทัด ' + (i + 1) + ': ' + parts[j] + ' ลงประเภทนี้ไปแล้ว');
          return;
        }
        ids.push(hit[0].id);
        used[hit[0].id] = true;
      }
      if (ids.length === 2 && ids[0] === ids[1]) {
        errors.push('บรรทัด ' + (i + 1) + ': ผู้เล่นคนเดียวกันซ้ำในทีมเดียว');
        return;
      }
      entriesOut.push({ player_ids: ids });
    });

    return { entries: entriesOut, errors: errors };
  }

  // ── entry point ────────────────────────────────────────────────────────────
  AdminV2.tournamentDraw = {
    open(container, id) {
      host = container;
      eventId = Number(id);
      busy = false;
      return load();
    },
    _parseRosterLines: parseRosterLines
  };
})();
