// Error-code parity: every ERR_* the V2 SQL can raise must have a Thai message.
//
// Follows the same cross-file approach as tests/level-rewards-parity.test.mjs —
// it reads the migration sources rather than importing them, so a new RAISE
// that nobody translated fails the suite instead of reaching a user as
// "เกิดข้อผิดพลาด".
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../js/tournament/errors.js');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const sqlFiles = readdirSync(repoRoot)
  .filter((f) => f.startsWith('supabase_tournament_v2_') && f.endsWith('.sql'));

function raisedCodes() {
  const found = new Set();
  for (const file of sqlFiles) {
    const src = readFileSync(join(repoRoot, file), 'utf8');
    // only real RAISE sites, not codes mentioned inside comments or details
    const re = /raise\s+exception\s+'(ERR_[A-Z0-9_]+)'/gi;
    let m;
    while ((m = re.exec(src)) !== null) found.add(m[1]);
  }
  return found;
}

test('the V2 migration files were found', () => {
  assert.ok(sqlFiles.length >= 4, `expected the V2 sql files, saw ${sqlFiles.join(', ')}`);
});

test('every error code raised in SQL has a Thai message', () => {
  const missing = [...raisedCodes()].filter((c) => !E.MESSAGES[c]).sort();
  assert.deepEqual(missing, [], `untranslated error codes: ${missing.join(', ')}`);
});

test('no Thai message is an empty string', () => {
  const blank = Object.keys(E.MESSAGES).filter((k) => !String(E.MESSAGES[k]).trim());
  assert.deepEqual(blank, []);
});

test('codes are extracted from a PostgREST-shaped error', () => {
  assert.equal(E.codeOf({ message: 'ERR_NOT_ADMIN' }), 'ERR_NOT_ADMIN');
  assert.equal(E.codeOf({ message: 'ERR_ADVANCE_EXCEEDS_TEAMS', details: '5 advancers from a group of 4' }),
    'ERR_ADVANCE_EXCEEDS_TEAMS');
  assert.equal(E.codeOf('ERR_VERSION_CONFLICT'), 'ERR_VERSION_CONFLICT');
  assert.equal(E.codeOf({ message: 'some unrelated failure' }), null);
  assert.equal(E.codeOf(null), null);
});

test('a known code becomes Thai and an unknown one falls back', () => {
  assert.equal(E.toThai({ message: 'ERR_NOT_ADMIN' }), 'เฉพาะผู้ดูแลระบบเท่านั้น');
  assert.equal(E.toThai({ message: 'ERR_IMPOSSIBLE_CAP_SCORE' }),
    'คะแนนนี้เป็นไปไม่ได้ เพดาน 30 แต้มต้องจบที่ 30-29');
  assert.equal(E.toThai({ message: '500 internal server error' }), E.FALLBACK);
  assert.equal(E.toThai(undefined), E.FALLBACK);
});

test('raw Postgres text never reaches the user', () => {
  const pgish = { message: 'duplicate key value violates unique constraint "ux_entry_member..."' };
  assert.equal(E.toThai(pgish), E.FALLBACK);
  assert.ok(!E.toThai(pgish).includes('constraint'));
});
