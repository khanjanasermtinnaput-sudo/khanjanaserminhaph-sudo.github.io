// Tournament V2 — draw mathematics: round robin, bracket seeding, BYEs.
//
// This module PROPOSES a draw. It is never the authority: rpc_admin_assign_groups
// and rpc_generate_knockout_from_qualifiers independently re-validate whatever
// arrives. Keeping the algorithm here in pure JS is what makes seed separation
// and BYE placement testable under `node --test`.
(function (root) {
  'use strict';

  // Deterministic PRNG so a stored draw_seed reproduces the exact same draw.
  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, seed) {
    var rnd = mulberry32(seed);
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  // Every unique pairing exactly once: n*(n-1)/2 fixtures.
  function roundRobinPairs(n) {
    var pairs = [];
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) pairs.push([i, j]);
    }
    return pairs;
  }

  function expectedMatchCount(groupCount, teamsPerGroup) {
    return groupCount * (teamsPerGroup * (teamsPerGroup - 1)) / 2;
  }

  // Smallest power of two that can hold n entrants (minimum 2).
  function bracketSize(n) {
    var size = 2;
    while (size < n) size *= 2;
    return size;
  }

  function roundCount(size) {
    var r = 0, m = size;
    while (m > 1) { r++; m /= 2; }
    return r;
  }

  function roundName(matchesInRound) {
    if (matchesInRound === 1) return 'F';
    if (matchesInRound === 2) return 'SF';
    if (matchesInRound === 4) return 'QF';
    return 'R' + (matchesInRound * 2);
  }

  // Standard bracket order. seedOrder(2n) interleaves each s with (2n+1-s),
  // which is what puts seeds 1 and 2 in opposite halves and seeds 1-4 in
  // different quarters. Pre-V2 had no seed separation at all: seeds 1 and 2
  // could meet in the first round.
  function seedOrder(size) {
    var order = [1];
    while (order.length < size) {
      var len = order.length * 2;
      var next = [];
      for (var i = 0; i < order.length; i++) {
        next.push(order[i], len + 1 - order[i]);
      }
      order = next;
    }
    return order;
  }

  // First-round pairings for n entrants. A seed position past n is a BYE.
  // Returns [{ position, seedA, seedB, byeA, byeB }] in bracket order.
  function firstRoundSlots(n) {
    var size = bracketSize(n);
    var order = seedOrder(size);
    var slots = [];
    for (var i = 0; i < size / 2; i++) {
      var sa = order[2 * i], sb = order[2 * i + 1];
      slots.push({
        position: i + 1,
        seedA: sa, seedB: sb,
        byeA: sa > n, byeB: sb > n
      });
    }
    return slots;
  }

  function byeCount(n) {
    return bracketSize(n) - n;
  }

  // Which seeds receive a first-round BYE — always the strongest ones, so a
  // BYE is a reward for seeding rather than a random gift.
  function seedsWithBye(n) {
    var slots = firstRoundSlots(n);
    var out = [];
    slots.forEach(function (s) {
      if (s.byeA && !s.byeB) out.push(s.seedB);
      else if (s.byeB && !s.byeA) out.push(s.seedA);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  // Snake distribution keeps seeds apart across groups: seeds 1..g go to
  // groups A..G, then the next band fills backwards.
  function assignGroups(entryIds, groupCount, opts) {
    var o = opts || {};
    var ids = entryIds.slice();
    if (o.method === 'random') ids = shuffle(ids, o.seed == null ? 1 : o.seed);

    var groups = [];
    for (var g = 0; g < groupCount; g++) {
      groups.push({ letter: String.fromCharCode(65 + g), entries: [] });
    }

    for (var i = 0; i < ids.length; i++) {
      var band = Math.floor(i / groupCount);
      var pos = i % groupCount;
      var idx = (band % 2 === 0) ? pos : (groupCount - 1 - pos);
      groups[idx].entries.push({
        entry_id: ids[i],
        slot: groups[idx].entries.length + 1,
        seed: o.method === 'seeded' ? i + 1 : null
      });
    }
    return groups;
  }

  var api = {
    mulberry32: mulberry32,
    shuffle: shuffle,
    roundRobinPairs: roundRobinPairs,
    expectedMatchCount: expectedMatchCount,
    bracketSize: bracketSize,
    roundCount: roundCount,
    roundName: roundName,
    seedOrder: seedOrder,
    firstRoundSlots: firstRoundSlots,
    byeCount: byeCount,
    seedsWithBye: seedsWithBye,
    assignGroups: assignGroups
  };

  root.TournamentDraw = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
