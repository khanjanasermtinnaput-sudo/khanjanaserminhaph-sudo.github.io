-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 2.4 — Equipment presets (one-click loadouts)
-- Applied via Supabase MCP apply_migration (migration name: p2_step4_presets)
--
-- preset_apply() reuses inv_equip/inv_unequip (Step 2) rather than
-- duplicating equip logic — same validation, ledger, audit, and effect
-- recalc for free. Re-validates ownership per item on EVERY apply (spec
-- requirement) and skips a since-traded/locked/deleted item without
-- failing the whole apply, per the plan's graceful-degradation note.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE equipment_presets (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES players(id),
  name       text NOT NULL,
  slots      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"frame": "frame:rainbow", "name": "name:ice", ...}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, name)
);

ALTER TABLE equipment_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipment_presets_read ON equipment_presets FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON equipment_presets TO anon, authenticated;
CREATE INDEX equipment_presets_player_idx ON equipment_presets (player_id);

CREATE OR REPLACE FUNCTION preset_save(p_name text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_slots jsonb; v_id bigint; v_count int;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'bad_name'; END IF;

  SELECT count(*) INTO v_count FROM equipment_presets WHERE player_id = v_pid;
  IF v_count >= 10 AND NOT EXISTS (SELECT 1 FROM equipment_presets WHERE player_id = v_pid AND name = p_name) THEN
    RAISE EXCEPTION 'preset_limit_reached';
  END IF;

  SELECT COALESCE(jsonb_object_agg(equip_slot, item_id), '{}'::jsonb) INTO v_slots
  FROM player_items WHERE player_id = v_pid AND is_equipped AND deleted_at IS NULL;

  INSERT INTO equipment_presets (player_id, name, slots)
  VALUES (v_pid, p_name, v_slots)
  ON CONFLICT (player_id, name) DO UPDATE SET slots = EXCLUDED.slots, updated_at = now()
  RETURNING id INTO v_id;

  PERFORM log_audit(v_pid, 'preset_save', 'equipment_presets', v_id::text, jsonb_build_object('name', p_name, 'slots', v_slots));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION preset_apply(p_preset_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid bigint; v_preset equipment_presets%ROWTYPE;
  v_slot text; v_item_id text; v_current text;
  v_applied jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_preset FROM equipment_presets WHERE id = p_preset_id AND player_id = v_pid;
  IF v_preset.id IS NULL THEN RAISE EXCEPTION 'preset_not_found'; END IF;

  -- Every active slot: apply the preset's item (or unequip if the preset
  -- doesn't specify one), re-validating ownership fresh on every call.
  FOR v_slot IN SELECT slot_key FROM equipment_slots WHERE enabled LOOP
    v_item_id := v_preset.slots ->> v_slot;
    SELECT item_id INTO v_current FROM player_items WHERE player_id = v_pid AND equip_slot = v_slot AND is_equipped;

    IF v_item_id IS NULL THEN
      IF v_current IS NOT NULL THEN PERFORM inv_unequip(v_slot); END IF;
      CONTINUE;
    END IF;
    IF v_item_id = v_current THEN CONTINUE; END IF;

    BEGIN
      PERFORM inv_equip(v_item_id);
      v_applied := v_applied || jsonb_build_object('slot', v_slot, 'item_id', v_item_id);
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped || jsonb_build_object('slot', v_slot, 'item_id', v_item_id, 'reason', SQLERRM);
    END;
  END LOOP;

  PERFORM log_audit(v_pid, 'preset_apply', 'equipment_presets', p_preset_id::text,
    jsonb_build_object('applied', v_applied, 'skipped', v_skipped));

  RETURN jsonb_build_object('ok', true, 'applied', v_applied, 'skipped', v_skipped);
END $$;

CREATE OR REPLACE FUNCTION preset_delete(p_preset_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  DELETE FROM equipment_presets WHERE id = p_preset_id AND player_id = v_pid;
  IF NOT FOUND THEN RAISE EXCEPTION 'preset_not_found'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
