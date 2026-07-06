// Guards the one hand-synced contract in the Level system: the reward ladder
// exists twice — LEVEL_REWARDS in js/levels.js (rendering/labels) and the
// CASE map inside rpc_claim_level_reward (supabase_level_system_v2_rewards.sql,
// the enforced server-side source of truth). If either side drifts, claims
// break silently (invalid_reward / wrong cosmetic granted), so this test
// parses both files and asserts id/level/type/value match entry-for-entry.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsSrc = readFileSync(join(root, 'js', 'levels.js'), 'utf8');
const sqlSrc = readFileSync(join(root, 'supabase_level_system_v2_rewards.sql'), 'utf8');

function parseJsRewards(src) {
  const out = {};
  const re = /\{\s*id:\s*'(lvl\d+)',\s*level:\s*(\d+),\s*type:\s*'([^']+)',\s*value:\s*'([^']+)'/g;
  for (let m; (m = re.exec(src)); ) out[m[1]] = { level: Number(m[2]), type: m[3], value: m[4] };
  return out;
}

function parseSqlRewards(src) {
  const out = {};
  const re = /WHEN\s+'(lvl\d+)'\s+THEN\s+v_req_level\s*:=\s*(\d+);\s*v_type\s*:=\s*'([^']+)';\s*v_value\s*:=\s*'([^']+)';/g;
  for (let m; (m = re.exec(src)); ) out[m[1]] = { level: Number(m[2]), type: m[3], value: m[4] };
  return out;
}

const js = parseJsRewards(jsSrc);
const sql = parseSqlRewards(sqlSrc);

test('both sides define the full 12-tier ladder', () => {
  assert.equal(Object.keys(js).length, 12, 'js/levels.js LEVEL_REWARDS should have 12 entries');
  assert.equal(Object.keys(sql).length, 12, 'SQL CASE should have 12 entries');
});

test('reward ids match between JS and SQL', () => {
  assert.deepEqual(Object.keys(js).sort(), Object.keys(sql).sort());
});

test('every reward agrees on level, type, and value', () => {
  for (const id of Object.keys(sql)) {
    assert.ok(js[id], `JS is missing ${id}`);
    assert.equal(js[id].level, sql[id].level, `${id}: level mismatch (js=${js[id].level}, sql=${sql[id].level})`);
    assert.equal(js[id].type, sql[id].type, `${id}: type mismatch (js=${js[id].type}, sql=${sql[id].type})`);
    assert.equal(js[id].value, sql[id].value, `${id}: value mismatch (js=${js[id].value}, sql=${sql[id].value})`);
  }
});

test('reward levels are unique and ascending', () => {
  const levels = Object.values(js).map(r => r.level).sort((a, b) => a - b);
  assert.equal(new Set(levels).size, levels.length, 'duplicate reward level');
  assert.equal(levels[0], 5);
  assert.equal(levels[levels.length - 1], 100);
});

test('every non-title frame value exists in GACHA_FRAME_INNER (js/utils.js)', () => {
  const utilsSrc = readFileSync(join(root, 'js', 'utils.js'), 'utf8');
  const innerBlock = utilsSrc.slice(utilsSrc.indexOf('const GACHA_FRAME_INNER'), utilsSrc.indexOf('const _FRAME_ALIAS'));
  for (const [id, r] of Object.entries(js)) {
    if (r.type !== 'gacha_frame') continue;
    assert.ok(new RegExp(`(^|[\\s{])${r.value}:`, 'm').test(innerBlock),
      `${id}: frame '${r.value}' not found in GACHA_FRAME_INNER — it would render with no visual`);
  }
});
