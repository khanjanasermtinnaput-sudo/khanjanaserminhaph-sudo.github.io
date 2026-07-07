-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 2.1 — equipment_slots (data-driven slot config)
-- Applied via Supabase MCP apply_migration (migration name: p2_step1_equipment_slots)
--
-- "Never hardcode slot names" — seeds the 5 slots actually in use today
-- (mapped to their real item_categories) PLUS the spec's full aspirational
-- slot list as disabled placeholder rows (category=NULL, no items exist
-- for them yet). Flipping enabled=true + adding a category/items later
-- requires zero schema change. `title` has an item_categories row already
-- (0 items) — kept disabled here; see plan note on not conflating this
-- with the separate prime_titles achievement system.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE equipment_slots (
  slot_key         text PRIMARY KEY,
  display_name_en  text NOT NULL,
  display_name_th  text NOT NULL,
  icon             text,
  category         text REFERENCES item_categories(code),
  max_equipped     int NOT NULL DEFAULT 1,
  display_priority int NOT NULL DEFAULT 0,
  visibility       text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private','tournament')),
  enabled          boolean NOT NULL DEFAULT true,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO equipment_slots (slot_key, display_name_en, display_name_th, icon, category, display_priority, enabled) VALUES
  ('frame',   'Frame',       'กรอบ',         '🖼️', 'frame',   0, true),
  ('name',    'Name Effect', 'ชื่อเอฟเฟกต์',  '✨', 'name',    1, true),
  ('emoji',   'Emoji',       'อีโมจิ',        '🎭', 'emoji',   2, true),
  ('element', 'Element',     'ธาตุ',          '☯️', 'element', 3, true),
  ('effect',  'Special',     'เอฟเฟกต์',      '⚡', 'effect',  4, true),
  ('title',   'Title',       'ตำแหน่ง',       '🏷️', 'title',   5, false);

INSERT INTO equipment_slots (slot_key, display_name_en, display_name_th, icon, category, enabled) VALUES
  ('avatar',             'Avatar',              'อวตาร',            '👤', NULL, false),
  ('avatar_border',      'Avatar Border',       'ขอบอวตาร',         '🔲', NULL, false),
  ('badge',              'Badge',               'ตรา',              '🎖️', NULL, false),
  ('aura',               'Aura',                'ออร่า',            '🌟', NULL, false),
  ('name_color',         'Name Color',          'สีชื่อ',           '🎨', NULL, false),
  ('chat_bubble',        'Chat Bubble',         'ฟองแชท',           '💬', NULL, false),
  ('chat_effect',        'Chat Effect',         'เอฟเฟกต์แชท',      '💭', NULL, false),
  ('racket_skin',        'Racket Skin',         'สกินไม้แร็กเกต',   '🏸', NULL, false),
  ('court_effect',       'Court Effect',        'เอฟเฟกต์สนาม',     '🎾', NULL, false),
  ('smash_effect',       'Smash Effect',        'เอฟเฟกต์สแมช',     '💥', NULL, false),
  ('win_animation',      'Win Animation',       'แอนิเมชันชนะ',     '🏆', NULL, false),
  ('profile_background', 'Profile Background',  'พื้นหลังโปรไฟล์',  '🖼️', NULL, false),
  ('profile_music',      'Profile Music',       'เพลงโปรไฟล์',      '🎵', NULL, false),
  ('banner',             'Banner',              'แบนเนอร์',         '🚩', NULL, false),
  ('medal',              'Medal',               'เหรียญ',           '🥇', NULL, false),
  ('event_cosmetic',     'Event Cosmetic',      'ของแต่งอีเวนต์',   '🎉', NULL, false),
  ('tournament_cosmetic','Tournament Cosmetic', 'ของแต่งทัวร์นาเมนต์', '🏆', NULL, false);

ALTER TABLE equipment_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read ON equipment_slots FOR SELECT USING (true);
CREATE POLICY ref_admin_insert ON equipment_slots FOR INSERT WITH CHECK (is_admin_caller());
CREATE POLICY ref_admin_update ON equipment_slots FOR UPDATE USING (is_admin_caller()) WITH CHECK (is_admin_caller());
CREATE POLICY ref_admin_delete ON equipment_slots FOR DELETE USING (is_admin_caller());
GRANT ALL ON equipment_slots TO anon, authenticated;

-- FK: item_categories.equip_slot must reference a real slot (all 6
-- non-null values already seeded above, so this validates immediately).
ALTER TABLE item_categories ADD CONSTRAINT item_categories_equip_slot_fkey
  FOREIGN KEY (equip_slot) REFERENCES equipment_slots(slot_key);

-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 2.2 — Complete the equip/unequip workflow
-- Applied via Supabase MCP apply_migration (migration name: p2_step2_equip_workflow)
--
-- inv_equip/inv_unequip (Phase 1B Step 11, extended in 1B.4 with ledger
-- logging) were missing 3 things the spec's equip workflow calls for:
-- expiry check, universal audit_logs write, and rate limiting against
-- spam-equip. Same signatures — CREATE OR REPLACE is a true replace here
-- (verified via pg_proc count after, per the Step 12 overload lesson).
-- ═══════════════════════════════════════════════════════════════════════

-- Stub — P2.3 replaces this with the real effect-recalculation engine.
-- Same signature there, so it's a true CREATE OR REPLACE, not a new overload.
CREATE OR REPLACE FUNCTION recalc_player_effects(p_player bigint) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN END $$;

CREATE OR REPLACE FUNCTION inv_equip(p_item_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_slot text; v_inv_id bigint; v_prev_item text; v_expires_at timestamptz;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  PERFORM econ_rate_check(v_pid, 'equip', 30, interval '1 minute');

  SELECT pi.id, c.equip_slot, pi.expires_at INTO v_inv_id, v_slot, v_expires_at FROM player_items pi
    JOIN item_catalog c ON c.id = pi.item_id
    WHERE pi.player_id = v_pid AND pi.item_id = p_item_id AND pi.deleted_at IS NULL FOR UPDATE OF pi;
  IF v_inv_id IS NULL THEN RAISE EXCEPTION 'not_owned'; END IF;
  IF (SELECT is_locked FROM player_items WHERE id = v_inv_id) THEN RAISE EXCEPTION 'item_locked'; END IF;
  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN RAISE EXCEPTION 'item_expired'; END IF;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'not_equippable'; END IF;
  IF NOT (SELECT enabled FROM equipment_slots WHERE slot_key = v_slot) THEN RAISE EXCEPTION 'slot_disabled'; END IF;

  SELECT item_id INTO v_prev_item FROM player_items WHERE player_id = v_pid AND equip_slot = v_slot AND is_equipped;

  UPDATE player_items SET is_equipped = false WHERE player_id = v_pid AND equip_slot = v_slot AND is_equipped;
  UPDATE player_items SET is_equipped = true, equip_slot = v_slot WHERE id = v_inv_id;

  INSERT INTO economy_ledger (player_id, verb, item_id, ref_type, meta)
  VALUES (v_pid, 'equip', p_item_id, 'inventory', jsonb_build_object('slot', v_slot, 'replaced', v_prev_item));
  PERFORM log_audit(v_pid, 'equip_item', 'player_items', v_inv_id::text,
    jsonb_build_object('slot', v_slot, 'item_id', p_item_id, 'replaced', v_prev_item));

  PERFORM recalc_player_effects(v_pid);

  RETURN jsonb_build_object('ok', true, 'slot', v_slot);
END $$;

CREATE OR REPLACE FUNCTION inv_unequip(p_slot text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_item text;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  PERFORM econ_rate_check(v_pid, 'equip', 30, interval '1 minute');

  SELECT item_id INTO v_item FROM player_items WHERE player_id = v_pid AND equip_slot = p_slot AND is_equipped;
  UPDATE player_items SET is_equipped = false WHERE player_id = v_pid AND equip_slot = p_slot AND is_equipped;

  IF v_item IS NOT NULL THEN
    INSERT INTO economy_ledger (player_id, verb, item_id, ref_type, meta)
    VALUES (v_pid, 'unequip', v_item, 'inventory', jsonb_build_object('slot', p_slot));
    PERFORM log_audit(v_pid, 'unequip_item', 'player_items', NULL, jsonb_build_object('slot', p_slot, 'item_id', v_item));
    PERFORM recalc_player_effects(v_pid);
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;
