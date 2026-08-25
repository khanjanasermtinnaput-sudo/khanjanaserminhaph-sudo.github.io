// Tournament V2 — spectator bracket viewer (js/tournament/bracket-view.js)
//
// Read-only. Fed entirely from a bundle the public Hub already fetched
// (js/tournament/hub.js) — there is no admin action anywhere in this module,
// so there is no code path that could leak a referee/correction control into
// the public view. This is the "สายการแข่งขัน" tab's inline renderer plus a
// full-screen overlay with round filter chips, matching the spec's BWF-style
// viewer requirement without touching the existing pre-V2 fullscreen bracket
// in js/tournament-knockout.js (openBracketFullscreen), which stays exactly
// as-is for pre-V2 tournaments.
window.TournamentBracketView = (function () {
  'use strict';

  var Svc = window.TournamentService;
  var lastFocused = null;
  var activeRound = null;
  var overlayBundle = null;

  function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

  function entryName(bundle, id) {
    return Svc.entryLabel(bundle.entries, id) || (id == null ? 'บาย' : '#' + id);
  }

  // ── inline (embedded in the Hub tab) ─────────────────────────────────────
  function renderInline(container, bundle) {
    var ko = bundle.matches.filter(function (m) { return m.stage === 'knockout'; });
    if (!ko.length) {
      container.innerHTML = '<div class="th-empty">ยังไม่มีสายการแข่งขัน</div>';
      return;
    }
    container.innerHTML =
      '<button type="button" class="btn btn-primary btn-sm" id="thOpenBracket">🔎 ดูสายแบบเต็มจอ</button>' +
      '<div class="avo-bracket" style="margin-top:12px">' + roundsHTML(bundle, ko, null) + '</div>';

    var btn = document.getElementById('thOpenBracket');
    if (btn) btn.onclick = function () { openFullscreen(bundle); };
  }

  function roundsHTML(bundle, matches, filterRound) {
    var byRound = {};
    matches.forEach(function (m) { (byRound[m.round_index] = byRound[m.round_index] || []).push(m); });
    var rounds = Object.keys(byRound).map(Number).sort(function (a, b) { return a - b; });
    if (filterRound != null) rounds = rounds.filter(function (r) { return r === filterRound; });

    return rounds.map(function (r) {
      var ms = byRound[r].sort(function (a, b) { return a.match_no - b.match_no; });
      return '<div class="avo-round">' +
        '<div class="avd-group-head">' + esc(ms[0].round_name || ('รอบ ' + r)) + '</div>' +
        ms.map(function (m) { return matchCard(bundle, m); }).join('') +
      '</div>';
    }).join('');
  }

  function matchCard(bundle, m) {
    var wonA = m.winner_entry_id != null && m.winner_entry_id === m.entry_a_id;
    var wonB = m.winner_entry_id != null && m.winner_entry_id === m.entry_b_id;
    var scoreline = (m.tournament_match_games || [])
      .map(function (g) { return g.score_a + '-' + g.score_b; }).join(', ');
    return '<div class="avo-bmatch">' +
      '<div class="avo-bside' + (wonA ? ' avo-bwin' : '') + '">' + esc(entryName(bundle, m.entry_a_id)) +
        (m.seed_a ? ' <span class="avo-bseed">(' + m.seed_a + ')</span>' : '') + '</div>' +
      '<div class="avo-bside' + (wonB ? ' avo-bwin' : '') + '">' + esc(entryName(bundle, m.entry_b_id)) +
        (m.seed_b ? ' <span class="avo-bseed">(' + m.seed_b + ')</span>' : '') + '</div>' +
      '<div class="avo-bstatus">' +
        (m.status === 'bye' ? 'บาย' : esc(Svc.MATCH_STATUS_LABELS[m.status] || m.status)) +
        (scoreline ? ' · ' + esc(scoreline) : '') +
      '</div>' +
    '</div>';
  }

  // ── full-screen overlay ───────────────────────────────────────────────────
  function openFullscreen(bundle) {
    overlayBundle = bundle;
    lastFocused = document.activeElement;

    var ko = bundle.matches.filter(function (m) { return m.stage === 'knockout'; });
    var rounds = Array.from(new Set(ko.map(function (m) { return m.round_index; }))).sort(function (a, b) { return a - b; });
    activeRound = null; // null = show all rounds (desktop pan view)

    var host = document.getElementById('thBracketOverlay');
    if (!host) {
      host = document.createElement('div');
      host.id = 'thBracketOverlay';
      document.body.appendChild(host);
    }

    host.innerHTML =
      '<div class="th-ov-backdrop" data-close="1"></div>' +
      '<div class="th-ov-panel" role="dialog" aria-modal="true" aria-label="สายการแข่งขัน ' + esc(bundle.event.name || '') + '">' +
        '<div class="th-ov-head">' +
          '<h3>' + esc(bundle.event.name || bundle.event.event_label) + '</h3>' +
          '<button type="button" class="th-ov-close" id="thOvClose" aria-label="ปิด">✕</button>' +
        '</div>' +
        '<div class="th-ov-rounds" role="tablist" aria-label="เลือกรอบ">' +
          '<button type="button" class="th-ov-chip th-ov-chip-on" data-round="all">ทั้งหมด</button>' +
          rounds.map(function (r) {
            var name = ko.filter(function (m) { return m.round_index === r; })[0].round_name || ('รอบ ' + r);
            return '<button type="button" class="th-ov-chip" data-round="' + r + '">' + esc(name) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="th-ov-scroll" id="thOvScroll">' +
          '<div class="avo-bracket th-ov-bracket" id="thOvBracket">' + roundsHTML(bundle, ko, null) + '</div>' +
        '</div>' +
      '</div>';

    host.classList.add('th-ov-open');

    var closeBtn = document.getElementById('thOvClose');
    closeBtn.focus();

    host.querySelectorAll('[data-close]').forEach(function (el) { el.onclick = closeFullscreen; });
    closeBtn.onclick = closeFullscreen;

    host.querySelectorAll('.th-ov-chip').forEach(function (chip) {
      chip.onclick = function () {
        host.querySelectorAll('.th-ov-chip').forEach(function (c) { c.classList.remove('th-ov-chip-on'); });
        chip.classList.add('th-ov-chip-on');
        var r = chip.dataset.round;
        var mount = document.getElementById('thOvBracket');
        mount.innerHTML = roundsHTML(bundle, ko, r === 'all' ? null : Number(r));
        mount.classList.toggle('th-ov-bracket-single', r !== 'all');
      };
    });

    document.addEventListener('keydown', onOverlayKeydown);
  }

  function closeFullscreen() {
    var host = document.getElementById('thBracketOverlay');
    if (host) host.classList.remove('th-ov-open');
    document.removeEventListener('keydown', onOverlayKeydown);
    if (lastFocused && document.contains(lastFocused) && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
    lastFocused = null;
    overlayBundle = null;
  }

  function onOverlayKeydown(e) {
    var host = document.getElementById('thBracketOverlay');
    if (!host || !host.classList.contains('th-ov-open')) return;
    if (e.key === 'Escape') { closeFullscreen(); return; }
    if (e.key !== 'Tab') return;

    var focusable = Array.prototype.slice.call(
      host.querySelectorAll('button, [href], select, textarea, input, [tabindex]:not([tabindex="-1"])')
    ).filter(function (el) { return el.offsetParent !== null; });
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return { renderInline: renderInline, openFullscreen: openFullscreen };
})();
