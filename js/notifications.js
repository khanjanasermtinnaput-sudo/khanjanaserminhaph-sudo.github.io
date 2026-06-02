// ============================================================
// ===== NOTIFICATION SYSTEM =====
// In-app panel + Browser Push (when PWA permission granted)
// ============================================================

const NOTIF_POLL_MS   = 30000;
const NOTIF_MAX       = 30;

let _notifTimer     = null;
let _notifHistory   = [];
let _notifLastTs    = null;
let _notifPanelOpen = false;

// ── Init / Stop ──────────────────────────────────────────────

function initNotifications() {
  if (!currentUser) return;

  // Load saved history
  try { _notifHistory = JSON.parse(localStorage.getItem('nf_hist_' + currentUser.id) || '[]'); }
  catch(e) { _notifHistory = []; }

  // Last timestamp: use now so we only catch FUTURE matches
  const saved = localStorage.getItem('nf_ts_' + currentUser.id);
  _notifLastTs = saved || new Date().toISOString();
  if (!saved) localStorage.setItem('nf_ts_' + currentUser.id, _notifLastTs);

  _updateBell();

  // Start poll
  clearInterval(_notifTimer);
  _notifTimer = setInterval(_pollMatches, NOTIF_POLL_MS);

  // Permission prompt after 4s if not yet decided
  if (Notification.permission === 'default' &&
      !localStorage.getItem('nf_prompt_skip')) {
    setTimeout(_showPrompt, 4000);
  }
}

function stopNotifications() {
  clearInterval(_notifTimer);
  _notifTimer = null;
}

// ── Polling ──────────────────────────────────────────────────

async function _pollMatches() {
  if (!currentUser || !_notifLastTs) return;
  try {
    const rows = await supaFetch(
      'matches?played_at=gt.' + encodeURIComponent(_notifLastTs) +
      '&order=played_at.desc&limit=20'
    );
    if (!rows.length) return;

    // Advance timestamp so next poll won't re-process these
    _notifLastTs = rows[0].played_at;
    localStorage.setItem('nf_ts_' + currentUser.id, _notifLastTs);

    const myRows = rows
      .map(normalizeMatch)
      .filter(m => [...m.teamA, ...m.teamB].some(x => x.id === currentUser.id));

    if (!myRows.length) return;

    // Reload data silently
    try { await loadAll(); renderLeaderboard(); } catch(e) {}

    myRows.forEach(m => {
      const inA  = m.teamA.some(x => x.id === currentUser.id);
      const win  = (inA && m.winTeam === 'A') || (!inA && m.winTeam === 'B');
      const opp  = (inA ? m.teamB : m.teamA).map(x => x.name).join(' & ');
      const pts  = win ? `+${m.pts.gain}` : `-${m.pts.loss}`;
      _pushNotif({
        id:   m.id || Date.now(),
        type: 'match',
        win,
        icon: win ? '🏆' : '😔',
        title: win ? 'ชนะแมตช์!' : 'แพ้แมตช์',
        body: `vs ${opp} · ${pts} pts`,
        time: new Date().toISOString(),
        read: false
      });
    });
  } catch(e) {}
}

// ── Core push ─────────────────────────────────────────────────

function _pushNotif(n) {
  _notifHistory.unshift(n);
  if (_notifHistory.length > NOTIF_MAX)
    _notifHistory = _notifHistory.slice(0, NOTIF_MAX);
  _saveHistory();
  _updateBell();
  if (_notifPanelOpen) _renderList();

  // In-app toast
  toast(`${n.icon} ${n.title} ${n.body}`, n.win === true ? 'success' : n.win === false ? 'error' : 'info');

  // Browser notification (if granted)
  if (Notification.permission === 'granted') {
    try {
      new Notification(`${n.icon} ${n.title}`, {
        body: n.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'bk-' + n.id,
        renotify: true
      });
    } catch(e) {}
  }
}

// Public: push arbitrary notification (mailbox, rank-up, etc.)
function pushNotification(icon, title, body, type) {
  _pushNotif({ id: Date.now(), type: type || 'info', icon, title, body,
    time: new Date().toISOString(), read: false, win: null });
}

// ── Bell & panel ─────────────────────────────────────────────

function _getUnread() { return _notifHistory.filter(n => !n.read).length; }

function _updateBell() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const c = _getUnread();
  badge.textContent = c > 9 ? '9+' : c;
  badge.style.display = c ? 'flex' : 'none';
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  _notifPanelOpen = !_notifPanelOpen;

  if (_notifPanelOpen) {
    _notifHistory.forEach(n => n.read = true);
    _saveHistory();
    _updateBell();
    _renderList();
    panel.classList.add('open');
    // Close on outside click
    setTimeout(() => document.addEventListener('click', _closeOnOutside, { once: true }), 50);
  } else {
    panel.classList.remove('open');
  }
}

function _closeOnOutside(e) {
  const panel = document.getElementById('notifPanel');
  const bell  = document.getElementById('notifBellBtn');
  if (panel && !panel.contains(e.target) && bell && !bell.contains(e.target)) {
    panel.classList.remove('open');
    _notifPanelOpen = false;
  } else if (_notifPanelOpen) {
    // Re-attach if click was inside
    setTimeout(() => document.addEventListener('click', _closeOnOutside, { once: true }), 50);
  }
}

function _renderList() {
  const list = document.getElementById('notifList');
  if (!list) return;
  if (!_notifHistory.length) {
    list.innerHTML = '<div class="nf-empty">ยังไม่มีการแจ้งเตือน</div>';
    return;
  }
  list.innerHTML = _notifHistory.map(n => `
    <div class="nf-item ${n.win === true ? 'win' : n.win === false ? 'loss' : ''}">
      <div class="nf-item-icon">${n.icon}</div>
      <div class="nf-item-body">
        <div class="nf-item-title">${n.title}</div>
        <div class="nf-item-sub">${n.body}</div>
        <div class="nf-item-time">${_rel(new Date(n.time))}</div>
      </div>
    </div>`).join('');
}

function clearNotifHistory() {
  _notifHistory = [];
  _saveHistory();
  _updateBell();
  _renderList();
}

function _saveHistory() {
  try { localStorage.setItem('nf_hist_' + currentUser.id, JSON.stringify(_notifHistory)); } catch(e) {}
}

function _rel(d) {
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'เมื่อกี้';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

// ── Permission prompt ─────────────────────────────────────────

function _showPrompt() {
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('nf_prompt_skip')) return;
  const p = document.getElementById('notifPrompt');
  if (p) p.classList.add('show');
}

function requestNotifPermission() {
  const p = document.getElementById('notifPrompt');
  if (p) p.classList.remove('show');
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      toast('✅ เปิดการแจ้งเตือนแล้ว', 'success');
      try {
        new Notification('🏸 Badminton Club', {
          body: 'จะแจ้งเมื่อมีแมตช์ใหม่ของคุณ!',
          icon: '/icon-192.png'
        });
      } catch(e) {}
    } else {
      toast('การแจ้งเตือนถูกปฏิเสธ', 'info');
    }
  });
}

function dismissNotifPrompt() {
  const p = document.getElementById('notifPrompt');
  if (p) p.classList.remove('show');
  localStorage.setItem('nf_prompt_skip', '1');
}
