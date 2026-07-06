-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 4 — Currencies (wallet system)
-- Applied via Supabase MCP apply_migration (migration name: inv_step4_currencies)
--
-- players.coins stays the actively-written column — 10+ existing RPCs
-- (econ_adjust_coins, rpc_award_match_coins, gacha_pull, daily rewards...)
-- write it directly and are out of scope for this step. user_currencies is
-- a new wallet ledger that MIRRORS players.coins via trigger, so every
-- future system (shop, coupons, battle pass) has a proper multi-currency
-- table to read/write without an immediate rewrite of every existing coin
-- path. Once the Reward Engine (Step 5) is live, new grants can write
-- user_currencies directly; the mirror keeps the legacy client correct
-- either way.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE currencies (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  icon        text,
  color       text,
  max_balance bigint,
  tradeable   boolean NOT NULL DEFAULT false,
  premium     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO currencies (code, name, icon, color, tradeable, premium) VALUES
  ('coin',             'Coin',              '🪙', '#fbbf24', false, false),
  ('diamond',          'Diamond',           '💎', '#60a5fa', false, true),
  ('tournament_point', 'Tournament Point',  '🏆', '#c084fc', false, false),
  ('event_token',      'Event Token',       '🎫', '#f472b6', false, false),
  ('ticket',           'Ticket',            '🎟️', '#34d399', false, false),
  ('voucher',          'Voucher',           '🧾', '#9ca3af', false, false),
  ('battle_pass_point','Battle Pass Point', '⭐', '#f97316', false, false),
  ('clan_point',       'Clan Point',        '🛡️', '#00d4ff', false, false);

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read  ON currencies FOR SELECT USING (true);
CREATE POLICY ref_admin ON currencies FOR ALL    USING (is_admin_caller()) WITH CHECK (is_admin_caller());
GRANT ALL ON currencies TO anon, authenticated;

CREATE TABLE user_currencies (
  player_id   bigint NOT NULL REFERENCES players(id),
  currency_id text   NOT NULL REFERENCES currencies(code),
  balance     bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, currency_id)
);

ALTER TABLE user_currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_currencies_read ON user_currencies FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON user_currencies TO anon, authenticated;

-- Backfill wallets from the current authoritative column
INSERT INTO user_currencies (player_id, currency_id, balance)
SELECT id, 'coin', COALESCE(coins, 0) FROM players;

-- Mirror trigger: players.coins -> user_currencies (keeps working even
-- though every existing RPC still writes players.coins directly).
CREATE OR REPLACE FUNCTION econ_mirror_coins_to_wallet() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO user_currencies (player_id, currency_id, balance, updated_at)
  VALUES (NEW.id, 'coin', COALESCE(NEW.coins, 0), now())
  ON CONFLICT (player_id, currency_id) DO UPDATE
    SET balance = EXCLUDED.balance, updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_mirror_coins_to_wallet
  AFTER INSERT OR UPDATE OF coins ON players
  FOR EACH ROW EXECUTE FUNCTION econ_mirror_coins_to_wallet();

-- Extend economy_ledger (doubling as currency_transactions per the plan;
-- inventory_history reuse happens in later steps).
ALTER TABLE economy_ledger
  ADD COLUMN currency_id    text REFERENCES currencies(code),
  ADD COLUMN balance_before bigint,
  ADD COLUMN balance_after  bigint;

UPDATE economy_ledger SET currency_id = 'coin' WHERE coins_delta <> 0;

