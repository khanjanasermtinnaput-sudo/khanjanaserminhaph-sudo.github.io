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

let db = { players: [], matches: [] };
let currentUser = null;
let currentMatch = null;

async function loadPlayers() { const rows = await supaFetch('players?order=pts.desc'); db.players = rows.map(normalizePlayer); }
async function loadMatches() { const rows = await supaFetch('matches?order=played_at.desc&limit=50'); db.matches = rows.map(normalizeMatch); }
async function loadAll() { await Promise.all([loadPlayers(), loadMatches()]); }

async function dbAddPlayer(player) {
  const rows = await supaFetch('players', { method: 'POST', body: JSON.stringify({ name: player.name, pin: player.pin, pts: player.pts, wins: player.wins, losses: player.losses, is_admin: player.isAdmin === 1 }) });
  return rows[0];
}
async function dbUpdatePlayer(id, data) {
  try {
    await supaFetch('players?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data) });
  } catch(e) {
    if (e.message && e.message.includes('PGRST204')) {
      const colMatch = e.message.match(/'([^']+)' column/);
      const col = colMatch ? colMatch[1] : Object.keys(data).join(', ');
      throw new Error(`⚠️ ยังไม่มีคอลัมน์ '${col}' ในตาราง players — กรุณารัน SQL ต่อไปนี้ใน Supabase → SQL Editor:\n\nALTER TABLE players ADD COLUMN IF NOT EXISTS prime_titles text DEFAULT '[]';\nALTER TABLE players ADD COLUMN IF NOT EXISTS custom_ach text DEFAULT '[]';\nALTER TABLE players ADD COLUMN IF NOT EXISTS gacha_frame text;\nALTER TABLE players ADD COLUMN IF NOT EXISTS gacha_name text;\nALTER TABLE players ADD COLUMN IF NOT EXISTS owned_effects text DEFAULT '[]';`);
    }
    throw e;
  }
}
async function dbDeletePlayer(id) { await supaFetch('players?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }); }
async function dbAddPending(match) {
  try {
    await supaFetch("pending_matches", { method: "POST", body: JSON.stringify({ type: match.type, team_a: match.teamA, team_b: match.teamB, score_a: match.scoreA, score_b: match.scoreB, win_team: match.winTeam, pts_gain: match.pts.gain, pts_loss: match.pts.loss, submitted_by: match.submittedBy }), prefer: "return=minimal" });
  } catch(e) {
    // ถ้า table pending_matches ไม่มี ให้แจ้ง admin ทาง toast พิเศษ
    if (e.message && (e.message.includes('does not exist') || e.message.includes('relation') || e.message.includes('42P01'))) {
      throw new Error('⚠️ ยังไม่มีตาราง pending_matches ใน Supabase — กรุณาสร้างตารางก่อน (ดูวิธีในหน้า Admin)');
    }
    throw e;
  }
}
async function dbGetPending() {
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  // ดึงเฉพาะรายการที่ created_at ไม่เกิน 12 ชม. ที่ผ่านมา
  // พร้อมลบรายการเก่าที่หมดอายุออกด้วย (fire-and-forget)
  supaFetch('pending_matches?created_at=lt.' + cutoff, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
  return await supaFetch('pending_matches?created_at=gte.' + cutoff + '&order=created_at.desc');
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
  await supaFetch('matches', { method: 'POST', body: JSON.stringify({ type: match.type, team_a: match.teamA, team_b: match.teamB, score_a: match.scoreA, score_b: match.scoreB, win_team: match.winTeam, pts_gain: match.pts.gain, pts_loss: match.pts.loss }), prefer: 'return=minimal' });
}

