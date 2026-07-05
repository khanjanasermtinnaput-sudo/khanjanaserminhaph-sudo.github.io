-- ─────────────────────────────────────────────────────────────────────────
-- LEVEL / EXP SYSTEM V2 — remaining EXP sources, streaks, Prestige
--
-- Builds on supabase_level_system.sql (V1: match EXP, level formula, anti-
-- cheat column lockdown). Anti-cheat model unchanged: new columns get NO
-- INSERT/UPDATE grant to anon/authenticated (there is no blanket table-level
-- UPDATE grant on `players` anymore — confirmed live — so simply not adding
-- these columns to any GRANT UPDATE list is sufficient; writable only via
-- SECURITY DEFINER RPCs).
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Columns ------------------------------------------------------------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS prestige int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_exp bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS highest_level int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS best_win_streak int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_wins int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prestige_at timestamptz;

-- Backfill lifetime_exp/highest_level from existing V1 state (no-op today
-- since every player is still level 1 / 0 exp, but correct in general).
UPDATE public.players SET lifetime_exp = total_exp WHERE lifetime_exp = 0 AND total_exp > 0;
UPDATE public.players SET highest_level = level WHERE highest_level < level;

GRANT SELECT (prestige, lifetime_exp, highest_level, best_win_streak, consecutive_wins, prestige_at)
  ON public.players TO anon, authenticated;
-- Deliberately no INSERT/UPDATE grant on these columns for anon/authenticated.

-- 2. New idempotency ledgers ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.exp_daily_login (
  player_id bigint NOT NULL REFERENCES public.players(id),
  login_date date NOT NULL DEFAULT CURRENT_DATE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, login_date)
);
ALTER TABLE public.exp_daily_login ENABLE ROW LEVEL SECURITY;
-- No policies, no grants: fully internal to the RPCs (default-deny to clients).

CREATE TABLE IF NOT EXISTS public.exp_mission_ledger (
  player_id bigint NOT NULL REFERENCES public.players(id),
  quest_id text NOT NULL,
  mission_date date NOT NULL DEFAULT CURRENT_DATE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, quest_id, mission_date)
);
ALTER TABLE public.exp_mission_ledger ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.exp_tournament_ledger (
  tournament_id bigint NOT NULL,
  player_id bigint NOT NULL REFERENCES public.players(id),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, player_id)
);
ALTER TABLE public.exp_tournament_ledger ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_exp_logs_player_created ON public.exp_logs (player_id, created_at DESC);

-- 3. Extend the core EXP applier: lifetime EXP, highest level, win/loss
--    streaks, and an explicit LEVEL UP marker row in exp_logs.
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
    last_level_up = CASE WHEN v_new_level > v_old_level THEN now() ELSE last_level_up END,
    lifetime_exp = lifetime_exp + v_amount,
    highest_level = GREATEST(highest_level, v_new_level),
    consecutive_wins = CASE
      WHEN v_source = 'match_win' THEN consecutive_wins + 1
      WHEN v_source = 'match_lose' THEN 0
      ELSE consecutive_wins END,
    best_win_streak = CASE
      WHEN v_source = 'match_win' THEN GREATEST(best_win_streak, consecutive_wins + 1)
      ELSE best_win_streak END
  WHERE id = v_uid;

  INSERT INTO exp_logs (player_id, source, amount, total_exp, level, current_exp, meta)
  VALUES (v_uid, v_source, v_amount, v_total, v_new_level, v_cur, v_meta);

  IF v_new_level > v_old_level THEN
    INSERT INTO exp_logs (player_id, source, amount, total_exp, level, current_exp, meta)
    VALUES (v_uid, 'level_up', 0, v_total, v_new_level, v_cur,
      jsonb_build_object('old_level', v_old_level, 'levels_gained', v_new_level - v_old_level));
  END IF;

  RETURN jsonb_build_object(
    'old_level', v_old_level, 'new_level', v_new_level,
    'leveled', v_new_level > v_old_level, 'levels_gained', v_new_level - v_old_level,
    'total_exp', v_total, 'current_exp', v_cur, 'required_exp', v_req
  );
END;
$$;
-- CREATE OR REPLACE preserves the V1 REVOKE ALL already applied to this function.

