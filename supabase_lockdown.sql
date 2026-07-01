-- ============================================================
-- Badminton Club — Server-Side Lockdown (v3)
-- Closes: anon-writable is_admin/pin/pts/coins, free-form coin-minting RPCs,
--         permissive USING(true) policies confirmed live on players/matches/
--         pending_matches/mailbox.
-- Idempotent — safe to re-run. Additive only: does NOT revoke existing
-- table-level INSERT/UPDATE/DELETE grants (RLS policies below do the real
-- enforcement), so nothing breaks until the policies are replaced (step 4).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- 1. Session infrastructure
--    Client sends header `x-player-token: <uuid>` on every PostgREST call
--    (in addition to the existing apikey/anon Authorization header).
--    session_uid() resolves it to a player id inside RLS policies / RPCs.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.player_sessions (
  token      uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  player_id  bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '60 days'
);
ALTER TABLE public.player_sessions ENABLE ROW LEVEL SECURITY;
-- No policies granted to anon/authenticated — reachable only through the
-- SECURITY DEFINER functions below (or the edge function via service role).

CREATE OR REPLACE FUNCTION public.session_uid()
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token text;
  v_pid bigint;
BEGIN
  v_token := current_setting('request.headers', true)::json->>'x-player-token';
  IF v_token IS NULL OR v_token = '' THEN RETURN NULL; END IF;
  SELECT player_id INTO v_pid FROM player_sessions
    WHERE token = v_token::uuid AND expires_at > now();
  RETURN v_pid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_caller()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM players WHERE id = session_uid()), false);
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. Auth RPCs — replace client-side PIN handling.
--    Returns a session token; client stores {id,name,token}, never the PIN.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_register(p_name text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint; v_is_first boolean; v_token uuid; v_row jsonb;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'invalid_pin'; END IF;
  IF EXISTS (SELECT 1 FROM players WHERE lower(name) = lower(trim(p_name))) THEN
    RAISE EXCEPTION 'name_taken';
  END IF;
  v_is_first := NOT EXISTS (SELECT 1 FROM players);
  INSERT INTO players (name, pin, pts, wins, losses, is_admin)
  VALUES (trim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), 50, 0, 0, v_is_first)
  RETURNING id INTO v_id;
  v_token := extensions.gen_random_uuid();
  INSERT INTO player_sessions (token, player_id) VALUES (v_token, v_id);
  SELECT jsonb_build_object('token', v_token, 'id', id, 'name', name, 'pts', pts, 'wins', wins,
    'losses', losses, 'is_admin', is_admin, 'coins', coins) INTO v_row FROM players WHERE id = v_id;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_register(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_login(p_name text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint; v_token uuid; v_row jsonb;
BEGIN
  SELECT id INTO v_id FROM players WHERE lower(name) = lower(trim(p_name)) AND pin = extensions.crypt(p_pin, pin);
  IF v_id IS NULL THEN RAISE EXCEPTION 'invalid_credentials'; END IF;
  v_token := extensions.gen_random_uuid();
  INSERT INTO player_sessions (token, player_id) VALUES (v_token, v_id);
  SELECT jsonb_build_object('token', v_token, 'id', id, 'name', name, 'pts', pts, 'wins', wins,
    'losses', losses, 'is_admin', is_admin, 'coins', coins) INTO v_row FROM players WHERE id = v_id;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_login(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_login_by_id(p_id bigint, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token uuid; v_row jsonb; v_ok boolean;
BEGIN
  SELECT (pin = extensions.crypt(p_pin, pin)) INTO v_ok FROM players WHERE id = p_id;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'invalid_credentials'; END IF;
  v_token := extensions.gen_random_uuid();
  INSERT INTO player_sessions (token, player_id) VALUES (v_token, p_id);
  SELECT jsonb_build_object('token', v_token, 'id', id, 'name', name, 'pts', pts, 'wins', wins,
    'losses', losses, 'is_admin', is_admin, 'coins', coins) INTO v_row FROM players WHERE id = p_id;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_login_by_id(bigint, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_logout(p_token uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM player_sessions WHERE token = p_token;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_logout(uuid) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Fix the two RPCs that trusted client-supplied ids/amounts
-- ─────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.set_elo_x2(bigint, boolean) FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.rpc_set_elo_x2(p_token uuid, p_state boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid bigint; v_is_admin boolean;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT is_admin INTO v_is_admin FROM players WHERE id = v_uid;
  IF v_is_admin IS NOT TRUE THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE app_settings SET value = p_state::text, updated_at = now() WHERE key = 'elo_x2';
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_set_elo_x2(uuid, boolean) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.grant_daily_reward(bigint, text, int) FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.rpc_grant_daily_reward(p_token uuid, p_quest_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid bigint; v_coins int; v_rows int;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  -- Coin amount is looked up server-side, never trusted from the client (fixes free-coin mint)
  v_coins := CASE p_quest_id WHEN 'q0' THEN 4 WHEN 'q1' THEN 4 WHEN 'q2' THEN 4 ELSE NULL END;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'invalid_quest'; END IF;
  INSERT INTO daily_rewards (player_id, quest_id, reward_date, coins)
  VALUES (v_uid, p_quest_id, CURRENT_DATE, v_coins)
  ON CONFLICT (player_id, quest_id, reward_date) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    UPDATE players SET coins = GREATEST(0, COALESCE(coins,0) + v_coins) WHERE id = v_uid;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_grant_daily_reward(uuid, text) TO anon, authenticated;

-- Mailbox coin/ELO claims must be server-verified (item_value is admin-set at send
-- time; a raw self-UPDATE could otherwise let a player edit item_value before
-- claiming). Frame/name/emoji/effect claims keep using direct PostgREST calls —
-- see mailbox_claim_self policy below, which locks every column except `claimed`.
CREATE OR REPLACE FUNCTION public.rpc_claim_mail_reward(p_token uuid, p_mail_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid bigint; v_mail record;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v_mail FROM mailbox WHERE id = p_mail_id FOR UPDATE;
  IF v_mail IS NULL THEN RAISE EXCEPTION 'mail_not_found'; END IF;
  IF v_mail.player_id != v_uid THEN RAISE EXCEPTION 'not_your_mail'; END IF;
  IF v_mail.claimed THEN RAISE EXCEPTION 'already_claimed'; END IF;
  IF v_mail.item_type = 'coins' THEN
    UPDATE players SET coins = GREATEST(0, COALESCE(coins,0) + COALESCE(v_mail.item_value::int,0)) WHERE id = v_uid;
  ELSIF v_mail.item_type = 'elo' THEN
    UPDATE players SET pts = GREATEST(0, COALESCE(pts,0) + COALESCE(v_mail.item_value::int,0)) WHERE id = v_uid;
  ELSE
    RAISE EXCEPTION 'wrong_claim_path';
  END IF;
  UPDATE mailbox SET claimed = true WHERE id = p_mail_id;
  RETURN jsonb_build_object('ok', true, 'item_type', v_mail.item_type, 'item_value', v_mail.item_value);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_claim_mail_reward(uuid, bigint) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Season reset — server-authoritative, race-proof (first caller for a
--    given season label wins; further calls are idempotent no-ops).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._do_season_reset()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_king_id bigint; v_king_pts int; v_king_titles jsonb;
  v_ss_label text; v_reset_count int := 0; v_rows int; r record; v_floor int;
BEGIN
  v_ss_label := 'SS' || GREATEST(1,
    ((EXTRACT(YEAR FROM (now() - interval '1 month'))::int - 2026) * 12
      + (EXTRACT(MONTH FROM (now() - interval '1 month'))::int - 5)) + 1);

  INSERT INTO season_resets (season_label, triggered_by) VALUES (v_ss_label, 'client')
  ON CONFLICT (season_label) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('reset_count', 0, 'already_done', true, 'ss_label', v_ss_label);
  END IF;

  SELECT id, pts, COALESCE(prime_titles,'[]')::jsonb INTO v_king_id, v_king_pts, v_king_titles
  FROM players ORDER BY pts DESC LIMIT 1;

  IF v_king_pts >= 2000 AND NOT (v_king_titles @> to_jsonb(v_ss_label)) THEN
    UPDATE players SET prime_titles = (v_king_titles || to_jsonb(v_ss_label))::text WHERE id = v_king_id;
  END IF;

  FOR r IN SELECT id, pts FROM players LOOP
    v_floor := CASE
      WHEN r.pts >= 2000 THEN 1000 WHEN r.pts >= 1201 THEN 800 WHEN r.pts >= 801 THEN 500
      WHEN r.pts >= 501 THEN 300 WHEN r.pts >= 301 THEN 200 ELSE NULL END;
    IF v_floor IS NOT NULL AND r.pts > v_floor THEN
      UPDATE players SET pts = v_floor WHERE id = r.id;
      v_reset_count := v_reset_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reset_count', v_reset_count, 'king_id', v_king_id, 'ss_label', v_ss_label, 'already_done', false);
END;
$$;
REVOKE ALL ON FUNCTION public._do_season_reset() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_apply_season_reset(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid bigint;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN public._do_season_reset();
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_apply_season_reset(uuid) TO anon, authenticated;

-- Best-effort: let pg_cron also trigger it monthly if the extension is enabled.
DO $$
BEGIN
  PERFORM cron.schedule('monthly-season-reset', '0 1 1 * *', 'SELECT public._do_season_reset();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available — season reset will run on client trigger only: %', SQLERRM;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. RLS policies — replace every USING(true)/permissive policy confirmed
--    live on players, matches, pending_matches, mailbox.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox ENABLE ROW LEVEL SECURITY;

-- players: public read (minus pin, revoked below); write = self (cosmetic/coin
-- columns only) or admin (anything).
DROP POLICY IF EXISTS "players_read" ON public.players;
CREATE POLICY "players_read" ON public.players FOR SELECT USING (true);

DROP POLICY IF EXISTS "players_insert" ON public.players;
-- No INSERT policy created — registration goes only through rpc_register (SECURITY DEFINER).

DROP POLICY IF EXISTS "players_update" ON public.players;
CREATE POLICY "players_update" ON public.players
FOR UPDATE
USING (id = session_uid() OR is_admin_caller())
WITH CHECK (
  is_admin_caller()
  OR (
    id = session_uid()
    AND pin      = (SELECT pin      FROM players p2 WHERE p2.id = players.id)
    AND is_admin = (SELECT is_admin FROM players p2 WHERE p2.id = players.id)
    AND pts      = (SELECT pts      FROM players p2 WHERE p2.id = players.id)
    AND wins     = (SELECT wins     FROM players p2 WHERE p2.id = players.id)
    AND losses   = (SELECT losses   FROM players p2 WHERE p2.id = players.id)
    AND name     = (SELECT name     FROM players p2 WHERE p2.id = players.id)
  )
);

DROP POLICY IF EXISTS "players_delete" ON public.players;
CREATE POLICY "players_delete" ON public.players FOR DELETE USING (is_admin_caller());

REVOKE SELECT (pin) ON public.players FROM anon, authenticated;

-- matches: public read; writes admin-only (all client match submissions go
-- through pending_matches first — confirmed non-admin path never inserts here).
DROP POLICY IF EXISTS "read_matches" ON public.matches;
CREATE POLICY "read_matches" ON public.matches FOR SELECT USING (true);

DROP POLICY IF EXISTS "insert_matches" ON public.matches;
CREATE POLICY "insert_matches" ON public.matches FOR INSERT WITH CHECK (is_admin_caller());

DROP POLICY IF EXISTS "allow all" ON public.matches;
CREATE POLICY "matches_update_admin" ON public.matches FOR UPDATE USING (is_admin_caller());
CREATE POLICY "matches_delete_admin" ON public.matches FOR DELETE USING (is_admin_caller());

-- pending_matches: public read (low sensitivity); insert by any valid session
-- (submitter must be themselves); approve/reject/cleanup = admin only.
DROP POLICY IF EXISTS "allow all" ON public.pending_matches;
CREATE POLICY "pending_read" ON public.pending_matches FOR SELECT USING (true);
CREATE POLICY "pending_insert_self" ON public.pending_matches
FOR INSERT WITH CHECK (session_uid() IS NOT NULL AND submitted_by = session_uid());
CREATE POLICY "pending_delete_admin" ON public.pending_matches FOR DELETE USING (is_admin_caller());

-- mailbox: read own (or admin); admin sends; self can only flip `claimed`.
DROP POLICY IF EXISTS "mailbox_send_admin" ON public.mailbox;
DROP POLICY IF EXISTS "mailbox_read_own" ON public.mailbox;
DROP POLICY IF EXISTS "mailbox_claim_own" ON public.mailbox;
CREATE POLICY "mailbox_read_own" ON public.mailbox
FOR SELECT USING (player_id = session_uid() OR is_admin_caller());
CREATE POLICY "mailbox_send_admin" ON public.mailbox
FOR INSERT WITH CHECK (is_admin_caller());
CREATE POLICY "mailbox_claim_self" ON public.mailbox
FOR UPDATE
USING (player_id = session_uid() OR is_admin_caller())
WITH CHECK (
  is_admin_caller()
  OR (
    player_id  = (SELECT player_id  FROM mailbox m2 WHERE m2.id = mailbox.id)
    AND item_type  = (SELECT item_type  FROM mailbox m2 WHERE m2.id = mailbox.id)
    AND item_value = (SELECT item_value FROM mailbox m2 WHERE m2.id = mailbox.id)
    AND message IS NOT DISTINCT FROM (SELECT message FROM mailbox m2 WHERE m2.id = mailbox.id)
  )
);

-- ─────────────────────────────────────────────────────────────
-- Done. Old verify_player_pin/gacha_pull(bigint) RPCs are left in place —
-- verify_player_pin is unused by the client after this migration but harmless;
-- gacha_pull(bigint) is called server-side only, from the gacha-pull edge
-- function using the service-role key (bypasses RLS/anon entirely).
-- ─────────────────────────────────────────────────────────────
