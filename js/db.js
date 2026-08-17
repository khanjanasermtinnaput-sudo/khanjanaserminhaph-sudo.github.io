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
// id of the most recently inserted/promoted `matches` row — set by saveMatch()/
// approvePending() right after dbAddMatch() resolves, read by the EXP-award
// wrapper in index.html (see supabase_level_system.sql, js/exp-engine.js).
let _lastSavedMatchId = null;

// คอลัมน์ที่ปลอดภัยต่อการเปิดเผย (ไม่รวม pin) — กัน PIN ของทุกคนรั่วมาที่ client
const PLAYER_PUBLIC_COLS = 'id,name,pts,wins,losses,is_admin,prime_titles,custom_ach,coins,gacha_frame,gacha_name,gacha_emoji,gacha_inventory,owned_effects,consecutive_losses,last_seen,level,total_exp,current_exp,required_exp,last_level_up,reward_claimed,prestige,lifetime_exp,highest_level,best_win_streak,consecutive_wins,prestige_at';
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

// ── Server-side gacha pull v2 (Phase 3) ─────────────────────
// Routes straight through rpc_gacha_pull_v2 — crypto RNG, pity, dup
// refunds and the grant itself (via reward_grant) all happen server-side,
// resolved off session_uid() (never a client-supplied player id). This
// replaces the old gacha-pull Edge Function, which re-implemented its own
// auth check and RNG for no benefit once the RPC did the same job server-
// side; the function is left deployed but unused rather than deleted.
async function dbGachaPullV2(pool, count = 1) {
  return await supaFetch('rpc/rpc_gacha_pull_v2', {
    method: 'POST',
    body: JSON.stringify({ p_pool: pool, p_count: count })
  });
}
// Back-compat shim for doGachaPull's single-pull call site (js/gacha.js).
// playerId is unused — kept so the call site needs no change.
async function dbGachaPull(playerId) {
  const r = await dbGachaPullV2('coin', 1);
  return { item: (r.results || [])[0], coins_remaining: r.coins_remaining, reward_transaction_id: r.reward_transaction_id };
}

// ── Level / EXP system (server-authoritative; see supabase_level_system.sql) ──
// Awards match-completion EXP for a real `matches` row (admin-only server-side;
// amounts are computed and verified in the DB, never trusted from the client).
// Returns { awarded, results:[{player_id, source, result:{leveled, new_level, ...}}] }
// or { awarded:false, already_awarded:true } on a repeat call, or null on failure.
async function dbAwardMatchExp(matchId) {
  if (!matchId) return null;
  try {
    return await supaFetch('rpc/rpc_award_match_exp', {
      method: 'POST',
      body: JSON.stringify({ p_token: currentToken, p_match_id: matchId })
    });
  } catch(e) {
    console.warn('award_match_exp failed:', e.message);
    return null;
  }
}
// Throws on failure (already_claimed / level_too_low / invalid_reward) so the
// caller can show a specific error toast — unlike the award functions above,
// a failed claim should not be silently swallowed.
async function dbClaimLevelReward(rewardId) {
  return supaFetch('rpc/rpc_claim_level_reward', {
    method: 'POST',
    body: JSON.stringify({ p_token: currentToken, p_reward_id: rewardId })
  });
}
async function dbGetExpLogs(limit = 10) {
  try {
    return await supaFetch('exp_logs?select=source,amount,total_exp,level,created_at&player_id=eq.' + currentUser.id + '&order=created_at.desc&limit=' + limit);
  } catch(e) { return []; }
}
// Paged/filterable variant for the Level History timeline (js/levels.js).
// fromDate: 'YYYY-MM-DD' inclusive lower bound, or null for no lower bound.
async function dbGetExpLogsPaged(offset = 0, limit = 20, fromDate = null) {
  try {
    let q = 'exp_logs?select=source,amount,total_exp,level,current_exp,meta,created_at&player_id=eq.' + currentUser.id;
    if (fromDate) q += '&created_at=gte.' + fromDate;
    q += '&order=created_at.desc&offset=' + offset + '&limit=' + limit;
    return await supaFetch(q);
  } catch(e) { return []; }
}

// ── V2: remaining EXP sources + Prestige ──────────────────────────────
// All award functions swallow errors (never block the underlying flow);
// dbPrestige() throws so the caller can show a specific error toast.
async function dbAwardDailyLogin() {
  try {
    return await supaFetch('rpc/rpc_award_daily_login', { method: 'POST', body: JSON.stringify({ p_token: currentToken }) });
  } catch(e) { console.warn('award_daily_login failed:', e.message); return null; }
}
async function dbAwardMissionExp(questId) {
  try {
    return await supaFetch('rpc/rpc_award_mission_exp', { method: 'POST', body: JSON.stringify({ p_token: currentToken, p_quest_id: questId }) });
  } catch(e) { console.warn('award_mission_exp failed:', e.message); return null; }
}
async function dbAwardTournamentExp(tournamentId) {
  try {
    return await supaFetch('rpc/rpc_award_tournament_exp', { method: 'POST', body: JSON.stringify({ p_token: currentToken, p_tournament_id: tournamentId }) });
  } catch(e) { console.warn('award_tournament_exp failed:', e.message); return null; }
}
async function dbPrestige() {
  return supaFetch('rpc/rpc_prestige', { method: 'POST', body: JSON.stringify({ p_token: currentToken }) });
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
  // fusion_log is no longer anon-readable; my_fusion_log() scopes to the
  // acting session via session_uid(), so playerId is only kept for call-site compat.
  return await supaFetch('rpc/my_fusion_log', { method: 'POST', body: JSON.stringify({ p_limit: limit }) });
}
async function dbGetFusionStats() {
  // lightweight global aggregate for the Economy dashboard's Fusion tile
  return await supaFetch('rpc/fusion_stats', { method: 'POST', body: '{}' });
}

