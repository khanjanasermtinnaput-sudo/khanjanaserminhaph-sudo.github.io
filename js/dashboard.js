/* ═══════════════════════════════════════════════════════════════
   BK CLUB — DASHBOARD CONTROLLER (v8.0)
   Loads LAST. Adds a dashboard-first Home experience on top of the
   existing single-page app WITHOUT removing any feature:
     • Compact sticky profile header (avatar / rank icon / ELO)
     • Home = one dashboard with Top-3 podium + IA-grouped feature grid
     • Every card routes to an existing section/modal/function
   All legacy nav IDs are preserved (hidden) so existing JS keeps working.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Information Architecture: features grouped by USER GOAL ──────
  // Each item maps to a REAL existing feature (section, modal or fn).
  // `badge`: 'pending' | 'mailbox' | 'new' resolved dynamically.
  const DASH_GROUPS = [
    {
      label: '🏸 เล่น · Play',
      items: [
        { icon: '⚔️', title: 'แมตช์', desc: 'เล่น Singles / Doubles', go: () => showSection('match') },
        { icon: '🏆', title: 'Tournament', desc: 'สายแข่ง · กลุ่ม · รอบชิง', go: () => showSection('tournament') },
        { icon: '👆', title: 'Referee Mode', desc: 'นับคะแนนปุ่มใหญ่', go: () => showSection('match') },
      ],
    },
    {
      label: '📊 แข่งขัน · Competition',
      items: [
        { icon: '🥇', title: 'อันดับ', desc: 'Leaderboard · ELO', go: () => showSection('leaderboard') },
        { icon: '🏛️', title: 'Hall of Fame', desc: 'Kings of Badminton', go: () => callIf('openHoF') },
        { icon: '📈', title: 'สถิติ', desc: 'กราฟ · ฟอร์ม · เทรนด์', go: () => showSection('stats') },
      ],
    },
    {
      label: '🎮 ความก้าวหน้า · Progress',
      items: [
        { icon: '👤', title: 'โปรไฟล์', desc: 'ข้อมูล · ซีซั่น · แรงค์', go: () => showSection('profile') },
        { icon: '🏅', title: 'Achievements', desc: 'รางวัลที่ปลดล็อค', go: () => showSection('profile') },
        { icon: '📋', title: 'ประวัติ', desc: 'แมตช์ย้อนหลังทั้งหมด', go: () => showSection('history') },
      ],
    },
    {
      label: '🎁 รางวัล · Rewards',
      items: [
        { icon: '✦', title: 'Gacha', desc: 'สะสมธาตุ · กรอบ · เอฟเฟกต์', go: () => showSection('gacha') },
        { icon: '🎰', title: 'Gacha Pull', desc: 'สุ่มด้วยเหรียญ', go: () => callIf('openGachaPull') },
        { icon: '📬', title: 'กล่องของขวัญ', desc: 'รับไอเทมจาก Admin', badge: 'mailbox', go: () => callIf('openMailbox') },
      ],
    },
    {
      label: '🤖 ผู้ช่วย · Utilities',
      items: [
        { icon: '🤖', title: 'AOF Assistance', desc: 'AI ผู้ช่วยอัจฉริยะ', badge: 'new', go: () => showSection('ai') },
        { icon: '🔔', title: 'การแจ้งเตือน', desc: 'แมตช์ · รางวัล · ระบบ', go: () => callIf('toggleNotifPanel') },
        { icon: '📲', title: 'อัปเดต', desc: 'Patch Notes ล่าสุด', go: () => callIf('showPatchNotes') },
      ],
    },
    {
      label: '⚙️ จัดการ · Administration',
      adminOnly: true,
      items: [
        { icon: '⚙️', title: 'Admin Panel', desc: 'ยืนยันแมตช์ · จัดการผู้เล่น', badge: 'pending', adminOnly: true, go: () => showSection('admin') },
      ],
    },
  ];

  function callIf(fnName) { if (typeof window[fnName] === 'function') window[fnName](); }

  // ── Build the Home section DOM once ─────────────────────────────
  function buildHomeSection() {
    if (document.getElementById('homeSection')) return;
    const sec = document.createElement('div');
    sec.id = 'homeSection';
    sec.className = 'section';
    sec.innerHTML =
      '<div class="bk-dash-stats" id="bkDashStats"></div>' +
      '<div class="bk-dash-podium">' +
        '<div class="bk-sec-label">🥇 Top 3 <button class="bk-sec-link" onclick="showSection(\'leaderboard\')">ดูทั้งหมด →</button></div>' +
        '<div class="lb-podium" id="homePodium"></div>' +
      '</div>' +
      '<div class="bk-dashboard" id="bkDashboard"></div>';
    // insert right after the (legacy) leaderboard section so section order is sane
    const lb = document.getElementById('leaderboardSection');
    if (lb && lb.parentNode) lb.parentNode.insertBefore(sec, lb);
    else document.body.appendChild(sec);
    buildFeatureGrid();
  }

  function buildFeatureGrid() {
    const wrap = document.getElementById('bkDashboard');
    if (!wrap) return;
    const admin = (typeof isAdminUser === 'function') && isAdminUser();
    wrap.innerHTML = DASH_GROUPS.map(g => {
      if (g.adminOnly && !admin) return '';
      const cards = g.items.map((it, i) => {
        const adminCls = it.adminOnly ? ' bk-feat-admin' : '';
        return '<button class="bk-feat-card' + adminCls + '" data-grp="' + esc(g.label) +
          '" data-idx="' + i + '"' + (it.badge ? ' data-badge="' + it.badge + '"' : '') + '>' +
          (it.badge ? '<span class="bk-feat-badge' + badgeClass(it.badge) + ' bk-feat-hidden" data-badge-el="' + it.badge + '">' + badgeText(it.badge) + '</span>' : '') +
          '<span class="bk-feat-icon">' + it.icon + '</span>' +
          '<span class="bk-feat-body"><span class="bk-feat-title">' + esc(it.title) + '</span>' +
          '<span class="bk-feat-desc">' + esc(it.desc) + '</span></span>' +
        '</button>';
      }).join('');
      return '<div class="bk-dash-group"><div class="bk-dash-group-label">' + esc(g.label) + '</div>' +
        '<div class="bk-dash-grid">' + cards + '</div></div>';
    }).join('');
    // wire clicks (delegation) + ripple
    wrap.querySelectorAll('.bk-feat-card').forEach(card => {
      card.addEventListener('click', function (e) {
        addRipple(card, e);
        const grpLabel = card.getAttribute('data-grp');
        const idx = +card.getAttribute('data-idx');
        const grp = DASH_GROUPS.find(x => x.label === grpLabel);
        if (grp && grp.items[idx] && typeof grp.items[idx].go === 'function') grp.items[idx].go();
      });
    });
    refreshDashBadges();
  }

  function badgeClass(type) {
    if (type === 'new') return ' bk-badge-new';
    if (type === 'pending' || type === 'mailbox') return ' bk-badge-warn';
    return '';
  }
  function badgeText(type) {
    if (type === 'new') return 'NEW';
    if (type === 'mailbox') return 'มีของ';
    if (type === 'pending') return '!';
    return '';
  }

  function addRipple(card, e) {
    if (document.documentElement.getAttribute('data-style') === 'lite') return;
    const r = card.getBoundingClientRect();
    const d = Math.max(r.width, r.height);
    const span = document.createElement('span');
    span.className = 'bk-ripple';
    span.style.width = span.style.height = d + 'px';
    span.style.left = ((e.clientX - r.left) - d / 2) + 'px';
    span.style.top = ((e.clientY - r.top) - d / 2) + 'px';
    card.appendChild(span);
    setTimeout(() => span.remove(), 520);
  }

  // ── Dynamic badges (mailbox / admin pending / NEW) ──────────────
  function refreshDashBadges() {
    // 'new' is always shown
    document.querySelectorAll('[data-badge-el="new"]').forEach(el => el.classList.remove('bk-feat-hidden'));
    // mailbox — mirror the legacy #mailboxDot ".show" state
    const dot = document.getElementById('mailboxDot');
    const hasMail = dot && dot.classList.contains('show');
    document.querySelectorAll('[data-badge-el="mailbox"]').forEach(el => el.classList.toggle('bk-feat-hidden', !hasMail));
    // admin pending — read legacy #pendingBadge (rendered by admin view)
    const pb = document.getElementById('pendingBadge');
    const cnt = pb && !pb.classList.contains('hidden') ? (pb.textContent || '').trim() : '';
    document.querySelectorAll('[data-badge-el="pending"]').forEach(el => {
      const show = cnt && cnt !== '0';
      el.classList.toggle('bk-feat-hidden', !show);
      if (show) el.textContent = cnt;
    });
  }
  window.bkRefreshDashBadges = refreshDashBadges;

  // ── Compact header updater ──────────────────────────────────────
  function updateHeader() {
    if (!currentUser) return;
    const p = (db.players || []).find(x => x.id === currentUser.id) || currentUser;
    // avatar
    const avEl = document.getElementById('hdrAvatar');
    if (avEl && typeof getAvatar === 'function') {
      const a = getAvatar(p.id, p.name);
      const frameCls = (typeof getGachaFrameClass === 'function') ? getGachaFrameClass(p) : '';
      const frameInner = (typeof getGachaFrameInner === 'function') ? getGachaFrameInner(p) : '';
      avEl.className = 'bk-hdr-av' + (frameCls ? ' ' + frameCls : '');
      avEl.style.cssText = 'background:' + a.bg + ';color:' + a.fg + ';' + (a.fs ? 'font-size:' + a.fs + ';' : '') +
        'width:34px;height:34px;border-radius:50%;position:relative;isolation:isolate';
      avEl.innerHTML = frameInner + a.content;
    }
    // name (+ gacha name effect)
    const nmEl = document.getElementById('navName');
    if (nmEl) {
      nmEl.textContent = p.name;
      const nameCls = (typeof getGachaNameClass === 'function') ? getGachaNameClass(p) : '';
      nmEl.className = 'bk-hdr-name' + (nameCls ? ' ' + nameCls : '');
    }
    // rank — ICON ONLY (never text like "Diamond II")
    const rkEl = document.getElementById('hdrRank');
    if (rkEl && typeof getRankBadgeSVG === 'function') {
      rkEl.innerHTML = getRankBadgeSVG(p.pts, p.id, 30);
    }
    // ELO score
    const eloEl = document.getElementById('hdrElo');
    if (eloEl) eloEl.textContent = (p.pts != null ? p.pts : 0).toLocaleString();
  }
  window.bkUpdateHeader = updateHeader;

  // ── Home renderer: quick stats + podium ─────────────────────────
  async function renderHome() {
    buildHomeSection();
    try { if (typeof loadAll === 'function') await loadAll(); } catch (e) {}
    const players = (db && db.players) ? [...db.players] : [];
    const sorted = players.sort((a, b) => b.pts - a.pts);
    updateHeader();
    buildFeatureGrid(); // re-eval adminOnly after data loads

    // quick stats
    const totalMatches = (db && db.matches) ? db.matches.length : 0;
    let bestWR = 0, bestWRName = '—';
    sorted.forEach(p => {
      const t = p.wins + p.losses;
      if (t >= 3) { const wr = Math.round(p.wins / t * 100); if (wr > bestWR) { bestWR = wr; bestWRName = p.name; } }
    });
    const statsEl = document.getElementById('bkDashStats');
    if (statsEl) {
      statsEl.innerHTML =
        qstat('👥', sorted.length, 'ผู้เล่น') + sep() +
        qstat('⚔️', totalMatches, 'แมตช์') + sep() +
        qstat('🎯', bestWR + '%', 'Win สูงสุด') + sep() +
        qstat('🪙', (currentUser && curP(sorted).coins) || 0, 'เหรียญ');
    }

    // podium (reuse legacy .lb-pc markup → premium look from styles.css)
    renderPodium(sorted.slice(0, 3));
    refreshDashBadges();
  }
  function curP(sorted) { return sorted.find(x => x.id === currentUser.id) || {}; }
  function qstat(icon, val, lbl) {
    return '<div class="bk-qstat"><div class="bk-qstat-val">' + val + '</div>' +
      '<div class="bk-qstat-lbl">' + icon + ' ' + esc(lbl) + '</div></div>';
  }
  function sep() { return '<div class="bk-qstat-sep"></div>'; }

  function renderPodium(top3) {
    const el = document.getElementById('homePodium');
    if (!el) return;
    if (!top3.length) { el.innerHTML = '<div class="text-muted" style="text-align:center;padding:18px">ยังไม่มีผู้เล่น</div>'; return; }
    const order = [top3[1], top3[0], top3[2]].filter(Boolean);
    const classes = top3[1] ? ['lbr2', 'lbr1', 'lbr3'] : ['lbr1', 'lbr3'];
    const rankLabel = ['อันดับ 2', 'อันดับ 1', 'อันดับ 3'];
    const rankClass = ['lbsilv', 'lbgold', 'lbbrnz'];
    el.innerHTML = order.map((p, i) => {
      if (!p) return '';
      const cls = classes[i];
      const isFirst = cls === 'lbr1';
      const av = getAvatar(p.id, p.name);
      const wr = (p.wins + p.losses) > 0 ? Math.round(p.wins / (p.wins + p.losses) * 100) : 0;
      const frameCls = getGachaFrameClass(p);
      const useLiquid = isFirst && !frameCls;
      return '<div class="lb-pc lb-glass ' + cls + '" style="animation-delay:' + (i * .12 + .28) + 's" onclick="openPlayerProfile(' + p.id + ')">' +
        '<div class="lb-pod-shim"></div>' +
        '<div class="lb-pod-rank ' + rankClass[i] + '">' + rankLabel[i] + '</div>' +
        '<div class="lb-pod-av ' + (useLiquid ? 'liquid-frame ' : '') + frameCls + '" style="background:' + av.bg + ';color:' + av.fg + ';' + (av.fs ? 'font-size:' + av.fs + ';' : '') + 'position:relative;isolation:isolate">' +
          (useLiquid ? getLiquidFrameInner() : '') + getGachaFrameInner(p) + av.content + '</div>' +
        '<div class="lb-pod-name ' + getGachaNameClass(p) + '">' + esc(p.name) + '</div>' +
        '<div class="lb-pod-score">' + p.pts.toLocaleString() + '</div>' +
        '<div class="lb-pod-wins">ชนะ ' + p.wins + ' · แพ้ ' + p.losses + ' · ' + wr + '%</div>' +
      '</div>';
    }).join('');
    // animate in
    requestAnimationFrame(() => {
      const isLite = document.documentElement.getAttribute('data-style') === 'lite';
      el.querySelectorAll('.lb-pc').forEach((c, i) => {
        if (isLite) { c.classList.add('lbvis'); c.style.opacity = '1'; c.style.transform = 'none'; }
        else setTimeout(() => c.classList.add('lbvis'), i * 120 + 100);
      });
    });
  }
  window.renderHome = renderHome;

  // ── Patch showSection so 'home' renders the dashboard ───────────
  function patchShowSection() {
    if (typeof window.showSection !== 'function') return;
    const base = window.showSection;
    window.showSection = function (name) {
      base(name);
      if (name === 'home') {
        // clear any legacy nav active state, activate logo conceptually
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        renderHome();
      }
    };
  }

  // ── Land on Home after login; keep header fresh ─────────────────
  function patchLifecycle() {
    if (typeof window.afterLogin === 'function') {
      const baseAfter = window.afterLogin;
      window.afterLogin = function () {
        baseAfter();
        try { showSection('home'); } catch (e) {}
        updateHeader();
      };
    }
    if (typeof window.loadAll === 'function') {
      const baseLoad = window.loadAll;
      let last = 0;
      window.loadAll = async function () {
        await baseLoad();
        // throttle header refresh; it's cheap but loadAll runs often
        if (currentUser && Date.now() - last > 1500) { last = Date.now(); updateHeader(); refreshDashBadges(); }
      };
    }
    // keep mailbox badge mirrored on the dashboard card
    if (typeof window.checkMailboxBadge === 'function') {
      const baseMail = window.checkMailboxBadge;
      window.checkMailboxBadge = async function () {
        await baseMail();
        refreshDashBadges();
      };
    }
  }

  // ── Boot ────────────────────────────────────────────────────────
  function boot() {
    buildHomeSection();
    patchShowSection();
    patchLifecycle();
    // if already logged in (e.g. hot reload), refresh
    if (typeof currentUser !== 'undefined' && currentUser) { updateHeader(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
