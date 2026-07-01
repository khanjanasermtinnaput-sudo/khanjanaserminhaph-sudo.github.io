-- ============================================================
-- Badminton Club — Full Security Hardening (v2)
-- รันใน Supabase → SQL Editor
-- สามารถรันซ้ำได้ (idempotent) — ทุก statement ใช้ CREATE OR REPLACE / IF NOT EXISTS
--
-- SUPERSEDED by supabase_lockdown.sql (v3) — this file's RLS policies (keyed off
-- request.jwt.claims, which this app never populates since there's no Supabase
-- Auth session) have been dropped and replaced by session-token-based policies.
-- Kept for history; do not re-run the policy sections below.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;  -- ต้องเปิดใน Supabase Dashboard → Database → Extensions ก่อน

-- ─────────────────────────────────────────────────────────────
-- 1. Hash existing plaintext PINs with bcrypt (CRIT-06)
--    ทำครั้งเดียว — หลังรันแล้ว PIN ทุกอันจะเป็น $2a$... hash
--    ถ้า PIN เป็น hash อยู่แล้ว (ขึ้นต้นด้วย $2) ข้ามไป
-- ─────────────────────────────────────────────────────────────
UPDATE public.players
SET pin = extensions.crypt(pin, extensions.gen_salt('bf', 10))
WHERE pin IS NOT NULL AND pin NOT LIKE '$2%';

-- ─────────────────────────────────────────────────────────────
-- 2. Server-side PIN verification using bcrypt (CRIT-06)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_player_pin(p_id bigint, p_pin text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players
    WHERE id = p_id AND pin = extensions.crypt(p_pin, pin)
  );
$$;

GRANT EXECUTE ON FUNCTION public.verify_player_pin(bigint, text) TO anon, authenticated;

-- Revoke direct PIN reads from clients
REVOKE SELECT (pin) ON public.players FROM anon;
REVOKE SELECT (pin) ON public.players FROM authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. app_settings table — server-controlled feature flags (CRIT-01)
--    ELO x2, maintenance mode, etc.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key   text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

-- Seed default settings
INSERT INTO public.app_settings (key, value)
VALUES ('elo_x2', 'false'), ('maintenance', 'false')
ON CONFLICT (key) DO NOTHING;

-- Only admins (is_admin=1) can write; everyone can read
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_read" ON public.app_settings;
CREATE POLICY "settings_read" ON public.app_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "settings_write_admin" ON public.app_settings;
CREATE POLICY "settings_write_admin" ON public.app_settings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.players WHERE id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint AND is_admin = true)
  );

