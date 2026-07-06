-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 8a — Trading primitives (locks, trade, gifts) + mailbox
-- Applied via Supabase MCP apply_migration (migration name: inv_step8a_trading_primitives)
--
-- Purely additive — nothing existing is touched yet. inventory_locks is
-- the anti-dupe backbone: at most one active lock per inventory_id
-- (enforced by a partial unique index), used by Step 8b to replace
-- market's escrow-by-deletion with escrow-by-lock (item never leaves
-- player_items, just becomes untouchable until the listing resolves).
-- trade_sessions/trade_items/trade_logs and gifts are genuinely new
-- features — no existing code references them, zero migration risk.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE inventory_locks (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_id    bigint NOT NULL REFERENCES player_items(id),
  lock_type       text NOT NULL CHECK (lock_type IN
                    ('trade','marketplace','gift','admin','migration','restore','validation')),
  reference_table text,
  reference_id    bigint,  -- for bigint-PK reference tables (market_listings)
  reference_uuid  uuid,    -- for uuid-PK reference tables (trade_sessions, gifts)
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  released_at     timestamptz
);

-- The core anti-dupe invariant: an item can be in at most one active lock.
CREATE UNIQUE INDEX inventory_locks_one_active ON inventory_locks (inventory_id) WHERE released_at IS NULL;
CREATE INDEX inventory_locks_reference_idx ON inventory_locks (reference_table, reference_id);

ALTER TABLE inventory_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_locks_read ON inventory_locks FOR SELECT
  USING (EXISTS (SELECT 1 FROM player_items pi WHERE pi.id = inventory_id
                 AND (pi.player_id = session_uid() OR is_admin_caller())));
GRANT ALL ON inventory_locks TO anon, authenticated;

CREATE OR REPLACE FUNCTION inv_lock(p_inventory_id bigint, p_lock_type text, p_ref_table text DEFAULT NULL,
  p_ref_id bigint DEFAULT NULL, p_expires timestamptz DEFAULT NULL, p_ref_uuid uuid DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_locks WHERE inventory_id = p_inventory_id AND released_at IS NULL) THEN
    RAISE EXCEPTION 'already_locked';
  END IF;
  INSERT INTO inventory_locks (inventory_id, lock_type, reference_table, reference_id, reference_uuid, expires_at)
  VALUES (p_inventory_id, p_lock_type, p_ref_table, p_ref_id, p_ref_uuid, p_expires)
  RETURNING id INTO v_id;
  UPDATE player_items SET is_locked = true WHERE id = p_inventory_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION inv_unlock(p_inventory_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE inventory_locks SET released_at = now()
    WHERE inventory_id = p_inventory_id AND released_at IS NULL;
  UPDATE player_items SET is_locked = false WHERE id = p_inventory_id;
END $$;

-- Clears any equip trace (scalar columns + blob equippedElement/Effects)
-- for an item that's leaving a player's possession (consumed, sold,
-- traded). The one-way compat trigger (econ_sync_player_blob) rebuilds
-- gacha_inventory's frames/names/emojis/elements/effects arrays but does
-- NOT touch gacha_frame/gacha_name/gacha_emoji scalars or the blob's
-- equippedElement/equippedEffects sub-keys — those must be cleared here,
-- same as the old blob-mutating market/fusion code used to do inline.
CREATE OR REPLACE FUNCTION econ_clear_equip_traces(p_player bigint, p_item_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cat text; v_val text; v_inv jsonb;
BEGIN
  SELECT category, value INTO v_cat, v_val FROM item_catalog WHERE id = p_item_id;
  IF v_cat IS NULL THEN RETURN; END IF;

  IF v_cat = 'frame' THEN UPDATE players SET gacha_frame = NULL WHERE id = p_player AND gacha_frame = v_val;
  ELSIF v_cat = 'name' THEN UPDATE players SET gacha_name = NULL WHERE id = p_player AND gacha_name = v_val;
  ELSIF v_cat = 'emoji' THEN UPDATE players SET gacha_emoji = NULL WHERE id = p_player AND gacha_emoji = v_val;
  END IF;

  IF v_cat IN ('element', 'effect') THEN
    SELECT econ_safe_jsonb(gacha_inventory) INTO v_inv FROM players WHERE id = p_player;
    IF v_cat = 'element' AND v_inv ->> 'equippedElement' = v_val THEN
      UPDATE players SET gacha_inventory = jsonb_set(v_inv, '{equippedElement}', 'null'::jsonb)::text WHERE id = p_player;
    ELSIF v_cat = 'effect' THEN
      UPDATE players SET gacha_inventory = jsonb_set(v_inv, '{equippedEffects}',
        (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements_text(
          COALESCE(v_inv -> 'equippedEffects', '[]'::jsonb)) e WHERE e <> v_val))::text
        WHERE id = p_player;
    END IF;
  END IF;
END $$;

-- ── Player-to-player trading (new feature) ──────────────────────────────
CREATE TABLE trade_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_one          bigint NOT NULL REFERENCES players(id),
  player_two          bigint NOT NULL REFERENCES players(id),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','negotiating','locked','completed','cancelled','expired')),
  confirmed_player_one boolean NOT NULL DEFAULT false,
  confirmed_player_two boolean NOT NULL DEFAULT false,
  locked              boolean NOT NULL DEFAULT false,
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (player_one <> player_two)
);

ALTER TABLE trade_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY trade_sessions_read ON trade_sessions FOR SELECT
  USING (player_one = session_uid() OR player_two = session_uid() OR is_admin_caller());
GRANT ALL ON trade_sessions TO anon, authenticated;

CREATE TABLE trade_items (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id   uuid NOT NULL REFERENCES trade_sessions(id),
  inventory_id bigint NOT NULL REFERENCES player_items(id),
  owner_id   bigint NOT NULL REFERENCES players(id),
  quantity   int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trade_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY trade_items_read ON trade_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM trade_sessions ts WHERE ts.id = trade_id
                 AND (ts.player_one = session_uid() OR ts.player_two = session_uid() OR is_admin_caller())));
