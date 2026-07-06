-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 11 — Bidirectional equip-state compat trigger
-- Applied via Supabase MCP apply_migration (migration name: inv_step11_equip_compat)
--
-- Real equip actions (equipGachaFrame/Name/Emoji/Effect in gacha.js,
-- gacha-element.js's element system) still write players.gacha_frame/
-- gacha_name/gacha_emoji/owned_effects/gacha_inventory.equippedElement
-- DIRECTLY — none of that client code was touched in this phase. Without
-- this step, player_items.is_equipped would go stale the moment a real
-- player equips anything (Step 2's backfill was a one-time snapshot).
--
-- This closes the loop both ways:
--   Direction A (existing, unchanged): player_items ownership arrays ->
--     gacha_inventory.frames/names/emojis/effects/elements (unaffected).
--   Direction A extended (NEW, this step): player_items.is_equipped ->
--     gacha_frame/gacha_name/gacha_emoji scalars + gacha_inventory's
--     equippedElement/equippedEffects — added to econ_sync_player_blob so
--     ANY future normalized equip path (inv_equip/inv_unequip, added
--     below) renders correctly on the current client with zero JS changes.
--   Direction B (NEW, this step): legacy scalar/blob equip writes ->
--     player_items.is_equipped/equip_slot, via a new trigger on `players`.
--
-- Cascade safety: an update on one table fires a trigger that updates the
-- other, whose own trigger fires back — traced through by hand (each
-- direction's internal comparison is against the SPECIFIC sub-value that
-- changed, e.g. equippedElement's text, not the whole JSON blob, so a
-- same-value round-trip is a true no-op and the chain terminates after
-- one bounce). A pg_trigger_depth() guard is added anyway as a hard
-- backstop against any edge case this reasoning missed, given this runs
-- on every equip action for real players.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION econ_sync_player_blob(p_player bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_old jsonb;
  v_frames jsonb; v_names jsonb; v_emojis jsonb; v_effects jsonb; v_elements jsonb;
  v_eq_frame text; v_eq_name text; v_eq_emoji text; v_eq_element text; v_eq_effects jsonb;
BEGIN
  IF pg_trigger_depth() > 4 THEN RETURN; END IF;

  SELECT econ_safe_jsonb(gacha_inventory) INTO v_old FROM players WHERE id = p_player;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COALESCE(jsonb_agg(c.value ORDER BY pi.acquired_at) FILTER (WHERE c.category = 'frame'),   '[]'::jsonb),
    COALESCE(jsonb_agg(c.value ORDER BY pi.acquired_at) FILTER (WHERE c.category = 'name'),    '[]'::jsonb),
    COALESCE(jsonb_agg(c.value ORDER BY pi.acquired_at) FILTER (WHERE c.category = 'emoji'),   '[]'::jsonb),
    COALESCE(jsonb_agg(c.value ORDER BY pi.acquired_at) FILTER (WHERE c.category = 'effect'),  '[]'::jsonb),
    COALESCE(jsonb_agg(c.value ORDER BY pi.acquired_at) FILTER (WHERE c.category = 'element'), '[]'::jsonb)
  INTO v_frames, v_names, v_emojis, v_effects, v_elements
  FROM player_items pi JOIN item_catalog c ON c.id = pi.item_id
  WHERE pi.player_id = p_player AND pi.qty > 0 AND pi.deleted_at IS NULL;

  -- NEW: project current equip state from player_items.is_equipped
  SELECT c.value INTO v_eq_frame FROM player_items pi JOIN item_catalog c ON c.id = pi.item_id
    WHERE pi.player_id = p_player AND pi.is_equipped AND pi.equip_slot = 'frame' AND pi.deleted_at IS NULL LIMIT 1;
  SELECT c.value INTO v_eq_name FROM player_items pi JOIN item_catalog c ON c.id = pi.item_id
    WHERE pi.player_id = p_player AND pi.is_equipped AND pi.equip_slot = 'name' AND pi.deleted_at IS NULL LIMIT 1;
  SELECT c.value INTO v_eq_emoji FROM player_items pi JOIN item_catalog c ON c.id = pi.item_id
    WHERE pi.player_id = p_player AND pi.is_equipped AND pi.equip_slot = 'emoji' AND pi.deleted_at IS NULL LIMIT 1;
  SELECT c.value INTO v_eq_element FROM player_items pi JOIN item_catalog c ON c.id = pi.item_id
    WHERE pi.player_id = p_player AND pi.is_equipped AND pi.equip_slot = 'element' AND pi.deleted_at IS NULL LIMIT 1;
  SELECT COALESCE(jsonb_agg(c.value), '[]'::jsonb) INTO v_eq_effects
    FROM player_items pi JOIN item_catalog c ON c.id = pi.item_id
    WHERE pi.player_id = p_player AND pi.is_equipped AND pi.equip_slot = 'effect' AND pi.deleted_at IS NULL;

  UPDATE players SET
    gacha_inventory = (v_old || jsonb_build_object(
      'frames', v_frames, 'names', v_names, 'emojis', v_emojis,
      'effects', v_effects, 'elements', v_elements,
      'equippedElement', to_jsonb(v_eq_element), 'equippedEffects', v_eq_effects))::text,
    owned_effects = v_eq_effects::text,
    gacha_frame = v_eq_frame,
    gacha_name  = v_eq_name,
    gacha_emoji = v_eq_emoji
  WHERE id = p_player;
END $function$;

-- Direction B: legacy scalar/blob equip writes -> player_items.is_equipped
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

  RETURN NEW;
END $$;

CREATE TRIGGER trg_sync_equip_from_legacy
  AFTER UPDATE OF gacha_frame, gacha_name, gacha_emoji, gacha_inventory, owned_effects ON players
  FOR EACH ROW EXECUTE FUNCTION econ_sync_equip_from_legacy();

-- New normalized equip API for future UIs (Collection Book equip buttons
-- etc.) — sets is_equipped directly; the extended econ_sync_player_blob
-- above projects it into the legacy columns so the CURRENT client renders
-- it correctly too, with zero JS changes required either way.
CREATE OR REPLACE FUNCTION inv_equip(p_item_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_slot text; v_inv_id bigint;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT pi.id, c.equip_slot INTO v_inv_id, v_slot FROM player_items pi
    JOIN item_catalog c ON c.id = pi.item_id
    WHERE pi.player_id = v_pid AND pi.item_id = p_item_id AND pi.deleted_at IS NULL FOR UPDATE OF pi;
  IF v_inv_id IS NULL THEN RAISE EXCEPTION 'not_owned'; END IF;
  IF (SELECT is_locked FROM player_items WHERE id = v_inv_id) THEN RAISE EXCEPTION 'item_locked'; END IF;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'not_equippable'; END IF;

  UPDATE player_items SET is_equipped = false WHERE player_id = v_pid AND equip_slot = v_slot AND is_equipped;
  UPDATE player_items SET is_equipped = true, equip_slot = v_slot WHERE id = v_inv_id;

  RETURN jsonb_build_object('ok', true, 'slot', v_slot);
END $$;

CREATE OR REPLACE FUNCTION inv_unequip(p_slot text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE player_items SET is_equipped = false WHERE player_id = v_pid AND equip_slot = p_slot AND is_equipped;
  RETURN jsonb_build_object('ok', true);
END $$;
