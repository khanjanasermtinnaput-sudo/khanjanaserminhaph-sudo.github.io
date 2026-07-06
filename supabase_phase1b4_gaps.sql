-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B.4 gaps — adapted to our actual schema (not the generic
-- users/auth.uid()/equipment_slots template it was requested against)
-- Applied via Supabase MCP apply_migration (migration name: inv_phase1b4_gaps)
--
-- Most of the requested "Phase 1B.4" (FKs, unique/check constraints,
-- indexes, RLS, helper functions) was already done in Steps 1-12 under
-- this project's real naming (player_items not inventory, item_catalog
-- not items, session_uid() not auth.uid(), etc.). This closes the 4
-- genuinely missing pieces:
--   1. Realtime wasn't enabled on player_items/market_listings/
--      trade_sessions (only notifications was, from Step 7).
--   2. trade_items.quantity / reward_items.quantity had no CHECK > 0.
--   3. market_listings had no index on status/item_id for browsing.
--   4. inv_equip/inv_unequip wrote no history — violated the project's
--      own "every change is auditable" rule established since Step 5.
-- ═══════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE player_items;
ALTER PUBLICATION supabase_realtime ADD TABLE market_listings;
ALTER PUBLICATION supabase_realtime ADD TABLE trade_sessions;

ALTER TABLE trade_items ADD CONSTRAINT trade_items_quantity_check CHECK (quantity > 0);
ALTER TABLE reward_items ADD CONSTRAINT reward_items_quantity_check CHECK (quantity > 0);

CREATE INDEX market_listings_status_idx ON market_listings (status);
CREATE INDEX market_listings_item_idx ON market_listings (item_id);

-- Equip/unequip history: reuse economy_ledger (this project's unified
-- ledger for both currency and item movements) rather than inventing a
-- separate inventory_history table.
CREATE OR REPLACE FUNCTION inv_equip(p_item_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_slot text; v_inv_id bigint; v_prev_item text;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT pi.id, c.equip_slot INTO v_inv_id, v_slot FROM player_items pi
    JOIN item_catalog c ON c.id = pi.item_id
    WHERE pi.player_id = v_pid AND pi.item_id = p_item_id AND pi.deleted_at IS NULL FOR UPDATE OF pi;
  IF v_inv_id IS NULL THEN RAISE EXCEPTION 'not_owned'; END IF;
  IF (SELECT is_locked FROM player_items WHERE id = v_inv_id) THEN RAISE EXCEPTION 'item_locked'; END IF;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'not_equippable'; END IF;

  SELECT item_id INTO v_prev_item FROM player_items WHERE player_id = v_pid AND equip_slot = v_slot AND is_equipped;

  UPDATE player_items SET is_equipped = false WHERE player_id = v_pid AND equip_slot = v_slot AND is_equipped;
  UPDATE player_items SET is_equipped = true, equip_slot = v_slot WHERE id = v_inv_id;

  INSERT INTO economy_ledger (player_id, verb, item_id, ref_type, meta)
  VALUES (v_pid, 'equip', p_item_id, 'inventory', jsonb_build_object('slot', v_slot, 'replaced', v_prev_item));

  RETURN jsonb_build_object('ok', true, 'slot', v_slot);
END $$;

CREATE OR REPLACE FUNCTION inv_unequip(p_slot text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_item text;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT item_id INTO v_item FROM player_items WHERE player_id = v_pid AND equip_slot = p_slot AND is_equipped;
  UPDATE player_items SET is_equipped = false WHERE player_id = v_pid AND equip_slot = p_slot AND is_equipped;

  IF v_item IS NOT NULL THEN
    INSERT INTO economy_ledger (player_id, verb, item_id, ref_type, meta)
    VALUES (v_pid, 'unequip', v_item, 'inventory', jsonb_build_object('slot', p_slot));
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;
