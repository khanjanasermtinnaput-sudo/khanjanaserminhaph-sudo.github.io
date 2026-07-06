-- ─────────────────────────────────────────────────────────────────────────
-- LEVEL / EXP SYSTEM (V1 — match-completion EXP loop only)
--
-- Formula (mirrored exactly in js/exp-engine.js):
--   requiredExp(L) = 100 * L^2               (EXP to go from level L to L+1)
--   cumExp(L)      = 100*(L-1)*L*(2L-1)/6    (total EXP to reach level L)
--
-- Anti-cheat model: level/total_exp/current_exp/required_exp/last_level_up/
-- reward_claimed are added to `players` WITHOUT any INSERT/UPDATE grant to
-- anon/authenticated — only SELECT. Postgres denies column writes by default
-- when no grant exists, so no client PATCH (however crafted) can touch these
-- columns; only the SECURITY DEFINER RPCs below can (they run as the function
-- owner, bypassing caller privileges). This does not depend on — and does not
-- modify — the existing `players_update` RLS policy.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Columns ----------------------------------------------------------------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS level int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_exp bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_exp bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_exp bigint NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS last_level_up timestamptz,
  ADD COLUMN IF NOT EXISTS reward_claimed text NOT NULL DEFAULT '[]';

GRANT SELECT (level, total_exp, current_exp, required_exp, last_level_up, reward_claimed)
  ON public.players TO anon, authenticated;
-- Deliberately no INSERT/UPDATE grant on these columns for anon/authenticated.

-- 2. Ledger / log tables ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exp_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id bigint NOT NULL REFERENCES public.players(id),
  source text NOT NULL,
  amount int NOT NULL,
  total_exp bigint NOT NULL,
  level int NOT NULL,
  current_exp bigint NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exp_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exp_logs_read ON public.exp_logs;
CREATE POLICY exp_logs_read ON public.exp_logs FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
-- No INSERT/UPDATE/DELETE grants to anon/authenticated — RPC-only writes.

CREATE TABLE IF NOT EXISTS public.exp_match_ledger (
  match_id bigint PRIMARY KEY REFERENCES public.matches(id),
  awarded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exp_match_ledger ENABLE ROW LEVEL SECURITY;
-- No policies, no grants: fully internal to the RPCs (default-deny to clients).

CREATE TABLE IF NOT EXISTS public.level_reward_claims (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id bigint NOT NULL REFERENCES public.players(id),
  reward_id text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, reward_id)
);
ALTER TABLE public.level_reward_claims ENABLE ROW LEVEL SECURITY;
-- No policies, no grants: fully internal to the RPCs.