GRANT ALL ON trade_items TO anon, authenticated;

CREATE TABLE trade_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id     uuid NOT NULL REFERENCES trade_sessions(id),
  sender_id    bigint NOT NULL REFERENCES players(id),
  receiver_id  bigint NOT NULL REFERENCES players(id),
  inventory_id bigint NOT NULL REFERENCES player_items(id),
  quantity     int NOT NULL DEFAULT 1,
  completed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trade_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY trade_logs_read ON trade_logs FOR SELECT
  USING (sender_id = session_uid() OR receiver_id = session_uid() OR is_admin_caller());
GRANT ALL ON trade_logs TO anon, authenticated;
CREATE TRIGGER trg_trade_logs_immutable BEFORE UPDATE OR DELETE ON trade_logs
  FOR EACH ROW EXECUTE FUNCTION econ_block_mutation();

CREATE INDEX trade_sessions_players_idx ON trade_sessions (player_one, player_two);
CREATE INDEX trade_items_trade_idx ON trade_items (trade_id);
CREATE INDEX trade_logs_trade_idx ON trade_logs (trade_id);

-- ── Gifts (new feature) ──────────────────────────────────────────────────
CREATE TABLE gifts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    bigint NOT NULL REFERENCES players(id),
  receiver_id  bigint NOT NULL REFERENCES players(id),
  inventory_id bigint NOT NULL REFERENCES player_items(id),
  quantity     int NOT NULL DEFAULT 1,
  message      text,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','claimed','expired','cancelled','rejected')),
  sent_at      timestamptz NOT NULL DEFAULT now(),
  claimed_at   timestamptz,
  CHECK (sender_id <> receiver_id)
);

ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY gifts_read ON gifts FOR SELECT
  USING (sender_id = session_uid() OR receiver_id = session_uid() OR is_admin_caller());
