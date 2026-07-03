/* ═══════════════════════════════════════════════════════════════
   BK CLUB — DASHBOARD CONTROLLER (v8.1)
   Loads LAST. Dashboard-first Home WITHOUT removing any feature:
     • Compact single-row header: 🏆#pos · 👤name · 🛡rank · ⭐ELO · 🔔 · ⋮
     • ⋮ opens a bottom-sheet menu (mailbox / updates / prefs / logout)
     • Home = staggered Top-3 podium + ONE continuous 3-col feature grid
   Legacy nav IDs preserved (hidden) so existing JS keeps working.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── ONE flat list of EVERY existing feature (no categories) ─────
  // badge: 'mailbox' | 'new' resolved dynamically. adminOnly hides for non-admins.
  const DASH_ITEMS = [
    { icon: '⚔️',  name: 'นับคะแนน/บันทึกคะแนน', go: () => showSection('match') },
    { icon: '🏆',  name: 'Tournament',  go: () => showSection('tournament') },
    { icon: '🥇',  name: 'อันดับ',       go: () => showSection('leaderboard') },
    { icon: '📈',  name: 'สถิติ',        go: () => showSection('stats') },
    { icon: '👤',  name: 'โปรไฟล์',      go: () => showSection('profile') },
    { icon: '🏅',  name: 'Achievement', go: () => showSection('profile') },
    { icon: '📜',  name: 'ประวัติ',       go: () => showSection('history') },
    { icon: '✦',   name: 'Gacha',       go: () => showSection('gacha') },
    { icon: '📖',  name: 'Collection',  go: () => showSection('collection') },
    { icon: '🎁',  name: 'รางวัล',        badge: 'mailbox', go: () => callIf('openMailbox') },
    { icon: '🤖',  name: 'AOF AI',       badge: 'new', go: () => showSection('ai') },
    { icon: '🏛️',  name: 'Hall of Fame', go: () => callIf('openHoF') },
    { icon: '🔔',  name: 'แจ้งเตือน',     go: () => callIf('toggleNotifPanel') },
    { icon: '📲',  name: 'อัปเดต',        go: () => callIf('showPatchNotes') },
    { icon: '⚙️',  name: 'Admin', adminOnly: true, go: () => showSection('admin') },
  ];

  function callIf(fn) { if (typeof window[fn] === 'function') window[fn](); }

  // ── Build Home section (podium + flat grid) ─────────────────────
  function buildHomeSection() {
    if (document.getElementById('homeSection')) return;
    const sec = document.createElement('div');
    sec.id = 'homeSection';
    sec.className = 'section';
    sec.innerHTML =
      '<div class="bk-podium" id="homePodium"></div>' +
      '<div class="bk-grid" id="bkGrid"></div>';
    const lb = document.getElementById('leaderboardSection');
    if (lb && lb.parentNode) lb.parentNode.insertBefore(sec, lb);
    else document.body.appendChild(sec);
    buildGrid();
  }

  function buildGrid() {
    const grid = document.getElementById('bkGrid');
    if (!grid) return;
    const admin = (typeof isAdminUser === 'function') && isAdminUser();
    grid.innerHTML = DASH_ITEMS.map((it, i) => {
      if (it.adminOnly && !admin) return '';
      const adminCls = it.adminOnly ? ' bk-feat-admin' : '';
      const dot = it.badge
        ? '<span class="bk-feat-dot' + (it.badge === 'new' ? ' bk-dot-new' : '') + ' bk-feat-hidden" data-dot="' + it.badge + '">' + (it.badge === 'new' ? 'NEW' : '') + '</span>'
        : '';
      return '<button type="button" class="bk-feat' + adminCls + '" data-idx="' + i + '" aria-label="' + esc(it.name) + '">' +
        dot +
        '<span class="bk-feat-icon">' + it.icon + '</span>' +
        '<span class="bk-feat-name">' + esc(it.name) + '</span>' +
      '</button>';
    }).join('');
    grid.querySelectorAll('.bk-feat').forEach(card => {
      card.addEventListener('click', function (e) {
        addRipple(card, e);
        const it = DASH_ITEMS[+card.getAttribute('data-idx')];
        if (it && typeof it.go === 'function') it.go();
      });
    });
    refreshBadges();
  }

  function addRipple(card, e) {
    if (document.documentElement.getAttribute('data-style') === 'lite') return;
    const r = card.getBoundingClientRect();
    const d = Math.max(r.width, r.height);
    const s = document.createElement('span');
    s.className = 'bk-ripple';
    s.style.width = s.style.height = d + 'px';
    s.style.left = ((e.clientX - r.left) - d / 2) + 'px';
    s.style.top = ((e.clientY - r.top) - d / 2) + 'px';
    card.appendChild(s);
    setTimeout(() => s.remove(), 520);
  }

  // ── Dynamic badges (mailbox dot + NEW) on grid, sheet & ⋮ ───────
  function refreshBadges() {
    const mailDot = document.getElementById('mailboxDot');
    const hasMail = !!(mailDot && mailDot.classList.contains('show'));
    const updateBadge = document.getElementById('updateBadge');
    const hasUpdate = !!(updateBadge && !updateBadge.classList.contains('hidden'));

    // grid: NEW always on, mailbox mirrors state
    document.querySelectorAll('[data-dot="new"]').forEach(el => el.classList.remove('bk-feat-hidden'));
    document.querySelectorAll('[data-dot="mailbox"]').forEach(el => el.classList.toggle('bk-feat-hidden', !hasMail));
    // sheet mailbox dot
    const smd = document.getElementById('bkSheetMailDot');
    if (smd) smd.classList.toggle('show', hasMail);
    // ⋮ aggregate dot — something in the menu wants attention
    const menuDot = document.getElementById('bkMenuDot');
    if (menuDot) menuDot.classList.toggle('show', hasMail || hasUpdate);
    // sheet admin row visibility
    const adminRow = document.getElementById('bkSheetAdmin');
    if (adminRow) adminRow.style.display = ((typeof isAdminUser === 'function') && isAdminUser()) ? '' : 'none';
  }
  window.bkRefreshDashBadges = refreshBadges;

  // ── Compact header updater ──────────────────────────────────────
  function updateHeader() {
    if (!currentUser) return;
    const players = (db && db.players) ? db.players : [];
    const p = players.find(x => x.id === currentUser.id) || currentUser;
    // leaderboard position
    const sorted = [...players].sort((a, b) => b.pts - a.pts);
    const pos = sorted.findIndex(x => x.id === p.id) + 1;
    const posEl = document.getElementById('hdrPosNum');
    if (posEl) posEl.textContent = pos > 0 ? '#' + pos : '#–';
    // avatar (+ gacha frame)
    const avEl = document.getElementById('hdrAvatar');
    if (avEl && typeof getAvatar === 'function') {
      const a = getAvatar(p.id, p.name);
      const fCls = (typeof getGachaFrameClass === 'function') ? getGachaFrameClass(p) : '';
      const fIn = (typeof getGachaFrameInner === 'function') ? getGachaFrameInner(p) : '';
      avEl.className = 'bk-hdr-av' + (fCls ? ' ' + fCls : '');
      avEl.style.cssText = 'background:' + a.bg + ';color:' + a.fg + ';' + (a.fs ? 'font-size:' + a.fs + ';' : '') +
        'width:32px;height:32px;border-radius:50%;position:relative;isolation:isolate';
      avEl.innerHTML = fIn + a.content;
    }
    // name (+ gacha name effect)
    const nm = document.getElementById('navName');
    if (nm) {
      nm.textContent = p.name;
      const nCls = (typeof getGachaNameClass === 'function') ? getGachaNameClass(p) : '';
      nm.className = 'bk-hdr-name' + (nCls ? ' ' + nCls : '');
    }
    // rank — ICON ONLY
    const rk = document.getElementById('hdrRank');
    if (rk && typeof getRankBadgeSVG === 'function') rk.innerHTML = getRankBadgeSVG(p.pts, p.id, 28);
    // ELO
    const elo = document.getElementById('hdrElo');
    if (elo) elo.textContent = (p.pts != null ? p.pts : 0).toLocaleString();
  }
  window.bkUpdateHeader = updateHeader;

  // ── Home renderer: podium ───────────────────────────────────────
  async function renderHome() {
    buildHomeSection();
    try { if (typeof loadAll === 'function') await loadAll(); } catch (e) {}
    const players = (db && db.players) ? [...db.players] : [];
    const sorted = players.sort((a, b) => b.pts - a.pts);
    updateHeader();
    buildGrid(); // re-eval adminOnly after data
    renderPodium(sorted.slice(0, 3));
    refreshBadges();
  }
  window.renderHome = renderHome;

  function renderPodium(top3) {
    const el = document.getElementById('homePodium');
    if (!el) return;
    if (!top3.length) { el.innerHTML = '<div class="text-muted" style="margin:0 auto;padding:20px">ยังไม่มีผู้เล่น</div>'; return; }
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    el.innerHTML = top3.map((p, i) => {
      if (!p) return '';
      const place = i + 1;
      const a = getAvatar(p.id, p.name);
      const wr = (p.wins + p.losses) > 0 ? Math.round(p.wins / (p.wins + p.losses) * 100) : 0;
      const fCls = (typeof getGachaFrameClass === 'function') ? getGachaFrameClass(p) : '';
      const fIn = (typeof getGachaFrameInner === 'function') ? getGachaFrameInner(p) : '';
      const nCls = (typeof getGachaNameClass === 'function') ? getGachaNameClass(p) : '';
      const badge = (typeof getRankBadgeSVG === 'function') ? getRankBadgeSVG(p.pts, p.id, 20) : '';
      return '<div class="bk-pod bk-pod-' + place + '" onclick="openPlayerProfile(' + p.id + ')" ' +
        'role="button" tabindex="0" aria-label="อันดับ ' + place + ' ' + esc(p.name) + '">' +
        '<div class="bk-pod-medal">' + medals[place] + '</div>' +
        '<div class="bk-pod-av ' + fCls + '" style="background:' + a.bg + ';color:' + a.fg + ';' + (a.fs ? 'font-size:' + a.fs + ';' : '') + '">' +
          fIn + a.content + '<span class="bk-pod-badge">' + badge + '</span></div>' +
        '<div class="bk-pod-name ' + nCls + '">' + esc(p.name) + '</div>' +
        '<div class="bk-pod-elo">' + p.pts.toLocaleString() + '</div>' +
        '<div class="bk-pod-wr">ชนะ ' + p.wins + ' · ' + wr + '%</div>' +
      '</div>';
    }).join('');
    // staggered rise-in
    requestAnimationFrame(() => {
      const cards = el.querySelectorAll('.bk-pod');
      const lite = document.documentElement.getAttribute('data-style') === 'lite';
      // animate #1 first, then 2, then 3 for a podium reveal feel
      const order = [el.querySelector('.bk-pod-1'), el.querySelector('.bk-pod-2'), el.querySelector('.bk-pod-3')].filter(Boolean);
      order.forEach((c, i) => {
        if (lite) c.classList.add('bkin');
        else setTimeout(() => c.classList.add('bkin'), i * 130 + 80);
      });
    });
  }

  // ── Bottom sheet (⋮) ────────────────────────────────────────────
  function openSheet() {
    const s = document.getElementById('bkSheet');
    if (!s) return;
    refreshBadges();
    s.hidden = false;
    document.addEventListener('keydown', onSheetKey);
  }
  function closeSheet() {
    const s = document.getElementById('bkSheet');
    if (s) s.hidden = true;
    document.removeEventListener('keydown', onSheetKey);
  }
  function onSheetKey(e) { if (e.key === 'Escape') closeSheet(); }
  window.bkOpenSheet = openSheet;
  window.bkCloseSheet = closeSheet;
  window.bkSheetGo = function (name) { closeSheet(); try { showSection(name); } catch (e) {} };
  window.bkSheetCall = function (fn) { closeSheet(); callIf(fn); };

  // ── Navigation history (Back / Home buttons) ───────────────────
  let navStack = [];
  let navBack = false;
  function curSection() {
    const a = document.querySelector('.section.active');
    return a ? a.id.replace('Section', '') : null;
  }
  function updateNavButtons(name) {
    const hdr = document.getElementById('mainNav');
    if (!hdr) return;
    const isHome = name === 'home';
    hdr.classList.toggle('bk-home', isHome);
    hdr.classList.toggle('bk-sub', !isHome && name !== 'login');
    const back = document.getElementById('bkBackBtn');
    if (back) back.disabled = navStack.length === 0;
  }
  window.bkBack = function () {
    if (navStack.length) { navBack = true; showSection(navStack.pop()); }
    else showSection('home');
  };
  window.bkHome = function () { navStack = []; showSection('home'); };

  // ── Patch showSection: 'home' renders dashboard + track history ──
  function patchShowSection() {
    if (typeof window.showSection !== 'function') return;
    const base = window.showSection;
    window.showSection = function (name) {
      const from = curSection();
      base(name);
      if (name === 'home') {
        navStack = [];
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        renderHome();
      } else if (!navBack && from && from !== 'login' && from !== name) {
        // going deeper → remember where we came from (avoid dup pushes)
        if (navStack[navStack.length - 1] !== from) navStack.push(from);
      }
      navBack = false;
      updateNavButtons(name);
    };
  }

  // ── Land on Home after login; keep header & badges fresh ────────
  function patchLifecycle() {
    if (typeof window.afterLogin === 'function') {
      const base = window.afterLogin;
      window.afterLogin = function () { base(); try { showSection('home'); } catch (e) {} updateHeader(); };
    }
    if (typeof window.loadAll === 'function') {
      const base = window.loadAll; let last = 0;
      window.loadAll = async function () {
        await base();
        if (currentUser && Date.now() - last > 1500) { last = Date.now(); updateHeader(); refreshBadges(); }
      };
    }
    if (typeof window.checkMailboxBadge === 'function') {
      const base = window.checkMailboxBadge;
      window.checkMailboxBadge = async function () { await base(); refreshBadges(); };
    }
  }

  function boot() {
    if (window.__bkBooted) return; // idempotent — never double-wrap showSection
    window.__bkBooted = true;
    buildHomeSection();
    patchShowSection();
    patchLifecycle();
    updateNavButtons('home'); // default: Home view (back/home hidden)
    if (typeof currentUser !== 'undefined' && currentUser) updateHeader();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
