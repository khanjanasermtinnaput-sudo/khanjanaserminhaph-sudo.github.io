// Admin V2 — shell: sidebar + workspace routing (js/admin/core.js)
// Registered as a brand-new global (renderAdminV2) and a brand-new section
// (#adminV2Section). Deliberately does NOT join the legacy renderAdmin()
// monkey-patch chain (js/leaderboard.js:1026 -> js/rankup.js -> index.html) —
// the old Admin page keeps working untouched, reachable via the "Legacy Admin"
// entry at the bottom of this sidebar, until it is retired in the final phase.
window.AdminV2 = window.AdminV2 || {};

(function () {

  AdminV2.ROUTES = [
    { id: 'overview',     label: 'ภาพรวม',        icon: '📊', ready: true },
    { id: 'players',      label: 'ผู้เล่น',        icon: '👥', ready: true },
    { id: 'matches',      label: 'แมตช์',          icon: '🏸', ready: false },
    { id: 'tournaments',  label: 'ทัวร์นาเมนต์',   icon: '🏆', ready: false },
    { id: 'referee',      label: 'ผู้ตัดสิน',      icon: '👆', ready: false },
    { id: 'achievements', label: 'Achievement',    icon: '🏅', ready: false },
    { id: 'rewards',      label: 'รางวัล',         icon: '🎁', ready: false },
    { id: 'rankings',     label: 'อันดับ',         icon: '📈', ready: false },
    { id: 'logs',         label: 'บันทึกกิจกรรม',  icon: '📜', ready: false },
    { id: 'settings',     label: 'ตั้งค่า',        icon: '⚙️', ready: false },
  ];

  let mounted = false;
  AdminV2.route = 'overview';

  function routeFromHash() {
    const m = location.hash.match(/^#admin\/([a-z]+)/);
    if (m && AdminV2.ROUTES.some(r => r.id === m[1])) return m[1];
    return 'overview';
  }

  AdminV2.go = function (routeId) {
    AdminV2.route = routeId;
    try { history.replaceState(null, '', '#admin/' + routeId); } catch (e) {}
    renderSidebarActive();
    renderWorkspace();
    document.getElementById('av2Sidebar').classList.remove('av2-sidebar-open');
    document.getElementById('av2SidebarBackdrop').classList.remove('av2-sidebar-open');
  };

  AdminV2.showLegacy = function () {
    showSection('admin');
  };

  function renderSidebarActive() {
    document.querySelectorAll('.av2-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === AdminV2.route);
    });
  }

  function shell() {
    const navItems = AdminV2.ROUTES.map(r =>
      `<button type="button" class="av2-nav-item" data-route="${r.id}" title="${escapeHtml(r.label)}">
        <span class="av2-nav-icon">${r.icon}</span><span class="av2-nav-label">${escapeHtml(r.label)}</span>
      </button>`
    ).join('');

    return `
      <div class="av2-shell">
        <div class="av2-sidebar-backdrop" id="av2SidebarBackdrop"></div>
        <nav class="av2-sidebar" id="av2Sidebar">
          <div class="av2-sidebar-brand">🏸 Admin V2</div>
          <div class="av2-nav">${navItems}</div>
          <button type="button" class="av2-nav-item av2-nav-legacy" id="av2LegacyBtn">
            <span class="av2-nav-icon">⚠️</span><span class="av2-nav-label">Admin แบบเดิม</span>
          </button>
        </nav>
        <div class="av2-workspace">
          <div class="av2-topbar">
            <button type="button" class="av2-drawer-toggle" id="av2DrawerToggle">☰</button>
            <div class="av2-search-wrap">
              <input class="inp av2-search-input" id="av2SearchInput" placeholder="ค้นหาเมนู Admin... (Ctrl+K)" autocomplete="off">
              <div class="av2-search-results" id="av2SearchResults"></div>
            </div>
          </div>
          <div class="av2-content" id="av2Content"></div>
        </div>
      </div>
    `;
  }

  function renderWorkspace() {
    const content = document.getElementById('av2Content');
    if (!content) return;
    const route = AdminV2.ROUTES.find(r => r.id === AdminV2.route);
    if (!route) return;

    // Each ready route owns a module of the same name (AdminV2.<id>.render) —
    // adding a new phase means dropping in that module and flipping `ready`,
    // no further change here.
    if (route.ready && AdminV2[route.id] && typeof AdminV2[route.id].render === 'function') {
      AdminV2[route.id].render(content);
      return;
    }
    AdminV2.state(content, 'empty', {
      icon: route.icon,
      message: `${route.label} — จะเปิดใช้งานใน Phase ถัดไป`,
    });
  }

  function wireSearch() {
    const input = document.getElementById('av2SearchInput');
    const results = document.getElementById('av2SearchResults');
    if (!input) return;

    function sources() {
      return AdminV2.ROUTES.map(r => ({
        label: r.icon + ' ' + r.label,
        keywords: r.id,
        go: () => AdminV2.go(r.id),
      }));
    }

    function runSearch() {
      const hits = AdminV2.search(input.value, sources());
      if (!hits.length) { results.classList.remove('av2-search-open'); results.innerHTML = ''; return; }
      results.innerHTML = hits.map((h, i) => `<div class="av2-search-hit" data-idx="${i}">${h.label}</div>`).join('');
      results.classList.add('av2-search-open');
      results.querySelectorAll('.av2-search-hit').forEach(el => {
        el.onclick = () => { hits[Number(el.dataset.idx)].go(); input.value = ''; results.classList.remove('av2-search-open'); };
      });
    }
    input.oninput = runSearch;
    input.onfocus = runSearch;
    document.addEventListener('click', (e) => {
      if (!results.contains(e.target) && e.target !== input) results.classList.remove('av2-search-open');
    });
  }

  function wireGlobalShortcuts() {
    if (AdminV2._shortcutsWired) return;
    AdminV2._shortcutsWired = true;
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const section = document.getElementById('adminV2Section');
        if (!section || !section.classList.contains('active')) return;
        e.preventDefault();
        const input = document.getElementById('av2SearchInput');
        if (input) { input.focus(); input.select(); }
      }
    });
  }

  function mount() {
    const container = document.getElementById('adminV2Content');
    container.innerHTML = shell();

    document.querySelectorAll('.av2-nav-item[data-route]').forEach(btn => {
      btn.onclick = () => AdminV2.go(btn.dataset.route);
    });
    document.getElementById('av2LegacyBtn').onclick = AdminV2.showLegacy;
    document.getElementById('av2DrawerToggle').onclick = () => {
      document.getElementById('av2Sidebar').classList.toggle('av2-sidebar-open');
      document.getElementById('av2SidebarBackdrop').classList.toggle('av2-sidebar-open');
    };
    document.getElementById('av2SidebarBackdrop').onclick = () => {
      document.getElementById('av2Sidebar').classList.remove('av2-sidebar-open');
      document.getElementById('av2SidebarBackdrop').classList.remove('av2-sidebar-open');
    };
    wireSearch();
    wireGlobalShortcuts();
    mounted = true;
  }

  window.renderAdminV2 = function () {
    if (!isAdminUser()) return;
    const container = document.getElementById('adminV2Content');
    if (!container) return;
    if (!mounted) {
      AdminV2.route = routeFromHash();
      mount();
    }
    renderSidebarActive();
    renderWorkspace();
  };

})();
