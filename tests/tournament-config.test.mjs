// Event configuration validation — mirrors rpc_admin_create_series_with_events.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const V = require('../js/tournament/validation.js');

const codes = (r) => r.errors.map((e) => e.code);

test('the five standard events are created enabled by default', () => {
  const events = V.buildDefaultEvents('championship');
  assert.equal(events.length, 5);
  assert.deepEqual(events.map((e) => e.event_kind), ['ms', 'ws', 'md', 'wd', 'xd']);
  assert.ok(events.every((e) => e.enabled));
  assert.deepEqual(events.map((e) => e.event_label),
    ['ชายเดี่ยว', 'หญิงเดี่ยว', 'ชายคู่', 'หญิงคู่', 'คู่ผสม']);
});

test('team size is derived from the category, never chosen', () => {
  assert.equal(V.teamSizeFor('ms'), 1);
  assert.equal(V.teamSizeFor('ws'), 1);
  assert.equal(V.teamSizeFor('md'), 2);
  assert.equal(V.teamSizeFor('wd'), 2);
  assert.equal(V.teamSizeFor('xd'), 2);
  assert.equal(V.teamSizeFor('nonsense'), null);
  // the custom category is the only one that may carry its own size
  assert.equal(V.teamSizeFor('custom', 2), 2);
  assert.equal(V.teamSizeFor('custom'), 1);
});

test('the 2x4 preset gives eight entries in the event', () => {
  const e = V.applyPreset(V.buildDefaultEvents('championship')[0], '2x4');
  assert.equal(e.group_count, 2);
  assert.equal(e.teams_per_group, 4);
  assert.equal(e.group_count * e.teams_per_group, 8);
  assert.equal(V.validateEvent(e, 'championship').ok, true);
});

test('the 2x2 preset gives four entries in the event', () => {
  const e = V.applyPreset(V.buildDefaultEvents('championship')[0], '2x2');
  assert.equal(e.group_count, 2);
  assert.equal(e.teams_per_group, 2);
  assert.equal(e.group_count * e.teams_per_group, 4);
  assert.equal(V.validateEvent(e, 'championship').ok, true);
});

test('custom structures are accepted inside the safe limits', () => {
  const base = V.buildDefaultEvents('championship')[0];
  // a single group must advance two, or a knockout round has nobody to pair
  for (const [g, t, a] of [[1, 2, 2], [8, 8, 1], [3, 5, 2], [4, 4, 1]]) {
    const e = Object.assign({}, base, {
      preset: 'custom', group_count: g, teams_per_group: t, advance_per_group: a
    });
    assert.equal(V.validateEvent(e, 'championship').ok, true, `${g}x${t} advancing ${a} should be valid`);
  }
});

test('structures outside the safe limits are rejected', () => {
  const base = V.buildDefaultEvents('championship')[0];
  const bad = (patch) => codes(V.validateEvent(Object.assign({}, base, patch), 'championship'));

  assert.ok(bad({ group_count: 0 }).includes('ERR_GROUP_COUNT_RANGE'));
  assert.ok(bad({ group_count: 9 }).includes('ERR_GROUP_COUNT_RANGE'));
  assert.ok(bad({ teams_per_group: 1 }).includes('ERR_TEAMS_PER_GROUP_RANGE'));
  assert.ok(bad({ teams_per_group: 9 }).includes('ERR_TEAMS_PER_GROUP_RANGE'));
});

test('advancers may not exceed the teams in a group', () => {
  const base = V.buildDefaultEvents('championship')[0];
  const e = Object.assign({}, base, { teams_per_group: 4, advance_per_group: 5 });
  assert.ok(codes(V.validateEvent(e, 'championship')).includes('ERR_ADVANCE_EXCEEDS_TEAMS'));

  const ok = Object.assign({}, base, { teams_per_group: 4, advance_per_group: 4 });
  assert.equal(V.validateEvent(ok, 'championship').ok, true);
});

test('a group-to-knockout event must yield at least two qualifiers', () => {
  const e = Object.assign({}, V.buildDefaultEvents('championship')[0], {
    structure: 'groups_knockout', group_count: 1, teams_per_group: 4, advance_per_group: 1
  });
  assert.ok(codes(V.validateEvent(e, 'championship')).includes('ERR_TOO_FEW_QUALIFIERS'));

  // the same shape is fine when the event ends at the group stage
  const groupsOnly = Object.assign({}, e, { structure: 'groups_only' });
  assert.equal(V.validateEvent(groupsOnly, 'championship').ok, true);
});

