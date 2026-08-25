// Admin V2 — Referee Center (js/admin/referee-v2.js)
//
// Live scoring for one V2 match: large +1 targets, undo with a visible point
// log, a match timer with pause/resume and an interruption reason, and
// walkover/retirement/disqualification paths. Everything typed here is
// validated by the exact same fn_v2_validate_games the ops dashboard's quick
// form and rpc_submit_match_result itself use, so a fast correction elsewhere
// and a full referee session can never disagree about what is a legal score.
//
// Scoring rules come from the EVENT's scoring_preset/scoring_config, never
// from tier — the pre-V2 app inferred best-of-3 from tier === 'Super 1000' in
// three separate places.
//
// Live points are held in memory only; nothing is sent to the server until a
// game (for the running score) or the whole match (for the final submission)
// is confirmed. A local draft of the point log survives an accidental reload
// (localStorage, keyed per match) and is cleared once the match is submitted.
window.AdminV2 = window.AdminV2 || {};

(function () {
  'use strict';

  var Svc = window.TournamentService;
  var Scoring = window.TournamentScoring;

  var host = null;
  var matchId = null;
  var ev = null;
  var cfg = null;
  var entryA = null;
  var entryB = null;
  var busy = false;

  // session state
  var S = null;

  function draftKey() { return 'av2_referee_draft_' + matchId; }

  function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

  function announce(msg) {
    var el = document.getElementById('arvStatus');
    if (el) el.textContent = msg;
  }

  function fail(e, fallback) {
    var msg = (e && e.thai) || fallback || 'ทำรายการไม่สำเร็จ';
    if (e && e.detail) msg += ' (' + e.detail + ')';
    if (window.toast) toast(msg, 'error');
    announce(msg);
  }

  function saveDraft() {
    try { localStorage.setItem(draftKey(), JSON.stringify(S)); } catch (e) {}
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(draftKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch (e) {}
  }

  function freshState() {
    return {
      games: [],              // completed games: {score_a, score_b}
      log: [],                // point-by-point events for the CURRENT game, for undo + audit
      a: 0, b: 0,              // current game running score
      startedAt: Date.now(),
      elapsedBeforePause: 0,   // ms accumulated across prior play segments
      paused: false,
      pausedAt: null,
      pauseReason: null,
      pauseLog: [],            // [{reason, from, to}]
      outcome: 'normal'
    };
  }

  // ── load ───────────────────────────────────────────────────────────────────
  async function load() {
    AdminV2.state(host, 'loading', { message: 'กำลังเตรียมห้องผู้ตัดสิน...' });
    try {
      var rows = await supaFetch('tournament_matches?id=eq.' + matchId + '&select=*');
      var match = rows[0];
      if (!match) throw new Error('ไม่พบแมตช์นี้');
      window.__avrMatch = match;

      ev = await Svc.getEvent(match.tournament_id);
      cfg = Svc.scoringConfigFor(ev);

      var players = await AdminV2.api.listPlayersAll();
      var playersById = {};
      players.forEach(function (p) { playersById[p.id] = p; });
      var entries = await Svc.listEntries(match.tournament_id, playersById);
      var byId = {};
      entries.forEach(function (e) { byId[e.id] = e; });
      entryA = byId[match.entry_a_id] || { display_name: entryName(match.player_a, players) };
      entryB = byId[match.entry_b_id] || { display_name: entryName(match.player_b, players) };

      window.__avrMatchLive = match;

      var draft = loadDraft();
      S = draft || freshState();
      render();
      if (draft) announce('กู้คืนสถานะการแข่งจากที่ค้างไว้แล้ว');
    } catch (e) {
      AdminV2.state(host, 'error', {
        message: (e && e.thai) || e.message, retry: function () { load(); }
      });
    }
  }

  function entryName(playerId, players) {
    var p = (players || []).filter(function (x) { return x.id === playerId; })[0];
    return p ? (p.nickname || p.name) : ('#' + playerId);
  }

  // ── timer ──────────────────────────────────────────────────────────────────
  var timerHandle = null;
  function elapsedMs() {
    if (S.paused) return S.elapsedBeforePause;
    return S.elapsedBeforePause + (Date.now() - S.startedAt);
  }
  function formatClock(ms) {
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60), s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function startTimerTick() {
    stopTimerTick();
    timerHandle = setInterval(function () {
      var el = document.getElementById('arvClock');
      if (el) el.textContent = formatClock(elapsedMs());
    }, 1000);
  }
  function stopTimerTick() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function render() {
    var over = Scoring.isGameOver(S.a, S.b, cfg);
    var gamesWonA = S.games.filter(function (g) { return g.score_a > g.score_b; }).length;
    var gamesWonB = S.games.length - gamesWonA;

    host.innerHTML =
      '<div class="arv">' +
        '<div class="arv-head">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="arvBack">← กลับ</button>' +
          '<div class="arv-timer">' +
            '<span id="arvClock" class="arv-clock">' + formatClock(elapsedMs()) + '</span>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="arvPauseToggle">' +
              (S.paused ? '▶ เล่นต่อ' : '⏸ พัก') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="arv-status" id="arvStatus" role="status" aria-live="polite"></div>' +

        '<div class="arv-scoreboard">' +
          '<div class="arv-side">' +
            '<div class="arv-name">' + esc(entryA ? entryA.display_name : '') + '</div>' +
            '<div class="arv-games">' + gamesWonA + ' เกม</div>' +
            '<div class="arv-score" aria-live="off">' + S.a + '</div>' +
            '<button type="button" class="arv-plus" id="arvPlusA" aria-label="เพิ่มแต้มฝั่ง ' +
              esc(entryA ? entryA.display_name : 'A') + '"' + (S.paused ? ' disabled' : '') + '>+1</button>' +
          '</div>' +
          '<div class="arv-mid">' +
            '<button type="button" class="btn btn-ghost btn-sm" id="arvUndo" ' +
              (S.log.length ? '' : 'disabled') + '>↩ เลิกแต้มล่าสุด</button>' +
            (over ? '<button type="button" class="btn btn-primary btn-sm" id="arvFinishGame">จบเกม</button>' : '') +
          '</div>' +
          '<div class="arv-side">' +
            '<div class="arv-name">' + esc(entryB ? entryB.display_name : '') + '</div>' +
            '<div class="arv-games">' + gamesWonB + ' เกม</div>' +
            '<div class="arv-score" aria-live="off">' + S.b + '</div>' +
            '<button type="button" class="arv-plus" id="arvPlusB" aria-label="เพิ่มแต้มฝั่ง ' +
              esc(entryB ? entryB.display_name : 'B') + '"' + (S.paused ? ' disabled' : '') + '>+1</button>' +
          '</div>' +
        '</div>' +

        (S.games.length
          ? '<div class="arv-gamehistory">' + S.games.map(function (g, i) {
              return '<span class="avd-chip avd-chip-sm">เกม ' + (i + 1) + ': ' + g.score_a + '-' + g.score_b + '</span>';
            }).join('') + '</div>' : '') +

        '<div class="arv-footer">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="arvIncident">🚩 วอล์กโอเวอร์ / ถอนตัว / ปรับแพ้</button>' +
          (S.games.length >= cfg.games_to_win || (gamesWonA >= cfg.games_to_win || gamesWonB >= cfg.games_to_win)
            ? '<button type="button" class="btn btn-primary" id="arvFinishMatch">✅ จบแมตช์ &amp; บันทึกผล</button>' : '') +
        '</div>' +

        '<div class="arv-log">' +
          '<details><summary>ประวัติแต้ม (' + S.log.length + ')</summary>' +
          '<ol class="arv-logitems">' + S.log.slice().reverse().map(function (e) {
            return '<li>' + esc(e.side === 'a' ? (entryA ? entryA.display_name : 'A') : (entryB ? entryB.display_name : 'B')) +
              ' +1 (' + e.a + '-' + e.b + ')' + '</li>';
          }).join('') + '</ol></details>' +
        '</div>' +
      '</div>';

    wire();
    startTimerTick();
  }

  // ── point actions ─────────────────────────────────────────────────────────
  function addPoint(side) {
    if (S.paused) return;
    if (Scoring.isGameOver(S.a, S.b, cfg)) return announce('เกมนี้จบแล้ว กด "จบเกม" ก่อนเริ่มเกมถัดไป');
    if (side === 'a') S.a++; else S.b++;
    S.log.push({ side: side, a: S.a, b: S.b, t: Date.now() });
    saveDraft();
    render();
  }

  function undoPoint() {
    var last = S.log.pop();
    if (!last) return;
    if (last.side === 'a') S.a--; else S.b--;
    saveDraft();
    render();
    announce('เลิกทำแต้มล่าสุดแล้ว');
  }

  function finishGame() {
    var code = Scoring.validateGame(S.a, S.b, cfg);
    if (code) return announce('คะแนนยังไม่จบเกมตามกติกา');
    S.games.push({ score_a: S.a, score_b: S.b });
    S.a = 0; S.b = 0; S.log = [];
    saveDraft();
    render();
    announce('บันทึกผลเกมที่ ' + S.games.length + ' แล้ว');
  }

  // ── pause / resume ────────────────────────────────────────────────────────
  function togglePause() {
    if (!S.paused) {
      S.elapsedBeforePause = elapsedMs();
      S.paused = true;
      openPauseReasonDrawer();
    } else {
      S.paused = false;
      S.startedAt = Date.now();
      saveDraft();
      render();
      announce('เล่นต่อแล้ว');
    }
  }

  function openPauseReasonDrawer() {
    AdminV2.drawer({
      title: 'เหตุผลที่หยุดพัก',
      body:
        '<div class="avw-field"><label for="arvPauseReason">เหตุผล (ไม่บังคับ)</label>' +
          '<input class="inp" id="arvPauseReason" placeholder="เช่น ผู้เล่นขอเวลานอก, ฝนตก"></div>',
      actions: '<button type="button" class="btn btn-primary btn-sm" id="arvPauseOk">บันทึก</button>',
      onMount: function () {
        document.getElementById('arvPauseOk').onclick = function () {
          var reason = (document.getElementById('arvPauseReason').value || '').trim();
          S.pauseLog.push({ reason: reason || null, at: Date.now() });
          AdminV2.closeDrawer();
          saveDraft();
          render();
          announce('หยุดพักแล้ว' + (reason ? ' — ' + reason : ''));
        };
      }
    });
  }

  // ── incident: walkover / retired / disqualified ──────────────────────────
  function openIncident() {
    AdminV2.drawer({
      title: 'วอล์กโอเวอร์ / ถอนตัว / ปรับแพ้',
      body:
        '<div class="avw-field"><label for="arvOutcome">ประเภทเหตุการณ์</label>' +
          '<select class="inp" id="arvOutcome">' +
            '<option value="walkover">วอล์กโอเวอร์ (ไม่มาแข่ง)</option>' +
            '<option value="retired">ขอถอนตัวกลางแมตช์ (บาดเจ็บ)</option>' +
            '<option value="disqualified">ปรับแพ้ (ผิดกติกา)</option>' +
          '</select></div>' +
        '<div class="avw-field"><label for="arvWinner">ผู้ชนะ</label>' +
          '<select class="inp" id="arvWinner">' +
            '<option value="a">' + esc(entryA ? entryA.display_name : 'ฝั่ง A') + '</option>' +
            '<option value="b">' + esc(entryB ? entryB.display_name : 'ฝั่ง B') + '</option>' +
          '</select></div>' +
        '<div class="avd-err" id="arvIncidentErr"></div>',
      actions: '<button type="button" class="btn btn-ghost btn-sm" id="arvIncidentCancel">ยกเลิก</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="arvIncidentOk">ยืนยัน</button>',
      onMount: function () {
        document.getElementById('arvIncidentCancel').onclick = AdminV2.closeDrawer;
        document.getElementById('arvIncidentOk').onclick = function () {
          var outcome = document.getElementById('arvOutcome').value;
          var winnerSide = document.getElementById('arvWinner').value;
          AdminV2.closeDrawer();
          confirmAndSubmit(outcome, winnerSide);
        };
      }
    });
  }

  // ── final submission ──────────────────────────────────────────────────────
  function confirmAndSubmit(outcome, winnerSideForIncident) {
    var winnerEntryId = null;
    var label;
    if (outcome !== 'normal') {
      winnerEntryId = winnerSideForIncident === 'a' ? (entryA && entryA.id) : (entryB && entryB.id);
      label = { walkover: 'วอล์กโอเวอร์', retired: 'ถอนตัวกลางแมตช์', disqualified: 'ปรับแพ้' }[outcome];
    } else {
      var gamesWonA = S.games.filter(function (g) { return g.score_a > g.score_b; }).length;
      var gamesWonB = S.games.length - gamesWonA;
      label = 'จบแมตช์ (' + gamesWonA + '-' + gamesWonB + ')';
    }

    AdminV2.confirm({
      level: 'confirm',
      title: 'ยืนยัน: ' + label + '?',
      body: 'บันทึกผลแล้วจะแก้ไขได้เฉพาะผ่านหน้าจัดการเท่านั้น',
      confirmLabel: 'ยืนยันบันทึกผล',
      onConfirm: function () { submitMatch(outcome, winnerEntryId); }
    });
  }

  async function submitMatch(outcome, winnerEntryId) {
    var btn = document.getElementById('arvFinishMatch') || document.getElementById('arvIncidentOk');
    if (busy) return;
    busy = true;
    stopTimerTick();
    announce('กำลังบันทึกผล...');

    var durationSeconds = Math.round(elapsedMs() / 1000);
    var key = 'ref-' + matchId + '-' + (S._idempotencyKey || (S._idempotencyKey = Date.now() + '-' + Math.random().toString(36).slice(2, 8)));

    try {
      var res = await Svc.submitResult(matchId,
        outcome === 'normal' ? S.games : (S.games.length ? S.games : []),
        { outcome: outcome, duration: durationSeconds, idempotencyKey: key, winnerEntryId: winnerEntryId });
      clearDraft();
      announce('บันทึกผลเรียบร้อย' + (res.advanced_to ? ' — เข้ารอบถัดไปแล้ว' : ''));
      if (window.toast) toast('บันทึกผลแมตช์เรียบร้อย', 'success');
      if (window.__avrOnDone) window.__avrOnDone();
    } catch (e) {
      // Optimistic UI, explicit rollback: nothing local was cleared, so the
      // referee sees exactly the state they tried to submit and can retry.
      fail(e, 'บันทึกผลไม่สำเร็จ');
      startTimerTick();
    } finally {
      busy = false;
    }
  }

  // ── wiring ─────────────────────────────────────────────────────────────────
  function wire() {
    var back = document.getElementById('arvBack');
    if (back) back.onclick = function () {
      stopTimerTick();
      AdminV2.go('tournaments');
    };

    var pA = document.getElementById('arvPlusA');
    if (pA) pA.onclick = function () { addPoint('a'); };
    var pB = document.getElementById('arvPlusB');
    if (pB) pB.onclick = function () { addPoint('b'); };

    var undo = document.getElementById('arvUndo');
    if (undo) undo.onclick = undoPoint;

    var fg = document.getElementById('arvFinishGame');
    if (fg) fg.onclick = finishGame;

    var pause = document.getElementById('arvPauseToggle');
    if (pause) pause.onclick = togglePause;

    var inc = document.getElementById('arvIncident');
    if (inc) inc.onclick = openIncident;

    var fm = document.getElementById('arvFinishMatch');
    if (fm) fm.onclick = function () { confirmAndSubmit('normal', null); };
  }

  // ── entry point ────────────────────────────────────────────────────────────
  AdminV2.refereeV2 = {
    open(container, id, onDone) {
      host = container;
      matchId = Number(id);
      busy = false;
      window.__avrOnDone = onDone || null;
      return load();
    }
  };
})();