// ── Marketplace (System 2) — acting player resolved via x-player-token ──
async function dbGetListings(limit = 200) {
  return await supaFetch('market_listings?status=eq.active' +
    '&select=id,seller_id,item_k,item_v,price,created_at&order=created_at.desc&limit=' + limit);
}
async function dbGetMyListings(playerId) {
  return await supaFetch('market_listings?seller_id=eq.' + encodeURIComponent(playerId) +
    '&status=eq.active&select=id,item_k,item_v,price,created_at&order=created_at.desc');
}
async function dbMarketList(itemK, itemV, price) {
  return await supaFetch('rpc/market_list_item', { method: 'POST',
    body: JSON.stringify({ p_item_k: itemK, p_item_v: itemV, p_price: price }) });
}
async function dbMarketBuy(listingId) {
  return await supaFetch('rpc/market_buy', { method: 'POST', body: JSON.stringify({ p_listing_id: listingId }) });
}
async function dbMarketCancel(listingId) {
  return await supaFetch('rpc/market_cancel', { method: 'POST', body: JSON.stringify({ p_listing_id: listingId }) });
}
async function dbGetMarketHistory(limit = 20) {
  return await supaFetch('market_transactions?select=item_k,item_v,price,buyer_id,seller_id,traded_at' +
    '&order=traded_at.desc&limit=' + limit);
}
async function dbGetMarketStats() {
  const r = await supaFetch('rpc/market_stats', { method: 'POST', body: '{}' });
  return Array.isArray(r) ? (r[0] || {}) : (r || {});
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
  if (match.startedAt) row.started_at = new Date(match.startedAt).toISOString();
  if (match.endedAt) row.ended_at = new Date(match.endedAt).toISOString();
  if (match.durationSeconds != null) row.duration_seconds = match.durationSeconds;
  const post = () => supaFetch("pending_matches", { method: "POST", body: JSON.stringify(row), prefer: "return=minimal" });
  try {
    await post();
  } catch(e) {
    // คอลัมน์ mood/started_at/ended_at/duration_seconds ยังไม่ถูกสร้าง →
    // บันทึกแบบไม่มีคอลัมน์เหล่านั้นแทน (ดู SQL ในหน้า Admin)
    if ((row.mood || row.started_at || row.ended_at || row.duration_seconds != null) && e.message && (e.message.includes('PGRST204') || e.message.includes('mood') || e.message.includes('started_at') || e.message.includes('ended_at') || e.message.includes('duration_seconds'))) {
      delete row.mood; delete row.started_at; delete row.ended_at; delete row.duration_seconds;
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
// Returns the inserted match's id (used to award match-completion EXP —
// see supabase_level_system.sql rpc_award_match_exp) or null if it couldn't
// be determined.
async function dbAddMatch(match) {
  const row = { type: match.type, team_a: match.teamA, team_b: match.teamB, score_a: match.scoreA, score_b: match.scoreB, win_team: match.winTeam, pts_gain: match.pts.gain, pts_loss: match.pts.loss };
  if (match.mood) row.mood = match.mood;
  if (match.startedAt) row.started_at = new Date(match.startedAt).toISOString();
  if (match.endedAt) row.ended_at = new Date(match.endedAt).toISOString();
  if (match.durationSeconds != null) row.duration_seconds = match.durationSeconds;
  try {
    const res = await supaFetch('matches', { method: 'POST', body: JSON.stringify(row), prefer: 'return=representation' });
    return Array.isArray(res) && res[0] ? res[0].id : null;
  } catch(e) {
    // คอลัมน์ mood/started_at/ended_at/duration_seconds ยังไม่ถูกสร้าง →
    // บันทึกแบบไม่มีคอลัมน์เหล่านั้นแทน (ดู SQL ในหน้า Admin)
    if ((row.mood || row.started_at || row.ended_at || row.duration_seconds != null) && e.message && (e.message.includes('PGRST204') || e.message.includes('mood') || e.message.includes('started_at') || e.message.includes('ended_at') || e.message.includes('duration_seconds'))) {
      delete row.mood; delete row.started_at; delete row.ended_at; delete row.duration_seconds;
      const res = await supaFetch('matches', { method: 'POST', body: JSON.stringify(row), prefer: 'return=representation' });
      return Array.isArray(res) && res[0] ? res[0].id : null;
    } else throw e;
  }
}
async function dbUpdateLastSeen(id) {
  try { await supaFetch('players?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ last_seen: new Date().toISOString() }), prefer: 'return=minimal' }); } catch(e) {}
}

