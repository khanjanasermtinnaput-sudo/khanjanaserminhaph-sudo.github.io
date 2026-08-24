// Shared tournament service — the pure shaping and error-mapping helpers.
// The network methods are not exercised here; they are verified against the
// live REST API during each phase's verification pass.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// service reads these off the global the same way the browser reads them off
// window, so they must be loaded first — matching the script order in index.html
require('../js/tournament/errors.js');
require('../js/tournament/scoring-presets.js');
const S = require('../js/tournament/service.js');

const players = { 7: { name: 'สมชาย ใจดี', nickname: 'ชาย' }, 9: { name: 'สมหญิง' } };

test('a singles entry is shaped as one competitor', () => {
  const e = S._shapeEntry({
    id: 1, tournament_id: 5, entry_type: 'singles', status: 'registered',
    tournament_entry_members: [{ player_id: 7, member_order: 1, invite_status: 'accepted' }]
  }, players);

  assert.equal(e.members.length, 1);
  assert.equal(e.display_name, 'ชาย', 'prefers the nickname');
  assert.equal(e.complete, true);
  assert.equal(e.awaiting_partner, false);
});

test('a doubles entry is ONE competitor carrying two members', () => {
  const e = S._shapeEntry({
    id: 2, tournament_id: 5, entry_type: 'doubles', status: 'registered',
    tournament_entry_members: [
      { player_id: 9, member_order: 2, invite_status: 'accepted' },
      { player_id: 7, member_order: 1, invite_status: 'accepted' }
    ]
  }, players);

  // members come back in member_order regardless of row order
  assert.deepEqual(e.members.map((m) => m.player_id), [7, 9]);
  // the retired anchor-player convention showed only members[0]; a pair is one
  // unit and must render as such
  assert.equal(e.display_name, 'ชาย / สมหญิง');
  assert.equal(e.complete, true);
});

test('a half-filled doubles pair is not complete', () => {
  const e = S._shapeEntry({
    id: 3, tournament_id: 5, entry_type: 'doubles', status: 'registered',
    tournament_entry_members: [{ player_id: 7, member_order: 1, invite_status: 'accepted' }]
  }, players);
  assert.equal(e.complete, false);
});

test('a pending partner invite is surfaced', () => {
  const e = S._shapeEntry({
    id: 4, tournament_id: 5, entry_type: 'doubles', status: 'registered',
    tournament_entry_members: [
      { player_id: 7, member_order: 1, invite_status: 'accepted' },
      { player_id: 9, member_order: 2, invite_status: 'pending' }
    ]
  }, players);
  assert.equal(e.awaiting_partner, true);
  assert.equal(e.complete, true, 'both seats are filled; the invite is still open');
});

test('a declined invite makes the entry incomplete', () => {
  const e = S._shapeEntry({
    id: 5, tournament_id: 5, entry_type: 'doubles', status: 'registered',
    tournament_entry_members: [
      { player_id: 7, member_order: 1, invite_status: 'accepted' },
      { player_id: 9, member_order: 2, invite_status: 'declined' }
    ]
  }, players);
  assert.equal(e.complete, false);
});

test('an unknown player degrades to an id rather than crashing', () => {
  const e = S._shapeEntry({
    id: 6, tournament_id: 5, entry_type: 'singles', status: 'registered',
    tournament_entry_members: [{ player_id: 404, member_order: 1, invite_status: 'accepted' }]
  }, {});
  assert.equal(e.display_name, '#404');
});

test('an explicit display name wins over generated member names', () => {
  const e = S._shapeEntry({
    id: 7, tournament_id: 5, entry_type: 'doubles', display_name: 'ทีมมังกร',
    status: 'registered',
    tournament_entry_members: [
      { player_id: 7, member_order: 1, invite_status: 'accepted' },
      { player_id: 9, member_order: 2, invite_status: 'accepted' }
    ]
  }, players);
  assert.equal(e.display_name, 'ทีมมังกร');
});

test('an entry with no members is handled', () => {
  const e = S._shapeEntry({ id: 8, entry_type: 'singles', tournament_entry_members: [] }, players);
  assert.equal(e.display_name, '—');
  assert.equal(e.complete, false);
});

test('a server error becomes an ERR_ code plus a Thai message', () => {
  // this is the exact body PostgREST returns for a RAISE, confirmed live
  const err = new Error('{"code":"P0001","details":null,"hint":null,"message":"ERR_NOT_AUTHENTICATED"}');
  const wrapped = S._wrap(err);
  assert.equal(wrapped.code, 'ERR_NOT_AUTHENTICATED');
  assert.equal(wrapped.thai, 'กรุณาเข้าสู่ระบบก่อน');
});

test('a RAISE detail is carried through for the UI', () => {
  const err = new Error('{"code":"P0001","details":"5 advancers from a group of 4","message":"ERR_ADVANCE_EXCEEDS_TEAMS"}');
  const wrapped = S._wrap(err);
  assert.equal(wrapped.code, 'ERR_ADVANCE_EXCEEDS_TEAMS');
  assert.equal(wrapped.detail, '5 advancers from a group of 4');
});

test('an unrecognised failure still yields a safe Thai fallback', () => {
  const wrapped = S._wrap(new Error('Failed to fetch'));
  assert.equal(wrapped.code, null);
  assert.equal(wrapped.thai, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
  assert.ok(!wrapped.thai.includes('fetch'));
});

test('idempotency keys are unique per attempt', () => {
  const a = S.newIdempotencyKey(12);
  const b = S.newIdempotencyKey(12);
  assert.notEqual(a, b);
  assert.ok(a.startsWith('m12-'));
});

test('the next admin action follows the lifecycle', () => {
  assert.equal(S.nextAdminAction({ lifecycle_status: 'draft' }).to, 'roster_ready');
  assert.equal(S.nextAdminAction({ lifecycle_status: 'roster_ready' }).to, 'draw');
  assert.equal(S.nextAdminAction({ lifecycle_status: 'draw_ready' }).to, 'publish');
  assert.equal(S.nextAdminAction({ lifecycle_status: 'published' }).to, 'start');
  assert.equal(S.nextAdminAction({ lifecycle_status: 'group_stage' }).to, 'knockout');
  assert.equal(S.nextAdminAction({ lifecycle_status: 'completed' }), null);
  assert.equal(S.nextAdminAction(null), null);
});

test('every lifecycle state has a Thai label', () => {
  const states = ['draft', 'roster_ready', 'draw_ready', 'published', 'group_stage',
    'knockout', 'completed', 'selection_completed', 'cancelled'];
  for (const s of states) assert.ok(S.LIFECYCLE_LABELS[s], `missing label for ${s}`);
});

test('every match status has a Thai label', () => {
  const states = ['pending', 'ready', 'live', 'bye', 'walkover',
    'completed', 'cancelled', 'retired', 'disqualified'];
  for (const s of states) assert.ok(S.MATCH_STATUS_LABELS[s], `missing label for ${s}`);
});

test('scoring config falls back to the preset when none is stored', () => {
  assert.equal(S.scoringConfigFor({ scoring_config: { points_to_win: 15 } }).points_to_win, 15);
  assert.equal(S.scoringConfigFor({ scoring_preset: 'bwf_standard' }).games_to_win, 2);
  assert.equal(S.scoringConfigFor({}).games_to_win, 1);
  assert.equal(S.scoringConfigFor({ scoring_preset: 'nonsense' }).games_to_win, 1);
});
