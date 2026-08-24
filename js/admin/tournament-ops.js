// Admin V2 — Tournament Operations Dashboard (js/admin/tournament-ops.js)
//
// Phase 5 of the wizard/draw/ops/referee/hub sequence. This is what an admin
// watches on the day of the competition: match queue, court assignment,
// standings, bracket, selection progress, corrections, and the public link.
//
// Match result entry here is intentionally minimal — a games-array form behind
// rpc_submit_match_result. The full Referee Center (large +1 targets, a match
// timer, undo-with-audit, walkover/retire/DQ flows) is js/admin/referee-v2.js,
// Phase 6. Anything typed here still goes through the exact same server
// validation (fn_v2_validate_games), so a quick correction here and a full
// session in the Referee Center can never disagree about what is a legal score.
window.AdminV2 = window.AdminV2 || {};

(function () {
  'use strict';

  var Svc = window.TournamentService;

  var host = null;
  var eventId = null;
  var ev = null;
  var entries = [];
  var entriesById = {};
  var groups = [];
  var matches = [];
  var standings = [];
  var courts = [];
  var selectionResults = [];
  var busy = false;

  function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

  function announce(msg) {
    var el = document.getElementById('avoStatus');
    if (el) el.textContent = msg;
  }

  function fail(e, fallback) {
    var msg = (e && e.thai) || fallback || 'ทำรายการไม่สำเร็จ';
    if (e && e.detail) msg += ' (' + e.detail + ')';
    if (window.toast) toast(msg, 'error');
    announce(msg);
  }

  async function withBusy(btn, fn) {
    if (busy) return;
    busy = true;
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังทำงาน...'; }
    try { await fn(); }
    catch (e) { fail(e); }
    finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  function entryName(id) {
    var e = entriesById[id];
    return e ? e.display_name : (id == null ? 'บาย' : '#' + id);
  }

  // ── load ───────────────────────────────────────────────────────────────────
  async function load() {
    AdminV2.state(host, 'loading', { message: 'กำลังโหลดศูนย์ควบคุม...' });
    try {
      ev = await Svc.getEvent(eventId);
      if (!ev) throw new Error('ไม่พบประเภทการแข่งขันนี้');

      var players = await AdminV2.api.listPlayersAll();
      var playersById = {};
      players.forEach(function (p) { playersById[p.id] = p; });

      var results = await Promise.all([
        Svc.listEntries(eventId, playersById),
        Svc.listGroups(eventId),
        Svc.listMatches(eventId),
        (ev.structure !== 'knockout_only') ? Svc.standings(eventId) : Promise.resolve([]),
        ev.series_id ? Svc.listCourts(ev.series_id) : Promise.resolve([]),
        ev.purpose === 'selection' ? Svc.listSelectionResults(eventId) : Promise.resolve([])
      ]);
      entries = results[0];
      entriesById = {};
      entries.forEach(function (e) { entriesById[e.id] = e; });
      groups = results[1];
      matches = results[2];
      standings = results[3];
      courts = results[4];
      selectionResults = results[5];

      render();
    } catch (e) {
      AdminV2.state(host, 'error', {
        message: (e && e.thai) || e.message, retry: function () { load(); }
      });
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function render() {
    var publicUrl = location.origin + location.pathname.replace(/[^/]*$/, '') +
      '#tournament/' + (ev.series_id || '') + '/' + ev.id;

    host.innerHTML =
      '<div class="avo">' +
        '<div class="avo-head">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avoBack">← กลับ</button>' +
          '<div>' +
            '<h2 class="avo-title">' + esc(ev.name || ev.event_label) + '</h2>' +
            '<div class="avo-sub">' +
              '<span class="avd-chip">' + esc(Svc.LIFECYCLE_LABELS[ev.lifecycle_status] || ev.lifecycle_status) + '</span>' +
              (ev.is_published ? '<span class="avd-chip avd-chip-ok">เผยแพร่แล้ว</span>'
                : '<span class="avd-chip avd-chip-warn">ยังไม่เผยแพร่</span>') +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="avoCopyLink">🔗 คัดลอกลิงก์สาธารณะ</button>' +
        '</div>' +
        '<div class="avo-status" id="avoStatus" role="status" aria-live="polite"></div>' +

        renderQueue() +
        (standings.length ? renderStandings() : '') +
        renderBracket() +
        (ev.purpose === 'selection' ? renderSelection() : '') +
      '</div>';

    wire(publicUrl);
  }

  // ── match queue ────────────────────────────────────────────────────────────
  var QUEUE_ORDER = { live: 0, ready: 1, pending: 2 };

  function renderQueue() {
    var queue = matches
      .filter(function (m) { return ['pending', 'ready', 'live'].indexOf(m.status) !== -1; })
      .sort(function (a, b) {
        var qa = QUEUE_ORDER[a.status], qb = QUEUE_ORDER[b.status];
        if (qa !== qb) return qa - qb;
        var ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
        var tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
        return ta - tb;
      });

    var courtOptions = courts.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.label || ('คอร์ต ' + c.court_no)) + '</option>';
    }).join('');

    return '<section class="avo-card">' +
      '<h3>คิวแมตช์ <span class="avo-count">' + queue.length + '</span></h3>' +
      (queue.length ? '<ul class="avo-queue">' + queue.map(function (m) {
        return queueRow(m, courtOptions);
      }).join('') + '</ul>' : '<div class="avd-empty">ไม่มีแมตช์ในคิว</div>') +
    '</section>';
  }

  function queueRow(m, courtOptions) {
    var stageLabel = m.stage === 'group' ? 'กลุ่ม ' + (m.group_letter || '') : (m.round_name || 'น็อกเอาต์');
    return '<li class="avo-qrow" data-match="' + m.id + '">' +
      '<div class="avo-qmain">' +
        '<span class="avd-chip avd-chip-sm">' + esc(stageLabel) + '</span>' +
        '<span class="avd-chip avd-chip-sm">' + esc(Svc.MATCH_STATUS_LABELS[m.status] || m.status) + '</span>' +
        '<span class="avo-qnames">' + esc(entryName(m.entry_a_id)) + ' vs ' + esc(entryName(m.entry_b_id)) + '</span>' +
      '</div>' +
      '<div class="avo-qactions">' +
        '<label class="avo-sr" for="avoCourt' + m.id + '">คอร์ต</label>' +
        '<select class="inp avo-court" id="avoCourt' + m.id + '" data-match="' + m.id + '">' +
          '<option value="">— ไม่ระบุคอร์ต —</option>' + courtOptions +
        '</select>' +
        (m.entry_a_id && m.entry_b_id
          ? '<button type="button" class="btn btn-primary btn-sm avo-record" data-match="' + m.id + '">บันทึกผล</button>'
          : '<span class="avo-waiting">รอผู้เข้าแข่งขัน</span>') +
      '</div>' +
    '</li>';
  }

  // ── standings ──────────────────────────────────────────────────────────────
  function renderStandings() {
    var byGroup = {};
    standings.forEach(function (s) {
      (byGroup[s.group_letter] = byGroup[s.group_letter] || []).push(s);
    });

    return '<section class="avo-card">' +
      '<h3>ตารางคะแนน</h3>' +
      '<div class="avo-standings">' + Object.keys(byGroup).sort().map(function (letter) {
        var rows = byGroup[letter];
        return '<div class="avo-sgroup">' +
          '<div class="avd-group-head">กลุ่ม ' + letter + '</div>' +
          '<table class="av2-table avo-stable"><thead><tr>' +
            '<th>#</th><th>ทีม</th><th>W-L</th><th>เกม</th><th>แต้ม</th>' +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr class="' + (r.qualifies ? 'avo-qualifies' : '') + '">' +
              '<td>' + r.rank + (r.is_tied ? ' *' : '') + '</td>' +
              '<td>' + esc(entryName(r.entry_id)) + '</td>' +
              '<td>' + r.wins + '-' + r.losses + '</td>' +
              '<td>' + (r.game_diff > 0 ? '+' : '') + r.game_diff + '</td>' +
              '<td>' + (r.point_diff > 0 ? '+' : '') + r.point_diff + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
      }).join('') + '</div>' +
      (standings.some(function (s) { return s.is_tied; })
        ? '<p class="avo-hint">* คะแนนเท่ากันสนิท — ต้องให้ผู้ดูแลตัดสินใจ (เพลย์ออฟ หรือระบุด้วยตนเอง)</p>' : '') +
    '</section>';
  }

  // ── bracket (simple round list; the full visual bracket is Phase 7) ────────
  function renderBracket() {
    var ko = matches.filter(function (m) { return m.stage === 'knockout'; });
    if (!ko.length) return '';

    var byRound = {};
    ko.forEach(function (m) { (byRound[m.round_index] = byRound[m.round_index] || []).push(m); });
    var rounds = Object.keys(byRound).map(Number).sort(function (a, b) { return a - b; });

    return '<section class="avo-card">' +
      '<h3>สายการแข่งขัน</h3>' +
      '<div class="avo-bracket">' + rounds.map(function (r) {
        var ms = byRound[r].sort(function (a, b) { return a.match_no - b.match_no; });
        return '<div class="avo-round">' +
          '<div class="avd-group-head">' + esc(ms[0].round_name || ('รอบ ' + r)) + '</div>' +
          ms.map(function (m) { return bracketMatch(m); }).join('') +
        '</div>';
      }).join('') + '</div>' +
    '</section>';
  }

  function bracketMatch(m) {
    var wonA = m.winner_entry_id != null && m.winner_entry_id === m.entry_a_id;
    var wonB = m.winner_entry_id != null && m.winner_entry_id === m.entry_b_id;
    return '<div class="avo-bmatch">' +
      '<div class="avo-bside' + (wonA ? ' avo-bwin' : '') + '">' + esc(entryName(m.entry_a_id)) +
        (m.seed_a ? ' <span class="avo-bseed">(' + m.seed_a + ')</span>' : '') + '</div>' +
      '<div class="avo-bside' + (wonB ? ' avo-bwin' : '') + '">' + esc(entryName(m.entry_b_id)) +
        (m.seed_b ? ' <span class="avo-bseed">(' + m.seed_b + ')</span>' : '') + '</div>' +
      '<div class="avo-bstatus">' + esc(Svc.MATCH_STATUS_LABELS[m.status] || m.status) +
        (m.status === 'completed'
          ? ' <button type="button" class="btn btn-ghost btn-sm avo-correct" data-match="' + m.id +
            '" aria-label="แก้ไขผล ' + esc(entryName(m.entry_a_id)) + ' vs ' + esc(entryName(m.entry_b_id)) + '">แก้ไขผล</button>'
          : '') +
      '</div>' +
    '</div>';
  }

  // ── selection progress ────────────────────────────────────────────────────
  function renderSelection() {
    var done = ev.lifecycle_status === 'selection_completed';
    var eligible = ['group_stage', 'knockout', 'published'].indexOf(ev.lifecycle_status) !== -1;
    var active = entries.filter(function (e) { return e.status === 'registered'; });
    var byEntry = {};
    selectionResults.forEach(function (r) { byEntry[r.entry_id] = r; });

    var RESULT_LABEL = {
      selected: 'ผ่านการคัดเลือก', reserve: 'สำรอง',
      not_selected: 'ไม่ผ่าน', withdrawn: 'ถอนตัว'
    };

    return '<section class="avo-card">' +
      '<h3>ผลการคัดตัว <span class="avo-count">เป้าหมาย ' + (ev.selected_count || '—') +
        ' คน · สำรอง ' + (ev.reserve_count || 0) + '</span></h3>' +
      (done
        ? '<ul class="avd-list">' + active.map(function (e) {
            var r = byEntry[e.id];
            return '<li class="avd-item"><div class="avd-item-main">' +
              '<div class="avd-item-name">' + esc(e.display_name) + '</div>' +
              '<div class="avd-item-meta"><span class="avd-chip avd-chip-sm">' +
                esc(r ? RESULT_LABEL[r.result] : '—') + '</span></div></div></li>';
          }).join('') + '</ul>'
        : eligible
          ? '<p class="avo-hint">ยังไม่ประกาศผล — เลือกผลของแต่ละทีมแล้วกดประกาศผล</p>' +
            '<div class="avo-selection-form">' +
              active.map(function (e) { return selectionRow(e); }).join('') +
            '</div>' +
            '<div class="avw-field"><label for="avoSelReason">เหตุผล / เกณฑ์การคัดเลือก (จำเป็น)</label>' +
              '<input class="inp" id="avoSelReason" placeholder="เช่น อันดับคะแนนรอบแบ่งกลุ่ม"></div>' +
            '<div class="avd-err" id="avoSelErr"></div>' +
            '<button type="button" class="btn btn-primary btn-sm" id="avoFinalizeSelection">ประกาศผลคัดตัว</button>'
          : '<p class="avo-hint">ต้องเริ่มรอบแบ่งกลุ่มหรือรอบน็อกเอาต์ก่อนจึงจะประกาศผลได้</p>') +
    '</section>';
  }

  function selectionRow(e) {
    return '<div class="avo-selrow" data-entry="' + e.id + '">' +
      '<span class="avo-selname">' + esc(e.display_name) + '</span>' +
      '<label class="avo-sr" for="avoSel' + e.id + '">ผลของ ' + esc(e.display_name) + '</label>' +
      '<select class="inp avo-selresult" id="avoSel' + e.id + '" data-entry="' + e.id + '">' +
        '<option value="not_selected">ไม่ผ่าน</option>' +
        '<option value="selected">ผ่านการคัดเลือก</option>' +
        '<option value="reserve">สำรอง</option>' +
        '<option value="withdrawn">ถอนตัว</option>' +
      '</select>' +
    '</div>';
  }

  // ── wiring ─────────────────────────────────────────────────────────────────
  function wire(publicUrl) {
    var back = document.getElementById('avoBack');
    if (back) back.onclick = function () { AdminV2.go('tournaments'); };

    var copy = document.getElementById('avoCopyLink');
    if (copy) copy.onclick = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(publicUrl).then(function () {
          announce('คัดลอกลิงก์แล้ว');
        }).catch(function () { announce(publicUrl); });
      } else {
        announce(publicUrl);
      }
    };

    host.querySelectorAll('.avo-court').forEach(function (sel) {
      sel.onchange = function () {
        withBusy(null, async function () {
          await Svc.assignCourt(Number(sel.dataset.match), sel.value ? Number(sel.value) : null, null);
          announce('อัปเดตคอร์ตแล้ว');
        });
      };
    });

    host.querySelectorAll('.avo-record').forEach(function (btn) {
      btn.onclick = function () { openRecordResult(Number(btn.dataset.match)); };
    });
    host.querySelectorAll('.avo-correct').forEach(function (btn) {
      btn.onclick = function () { openCorrectResult(Number(btn.dataset.match)); };
    });

    var fin = document.getElementById('avoFinalizeSelection');
    if (fin) fin.onclick = function () { finalizeSelection(fin); };
  }

  // ── quick result entry (placeholder for the Phase 6 Referee Center) ───────
  function openRecordResult(matchId) {
    var m = matches.filter(function (x) { return x.id === matchId; })[0];
    if (!m) return;
    var cfg = Svc.scoringConfigFor(ev);

    AdminV2.drawer({
      title: 'บันทึกผลแมตช์',
      body:
        '<p class="avd-hint">' + esc(entryName(m.entry_a_id)) + ' vs ' + esc(entryName(m.entry_b_id)) +
          ' · เล่น ' + cfg.max_games + ' เกม ชนะ ' + cfg.games_to_win + ' เกม · ' +
          cfg.points_to_win + ' แต้ม เพดาน ' + cfg.cap + '</p>' +
        gamesFormHTML(cfg) +
        '<div class="avd-err" id="avoResultErr"></div>',
      actions: '<button type="button" class="btn btn-ghost btn-sm" id="avoResultCancel">ยกเลิก</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="avoResultOk">บันทึกผล</button>',
      onMount: function () {
        document.getElementById('avoResultCancel').onclick = AdminV2.closeDrawer;
        var ok = document.getElementById('avoResultOk');
        ok.onclick = async function () {
          var games = readGamesForm(cfg);
          if (!games) {
            document.getElementById('avoResultErr').textContent = 'กรุณากรอกคะแนนให้ครบ';
            return;
          }
          await withBusy(ok, async function () {
            var res = await Svc.submitResult(matchId, games);
            AdminV2.closeDrawer();
            await load();
            announce('บันทึกผลแล้ว' + (res.advanced_to ? ' — เข้ารอบถัดไปแล้ว' : ''));
          });
        };
      }
    });
  }

  function openCorrectResult(matchId) {
    var m = matches.filter(function (x) { return x.id === matchId; })[0];
    if (!m) return;
    var cfg = Svc.scoringConfigFor(ev);

    AdminV2.drawer({
      title: 'แก้ไขผลแมตช์',
      body:
        '<p class="avd-hint">' + esc(entryName(m.entry_a_id)) + ' vs ' + esc(entryName(m.entry_b_id)) + '</p>' +
        gamesFormHTML(cfg) +
        '<div class="avw-field"><label for="avoCorrectReason">เหตุผล (จำเป็น)</label>' +
          '<input class="inp" id="avoCorrectReason" placeholder="เช่น กรรมการบันทึกสลับฝั่ง"></div>' +
        '<div class="avd-err" id="avoCorrectErr"></div>',
      actions: '<button type="button" class="btn btn-ghost btn-sm" id="avoCorrectCancel">ยกเลิก</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="avoCorrectOk">บันทึกการแก้ไข</button>',
      onMount: function () {
        document.getElementById('avoCorrectCancel').onclick = AdminV2.closeDrawer;
        var ok = document.getElementById('avoCorrectOk');
        ok.onclick = async function () {
          var reason = (document.getElementById('avoCorrectReason').value || '').trim();
          var games = readGamesForm(cfg);
          if (!reason || !games) {
            document.getElementById('avoCorrectErr').textContent =
              !reason ? 'กรุณาระบุเหตุผล' : 'กรุณากรอกคะแนนให้ครบ';
            return;
          }
          await withBusy(ok, async function () {
            await Svc.correctResult(matchId, games, reason);
            AdminV2.closeDrawer();
            await load();
            announce('แก้ไขผลแล้ว');
          });
        };
      }
    });
  }

  function gamesFormHTML(cfg) {
    var rows = '';
    for (var i = 1; i <= cfg.max_games; i++) {
      rows += '<div class="avo-gamerow">' +
        '<span class="avo-gamelabel">เกม ' + i + '</span>' +
        '<label class="avo-sr" for="avoGA' + i + '">คะแนนฝั่ง A เกม ' + i + '</label>' +
        '<input class="inp" type="number" min="0" id="avoGA' + i + '" data-game="' + i + '" data-side="a">' +
        '<span>-</span>' +
        '<label class="avo-sr" for="avoGB' + i + '">คะแนนฝั่ง B เกม ' + i + '</label>' +
        '<input class="inp" type="number" min="0" id="avoGB' + i + '" data-game="' + i + '" data-side="b">' +
      '</div>';
    }
    return '<div class="avo-games">' + rows + '</div>';
  }

  function readGamesForm(cfg) {
    var games = [];
    for (var i = 1; i <= cfg.max_games; i++) {
      var a = document.getElementById('avoGA' + i);
      var b = document.getElementById('avoGB' + i);
      var av = a && a.value !== '' ? Number(a.value) : null;
      var bv = b && b.value !== '' ? Number(b.value) : null;
      if (av == null && bv == null) break;   // stop at the first unfilled game
      if (av == null || bv == null) return null;
      games.push({ score_a: av, score_b: bv });
    }
    return games.length ? games : null;
  }

  async function finalizeSelection(btn) {
    var reason = (document.getElementById('avoSelReason').value || '').trim();
    var err = document.getElementById('avoSelErr');
    if (!reason) { err.textContent = 'กรุณาระบุเหตุผล'; return; }

    var results = Array.prototype.map.call(
      document.querySelectorAll('.avo-selresult'), function (sel) {
        return { entry_id: Number(sel.dataset.entry), result: sel.value };
      });

    var selectedCount = results.filter(function (r) { return r.result === 'selected'; }).length;
    if (ev.selected_count != null && selectedCount !== ev.selected_count) {
      err.textContent = 'เลือกไว้ ' + selectedCount + ' คน แต่รายการนี้ตั้งไว้ ' + ev.selected_count + ' คน';
      return;
    }
    err.textContent = '';

    AdminV2.confirm({
      level: 'warn',
      title: 'ยืนยันการประกาศผลคัดตัว?',
      body: 'ผลจะเผยแพร่ให้ผู้เล่นเห็นทันที และแก้ไขไม่ได้อีก',
      confirmLabel: 'ประกาศผล',
      onConfirm: function () {
        withBusy(btn, async function () {
          var res = await Svc.finalizeSelection(eventId, results, reason, ev.lock_version);
          await load();
          announce('ประกาศผลคัดตัวแล้ว — ผ่านการคัดเลือก ' + res.selected + ' คน สำรอง ' + res.reserve + ' คน');
        });
      }
    });
  }

  // ── entry point ────────────────────────────────────────────────────────────
  AdminV2.tournamentOps = {
    open(container, id) {
      host = container;
      eventId = Number(id);
      busy = false;
      return load();
    }
  };
})();
