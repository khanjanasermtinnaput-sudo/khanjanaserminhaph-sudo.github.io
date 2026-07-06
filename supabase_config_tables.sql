-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 9 (scaffold) — Shop, coupons, daily/event/battlepass config
-- Applied via Supabase MCP apply_migration (migration name: inv_step9_config_tables)
--
-- Config/reference tables for future systems: no existing UI drives these
-- yet, but each gets a real, tested RPC that routes through reward_grant()
-- (not just empty tables) so the moment a front-end is built for any of
-- them, the backend is already correct. reward_type/reward_reference is a
-- small generic dispatch: 'item' -> reward_reference is an item_catalog.id,
-- 'currency' -> reward_reference is a currencies.code and quantity is the
-- amount granted.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE shop_items (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id      text NOT NULL REFERENCES item_catalog(id),
  currency_id  text NOT NULL REFERENCES currencies(code),
  price        int NOT NULL CHECK (price >= 0),
  stock        int,  -- NULL = unlimited
  daily_limit  int,
  weekly_limit int,
  monthly_limit int,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read  ON shop_items FOR SELECT USING (true);
CREATE POLICY ref_admin ON shop_items FOR ALL    USING (is_admin_caller()) WITH CHECK (is_admin_caller());
GRANT ALL ON shop_items TO anon, authenticated;

CREATE TABLE shop_purchase_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES players(id),
  shop_item_id bigint NOT NULL REFERENCES shop_items(id),
  purchased_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shop_purchase_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_purchase_log_read ON shop_purchase_log FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON shop_purchase_log TO anon, authenticated;
CREATE INDEX shop_purchase_log_player_idx ON shop_purchase_log (player_id, shop_item_id, purchased_at);

CREATE OR REPLACE FUNCTION shop_purchase(p_shop_item_id bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid bigint; v_item shop_items%ROWTYPE; v_sold int;
  v_daily int; v_weekly int; v_monthly int;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_item FROM shop_items WHERE id = p_shop_item_id AND enabled FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'item_not_found_or_disabled'; END IF;

  IF v_item.stock IS NOT NULL THEN
    SELECT count(*) INTO v_sold FROM shop_purchase_log WHERE shop_item_id = p_shop_item_id;
    IF v_sold >= v_item.stock THEN RAISE EXCEPTION 'out_of_stock'; END IF;
  END IF;
  IF v_item.daily_limit IS NOT NULL THEN
    SELECT count(*) INTO v_daily FROM shop_purchase_log
      WHERE player_id = v_pid AND shop_item_id = p_shop_item_id AND purchased_at > now() - interval '1 day';
    IF v_daily >= v_item.daily_limit THEN RAISE EXCEPTION 'daily_limit_reached'; END IF;
  END IF;
  IF v_item.weekly_limit IS NOT NULL THEN
    SELECT count(*) INTO v_weekly FROM shop_purchase_log
      WHERE player_id = v_pid AND shop_item_id = p_shop_item_id AND purchased_at > now() - interval '7 days';
    IF v_weekly >= v_item.weekly_limit THEN RAISE EXCEPTION 'weekly_limit_reached'; END IF;
  END IF;
  IF v_item.monthly_limit IS NOT NULL THEN
    SELECT count(*) INTO v_monthly FROM shop_purchase_log
      WHERE player_id = v_pid AND shop_item_id = p_shop_item_id AND purchased_at > now() - interval '30 days';
    IF v_monthly >= v_item.monthly_limit THEN RAISE EXCEPTION 'monthly_limit_reached'; END IF;
  END IF;

  PERFORM econ_adjust_currency(v_pid, v_item.currency_id, -v_item.price, 'shop_purchase', 'shop_items', p_shop_item_id);
  INSERT INTO shop_purchase_log (player_id, shop_item_id) VALUES (v_pid, p_shop_item_id);

  RETURN reward_grant('shop', jsonb_build_array(jsonb_build_object('item_id', v_item.item_id, 'qty', 1)),
    '[]'::jsonb, jsonb_build_object('shop_item_id', p_shop_item_id));
END $$;

-- ── Coupons ──────────────────────────────────────────────────────────────
CREATE TABLE coupon_codes (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text UNIQUE NOT NULL,
  reward_type     text NOT NULL CHECK (reward_type IN ('item','currency')),
  reward_reference text NOT NULL,
  quantity        int NOT NULL DEFAULT 1,
  usage_limit     int,  -- NULL = unlimited global uses; redemptions are always 1-per-player regardless
  expire_at       timestamptz,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coupon_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_admin ON coupon_codes FOR ALL USING (is_admin_caller()) WITH CHECK (is_admin_caller());
-- no public SELECT policy: codes aren't meant to be discoverable via the API, only redeemable by exact code
GRANT ALL ON coupon_codes TO anon, authenticated;

CREATE TABLE coupon_redemptions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coupon_id   bigint NOT NULL REFERENCES coupon_codes(id),
  player_id   bigint NOT NULL REFERENCES players(id),
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, player_id)
);
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY coupon_redemptions_read ON coupon_redemptions FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON coupon_redemptions TO anon, authenticated;

CREATE OR REPLACE FUNCTION coupon_redeem(p_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint; v_coupon coupon_codes%ROWTYPE; v_used int;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_coupon FROM coupon_codes WHERE code = p_code AND enabled FOR UPDATE;
  IF v_coupon.id IS NULL THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF v_coupon.expire_at IS NOT NULL AND now() > v_coupon.expire_at THEN RAISE EXCEPTION 'code_expired'; END IF;
  IF EXISTS (SELECT 1 FROM coupon_redemptions WHERE coupon_id = v_coupon.id AND player_id = v_pid) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;
  IF v_coupon.usage_limit IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM coupon_redemptions WHERE coupon_id = v_coupon.id;
    IF v_used >= v_coupon.usage_limit THEN RAISE EXCEPTION 'usage_limit_reached'; END IF;
  END IF;

  INSERT INTO coupon_redemptions (coupon_id, player_id) VALUES (v_coupon.id, v_pid);

  IF v_coupon.reward_type = 'item' THEN
    RETURN reward_grant('coupon', jsonb_build_array(jsonb_build_object('item_id', v_coupon.reward_reference, 'qty', v_coupon.quantity)),
      '[]'::jsonb, jsonb_build_object('coupon_code', p_code));
  ELSE
    RETURN reward_grant('coupon', '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('currency_id', v_coupon.reward_reference, 'amount', v_coupon.quantity)),
      jsonb_build_object('coupon_code', p_code));
  END IF;
END $$;

-- ── Daily login / event / battle pass reward tables (config only for now;
--    claiming already flows through rpc_grant_daily_reward / future admin
--    tooling — these seed the data-driven configuration the spec asks for). ──
CREATE TABLE daily_login_rewards (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day         int NOT NULL UNIQUE CHECK (day BETWEEN 1 AND 365),
  reward_type text NOT NULL CHECK (reward_type IN ('item','currency')),
  reward_reference text NOT NULL,
  quantity    int NOT NULL DEFAULT 1,
  image       text,
  enabled     boolean NOT NULL DEFAULT true
);
ALTER TABLE daily_login_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read  ON daily_login_rewards FOR SELECT USING (true);
CREATE POLICY ref_admin ON daily_login_rewards FOR ALL USING (is_admin_caller()) WITH CHECK (is_admin_caller());
GRANT ALL ON daily_login_rewards TO anon, authenticated;

CREATE TABLE event_rewards (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id     text NOT NULL,
  reward_type  text NOT NULL CHECK (reward_type IN ('item','currency')),
  reward_reference text NOT NULL,
  quantity     int NOT NULL DEFAULT 1,
  claim_limit  int,
  enabled      boolean NOT NULL DEFAULT true
);
ALTER TABLE event_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read  ON event_rewards FOR SELECT USING (true);
CREATE POLICY ref_admin ON event_rewards FOR ALL USING (is_admin_caller()) WITH CHECK (is_admin_caller());
GRANT ALL ON event_rewards TO anon, authenticated;
CREATE INDEX event_rewards_event_idx ON event_rewards (event_id);

CREATE TABLE battle_pass_rewards (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season       int NOT NULL,
  level        int NOT NULL,
  premium      boolean NOT NULL DEFAULT false,
  reward_type  text NOT NULL CHECK (reward_type IN ('item','currency')),
  reward_reference text NOT NULL,
  quantity     int NOT NULL DEFAULT 1,
  UNIQUE (season, level, premium)
);
ALTER TABLE battle_pass_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read  ON battle_pass_rewards FOR SELECT USING (true);
CREATE POLICY ref_admin ON battle_pass_rewards FOR ALL USING (is_admin_caller()) WITH CHECK (is_admin_caller());
GRANT ALL ON battle_pass_rewards TO anon, authenticated;
CREATE INDEX battle_pass_rewards_season_idx ON battle_pass_rewards (season, level);
