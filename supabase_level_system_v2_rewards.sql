-- ─────────────────────────────────────────────────────────────────────────
-- LEVEL REWARDS — full Lv5–100 ladder (extends rpc_claim_level_reward)
--
-- Hybrid sourcing (per user decision): early/mid tiers reuse existing gacha
-- cosmetics (frames/names/emojis already in item_catalog); title/badge tiers
-- write directly into prime_titles (mirrors buildPlayerPrimeTitles, js/utils.js);
-- three NEW bespoke frames for the marquee tiers (Lv50 Golden, Lv90 Legend
-- Aura, Lv100 Legend — see styles.css "LEVEL REWARD FRAMES" + js/utils.js
-- GACHA_FRAME_INNER: lvlgolden/lvlaura/lvllegend).
--
-- This map MUST stay in lockstep with LEVEL_REWARDS in js/levels.js.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_claim_level_reward(p_token uuid, p_reward_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid bigint; v_level int; v_req_level int; v_type text; v_value text; v_rows int; i int;
  v_extra_titles text[]; v_titles jsonb; v_new_titles jsonb;
BEGIN
  SELECT player_id INTO v_uid FROM player_sessions WHERE token = p_token AND expires_at > now();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT level INTO v_level FROM players WHERE id = v_uid;
  v_extra_titles := '{}';

  CASE p_reward_id
    WHEN 'lvl5'   THEN v_req_level := 5;   v_type := 'gacha_emoji'; v_value := '🏸';
    WHEN 'lvl10'  THEN v_req_level := 10;  v_type := 'gacha_frame'; v_value := 'ice';
    WHEN 'lvl15'  THEN v_req_level := 15;  v_type := 'gacha_emoji'; v_value := '🔥';
    WHEN 'lvl20'  THEN v_req_level := 20;  v_type := 'gacha_frame'; v_value := 'robot';
    WHEN 'lvl25'  THEN v_req_level := 25;  v_type := 'gacha_name';  v_value := 'blaze';
    WHEN 'lvl30'  THEN v_req_level := 30;  v_type := 'title';       v_value := 'Skilled Player';
    WHEN 'lvl40'  THEN v_req_level := 40;  v_type := 'gacha_emoji'; v_value := '⚡';
    WHEN 'lvl50'  THEN v_req_level := 50;  v_type := 'gacha_frame'; v_value := 'lvlgolden';
    WHEN 'lvl60'  THEN v_req_level := 60;  v_type := 'gacha_frame'; v_value := 'rainbow';
    WHEN 'lvl75'  THEN v_req_level := 75;  v_type := 'title';       v_value := 'Elite';
    WHEN 'lvl90'  THEN v_req_level := 90;  v_type := 'gacha_frame'; v_value := 'lvlaura';
    WHEN 'lvl100' THEN v_req_level := 100; v_type := 'gacha_frame'; v_value := 'lvllegend';
      v_extra_titles := ARRAY['Legend', 'Hall of Fame'];
    ELSE RAISE EXCEPTION 'invalid_reward';
  END CASE;

  IF v_level < v_req_level THEN RAISE EXCEPTION 'level_too_low'; END IF;

  INSERT INTO level_reward_claims (player_id, reward_id) VALUES (v_uid, p_reward_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'already_claimed'; END IF;

  -- level_reward_claims' UNIQUE(player_id, reward_id) + the ON CONFLICT check
  -- above guarantee this append runs at most once per reward per player.
  UPDATE players SET reward_claimed = (
    COALESCE(NULLIF(reward_claimed, '')::jsonb, '[]'::jsonb) || to_jsonb(p_reward_id)
  )::text WHERE id = v_uid;

  IF v_type = 'title' OR COALESCE(array_length(v_extra_titles, 1), 0) > 0 THEN
    SELECT COALESCE(NULLIF(prime_titles, '')::jsonb, '[]'::jsonb) INTO v_titles FROM players WHERE id = v_uid;
    v_new_titles := v_titles;
    IF v_type = 'title' THEN v_new_titles := v_new_titles || to_jsonb(v_value); END IF;
    FOR i IN 1..COALESCE(array_length(v_extra_titles, 1), 0) LOOP
      v_new_titles := v_new_titles || to_jsonb(v_extra_titles[i]);
    END LOOP;
    UPDATE players SET prime_titles = v_new_titles::text WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'reward_id', p_reward_id, 'cosmetic_type', v_type,
    'cosmetic_value', v_value, 'extra_titles', to_jsonb(v_extra_titles));
END;
$$;
-- CREATE OR REPLACE preserves the existing GRANT EXECUTE ... TO anon, authenticated.