GRANT ALL ON gifts TO anon, authenticated;
CREATE INDEX gifts_receiver_idx ON gifts (receiver_id, status);

CREATE OR REPLACE FUNCTION gift_send(p_receiver_id bigint, p_item_id text, p_message text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sender bigint; v_inv_id bigint; v_gift_id uuid;
BEGIN
  v_sender := session_uid();
  IF v_sender IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_sender = p_receiver_id THEN RAISE EXCEPTION 'cannot_gift_self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_receiver_id) THEN RAISE EXCEPTION 'receiver_not_found'; END IF;

  SELECT id INTO v_inv_id FROM player_items
    WHERE player_id = v_sender AND item_id = p_item_id AND deleted_at IS NULL AND NOT is_locked FOR UPDATE;
  IF v_inv_id IS NULL THEN RAISE EXCEPTION 'not_owned_or_locked'; END IF;
  IF NOT (SELECT COALESCE(tradeable, true) FROM item_catalog WHERE id = p_item_id) THEN
    RAISE EXCEPTION 'not_tradeable';
  END IF;

  v_gift_id := gen_random_uuid();
  INSERT INTO gifts (id, sender_id, receiver_id, inventory_id, message) VALUES (v_gift_id, v_sender, p_receiver_id, v_inv_id, p_message);
  PERFORM inv_lock(v_inv_id, 'gift', 'gifts', NULL, NULL, v_gift_id);
  PERFORM econ_clear_equip_traces(v_sender, p_item_id);
  UPDATE player_items SET is_equipped = false, equip_slot = NULL WHERE id = v_inv_id;
  PERFORM notify(p_receiver_id, 'inventory', 'Gift Received', format('You received a gift from player #%s', v_sender),
    jsonb_build_object('gift_id', v_gift_id));
  RETURN v_gift_id;
END $$;

CREATE OR REPLACE FUNCTION gift_claim(p_gift_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_g gifts%ROWTYPE;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_g FROM gifts WHERE id = p_gift_id FOR UPDATE;
  IF v_g.id IS NULL THEN RAISE EXCEPTION 'gift_not_found'; END IF;
  IF v_g.receiver_id <> v_pid THEN RAISE EXCEPTION 'not_receiver'; END IF;
  IF v_g.status <> 'pending' THEN RAISE EXCEPTION 'not_claimable'; END IF;

  PERFORM inv_unlock(v_g.inventory_id);
  UPDATE player_items SET player_id = v_pid, is_new = true, source = 'gift', acquired_at = now()
    WHERE id = v_g.inventory_id;
  UPDATE gifts SET status = 'claimed', claimed_at = now() WHERE id = p_gift_id;

  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION gift_cancel(p_gift_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_g gifts%ROWTYPE;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_g FROM gifts WHERE id = p_gift_id FOR UPDATE;
  IF v_g.id IS NULL THEN RAISE EXCEPTION 'gift_not_found'; END IF;
  IF v_g.sender_id <> v_pid THEN RAISE EXCEPTION 'not_sender'; END IF;
  IF v_g.status <> 'pending' THEN RAISE EXCEPTION 'not_cancellable'; END IF;

  PERFORM inv_unlock(v_g.inventory_id);
  UPDATE gifts SET status = 'cancelled' WHERE id = p_gift_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Trade RPCs: propose -> both players add_item -> both confirm -> atomic
-- swap on the second confirm. Any add/remove after a confirm resets BOTH
-- confirm flags (closes the classic "confirm then swap items" trade scam).
CREATE OR REPLACE FUNCTION trade_propose(p_other_player bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_id uuid;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_pid = p_other_player THEN RAISE EXCEPTION 'cannot_trade_self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_other_player) THEN RAISE EXCEPTION 'player_not_found'; END IF;

  INSERT INTO trade_sessions (player_one, player_two) VALUES (v_pid, p_other_player) RETURNING id INTO v_id;
  PERFORM notify(p_other_player, 'system', 'Trade Request', format('Player #%s wants to trade', v_pid),
    jsonb_build_object('trade_id', v_id));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION trade_add_item(p_trade_id uuid, p_item_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_ts trade_sessions%ROWTYPE; v_inv_id bigint;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_ts FROM trade_sessions WHERE id = p_trade_id FOR UPDATE;
  IF v_ts.id IS NULL THEN RAISE EXCEPTION 'trade_not_found'; END IF;
  IF v_ts.player_one <> v_pid AND v_ts.player_two <> v_pid THEN RAISE EXCEPTION 'not_a_party'; END IF;
  IF v_ts.status NOT IN ('pending','negotiating') THEN RAISE EXCEPTION 'trade_not_open'; END IF;
  IF now() > v_ts.expires_at THEN RAISE EXCEPTION 'trade_expired'; END IF;
  IF NOT (SELECT COALESCE(tradeable, true) FROM item_catalog WHERE id = p_item_id) THEN
    RAISE EXCEPTION 'not_tradeable';
  END IF;

  SELECT id INTO v_inv_id FROM player_items
    WHERE player_id = v_pid AND item_id = p_item_id AND deleted_at IS NULL AND NOT is_locked FOR UPDATE;
  IF v_inv_id IS NULL THEN RAISE EXCEPTION 'not_owned_or_locked'; END IF;

  INSERT INTO trade_items (trade_id, inventory_id, owner_id) VALUES (p_trade_id, v_inv_id, v_pid);
  PERFORM inv_lock(v_inv_id, 'trade', 'trade_sessions', NULL, NULL, p_trade_id);
  UPDATE trade_sessions SET status = 'negotiating', confirmed_player_one = false, confirmed_player_two = false
    WHERE id = p_trade_id;
  RETURN jsonb_build_object('ok', true, 'inventory_id', v_inv_id);
END $$;

CREATE OR REPLACE FUNCTION trade_remove_item(p_trade_id uuid, p_inventory_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_ts trade_sessions%ROWTYPE;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_ts FROM trade_sessions WHERE id = p_trade_id FOR UPDATE;
  IF v_ts.id IS NULL THEN RAISE EXCEPTION 'trade_not_found'; END IF;
  IF v_ts.status NOT IN ('pending','negotiating') THEN RAISE EXCEPTION 'trade_not_open'; END IF;
  IF NOT EXISTS (SELECT 1 FROM trade_items WHERE trade_id = p_trade_id AND inventory_id = p_inventory_id AND owner_id = v_pid) THEN
    RAISE EXCEPTION 'item_not_in_trade';
  END IF;

  DELETE FROM trade_items WHERE trade_id = p_trade_id AND inventory_id = p_inventory_id;
  PERFORM inv_unlock(p_inventory_id);
  UPDATE trade_sessions SET confirmed_player_one = false, confirmed_player_two = false WHERE id = p_trade_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION trade_confirm(p_trade_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_ts trade_sessions%ROWTYPE; v_item record;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_ts FROM trade_sessions WHERE id = p_trade_id FOR UPDATE;
  IF v_ts.id IS NULL THEN RAISE EXCEPTION 'trade_not_found'; END IF;
  IF v_ts.player_one <> v_pid AND v_ts.player_two <> v_pid THEN RAISE EXCEPTION 'not_a_party'; END IF;
  IF v_ts.status NOT IN ('pending','negotiating') THEN RAISE EXCEPTION 'trade_not_open'; END IF;
  IF now() > v_ts.expires_at THEN
    UPDATE trade_sessions SET status = 'expired' WHERE id = p_trade_id;
    RAISE EXCEPTION 'trade_expired';
  END IF;

  IF v_ts.player_one = v_pid THEN
    UPDATE trade_sessions SET confirmed_player_one = true WHERE id = p_trade_id;
  ELSE
    UPDATE trade_sessions SET confirmed_player_two = true WHERE id = p_trade_id;
  END IF;
  SELECT * INTO v_ts FROM trade_sessions WHERE id = p_trade_id;

  IF NOT (v_ts.confirmed_player_one AND v_ts.confirmed_player_two) THEN
    RETURN jsonb_build_object('ok', true, 'completed', false);
  END IF;

  -- both confirmed: re-validate every item is still owned+locked-by-this-trade, then swap atomically
  FOR v_item IN SELECT ti.*, pi.player_id AS current_owner FROM trade_items ti
                JOIN player_items pi ON pi.id = ti.inventory_id WHERE ti.trade_id = p_trade_id FOR UPDATE OF pi LOOP
    IF v_item.current_owner <> v_item.owner_id THEN RAISE EXCEPTION 'item_ownership_changed'; END IF;
    IF NOT EXISTS (SELECT 1 FROM inventory_locks WHERE inventory_id = v_item.inventory_id
                   AND released_at IS NULL AND reference_uuid = p_trade_id) THEN
      RAISE EXCEPTION 'item_lock_missing';
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM trade_items WHERE trade_id = p_trade_id LOOP
    PERFORM inv_unlock(v_item.inventory_id);
    PERFORM econ_clear_equip_traces(v_item.owner_id, (SELECT item_id FROM player_items WHERE id = v_item.inventory_id));
    UPDATE player_items SET
      player_id = CASE WHEN v_item.owner_id = v_ts.player_one THEN v_ts.player_two ELSE v_ts.player_one END,
      is_equipped = false, equip_slot = NULL, is_new = true, source = 'trade', acquired_at = now()
      WHERE id = v_item.inventory_id;
    INSERT INTO trade_logs (trade_id, sender_id, receiver_id, inventory_id, quantity)
      VALUES (p_trade_id, v_item.owner_id,
              CASE WHEN v_item.owner_id = v_ts.player_one THEN v_ts.player_two ELSE v_ts.player_one END,
              v_item.inventory_id, v_item.quantity);
  END LOOP;

  UPDATE trade_sessions SET status = 'completed', locked = true, completed_at = now() WHERE id = p_trade_id;
  PERFORM notify(v_ts.player_one, 'system', 'Trade Complete', 'Your trade has been completed', jsonb_build_object('trade_id', p_trade_id));
  PERFORM notify(v_ts.player_two, 'system', 'Trade Complete', 'Your trade has been completed', jsonb_build_object('trade_id', p_trade_id));

  RETURN jsonb_build_object('ok', true, 'completed', true);
END $$;

CREATE OR REPLACE FUNCTION trade_cancel(p_trade_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_ts trade_sessions%ROWTYPE; v_item record;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_ts FROM trade_sessions WHERE id = p_trade_id FOR UPDATE;
  IF v_ts.id IS NULL THEN RAISE EXCEPTION 'trade_not_found'; END IF;
  IF v_ts.player_one <> v_pid AND v_ts.player_two <> v_pid THEN RAISE EXCEPTION 'not_a_party'; END IF;
  IF v_ts.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'trade_already_closed'; END IF;

  FOR v_item IN SELECT * FROM trade_items WHERE trade_id = p_trade_id LOOP
    PERFORM inv_unlock(v_item.inventory_id);
  END LOOP;
  UPDATE trade_sessions SET status = 'cancelled' WHERE id = p_trade_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── Mailbox: extend the existing table into a universal inbox ──────────
ALTER TABLE mailbox
  ADD COLUMN sender_type          text NOT NULL DEFAULT 'system',
  ADD COLUMN title                text,
  ADD COLUMN attachment_type      text,
  ADD COLUMN attachment_reference text,
  ADD COLUMN attachment_quantity  int NOT NULL DEFAULT 1,
  ADD COLUMN expires_at           timestamptz;

UPDATE mailbox SET title = COALESCE(message, 'Mail'), attachment_type = item_type, attachment_reference = item_value
  WHERE title IS NULL;
-- mailbox already has RLS enabled with its own existing policies (used by
-- rpc_mail_claim_item / dbClaimMail) — untouched here, only columns added.