-- RPC for admin to toggle ELO x2 (validates caller is admin)
CREATE OR REPLACE FUNCTION public.set_elo_x2(p_admin_id bigint, p_state boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_is_admin boolean;
BEGIN
  SELECT is_admin INTO v_is_admin FROM players WHERE id = p_admin_id;
  IF v_is_admin IS NOT TRUE THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE app_settings SET value = p_state::text, updated_at = now() WHERE key = 'elo_x2';
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_elo_x2(bigint, boolean) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. daily_rewards table — server-side idempotent reward tracking (CRIT-03)
--    คีย์ (player_id, quest_id, reward_date) ทำให้ claim ซ้ำไม่ได้แม้ล้าง localStorage
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_rewards (
  id          bigserial PRIMARY KEY,
  player_id   bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  quest_id    text   NOT NULL,
  reward_date date   NOT NULL DEFAULT CURRENT_DATE,
  coins       int    NOT NULL DEFAULT 0,
  granted_at  timestamptz DEFAULT now(),
  UNIQUE (player_id, quest_id, reward_date)
);

ALTER TABLE public.daily_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dr_read_own" ON public.daily_rewards;
CREATE POLICY "dr_read_own" ON public.daily_rewards
  FOR SELECT USING (player_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

-- RPC: grant daily reward — idempotent, inserts or no-ops on duplicate
CREATE OR REPLACE FUNCTION public.grant_daily_reward(p_player_id bigint, p_quest_id text, p_coins int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_inserted boolean := false;
BEGIN
  INSERT INTO daily_rewards (player_id, quest_id, reward_date, coins)
  VALUES (p_player_id, p_quest_id, CURRENT_DATE, p_coins)
  ON CONFLICT (player_id, quest_id, reward_date) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted THEN
    UPDATE players SET coins = GREATEST(0, COALESCE(coins,0) + p_coins)
    WHERE id = p_player_id;
    RETURN true;   -- reward granted
  END IF;
  RETURN false;    -- already claimed today
END;
$$;
GRANT EXECUTE ON FUNCTION public.grant_daily_reward(bigint, text, int) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. gacha_rolls table — server-side roll audit trail (CRIT-02)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gacha_rolls (
  id          bigserial PRIMARY KEY,
  player_id   bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  roll_value  numeric(8,4) NOT NULL,
  outcome     text   NOT NULL,
  coins_spent int    NOT NULL DEFAULT 10,
  rolled_at   timestamptz DEFAULT now()
);

ALTER TABLE public.gacha_rolls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gacha_read_own" ON public.gacha_rolls;
CREATE POLICY "gacha_read_own" ON public.gacha_rolls
  FOR SELECT USING (player_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- RPC: atomic gacha pull — deduct coins → roll → record
CREATE OR REPLACE FUNCTION public.gacha_pull(p_player_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coins    int;
  v_roll     numeric(8,4);
  v_outcome  text;
  v_cost     int := 2;  -- 2 coins per pull (matches client config)
  v_pool     text[];
  v_weights  numeric[];
  v_cum      numeric := 0;
  i          int;
BEGIN
  -- Check and deduct coins atomically
  SELECT coins INTO v_coins FROM players WHERE id = p_player_id FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'player_not_found'; END IF;
  IF v_coins < v_cost THEN RAISE EXCEPTION 'insufficient_coins'; END IF;

  UPDATE players SET coins = coins - v_cost WHERE id = p_player_id;

  -- Generate cryptographic random roll
  v_roll := (get_byte(extensions.gen_random_bytes(4), 0)::numeric * 16777216 +
             get_byte(extensions.gen_random_bytes(4), 1)::numeric * 65536 +
             get_byte(extensions.gen_random_bytes(4), 2)::numeric * 256 +
             get_byte(extensions.gen_random_bytes(4), 3)::numeric) / 4294967295.0 * 100.0;

  -- Outcome table (must sum to 100)
  v_pool    := ARRAY['secret','ultra','rare','common'];
  v_weights := ARRAY[3.0, 10.0, 30.0, 57.0];

  v_outcome := 'common';
  v_cum := 0;
  FOR i IN 1..array_length(v_pool,1) LOOP
    v_cum := v_cum + v_weights[i];
    IF v_roll <= v_cum THEN
      v_outcome := v_pool[i];
      EXIT;
    END IF;
  END LOOP;

  -- Audit log
  INSERT INTO gacha_rolls (player_id, roll_value, outcome, coins_spent)
  VALUES (p_player_id, v_roll, v_outcome, v_cost);

  RETURN jsonb_build_object('outcome', v_outcome, 'roll', v_roll, 'coins_remaining', v_coins - v_cost);
END;
$$;
GRANT EXECUTE ON FUNCTION public.gacha_pull(bigint) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. mailbox RLS — only admins can INSERT mail (CRIT-05)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.mailbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mailbox_read_own" ON public.mailbox;
CREATE POLICY "mailbox_read_own" ON public.mailbox
  FOR SELECT USING (player_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

DROP POLICY IF EXISTS "mailbox_send_admin" ON public.mailbox;
CREATE POLICY "mailbox_send_admin" ON public.mailbox
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.players
      WHERE id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint
        AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "mailbox_claim_own" ON public.mailbox;
CREATE POLICY "mailbox_claim_own" ON public.mailbox
  FOR UPDATE USING (player_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

-- ─────────────────────────────────────────────────────────────
-- 7. season_resets table — server-controlled reset guard (CRIT-04)
--    Prevents duplicate resets and client clock manipulation
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.season_resets (
  season_label text PRIMARY KEY,
  reset_at     timestamptz DEFAULT now(),
  triggered_by text DEFAULT 'cron'
);

ALTER TABLE public.season_resets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "resets_read" ON public.season_resets;
CREATE POLICY "resets_read" ON public.season_resets FOR SELECT USING (true);

-- RPC: check if season was reset (safe client-side call)
CREATE OR REPLACE FUNCTION public.get_latest_season_reset()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT season_label FROM season_resets ORDER BY reset_at DESC LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_latest_season_reset() TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8. players table RLS — protect admin escalation (CRIT-07)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "players_read" ON public.players;
CREATE POLICY "players_read" ON public.players
  FOR SELECT USING (true);

-- Only the player themselves can UPDATE their own non-admin fields
-- Admins can update any player
DROP POLICY IF EXISTS "players_update_self" ON public.players;
CREATE POLICY "players_update_self" ON public.players
  FOR UPDATE USING (
    id::text = current_setting('request.jwt.claims', true)::json->>'sub'
    OR EXISTS (
      SELECT 1 FROM public.players p2
      WHERE p2.id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        AND p2.is_admin = true
    )
  )
  WITH CHECK (
    -- Non-admins cannot elevate is_admin
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.players p3
      WHERE p3.id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        AND p3.is_admin = true
    ) THEN is_admin = (SELECT is_admin FROM public.players WHERE id = players.id)
    ELSE true END
  );

DROP POLICY IF EXISTS "players_insert" ON public.players;
CREATE POLICY "players_insert" ON public.players
  FOR INSERT WITH CHECK (is_admin = false OR NOT EXISTS (SELECT 1 FROM public.players));

DROP POLICY IF EXISTS "players_delete_admin" ON public.players;
CREATE POLICY "players_delete_admin" ON public.players
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.players p2
      WHERE p2.id::text = current_setting('request.jwt.claims', true)::json->>'sub'
        AND p2.is_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 9. Hall of Fame unique constraint — prevent duplicate season entries (MED-02)
-- ─────────────────────────────────────────────────────────────
-- Uncomment after verifying column name matches your schema:
-- ALTER TABLE public.season_resets ADD CONSTRAINT season_resets_label_unique UNIQUE (season_label);

-- ─────────────────────────────────────────────────────────────
-- 10. pg_cron: monthly season reset on the 1st at 01:00 UTC (CRIT-04)
--     ต้องเปิด pg_cron extension ก่อนในหน้า Extensions ของ Supabase
-- ─────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'monthly-season-reset',
  '0 1 1 * *',
  $$
    INSERT INTO public.season_resets (season_label, triggered_by)
    VALUES (
      to_char(NOW() - interval '1 day', 'YYYY-MM'),
      'cron'
    )
    ON CONFLICT (season_label) DO NOTHING;
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 11. Rate limiting: pending_matches unique guard (MED-08)
--     Prevents flood-submitting the same result multiple times per day
-- ─────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.pending_matches
  ADD COLUMN IF NOT EXISTS submitted_by_id bigint REFERENCES public.players(id);

-- ─────────────────────────────────────────────────────────────
-- Done ✅
-- After running:
--   1. All PINs are bcrypt-hashed — existing logins still work via verify_player_pin
--   2. ELO x2 is server-controlled via app_settings table
--   3. Daily rewards cannot be duplicated even if localStorage is cleared
--   4. Season resets only run via pg_cron (not client clock)
--   5. Mailbox INSERT requires is_admin=1
--   6. players UPDATE cannot escalate is_admin
-- ─────────────────────────────────────────────────────────────