CREATE INDEX economy_ledger_player_created_idx ON economy_ledger (player_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 5 — Reward Engine (single mandatory pipeline)
-- Applied via Supabase MCP apply_migration (migration name: inv_step5_reward_engine)
--
-- One SECURITY DEFINER RPC — reward_grant() — is the only path items or
-- currency should enter inventory from any source (gacha, tournament,
-- daily login, admin, coupon...). It's idempotent (idempotency_key unique
-- per player, replay-safe), rate-limited via the existing econ_rate_check,
-- and atomic: reward_transactions/reward_items are only ever inserted
-- once with their final, correct values (never updated), so the
-- "immutable, append-only" requirement holds without needing a
-- Pending->Success transition — either the whole grant succeeds and
-- commits, or an exception aborts the entire call and nothing persists.
--
-- Column names use this project's existing convention (player_id, not
-- user_id; source_code FK to reward_sources.code, not a surrogate
-- reward_source_id) rather than the spec's literal names, for consistency
-- with every other table already in this database.
--
-- economy_ledger.ref_id is bigint (sized for other bigint-PK tables like
-- fusion_log/market_listings); reward_transactions.id is uuid, so it can't
-- fit there — the transaction id is instead carried in each ledger row's
-- `meta->>'reward_transaction_id'` for traceability.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE reward_sources (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  icon        text,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reward_sources (code, name, icon) VALUES
  ('gacha',        'Gacha',        '🎰'),
  ('tournament',   'Tournament',   '🏆'),
  ('daily_login',  'Daily Login',  '📅'),
  ('quest',        'Quest',        '📜'),
  ('mission',      'Mission',      '🎯'),
  ('achievement',  'Achievement',  '🏅'),
  ('battle_pass',  'Battle Pass',  '🎫'),
  ('shop',         'Shop',         '🏪'),
  ('admin',        'Admin',        '🛡️'),
  ('coupon',       'Coupon',       '🎟️'),
  ('promotion',    'Promotion',    '📣'),
  ('referral',     'Referral',     '🤝'),
  ('gift',         'Gift',         '🎁'),
  ('marketplace',  'Marketplace',  '🏬'),
  ('event',        'Event',        '🎉'),
  ('compensation', 'Compensation', '💊'),
  ('developer',    'Developer',    '👨‍💻'),
  ('system',       'System',       '⚙️');

ALTER TABLE reward_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read  ON reward_sources FOR SELECT USING (true);
CREATE POLICY ref_admin ON reward_sources FOR ALL    USING (is_admin_caller()) WITH CHECK (is_admin_caller());
GRANT ALL ON reward_sources TO anon, authenticated;

CREATE TABLE reward_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       bigint NOT NULL REFERENCES players(id),
  source_code     text NOT NULL REFERENCES reward_sources(code),
  status          text NOT NULL DEFAULT 'Success'
                    CHECK (status IN ('Pending','Success','Failed','Cancelled','RolledBack')),
  total_items     int NOT NULL DEFAULT 0,
  total_currency  bigint NOT NULL DEFAULT 0,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address      text,
  device          text,
  server_region   text,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reward_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY reward_transactions_read ON reward_transactions FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON reward_transactions TO anon, authenticated;

CREATE TABLE reward_items (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reward_transaction_id uuid NOT NULL REFERENCES reward_transactions(id),
  item_id               text NOT NULL REFERENCES item_catalog(id),
  quantity              int NOT NULL DEFAULT 1,
  rarity_snapshot       text NOT NULL,
  item_name_snapshot    text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reward_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY reward_items_read ON reward_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM reward_transactions rt
                 WHERE rt.id = reward_transaction_id
                   AND (rt.player_id = session_uid() OR is_admin_caller())));
GRANT ALL ON reward_items TO anon, authenticated;

CREATE INDEX reward_transactions_player_created_idx ON reward_transactions (player_id, created_at DESC);
CREATE INDEX reward_items_txn_idx ON reward_items (reward_transaction_id);

-- Append-only enforcement — safe because reward_grant() never UPDATEs
-- these rows after the single INSERT (see header note).
CREATE OR REPLACE FUNCTION econ_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER trg_reward_transactions_immutable
  BEFORE UPDATE OR DELETE ON reward_transactions
  FOR EACH ROW EXECUTE FUNCTION econ_block_mutation();
CREATE TRIGGER trg_reward_items_immutable
  BEFORE UPDATE OR DELETE ON reward_items
  FOR EACH ROW EXECUTE FUNCTION econ_block_mutation();