test('a direct-knockout event needs no group configuration', () => {
  const e = Object.assign({}, V.buildDefaultEvents('championship')[0], {
    structure: 'knockout_only', group_count: null, teams_per_group: null, advance_per_group: null
  });
  assert.equal(V.validateEvent(e, 'championship').ok, true);
});

test('selection mode requires a selection count', () => {
  const e = Object.assign({}, V.buildDefaultEvents('selection')[0], { selected_count: null });
  assert.ok(codes(V.validateEvent(e, 'selection')).includes('ERR_SELECTION_COUNT_REQUIRED'));

  // and the same event is valid under a championship purpose
  assert.equal(V.validateEvent(e, 'championship').ok, true);
});

test('selection defaults carry a count and reserves', () => {
  const events = V.buildDefaultEvents('selection');
  assert.ok(events.every((e) => e.selected_count >= 1));
  assert.ok(events.every((e) => e.reserve_count >= 0));
  assert.equal(V.validateSeries({ name: 'คัดตัว', purpose: 'selection' }, events).ok, true);
});

test('mixed doubles raises a warning, not an error', () => {
  // the app holds no reliable gender data, so XD composition is admin-verified
  const xd = V.buildDefaultEvents('championship').find((e) => e.event_kind === 'xd');
  const r = V.validateEvent(xd, 'championship');
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'WARN_XD_GENDER_UNVERIFIED'));
});

test('a series needs a name and at least one enabled event', () => {
  const events = V.buildDefaultEvents('championship');
  assert.ok(codes(V.validateSeries({ name: '   ' }, events)).includes('ERR_SERIES_NAME_REQUIRED'));
  assert.ok(codes(V.validateSeries({ name: 'ok' }, events.map((e) => ({ ...e, enabled: false }))))
    .includes('ERR_NO_EVENTS'));
  assert.ok(codes(V.validateSeries({ name: 'ok', purpose: 'nonsense' }, events))
    .includes('ERR_BAD_PURPOSE'));
});

test('events can be disabled individually before publishing', () => {
  const events = V.buildDefaultEvents('championship');
  events[2].enabled = false;
  const r = V.validateSeries({ name: 'ทัวร์', purpose: 'championship' }, events);
  assert.equal(r.ok, true);
  assert.equal(r.enabled_count, 4);
});

test('each event is configured independently', () => {
  const events = V.buildDefaultEvents('championship');
  events[0] = V.applyPreset(events[0], '2x4');   // MS
  events[2] = V.applyPreset(events[2], '2x2');   // MD
  const r = V.validateSeries({ name: 'ทัวร์', purpose: 'championship' }, events);
  assert.equal(r.ok, true);
  assert.equal(events[0].teams_per_group, 4);
  assert.equal(events[2].teams_per_group, 2);
  assert.equal(events[0].team_size, 1);
  assert.equal(events[2].team_size, 2);
});

test('a duplicate event kind is rejected', () => {
  const events = V.buildDefaultEvents('championship');
  events.push(Object.assign({}, events[0]));
  assert.ok(codes(V.validateSeries({ name: 'ทัวร์' }, events)).includes('ERR_DUPLICATE_EVENT_KIND'));
});

test('a doubles entry needs exactly two distinct members', () => {
  assert.equal(V.validateEntry({ player_ids: [1, 2] }, 2).ok, true);
  assert.equal(V.validateEntry({ player_ids: [1] }, 2).code, 'ERR_MEMBER_COUNT');
  assert.equal(V.validateEntry({ player_ids: [1, 2, 3] }, 2).code, 'ERR_MEMBER_COUNT');
  assert.equal(V.validateEntry({ player_ids: [1, 1] }, 2).code, 'ERR_DOUBLES_DUPLICATE_MEMBER');
});

test('a singles entry needs exactly one member', () => {
  assert.equal(V.validateEntry({ player_ids: [7] }, 1).ok, true);
  assert.equal(V.validateEntry({ player_ids: [7, 8] }, 1).code, 'ERR_MEMBER_COUNT');
  assert.equal(V.validateEntry({ player_ids: [] }, 1).code, 'ERR_MEMBER_COUNT');
});

test('a player appearing in two entries is detected', () => {
  const entries = [{ player_ids: [1, 2] }, { player_ids: [3, 4] }, { player_ids: [2, 5] }];
  assert.deepEqual(V.findDuplicatePlayers(entries), [2]);
  assert.deepEqual(V.findDuplicatePlayers([{ player_ids: [1] }, { player_ids: [2] }]), []);
});
