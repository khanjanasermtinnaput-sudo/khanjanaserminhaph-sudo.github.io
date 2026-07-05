import assert from 'node:assert/strict';
import { test } from 'node:test';
import expEngine from '../js/exp-engine.js';

const { requiredExp, cumExp, levelFromTotal, expProgress } = expEngine;

test('requiredExp follows 100*L^2', () => {
  assert.equal(requiredExp(1), 100);
  assert.equal(requiredExp(2), 400);
  assert.equal(requiredExp(10), 10000);
});

test('cumExp matches the sum of per-level requirements', () => {
  assert.equal(cumExp(1), 0);
  assert.equal(cumExp(2), requiredExp(1));
  assert.equal(cumExp(3), requiredExp(1) + requiredExp(2));
  assert.equal(cumExp(5), requiredExp(1) + requiredExp(2) + requiredExp(3) + requiredExp(4));
});

test('level floors at 1 for zero or negative exp', () => {
  assert.equal(levelFromTotal(0), 1);
  assert.equal(levelFromTotal(-50), 1);
  assert.equal(expProgress(0).level, 1);
  assert.equal(expProgress(0).currentExp, 0);
});

test('level boundary is exact at cumExp(L)', () => {
  const boundary = cumExp(6);
  assert.equal(levelFromTotal(boundary), 6);
  assert.equal(levelFromTotal(boundary - 1), 5);
  assert.equal(levelFromTotal(boundary + 1), 6);
});

test('expProgress reports consistent current/required/pct', () => {
  const p = expProgress(cumExp(4) + 50);
  assert.equal(p.level, 4);
  assert.equal(p.currentExp, 50);
  assert.equal(p.requiredExp, requiredExp(4));
  assert.ok(p.pct > 0 && p.pct < 100);
});

test('a match win (100) + completion (30) levels a fresh player up from 1', () => {
  const p = expProgress(130);
  assert.equal(p.level, 2);
  assert.equal(p.currentExp, 30);
  assert.equal(p.requiredExp, 400);
});

test('a match loss (50) + completion (30) does not level up a fresh player', () => {
  const p = expProgress(80);
  assert.equal(p.level, 1);
  assert.equal(p.currentExp, 80);
});

test('a single large award can skip multiple levels at once', () => {
  const before = levelFromTotal(80);
  const after = levelFromTotal(80 + 50000);
  assert.equal(before, 1);
  assert.equal(after, 11); // matches the DB smoke test: 50080 total -> level 11
  assert.ok(after - before > 1);
});

test('handles large totals without precision loss at realistic scales', () => {
  const total = cumExp(500) + 12345;
  const p = expProgress(total);
  assert.equal(p.level, 500);
  assert.equal(p.currentExp, 12345);
});

test('level never decreases as total exp grows (monotonicity)', () => {
  let prevLevel = 1;
  for (let t = 0; t <= 2_000_000; t += 137) {
    const lvl = levelFromTotal(t);
    assert.ok(lvl >= prevLevel, `level dropped at total=${t}`);
    prevLevel = lvl;
  }
});

test('requiredExp always equals currentExp + remaining exp to next level', () => {
  for (const total of [0, 1, 99, 100, 250, 999, 1000, 123456]) {
    const p = expProgress(total);
    assert.equal(cumExp(p.level) + p.currentExp, total);
    assert.equal(cumExp(p.level + 1) - cumExp(p.level), p.requiredExp);
  }
});