-- 4. Daily login EXP (date-keyed, self) -----------------------------------
CREATE OR REPLACE FUNCTION public.rpc_award_daily_login(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid bigint; v_res jsonb; v_rows int;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  INSERT INTO exp_daily_login (player_id, login_date) VALUES (v_uid, CURRENT_DATE) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('awarded', false, 'already_awarded', true); END IF;

  v_res := public._exp_apply(v_uid, 20, 'daily_login', '{}'::jsonb);
  RETURN jsonb_build_object('awarded', true, 'result', v_res);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_award_daily_login(uuid) TO anon, authenticated;

-- 5. Daily mission EXP (date+quest-keyed, self; amount server-side) -------
CREATE OR REPLACE FUNCTION public.rpc_award_mission_exp(p_token uuid, p_quest_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid bigint; v_amount int; v_res jsonb; v_rows int;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  v_amount := CASE p_quest_id WHEN 'q0' THEN 50 WHEN 'q1' THEN 100 WHEN 'q2' THEN 150 ELSE NULL END;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'invalid_quest'; END IF;

  INSERT INTO exp_mission_ledger (player_id, quest_id, mission_date) VALUES (v_uid, p_quest_id, CURRENT_DATE) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('awarded', false, 'already_awarded', true); END IF;

  v_res := public._exp_apply(v_uid, v_amount, 'daily_mission', jsonb_build_object('quest_id', p_quest_id));
  RETURN jsonb_build_object('awarded', true, 'result', v_res);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_award_mission_exp(uuid, text) TO anon, authenticated;

-- 6. Tournament EXP (admin-only; re-derives tier + champions from the real,
--    just-completed tournament row — never trusts a client-supplied amount)
CREATE OR REPLACE FUNCTION public.rpc_award_tournament_exp(p_token uuid, p_tournament_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid bigint; v_tier text; v_groups jsonb; v_hof jsonb;
  v_champ_ids bigint[]; v_amount int; v_pid bigint;
  v_results jsonb := '[]'::jsonb; v_res jsonb; v_rows int;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = v_uid), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT tier, groups INTO v_tier, v_groups FROM tournaments WHERE id = p_tournament_id AND status = 'completed';
  IF v_tier IS NULL THEN RAISE EXCEPTION 'tournament_not_found_or_not_completed'; END IF;

  v_amount := CASE v_tier WHEN 'Regular' THEN 150 WHEN 'Super 500' THEN 300 WHEN 'Super 1000' THEN 1000 ELSE NULL END;
  IF v_amount IS NULL THEN RETURN jsonb_build_object('awarded', false, 'unsupported_tier', v_tier); END IF;

  SELECT elem INTO v_hof FROM jsonb_array_elements(COALESCE(v_groups, '[]'::jsonb)) elem
    WHERE (elem->>'_hof')::boolean = true LIMIT 1;
  IF v_hof IS NULL THEN RAISE EXCEPTION 'no_hof_record'; END IF;

  SELECT array_agg((x)::bigint) INTO v_champ_ids FROM jsonb_array_elements_text(v_hof->'champion_ids') x;
  IF v_champ_ids IS NULL THEN RAISE EXCEPTION 'no_champions'; END IF;

  FOREACH v_pid IN ARRAY v_champ_ids LOOP
    INSERT INTO exp_tournament_ledger (tournament_id, player_id) VALUES (p_tournament_id, v_pid) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_res := public._exp_apply(v_pid, v_amount, 'tournament', jsonb_build_object('tournament_id', p_tournament_id, 'tier', v_tier));
      v_results := v_results || jsonb_build_array(jsonb_build_object('player_id', v_pid, 'result', v_res));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('awarded', true, 'tier', v_tier, 'amount', v_amount, 'results', v_results);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_award_tournament_exp(uuid, bigint) TO anon, authenticated;

-- 7. Prestige — self-serve at Lv100+; resets the current cycle, keeps
--    lifetime_exp/highest_level/best_win_streak/reward_claimed/cosmetics/
--    achievements, grants an escalating __prestige:N badge in prime_titles.
CREATE OR REPLACE FUNCTION public.rpc_prestige(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid bigint; v_level int; v_prestige int; v_new_prestige int;
  v_titles jsonb; v_new_titles jsonb;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT level, prestige, COALESCE(NULLIF(prime_titles, '')::jsonb, '[]'::jsonb)
    INTO v_level, v_prestige, v_titles FROM players WHERE id = v_uid FOR UPDATE;
  IF v_level < 100 THEN RAISE EXCEPTION 'level_too_low'; END IF;

  v_new_prestige := v_prestige + 1;
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_new_titles
    FROM jsonb_array_elements_text(v_titles) t WHERE t NOT LIKE '__prestige:%';
  v_new_titles := v_new_titles || to_jsonb('__prestige:' || v_new_prestige::text);

  UPDATE players SET
    prestige = v_new_prestige,
    level = 1,
    total_exp = 0,
    current_exp = 0,
    required_exp = 100,
    prestige_at = now(),
    prime_titles = v_new_titles::text
  WHERE id = v_uid;
  -- lifetime_exp, highest_level, best_win_streak, reward_claimed,
  -- gacha_inventory, custom_ach are deliberately untouched (persist).

  INSERT INTO exp_logs (player_id, source, amount, total_exp, level, current_exp, meta)
  VALUES (v_uid, 'prestige', 0, 0, 1, 0, jsonb_build_object('prestige', v_new_prestige));

  RETURN jsonb_build_object('ok', true, 'prestige', v_new_prestige);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_prestige(uuid) TO anon, authenticated;
