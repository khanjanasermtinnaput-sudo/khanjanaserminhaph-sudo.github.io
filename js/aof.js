// ============================================================
// AOF Assistance — Expansion Pack
// ทำให้ "AOF" มีบทบาทมากขึ้นทั่วทั้งเว็บ โดยไม่แตะ flow เดิม
//
// ฟีเจอร์ในไฟล์นี้ (ตามที่ผู้ใช้เลือก):
//   #3  AOF ใน Rank Up        — ฟองข้อความยินดี + เป้าหมายแรงค์ถัดไป
//   #4  AOF ใน Achievement    — อธิบายความหมายของ achievement
//   #5  AOF ใน Hall of Fame   — คลิกชื่อ → เล่าเรื่อง/สถิติ
//   #7  AOF Weekly Digest     — สรุปความเคลื่อนไหวรายสัปดาห์
//   #9  AOF Season Countdown  — เตือนก่อน Season Reset
//   #10 AOF Bubble ใน LB      — ปุ่ม 🤖 ข้างชื่อ → วิเคราะห์จุดแข็ง/อ่อน
//   #11 AOF Voice Input       — ปุ่มไมค์ในแชท (Web Speech API)
//   #12 AOF Minimize Mode     — ย่อแชทเป็น pill ลอย เปิดได้ทุกหน้า
//   #13 AOF Theme-aware       — ทุก component ใช้ตัวแปร theme + Lite override
//   #14 AOF Trash Talk        — สร้างประโยคแซวคู่แข่งสนุกๆ
//   #15 AOF Club FAQ          — แท็บ FAQ แบบ interactive
//
// หมายเหตุ: ทั้งหมดทำงานฝั่ง client (เร็ว/ฟรี/เชื่อถือได้) ส่วนที่อยากถาม AI
// จริงๆ จะลิงก์ไปที่แชท AOF เดิม (ผ่าน backend ที่มีอยู่แล้ว)
// ============================================================
(function () {
  'use strict';

  // ── helpers ────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function isTH() { return (typeof _lang === 'undefined') || _lang === 'th'; }
  var AOF_NAME = 'AOF Assistance';

  // เปิดแชท AOF (สลับ section + แท็บ + เติมคำถาม + ส่งอัตโนมัติได้)
  function openChat(prefill, autosend) {
    if (typeof showSection === 'function') showSection('ai');
    if (typeof window.aiShowTab === 'function') window.aiShowTab('chat');
    var inp = $('aiInput');
    if (inp && prefill != null) inp.value = prefill;
    if (autosend && typeof window.aiSend === 'function') {
      setTimeout(function () { window.aiSend(); }, 60);
    } else if (inp) {
      inp.focus();
    }
  }

  // ════════════════════════════════════════════════════════════
  //  UI PRIMITIVES — ฟองข้อความ (#13 theme-aware) + popup + queue
  // ════════════════════════════════════════════════════════════
  var _bubbleQueue = [], _bubbleActive = false;

  function _overlayBusy() {
    // อย่าเด้งฟองทับ overlay rank-up / achievement ที่กำลังเต็มจอ
    var b = document.body;
    return !!(b.dataset.ruLock || b.dataset.achLock || b.dataset.refLock || b.dataset.ppLock);
  }

  // opts: { text, title, actionLabel, onAction, timeout, icon }
  function bubble(opts) {
    if (!opts || !opts.text) return;
    _bubbleQueue.push(opts);
    if (!_bubbleActive) _showNextBubble();
  }

  function _showNextBubble() {
    if (!_bubbleQueue.length) { _bubbleActive = false; return; }
    _bubbleActive = true;
    var o = _bubbleQueue.shift();

    var el = document.createElement('div');
    el.className = 'aof-bubble';
    el.innerHTML =
      '<div class="aof-bubble-av">' + (o.icon || '🤖') + '</div>' +
      '<div class="aof-bubble-body">' +
        '<div class="aof-bubble-name">' + esc(o.title || AOF_NAME) + '</div>' +
        '<div class="aof-bubble-text">' + esc(o.text) + '</div>' +
      '</div>' +
      '<button class="aof-bubble-close" aria-label="close">✕</button>';

    if (o.actionLabel) {
      var act = document.createElement('button');
      act.className = 'aof-bubble-act';
      act.textContent = o.actionLabel;
      act.addEventListener('click', function () {
        try { if (o.onAction) o.onAction(); } finally { _dismiss(el); }
      });
      el.querySelector('.aof-bubble-body').appendChild(act);
    }

    el.querySelector('.aof-bubble-close').addEventListener('click', function () { _dismiss(el); });
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });

    var ms = o.timeout || (o.actionLabel ? 18000 : 11000);
    el._t = setTimeout(function () { _dismiss(el); }, ms);
  }

  function _dismiss(el) {
    if (!el || el._closing) return;
    el._closing = true;
    if (el._t) clearTimeout(el._t);
    el.classList.remove('show');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      _showNextBubble();
    }, 280);
  }

  // popup กลางจอ (ใช้กับ analyze / HoF story / digest)
  function popup(titleHTML, bodyHTML) {
    var bg = document.createElement('div');
    bg.className = 'aof-pop-bg';
    bg.innerHTML =
      '<div class="aof-pop">' +
        '<div class="aof-pop-head">' +
          '<span class="aof-pop-av">🤖</span>' +
          '<span class="aof-pop-title">' + titleHTML + '</span>' +
          '<button class="aof-pop-close" aria-label="close">✕</button>' +
        '</div>' +
        '<div class="aof-pop-body"></div>' +
      '</div>';
    var body = bg.querySelector('.aof-pop-body');
    if (typeof bodyHTML === 'string') body.innerHTML = bodyHTML;
    else if (bodyHTML && bodyHTML.nodeType) body.appendChild(bodyHTML);

    function close() {
      bg.classList.remove('show');
      setTimeout(function () { if (bg.parentNode) bg.parentNode.removeChild(bg); }, 220);
    }
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    bg.querySelector('.aof-pop-close').addEventListener('click', close);
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('show'); });
    return { el: bg, body: body, close: close };
  }

  // ════════════════════════════════════════════════════════════
  //  STATS ENGINE — คำนวณจากข้อมูลจริง (ใช้ร่วมหลายฟีเจอร์)
  // ════════════════════════════════════════════════════════════
  function findPlayer(id) {
    return (typeof db !== 'undefined' && db.players) ? db.players.find(function (p) { return p.id === id; }) : null;
  }

  function recentMatchesOf(id, limit) {
    if (typeof db === 'undefined' || !db.matches) return [];
    var ms = db.matches.filter(function (m) {
      return [].concat(m.teamA || [], m.teamB || []).some(function (x) { return x.id === id; });
    }).sort(function (a, b) {
      return new Date(b.date || b.played_at) - new Date(a.date || a.played_at);
    });
    return limit ? ms.slice(0, limit) : ms;
  }

  function didWin(m, id) {
    var inA = (m.teamA || []).some(function (x) { return x.id === id; });
    return (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
  }

  function playerStats(id) {
    var p = findPlayer(id);
    if (!p) return null;
    var total = (p.wins || 0) + (p.losses || 0);
    var wr = total ? Math.round((p.wins / total) * 100) : 0;
    var rank = (typeof getRank === 'function') ? getRank(p.pts, p.id) : { label: '', id: '' };
    var prog = (typeof rankProgress === 'function') ? rankProgress(p.pts) : { pct: 0, next: null };
    var streak = (typeof getPlayerStreak === 'function') ? getPlayerStreak(id) : 0;
    var nemesis = (typeof getNemesis === 'function') ? getNemesis(id) : null;

    var recent = recentMatchesOf(id, 8);
    var recentW = 0, singles = 0, doubles = 0;
    recent.forEach(function (m) {
      if (didWin(m, id)) recentW++;
      if (m.type === 'doubles') doubles++; else singles++;
    });

    return {
      player: p, total: total, wr: wr, rank: rank, prog: prog, streak: streak,
      nemesis: nemesis, recent: recent, recentW: recentW, recentL: recent.length - recentW,
      singles: singles, doubles: doubles
    };
  }

  // ════════════════════════════════════════════════════════════
  //  #10 — PLAYER ANALYSIS (จุดแข็ง/จุดอ่อน)
  // ════════════════════════════════════════════════════════════
  var TIPS = [
    'ฝึก footwork แบบ 6 จุดให้คล่อง จะถึงลูกเร็วขึ้นและตีได้สมดุลกว่าเดิม',
    'ลองเก็บลูก clear ให้ลึกถึงท้ายคอร์ต เพื่อบีบให้คู่แข่งตีจากหลังเส้น',
    'ฝึก drop shot สลับกับ smash จากท่าเดียวกัน คู่แข่งจะอ่านทางยากขึ้น',
    'อย่าลืม warm-up ข้อมือและหัวไหล่ก่อนเล่น ลดเสี่ยงบาดเจ็บได้มาก',
    'เกมคู่: คุยกับคู่เรื่องการยืน front-back vs side-by-side ให้ชัดก่อนลงสนาม',
    'จุดอ่อนหลังมือ (backhand) ฝึก backhand clear สม่ำเสมอจะอุดช่องโหว่ได้',
    'รักษาจังหวะหายใจและกลับมายืนกลางคอร์ตทุกครั้งหลังตีลูก'
  ];

  function analyzePlayer(id) {
    var s = playerStats(id);
    if (!s) { if (typeof toast === 'function') toast('ไม่พบข้อมูลผู้เล่น', 'error'); return; }
    var p = s.player;
    var av = (typeof getAvatar === 'function') ? getAvatar(p.id, p.name) : { content: '🏸', bg: 'var(--card)', fg: 'var(--text)' };

    var strengths = [], weaks = [];
    if (s.total < 3) {
      weaks.push('ยังเล่นไม่กี่แมตช์ (' + s.total + ') — เก็บประสบการณ์เพิ่มเพื่อให้สถิติแม่นยำขึ้น');
    }
    if (s.wr >= 60) strengths.push('อัตราชนะสูงถึง ' + s.wr + '% — ฟอร์มโดยรวมแข็งแกร่ง');
    else if (s.total >= 3 && s.wr <= 40) weaks.push('อัตราชนะ ' + s.wr + '% — เน้นความสม่ำเสมอและลดความผิดพลาดเอง (unforced error)');
    if (s.streak >= 3) strengths.push('กำลังฟอร์มร้อน ชนะรวด ' + s.streak + ' เกมติด 🔥');
    if (s.recent.length >= 4) {
      if (s.recentW >= Math.ceil(s.recent.length * 0.7)) strengths.push('ฟอร์มล่าสุดดีมาก (ชนะ ' + s.recentW + '/' + s.recent.length + ')');
      else if (s.recentL >= Math.ceil(s.recent.length * 0.7)) weaks.push('ฟอร์มล่าสุดสะดุด (แพ้ ' + s.recentL + '/' + s.recent.length + ') — ลองทบทวนเกมรับ');
    }
    if (s.nemesis) weaks.push('เจอ ' + s.nemesis.name + ' มักเพลี่ยงพล้ำ (แพ้ ' + s.nemesis.losses + ' ครั้ง) — วางแผนรับมือเป็นพิเศษ');
    if (s.doubles > s.singles && s.doubles > 0) strengths.push('เล่นเกมคู่ (doubles) บ่อย — จุดเด่นเรื่องการประสานงานกับคู่');
    else if (s.singles > s.doubles && s.singles > 0) strengths.push('ถนัดเกมเดี่ยว (singles) — ความฟิตและการคุมคอร์ตคนเดียวคือจุดเด่น');

    if (!strengths.length) strengths.push('มีพื้นฐานพร้อมพัฒนา — เล่นต่อเนื่องแล้วสถิติจะไต่ขึ้นแน่นอน');
    if (!weaks.length) weaks.push('ยังไม่พบจุดอ่อนชัดเจน — รักษามาตรฐานนี้ไว้ให้ดี 👍');

    var tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    var nextTxt = s.prog && s.prog.next
      ? ('อีก ~' + Math.max(0, (s.prog.next.min - p.pts)) + ' คะแนนถึง ' + s.prog.next.label)
      : 'อยู่ระดับสูงสุดแล้ว 👑';

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="aof-an-head">' +
        '<div class="aof-an-av" style="background:' + (av.bg || 'var(--card)') + ';color:' + (av.fg || 'var(--text)') + (av.fs ? ';font-size:' + av.fs : '') + '">' + (av.content || '🏸') + '</div>' +
        '<div style="min-width:0">' +
          '<div class="aof-an-name">' + esc(p.name) + '</div>' +
          '<div class="aof-an-sub">' + esc(s.rank.label || '') + ' · ' + (p.pts != null ? p.pts.toLocaleString() : 0) + ' คะแนน</div>' +
        '</div>' +
      '</div>' +
      '<div class="aof-an-stats">' +
        '<div class="aof-an-stat"><b>' + (p.wins || 0) + '</b><span>ชนะ</span></div>' +
        '<div class="aof-an-stat"><b>' + (p.losses || 0) + '</b><span>แพ้</span></div>' +
        '<div class="aof-an-stat"><b>' + s.wr + '%</b><span>Win rate</span></div>' +
        '<div class="aof-an-stat"><b>' + (s.streak || 0) + '</b><span>Streak</span></div>' +
      '</div>' +
      '<div class="aof-an-block"><div class="aof-an-label" style="color:var(--neon)">💪 จุดแข็ง</div><ul class="aof-an-ul">' +
        strengths.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="aof-an-block"><div class="aof-an-label" style="color:#ff9f43">🎯 จุดที่พัฒนาได้</div><ul class="aof-an-ul">' +
        weaks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="aof-an-next">🏅 ' + esc(nextTxt) + '</div>' +
      '<div class="aof-an-tip">💡 <b>ทิปจาก AOF:</b> ' + esc(tip) + '</div>';

    var ask = document.createElement('button');
    ask.className = 'aof-an-ask';
    ask.textContent = '💬 ถาม AOF เพิ่มเติม';
    ask.addEventListener('click', function () {
      pop.close();
      openChat('ผม win rate ' + s.wr + '% ฟอร์มล่าสุดชนะ ' + s.recentW + '/' + s.recent.length +
        (s.nemesis ? ' และมักแพ้ ' + s.nemesis.name : '') + ' ช่วยแนะนำการฝึกซ้อมและเทคนิคแบดมินตันให้พัฒนาขึ้นหน่อยครับ', true);
    });
    wrap.appendChild(ask);

    var pop = popup('วิเคราะห์โดย AOF', wrap);
  }

  // ════════════════════════════════════════════════════════════
  //  #10 — ฝังปุ่ม 🤖 ข้างชื่อในตาราง Leaderboard
  // ════════════════════════════════════════════════════════════
  if (typeof lbRenderBoard === 'function') {
    var _lbRenderBoardBase = lbRenderBoard;
    lbRenderBoard = function (data, animate) {
      _lbRenderBoardBase(data, animate);
      try {
        var bl = $('lbBoardList');
        if (!bl) return;
        var rows = bl.children;
        for (var i = 0; i < rows.length; i++) {
          var p = data[i];
          if (!p) continue;
          var nameEl = rows[i].querySelector('.lb-rn');
          if (!nameEl || nameEl.querySelector('.lb-aof-btn')) continue;
          (function (pid) {
            var b = document.createElement('button');
            b.className = 'lb-aof-btn';
            b.type = 'button';
            b.textContent = '🤖';
            b.title = 'ให้ AOF วิเคราะห์ผู้เล่นคนนี้';
            b.addEventListener('click', function (e) {
              e.stopPropagation();
              analyzePlayer(pid);
            });
            nameEl.appendChild(b);
          })(p.id);
        }
      } catch (e) { /* non-fatal */ }
    };
  }

  // ════════════════════════════════════════════════════════════
  //  #3 — AOF ใน Rank Up
  // ════════════════════════════════════════════════════════════
  var _pendingRankUp = false;

  var RANK_CHEER = {
    bronze: 'ก้าวแรกของการไต่อันดับ เริ่มได้สวย!',
    silver: 'ขยับขึ้นมาอีกขั้นแล้ว ฝีมือกำลังมา!',
    gold: 'ระดับทองคำ! คุณเหนือกว่าค่าเฉลี่ยของสโมสรแล้ว',
    platinum: 'แพลตินัม! การอ่านเกมและความนิ่งเริ่มเข้าที่',
    diamond: 'ระดับเพชร 💠 คุณอยู่กลุ่มหัวแถวแล้ว',
    master: 'Master Player 🔥 ระดับโปรของสโมสร สุดยอดมาก!',
    king: 'ราชาแห่งสนาม 👑 รักษาบัลลังก์ไว้ให้ได้นะ!'
  };

  if (typeof showRankUp === 'function') {
    var _showRankUpBase = showRankUp;
    showRankUp = function (rc, playerName, gainPts) {
      _showRankUpBase(rc, playerName, gainPts);
      if (typeof currentUser !== 'undefined' && currentUser && playerName === currentUser.name) {
        _pendingRankUp = true;
      }
    };
  }

  function _fireRankUpBubble() {
    if (!_pendingRankUp) return;
    _pendingRankUp = false;
    if (typeof currentUser === 'undefined' || !currentUser) return;
    var p = findPlayer(currentUser.id) || currentUser;
    var rank = (typeof getRank === 'function') ? getRank(p.pts, p.id) : { id: '', label: '' };
    var prog = (typeof rankProgress === 'function') ? rankProgress(p.pts) : { next: null };
    var cheer = RANK_CHEER[rank.id] || 'เก่งมาก เลื่อนอันดับสำเร็จ!';
    var goal = (prog && prog.next)
      ? ' เป้าหมายถัดไป: ' + prog.next.label + ' (อีก ~' + Math.max(0, prog.next.min - p.pts) + ' คะแนน) สู้ๆ!'
      : '';
    bubble({
      text: '🎉 ยินดีด้วย! คุณเลื่อนขึ้น ' + (rank.label || '') + ' แล้ว — ' + cheer + goal,
      actionLabel: '📊 ดูการวิเคราะห์ของฉัน',
      onAction: function () { analyzePlayer(currentUser.id); }
    });
  }

  if (typeof closeRankUp === 'function') {
    var _closeRankUpBase = closeRankUp;
    closeRankUp = function () { _closeRankUpBase(); setTimeout(_fireRankUpBubble, 650); };
  }
  if (typeof closeKingRankUp === 'function') {
    var _closeKingRankUpBase = closeKingRankUp;
    closeKingRankUp = function () { _closeKingRankUpBase(); setTimeout(_fireRankUpBubble, 650); };
  }

  // ════════════════════════════════════════════════════════════
  //  #4 — AOF ใน Achievement (อธิบายความหมายเชิงกีฬา)
  // ════════════════════════════════════════════════════════════
  var ACH_EXPLAIN = {
    'Master Player': 'แปลว่าคุณไต่ถึงระดับ Master — กลุ่มผู้เล่นฝีมือดีของสโมสรที่อ่านเกมและคุมจังหวะได้เหนือค่าเฉลี่ย',
    'Conqueror': 'สุดยอด! คุณคือ King of Badminton — อันดับ 1 ที่ทุกคนอยากโค่น รักษาฟอร์มไว้ให้ดี',
    'Prime of Month': 'คุณคือผู้เล่นที่มี Win Rate สูงสุดของเดือน (เล่นเกิน 5 แมตช์) — ความสม่ำเสมอระดับท็อป',
    'ขยันเล่นนะมึงอะ': 'รางวัลคนขยัน! คุณลงสนามมากที่สุดในสัปดาห์ — ชั่วโมงบินคือกุญแจสู่การพัฒนา',
    'Tournament Champion': 'แชมป์ทัวร์นาเมนต์ — พิสูจน์ว่าคุณทำผลงานได้ดีภายใต้แรงกดดันของการแข่งจริง',
    'Super 500 Champion': 'แชมป์ Super 500 — ทัวร์ระดับสูง ต้องผ่านคู่แข่งแกร่งๆ ถึงจะคว้ามาได้',
    'Super 1000 Champion': 'แชมป์ Super 1000 — รายการใหญ่สุด! สุดยอดของความสำเร็จในสโมสร',
    'Doubles Champion': 'แชมป์ประเภทคู่ — การเข้าขากับคู่และการสื่อสารในคอร์ตคือหัวใจของชัยชนะนี้'
  };

  function _fireAchBubble(title, desc) {
    if (!title) return;
    var explain = ACH_EXPLAIN[title] || (desc ? desc + ' — เป็นความสำเร็จที่น่าภูมิใจ เก็บสะสมต่อไปนะ!' :
      'ปลดล็อกความสำเร็จใหม่ — เยี่ยมมาก!');
    bubble({
      text: '🏅 ปลดล็อก "' + title + '" สำเร็จ! ' + explain,
      timeout: 13000
    });
  }

  if (typeof closeAchievement === 'function') {
    var _closeAchBase = closeAchievement;
    closeAchievement = function () {
      // อ่านชื่อ/คำอธิบายจาก overlay ที่ยังโชว์อยู่ก่อนปิด
      var title = '', desc = '';
      var tEl = $('achTitle'), dEl = $('achDesc');
      if (tEl) title = tEl.textContent || '';
      if (dEl) desc = dEl.textContent || '';
      _closeAchBase();
      setTimeout(function () { _fireAchBubble(title.trim(), desc.trim()); }, 600);
    };
  }

  // ════════════════════════════════════════════════════════════
  //  #5 — AOF ใน Hall of Fame (คลิกชื่อ → เล่าเรื่อง/สถิติ)
  // ════════════════════════════════════════════════════════════
  function hofStory(entry) {
    var p = null;
    if (typeof db !== 'undefined' && db.players) {
      p = db.players.find(function (x) { return x.id === entry.id; }) ||
          db.players.find(function (x) { return x.name === entry.name; });
    }
    var lines = [];
    lines.push('👑 <b>' + esc(entry.name) + '</b> คว้าตำแหน่ง <b>Prime ' + esc(entry.season || '?') + '</b> ' +
      'ด้วยคะแนน ' + (entry.pts != null ? Number(entry.pts).toLocaleString() : '?') + ' ในตอนครองบัลลังก์');
    if (entry.defended) lines.push('🛡️ และยังป้องกันแชมป์ได้สำเร็จ — สุดยอดความสม่ำเสมอ!');

    if (p) {
      var total = (p.wins || 0) + (p.losses || 0);
      var wr = total ? Math.round(p.wins / total * 100) : 0;
      var rank = (typeof getRank === 'function') ? getRank(p.pts, p.id) : { label: '' };
      lines.push('ปัจจุบัน: ' + esc(rank.label || '') + ' · ' + (p.pts != null ? p.pts.toLocaleString() : 0) +
        ' คะแนน · ชนะ ' + (p.wins || 0) + ' แพ้ ' + (p.losses || 0) + ' (Win rate ' + wr + '%)');
      var streak = (typeof getPlayerStreak === 'function') ? getPlayerStreak(p.id) : 0;
      if (streak >= 3) lines.push('🔥 ตอนนี้กำลังชนะรวด ' + streak + ' เกมติด!');
    } else {
      lines.push('<span style="color:var(--muted)">ผู้เล่นคนนี้อาจไม่ได้อยู่ในระบบแล้ว แต่ชื่อยังถูกจารึกไว้ในตำนาน</span>');
    }

    var html = lines.map(function (l) { return '<p class="aof-story-p">' + l + '</p>'; }).join('');
    popup('ตำนานแห่งสโมสร', html);
  }

  if (typeof openHoF === 'function') {
    var _openHoFBase = openHoF;
    openHoF = function () {
      _openHoFBase();
      try {
        var entries = (typeof getHoF === 'function') ? getHoF() : [];
        var body = $('hofBody');
        if (!body) return;
        var items = body.querySelectorAll('.hof-item');
        for (var i = 0; i < items.length; i++) {
          if (!entries[i]) continue;
          items[i].classList.add('aof-hof-click');
          items[i].setAttribute('title', 'แตะเพื่อให้ AOF เล่าเรื่องผู้เล่นคนนี้');
          (function (entry) {
            items[i].addEventListener('click', function (ev) {
              ev.stopPropagation();
              hofStory(entry);
            });
          })(entries[i]);
        }
      } catch (e) { /* non-fatal */ }
    };
  }

  // ════════════════════════════════════════════════════════════
  //  #14 — AOF Trash Talk (แซวกันขำๆ ก่อนแมตช์)
  // ════════════════════════════════════════════════════════════
  var TRASH_LINES = [
    '{op} เตรียมเก็บลูกให้ดีนะ วันนี้ {me} จะ smash ใส่รัวๆ 🏸🔥',
    'ได้ยินว่า {op} ซ้อมหนักมาก… แต่เสียดาย {me} ซ้อมหนักกว่า 😎',
    'สนามนี้แคบไปสำหรับเราสองคน {op} — เจอกันที่หน้าเน็ต!',
    '{me} ขอจองแชมป์ไว้ก่อนนะ {op} เป็นกองเชียร์ได้เลย 🏆',
    '{op} อย่าเพิ่งยอมแพ้ตั้งแต่ยังไม่เสิร์ฟนะ 555',
    'ระวัง backhand ของ {me} ให้ดี {op} เดี๋ยวงงว่าลูกไปไหน 🌀',
    '{op} วันนี้มาเล่นแบด หรือมาเก็บลูกให้ {me} กันแน่? 😝',
    'ELO ของ {op} กำลังจะได้ออกกำลังกาย (ลดลง) นะวันนี้ 📉'
  ];

  function trashTalk(opponentName) {
    var me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.name : 'ฉัน';
    var op = opponentName;
    if (!op && typeof db !== 'undefined' && db.players && db.players.length) {
      var others = db.players.filter(function (p) { return !currentUser || p.id !== currentUser.id; });
      if (others.length) op = others[Math.floor(Math.random() * others.length)].name;
    }
    op = op || 'คู่แข่ง';
    var line = TRASH_LINES[Math.floor(Math.random() * TRASH_LINES.length)]
      .replace(/\{me\}/g, me).replace(/\{op\}/g, op);
    return line;
  }

  function _appendChatBot(html) {
    var list = $('aiMessages');
    if (!list) return null;
    var div = document.createElement('div');
    div.className = 'ai-msg ai-msg-bot';
    div.innerHTML = html;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  }

  function doTrashTalk() {
    if (typeof window.aiShowTab === 'function') window.aiShowTab('chat');
    var line = trashTalk();
    var div = _appendChatBot('🔥 <b>Trash Talk:</b><br>"' + esc(line) + '"<br><span style="font-size:.72rem;color:var(--muted)">(แซวกันขำๆ นะ ไปเล่นให้สนุก 😄)</span>');
    if (div) {
      var btn = document.createElement('button');
      btn.className = 'aof-copy-btn';
      btn.textContent = '📋 คัดลอก';
      btn.addEventListener('click', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(line).then(function () {
          if (typeof toast === 'function') toast('คัดลอกแล้ว ✅', 'success');
        });
      });
      div.appendChild(document.createElement('br'));
      div.appendChild(btn);
      var list = $('aiMessages'); if (list) list.scrollTop = list.scrollHeight;
    }
  }

  // ════════════════════════════════════════════════════════════
  //  #15 — AOF Club FAQ (interactive)
  // ════════════════════════════════════════════════════════════
  var FAQ = [
    { q: 'ระบบคะแนน ELO ทำงานยังไง?',
      a: 'คะแนนคือ True ELO Rating — ชนะคนแรงค์สูงได้คะแนนเยอะ แพ้คนแรงค์ต่ำเสียเยอะ. มี K-Factor ตามจำนวนแมตช์ (ใหม่ K=48, กลาง K=32, เก่า K=24), ตัวคูณตามผลต่างแต้ม (สูสี×1.0 ถึงขาดลอย×2.0) และโบนัสตามอันดับของผู้ชนะ' },
    { q: 'Rank มีกี่ระดับ?',
      a: 'มี 7 ระดับตามคะแนน: 🥉 Bronze (0+), 🥈 Silver (101+), 🥇 Gold (301+), 💎 Platinum (501+), 💠 Diamond (801+), 🔥 Master (1201+), 👑 King (2000+ และเป็นอันดับ 1)' },
    { q: 'Season Reset คืออะไร?',
      a: 'ทุกวันที่ 1 ของเดือนคะแนนจะถูกปรับตามแรงค์: King→1000, Master→800, Diamond→500, Platinum→300, Gold→200 ส่วน Silver/Bronze ไม่โดนรี. ผู้เล่นอันดับ 1 (King) จะได้รับ Prime Season Title ติดตัว' },
    { q: 'บันทึกผลแมตช์ยังไง?',
      a: 'ไปแท็บ ⚔️ แมตช์ → เลือก Singles/Doubles และผู้เล่น → เริ่มแมตช์ → เลือกโหมดนับคะแนน (ปกติ/Referee) → จบเกม. ผลจะเข้าคิว "รอ Admin ยืนยัน" ก่อนคะแนนจะมีผล' },
    { q: 'Gacha คืออะไร?',
      a: 'ระบบสุ่มของตกแต่งโปรไฟล์ — กรอบ avatar (frame) และเอฟเฟกต์ชื่อ (name effect) มีหลายระดับความหายาก. ของที่ได้จะเข้า Inventory และนำไปสวมใส่โชว์บน Leaderboard ได้' },
    { q: 'Daily Challenge ได้อะไร?',
      a: 'ภารกิจรายวันในหน้าอันดับ ทำสำเร็จรับรางวัล (เช่นเหรียญ/ของ) — เข้ามาเล่นทุกวันเพื่อสะสมของรางวัล' },
    { q: 'Achievements ปลดล็อกยังไง?',
      a: 'บางอันปลดล็อกอัตโนมัติ (เช่น Master Player, Conqueror, Prime of Month) บางอัน Admin มอบให้ (ทัวร์นาเมนต์/รางวัลพิเศษ). ในหน้าโปรไฟล์ติ๊กเลือก achievement ที่อยากให้โชว์บน Leaderboard ได้' },
    { q: 'จุดสีเขียวข้างชื่อคืออะไร?',
      a: 'คือสถานะออนไลน์ — เขียว = กำลังใช้งานใน 3 นาทีล่าสุด ส่วนตัวเลขคือ "ออนไลน์ล่าสุดเมื่อ…"' },
    { q: 'Tournament เล่นยังไง?',
      a: 'ระบบทัวร์นาเมนต์แบบแบ่งกลุ่ม/สาย จัดและจับคู่โดย Admin มีหลายระดับ (Regular / Super 500 / Super 1000) ผู้ชนะได้ Achievement แชมป์ติดตัว' }
  ];

  function buildFaqPanel() {
    var panel = document.createElement('div');
    panel.id = 'aiPanelFaq';
    panel.style.display = 'none';
    var head = document.createElement('div');
    head.className = 'ai-head-sub';
    head.style.marginBottom = '10px';
    head.innerHTML = 'คำถามที่พบบ่อยเกี่ยวกับสโมสร — แตะเพื่อดูคำตอบ หรือกด <b>💬 ถาม AOF</b> เพื่อถามต่อในแชท';
    panel.appendChild(head);

    FAQ.forEach(function (item) {
      var box = document.createElement('div');
      box.className = 'aof-faq-item';
      var qBtn = document.createElement('button');
      qBtn.className = 'aof-faq-q';
      qBtn.type = 'button';
      qBtn.innerHTML = '<span>❓ ' + esc(item.q) + '</span><span class="aof-faq-caret">▾</span>';
      var ans = document.createElement('div');
      ans.className = 'aof-faq-a';
      ans.innerHTML = '<p>' + esc(item.a) + '</p>';
      var ask = document.createElement('button');
      ask.className = 'aof-faq-ask';
      ask.type = 'button';
      ask.textContent = '💬 ถาม AOF';
      ask.addEventListener('click', function (e) {
        e.stopPropagation();
        openChat(item.q, true);
      });
      ans.appendChild(ask);
      qBtn.addEventListener('click', function () {
        var open = box.classList.toggle('open');
        ans.style.display = open ? '' : 'none';
      });
      ans.style.display = 'none';
      box.appendChild(qBtn);
      box.appendChild(ans);
      panel.appendChild(box);
    });
    return panel;
  }

  // ════════════════════════════════════════════════════════════
  //  WIRE-UP ภายในการ์ด AI: FAQ tab, chips, voice (#11), minimize (#12)
  // ════════════════════════════════════════════════════════════
  function injectAiCardExtras() {
    var card = document.querySelector('#aiSection .ai-card');
    if (!card || card._aofWired) return;
    card._aofWired = true;

    // ---- #15 FAQ tab ----
    var tabRow = card.querySelector('.ai-tab-row');
    if (tabRow && !$('aiTabFaq')) {
      var faqTab = document.createElement('button');
      faqTab.className = 'tab';
      faqTab.id = 'aiTabFaq';
      faqTab.type = 'button';
      faqTab.textContent = '❓ FAQ';
      faqTab.addEventListener('click', function () { window.aiShowTab('faq'); });
      tabRow.appendChild(faqTab);
    }
    if (!$('aiPanelFaq')) card.appendChild(buildFaqPanel());

    // override aiShowTab ให้รองรับ panel faq
    if (!window._aofTabPatched && typeof window.aiShowTab === 'function') {
      window._aofTabPatched = true;
      var _baseShowTab = window.aiShowTab;
      window.aiShowTab = function (tab) {
        var faqPanel = $('aiPanelFaq'), faqTabEl = $('aiTabFaq');
        if (tab === 'faq') {
          var chat = $('aiPanelChat'), settings = $('aiPanelSettings');
          if (chat) chat.style.display = 'none';
          if (settings) settings.style.display = 'none';
          if (faqPanel) faqPanel.style.display = '';
          var ct = $('aiTabChat'), st = $('aiTabSettings');
          if (ct) ct.classList.remove('active');
          if (st) st.classList.remove('active');
          if (faqTabEl) faqTabEl.classList.add('active');
        } else {
          if (faqPanel) faqPanel.style.display = 'none';
          if (faqTabEl) faqTabEl.classList.remove('active');
          _baseShowTab(tab);
        }
      };
    }

    // ---- chips เหนือช่องพิมพ์ (trash talk / วิเคราะห์ / faq) ----
    var inputRow = card.querySelector('.ai-input-row');
    if (inputRow && !$('aofChips')) {
      var chips = document.createElement('div');
      chips.id = 'aofChips';
      chips.className = 'aof-chips';
      var defs = [
        { t: '🔥 ยั่วคู่แข่ง', fn: doTrashTalk },
        { t: '📊 วิเคราะห์ฉัน', fn: function () { if (currentUser) analyzePlayer(currentUser.id); } },
        { t: '❓ FAQ', fn: function () { window.aiShowTab('faq'); } },
        { t: '🆕 v7.5', fn: showPatchNotes }
      ];
      defs.forEach(function (d) {
        var c = document.createElement('button');
        c.className = 'aof-chip';
        c.type = 'button';
        c.textContent = d.t;
        c.addEventListener('click', d.fn);
        chips.appendChild(c);
      });
      inputRow.parentNode.insertBefore(chips, inputRow);
    }

    // ---- #11 Voice input ----
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && inputRow && !$('aofMicBtn')) {
      var mic = document.createElement('button');
      mic.id = 'aofMicBtn';
      mic.className = 'aof-mic';
      mic.type = 'button';
      mic.textContent = '🎤';
      mic.title = 'พูดคำถาม (เสียง)';
      var rec = null, listening = false;
      mic.addEventListener('click', function () {
        if (listening && rec) { rec.stop(); return; }
        rec = new SR();
        rec.lang = isTH() ? 'th-TH' : 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onstart = function () { listening = true; mic.classList.add('listening'); };
        rec.onerror = function () { listening = false; mic.classList.remove('listening'); };
        rec.onend = function () { listening = false; mic.classList.remove('listening'); };
        rec.onresult = function (ev) {
          var txt = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : '';
          var inp = $('aiInput');
          if (inp && txt) { inp.value = txt; inp.focus(); }
        };
        try { rec.start(); } catch (e) { /* already running */ }
      });
      // วางปุ่มไมค์ไว้ก่อนปุ่มส่ง
      var sendBtn = $('aiSendBtn');
      if (sendBtn) inputRow.insertBefore(mic, sendBtn);
      else inputRow.appendChild(mic);
    }

    // ---- #12 Minimize button ในหัวข้อ AI ----
    var hero = card.parentNode ? card.parentNode.querySelector('.lb-hero') : null;
    if (!hero) hero = document.querySelector('#aiSection .lb-hero');
    if (hero && !$('aofMinBtn')) {
      var minBtn = document.createElement('button');
      minBtn.id = 'aofMinBtn';
      minBtn.className = 'aof-min-btn';
      minBtn.type = 'button';
      minBtn.innerHTML = '▽ ย่อ';
      minBtn.title = 'ย่อ AOF แล้วใช้งานหน้าอื่นต่อ';
      minBtn.addEventListener('click', minimizeChat);
      hero.appendChild(minBtn);
    }
  }

  // ── #12 Minimize / restore (pill ลอยมุมขวาล่าง) ──
  var _prevSection = 'leaderboard';

  function ensurePill() {
    var pill = $('aofPill');
    if (pill) return pill;
    pill = document.createElement('button');
    pill.id = 'aofPill';
    pill.type = 'button';
    pill.className = 'aof-pill';
    pill.innerHTML = '<span class="aof-pill-av">🤖</span><span class="aof-pill-tx">AOF</span><span class="aof-pill-x" title="ซ่อน">✕</span>';
    pill.addEventListener('click', function (e) {
      if (e.target && e.target.classList.contains('aof-pill-x')) { hidePill(); return; }
      if (typeof showSection === 'function') showSection('ai');
    });
    document.body.appendChild(pill);
    return pill;
  }
  function showPill() { var p = ensurePill(); requestAnimationFrame(function () { p.classList.add('show'); }); }
  function hidePill() { var p = $('aofPill'); if (p) p.classList.remove('show'); }

  function minimizeChat() {
    var target = (_prevSection && _prevSection !== 'ai') ? _prevSection : 'leaderboard';
    if (typeof showSection === 'function') showSection(target);
    showPill();
  }

  // ════════════════════════════════════════════════════════════
  //  #7 Weekly Digest  +  #9 Season Countdown (proactive bubbles)
  // ════════════════════════════════════════════════════════════
  function isoWeekKey(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var wk = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + (wk < 10 ? '0' + wk : wk);
  }

  function weeklyDigest(showAlways) {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    var p = findPlayer(currentUser.id);
    if (!p) return;
    var wk = isoWeekKey(new Date());
    var key = 'aof_week_snap_' + currentUser.id;
    var snap = null;
    try { snap = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}

    // auto: โชว์ครั้งเดียวต่อสัปดาห์
    var shownKey = 'aof_digest_shown_' + currentUser.id;
    if (!showAlways && localStorage.getItem(shownKey) === wk) return;

    var label = '', dW = 0, dL = 0, dPts = 0, have = false;
    var snapNow = { week: wk, pts: p.pts || 0, wins: p.wins || 0, losses: p.losses || 0 };
    if (snap && snap.week === wk) {
      // กลางสัปดาห์ → ความคืบหน้าตั้งแต่ต้นสัปดาห์นี้
      label = 'สัปดาห์นี้';
      dW = (p.wins || 0) - (snap.wins || 0); dL = (p.losses || 0) - (snap.losses || 0); dPts = (p.pts || 0) - (snap.pts || 0);
      have = true;
    } else if (snap) {
      // ขึ้นสัปดาห์ใหม่ → สรุป "สัปดาห์ที่ผ่านมา" จาก baseline เก่า แล้วรีเซ็ต baseline เป็นต้นสัปดาห์นี้
      label = 'สัปดาห์ที่ผ่านมา';
      dW = (p.wins || 0) - (snap.wins || 0); dL = (p.losses || 0) - (snap.losses || 0); dPts = (p.pts || 0) - (snap.pts || 0);
      have = true;
      localStorage.setItem(key, JSON.stringify(snapNow));
    } else {
      // ครั้งแรกสุด → ตั้ง baseline
      localStorage.setItem(key, JSON.stringify(snapNow));
    }

    if (!showAlways) localStorage.setItem(shownKey, wk);

    var summary;
    if (have && (dW || dL || dPts)) {
      var net = dPts >= 0 ? '+' + dPts : '' + dPts;
      summary = '📅 สรุป' + label + ': ชนะ ' + dW + ' · แพ้ ' + dL + ' · ELO ' + net + ' คะแนน';
      if (dPts > 0) summary += ' กำลังไปได้สวย! 🚀';
      else if (dPts < 0) summary += ' สู้ๆ ทวงคืนได้! 💪';
    } else if (have) {
      summary = '📅 ' + label + ': ยังไม่มีแมตช์ที่บันทึก — ลงเล่นเก็บคะแนนกันเถอะ! 🏸';
    } else {
      summary = '📅 เริ่มเก็บสถิติรายสัปดาห์แล้ว! เล่นไปเรื่อยๆ เดี๋ยว AOF สรุปผลให้ทุกสัปดาห์';
    }

    bubble({
      text: summary,
      actionLabel: '📊 ดูสถิติของฉัน',
      onAction: function () { analyzePlayer(currentUser.id); },
      timeout: 16000
    });
  }

  function seasonCountdown() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    if (typeof getDaysUntilReset !== 'function') return;
    var days = getDaysUntilReset();
    if (days > 7) return;

    var today = new Date().toISOString().slice(0, 10);
    var key = 'aof_season_warn_' + currentUser.id;
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);

    var p = findPlayer(currentUser.id);
    if (!p) return;
    var rank = (typeof getRank === 'function') ? getRank(p.pts, p.id) : { id: '', label: '' };
    var resetPts = (typeof getSeasonResetPts === 'function') ? getSeasonResetPts(rank.id) : null;

    var msg;
    if (resetPts !== null && resetPts !== undefined && p.pts > resetPts) {
      msg = '⏳ เหลืออีก ' + days + ' วันก่อน Season Reset! แรงค์ ' + (rank.label || '') +
        ' จะถูกปรับเหลือ ' + resetPts + ' คะแนน (ตอนนี้คุณ ' + p.pts.toLocaleString() + ') — ลงเล่นรักษาฟอร์มไว้นะ!';
    } else {
      msg = '⏳ เหลืออีก ' + days + ' วันก่อน Season Reset — อันดับของคุณปลอดภัยจากการรีเซ็ต ✅ เก็บแต้มเพิ่มได้เลย!';
    }
    bubble({ text: msg, timeout: 15000 });
  }

  // ════════════════════════════════════════════════════════════
  //  ❌ NEMESIS SHAME — "ไม่คู่ควร" (ไม่เกี่ยวกับ AI)
  // ════════════════════════════════════════════════════════════
  var SHAME_THRESHOLD = 5; // แพ้คนเดียวกี่ครั้งขึ้นไปถึงโชว์

  function nemesisShame() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    if (typeof getNemesis !== 'function') return;

    var nemesis = getNemesis(currentUser.id);
    if (!nemesis || nemesis.losses < SHAME_THRESHOLD) return;

    var today = new Date().toISOString().slice(0, 10);
    var key = 'aof_shame_' + currentUser.id + '_' + nemesis.id;
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);

    var el = document.createElement('div');
    el.className = 'aof-shame';
    var sub = 'แพ้ ' + nemesis.name + ' ไปแล้ว ' + nemesis.losses + ' ครั้ง — ถึงเวลาล้างแค้น! 🔥';
    el.innerHTML =
      '<div class="aof-shame-inner">' +
        '<div class="aof-shame-vs">vs ' + esc(nemesis.name) + '</div>' +
        '<div class="aof-shame-text">ไม่คู่ควร</div>' +
        '<div class="aof-shame-sub">' + esc(sub) + '</div>' +
        '<button class="aof-shame-tap" type="button">แตะเพื่อปิด</button>' +
      '</div>';

    function dismissShame() {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
    }
    el.addEventListener('click', dismissShame);
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    // ปิดอัตโนมัติหลัง 4.5 วินาที
    setTimeout(dismissShame, 4500);
  }

  // ════════════════════════════════════════════════════════════
  //  📋 PATCH NOTES — แสดงอัปเดตเมื่อ version ใหม่
  // ════════════════════════════════════════════════════════════
  var PATCH_VER = '7.5';

  function _patchItem(icon, title, desc) {
    return '<li style="display:flex;gap:9px;align-items:flex-start;padding:4px 0">' +
      '<span style="flex-shrink:0;font-size:.95rem;margin-top:1px">' + icon + '</span>' +
      '<span><b style="color:var(--text);font-size:.85rem">' + esc(title) + '</b>' +
      '<span style="color:var(--muted);font-size:.78rem;display:block;margin-top:1px">' + esc(desc) + '</span></span>' +
      '</li>';
  }

  function buildPatchNotesEl() {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'line-height:1.5;max-width:420px';
    wrap.innerHTML =
      '<div style="text-align:center;margin-bottom:14px">' +
        '<div style="font-size:.75rem;font-weight:700;letter-spacing:.12em;color:var(--muted);text-transform:uppercase">🏸 Badminton Club</div>' +
        '<div style="font-size:1.55rem;font-weight:900;color:var(--neon);margin:2px 0">v7.5 — AOF Assistance 2.0</div>' +
        '<div style="font-size:.82rem;color:var(--muted)">AOF ไม่ได้มีแค่แชทอีกต่อไป — อยู่ทุกที่ในเว็บ</div>' +
      '</div>' +

      '<div style="font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--glass-border)">🤖 AOF Expansion Pack</div>' +
      '<ul style="margin:0 0 14px 0;padding:0;list-style:none">' +
        _patchItem('🎉', 'Rank Up Message', 'AOF ส่งข้อความยินดีพร้อมเป้าหมายแรงค์ถัดไปหลัง rank up') +
        _patchItem('🏅', 'Achievement Explainer', 'AOF อธิบายความหมายของ achievement ที่เพิ่งปลดล็อค') +
        _patchItem('👑', 'Hall of Fame Stories', 'คลิกชื่อใน HoF → AOF เล่าสถิติและเรื่องราวพิเศษ') +
        _patchItem('📅', 'Weekly Digest', 'สรุปผล 7 วัน: ชนะ / แพ้ / ELO เปลี่ยนไปเท่าไหร่') +
        _patchItem('⏳', 'Season Countdown', 'แจ้งเตือนเมื่อ Season Reset ใกล้ถึง (≤7 วัน)') +
        _patchItem('📊', 'Player Analysis', 'ปุ่ม 🤖 ใน Leaderboard → วิเคราะห์จุดแข็ง/อ่อนทันที') +
        _patchItem('🎤', 'Voice Input', 'ปุ่มไมค์ในแชท — พูดแทนการพิมพ์ รองรับภาษาไทย') +
        _patchItem('▽', 'Minimize Mode', 'ย่อแชทเป็น pill ลอยมุมขวาล่าง เปิดได้ทุกหน้า') +
        _patchItem('🔥', 'Trash Talk', 'สร้างประโยคแซวคู่แข่งสนุกๆ ด้วยปุ่ม chip ในแชท') +
        _patchItem('❓', 'Club FAQ', 'แท็บ FAQ ใน AI — 9 คำถามที่พบบ่อย ตอบทันที') +
      '</ul>' +

      '<div style="border-radius:10px;background:rgba(255,71,87,0.1);border:1px solid rgba(255,71,87,0.3);padding:11px 13px;margin-bottom:4px">' +
        '<div style="font-weight:900;color:#ff4757;font-size:1rem;letter-spacing:.1em">❌ ไม่คู่ควร <span style="font-size:.72rem;font-weight:500;opacity:.7">NEW</span></div>' +
        '<div style="color:var(--muted);font-size:.8rem;margin-top:3px">แพ้คนเดียวกัน ≥5 ครั้ง → overlay เต็มจอสีแดง ลุกโชน ปิดเองใน 4.5 วิ</div>' +
      '</div>';
    return wrap;
  }

  function showPatchNotes() {
    popup('📋 อัปเดต v' + PATCH_VER, buildPatchNotesEl());
  }

  function patchNotesBubble() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    var key = 'aof_patch_seen_' + PATCH_VER;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    bubble({
      text: '🆕 v' + PATCH_VER + ' — AOF Assistance 2.0 มาแล้ว! ฟีเจอร์ใหม่ 12 อย่าง รวมถึง "ไม่คู่ควร" 🔴',
      actionLabel: '📋 ดูอัปเดต',
      onAction: showPatchNotes,
      timeout: 20000
    });
  }

  // เรียก proactive หลังเข้า Leaderboard (มี guard กันเด้งซ้ำ)
  function maybeProactive() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    if (typeof db === 'undefined' || !db.players || !db.players.length) return;
    if (_overlayBusy()) return;
    nemesisShame();
    setTimeout(function () {
      patchNotesBubble();
      seasonCountdown();
      weeklyDigest(false);
    }, 800);
  }

  // ════════════════════════════════════════════════════════════
  //  HOOK showSection — track prev section, minimize pill, proactive
  // ════════════════════════════════════════════════════════════
  if (typeof showSection === 'function') {
    var _showSectionBase = showSection;
    showSection = function (name) {
      var curActive = document.querySelector('.section.active');
      var curId = curActive ? curActive.id.replace('Section', '') : null;
      if (name === 'ai' && curId && curId !== 'ai') _prevSection = curId;

      _showSectionBase(name);

      if (name === 'ai') {
        hidePill();
        injectAiCardExtras();
        if (typeof window.aiShowTab === 'function') {
          // ให้แน่ใจว่า panel ตั้งค่าถูกหลัง inject (chat เป็น default)
          var active = $('aiTabFaq') && $('aiTabFaq').classList.contains('active') ? 'faq'
            : ($('aiTabSettings') && $('aiTabSettings').classList.contains('active') ? 'settings' : 'chat');
          if (active === 'faq') window.aiShowTab('faq');
        }
      }
      if (name === 'leaderboard') {
        setTimeout(maybeProactive, 2600);
      }
    };
  }

  // ── logout: เก็บกวาด pill + flag ──
  if (typeof logout === 'function') {
    var _logoutBase = logout;
    logout = function () {
      hidePill();
      _bubbleQueue = []; _bubbleActive = false;
      _logoutBase();
    };
  }

  // ── init เมื่อ DOM พร้อม (สคริปต์อยู่ท้าย body แล้ว แต่กันไว้) ──
  function init() {
    injectAiCardExtras();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── public API (เผื่อเรียกจากที่อื่น/debug) ──
  window.AOF = {
    bubble: bubble,
    popup: popup,
    openChat: openChat,
    analyzePlayer: analyzePlayer,
    playerStats: playerStats,
    trashTalk: trashTalk,
    weeklyDigest: function () { weeklyDigest(true); },
    seasonCountdown: seasonCountdown,
    nemesisShame: nemesisShame,
    patchNotes: showPatchNotes,
    minimize: minimizeChat
  };
})();
