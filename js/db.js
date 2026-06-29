const SUPA_URL = 'https://tprmqsfbeyqurwqpmpia.supabase.co';
const SUPA_KEY = 'sb_publishable_NeMrUwr4zRl1zRwXZcZN-g_1TkTPdxk';

async function supaFetch(path, options = {}) {
  const { prefer, headers: extraHeaders, ...fetchOptions } = options;
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      'Prefer': prefer || 'return=representation',
      ...extraHeaders
    },
    ...fetchOptions
  });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ดึง "ทุกแถว" แบบแบ่งหน้า — PostgREST จำกัด ~1000 แถวต่อคำขอ
async function supaFetchAll(pathWithQuery, pageSize = 1000) {
  const sep = pathWithQuery.includes('?') ? '&' : '?';
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const batch = await supaFetch(`${pathWithQuery}${sep}limit=${pageSize}&offset=${offset}`);
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

let db = { players: [], matches: [] };
let currentUser = null;
let currentMatch = null;

// คอลัมน์ที่ปลอดภัยต่อการเปิดเผย (ไม่รวม pin) — กัน PIN ของทุกคนรั่วมาที่ client
const PLAYER_PUBLIC_COLS = 'id,name,pts,wins,losses,is_admin,prime_titles,custom_ach,coins,gacha_frame,gacha_name,gacha_emoji,gacha_inventory,owned_effects,consecutive_losses,last_seen';
async function loadPlayers() {
  let rows;
  try {
    rows = await supaFetch('players?select=' + PLAYER_PUBLIC_COLS + '&order=pts.desc');
  } catch(e) {
    // คอลัมน์ optional บางตัวอาจยังไม่มี → ใช้คอลัมน์หลักที่มีแน่ ๆ (ยังคงไม่รวม pin)
    rows = await supaFetch('players?select=id,name,pts,wins,losses,is_admin&order=pts.desc');
  }
  db.players = rows.map(normalizePlayer);
}
async function loadMatches() { const rows = await supaFetch('matches?order=played_at.desc&limit=50'); db.matches = rows.map(normalizeMatch); }
async function loadAll() { await Promise.all([loadPlayers(), loadMatches()]); }

// ── ยืนยัน PIN ฝั่งเซิร์ฟเวอร์แบบเจาะจง (ไม่ดึง PIN ทุกคนลงมา) ──
// ใช้ RPC verify_player_pin (SECURITY DEFINER) ถ้าติดตั้งแล้ว — ทำให้ PIN อ่านจาก client ไม่ได้เลย
// ถ้ายังไม่ได้รัน supabase_security.sql จะ fallback ไป query ตรง (ยังทำงานได้)
async function authVerifyById(id, pin) {
  // Server-side bcrypt verification only — no plaintext fallback (CRIT-06)
  try {
    const res = await supaFetch('rpc/verify_player_pin', { method: 'POST', body: JSON.stringify({ p_id: id, p_pin: String(pin) }) });
    if (typeof res === 'boolean') return res;
    if (Array.isArray(res)) return res[0] === true;
    if (res && typeof res === 'object') return res.verify_player_pin === true;
    return false;
  } catch(e) {
    // Do NOT fall back to plaintext PIN query — fail closed
    console.error('PIN verification failed (server unreachable):', e.message);
    return false;
  }
}

// ── App settings (server-controlled feature flags) ──────────
let _appSettings = {};
async function loadAppSettings() {
  try {
    const rows = await supaFetch('app_settings?select=key,value');
    _appSettings = {};
    (rows || []).forEach(r => { _appSettings[r.key] = r.value; });
  } catch(e) { /* leave defaults */ }
}
function getAppSetting(key, defaultVal = '') {
  return _appSettings.hasOwnProperty(key) ? _appSettings[key] : defaultVal;
}
async function setAppSettingAdmin(adminId, key, value) {
  if (!isAdminUser()) throw new Error('not_admin');
  await supaFetch('rpc/set_elo_x2', {
    method: 'POST',
    body: JSON.stringify({ p_admin_id: adminId, p_state: value === 'true' || value === true })
  });
  _appSettings[key] = String(value);
}

// ── Server-side gacha pull (CRIT-02) ────────────────────────
const SUPA_FUNCTIONS_URL = SUPA_URL.replace('/rest/v1', '') + '/functions/v1';
async function dbGachaPull(playerId) {
  const res = await fetch(SUPA_FUNCTIONS_URL + '/gacha-pull', {
    method: 'POST',
    headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_id: playerId })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'gacha_pull_failed');
  return data; // { tier, item: { type, value, label }, coins_remaining }
}

