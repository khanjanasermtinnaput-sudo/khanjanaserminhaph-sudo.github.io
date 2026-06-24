function isAdminUser() { return !!(currentUser && currentUser.isAdmin === 1); }
function normalizeMatch(m) { const ts = m.played_at ? new Date(m.played_at).getTime() : Date.now(); return { id: m.id, type: m.type, teamA: m.team_a, teamB: m.team_b, scoreA: m.score_a, scoreB: m.score_b, winTeam: m.win_team, pts: { gain: m.pts_gain, loss: m.pts_loss }, date: ts, mood: m.mood || null }; }

async function login() {
  const name = document.getElementById('loginName').value.trim();
  const pin = document.getElementById('loginPin').value.trim();
  if (!name || !pin) return toast('กรุณากรอกข้อมูลให้ครบ', 'error');
  toast('กำลังเข้าสู่ระบบ...', 'info');
  try {
    await loadPlayers();
    const cand = db.players.find(p => p.name.toLowerCase() === name.toLowerCase());
    // ยืนยัน PIN ฝั่งเซิร์ฟเวอร์ — ไม่ดึง PIN ของทุกคนลงมาเทียบที่ client อีกต่อไป
    const ok = cand ? await authVerifyById(cand.id, pin) : false;
    if (!cand || !ok) return toast('ชื่อหรือ PIN ไม่ถูกต้อง', 'error');
    currentUser = cand;
    saveDeviceUser(cand, pin);
    await loadMatches();
    afterLogin();
  } catch(e) { toast('เชื่อมต่อไม่ได้: ' + e.message, 'error'); }
}
async function register() {
  const name = document.getElementById('regName').value.trim();
  const pin = document.getElementById('regPin').value.trim();
  if (!name || pin.length !== 4) return toast('กรุณากรอกชื่อและ PIN 4 หลัก', 'error');
  if (!/^\d{4}$/.test(pin)) return toast('PIN ต้องเป็นตัวเลข 4 หลัก', 'error');
  toast('กำลังสมัคร...', 'info');
  try {
    await loadPlayers();
    if (db.players.find(p => p.name.toLowerCase() === name.toLowerCase())) return toast('ชื่อนี้ถูกใช้แล้ว', 'error');
    const isFirst = db.players.length === 0;
    const row = await dbAddPlayer({ name, pin, pts: 50, wins: 0, losses: 0, isAdmin: isFirst ? 1 : 0 });
    await loadPlayers(); await loadMatches();
    currentUser = db.players.find(p => p.id === row.id) || normalizePlayer(row);
    saveDeviceUser(currentUser, pin);
    toast('สมัครสมาชิกสำเร็จ! ยินดีต้อนรับ 🏸', 'success');
    afterLogin();
  } catch(e) { toast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}
// ── QUICK LOGIN (Trusted Device) ──
function saveDeviceUser(player, pin) {
  // เก็บ PIN เฉพาะในเครื่องที่ผู้ใช้เลือกจำ (trusted device) สำหรับ Quick Login เท่านั้น
  localStorage.setItem('badminton_saved_user', JSON.stringify({ id: player.id, name: player.name, pin: pin }));
}
function initQuickLogin() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('badminton_saved_user') || 'null'); } catch(e) { return; }
  if (!saved || !saved.name || !saved.pin) return;
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
  if (!saved) { rejectQuickLogin(); return; }
  const btn = document.getElementById('qlYesBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';
  try {
    await loadPlayers();
    const player = db.players.find(p => p.id === saved.id);
    const ok = player ? await authVerifyById(saved.id, saved.pin) : false;
    if (!player || !ok) {
      toast('ไม่พบบัญชีนี้ในระบบ กรุณาเข้าสู่ระบบใหม่', 'error');
      localStorage.removeItem('badminton_saved_user');
      btn.disabled = false; btn.textContent = '✅ ใช่, เข้าเลย!';
      rejectQuickLogin(); return;
    }
    currentUser = player;
    saveDeviceUser(player, saved.pin);
    await loadMatches();
    afterLogin();
  } catch(e) {
    toast('เชื่อมต่อไม่ได้: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = '✅ ใช่, เข้าเลย!';
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
  startPresenceHeartbeat();
  if (typeof initNotifications === 'function') initNotifications();
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
  currentUser = null; currentMatch = null; db = { players: [], matches: [] };
  document.getElementById('mainNav').classList.add('hidden');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('loginSection').classList.add('active');
  document.getElementById('loginName').value = '';
  document.getElementById('loginPin').value = '';
}

