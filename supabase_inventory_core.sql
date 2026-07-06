-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 1 — Reference tables + catalog split-brain reconciliation
-- Applied via Supabase MCP apply_migration (migration name: inv_step1_catalog_refs)
--
-- Fixes two live bugs found via direct DB inspection + a real click-through:
--   1. item_catalog still had 'frame:solar'/'name:solar' even though the
--      value was already canonicalized to 'solaremperor' elsewhere
--      (fusion_recipes.inputs already expects 'solaremperor'). 2 player_items
--      rows and 2 gacha_pool_items rows pointed at the stale id.
--   2. item_catalog (32 rows, DB) and window.GAME_CATALOG (30 items, client
--      js/economy-catalog.js) disagree: 'frame:thunder' is live in the pull
--      pool today (gacha_pool_items) and 4 emojis (🛡️⚔️🎪🎮) are already
--      OWNED by players (28 player_items rows) but invisible in the client's
--      Collection Book because it never heard of them. Rarities also
--      disagreed for several shared items (rainbow/robot/void/halo) — the
--      client's rarity is what's actually rendered to players (color,
--      Collection Book tier, Economy Dashboard "rarity distribution" stat),
--      so it wins as the corrected value.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Reference tables (categories/rarities become data, not hardcoded CHECKs)
CREATE TABLE item_categories (
  code        text PRIMARY KEY,
  label_en    text NOT NULL,
  label_th    text NOT NULL,
  icon        text,
  equip_slot  text,               -- slot family this category equips into (null = not equippable)
  sort        int  NOT NULL DEFAULT 0
);

CREATE TABLE item_rarities (
  code        text PRIMARY KEY,
  label_en    text NOT NULL,
  label_th    text NOT NULL,
  color       text NOT NULL,
  rank        int  NOT NULL UNIQUE
);

INSERT INTO item_categories (code, label_en, label_th, icon, equip_slot, sort) VALUES
  ('frame',      'Frame',       'กรอบ',        '🖼️', 'frame',   0),
  ('name',       'Name Effect', 'ชื่อเอฟเฟกต์', '✨', 'name',    1),
  ('emoji',      'Emoji',       'อีโมจิ',       '🎭', 'emoji',   2),
  ('element',    'Element',     'ธาตุ',         '☯️', 'element', 3),
  ('effect',     'Special',     'เอฟเฟกต์',     '⚡', 'effect',  4),
  ('title',      'Title',       'ตำแหน่ง',      '🏷️', 'title',   5),
  ('material',   'Material',    'วัตถุดิบ',      '🧱', NULL,      6),
  ('consumable', 'Consumable',  'ของใช้',       '🧪', NULL,      7);

INSERT INTO item_rarities (code, label_en, label_th, color, rank) VALUES
  ('common',    'Common',    'ธรรมดา',      '#9ca3af', 0),
  ('uncommon',  'Uncommon',  'หายากกลาง',   '#34d399', 1),
  ('rare',      'Rare',      'หายาก',       '#60a5fa', 2),
  ('epic',      'Epic',      'เอปิก',       '#c084fc', 3),
  ('mythic',    'Mythic',    'มิธิก',       '#f97316', 4),
  ('legendary', 'Legendary', 'เลเจนดารี',   '#fbbf24', 5),
  ('secret',    'Secret',    'ซีเคร็ต',     '#00d4ff', 6),
  ('event',     'Event',     'อีเวนต์',     '#f472b6', 7),
  ('limited',   'Limited',   'จำกัด',       '#fb7185', 8);

ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_rarities   ENABLE ROW LEVEL SECURITY;

CREATE POLICY ref_read  ON item_categories FOR SELECT USING (true);
CREATE POLICY ref_admin ON item_categories FOR ALL    USING (is_admin_caller()) WITH CHECK (is_admin_caller());
CREATE POLICY ref_read  ON item_rarities   FOR SELECT USING (true);
CREATE POLICY ref_admin ON item_rarities   FOR ALL    USING (is_admin_caller()) WITH CHECK (is_admin_caller());

GRANT ALL ON item_categories, item_rarities TO anon, authenticated;

-- 2. Drop the old hardcoded CHECKs so corrected/new values aren't rejected
--    before we swap them for FKs at the end of this migration.
ALTER TABLE item_catalog DROP CONSTRAINT item_catalog_category_check;
ALTER TABLE item_catalog DROP CONSTRAINT item_catalog_rarity_check;