-- 3. Core EXP application (internal) -----------------------------------------
CREATE OR REPLACE FUNCTION public._exp_apply(v_uid bigint, v_amount int, v_source text, v_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total bigint; v_old_level int; v_new_level int; v_cur bigint; v_req bigint;
BEGIN
  SELECT total_exp, level INTO v_total, v_old_level FROM players WHERE id = v_uid FOR UPDATE;
  IF v_total IS NULL THEN RAISE EXCEPTION 'player_not_found'; END IF;

  v_total := v_total + v_amount;

  v_new_level := 1;
  LOOP
    EXIT WHEN v_new_level > 10000; -- safety cap, mirrors js/exp-engine.js LEVEL_CAP
    EXIT WHEN (100::bigint * v_new_level * (v_new_level + 1) * (2 * v_new_level + 1)) / 6 > v_total;
    v_new_level := v_new_level + 1;
  END LOOP;

  v_cur := v_total - (100::bigint * (v_new_level - 1) * v_new_level * (2 * v_new_level - 1)) / 6;
  v_req := 100::bigint * v_new_level * v_new_level;

  UPDATE players SET
    total_exp = v_total,
    level = v_new_level,
    current_exp = v_cur,
    required_exp = v_req,
    last_level_up = CASE WHEN v_new_level > v_old_level THEN now() ELSE last_level_up END
  WHERE id = v_uid;

  INSERT INTO exp_logs (player_id, source, amount, total_exp, level, current_exp, meta)
  VALUES (v_uid, v_source, v_amount, v_total, v_new_level, v_cur, v_meta);

  RETURN jsonb_build_object(
    'old_level', v_old_level, 'new_level', v_new_level,
    'leveled', v_new_level > v_old_level, 'levels_gained', v_new_level - v_old_level,
    'total_exp', v_total, 'current_exp', v_cur, 'required_exp', v_req
  );
END;
$$;
REVOKE ALL ON FUNCTION public._exp_apply(bigint, int, text, jsonb) FROM anon, authenticated, public;

-- 4. Match-completion EXP (admin-only; verifies the real `matches` row) -------
CREATE OR REPLACE FUNCTION public.rpc_award_match_exp(p_token uuid, p_match_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid bigint; v_match record; v_ids_a bigint[]; v_ids_b bigint[];
  v_winners bigint[]; v_losers bigint[]; v_all bigint[]; v_pid bigint;
  v_results jsonb := '[]'::jsonb; v_res jsonb;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = v_uid), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match IS NULL THEN RAISE EXCEPTION 'match_not_found'; END IF;

  INSERT INTO exp_match_ledger (match_id) VALUES (p_match_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('awarded', false, 'already_awarded', true);
  END IF;

  SELECT array_agg((elem->>'id')::bigint) INTO v_ids_a FROM jsonb_array_elements(v_match.team_a) elem;
  SELECT array_agg((elem->>'id')::bigint) INTO v_ids_b FROM jsonb_array_elements(v_match.team_b) elem;
  v_ids_a := COALESCE(v_ids_a, '{}'); v_ids_b := COALESCE(v_ids_b, '{}');

  IF v_match.win_team = 'A' THEN v_winners := v_ids_a; v_losers := v_ids_b;
  ELSE v_winners := v_ids_b; v_losers := v_ids_a; END IF;
  v_all := v_ids_a || v_ids_b;

  FOREACH v_pid IN ARRAY v_all LOOP
    v_res := public._exp_apply(v_pid, 30, 'match_complete', jsonb_build_object('match_id', p_match_id));
    v_results := v_results || jsonb_build_array(jsonb_build_object('player_id', v_pid, 'source', 'complete', 'result', v_res));
  END LOOP;
  FOREACH v_pid IN ARRAY v_winners LOOP
    v_res := public._exp_apply(v_pid, 100, 'match_win', jsonb_build_object('match_id', p_match_id));
    v_results := v_results || jsonb_build_array(jsonb_build_object('player_id', v_pid, 'source', 'win', 'result', v_res));
  END LOOP;
  FOREACH v_pid IN ARRAY v_losers LOOP
    v_res := public._exp_apply(v_pid, 50, 'match_lose', jsonb_build_object('match_id', p_match_id));
    v_results := v_results || jsonb_build_array(jsonb_build_object('player_id', v_pid, 'source', 'lose', 'result', v_res));
  END LOOP;

  RETURN jsonb_build_object('awarded', true, 'results', v_results);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_award_match_exp(uuid, bigint) TO anon, authenticated;

-- 5. Level reward claim (server-verifies the level gate; V1 reward map) ------
-- V1 reward map reuses existing gacha_pull item_catalog cosmetics (no new art).
CREATE OR REPLACE FUNCTION public.rpc_claim_level_reward(p_token uuid, p_reward_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid bigint; v_level int; v_req_level int; v_type text; v_value text; v_rows int;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT level INTO v_level FROM players WHERE id = v_uid;

  CASE p_reward_id
    WHEN 'lvl5'  THEN v_req_level := 5;  v_type := 'gacha_emoji'; v_value := '🏸';
    WHEN 'lvl10' THEN v_req_level := 10; v_type := 'gacha_frame'; v_value := 'ice';
    WHEN 'lvl25' THEN v_req_level := 25; v_type := 'gacha_name';  v_value := 'blaze';
    WHEN 'lvl50' THEN v_req_level := 50; v_type := 'gacha_frame'; v_value := 'halo';
    ELSE RAISE EXCEPTION 'invalid_reward';
  END CASE;

  IF v_level < v_req_level THEN RAISE EXCEPTION 'level_too_low'; END IF;

  INSERT INTO level_reward_claims (player_id, reward_id) VALUES (v_uid, p_reward_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'already_claimed'; END IF;

  -- level_reward_claims' UNIQUE(player_id, reward_id) + the ON CONFLICT check above
  -- guarantee this append runs at most once per reward per player.
  UPDATE players SET reward_claimed = (
    COALESCE(NULLIF(reward_claimed, '')::jsonb, '[]'::jsonb) || to_jsonb(p_reward_id)
  )::text WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'reward_id', p_reward_id, 'cosmetic_type', v_type, 'cosmetic_value', v_value);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_claim_level_reward(uuid, text) TO anon, authenticated;
