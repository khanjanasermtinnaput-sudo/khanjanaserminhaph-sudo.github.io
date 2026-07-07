-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 3.2 — rpc_gacha_pull_v2 rewritten as the canonical Reward-Engine
-- pipeline (still additive: this RPC is not yet on the live client path —
-- that's P3.6). Applied via Supabase MCP apply_migration (migration
-- name: p3_step2_gacha_pull_rewrite)
--
-- Real bug fixed while rewriting: the original pity-reset check tested
-- hardcoded rarity strings 'legendary'/'mythic', but NEITHER live pool's
-- actual top rarity is legendary/mythic (coin tops out at 'secret', so
-- does element) — pity would never have reset once an admin enabled it.
-- Generalized to compare against the pool's actual top item_rarities.rank.
-- Zero live impact today since pity_enabled=false on both pools.
--
-- Key architectural change (spec rule #1): every roll in a pull batch is
-- now DECIDED first (RNG, pity, featured/50-50, dup detection against
-- both pre-existing ownership AND items already decided earlier in this
-- same batch), then ONE reward_grant('gacha', items[], currency[], ...)
-- call at the end persists everything — one reward_transaction covers
-- the whole batch, not one per roll. Duplicate items are NOT re-granted
-- (no qty bump) — they convert to a coin refund via
-- item_rarities.dup_refund_coins instead, matching the spirit of the
-- legacy client's GACHA_DUP_REFUND (superseded, server-side, data-driven).
--
-- p_count is now a free integer 1..max_pull (default 100) rather than a
-- fixed {1,10} enum — covers the spec's "Custom Pull". cost_10 stays a
-- literal price override for an exact 10x pull; any other count scales
-- linearly off `cost`. Neither live pool currently prices a 10x pull at a
-- discount (cost_10 = cost*10 for both), so this is a pure generalization,
-- not a price change.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE user_gacha_statistics ADD COLUMN guaranteed_featured boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.rpc_gacha_pull_v2(
  p_pool text, p_count integer DEFAULT 1, p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid bigint;
  v_pool record;
  v_cost int;
  v_total numeric;
  v_top_rank int;
  v_pity int;
  v_pity_before int;
  v_guaranteed_featured boolean;
  v_txn uuid;
  v_reward_items jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_granted_this_batch text[] := ARRAY[]::text[];
  v_dup_refund_total int := 0;
  v_any_top_hit boolean := false;
  v_last_emoji_item text := NULL;
  v_legendary_count int := 0;
  v_mythic_count int := 0;
  i int;
  v_roll numeric; v_item text; v_item_rank int; v_cat record;
  v_force_top boolean; v_ramp numeric; v_scope_total numeric;
  v_has_featured boolean; v_was_owned boolean; v_will_reset boolean;
BEGIN
  v_uid := session_uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_pool FROM gacha_pools WHERE id = p_pool AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_pool'; END IF;
  IF v_pool.start_time IS NOT NULL AND now() < v_pool.start_time THEN RAISE EXCEPTION 'banner_not_started'; END IF;
  IF v_pool.end_time IS NOT NULL AND now() > v_pool.end_time THEN RAISE EXCEPTION 'banner_ended'; END IF;
  IF p_count < 1 OR p_count > COALESCE(v_pool.max_pull, 100) THEN RAISE EXCEPTION 'bad_count'; END IF;

  -- Idempotency short-circuit before spending anything.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM reward_transactions WHERE idempotency_key = p_idempotency_key AND player_id = v_uid;
    IF v_txn IS NOT NULL THEN
      RETURN jsonb_build_object('coins_remaining', (SELECT coins FROM players WHERE id = v_uid),
        'reward_transaction_id', v_txn, 'replayed', true);
    END IF;
  END IF;

  PERFORM set_config('bk.internal', '1', true);
  PERFORM econ_rate_check(v_uid, 'gacha_' || p_pool, 120, interval '1 hour', p_count);
  IF v_pool.daily_limit IS NOT NULL THEN
    PERFORM econ_rate_check(v_uid, 'gacha_daily_' || p_pool, v_pool.daily_limit, interval '1 day', p_count);
  END IF;
  IF v_pool.weekly_limit IS NOT NULL THEN
    PERFORM econ_rate_check(v_uid, 'gacha_weekly_' || p_pool, v_pool.weekly_limit, interval '7 days', p_count);
  END IF;
  IF v_pool.monthly_limit IS NOT NULL THEN
    PERFORM econ_rate_check(v_uid, 'gacha_monthly_' || p_pool, v_pool.monthly_limit, interval '30 days', p_count);
  END IF;

  v_cost := CASE WHEN p_count = 10 AND v_pool.cost_10 IS NOT NULL THEN v_pool.cost_10 ELSE v_pool.cost * p_count END;
  PERFORM econ_adjust_currency(v_uid, v_pool.currency_id, -v_cost, 'gacha_pull', 'gacha_pools', NULL,
    jsonb_build_object('pool', p_pool, 'count', p_count));

  SELECT SUM(weight) INTO v_total FROM gacha_pool_items WHERE pool_id = p_pool;
  IF v_total IS NULL OR v_total <= 0 THEN RAISE EXCEPTION 'empty_pool'; END IF;

  SELECT MAX(r.rank) INTO v_top_rank FROM gacha_pool_items gpi
    JOIN item_catalog ic ON ic.id = gpi.item_id JOIN item_rarities r ON r.code = ic.rarity
    WHERE gpi.pool_id = p_pool;

  SELECT current_pity, guaranteed_featured INTO v_pity, v_guaranteed_featured
    FROM user_gacha_statistics WHERE player_id = v_uid AND pool_id = p_pool FOR UPDATE;
  v_pity := COALESCE(v_pity, 0);
  v_guaranteed_featured := COALESCE(v_guaranteed_featured, false);
  v_pity_before := v_pity;

  FOR i IN 1..p_count LOOP
    v_force_top := false;
    IF v_pool.pity_enabled AND v_pool.hard_pity IS NOT NULL AND v_pity + 1 >= v_pool.hard_pity THEN
      v_force_top := true;
    ELSIF v_pool.pity_enabled AND v_pool.soft_pity IS NOT NULL AND v_pool.hard_pity IS NOT NULL
          AND v_pool.hard_pity > v_pool.soft_pity AND v_pity + 1 >= v_pool.soft_pity THEN
      v_ramp := LEAST(1.0, GREATEST(0.0, (v_pity + 1 - v_pool.soft_pity)::numeric / (v_pool.hard_pity - v_pool.soft_pity)));
      IF econ_crypto_random() < v_ramp THEN v_force_top := true; END IF;
    END IF;

    IF v_force_top AND v_top_rank IS NOT NULL THEN
      SELECT COALESCE(SUM(gpi.weight), 0) INTO v_scope_total FROM gacha_pool_items gpi
        JOIN item_catalog ic ON ic.id = gpi.item_id JOIN item_rarities r ON r.code = ic.rarity
        WHERE gpi.pool_id = p_pool AND r.rank = v_top_rank;
      v_roll := econ_crypto_random() * v_scope_total;
      SELECT t.item_id INTO v_item FROM (
        SELECT gpi.item_id, SUM(gpi.weight) OVER (ORDER BY gpi.item_id) AS cum
        FROM gacha_pool_items gpi JOIN item_catalog ic ON ic.id = gpi.item_id JOIN item_rarities r ON r.code = ic.rarity
        WHERE gpi.pool_id = p_pool AND r.rank = v_top_rank
      ) t WHERE t.cum > v_roll ORDER BY t.cum LIMIT 1;
      IF v_item IS NULL THEN
        SELECT gpi.item_id INTO v_item FROM gacha_pool_items gpi
          JOIN item_catalog ic ON ic.id = gpi.item_id JOIN item_rarities r ON r.code = ic.rarity
          WHERE gpi.pool_id = p_pool AND r.rank = v_top_rank ORDER BY gpi.item_id DESC LIMIT 1;
      END IF;
    ELSE
      v_roll := econ_crypto_random() * v_total;
      SELECT t.item_id INTO v_item FROM (
        SELECT item_id, SUM(weight) OVER (ORDER BY item_id) AS cum FROM gacha_pool_items WHERE pool_id = p_pool
      ) t WHERE t.cum > v_roll ORDER BY t.cum LIMIT 1;
      IF v_item IS NULL THEN
        SELECT item_id INTO v_item FROM gacha_pool_items WHERE pool_id = p_pool ORDER BY item_id DESC LIMIT 1;
      END IF;
    END IF;

    SELECT r.rank INTO v_item_rank FROM item_catalog ic JOIN item_rarities r ON r.code = ic.rarity WHERE ic.id = v_item;

    -- Featured / 50-50: only engages once an admin marks a top-rank item
    -- featured=true on a banner (neither live pool has any today).
    IF v_item_rank = v_top_rank THEN
      SELECT EXISTS (
        SELECT 1 FROM gacha_pool_items gpi JOIN item_catalog ic2 ON ic2.id = gpi.item_id JOIN item_rarities r2 ON r2.code = ic2.rarity
        WHERE gpi.pool_id = p_pool AND r2.rank = v_top_rank AND gpi.featured
      ) INTO v_has_featured;
      IF v_has_featured THEN
        IF v_guaranteed_featured OR econ_crypto_random() < 0.5 THEN
          SELECT gpi.item_id INTO v_item FROM gacha_pool_items gpi
            JOIN item_catalog ic2 ON ic2.id = gpi.item_id JOIN item_rarities r2 ON r2.code = ic2.rarity
            WHERE gpi.pool_id = p_pool AND r2.rank = v_top_rank AND gpi.featured
            ORDER BY random() LIMIT 1;
          v_guaranteed_featured := false;
        ELSE
          SELECT gpi.item_id INTO v_item FROM gacha_pool_items gpi
            JOIN item_catalog ic2 ON ic2.id = gpi.item_id JOIN item_rarities r2 ON r2.code = ic2.rarity
            WHERE gpi.pool_id = p_pool AND r2.rank = v_top_rank AND NOT gpi.featured
            ORDER BY random() LIMIT 1;
          v_guaranteed_featured := true;
        END IF;
      END IF;
    END IF;

    SELECT * INTO v_cat FROM item_catalog WHERE id = v_item;

    v_was_owned := (v_item = ANY (v_granted_this_batch)) OR EXISTS (
      SELECT 1 FROM player_items WHERE player_id = v_uid AND item_id = v_item AND qty > 0 AND deleted_at IS NULL
    );

    -- Pity resets on landing the pool's actual top rarity (generalized —
    -- see header note; was hardcoded to legendary/mythic before).
    v_will_reset := (v_item_rank IS NOT NULL AND v_top_rank IS NOT NULL AND v_item_rank >= v_top_rank);
    v_pity := CASE WHEN v_will_reset THEN 0 ELSE v_pity + 1 END;
    IF v_will_reset THEN v_any_top_hit := true; END IF;
    IF v_cat.rarity = 'legendary' THEN v_legendary_count := v_legendary_count + 1; END IF;
    IF v_cat.rarity = 'mythic' THEN v_mythic_count := v_mythic_count + 1; END IF;

    IF v_was_owned THEN
      v_dup_refund_total := v_dup_refund_total + COALESCE(
        (SELECT dup_refund_coins FROM item_rarities WHERE code = v_cat.rarity), 0);
    ELSE
      v_reward_items := v_reward_items || jsonb_build_object('item_id', v_item, 'qty', 1);
    END IF;
    v_granted_this_batch := array_append(v_granted_this_batch, v_item);

    IF v_cat.category = 'emoji' THEN v_last_emoji_item := v_item; END IF;

    v_results := v_results || jsonb_build_object(
      'item_id', v_item, 'category', v_cat.category, 'value', v_cat.value,
      'label', v_cat.label_th, 'label_en', v_cat.label_en, 'rarity', v_cat.rarity,
      'icon', v_cat.icon, 'is_dup', v_was_owned, 'pity_reset', v_will_reset);
  END LOOP;

  -- ONE Reward Engine call for the whole batch (spec rule #1).
  v_txn := reward_grant('gacha', v_reward_items,
    CASE WHEN v_dup_refund_total > 0
         THEN jsonb_build_array(jsonb_build_object('currency_id', 'coin', 'amount', v_dup_refund_total))
         ELSE '[]'::jsonb END,
    jsonb_build_object('banner_id', p_pool, 'count', p_count), p_idempotency_key);

  IF v_last_emoji_item IS NOT NULL THEN
    UPDATE player_items SET is_equipped = false WHERE player_id = v_uid AND equip_slot = 'emoji' AND is_equipped;
    UPDATE player_items SET is_equipped = true, equip_slot = 'emoji' WHERE player_id = v_uid AND item_id = v_last_emoji_item;
  END IF;

  INSERT INTO user_gacha_statistics (player_id, pool_id, total_rolls, current_pity, legendary_count, mythic_count, guaranteed_featured, last_roll_at)
  VALUES (v_uid, p_pool, p_count, v_pity, v_legendary_count, v_mythic_count, v_guaranteed_featured, now())
  ON CONFLICT (player_id, pool_id) DO UPDATE SET
    total_rolls = user_gacha_statistics.total_rolls + p_count,
    current_pity = v_pity,
    legendary_count = user_gacha_statistics.legendary_count + v_legendary_count,
    mythic_count = user_gacha_statistics.mythic_count + v_mythic_count,
    guaranteed_featured = v_guaranteed_featured,
    last_roll_at = now();

  INSERT INTO gacha_history (player_id, banner_id, pull_type, currency_id, currency_spent, items, pity_before, pity_after, dup_status, server_seed, reward_transaction_id)
  VALUES (v_uid, p_pool, p_count::text, v_pool.currency_id, v_cost, v_results, v_pity_before, v_pity,
    jsonb_build_object('dup_refund_total', v_dup_refund_total), encode(extensions.gen_random_bytes(8), 'hex'), v_txn);

  IF v_any_top_hit THEN
    PERFORM notify(v_uid, 'reward', 'Rare Pull!',
      format('You pulled a top-tier item from %s!', COALESCE(v_pool.title, p_pool)),
      jsonb_build_object('banner_id', p_pool, 'reward_transaction_id', v_txn));
  END IF;

  RETURN jsonb_build_object(
    'coins_remaining', (SELECT coins FROM players WHERE id = v_uid),
    'reward_transaction_id', v_txn,
    'results', v_results,
    'pity_before', v_pity_before, 'pity_after', v_pity);
END $function$;

-- The overload trap warned about in the header comment above happened
-- anyway: adding p_idempotency_key created a SECOND overload (the old
-- 2-parameter signature stayed registered alongside it) instead of a true
-- replace. Caught immediately via the pg_proc count check before any
-- testing began. Fixed by dropping the stale 2-parameter version.
DROP FUNCTION IF EXISTS rpc_gacha_pull_v2(text, integer);
