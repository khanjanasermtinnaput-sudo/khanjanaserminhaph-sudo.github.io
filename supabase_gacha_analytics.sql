-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 3.4 — Gacha analytics (admin-only, read-only)
-- Applied via Supabase MCP apply_migration (migration name: p3_step4_gacha_analytics)
--
-- Sourced entirely from gacha_history (immutable, one row per pull batch,
-- `items` holds every individual roll with rarity/is_dup/pity_reset) +
-- user_gacha_statistics (live pity state). "Revenue"/"Conversion Rate"
-- from the spec don't apply — this app has no real-money purchases — so
-- "Revenue" is scoped to currency sunk into gacha (a meaningful in-game
-- economy metric) and conversion rate is omitted.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION gacha_analytics(p_pool text DEFAULT NULL, p_since timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_actions int; v_total_rolls int; v_dup_rolls int;
  v_currency_sink jsonb; v_banner_popularity jsonb; v_avg_current_pity numeric;
  v_rarity_distribution jsonb; v_top_items jsonb;
BEGIN
  IF NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;

  SELECT count(*), COALESCE(SUM(jsonb_array_length(items)), 0) INTO v_total_actions, v_total_rolls
  FROM gacha_history gh
  WHERE (p_pool IS NULL OR gh.banner_id = p_pool) AND (p_since IS NULL OR gh.created_at >= p_since);

  SELECT count(*) INTO v_dup_rolls
  FROM gacha_history gh, jsonb_array_elements(gh.items) it
  WHERE (p_pool IS NULL OR gh.banner_id = p_pool) AND (p_since IS NULL OR gh.created_at >= p_since)
    AND (it->>'is_dup')::boolean;

  SELECT COALESCE(jsonb_object_agg(currency_id, total), '{}'::jsonb) INTO v_currency_sink
  FROM (
    SELECT currency_id, SUM(currency_spent) AS total FROM gacha_history gh
    WHERE (p_pool IS NULL OR gh.banner_id = p_pool) AND (p_since IS NULL OR gh.created_at >= p_since)
    GROUP BY currency_id
  ) s;

  SELECT COALESCE(jsonb_object_agg(banner_id, cnt), '{}'::jsonb) INTO v_banner_popularity
  FROM (
    SELECT banner_id, count(*) AS cnt FROM gacha_history gh
    WHERE (p_pool IS NULL OR gh.banner_id = p_pool) AND (p_since IS NULL OR gh.created_at >= p_since)
    GROUP BY banner_id
  ) s;

  SELECT AVG(current_pity) INTO v_avg_current_pity
  FROM user_gacha_statistics WHERE p_pool IS NULL OR pool_id = p_pool;

  SELECT COALESCE(jsonb_object_agg(rarity, cnt), '{}'::jsonb) INTO v_rarity_distribution
  FROM (
    SELECT it->>'rarity' AS rarity, count(*) AS cnt
    FROM gacha_history gh, jsonb_array_elements(gh.items) it
    WHERE (p_pool IS NULL OR gh.banner_id = p_pool) AND (p_since IS NULL OR gh.created_at >= p_since)
    GROUP BY it->>'rarity'
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', item_id, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
  INTO v_top_items
  FROM (
    SELECT it->>'item_id' AS item_id, count(*) AS cnt
    FROM gacha_history gh, jsonb_array_elements(gh.items) it
    WHERE (p_pool IS NULL OR gh.banner_id = p_pool) AND (p_since IS NULL OR gh.created_at >= p_since)
    GROUP BY it->>'item_id' ORDER BY count(*) DESC LIMIT 10
  ) s;

  RETURN jsonb_build_object(
    'total_pull_actions', v_total_actions,
    'total_rolls', v_total_rolls,
    'duplicate_rate_pct', CASE WHEN v_total_rolls > 0 THEN round(v_dup_rolls::numeric / v_total_rolls * 100, 2) ELSE 0 END,
    'currency_sink', v_currency_sink,
    'banner_popularity', v_banner_popularity,
    'avg_current_pity', round(COALESCE(v_avg_current_pity, 0), 2),
    'rarity_distribution', v_rarity_distribution,
    'top_items', v_top_items
  );
END $$;
