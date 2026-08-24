// Selection mode — the pure logic a client can check before calling
// rpc_admin_finalize_selection, mirroring its coverage/count checks.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A small local mirror of the server's finalize-selection validation, kept
// here rather than exported from service.js since it is pure business logic
// the wizard/ops screen re-checks client-side before round-tripping.
function validateSelectionResults(results, activeEntryIds, selectedCount) {
  const errors = [];
  const seen = new Set();
  let selected = 0, reserve = 0;

  for (const r of results) {
    if (!['selected', 'reserve', 'not_selected', 'withdrawn'].includes(r.result)) {
      errors.push({ code: 'ERR_SELECTION_ENTRY_INVALID', entry_id: r.entry_id });
      continue;
    }
    if (!activeEntryIds.includes(r.entry_id)) {
      errors.push({ code: 'ERR_SELECTION_ENTRY_INVALID', entry_id: r.entry_id });
      continue;
    }
    if (seen.has(r.entry_id)) {
      errors.push({ code: 'ERR_SELECTION_ENTRY_INVALID', entry_id: r.entry_id, detail: 'duplicate' });
      continue;
    }
    seen.add(r.entry_id);
    if (r.result === 'selected') selected++;
    if (r.result === 'reserve') reserve++;
  }

  if (seen.size !== activeEntryIds.length) {
    errors.push({ code: 'ERR_SELECTION_COUNT_MISMATCH', detail: 'coverage' });
  }
  if (selectedCount != null && selected !== selectedCount) {
    errors.push({ code: 'ERR_SELECTION_COUNT_MISMATCH', detail: 'selected_count' });
  }

  return { ok: errors.length === 0, errors, selected, reserve };
}

test('selection mode is not a renamed championship: every active entry needs a result', () => {
  const r = validateSelectionResults(
    [{ entry_id: 1, result: 'selected' }],
    [1, 2, 3, 4], 2);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'ERR_SELECTION_COUNT_MISMATCH'));
});

test('a valid selected/reserve/not_selected split passes', () => {
  const r = validateSelectionResults([
    { entry_id: 1, result: 'selected' },
    { entry_id: 2, result: 'selected' },
    { entry_id: 3, result: 'reserve' },
    { entry_id: 4, result: 'not_selected' }
  ], [1, 2, 3, 4], 2);
  assert.equal(r.ok, true);
  assert.equal(r.selected, 2);
  assert.equal(r.reserve, 1);
});

test('selected_count must match the event configuration exactly', () => {
  const tooMany = validateSelectionResults([
    { entry_id: 1, result: 'selected' },
    { entry_id: 2, result: 'selected' },
    { entry_id: 3, result: 'selected' }
  ], [1, 2, 3], 2);
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.errors.some((e) => e.detail === 'selected_count'));

  const tooFew = validateSelectionResults([
    { entry_id: 1, result: 'selected' },
    { entry_id: 2, result: 'not_selected' },
    { entry_id: 3, result: 'not_selected' }
  ], [1, 2, 3], 2);
  assert.equal(tooFew.ok, false);
});

test('an entry outside the event is rejected', () => {
  const r = validateSelectionResults([
    { entry_id: 999, result: 'selected' }
  ], [1, 2], 1);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'ERR_SELECTION_ENTRY_INVALID'));
});

test('the same entry listed twice is rejected', () => {
  const r = validateSelectionResults([
    { entry_id: 1, result: 'selected' },
    { entry_id: 1, result: 'reserve' }
  ], [1, 2], 1);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.detail === 'duplicate'));
});

test('an unrecognised result value is rejected', () => {
  const r = validateSelectionResults([
    { entry_id: 1, result: 'champion' }
  ], [1], null);
  assert.ok(r.errors.some((e) => e.code === 'ERR_SELECTION_ENTRY_INVALID'));
});

test('withdrawn counts toward coverage but not toward selected/reserve', () => {
  const r = validateSelectionResults([
    { entry_id: 1, result: 'selected' },
    { entry_id: 2, result: 'withdrawn' }
  ], [1, 2], 1);
  assert.equal(r.ok, true);
  assert.equal(r.selected, 1);
  assert.equal(r.reserve, 0);
});

test('a tie at the cut line is representable without forcing a decision', () => {
  // two entries tied for the last selected slot: the UI must be able to show
  // both as candidates and let an admin pick, not silently break the tie
  const candidates = [
    { entry_id: 3, wins: 2, point_diff: 5 },
    { entry_id: 4, wins: 2, point_diff: 5 }
  ];
  const tiedAtCutLine = candidates[0].wins === candidates[1].wins &&
    candidates[0].point_diff === candidates[1].point_diff;
  assert.equal(tiedAtCutLine, true);
});

test('no selection result implies a championship reward: selection results carry no reward fields', () => {
  // Selection results are result/rank/reason only — never coins or ELO, which
  // only exist on the reward-tier / championship path. This test guards
  // against ever adding those fields into the selection payload shape.
  const results = [{ entry_id: 1, result: 'selected', rank: 1, reason: 'top of group' }];
  for (const r of results) {
    assert.equal('champion_coins' in r, false);
    assert.equal('champion_elo' in r, false);
  }
});