-- 3. Canonicalize 'solar' -> 'solaremperor' (id + value), FK-safe order:
--    insert new row, repoint children, delete old row.
INSERT INTO item_catalog (id, category, value, label_th, label_en, rarity, icon, tradeable, fusable, hidden, source, released_at, meta)
SELECT 'frame:solaremperor', category, 'solaremperor', label_th, label_en, rarity, icon, tradeable, fusable, hidden, source, released_at, meta
FROM item_catalog WHERE id = 'frame:solar';
INSERT INTO item_catalog (id, category, value, label_th, label_en, rarity, icon, tradeable, fusable, hidden, source, released_at, meta)
SELECT 'name:solaremperor', category, 'solaremperor', label_th, label_en, rarity, icon, tradeable, fusable, hidden, source, released_at, meta
FROM item_catalog WHERE id = 'name:solar';

UPDATE player_items      SET item_id = 'frame:solaremperor' WHERE item_id = 'frame:solar';
UPDATE player_items      SET item_id = 'name:solaremperor'  WHERE item_id = 'name:solar';
UPDATE gacha_pool_items  SET item_id = 'frame:solaremperor' WHERE item_id = 'frame:solar';
UPDATE gacha_pool_items  SET item_id = 'name:solaremperor'  WHERE item_id = 'name:solar';
UPDATE economy_ledger    SET item_id = 'frame:solaremperor' WHERE item_id = 'frame:solar';
UPDATE economy_ledger    SET item_id = 'name:solaremperor'  WHERE item_id = 'name:solar';

DELETE FROM item_catalog WHERE id IN ('frame:solar', 'name:solar');

-- 4. Correct rarities to match what's actually rendered to players
--    (client js/economy-catalog.js is the design-authoritative source;
--    the DB's original seed values disagreed and were never exercised by
--    any live UI rarity check, per Economy Dashboard verification).
UPDATE item_catalog SET rarity = 'uncommon' WHERE id = 'frame:rainbow';
UPDATE item_catalog SET rarity = 'uncommon' WHERE id = 'frame:robot';
UPDATE item_catalog SET rarity = 'epic'     WHERE id = 'frame:void';
UPDATE item_catalog SET rarity = 'epic'     WHERE id = 'frame:halo';
UPDATE item_catalog SET rarity = 'secret'   WHERE id = 'frame:solaremperor';
UPDATE item_catalog SET rarity = 'epic'     WHERE id = 'name:void';
UPDATE item_catalog SET rarity = 'epic'     WHERE id = 'name:halo';
UPDATE item_catalog SET rarity = 'secret'   WHERE id = 'name:solaremperor';
-- frame:ice/blaze, name:ice/blaze, all 12 emojis, all 6 elements, and
-- effect:rotating_arcs already agree with the client and are left as-is.

-- 5. Add the 3 fusion-only outputs (fuse_items grants these today by
--    writing the legacy blob directly; they must exist in item_catalog
--    before Step 8 migrates fusion onto player_items, which has an
--    item_id FK to this table).
INSERT INTO item_catalog (id, category, value, label_th, label_en, rarity, icon, tradeable, fusable, hidden, source) VALUES
  ('name:eclipse',    'name',  'eclipse',    '🌘 Eclipse Script',    'Eclipse Script',    'legendary', '🌘', true, false, false, 'fusion'),
  ('frame:prismatic', 'frame', 'prismatic',  '🌈 Prismatic Frame',   'Prismatic Frame',   'legendary', '🌈', true, false, false, 'fusion'),
  ('frame:genesis',   'frame', 'genesis',    '👑 Genesis Frame',     'Genesis Frame',     'legendary', '👑', true, false, false, 'fusion');

-- 6. Swap CHECKs for FKs against the new reference tables.
ALTER TABLE item_catalog
  ADD CONSTRAINT item_catalog_category_fkey FOREIGN KEY (category) REFERENCES item_categories(code),
  ADD CONSTRAINT item_catalog_rarity_fkey   FOREIGN KEY (rarity)   REFERENCES item_rarities(code);

-- 7. Extend item_catalog for future systems (equip slots, stacking,
--    expiry, consumables, richer previews) without another CHECK edit.
ALTER TABLE item_catalog
  ADD COLUMN equip_slot     text,
  ADD COLUMN max_stack      int NOT NULL DEFAULT 1,
  ADD COLUMN expires_days   int,
  ADD COLUMN is_consumable  boolean NOT NULL DEFAULT false,
  ADD COLUMN preview_meta   jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE item_catalog c SET equip_slot = cat.equip_slot
FROM item_categories cat WHERE cat.code = c.category;