// ── Server-side daily reward grant (CRIT-03) ─────────────────
async function dbGrantDailyReward(playerId, questId, coins) {
  try {
    const res = await supaFetch('rpc/grant_daily_reward', {
      method: 'POST',
      body: JSON.stringify({ p_player_id: playerId, p_quest_id: questId, p_coins: coins })
    });
    // Returns true if newly granted, false if already claimed today
    if (typeof res === 'boolean') return res;
    if (Array.isArray(res)) return res[0] === true;
    return false;
  } catch(e) {
    console.warn('grant_daily_reward failed:', e.message);
    return false;
  }
}

// ── Season reset check (CRIT-04) ────────────────────────────
async function dbGetLatestSeasonReset() {
  try {
    const res = await supaFetch('rpc/get_latest_season_reset', { method: 'POST', body: '{}' });
    if (typeof res === 'string') return res;
    if (Array.isArray(res)) return res[0] || null;
    return null;
  } catch(e) { return null; }
}

async function dbAddPlayer(player) {
  // ขอคืนเฉพาะคอลัมน์ปลอดภัย (ไม่รวม pin) — กัน error หลัง REVOKE SELECT(pin) และไม่ให้ pin หลุดกลับมา
  const rows = await supaFetch('players?select=id,name,pts,wins,losses,is_admin', { method: 'POST', body: JSON.stringify({ name: player.name, pin: player.pin, pts: player.pts, wins: player.wins, losses: player.losses, is_admin: player.isAdmin === 1 }) });
  return rows[0];
}
async function dbUpdatePlayer(id, data) {
  try {
    // return=minimal: ไม่อ่านแถวกลับ — จำเป็นหลัง REVOKE SELECT(pin) ไม่งั้นการตั้งคะแนน/อัปเดตจะ error
    await supaFetch('players?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' });
  } catch(e) {
    if (e.message && e.message.includes('PGRST204')) {
      const colMatch = e.message.match(/'([^']+)' column/);
      const col = colMatch ? colMatch[1] : Object.keys(data).join(', ');
      throw new Error(`⚠️ ยังไม่มีคอลัมน์ '${col}' ในตาราง players — กรุณารัน SQL ต่อไปนี้ใน Supabase → SQL Editor:\n\nALTER TABLE players ADD COLUMN IF NOT EXISTS prime_titles text DEFAULT '[]';\nALTER TABLE players ADD COLUMN IF NOT EXISTS custom_ach text DEFAULT '[]';\nALTER TABLE players ADD COLUMN IF NOT EXISTS gacha_frame text;\nALTER TABLE players ADD COLUMN IF NOT EXISTS gacha_name text;\nALTER TABLE players ADD COLUMN IF NOT EXISTS owned_effects text DEFAULT '[]';\nALTER TABLE players ADD COLUMN IF NOT EXISTS gacha_inventory text DEFAULT '{}';`);
    }
    throw e;
  }
}
async function dbDeletePlayer(id) { await supaFetch('players?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }); }
async function dbAddPending(match) {
  const row = { type: match.type, team_a: match.teamA, team_b: match.teamB, score_a: match.scoreA, score_b: match.scoreB, win_team: match.winTeam, pts_gain: match.pts.gain, pts_loss: match.pts.loss, submitted_by: match.submittedBy };
  if (match.mood) row.mood = match.mood;
  const post = () => supaFetch("pending_matches", { method: "POST", body: JSON.stringify(row), prefer: "return=minimal" });
  try {
    await post();
  } catch(e) {
    // คอลัมน์ mood ยังไม่ถูกสร้าง → บันทึกแบบไม่มี mood แทน (ดู SQL ในหน้า Admin)
    if (row.mood && e.message && (e.message.includes('PGRST204') || e.message.includes('mood'))) {
      delete row.mood;
      await post();
      return;
    }
    // ถ้า table pending_matches ไม่มี ให้แจ้ง admin ทาง toast พิเศษ
    if (e.message && (e.message.includes('does not exist') || e.message.includes('relation') || e.message.includes('42P01'))) {
      throw new Error('⚠️ ยังไม่มีตาราง pending_matches ใน Supabase — กรุณาสร้างตารางก่อน (ดูวิธีในหน้า Admin)');
    }
    throw e;
  }
}
let _pendingCleanupAt = 0;
async function dbGetPending() {
  // ดึง "ทุก" รายการที่รออยู่ — ไม่ filter created_at ใน query
  // เพราะถ้า created_at เป็น NULL หรือ timezone เพี้ยน รายการจะถูกซ่อนหายไปจากหน้า Admin
  // ทำให้ผู้เล่นบันทึกผลแล้วคะแนนหายไปเลย (bug ที่กำลังแก้)
  const rows = await supaFetch('pending_matches?order=created_at.desc');
  const cutoffMs = Date.now() - 12 * 60 * 60 * 1000;
  const expiredIds = [];
  const active = [];
  for (const r of rows) {
    const ts = r.created_at ? new Date(r.created_at).getTime() : NaN;
    // นับว่าหมดอายุ "เฉพาะ" รายการที่มี created_at ชัดเจนและเกิน 12 ชม. จริง
    // ถ้า created_at หาย/อ่านไม่ได้ ให้ถือว่ายัง active ไว้ก่อน เพื่อไม่ให้คะแนนหาย
    if (!isNaN(ts) && ts < cutoffMs) expiredIds.push(r.id);
    else active.push(r);
  }
  // ลบเฉพาะรายการที่มั่นใจว่าเก่ากว่า 12 ชม. (fire-and-forget)
  if (expiredIds.length) {
    supaFetch('pending_matches?id=in.(' + expiredIds.join(',') + ')', { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
  }
  return active;
}
async function dbDeletePending(id) { await supaFetch("pending_matches?id=eq." + id, { method: "DELETE", prefer: "return=minimal" }); }
async function dbDeleteMatchesByPlayer(playerId) {
  const all = await supaFetch('matches?order=played_at.desc');
  const toDelete = all.filter(m => {
    const ta = m.team_a || [], tb = m.team_b || [];
    return [...ta, ...tb].some(p => p.id === playerId);
  });
  await Promise.all(toDelete.map(m => supaFetch('matches?id=eq.' + m.id, { method: 'DELETE', prefer: 'return=minimal' })));
}
async function dbAddMatch(match) {
  const row = { type: match.type, team_a: match.teamA, team_b: match.teamB, score_a: match.scoreA, score_b: match.scoreB, win_team: match.winTeam, pts_gain: match.pts.gain, pts_loss: match.pts.loss };
  if (match.mood) row.mood = match.mood;
  try {
    await supaFetch('matches', { method: 'POST', body: JSON.stringify(row), prefer: 'return=minimal' });
  } catch(e) {
    // คอลัมน์ mood ยังไม่ถูกสร้าง → บันทึกแบบไม่มี mood แทน (ดู SQL ในหน้า Admin)
    if (row.mood && e.message && (e.message.includes('PGRST204') || e.message.includes('mood'))) {
      delete row.mood;
      await supaFetch('matches', { method: 'POST', body: JSON.stringify(row), prefer: 'return=minimal' });
    } else throw e;
  }
}
async function dbUpdateLastSeen(id) {
  try { await supaFetch('players?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ last_seen: new Date().toISOString() }), prefer: 'return=minimal' }); } catch(e) {}
}

