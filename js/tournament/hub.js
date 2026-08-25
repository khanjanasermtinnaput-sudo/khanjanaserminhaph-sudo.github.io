// Tournament V2 — public Tournament Hub (js/tournament/hub.js)
//
// The participant-facing entry point for the Tournament tab. Replaces the
// pre-V2 renderTournamentTab() as the global of that name; the old function
// was renamed to renderLegacyTournamentTab() (js/tournament.js) and is called
// from here for any remaining pre-V2 tournament, so nothing already running
// stops working. Mobile-first at 360px: series overview, five event chips,
// "my registrations" surfaced first, one clear next action.
//
// `tournament_series.is_public` is a display filter, not an RLS boundary
// (the series_read policy is `using (true)`) — this hub honours it as a
// listing toggle, matching how the creation wizard frames the checkbox
// ("เปิดให้ทุกคนเห็นรายการนี้"). Direct navigation to an unlisted series'
// events, if someone has the link, is unaffected — that mirrors how the rest
// of this app treats "unlisted" content.
window.TournamentHub = (function () {
  'use strict';

  var Svc = window.TournamentService;
  var V = window.TournamentValidation;
  var Errors = window.TournamentErrors;

  var TABS = [
    { id: 'overview', label: 'ภาพรวม' },
    { id: 'entries', label: 'ผู้เข้าแข่งขัน' },
    { id: 'standings', label: 'กลุ่ม/ตารางคะแนน' },
    { id: 'bracket', label: 'สายการแข่งขัน' },
    { id: 'schedule', label: 'ตารางแข่ง' },
    { id: 'results', label: 'ผลการแข่งขัน' }
  ];
  var SELECTION_TAB = { id: 'selection', label: 'ผู้ผ่านการคัดเลือก' };

  var state = { view: 'list', seriesId: null, eventId: null, tab: 'overview' };
  var container = null;
  var busy = false;

  function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

  // Deliberately NOT built from the shared, mutable `db.players` global.
  // That array is reassigned by several independent background pollers
  // (presence heartbeat, notifications, daily-login) via loadPlayers(), and a
  // render that reads it mid-refresh was observed resolving every name to
  // "#<id>" instead of the player's actual name. Fetching an independent
  // snapshot here removes that whole class of race regardless of its exact
  // cause, at the cost of one extra small query per render (~40 rows).
  var playersCache = null;
  var playersCacheAt = 0;
  async function playersById() {
    if (playersCache && (Date.now() - playersCacheAt) < 30000) return playersCache;
    var rows;
    try {
      rows = await supaFetch('players?select=id,name,nickname,class_label&deleted_at=is.null');
    } catch (e) {
      rows = (window.db && db.players) || [];
    }
    var map = {};
    rows.forEach(function (p) { map[p.id] = p; });
    playersCache = map;
    playersCacheAt = Date.now();
    return map;
  }

  function announce(msg) {
    var el = document.getElementById('thStatus');
    if (el) el.textContent = msg;
  }

  function fail(e, fallback) {
    var msg = (e && e.thai) || fallback || 'ทำรายการไม่สำเร็จ';
    if (window.toast) toast(msg, 'error');
    announce(msg);
  }

  // ── main entry ─────────────────────────────────────────────────────────────
  // Keeps the pre-V2 global name so every existing call site — the router in
  // js/utils.js, and the "refresh after I registered" calls scattered through
  // the legacy registration/knockout code — keeps working unchanged.
  async function renderTournamentTab() {
    container = document.getElementById('tournamentTabContent');
    if (!container) return;

    container.innerHTML =
      '<div class="th">' +
        '<div class="th-status" id="thStatus" role="status" aria-live="polite"></div>' +
        '<div id="thMain"></div>' +
        '<div id="tournamentLegacySection"></div>' +
      '</div>';

    if (state.view === 'list') await renderList();
    else await renderEvent();

    await maybeRenderLegacy();
  }

  async function maybeRenderLegacy() {
    try {
      var rows = await dbGetTournaments();
      var legacyActive = rows.filter(function (t) { return t.status !== 'completed' && !t.structure; });
      if (legacyActive.length && typeof renderLegacyTournamentTab === 'function') {
        await renderLegacyTournamentTab();
      }
    } catch (e) { /* legacy section is a bonus, never block the V2 hub on it */ }
  }

  // ── series list ────────────────────────────────────────────────────────────
  async function renderList() {
    var main = document.getElementById('thMain');
    main.innerHTML = '<div class="av2-state av2-state-loading"><div class="av2-spinner"></div>' +
      '<div>กำลังโหลดรายการแข่งขัน...</div></div>';

    try {
      var series = (await Svc.listSeries()).filter(function (s) { return s.is_public !== false; });
      var withEvents = await Promise.all(series.map(async function (s) {
        var events = await Svc.listEvents(s.id);
        return { series: s, events: events };
      }));
      var visible = withEvents.filter(function (x) {
        return x.events.some(function (e) { return e.lifecycle_status !== 'cancelled'; });
      });

      if (!visible.length) {
        main.innerHTML = '<div class="th-empty">' +
          '<div class="th-empty-icon">🏸</div>' +
          '<div class="th-empty-title">ยังไม่มีรายการแข่งขัน</div>' +
          '<div class="th-empty-sub">ติดตาม Admin ประกาศรายการใหม่ได้เลย</div>' +
        '</div>';
        return;
      }

      var myPid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
      var myRowsHtml = '';
      if (myPid) myRowsHtml = await renderMyRegistrations(visible, myPid);

      main.innerHTML = myRowsHtml + visible.map(seriesCardHTML).join('');
      wireList();
    } catch (e) {
      main.innerHTML = '';
      AdminV2 && AdminV2.state
        ? AdminV2.state(main, 'error', { message: (e && e.thai) || 'โหลดไม่สำเร็จ', retry: renderList })
        : fail(e, 'โหลดรายการไม่สำเร็จ');
    }
  }

  async function renderMyRegistrations(visible, myPid) {
    var rows = [];
    for (var i = 0; i < visible.length; i++) {
      var mine = await Svc.myEntries(myPid, visible[i].series.id);
      mine.forEach(function (m) { rows.push({ series: visible[i].series, m: m }); });
    }
    if (!rows.length) return '';

    return '<section class="th-mine">' +
      '<h3>การสมัครของฉัน</h3>' +
      '<ul class="th-mine-list">' + rows.map(function (r) {
        var needsAnswer = r.m.needs_my_answer;
        return '<li class="th-mine-item">' +
          '<span>' + esc(r.series.name) + ' — ' + esc(r.m.event.event_label || r.m.event.event_kind) + '</span>' +
          (needsAnswer
            ? '<span class="avd-chip avd-chip-sm avd-chip-warn">รอคุณตอบรับคำเชิญ</span>'
            : '<span class="avd-chip avd-chip-sm">สมัครแล้ว</span>') +
          '<button type="button" class="btn btn-ghost btn-sm" data-open-event="' + r.m.event.id + '" data-open-series="' + r.series.id + '">ดูรายละเอียด</button>' +
        '</li>';
      }).join('') + '</ul>' +
    '</section>';
  }

  function seriesCardHTML(x) {
    var s = x.series, events = x.events.filter(function (e) { return e.lifecycle_status !== 'cancelled'; });
    var STATUS_LABEL = { active: 'เปิดอยู่', completed: 'จบแล้ว', archived: 'เก็บถาวร' };

    return '<article class="th-card" data-series="' + s.id + '">' +
      '<div class="th-card-head">' +
        '<h3>' + esc(s.name) + '</h3>' +
        '<span class="avd-chip avd-chip-sm">' + esc(STATUS_LABEL[s.status] || s.status) + '</span>' +
      '</div>' +
      '<div class="th-card-meta">' +
        (s.event_date ? '<span>📅 ' + esc(s.event_date) + '</span>' : '') +
        (s.location ? '<span>📍 ' + esc(s.location) + '</span>' : '') +
        '<span>' + (s.purpose === 'selection' ? '🎯 โหมดคัดตัว' : '🏆 แข่งขันชิงแชมป์') + '</span>' +
      '</div>' +
      '<div class="th-chips">' + events.map(function (e) {
        return '<button type="button" class="th-chip" data-open-event="' + e.id + '" data-open-series="' + s.id + '">' +
          esc(e.event_label || e.event_kind) +
          '<span class="th-chip-sub">' + esc(Svc.LIFECYCLE_LABELS[e.lifecycle_status] || e.lifecycle_status) + '</span>' +
        '</button>';
      }).join('') + '</div>' +
    '</article>';
  }

  function wireList() {
    document.querySelectorAll('[data-open-event]').forEach(function (el) {
      el.onclick = function () {
        openEvent(Number(el.dataset.openSeries), Number(el.dataset.openEvent));
      };
    });
  }

  function openEvent(seriesId, eventId) {
    state = { view: 'event', seriesId: seriesId, eventId: eventId, tab: 'overview' };
    renderTournamentTab();
    if (container && container.scrollIntoView) container.scrollIntoView({ block: 'start' });
  }

  function backToList() {
    state = { view: 'list', seriesId: null, eventId: null, tab: 'overview' };
    renderTournamentTab();
  }

  // ── event detail ───────────────────────────────────────────────────────────
  async function renderEvent() {
    var main = document.getElementById('thMain');
    main.innerHTML = '<div class="av2-state av2-state-loading"><div class="av2-spinner"></div>' +
      '<div>กำลังโหลด...</div></div>';

    try {
      var bundle = await Svc.getEventBundle(state.eventId, await playersById());
      if (!bundle) { main.innerHTML = '<div class="th-empty">ไม่พบประเภทการแข่งขันนี้</div>'; return; }
      var ev = bundle.event;

      var tabs = TABS.slice();
      if (ev.purpose === 'selection') tabs.push(SELECTION_TAB);
      if (!tabs.some(function (t) { return t.id === state.tab; })) state.tab = 'overview';

      main.innerHTML =
        '<div class="th-event">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="thBack">← กลับไปรายการแข่งขัน</button>' +
          '<h2 class="th-event-title">' + esc(ev.name || ev.event_label) + '</h2>' +
          '<div class="avd-sub">' +
            '<span class="avd-chip">' + esc(Svc.LIFECYCLE_LABELS[ev.lifecycle_status] || ev.lifecycle_status) + '</span>' +
            '<span class="avd-chip">' + (ev.team_size === 2 ? 'ทีมละ 2 คน' : 'เดี่ยว') + '</span>' +
          '</div>' +
          '<div class="th-tabs" role="tablist" aria-label="รายละเอียดประเภทการแข่งขัน">' +
            tabs.map(function (t) {
              var on = t.id === state.tab;
              return '<button type="button" class="th-tab' + (on ? ' th-tab-on' : '') + '" role="tab" ' +
                'aria-selected="' + on + '" id="thTab-' + t.id + '" data-tab="' + t.id + '">' + esc(t.label) + '</button>';
            }).join('') +
          '</div>' +
          '<div class="th-panel" id="thPanel"></div>' +
        '</div>';

      document.getElementById('thBack').onclick = backToList;
      document.querySelectorAll('.th-tab').forEach(function (b) {
        b.onclick = function () { state.tab = b.dataset.tab; renderTabPanel(bundle); };
      });

      renderTabPanel(bundle);
    } catch (e) {
      main.innerHTML = '';
      fail(e, 'โหลดข้อมูลไม่สำเร็จ');
    }
  }

  async function renderTabPanel(bundle) {
    var panel = document.getElementById('thPanel');
    if (!panel) return;
    var ev = bundle.event;

    if (state.tab === 'overview') panel.innerHTML = await overviewHTML(bundle);
    else if (state.tab === 'entries') panel.innerHTML = entriesHTML(bundle);
    else if (state.tab === 'standings') panel.innerHTML = standingsHTML(bundle);
    else if (state.tab === 'bracket') {
      panel.innerHTML = '<div id="thBracketMount"></div>';
      if (window.TournamentBracketView) {
        window.TournamentBracketView.renderInline(document.getElementById('thBracketMount'), bundle);
      }
    }
    else if (state.tab === 'schedule') panel.innerHTML = scheduleHTML(bundle);
    else if (state.tab === 'results') panel.innerHTML = resultsHTML(bundle);
    else if (state.tab === 'selection') panel.innerHTML = await selectionHTML(bundle);

    wirePanel(bundle);
  }

  // ── overview: my status + next action ────────────────────────────────────
  async function overviewHTML(bundle) {
    var ev = bundle.event;
    var myPid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    // Only an ACTIVE entry blocks re-registration. A withdrawn entry still
    // contains my player_id, so matching on membership alone (like the entry
    // list does) would treat "I withdrew" as a permanent dead end even though
    // rpc_register_event happily accepts a new entry from me afterwards — the
    // withdrawal trigger frees the unique (tournament_id, player_id) slot.
    var mine = myPid ? bundle.entries.filter(function (e) {
      return (e.status === 'registered' || e.status === 'waitlisted') &&
        e.members.some(function (m) { return m.player_id === myPid; });
    })[0] : null;

    var deadline = ev.registration_deadline
      ? new Date(ev.registration_deadline).toLocaleString('th-TH') : null;
    var canRegister = ['draft', 'roster_ready'].indexOf(ev.lifecycle_status) !== -1 &&
      (!ev.registration_deadline || new Date(ev.registration_deadline) > new Date());

    var actionHTML;
    if (!myPid) {
      actionHTML = '<p class="th-hint">เข้าสู่ระบบเพื่อสมัครเข้าร่วม</p>';
    } else if (mine) {
      var pendingMember = mine.members.filter(function (m) {
        return m.invite_status === 'pending' && m.player_id === myPid;
      })[0];
      if (pendingMember) {
        actionHTML = '<div class="th-action-box">' +
          '<p>คุณได้รับคำเชิญให้จับคู่กับ ' + esc(otherMemberName(mine, myPid)) + '</p>' +
          '<div class="th-action-row">' +
            '<button type="button" class="btn btn-primary btn-sm" id="thAcceptInvite" data-entry="' + mine.id + '">ตอบรับ</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="thDeclineInvite" data-entry="' + mine.id + '">ปฏิเสธ</button>' +
          '</div></div>';
      } else {
        // `mine` is filtered to registered/waitlisted only (see above), so
        // this is the only remaining case.
        actionHTML = '<div class="th-action-box">' +
          '<p>สถานะของคุณ: <strong>' + (mine.status === 'waitlisted' ? 'สำรอง' : 'ลงแข่งแล้ว') + '</strong>' +
          (mine.entry_type === 'doubles' ? ' — คู่: ' + esc(otherMemberName(mine, myPid) || 'รอผู้เล่น') : '') + '</p>' +
          (canRegister ? '<button type="button" class="btn btn-ghost btn-sm" id="thWithdraw">ถอนตัว</button>' : '') +
        '</div>';
      }
    } else if (canRegister) {
      actionHTML = ev.team_size === 2 ? registerDoublesFormHTML(bundle) : registerSinglesHTML();
    } else {
      actionHTML = '<p class="th-hint">ปิดรับสมัครแล้ว</p>';
    }

    return '<div class="th-overview">' +
      '<div class="th-stat-row">' +
        '<div class="th-stat"><span>ผู้เข้าแข่งขัน</span><strong>' + bundle.entries.filter(function (e) { return e.status === 'registered'; }).length +
          (ev.max_participants ? ' / ' + ev.max_participants : '') + '</strong></div>' +
        (deadline ? '<div class="th-stat"><span>ปิดรับสมัคร</span><strong>' + esc(deadline) + '</strong></div>' : '') +
        '<div class="th-stat"><span>รูปแบบ</span><strong>' + esc(V.STRUCTURES[ev.structure] || ev.structure) + '</strong></div>' +
      '</div>' +
      actionHTML +
    '</div>';
  }

  function otherMemberName(entry, myPid) {
    var other = entry.members.filter(function (m) { return m.player_id !== myPid; })[0];
    return other ? other.full_name : null;
  }

  function registerSinglesHTML() {
    return '<div class="th-action-box">' +
      '<button type="button" class="btn btn-primary btn-sm" id="thRegisterSingles">สมัครเข้าร่วม</button>' +
    '</div>';
  }

  function registerDoublesFormHTML(bundle) {
    // Only an ACTIVE entry's members are actually unavailable — the same
    // fix as the `mine` lookup above. bundle.entries includes withdrawn and
    // disqualified rows too; without this filter, someone who withdrew (or
    // whose partner withdrew) could never be offered as a partner again even
    // though the server's partial unique index has already freed them.
    var used = {};
    bundle.entries
      .filter(function (e) { return e.status === 'registered' || e.status === 'waitlisted'; })
      .forEach(function (e) {
        e.members.forEach(function (m) { used[m.player_id] = true; });
      });
    var myPid = currentUser.id;
    var options = (db.players || [])
      .filter(function (p) { return p.id !== myPid && !used[p.id] && !p.deletedAt; })
      .map(function (p) { return '<option value="' + p.id + '">' + esc(p.nickname || p.name) + '</option>'; })
      .join('');

    return '<div class="th-action-box">' +
      '<p class="th-hint">ประเภทนี้ลงแข่งเป็นคู่ — เลือกคู่ของคุณแล้วส่งคำเชิญ</p>' +
      '<label class="avw-sr" for="thPartnerSelect">เลือกคู่</label>' +
      '<select class="inp" id="thPartnerSelect"><option value="">— เลือกคู่ —</option>' + options + '</select>' +
      '<button type="button" class="btn btn-primary btn-sm" id="thRegisterDoubles" style="margin-top:8px">ส่งคำเชิญและสมัคร</button>' +
    '</div>';
  }

  // ── entries ────────────────────────────────────────────────────────────────
  function entriesHTML(bundle) {
    var active = bundle.entries.filter(function (e) { return e.status === 'registered' || e.status === 'waitlisted'; });
    if (!active.length) return '<div class="th-empty">ยังไม่มีผู้เข้าแข่งขัน</div>';
    return '<ul class="th-entry-list">' + active.map(function (e) {
      return '<li class="th-entry">' +
        '<span class="th-entry-name">' + esc(e.display_name) + (e.seed ? ' <span class="avo-bseed">(' + e.seed + ')</span>' : '') + '</span>' +
        (e.status === 'waitlisted' ? '<span class="avd-chip avd-chip-sm avd-chip-warn">สำรอง</span>' : '') +
      '</li>';
    }).join('') + '</ul>';
  }

  // ── standings ──────────────────────────────────────────────────────────────
  function standingsHTML(bundle) {
    if (!bundle.standings.length) return '<div class="th-empty">ยังไม่มีตารางคะแนน</div>';
    var byGroup = {};
    bundle.standings.forEach(function (s) { (byGroup[s.group_letter] = byGroup[s.group_letter] || []).push(s); });

    return '<div class="avo-standings">' + Object.keys(byGroup).sort().map(function (letter) {
      var rows = byGroup[letter];
      return '<div class="avo-sgroup"><div class="avd-group-head">กลุ่ม ' + letter + '</div>' +
        '<table class="av2-table avo-stable"><thead><tr><th>#</th><th>ทีม</th><th>W-L</th><th>เกม</th><th>แต้ม</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr class="' + (r.qualifies ? 'avo-qualifies' : '') + '"><td>' + r.rank + (r.is_tied ? ' *' : '') + '</td>' +
            '<td>' + esc(Svc.entryLabel(bundle.entries, r.entry_id)) + '</td>' +
            '<td>' + r.wins + '-' + r.losses + '</td>' +
            '<td>' + (r.game_diff > 0 ? '+' : '') + r.game_diff + '</td>' +
            '<td>' + (r.point_diff > 0 ? '+' : '') + r.point_diff + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('') + '</div>';
  }

  // ── schedule / results ────────────────────────────────────────────────────
  function scheduleHTML(bundle) {
    var upcoming = bundle.matches.filter(function (m) { return ['pending', 'ready', 'live'].indexOf(m.status) !== -1; });
    if (!upcoming.length) return '<div class="th-empty">ไม่มีแมตช์ที่กำลังจะแข่ง</div>';
    return '<ul class="avo-queue">' + upcoming.map(function (m) {
      var stageLabel = m.stage === 'group' ? 'กลุ่ม ' + (m.group_letter || '') : (m.round_name || 'น็อกเอาต์');
      return '<li class="avo-qrow"><div class="avo-qmain">' +
        '<span class="avd-chip avd-chip-sm">' + esc(stageLabel) + '</span>' +
        '<span class="avd-chip avd-chip-sm">' + esc(Svc.MATCH_STATUS_LABELS[m.status] || m.status) + '</span>' +
        '<span class="avo-qnames">' + esc(Svc.entryLabel(bundle.entries, m.entry_a_id) || 'บาย') + ' vs ' +
          esc(Svc.entryLabel(bundle.entries, m.entry_b_id) || 'บาย') + '</span>' +
      '</div></li>';
    }).join('') + '</ul>';
  }

  function resultsHTML(bundle) {
    var done = bundle.matches.filter(function (m) { return m.status === 'completed'; });
    if (!done.length) return '<div class="th-empty">ยังไม่มีผลการแข่งขัน</div>';
    return '<ul class="avo-queue">' + done.map(function (m) {
      var stageLabel = m.stage === 'group' ? 'กลุ่ม ' + (m.group_letter || '') : (m.round_name || 'น็อกเอาต์');
      var scoreline = (m.tournament_match_games || []).map(function (g) { return g.score_a + '-' + g.score_b; }).join(', ');
      return '<li class="avo-qrow"><div class="avo-qmain">' +
        '<span class="avd-chip avd-chip-sm">' + esc(stageLabel) + '</span>' +
        '<span class="avo-qnames">' +
          esc(entryLabelWin(bundle, m.entry_a_id, m.winner_entry_id)) + ' vs ' +
          esc(entryLabelWin(bundle, m.entry_b_id, m.winner_entry_id)) +
          (scoreline ? ' (' + scoreline + ')' : '') +
        '</span></div></li>';
    }).join('') + '</ul>';
  }

  function entryLabelWin(bundle, entryId, winnerId) {
    var name = Svc.entryLabel(bundle.entries, entryId) || 'บาย';
    return entryId === winnerId ? name + ' ✓' : name;
  }

  // ── selection results ─────────────────────────────────────────────────────
  async function selectionHTML(bundle) {
    var ev = bundle.event;
    if (ev.lifecycle_status !== 'selection_completed') {
      return '<div class="th-empty">ยังไม่ประกาศผลคัดตัว</div>';
    }
    var results = await Svc.listSelectionResults(ev.id);
    var RESULT_LABEL = { selected: 'ผ่านการคัดเลือก', reserve: 'สำรอง', not_selected: 'ไม่ผ่าน', withdrawn: 'ถอนตัว' };

    return '<ul class="th-entry-list">' + results
      .sort(function (a, b) { return (a.rank || 999) - (b.rank || 999); })
      .map(function (r) {
        return '<li class="th-entry"><span class="th-entry-name">' +
          esc(Svc.entryLabel(bundle.entries, r.entry_id)) + '</span>' +
          '<span class="avd-chip avd-chip-sm">' + esc(RESULT_LABEL[r.result] || r.result) + '</span></li>';
      }).join('') + '</ul>';
  }

  // ── wiring ─────────────────────────────────────────────────────────────────
  function wirePanel(bundle) {
    var reg = document.getElementById('thRegisterSingles');
    if (reg) reg.onclick = function () { doRegister(bundle.event.id, null, reg); };

    var regD = document.getElementById('thRegisterDoubles');
    if (regD) regD.onclick = function () {
      var partnerId = Number(document.getElementById('thPartnerSelect').value);
      if (!partnerId) return announce('กรุณาเลือกคู่ของคุณก่อน');
      doRegister(bundle.event.id, partnerId, regD);
    };

    var wd = document.getElementById('thWithdraw');
    if (wd) wd.onclick = function () { doWithdraw(bundle.event.id, wd); };

    var acc = document.getElementById('thAcceptInvite');
    if (acc) acc.onclick = function () { doRespond(Number(acc.dataset.entry), 'accept'); };
    var dec = document.getElementById('thDeclineInvite');
    if (dec) dec.onclick = function () { doRespond(Number(dec.dataset.entry), 'decline'); };
  }

  async function withBusy(btn, fn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try { await fn(); }
    catch (e) { fail(e); }
    finally { busy = false; }
  }

  async function doRegister(eventId, partnerId, btn) {
    await withBusy(btn, async function () {
      var res = await Svc.register(eventId, partnerId);
      await renderEvent();
      announce(res.status === 'waitlisted' ? 'สมัครแล้ว อยู่ในรายชื่อสำรอง' :
        (res.partner_pending ? 'ส่งคำเชิญคู่แล้ว รอคู่ตอบรับ' : 'สมัครเข้าร่วมเรียบร้อย'));
    });
  }

  async function doWithdraw(eventId, btn) {
    AdminV2.confirm({
      level: 'warn',
      title: 'ถอนตัวจากประเภทนี้?',
      body: 'คุณจะออกจากรายชื่อผู้เข้าแข่งขัน สมัครใหม่ได้ภายหลังหากยังไม่ปิดรับสมัคร',
      confirmLabel: 'ถอนตัว',
      onConfirm: function () {
        withBusy(btn, async function () {
          await Svc.withdraw(eventId);
          await renderEvent();
          announce('ถอนตัวแล้ว');
        });
      }
    });
  }

  async function doRespond(entryId, decision) {
    await withBusy(null, async function () {
      await Svc.respondToInvite(entryId, decision);
      await renderEvent();
      announce(decision === 'accept' ? 'ตอบรับคำเชิญแล้ว' : 'ปฏิเสธคำเชิญแล้ว');
    });
  }

  return { renderTournamentTab: renderTournamentTab, openEvent: openEvent };
})();

// Global name preserved for js/utils.js's showSection() router and every
// existing "refresh after I did something" call site in the pre-V2 code.
window.renderTournamentTab = window.TournamentHub.renderTournamentTab;
