function isAdminUser() { return !!(currentUser && currentUser.isAdmin === 1); }
function normalizeMatch(m) { const ts = m.played_at ? new Date(m.played_at).getTime() : Date.now(); return { id: m.id, type: m.type, teamA: m.team_a, teamB: m.team_b, scoreA: m.score_a, scoreB: m.score_b, winTeam: m.win_team, pts: { gain: m.pts_gain, loss: m.pts_loss }, date: ts, mood: m.mood || null, durationSeconds: m.duration_seconds ?? null }; }

async function login() {
  const name = document.getElementById('loginName').value.trim();
  const pin = document.getElementById('loginPin').value.trim();
  if (!name || !pin) return toast('กรุณากรอกข้อมูลให้ครบ', 'error');
  toast('กำลังเข้าสู่ระบบ...', 'info');
  try {
    const row = await dbLogin(name, pin);
    await loadPlayers();
    currentUser = db.players.find(p => p.id === row.id) || normalizePlayer(row);
    saveDeviceUser(currentUser);
    await loadMatches();
    afterLogin();
  } catch(e) { toast('ชื่อหรือ PIN ไม่ถูกต้อง', 'error'); }
}
async function register() {
  const name = document.getElementById('regName').value.trim();
  const pin = document.getElementById('regPin').value.trim();
  if (!name || pin.length !== 4) return toast('กรุณากรอกชื่อและ PIN 4 หลัก', 'error');
  if (!/^\d{4}$/.test(pin)) return toast('PIN ต้องเป็นตัวเลข 4 หลัก', 'error');
  toast('กำลังสมัคร...', 'info');
  try {
    const row = await dbRegister(name, pin);
    await loadPlayers(); await loadMatches();
    currentUser = db.players.find(p => p.id === row.id) || normalizePlayer(row);
    saveDeviceUser(currentUser);
    toast('สมัครสมาชิกสำเร็จ! ยินดีต้อนรับ 🏸', 'success');
    afterLogin();
  } catch(e) {
    const msg = (e.message||'').includes('name_taken') ? 'ชื่อนี้ถูกใช้แล้ว' : 'เกิดข้อผิดพลาด: ' + e.message;
    toast(msg, 'error');
  }
}
// ── QUICK LOGIN (Trusted Device) ──
function saveDeviceUser(player) {
  // Store only id/name/token — never the PIN itself (fixes plaintext-PIN-in-localStorage).
  localStorage.setItem('badminton_saved_user', JSON.stringify({ id: player.id, name: player.name, token: currentToken }));
}
function initQuickLogin() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('badminton_saved_user') || 'null'); } catch(e) { return; }
  if (!saved || !saved.name || !saved.token) return;
  const avEl = document.getElementById('qlAv');
  const avData = getAvatar(saved.id, saved.name);
  const pObj = (db.players || []).find(x => x.id === saved.id) || saved;
  const gFrame = getGachaFrameClass(pObj);
  const gInner = getGachaFrameInner(pObj);
  const gNameCls = getGachaNameClass(pObj);
  avEl.style.cssText = `background:${avData.bg};color:${avData.fg};${avData.fs?'font-size:'+avData.fs:''};position:relative;isolation:isolate`;
  avEl.className = 'ql-av' + (gFrame ? ' ' + gFrame : '');
  avEl.innerHTML = gInner + avData.content;
  const nameEl = document.getElementById('qlName');
  nameEl.textContent = saved.name;
  nameEl.className = 'ql-name' + (gNameCls ? ' ' + gNameCls : '');
  document.getElementById('quickLoginCard').classList.remove('hidden');
  document.querySelector('#loginSection .tab-row').classList.add('hidden');
  document.getElementById('loginForm').classList.add('hidden');
}
async function quickLogin() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('badminton_saved_user') || 'null'); } catch(e) {}
  if (!saved || !saved.token) { rejectQuickLogin(); return; }
  const btn = document.getElementById('qlYesBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';
  try {
    const row = await dbWhoAmI(saved.token); // validates the stored session token server-side
    await loadPlayers();
    currentUser = db.players.find(p => p.id === row.id) || normalizePlayer(row);
    saveDeviceUser(currentUser);
    await loadMatches();
    afterLogin();
  } catch(e) {
    toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'error');
    localStorage.removeItem('badminton_saved_user');
    btn.disabled = false; btn.textContent = '✅ ใช่, เข้าเลย!';
    rejectQuickLogin();
  }
}
function rejectQuickLogin() {
  localStorage.removeItem('badminton_saved_user');
  document.getElementById('quickLoginCard').classList.add('hidden');
  document.querySelector('#loginSection .tab-row').classList.remove('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
}

let _presenceInterval = null;
function _onVisibilityResume() { if (!document.hidden && currentUser) dbUpdateLastSeen(currentUser.id); }
function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  if (!currentUser) return;
  dbUpdateLastSeen(currentUser.id);
  _presenceInterval = setInterval(() => { if (currentUser) dbUpdateLastSeen(currentUser.id); }, 60000);
  document.addEventListener('visibilitychange', _onVisibilityResume);
}
function stopPresenceHeartbeat() {
  if (_presenceInterval) { clearInterval(_presenceInterval); _presenceInterval = null; }
  document.removeEventListener('visibilitychange', _onVisibilityResume);
}

