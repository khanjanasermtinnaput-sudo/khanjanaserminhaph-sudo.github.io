// Group standings tie-break ladder — mirrors fn_event_standings.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../js/tournament/standings.js');

// helper: a completed match won by `winner` with the given game scores
function match(a, b, winner, games) {
  return { entry_a_id: a, entry_b_id: b, winner_entry_id: winner, games: games || [] };
}

test('an unplayed group still lists every entry at zero', () => {
  const rows = S.computeStandings([1, 2, 3, 4], [], 2);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.played === 0 && r.wins === 0));
  assert.deepEqual(rows.map((r) => r.entry_id), [1, 2, 3, 4]);
});

test('match wins are the first criterion', () => {
  const rows = S.computeStandings([1, 2, 3], [
    match(1, 2, 1, [{ score_a: 21, score_b: 10 }]),
    match(1, 3, 1, [{ score_a: 21, score_b: 12 }]),
    match(2, 3, 2, [{ score_a: 21, score_b: 15 }])
  ], 2);
  assert.deepEqual(rows.map((r) => r.entry_id), [1, 2, 3]);
  assert.deepEqual(rows.map((r) => r.wins), [2, 1, 0]);
  assert.deepEqual(rows.map((r) => r.qualifies), [true, true, false]);
});

test('head-to-head decides a straight two-way tie', () => {
  // 1 and 2 finish level on two wins each. Entry 1 has by far the better point
  // difference, but entry 2 beat it head to head, so entry 2 must rank first.
  const rows = S.computeStandings([1, 2, 3, 4], [
    match(1, 3, 1, [{ score_a: 21, score_b: 2 }]),
    match(1, 4, 1, [{ score_a: 21, score_b: 2 }]),
    match(2, 1, 2, [{ score_a: 21, score_b: 19 }]),
    match(2, 3, 2, [{ score_a: 21, score_b: 19 }]),
    match(3, 4, 3, [{ score_a: 21, score_b: 10 }])
  ], 1);

  const one = rows.find((r) => r.entry_id === 1);
  const two = rows.find((r) => r.entry_id === 2);
  assert.equal(one.wins, 2);
  assert.equal(two.wins, 2);
  assert.ok(one.point_diff > two.point_diff, 'entry 1 has the better point difference');
  assert.equal(rows[0].entry_id, 2, 'the head-to-head winner takes the tie');
  assert.equal(two.h2h, 1);
  assert.equal(one.h2h, 0);
});

test('head-to-head is skipped when three entries are tied', () => {
  // a rock-paper-scissors group: everyone wins one. Head-to-head is circular,
  // so game difference has to decide instead.
  const rows = S.computeStandings([1, 2, 3], [
    match(1, 2, 1, [{ score_a: 21, score_b: 5 }]),
    match(2, 3, 2, [{ score_a: 21, score_b: 19 }]),
    match(3, 1, 3, [{ score_a: 21, score_b: 19 }])
  ], 1);
  assert.ok(rows.every((r) => r.h2h === 0), 'no head-to-head bonus in a three-way tie');
  assert.ok(rows.every((r) => r.wins === 1));
  // 1 has the best point difference (+21-5, -19+21 ... ) so it should lead
  assert.equal(rows[0].entry_id, 1);
});

test('game difference outranks point difference', () => {
  const rows = S.computeStandings([1, 2, 3, 4], [
    // 1 wins 2-0, 2 wins 2-1 but with a huge points margin
    match(1, 3, 1, [{ score_a: 21, score_b: 19 }, { score_a: 21, score_b: 19 }]),
    match(2, 4, 2, [{ score_a: 21, score_b: 1 }, { score_a: 1, score_b: 21 }, { score_a: 21, score_b: 1 }]),
    match(1, 4, 1, [{ score_a: 21, score_b: 19 }, { score_a: 21, score_b: 19 }]),
    match(2, 3, 2, [{ score_a: 21, score_b: 1 }, { score_a: 1, score_b: 21 }, { score_a: 21, score_b: 1 }])
  ], 2);
  assert.equal(rows[0].wins, 2);
  assert.equal(rows[1].wins, 2);
  assert.equal(rows[0].entry_id, 1, 'better game difference wins the tie');
  assert.ok(rows[0].game_diff > rows[1].game_diff);
  assert.ok(rows[0].point_diff < rows[1].point_diff, 'even though its point diff is worse');
});

test('point difference breaks an equal game difference', () => {
  const rows = S.computeStandings([1, 2, 3], [
    match(1, 3, 1, [{ score_a: 21, score_b: 2 }]),
    match(2, 3, 2, [{ score_a: 21, score_b: 18 }])
  ], 1);
  assert.equal(rows[0].entry_id, 1);
  assert.equal(rows[0].point_diff, 19);
  assert.equal(rows[1].point_diff, 3);
});

test('a genuine dead heat is flagged rather than silently broken', () => {
  const rows = S.computeStandings([1, 2], [], 1);
  assert.ok(rows.every((r) => r.is_tied), 'two untouched entries are identical');
  // ordering is still deterministic so the UI never flickers
  assert.deepEqual(rows.map((r) => r.entry_id), [1, 2]);
});

test('qualification follows the configured advance count', () => {
  const matches = [
    match(1, 2, 1, [{ score_a: 21, score_b: 10 }]),
    match(3, 4, 3, [{ score_a: 21, score_b: 10 }]),
    match(1, 3, 1, [{ score_a: 21, score_b: 10 }]),
    match(2, 4, 2, [{ score_a: 21, score_b: 10 }]),
    match(1, 4, 1, [{ score_a: 21, score_b: 10 }]),
    match(2, 3, 2, [{ score_a: 21, score_b: 10 }])
  ];
  assert.deepEqual(S.computeStandings([1, 2, 3, 4], matches, 1).map((r) => r.qualifies),
    [true, false, false, false]);
  assert.deepEqual(S.computeStandings([1, 2, 3, 4], matches, 2).map((r) => r.qualifies),
    [true, true, false, false]);
});

test('games and points are accumulated from both sides of a match', () => {
  const rows = S.computeStandings([1, 2], [
    match(1, 2, 1, [{ score_a: 21, score_b: 15 }, { score_a: 18, score_b: 21 }, { score_a: 21, score_b: 19 }])
  ], 1);
  const a = rows.find((r) => r.entry_id === 1);
  const b = rows.find((r) => r.entry_id === 2);
  assert.equal(a.games_won, 2);
  assert.equal(a.games_lost, 1);
  assert.equal(b.games_won, 1);
  assert.equal(b.games_lost, 2);
  assert.equal(a.points_won, 60);
  assert.equal(b.points_won, 55);
  assert.equal(a.point_diff, 5);
  assert.equal(b.point_diff, -5);
});

test('matches involving an entry outside the group are ignored', () => {
  const rows = S.computeStandings([1, 2], [
    match(1, 2, 1, [{ score_a: 21, score_b: 10 }]),
    match(1, 99, 1, [{ score_a: 21, score_b: 0 }])
  ], 1);
  assert.equal(rows.find((r) => r.entry_id === 1).played, 1);
});
