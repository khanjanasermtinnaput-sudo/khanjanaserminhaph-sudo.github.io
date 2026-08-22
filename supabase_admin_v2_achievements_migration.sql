-- Admin V2 — one-time migration of legacy custom achievements
-- Applied directly to production (project tprmqsfbeyqurwqpmpia) via Supabase MCP
-- on 2026-08-22. This is a DATA script (real INSERTs from real, human-verified
-- live data), not a repeatable RPC — it is meant to run exactly once, but is
-- written to be safe to re-run (see the two unique indexes + ON CONFLICT
-- guards below) in case it needs to be reviewed/re-applied.
--
-- HARD CONSTRAINT: players.prime_titles and players.custom_ach are NEVER
-- touched by this script. The legacy UI (js/season.js renderCachAdmin/
-- buildCachItemHTML, js/achievements.js getAchievements) reads those columns
-- directly and keeps working completely unchanged. This is a copy into the
-- new admin_achievements/player_achievement_grants tables, not a cutover.
--
-- Source data (queried live from production, decoded from the __catalog:/
-- __cach: sentinels packed into players.prime_titles — see js/season.js):
-- a school "กีฬาสี" (sports day) awards set — 6 achievement definitions held
-- in the lowest-id admin's (id=16, "Epic") prime_titles catalog, and 13
-- individual awards across 9 players, decoded and cross-checked by hand.

alter table admin_achievements add column if not exists legacy_id text;
create unique index if not exists idx_admin_achievements_legacy_id
  on admin_achievements(legacy_id) where legacy_id is not null;

-- No natural unique constraint existed on active grants before this — also a
-- small real hardening beyond the migration itself: rpc_admin_grant_achievement's
-- existing "already_granted" check (supabase_admin_v2_achievements.sql) is a
-- SELECT-then-INSERT race today without this index backing it.
create unique index if not exists idx_grants_unique_active
  on player_achievement_grants(achievement_id, player_id) where revoked_at is null;

-- ── 1. The 6 catalog achievements ───────────────────────────────────────
insert into admin_achievements (legacy_id, title, description, icon, rarity, hidden, repeatable, rule, reward, created_by)
values
  ('cach_1780215631758', 'Silver medal 2025', null, '🏆', 'silver', false, false, null, null, 16),
  ('cach_1779818534922', 'Gold medal 2025', 'ได้รับเหรียญทองกีฬาสีปี2025', '🏆', 'gold', false, false, null, null, 16),
  ('cach_1779818572809', 'Gold medal 2024', null, '🏆', 'gold', false, false, null, null, 16),
  ('cach_1779818674188', 'Silver medal 2024', null, '🏆', 'silver', false, false, null, null, 16),
  ('cach_1780758739206', 'No.1 Ranking', null, '🏆', 'gold', false, false, null, null, 16),
  ('cach_1787140473215', 'โม้เยสม้า', 'โม้เกินตีไม่โดน', '🏆', 'bronze', false, false, null, null, 16)
on conflict (legacy_id) where legacy_id is not null do nothing;

-- ── 2. The 13 grants ─────────────────────────────────────────────────────
-- granted_at defaults to migration time — there is genuinely no original
-- award timestamp anywhere in the legacy data, so the note says so plainly
-- rather than implying a fake precise date.
insert into player_achievement_grants (achievement_id, player_id, granted_by, note)
select a.id, g.player_id, 16, 'ย้ายข้อมูลจากระบบเดิม — ไม่ทราบวันที่มอบจริง'
from (values
  (1::bigint,  'cach_1779818572809'),  -- Tinnaput -> Gold medal 2024
  (1,          'cach_1780758739206'),  -- Tinnaput -> No.1 Ranking
  (6,          'cach_1780215631758'),  -- สุดโหดย้านบางพลี -> Silver medal 2025
  (11,         'cach_1779818534922'),  -- น้องโอม -> Gold medal 2025
  (13,         'cach_1780215631758'),  -- ปีศาจหมู -> Silver medal 2025
  (13,         'cach_1779818534922'),  -- ปีศาจหมู -> Gold medal 2025
  (14,         'cach_1779818674188'),  -- วงศ์วรรธน์ -> Silver medal 2024
  (15,         'cach_1779818572809'),  -- Klalnwza007 -> Gold medal 2024
  (17,         'cach_1779818534922'),  -- ลูกแม่ไก่ -> Gold medal 2025
  (17,         'cach_1787140473215'),  -- ลูกแม่ไก่ -> โม้เยสม้า
  (22,         'cach_1779818534922'),  -- ธีวสุ -> Gold medal 2025
  (22,         'cach_1779818674188'),  -- ธีวสุ -> Silver medal 2024
  (26,         'cach_1780215631758')   -- Dr.arm -> Silver medal 2025
) as g(player_id, legacy_id)
join admin_achievements a on a.legacy_id = g.legacy_id
on conflict (achievement_id, player_id) where revoked_at is null do nothing;

-- ── 3. NOT migrated — stale __achpins: references, noted not guessed ──────
-- player 1 pins "cach_1779805034229" — matches no current catalog entry.
-- player 26 pins "cach_1780040445932" and "cach_1780133909840" — matches no
-- current catalog entry either. Pins are cosmetic display choices, not
-- grants, and force-matching a stale id to some other achievement would be
-- guessing at data that doesn't actually exist. Left untouched in
-- players.prime_titles, which this script never writes to anyway.
