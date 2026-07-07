-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 3.3 — Admin banner management RPCs
-- Applied via Supabase MCP apply_migration (migration name: p3_step3_gacha_admin)
--
-- create/update take a jsonb config/patch (gacha_pools has ~20 columns
-- after P3.1's expansion; a positional-arg function would be unwieldy and
-- brittle to extend). update only touches keys present in the patch
-- (COALESCE against the existing value), so an admin can change one field
-- without resending the whole banner. set_rates does a full REPLACE of a
-- pool's gacha_pool_items (an admin submits the complete rate table, not
-- a partial upsert — avoids ambiguity about "did they mean to remove
-- this item"). grant_free_pulls credits the pool's currency for exactly
-- p_count pulls' cost rather than inventing a separate free-pull-ticket
-- subsystem (which would require touching rpc_gacha_pull_v2 again,
-- re-risking the overload trap on an already-tested function) — the
-- practical effect (player can pull p_count times without spending their
-- own balance) is the same.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_banner_create(p_id text, p_config jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF EXISTS (SELECT 1 FROM gacha_pools WHERE id = p_id) THEN RAISE EXCEPTION 'banner_already_exists'; END IF;

  INSERT INTO gacha_pools (
    id, cost, cost_10, active, currency_id, banner_type, title, subtitle, description,
    image, video, background, music, start_time, end_time, pity_enabled, soft_pity, hard_pity,
    max_pull, daily_limit, weekly_limit, monthly_limit, visibility, sort, meta
  ) VALUES (
    p_id,
    COALESCE((p_config->>'cost')::int, 1),
    COALESCE((p_config->>'cost_10')::int, COALESCE((p_config->>'cost')::int, 1) * 10),
    COALESCE((p_config->>'active')::boolean, false),
    COALESCE(p_config->>'currency_id', 'coin'),
    COALESCE(p_config->>'banner_type', 'standard'),
    p_config->>'title', p_config->>'subtitle', p_config->>'description',
    p_config->>'image', p_config->>'video', p_config->>'background', p_config->>'music',
    (p_config->>'start_time')::timestamptz, (p_config->>'end_time')::timestamptz,
    COALESCE((p_config->>'pity_enabled')::boolean, false),
    (p_config->>'soft_pity')::int, (p_config->>'hard_pity')::int,
    (p_config->>'max_pull')::int, (p_config->>'daily_limit')::int,
    (p_config->>'weekly_limit')::int, (p_config->>'monthly_limit')::int,
    COALESCE(p_config->>'visibility', 'public'),
    COALESCE((p_config->>'sort')::int, 0),
    COALESCE(p_config->'meta', '{}'::jsonb)
  );

  PERFORM log_admin_action('create_banner', 'gacha_pools', p_id, NULL, p_config);
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION admin_banner_update(p_id text, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_new jsonb;
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT to_jsonb(gp) INTO v_old FROM gacha_pools gp WHERE id = p_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'banner_not_found'; END IF;

  UPDATE gacha_pools SET
    cost          = COALESCE((p_patch->>'cost')::int, cost),
    cost_10       = COALESCE((p_patch->>'cost_10')::int, cost_10),
    active        = COALESCE((p_patch->>'active')::boolean, active),
    currency_id   = COALESCE(p_patch->>'currency_id', currency_id),
    banner_type   = COALESCE(p_patch->>'banner_type', banner_type),
    title         = COALESCE(p_patch->>'title', title),
    subtitle      = COALESCE(p_patch->>'subtitle', subtitle),
    description   = COALESCE(p_patch->>'description', description),
    image         = COALESCE(p_patch->>'image', image),
    video         = COALESCE(p_patch->>'video', video),
    background    = COALESCE(p_patch->>'background', background),
    music         = COALESCE(p_patch->>'music', music),
    start_time    = CASE WHEN p_patch ? 'start_time' THEN (p_patch->>'start_time')::timestamptz ELSE start_time END,
    end_time      = CASE WHEN p_patch ? 'end_time' THEN (p_patch->>'end_time')::timestamptz ELSE end_time END,
    pity_enabled  = COALESCE((p_patch->>'pity_enabled')::boolean, pity_enabled),
    soft_pity     = CASE WHEN p_patch ? 'soft_pity' THEN (p_patch->>'soft_pity')::int ELSE soft_pity END,
    hard_pity     = CASE WHEN p_patch ? 'hard_pity' THEN (p_patch->>'hard_pity')::int ELSE hard_pity END,
    max_pull      = CASE WHEN p_patch ? 'max_pull' THEN (p_patch->>'max_pull')::int ELSE max_pull END,
    daily_limit   = CASE WHEN p_patch ? 'daily_limit' THEN (p_patch->>'daily_limit')::int ELSE daily_limit END,
    weekly_limit  = CASE WHEN p_patch ? 'weekly_limit' THEN (p_patch->>'weekly_limit')::int ELSE weekly_limit END,
    monthly_limit = CASE WHEN p_patch ? 'monthly_limit' THEN (p_patch->>'monthly_limit')::int ELSE monthly_limit END,
    visibility    = COALESCE(p_patch->>'visibility', visibility),
    sort          = COALESCE((p_patch->>'sort')::int, sort),
    meta          = COALESCE(p_patch->'meta', meta)
  WHERE id = p_id;

  SELECT to_jsonb(gp) INTO v_new FROM gacha_pools gp WHERE id = p_id;
  PERFORM log_admin_action('update_banner', 'gacha_pools', p_id, v_old, v_new);
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION admin_banner_clone(p_source_id text, p_new_id text, p_new_title text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF EXISTS (SELECT 1 FROM gacha_pools WHERE id = p_new_id) THEN RAISE EXCEPTION 'banner_already_exists'; END IF;
  IF NOT EXISTS (SELECT 1 FROM gacha_pools WHERE id = p_source_id) THEN RAISE EXCEPTION 'source_banner_not_found'; END IF;

  INSERT INTO gacha_pools (
    id, cost, cost_10, active, currency_id, banner_type, title, subtitle, description,
    image, video, background, music, start_time, end_time, pity_enabled, soft_pity, hard_pity,
    max_pull, daily_limit, weekly_limit, monthly_limit, visibility, sort, meta
  )
  SELECT p_new_id, cost, cost_10, false, currency_id, banner_type,
    COALESCE(p_new_title, title || ' (Copy)'), subtitle, description,
    image, video, background, music, NULL, NULL, pity_enabled, soft_pity, hard_pity,
    max_pull, daily_limit, weekly_limit, monthly_limit, visibility, sort, meta
  FROM gacha_pools WHERE id = p_source_id;

  INSERT INTO gacha_pool_items (pool_id, item_id, weight, featured, guaranteed)
  SELECT p_new_id, item_id, weight, featured, guaranteed FROM gacha_pool_items WHERE pool_id = p_source_id;

  PERFORM log_admin_action('clone_banner', 'gacha_pools', p_new_id, NULL, jsonb_build_object('source', p_source_id));
  RETURN p_new_id;
END $$;

CREATE OR REPLACE FUNCTION admin_banner_disable(p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE gacha_pools SET active = false WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'banner_not_found'; END IF;
  PERFORM log_admin_action('disable_banner', 'gacha_pools', p_id, NULL, NULL);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION admin_banner_schedule(p_id text, p_start timestamptz, p_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_end IS NOT NULL AND p_start IS NOT NULL AND p_end <= p_start THEN RAISE EXCEPTION 'bad_schedule'; END IF;
  UPDATE gacha_pools SET start_time = p_start, end_time = p_end WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'banner_not_found'; END IF;
  PERFORM log_admin_action('schedule_banner', 'gacha_pools', p_id, NULL, jsonb_build_object('start', p_start, 'end', p_end));
  RETURN jsonb_build_object('ok', true);
END $$;

-- Full replace of a pool's item weights. p_rates:
-- [{"item_id":"frame:x","weight":10,"featured":false,"guaranteed":false}, ...]
CREATE OR REPLACE FUNCTION admin_banner_set_rates(p_id text, p_rates jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; v_count int := 0;
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF NOT EXISTS (SELECT 1 FROM gacha_pools WHERE id = p_id) THEN RAISE EXCEPTION 'banner_not_found'; END IF;
  IF jsonb_array_length(p_rates) = 0 THEN RAISE EXCEPTION 'empty_rates'; END IF;

  DELETE FROM gacha_pool_items WHERE pool_id = p_id;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rates) LOOP
    INSERT INTO gacha_pool_items (pool_id, item_id, weight, featured, guaranteed)
    VALUES (p_id, r->>'item_id', (r->>'weight')::numeric,
            COALESCE((r->>'featured')::boolean, false), COALESCE((r->>'guaranteed')::boolean, false));
    v_count := v_count + 1;
  END LOOP;

  PERFORM log_admin_action('set_banner_rates', 'gacha_pool_items', p_id, NULL, p_rates);
  RETURN jsonb_build_object('ok', true, 'items_set', v_count);
END $$;

-- Read-only: normalized drop-rate % per item, no mutation.
CREATE OR REPLACE FUNCTION admin_banner_preview_rates(p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total numeric; v_out jsonb;
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT SUM(weight) INTO v_total FROM gacha_pool_items WHERE pool_id = p_id;
  IF v_total IS NULL OR v_total = 0 THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'item_id', gpi.item_id, 'rarity', ic.rarity, 'weight', gpi.weight,
    'percent', round(gpi.weight / v_total * 100, 4),
    'featured', gpi.featured, 'guaranteed', gpi.guaranteed
  ) ORDER BY gpi.weight DESC), '[]'::jsonb)
  INTO v_out
  FROM gacha_pool_items gpi JOIN item_catalog ic ON ic.id = gpi.item_id
  WHERE gpi.pool_id = p_id;

  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION admin_reset_pity(p_player bigint, p_pool text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE user_gacha_statistics SET current_pity = 0, guaranteed_featured = false
    WHERE player_id = p_player AND pool_id = p_pool;
  PERFORM log_admin_action('reset_pity', 'user_gacha_statistics', p_player::text,
    NULL, jsonb_build_object('pool_id', p_pool));
  RETURN jsonb_build_object('ok', true);
END $$;

-- Credits the pool's currency for exactly p_count pulls' worth of cost —
-- the practical effect of a "free pull" grant without a separate
-- free-pull-ticket subsystem (see header note).
CREATE OR REPLACE FUNCTION admin_grant_free_pulls(p_player bigint, p_pool text, p_count int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin bigint; v_pool record; v_amount int;
BEGIN
  v_admin := session_uid();
  IF v_admin IS NULL OR NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_count <= 0 THEN RAISE EXCEPTION 'bad_count'; END IF;
  SELECT * INTO v_pool FROM gacha_pools WHERE id = p_pool;
  IF v_pool.id IS NULL THEN RAISE EXCEPTION 'banner_not_found'; END IF;

  v_amount := v_pool.cost * p_count;
  PERFORM econ_adjust_currency(p_player, v_pool.currency_id, v_amount, 'admin_free_pull_grant',
    'gacha_pools', NULL, jsonb_build_object('pool_id', p_pool, 'count', p_count, 'admin_id', v_admin));
  PERFORM notify(p_player, 'admin', 'Free Pulls Granted', format('You received %s free pulls on %s', p_count, COALESCE(v_pool.title, p_pool)));
  PERFORM log_admin_action('grant_free_pulls', 'gacha_pools', p_pool, NULL,
    jsonb_build_object('player_id', p_player, 'count', p_count, 'currency_credited', v_amount));

  RETURN jsonb_build_object('ok', true, 'currency_credited', v_amount);
END $$;
