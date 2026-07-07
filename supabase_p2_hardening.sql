-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 2.6 — Realtime, remaining indexes, advisors pass
-- Applied via Supabase MCP apply_migration (migrations: p2_step6_realtime_hardening, p2_step6_fk_indexes)
--
-- equipment_presets/item_effects(effect_key)/player_active_effects(player_id
-- via PK)/equipment_presets(player_id) were already indexed at creation
-- time (Steps 3-4). Ran get_advisors after all of Phase 2: only 3 real
-- unindexed-FK findings on new tables (equipment_slots.category,
-- item_categories.equip_slot, player_active_effects.effect_key) - fixed
-- below. "Unused index" notices on brand-new indexes (item_effects_
-- effect_key_idx etc.) are expected for a framework seeded empty with no
-- real traffic yet, not a real issue. No multiple-permissive-policy
-- regressions this time (per-command policies used from the start).
-- Security: every new RPC flagged as "SECURITY DEFINER executable by
-- anon/authenticated" is the same expected pattern as every RPC across
-- this whole app (session_uid()-gated) - not a Phase 2 regression.
-- ═══════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE equipment_presets;

CREATE INDEX equipment_slots_category_idx ON equipment_slots (category);
CREATE INDEX item_categories_equip_slot_idx ON item_categories (equip_slot);
CREATE INDEX player_active_effects_effect_key_idx ON player_active_effects (effect_key);

-- ═══════════════════════════════════════════════════════════════════════
-- Gap found while reviewing: Step 11's econ_sync_equip_from_legacy trigger
-- (fires when the legacy client equips via direct gacha_frame/inventory
-- writes) never called recalc_player_effects — only the NEW inv_equip/
-- inv_unequip RPCs did. Since the legacy client is the one real players
-- actually use for equipping, and effect_definitions/item_effects are
-- currently empty, this had zero live impact today — but it's a real gap
-- for correctness once buff items exist. Fixed by calling
-- recalc_player_effects at the end of that trigger too (guarded to only
-- fire at the outermost trigger depth, avoiding redundant recalcs during
-- the cross-table cascade traced in Step 11).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION econ_sync_equip_from_legacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_el text; v_old_el text;
  v_new_effects text[]; v_old_effects text[];
BEGIN
  IF pg_trigger_depth() > 4 THEN RETURN NEW; END IF;

  IF NEW.gacha_frame IS DISTINCT FROM OLD.gacha_frame THEN
    UPDATE player_items SET is_equipped = false, equip_slot = NULL
      WHERE player_id = NEW.id AND equip_slot = 'frame' AND is_equipped;
    IF NEW.gacha_frame IS NOT NULL THEN
      UPDATE player_items SET is_equipped = true, equip_slot = 'frame'
        WHERE player_id = NEW.id AND item_id = 'frame:' || NEW.gacha_frame;
    END IF;
  END IF;

  IF NEW.gacha_name IS DISTINCT FROM OLD.gacha_name THEN
    UPDATE player_items SET is_equipped = false, equip_slot = NULL
      WHERE player_id = NEW.id AND equip_slot = 'name' AND is_equipped;
    IF NEW.gacha_name IS NOT NULL THEN
      UPDATE player_items SET is_equipped = true, equip_slot = 'name'
        WHERE player_id = NEW.id AND item_id = 'name:' || NEW.gacha_name;
    END IF;
  END IF;

  IF NEW.gacha_emoji IS DISTINCT FROM OLD.gacha_emoji THEN
    UPDATE player_items SET is_equipped = false, equip_slot = NULL
      WHERE player_id = NEW.id AND equip_slot = 'emoji' AND is_equipped;
    IF NEW.gacha_emoji IS NOT NULL THEN
      UPDATE player_items SET is_equipped = true, equip_slot = 'emoji'
        WHERE player_id = NEW.id AND item_id = 'emoji:' || NEW.gacha_emoji;
    END IF;
  END IF;

  IF NEW.gacha_inventory IS DISTINCT FROM OLD.gacha_inventory THEN
    v_new_el := econ_safe_jsonb(NEW.gacha_inventory) ->> 'equippedElement';
    v_old_el := econ_safe_jsonb(OLD.gacha_inventory) ->> 'equippedElement';
    IF v_new_el IS DISTINCT FROM v_old_el THEN
      UPDATE player_items SET is_equipped = false, equip_slot = NULL
        WHERE player_id = NEW.id AND equip_slot = 'element' AND is_equipped;
      IF v_new_el IS NOT NULL THEN
        UPDATE player_items SET is_equipped = true, equip_slot = 'element'
          WHERE player_id = NEW.id AND item_id = 'element:' || v_new_el;
      END IF;
    END IF;
  END IF;

  IF NEW.owned_effects IS DISTINCT FROM OLD.owned_effects THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_new_effects FROM jsonb_array_elements_text(
      CASE WHEN NEW.owned_effects IS NOT NULL AND NEW.owned_effects NOT IN ('', 'null')
           THEN NEW.owned_effects::jsonb ELSE '[]'::jsonb END) x;
    SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_old_effects FROM jsonb_array_elements_text(
      CASE WHEN OLD.owned_effects IS NOT NULL AND OLD.owned_effects NOT IN ('', 'null')
           THEN OLD.owned_effects::jsonb ELSE '[]'::jsonb END) x;
    IF v_new_effects IS DISTINCT FROM v_old_effects THEN
      UPDATE player_items SET is_equipped = false, equip_slot = NULL
        WHERE player_id = NEW.id AND equip_slot = 'effect' AND is_equipped
          AND item_id <> ALL (SELECT 'effect:' || e FROM unnest(v_new_effects) e);
      IF array_length(v_new_effects, 1) > 0 THEN
        UPDATE player_items SET is_equipped = true, equip_slot = 'effect'
          WHERE player_id = NEW.id AND item_id IN (SELECT 'effect:' || e FROM unnest(v_new_effects) e);
      END IF;
    END IF;
  END IF;

  IF pg_trigger_depth() <= 1 THEN
    PERFORM recalc_player_effects(NEW.id);
  END IF;

  RETURN NEW;
END $$;
