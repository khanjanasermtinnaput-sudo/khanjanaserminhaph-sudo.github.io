-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 1 — Reference tables + catalog split-brain reconciliation
-- (see full history/detail in this file's step-1 comment block below;
--  applied via Supabase MCP apply_migration, migration: inv_step1_catalog_refs)
-- ═══════════════════════════════════════════════════════════════════════
-- [Step 1 SQL already applied — kept for reference; see git history for the
--  exact statements. Summary: created item_categories/item_rarities ref
--  tables, canonicalized frame:solar/name:solar -> solaremperor, corrected
--  rarity drift, added the 3 fusion-only outputs, swapped item_catalog's
--  category/rarity CHECKs for FKs, added equip_slot/max_stack/expires_days/
--  is_consumable/preview_meta columns.]

-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 2 — Extend player_items (equip/lock/favorite state)
-- Applied via Supabase MCP apply_migration (migration name: inv_step2_player_items_state)
--
-- Adds a surrogate id (the "inventory_id" other systems — locks, trades,
-- listings — will reference in later steps), equip state modeled as
-- is_equipped + equip_slot with a partial unique index (one equipped item
-- per slot per player, replacing the legacy scalar columns as the source
-- of truth), lock/favorite/new flags, a coarse lifecycle `state`, and
-- soft-delete. Backfills equip state from the legacy scalar columns +
-- blob (players.gacha_frame/name/emoji, gacha_inventory.equippedElement,
-- owned_effects) — verified no player has a stale 'solar' value there, so
-- no aliasing needed in the backfill.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE player_items
  ADD COLUMN id           bigint GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN is_equipped  boolean NOT NULL DEFAULT false,
  ADD COLUMN equip_slot   text,
  ADD COLUMN is_locked    boolean NOT NULL DEFAULT false,
  ADD COLUMN is_favorite  boolean NOT NULL DEFAULT false,
  ADD COLUMN is_new       boolean NOT NULL DEFAULT false,
  ADD COLUMN state        text NOT NULL DEFAULT 'owned',
  ADD COLUMN expires_at   timestamptz,
  ADD COLUMN deleted_at   timestamptz,
  ADD COLUMN source       text,
  ADD COLUMN obtained_ref jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE player_items ADD CONSTRAINT player_items_id_unique UNIQUE (id);
ALTER TABLE player_items ADD CONSTRAINT player_items_state_check
  CHECK (state IN ('owned','expired','archived','hidden'));

-- Backfill equip state from legacy scalar columns + blob
UPDATE player_items pi SET is_equipped = true, equip_slot = 'frame'
FROM players p WHERE pi.player_id = p.id AND p.gacha_frame IS NOT NULL
  AND pi.item_id = 'frame:' || p.gacha_frame;

UPDATE player_items pi SET is_equipped = true, equip_slot = 'name'
FROM players p WHERE pi.player_id = p.id AND p.gacha_name IS NOT NULL
  AND pi.item_id = 'name:' || p.gacha_name;

UPDATE player_items pi SET is_equipped = true, equip_slot = 'emoji'
FROM players p WHERE pi.player_id = p.id AND p.gacha_emoji IS NOT NULL
  AND pi.item_id = 'emoji:' || p.gacha_emoji;

UPDATE player_items pi SET is_equipped = true, equip_slot = 'element'
FROM players p
WHERE pi.player_id = p.id
  AND (p.gacha_inventory::jsonb ->> 'equippedElement') IS NOT NULL
  AND pi.item_id = 'element:' || (p.gacha_inventory::jsonb ->> 'equippedElement');

-- econ_safe_jsonb() only accepts JSON objects (returns {} for arrays), so
-- it can't be reused here; owned_effects is a JSON array — guard inline.
UPDATE player_items pi SET is_equipped = true, equip_slot = 'effect'
FROM players p, jsonb_array_elements_text(
  CASE WHEN p.owned_effects IS NOT NULL AND p.owned_effects NOT IN ('', 'null')
       THEN p.owned_effects::jsonb ELSE '[]'::jsonb END
) AS eff(value)
WHERE pi.player_id = p.id AND pi.item_id = 'effect:' || eff.value;

-- One equipped item per (player, slot) — the core equip invariant
CREATE UNIQUE INDEX player_items_one_equip_per_slot
  ON player_items (player_id, equip_slot) WHERE is_equipped;

-- Supporting indexes (item lookups, active-inventory scans)
CREATE INDEX player_items_item_id_idx ON player_items (item_id);
CREATE INDEX player_items_active_idx ON player_items (player_id) WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 3 — Reconcile ownership split-brain (blob vs player_items)
-- Applied via Supabase MCP apply_migration (migration name: inv_step3_reconcile_ownership)
--
-- A full diagnostic (union of gacha_inventory's 5 array keys + equipped
-- scalars + equippedElement + owned_effects, across all 35 players, with
-- 'solar'->'solaremperor' aliasing) found exactly ONE gap: player 17 has
-- equippedElement='fire' in the blob (granted via gacha-element.js's
-- localStorage-first path) but no player_items row was ever created for
-- it. Every other player/category already matched — the previously-found
-- "player 20: 30 vs 28" drift had since self-healed via the existing
-- one-way econ_sync_player_blob trigger firing on a later transaction,
-- confirming the trigger direction (player_items -> blob) works; the only
-- real gaps are grants that bypassed player_items entirely.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO player_items (player_id, item_id, qty, is_equipped, equip_slot, source)
VALUES (17, 'element:fire', 1, true, 'element', 'reconcile_2026_07_06')
ON CONFLICT (player_id, item_id) DO UPDATE
  SET is_equipped = true, equip_slot = 'element';
