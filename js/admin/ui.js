// Admin V2 — shared UI primitives (js/admin/ui.js)
// Vanilla, no framework. Depends on globals from the main app: escapeHtml (js/utils.js),
// toast (js/leaderboard.js), openModal/closeModal (js/leaderboard.js).
// Namespaced under window.AdminV2 — see js/admin/core.js for the route shell.
window.AdminV2 = window.AdminV2 || {};

(function () {

  // ── State panel: every AdminV2 panel renders through this so no section
  // can show a blank white area on loading/empty/error (spec §26).
  AdminV2.state = function (el, kind, opts) {
    opts = opts || {};
    if (!el) return;
    if (kind === 'loading') {
      el.innerHTML = `<div class="av2-state av2-state-loading"><div class="av2-spinner"></div><div>${escapeHtml(opts.message || 'กำลังโหลด...')}</div></div>`;
    } else if (kind === 'empty') {
      el.innerHTML = `<div class="av2-state av2-state-empty"><div class="av2-state-icon">${opts.icon || '📭'}</div><div>${escapeHtml(opts.message || 'ยังไม่มีข้อมูล')}</div>${opts.action ? `<button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="${opts.action.onclick}">${escapeHtml(opts.action.label)}</button>` : ''}</div>`;
    } else if (kind === 'error') {
      const retryAttr = opts.retryId ? ` data-av2-retry="${opts.retryId}"` : '';
      el.innerHTML = `<div class="av2-state av2-state-error"><div class="av2-state-icon">⚠️</div><div>${escapeHtml(opts.message || 'โหลดข้อมูลไม่สำเร็จ')}</div><button class="btn btn-ghost btn-sm" style="margin-top:10px"${retryAttr}>🔄 ลองใหม่</button></div>`;
      if (opts.retry) {
        el.querySelector('[data-av2-retry]').onclick = opts.retry;
      }
    }
  };

  // ── Table: sortable, paginated; collapses to stacked cards under 640px via CSS.
  // spec: { columns:[{key,label,sortable?,render?(row)}], rows:[...], pageSize?, onRowClick?(row) }
  AdminV2.table = function (el, spec) {
    if (!el) return;
    const pageSize = spec.pageSize || 20;
    let sortKey = spec.defaultSort || null;
    let sortDir = 1;
    let page = 0;

    function sortedRows() {
      let rows = spec.rows.slice();
      if (sortKey) {
        rows.sort((a, b) => {
          const av = a[sortKey], bv = b[sortKey];
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
          return String(av).localeCompare(String(bv), 'th') * sortDir;
        });
      }
      return rows;
    }

    function render() {
      const rows = sortedRows();
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      page = Math.min(page, totalPages - 1);
      const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

      if (!rows.length) {
        AdminV2.state(el, 'empty', spec.emptyState || {});
        return;
      }

      const head = spec.columns.map(c => {
        const isSorted = c.key === sortKey;
        const arrow = isSorted ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
        return `<th${c.sortable ? ` data-sort="${c.key}" class="av2-th-sortable"` : ''}>${escapeHtml(c.label)}${isSorted ? arrow : ''}</th>`;
      }).join('');

      const body = pageRows.map((row, i) => {
        const cells = spec.columns.map(c => `<td data-label="${escapeHtml(c.label)}">${c.render ? c.render(row) : escapeHtml(row[c.key] ?? '')}</td>`).join('');
        return `<tr data-idx="${i}"${spec.onRowClick ? ' class="av2-row-clickable"' : ''}>${cells}</tr>`;
      }).join('');

      el.innerHTML = `
        <div class="av2-table-wrap">
          <table class="av2-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        </div>
        ${totalPages > 1 ? `
          <div class="av2-pager">
            <button class="btn btn-ghost btn-sm" ${page === 0 ? 'disabled' : ''} data-page="prev">← ก่อนหน้า</button>
            <span>${page + 1} / ${totalPages}</span>
            <button class="btn btn-ghost btn-sm" ${page >= totalPages - 1 ? 'disabled' : ''} data-page="next">ถัดไป →</button>
          </div>` : ''}
      `;

      el.querySelectorAll('[data-sort]').forEach(th => {
        th.onclick = () => {
          const key = th.dataset.sort;
          if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
          render();
        };
      });
      if (spec.onRowClick) {
        el.querySelectorAll('tbody tr').forEach(tr => {
          tr.onclick = () => spec.onRowClick(pageRows[Number(tr.dataset.idx)]);
        });
      }
      const prevBtn = el.querySelector('[data-page="prev"]');
      const nextBtn = el.querySelector('[data-page="next"]');
      if (prevBtn) prevBtn.onclick = () => { page--; render(); };
      if (nextBtn) nextBtn.onclick = () => { page++; render(); };
    }

    render();
    return { refresh: (rows) => { spec.rows = rows; render(); } };
  };

  // ── Drawer: right-hand inspector panel for detail editing.
  AdminV2.drawer = function (opts) {
    let host = document.getElementById('av2Drawer');
    if (!host) {
      host = document.createElement('div');
      host.id = 'av2Drawer';
      document.body.appendChild(host);
    }
    host.innerHTML = `
      <div class="av2-drawer-backdrop" data-close="1"></div>
      <div class="av2-drawer-panel">
        <div class="av2-drawer-head">
          <div class="av2-drawer-title">${escapeHtml(opts.title || '')}</div>
          <button class="av2-drawer-close" data-close="1">✕</button>
        </div>
        <div class="av2-drawer-body">${opts.body || ''}</div>
        ${opts.actions ? `<div class="av2-drawer-actions">${opts.actions}</div>` : ''}
      </div>
    `;
    host.classList.add('av2-drawer-open');
    host.querySelectorAll('[data-close]').forEach(elm => { elm.onclick = () => AdminV2.closeDrawer(); });
    document.body.style.overflow = 'hidden';
    if (opts.onMount) opts.onMount(host);
    return host;
  };
  AdminV2.closeDrawer = function () {
    const host = document.getElementById('av2Drawer');
    if (host) host.classList.remove('av2-drawer-open');
    document.body.style.overflow = '';
  };

  // ── Confirm: 4 risk levels per spec §27.
  // level: 'save' (no prompt, just runs onConfirm) | 'confirm' | 'warn' (lists consequences)
  //        | 'typed' (must type opts.typedPhrase exactly)
  AdminV2.confirm = function (opts) {
    if (opts.level === 'save') { opts.onConfirm(); return; }

    let host = document.getElementById('av2ConfirmModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'av2ConfirmModal';
      document.body.appendChild(host);
    }
    const isTyped = opts.level === 'typed';
    const isWarn = opts.level === 'warn' || isTyped;
    const consequencesHtml = (opts.consequences && opts.consequences.length)
      ? `<ul class="av2-confirm-consequences">${opts.consequences.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : '';

    host.innerHTML = `
      <div class="av2-confirm-backdrop" data-close="1"></div>
      <div class="av2-confirm-box ${isWarn ? 'av2-confirm-danger' : ''}">
        <div class="av2-confirm-title">${escapeHtml(opts.title || 'ยืนยันการทำรายการ')}</div>
        <div class="av2-confirm-body">${escapeHtml(opts.body || '')}</div>
        ${consequencesHtml}
        ${isTyped ? `<div class="av2-confirm-typed"><label>พิมพ์ <strong>${escapeHtml(opts.typedPhrase)}</strong> เพื่อยืนยัน</label><input class="inp" id="av2TypedInput" autocomplete="off"></div>` : ''}
        <div class="av2-confirm-actions">
          <button class="btn btn-ghost" data-close="1">ยกเลิก</button>
          <button class="btn ${isWarn ? 'btn-danger' : 'btn-primary'}" id="av2ConfirmBtn"${isTyped ? ' disabled' : ''}>${escapeHtml(opts.confirmLabel || 'ยืนยัน')}</button>
        </div>
      </div>
    `;
    host.classList.add('av2-confirm-open');
    function close() { host.classList.remove('av2-confirm-open'); }
    host.querySelectorAll('[data-close]').forEach(elm => { elm.onclick = close; });
    if (isTyped) {
      const input = host.querySelector('#av2TypedInput');
      const btn = host.querySelector('#av2ConfirmBtn');
      input.oninput = () => { btn.disabled = input.value !== opts.typedPhrase; };
    }
    host.querySelector('#av2ConfirmBtn').onclick = () => { close(); opts.onConfirm(); };
  };

  // ── Global search / command palette index. sources: [{type,label,keywords,go()}]
  AdminV2.search = function (query, sources) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return sources.filter(s => (s.label + ' ' + (s.keywords || '')).toLowerCase().includes(q)).slice(0, 20);
  };

})();