-- Generic currency adjuster (any currency, not just coin). Delegates to
-- the existing econ_adjust_coins for 'coin' so every current coin path
-- (and its ledger shape) is untouched; handles every other currency via
-- user_currencies directly.
CREATE OR REPLACE FUNCTION econ_adjust_currency(
  p_player bigint, p_currency text, p_delta bigint, p_verb text,
  p_ref_type text DEFAULT NULL, p_ref_id bigint DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before bigint; v_balance bigint;
BEGIN
  IF p_currency = 'coin' THEN
    RETURN econ_adjust_coins(p_player, p_delta::int, p_verb, p_ref_type, p_ref_id, p_meta);
  END IF;
  PERFORM set_config('bk.internal', '1', true);
  INSERT INTO user_currencies (player_id, currency_id, balance) VALUES (p_player, p_currency, 0)
    ON CONFLICT (player_id, currency_id) DO NOTHING;
  SELECT balance INTO v_before FROM user_currencies
    WHERE player_id = p_player AND currency_id = p_currency FOR UPDATE;
  UPDATE user_currencies SET balance = balance + p_delta, updated_at = now()
    WHERE player_id = p_player AND currency_id = p_currency AND balance + p_delta >= 0
    RETURNING balance INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_currency:%', p_currency; END IF;
  INSERT INTO economy_ledger (player_id, verb, currency_id, coins_delta, balance_before, balance_after, ref_type, ref_id, meta)
  VALUES (p_player, p_verb, p_currency, 0, v_before, v_balance, p_ref_type, p_ref_id, p_meta);
  RETURN v_balance;
END $$;

-- THE Reward Engine entry point.
-- p_items:    [{"item_id": "frame:thunder", "qty": 1}, ...]
-- p_currency: [{"currency_id": "coin", "amount": 50}, ...]
CREATE OR REPLACE FUNCTION reward_grant(
  p_source_code text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_currency jsonb DEFAULT '[]'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_server_region text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_player bigint; v_enabled boolean; v_existing uuid;
  v_total_items int; v_total_currency bigint; v_txn_id uuid;
  c jsonb; it jsonb; v_cur_code text; v_amount bigint;
  v_item_id text; v_qty int; v_rarity text; v_name text;
BEGIN
  v_player := session_uid();
  IF v_player IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT enabled INTO v_enabled FROM reward_sources WHERE code = p_source_code;
  IF NOT FOUND OR NOT v_enabled THEN RAISE EXCEPTION 'invalid_source:%', p_source_code; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM reward_transactions
      WHERE idempotency_key = p_idempotency_key AND player_id = v_player;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  PERFORM econ_rate_check(v_player, 'reward_grant:' || p_source_code, 60, interval '1 minute');

  v_total_items := COALESCE((SELECT sum(COALESCE((x->>'qty')::int, 1)) FROM jsonb_array_elements(p_items) x), 0);
  v_total_currency := COALESCE((SELECT sum((x->>'amount')::bigint) FROM jsonb_array_elements(p_currency) x), 0);

  v_txn_id := gen_random_uuid();
  INSERT INTO reward_transactions
    (id, player_id, source_code, status, total_items, total_currency, metadata, ip_address, device, server_region, idempotency_key)
  VALUES
    (v_txn_id, v_player, p_source_code, 'Success', v_total_items, v_total_currency, p_metadata, p_ip_address, p_device, p_server_region, p_idempotency_key);

  FOR c IN SELECT * FROM jsonb_array_elements(p_currency) LOOP
    v_cur_code := c ->> 'currency_id';
    v_amount := (c ->> 'amount')::bigint;
    PERFORM econ_adjust_currency(v_player, v_cur_code, v_amount, p_source_code, 'reward_transaction', NULL,
      jsonb_build_object('reward_transaction_id', v_txn_id));
  END LOOP;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := it ->> 'item_id';
    v_qty := COALESCE((it ->> 'qty')::int, 1);
    PERFORM econ_grant_item(v_player, v_item_id, v_qty, p_source_code, 'reward_transaction', NULL,
      jsonb_build_object('reward_transaction_id', v_txn_id));
    UPDATE player_items SET is_new = true WHERE player_id = v_player AND item_id = v_item_id;
    SELECT rarity, COALESCE(label_en, label_th) INTO v_rarity, v_name FROM item_catalog WHERE id = v_item_id;
    INSERT INTO reward_items (reward_transaction_id, item_id, quantity, rarity_snapshot, item_name_snapshot)
    VALUES (v_txn_id, v_item_id, v_qty, v_rarity, v_name);
  END LOOP;

  RETURN v_txn_id;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 6 — Gacha banners + pity system
-- Applied via Supabase MCP apply_migration (migration name: inv_step6_gacha_banners_pity)
--
-- Extends the EXISTING gacha_pools/gacha_pool_items tables with banner
-- shape (banner_type, time window, pity config, featured/guaranteed
-- flags) rather than creating parallel tables — rpc_gacha_pull_v2 already
-- references gacha_pools.id / gacha_pool_items.pool_id everywhere, and
-- duplicating that as a separate "banners" table would just create a
-- third source of truth for pool config.
--
-- Both existing pools ('coin','element') get pity_enabled=false and no
-- time window, so today's actual drop rates and availability are
-- UNCHANGED — pity is shipped as a dormant, opt-in mechanism an admin can
-- turn on later per pool, not retrofitted onto live gameplay untested.
-- user_gacha_statistics tracks total_rolls/current_pity/legendary_count/
-- mythic_count unconditionally (harmless bookkeeping) for every pull.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE gacha_pools
  ADD COLUMN banner_type  text NOT NULL DEFAULT 'standard'
    CHECK (banner_type IN ('standard','limited','event','collaboration','beginner','premium','seasonal')),
  ADD COLUMN title        text,
  ADD COLUMN start_time   timestamptz,
  ADD COLUMN end_time     timestamptz,
  ADD COLUMN pity_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN soft_pity    int,
  ADD COLUMN hard_pity    int;

ALTER TABLE gacha_pool_items
  ADD COLUMN featured   boolean NOT NULL DEFAULT false,
  ADD COLUMN guaranteed boolean NOT NULL DEFAULT false;

CREATE TABLE user_gacha_statistics (
  player_id       bigint NOT NULL REFERENCES players(id),
  pool_id         text   NOT NULL REFERENCES gacha_pools(id),
  total_rolls     int NOT NULL DEFAULT 0,
  current_pity    int NOT NULL DEFAULT 0,
  legendary_count int NOT NULL DEFAULT 0,
  mythic_count    int NOT NULL DEFAULT 0,
  last_roll_at    timestamptz,
  PRIMARY KEY (player_id, pool_id)
);

ALTER TABLE user_gacha_statistics ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_gacha_statistics_read ON user_gacha_statistics FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON user_gacha_statistics TO anon, authenticated;

-- rpc_gacha_pull_v2: add banner time-window check + pity, preserving all
-- existing behavior byte-for-byte where pity_enabled/start_time/end_time
-- are NULL/false (i.e. every pool that exists today).
CREATE OR REPLACE FUNCTION public.rpc_gacha_pull_v2(p_pool text, p_count integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid bigint;
  v_pool record;
  v_cost int;
  v_coins int;
  v_total numeric;
  v_roll numeric;
  v_item text;
  v_cat record;
  v_was_owned boolean;
  v_new_qty int;
  v_results jsonb := '[]'::jsonb;
  v_pity int;
  v_will_reset boolean;
  i int;
BEGIN
  v_uid := session_uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_count NOT IN (1, 10) THEN RAISE EXCEPTION 'bad_count'; END IF;

  SELECT * INTO v_pool FROM gacha_pools WHERE id = p_pool AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_pool'; END IF;
  IF v_pool.start_time IS NOT NULL AND now() < v_pool.start_time THEN RAISE EXCEPTION 'banner_not_started'; END IF;
  IF v_pool.end_time IS NOT NULL AND now() > v_pool.end_time THEN RAISE EXCEPTION 'banner_ended'; END IF;

  PERFORM set_config('bk.internal', '1', true);
  PERFORM econ_rate_check(v_uid, 'gacha_' || p_pool, 120, interval '1 hour', p_count);

  v_cost := CASE WHEN p_count = 10 THEN v_pool.cost_10 ELSE v_pool.cost END;

  SELECT COALESCE(coins, 0) INTO v_coins FROM players WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'player_not_found'; END IF;
  IF v_coins < v_cost THEN RAISE EXCEPTION 'insufficient_coins'; END IF;
  UPDATE players SET coins = coins - v_cost WHERE id = v_uid;
  INSERT INTO economy_ledger (player_id, verb, coins_delta, ref_type, meta)
  VALUES (v_uid, 'gacha_pull', -v_cost, 'gacha', jsonb_build_object('pool', p_pool, 'count', p_count));

  SELECT SUM(weight) INTO v_total FROM gacha_pool_items WHERE pool_id = p_pool;
  IF v_total IS NULL OR v_total <= 0 THEN RAISE EXCEPTION 'empty_pool'; END IF;

  SELECT current_pity INTO v_pity FROM user_gacha_statistics WHERE player_id = v_uid AND pool_id = p_pool FOR UPDATE;
  v_pity := COALESCE(v_pity, 0);

  FOR i IN 1..p_count LOOP
    v_roll := econ_crypto_random() * v_total;
    SELECT t.item_id INTO v_item FROM (
      SELECT item_id, SUM(weight) OVER (ORDER BY item_id) AS cum
      FROM gacha_pool_items WHERE pool_id = p_pool
    ) t WHERE t.cum > v_roll ORDER BY t.cum LIMIT 1;
    IF v_item IS NULL THEN
      SELECT item_id INTO v_item FROM gacha_pool_items WHERE pool_id = p_pool ORDER BY item_id DESC LIMIT 1;
    END IF;

    v_will_reset := false;
    IF v_pool.pity_enabled AND v_pool.hard_pity IS NOT NULL AND v_pity + 1 >= v_pool.hard_pity THEN
      SELECT gpi.item_id INTO v_item FROM gacha_pool_items gpi
        JOIN item_catalog ic ON ic.id = gpi.item_id
        JOIN item_rarities r ON r.code = ic.rarity
        WHERE gpi.pool_id = p_pool ORDER BY r.rank DESC, gpi.item_id LIMIT 1;
      v_will_reset := true;
    END IF;

    v_was_owned := EXISTS (SELECT 1 FROM player_items WHERE player_id = v_uid AND item_id = v_item AND qty > 0);
    v_new_qty := econ_grant_item(v_uid, v_item, 1, 'gacha_item', 'gacha', NULL,
                                 jsonb_build_object('pool', p_pool, 'roll', round(v_roll, 4)));

    SELECT * INTO v_cat FROM item_catalog WHERE id = v_item;
    IF v_cat.category = 'emoji' THEN
      UPDATE players SET gacha_emoji = v_cat.value WHERE id = v_uid;
    END IF;

    v_pity := CASE WHEN v_will_reset OR v_cat.rarity IN ('legendary','mythic') THEN 0 ELSE v_pity + 1 END;

    INSERT INTO user_gacha_statistics (player_id, pool_id, total_rolls, current_pity, legendary_count, mythic_count, last_roll_at)
    VALUES (v_uid, p_pool, 1, v_pity,
            CASE WHEN v_cat.rarity = 'legendary' THEN 1 ELSE 0 END,
            CASE WHEN v_cat.rarity = 'mythic' THEN 1 ELSE 0 END, now())
    ON CONFLICT (player_id, pool_id) DO UPDATE SET
      total_rolls = user_gacha_statistics.total_rolls + 1,
      current_pity = v_pity,
      legendary_count = user_gacha_statistics.legendary_count + CASE WHEN v_cat.rarity = 'legendary' THEN 1 ELSE 0 END,
      mythic_count = user_gacha_statistics.mythic_count + CASE WHEN v_cat.rarity = 'mythic' THEN 1 ELSE 0 END,
      last_roll_at = now();

    v_results := v_results || jsonb_build_object(
      'item_id', v_item, 'category', v_cat.category, 'value', v_cat.value,
      'label', v_cat.label_th, 'label_en', v_cat.label_en, 'rarity', v_cat.rarity,
      'icon', v_cat.icon, 'is_dup', v_was_owned, 'qty', v_new_qty, 'pity_reset', v_will_reset);
  END LOOP;

  RETURN jsonb_build_object(
    'coins_remaining', (SELECT coins FROM players WHERE id = v_uid),
    'results', v_results);
END $function$;

-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 7 — Notifications (real backing store + realtime)
-- Applied via Supabase MCP apply_migration (migration name: inv_step7_notifications)
--
-- js/notifications.js today is entirely synthetic: it subscribes to
-- Realtime INSERT events on `matches`/`pending_matches` directly and
-- builds notification objects purely client-side, stored in localStorage
-- (`nf_hist_<id>`) — there was no DB table at all. This creates the first
-- real one and wires reward_grant() to populate it (the Reward Engine
-- pipeline's "Create Notification" step). Rewiring the client to read
-- from this table is a front-end task, not part of this database phase —
-- left for a follow-up; the existing localStorage-based notification UI
-- is untouched and keeps working exactly as it does today.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id   bigint NOT NULL REFERENCES players(id),
  type        text NOT NULL CHECK (type IN
                ('reward','inventory','tournament','system','shop','achievement',
                 'quest','battle_pass','event','warning','admin')),
  title       text NOT NULL,
  message     text,
  image       text,
  action_url  text,
  read        boolean NOT NULL DEFAULT false,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_read ON notifications FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
-- Players may mark their own notifications read/unread, nothing else
-- (title/message/etc. stay server-authoritative).
CREATE POLICY notifications_mark_read ON notifications FOR UPDATE
  USING (player_id = session_uid())
  WITH CHECK (player_id = session_uid());
GRANT ALL ON notifications TO anon, authenticated;

CREATE INDEX notifications_player_created_idx ON notifications (player_id, read, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Reusable notify() helper for any future system (trade completion,
-- admin actions, etc.) to push a notification without duplicating this.
CREATE OR REPLACE FUNCTION notify(
  p_player bigint, p_type text, p_title text, p_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb, p_action_url text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO notifications (player_id, type, title, message, metadata, action_url)
  VALUES (p_player, p_type, p_title, p_message, p_metadata, p_action_url)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Wire reward_grant() to notify on every successful grant.
CREATE OR REPLACE FUNCTION reward_grant(
  p_source_code text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_currency jsonb DEFAULT '[]'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_server_region text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_player bigint; v_enabled boolean; v_existing uuid; v_source_name text;
  v_total_items int; v_total_currency bigint; v_txn_id uuid;
  c jsonb; it jsonb; v_cur_code text; v_amount bigint;
  v_item_id text; v_qty int; v_rarity text; v_name text;
BEGIN
  v_player := session_uid();
  IF v_player IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT enabled, name INTO v_enabled, v_source_name FROM reward_sources WHERE code = p_source_code;
  IF NOT FOUND OR NOT v_enabled THEN RAISE EXCEPTION 'invalid_source:%', p_source_code; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM reward_transactions
      WHERE idempotency_key = p_idempotency_key AND player_id = v_player;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  PERFORM econ_rate_check(v_player, 'reward_grant:' || p_source_code, 60, interval '1 minute');

  v_total_items := COALESCE((SELECT sum(COALESCE((x->>'qty')::int, 1)) FROM jsonb_array_elements(p_items) x), 0);
  v_total_currency := COALESCE((SELECT sum((x->>'amount')::bigint) FROM jsonb_array_elements(p_currency) x), 0);

  v_txn_id := gen_random_uuid();
  INSERT INTO reward_transactions
    (id, player_id, source_code, status, total_items, total_currency, metadata, ip_address, device, server_region, idempotency_key)
  VALUES
    (v_txn_id, v_player, p_source_code, 'Success', v_total_items, v_total_currency, p_metadata, p_ip_address, p_device, p_server_region, p_idempotency_key);

  FOR c IN SELECT * FROM jsonb_array_elements(p_currency) LOOP
    v_cur_code := c ->> 'currency_id';
    v_amount := (c ->> 'amount')::bigint;
    PERFORM econ_adjust_currency(v_player, v_cur_code, v_amount, p_source_code, 'reward_transaction', NULL,
      jsonb_build_object('reward_transaction_id', v_txn_id));
  END LOOP;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := it ->> 'item_id';
    v_qty := COALESCE((it ->> 'qty')::int, 1);
    PERFORM econ_grant_item(v_player, v_item_id, v_qty, p_source_code, 'reward_transaction', NULL,
      jsonb_build_object('reward_transaction_id', v_txn_id));
    UPDATE player_items SET is_new = true WHERE player_id = v_player AND item_id = v_item_id;
    SELECT rarity, COALESCE(label_en, label_th) INTO v_rarity, v_name FROM item_catalog WHERE id = v_item_id;
    INSERT INTO reward_items (reward_transaction_id, item_id, quantity, rarity_snapshot, item_name_snapshot)
    VALUES (v_txn_id, v_item_id, v_qty, v_rarity, v_name);
  END LOOP;

  IF v_total_items > 0 OR v_total_currency > 0 THEN
    PERFORM notify(v_player, 'reward', COALESCE(v_source_name, p_source_code) || ' Reward',
      CASE WHEN v_total_items > 0 AND v_total_currency > 0
             THEN format('+%s items, +%s currency', v_total_items, v_total_currency)
           WHEN v_total_items > 0 THEN format('+%s items', v_total_items)
           ELSE format('+%s currency', v_total_currency) END,
      jsonb_build_object('reward_transaction_id', v_txn_id));
  END IF;

  RETURN v_txn_id;
END $$;
