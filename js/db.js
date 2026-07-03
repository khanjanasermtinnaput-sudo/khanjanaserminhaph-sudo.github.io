const SUPA_URL = 'https://tprmqsfbeyqurwqpmpia.supabase.co';
const SUPA_KEY = 'sb_publishable_NeMrUwr4zRl1zRwXZcZN-g_1TkTPdxk';

// Session token issued by rpc_login/rpc_register — server-side RLS resolves this
// header back to a player id via session_uid(). Never store the PIN itself.
let currentToken = null;

async function supaFetch(path, options = {}) {
  const { prefer, headers: extraHeaders, ...fetchOptions } = options;
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      'Prefer': prefer || 'return=representation',
      ...(currentToken ? { 'x-player-token': currentToken } : {}),
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

// ── Session-based auth (server-side lockdown) ───────────────
// rpc_login/rpc_login_by_id/rpc_register verify the PIN server-side (bcrypt)
// and issue a session token. The token — never the PIN — is what authorizes
// subsequent writes via the x-player-token header (see supaFetch above).
async function dbLogin(name, pin) {
  const row = await supaFetch('rpc/rpc_login', { method: 'POST', body: JSON.stringify({ p_name: name, p_pin: String(pin) }) });
  currentToken = row.token;
  return row;
}
async function dbLoginById(id, pin) {
  const row = await supaFetch('rpc/rpc_login_by_id', { method: 'POST', body: JSON.stringify({ p_id: id, p_pin: String(pin) }) });
  currentToken = row.token;
  return row;
}
async function dbRegister(name, pin) {
  const row = await supaFetch('rpc/rpc_register', { method: 'POST', body: JSON.stringify({ p_name: name, p_pin: String(pin) }) });
  currentToken = row.token;
  return row;
}
async function dbWhoAmI(token) {
  const prev = currentToken;
  currentToken = token;
  try { return await supaFetch('rpc/rpc_whoami', { method: 'POST', body: JSON.stringify({ p_token: token }) }); }
  catch(e) { currentToken = prev; throw e; }
}
async function dbLogout() {
  const tok = currentToken;
  currentToken = null;
  if (tok) { try { await supaFetch('rpc/rpc_logout', { method: 'POST', body: JSON.stringify({ p_token: tok }) }); } catch(e) {} }
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
  await supaFetch('rpc/rpc_set_elo_x2', {
    method: 'POST',
    body: JSON.stringify({ p_token: currentToken, p_state: value === 'true' || value === true })
  });
  _appSettings[key] = String(value);
}

// ── Server-side gacha pull (CRIT-02) ────────────────────────
const SUPA_FUNCTIONS_URL = SUPA_URL.replace('/rest/v1', '') + '/functions/v1';
async function dbGachaPull(playerId) {
  const res = await fetch(SUPA_FUNCTIONS_URL + '/gacha-pull', {
    method: 'POST',
    headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_id: playerId, token: currentToken })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'gacha_pull_failed');
  return data; // { tier, item: { type, value, label }, coins_remaining }
}

// ── Fusion Lab (System 1) — acting player resolved via x-player-token ──
// Pull a friendly error code out of a thrown PostgREST/RPC error body.
function economyErrCode(e) {
  const raw = (e && e.message) ? String(e.message) : '';
  try { const j = JSON.parse(raw); return j.message || j.hint || raw; } catch (_) { return raw; }
}
async function dbListFusionRecipes() {
  const res = await supaFetch('rpc/list_fusion_recipes', { method: 'POST', body: '{}' });
  return Array.isArray(res) ? res : (res || []);
}
async function dbFuseItems(recipeId) {
  // returns { ok, output, coins_remaining }; throws on insufficient_coins / missing_input / etc.
  return await supaFetch('rpc/fuse_items', { method: 'POST', body: JSON.stringify({ p_recipe_id: recipeId }) });
}
async function dbGetFusionLog(playerId, limit = 20) {
  return await supaFetch('fusion_log?player_id=eq.' + encodeURIComponent(playerId) +
    '&select=recipe_id,output_k,output_v,coins_spent,fused_at&order=fused_at.desc&limit=' + limit);
}
async function dbGetFusionStats() {
  // lightweight global aggregate for the Economy dashboard's Fusion tile
  const rows = await supaFetch('fusion_log?select=output_v');
  return { count: (rows || []).length, itemsCreated: new Set((rows || []).map(r => r.output_v)).size };
}

// ── Server-side daily reward grant (coin amount looked up server-side) ──
async function dbGrantDailyReward(playerId, questId, coins) {
  try {
    const res = await supaFetch('rpc/rpc_grant_daily_reward', {
      method: 'POST',
      body: JSON.stringify({ p_token: currentToken, p_quest_id: questId })
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

// ── Mailbox coin/ELO claim (server-verified amount) ─────────
async function dbClaimMailReward(mailId) {
  return supaFetch('rpc/rpc_claim_mail_reward', {
    method: 'POST',
    body: JSON.stringify({ p_token: currentToken, p_mail_id: mailId })
  });
}

// ── Season reset (server-authoritative, race-proof) ──────────
async function dbApplySeasonReset() {
  return supaFetch('rpc/rpc_apply_season_reset', {
    method: 'POST',
    body: JSON.stringify({ p_token: currentToken })
  });
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