function afterLogin() {
  document.getElementById('mainNav').classList.remove('hidden');
  document.getElementById('navName').textContent = currentUser.name;
  document.getElementById('adminNavBtn').classList.toggle('hidden', !isAdminUser());
  if (typeof aiInitCard === 'function') aiInitCard();
  // Show notification bell
  const bellWrap = document.getElementById('notifBellWrap');
  if (bellWrap) bellWrap.style.display = '';
  showSection('leaderboard');
  if (typeof resumeActiveMatchIfAny === 'function') resumeActiveMatchIfAny();
  startPresenceHeartbeat();
  if (typeof initNotifications === 'function') initNotifications();
  // Daily login EXP — server date-keyed (rpc_award_daily_login), safe to call
  // on every login since it silently no-ops if already granted today.
  if (typeof dbAwardDailyLogin === 'function') {
    dbAwardDailyLogin().then(res => {
      if (res && res.awarded) {
        try { toast('📅 Daily Login +20 EXP', 'success'); } catch(e) {}
        if (res.result && res.result.leveled && typeof queueLevelUp === 'function') {
          queueLevelUp(currentUser.name, res.result, 20);
        }
        if (typeof loadPlayers === 'function') loadPlayers().catch(() => {});
      }
    }).catch(() => {});
  }
  // Load server-controlled feature flags so client cannot self-enable ELO x2 (CRIT-01)
  if (typeof loadAppSettings === 'function') loadAppSettings().then(() => {
    if (typeof syncEloX2FromServer === 'function') syncEloX2FromServer();
  });
  // แสดง rank-up ของผู้เล่นตัวเอง (กรณี Admin อนุมัติแมตช์ตอนที่ผู้เล่นออฟไลน์)
  setTimeout(() => { checkPendingRankUps(); checkSelfRankUpFromDB(); }, 1800);
}
function logout() {
  stopPresenceHeartbeat();
  if (typeof stopNotifications === 'function') stopNotifications();
  const bellWrap = document.getElementById('notifBellWrap');
  if (bellWrap) bellWrap.style.display = 'none';
  const panel = document.getElementById('notifPanel');
  if (panel) panel.classList.remove('open');
  if (typeof dbLogout === 'function') dbLogout();
  currentUser = null; currentMatch = null; db = { players: [], matches: [] };
  // Clear service worker cache so a new user on the same device doesn't see stale UI (HIGH-07)
  if ('caches' in window) {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
  }
  document.getElementById('mainNav').classList.add('hidden');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('loginSection').classList.add('active');
  document.getElementById('loginName').value = '';
  document.getElementById('loginPin').value = '';
}

