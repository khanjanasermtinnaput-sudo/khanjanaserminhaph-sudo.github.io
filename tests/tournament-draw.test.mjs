// Draw mathematics — round robin, bracket seeding, BYE placement.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../js/tournament/draw.js');

test('round robin produces every pairing exactly once', () => {
  for (const n of [2, 3, 4, 5, 6, 8]) {
    const pairs = D.roundRobinPairs(n);
    assert.equal(pairs.length, (n * (n - 1)) / 2, `n=${n}`);
    const seen = new Set(pairs.map(([a, b]) => `${a}-${b}`));
    assert.equal(seen.size, pairs.length, `n=${n} has duplicate pairings`);
    for (const [a, b] of pairs) assert.ok(a < b, 'pairs are normalised');
  }
});

test('expected match count matches the group structure', () => {
  assert.equal(D.expectedMatchCount(2, 4), 12); // the 2x4 preset
  assert.equal(D.expectedMatchCount(2, 2), 2);  // the 2x2 preset
});

test('bracket size is the next power of two', () => {
  const cases = [[2, 2], [3, 4], [4, 4], [5, 8], [6, 8], [7, 8], [9, 16], [12, 16], [16, 16], [17, 32], [32, 32]];
  for (const [n, size] of cases) assert.equal(D.bracketSize(n), size, `n=${n}`);
});

test('round count and names', () => {
  assert.equal(D.roundCount(16), 4);
  assert.equal(D.roundName(1), 'F');
  assert.equal(D.roundName(2), 'SF');
  assert.equal(D.roundName(4), 'QF');
  assert.equal(D.roundName(8), 'R16');
  assert.equal(D.roundName(16), 'R32');
});

test('seed order is a permutation of every seed, top seed first', () => {
  for (const size of [2, 4, 8, 16, 32]) {
    const order = D.seedOrder(size);
    assert.equal(order.length, size);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1));
    assert.equal(order[0], 1);
  }
});

test('each first-round match pairs seeds summing to bracket size plus one', () => {
  // the defining property of the standard order: position 2i-1 meets 2i, and
  // s + opponent === size + 1, so the top seed always draws the bottom one
  for (const size of [4, 8, 16, 32]) {
    const order = D.seedOrder(size);
    for (let i = 0; i < size / 2; i++) {
      assert.equal(order[2 * i] + order[2 * i + 1], size + 1, `size ${size}, match ${i + 1}`);
    }
  }
});

test('seeds 1 and 2 land in opposite halves', () => {
  for (const size of [4, 8, 16, 32]) {
    const order = D.seedOrder(size);
    const half = size / 2;
    assert.ok(order.indexOf(1) < half, `seed 1 in the first half (size ${size})`);
    assert.ok(order.indexOf(2) >= half, `seed 2 in the second half (size ${size})`);
  }
});

test('seeds 1 to 4 land in four different quarters', () => {
  for (const size of [8, 16, 32]) {
    const order = D.seedOrder(size);
    const quarter = size / 4;
    const q = [1, 2, 3, 4].map((s) => Math.floor(order.indexOf(s) / quarter));
    assert.equal(new Set(q).size, 4, `size ${size} put two top seeds in one quarter`);
  }
});

test('top seeds can never meet before the final in the first round', () => {
  for (const n of [3, 5, 6, 7, 9, 12, 16, 32]) {
    const slots = D.firstRoundSlots(n);
    for (const s of slots) {
      assert.ok(!(s.seedA <= 2 && s.seedB <= 2), `n=${n}: seeds 1 and 2 meet in round 1`);
    }
  }
});

test('BYE count is bracket size minus entrants', () => {
  const cases = [[3, 1], [5, 3], [6, 2], [7, 1], [9, 7], [12, 4], [16, 0], [32, 0]];
  for (const [n, byes] of cases) assert.equal(D.byeCount(n), byes, `n=${n}`);
});

test('BYEs are given to the strongest seeds, one per match', () => {
  for (const n of [3, 5, 6, 7, 9, 12]) {
    const slots = D.firstRoundSlots(n);
    // no match may consist of two BYEs
    for (const s of slots) assert.ok(!(s.byeA && s.byeB), `n=${n} produced an empty match`);

    const byes = D.seedsWithBye(n);
    assert.equal(byes.length, D.byeCount(n), `n=${n} bye count`);
    // the seeds receiving a bye are exactly the top ones
    assert.deepEqual(byes, Array.from({ length: byes.length }, (_, i) => i + 1), `n=${n}`);
  }
});

test('every entrant appears exactly once in the first round', () => {
  for (const n of [2, 3, 5, 6, 7, 9, 12, 16, 32]) {
    const slots = D.firstRoundSlots(n);
    const playing = [];
    for (const s of slots) {
      if (!s.byeA) playing.push(s.seedA);
      if (!s.byeB) playing.push(s.seedB);
    }
    assert.deepEqual(playing.sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1), `n=${n}`);
  }
});

test('a stored draw seed reproduces the same draw', () => {
  const ids = [10, 11, 12, 13, 14, 15, 16, 17];
  const a = D.assignGroups(ids, 2, { method: 'random', seed: 4242 });
  const b = D.assignGroups(ids, 2, { method: 'random', seed: 4242 });
  const c = D.assignGroups(ids, 2, { method: 'random', seed: 9999 });
  assert.deepEqual(a, b, 'the same seed must give the same draw');
  assert.notDeepEqual(a, c, 'a different seed should give a different draw');
});

test('group assignment places every entry once and fills evenly', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  const groups = D.assignGroups(ids, 2, { method: 'seeded' });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].letter, 'A');
  assert.equal(groups[1].letter, 'B');
  assert.equal(groups[0].entries.length, 4);
  assert.equal(groups[1].entries.length, 4);

  const all = groups.flatMap((g) => g.entries.map((e) => e.entry_id));
  assert.deepEqual(all.sort((a, b) => a - b), ids);

  // snake order keeps the top two seeds apart
  assert.equal(groups[0].entries[0].entry_id, 1);
  assert.equal(groups[1].entries[0].entry_id, 2);
  // and the band reverses, so seed 3 sits with seed 2
  assert.equal(groups[1].entries[1].entry_id, 3);
});

test('slots are numbered from one within each group', () => {
  const groups = D.assignGroups([1, 2, 3, 4, 5, 6], 3, { method: 'seeded' });
  for (const g of groups) {
    assert.deepEqual(g.entries.map((e) => e.slot), [1, 2]);
  }
});
