-- ═══════════════════════════════════════════════════════════════════════════
-- BK CLUB — GAME ECONOMY ECOSYSTEM (Systems 1-4)
-- Canonical record of the economy schema. ALREADY APPLIED to project
-- tprmqsfbeyqurwqpmpia via Supabase MCP migrations:
--   • economy_fusion_lab
--   • economy_fusion_lab_secure_auth   (session_uid auth hardening)
--   • economy_fusion_lockdown_phase1   (QA hardening 2026-07-03: CHECK constraints,
--     REVOKE anon SELECT on fusion_recipes/fusion_log, my_fusion_log()/fusion_stats() RPCs)
--
-- AUTH MODEL (critical): this app does NOT use Supabase Auth. Every request
-- uses the anon publishable key; the acting player is resolved server-side by
-- session_uid() from the `x-player-token` header (see supabase_lockdown.sql).
-- Therefore EVERY balance/inventory-mutating function is SECURITY DEFINER and
-- derives the player from session_uid() — it NEVER trusts a client-supplied id.
-- Inventory is JSON in players.gacha_inventory (text): {frames,names,emojis,
-- effects,elements,...}. Coins are players.coins (int).
--
-- Collection Book (System 3) and Economy Dashboard (System 4) are read-only on
-- the client and need no schema — they aggregate existing player data.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- SYSTEM 1 — FUSION LAB
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fusion_recipes (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  inputs     jsonb NOT NULL,   -- [{"k":"names","v":"solar"}, ...]  distinct owned items
  output     jsonb NOT NULL,   -- {"k":"names","v":"eclipse","label":"...","rarity":"legendary"}
  coin_cost  int  NOT NULL DEFAULT 0,
  is_secret  boolean NOT NULL DEFAULT false,  -- masked in list until player owns all inputs
  enabled    boolean NOT NULL DEFAULT true,
  sort       int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.fusion_log (
  id          bigserial PRIMARY KEY,
  player_id   bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  recipe_id   text   NOT NULL,
  coins_spent int    NOT NULL DEFAULT 0,
  output_k    text   NOT NULL,
  output_v    text   NOT NULL,
  fused_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fusion_log_player ON public.fusion_log(player_id, fused_at DESC);

ALTER TABLE public.fusion_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fusion_log     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fr_read ON public.fusion_recipes;
CREATE POLICY fr_read ON public.fusion_recipes FOR SELECT USING (true);
DROP POLICY IF EXISTS fl_read ON public.fusion_log;
CREATE POLICY fl_read ON public.fusion_log FOR SELECT USING (true);
-- Writes to both tables happen ONLY inside the SECURITY DEFINER RPCs below.

-- QA hardening 2026-07-03 (migration economy_fusion_lockdown_phase1):
--   • RLS policies above still exist, but anon's base-table SELECT grant is
--     revoked below — the *only* remaining anon read path is through the
--     masking-aware RPCs (list_fusion_recipes / my_fusion_log / fusion_stats).
--     A raw `GET /rest/v1/fusion_recipes` from the anon key now 401s, so a
--     secret recipe (e.g. genesis_frame) can no longer be read before it's
--     discovered by bypassing list_fusion_recipes()'s masking.
--   • Integrity CHECKs: a recipe can no longer credit coins (negative cost)
--     or trivially "fuse" with an empty inputs array.
ALTER TABLE public.fusion_recipes
  ADD CONSTRAINT fusion_recipes_coin_cost_nonneg CHECK (coin_cost >= 0);
ALTER TABLE public.fusion_recipes
  ADD CONSTRAINT fusion_recipes_inputs_nonempty CHECK (jsonb_array_length(inputs) > 0);

-- my_fusion_log(): the session player's own fuse history (was a direct,
-- world-readable `fusion_log` SELECT; now scoped via session_uid()).
CREATE OR REPLACE FUNCTION public.my_fusion_log(p_limit int DEFAULT 20)
RETURNS TABLE(recipe_id text, output_k text, output_v text, coins_spent int, fused_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid bigint;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  RETURN QUERY
    SELECT fl.recipe_id, fl.output_k, fl.output_v, fl.coins_spent, fl.fused_at
    FROM fusion_log fl WHERE fl.player_id = v_pid ORDER BY fl.fused_at DESC LIMIT p_limit;
END; $$;
GRANT EXECUTE ON FUNCTION public.my_fusion_log(int) TO anon, authenticated;

-- fusion_stats(): global aggregate for the Economy dashboard's Fusion tile
-- (was a direct `SELECT output_v FROM fusion_log` with no player scoping needed,
-- but fusion_log itself is no longer anon-readable, so this replaces that read).
CREATE OR REPLACE FUNCTION public.fusion_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int; v_items int;
BEGIN
  SELECT count(*), count(DISTINCT output_v) INTO v_count, v_items FROM fusion_log;
  RETURN jsonb_build_object('count', v_count, 'itemsCreated', v_items);
END; $$;
GRANT EXECUTE ON FUNCTION public.fusion_stats() TO anon, authenticated;

REVOKE SELECT ON public.fusion_recipes FROM anon;
REVOKE SELECT ON public.fusion_log FROM anon;

-- list_fusion_recipes(): recipes for the CURRENT session player; secret recipes
-- are masked (no name/inputs/output) until the player owns every input.
CREATE OR REPLACE FUNCTION public.list_fusion_recipes()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid bigint; v_inv jsonb; v_result jsonb := '[]'::jsonb; r record; inp jsonb; v_owns_all boolean;
BEGIN
  v_pid := session_uid();
  SELECT coalesce(gacha_inventory::jsonb, '{}'::jsonb) INTO v_inv FROM players WHERE id = v_pid;
  IF v_inv IS NULL THEN v_inv := '{}'::jsonb; END IF;
  FOR r IN SELECT * FROM fusion_recipes WHERE enabled = true ORDER BY sort, id LOOP
    v_owns_all := (v_pid IS NOT NULL);
    FOR inp IN SELECT * FROM jsonb_array_elements(r.inputs) LOOP
      IF NOT coalesce(v_inv->(inp->>'k'), '[]'::jsonb) @> to_jsonb(inp->>'v') THEN v_owns_all := false; END IF;
    END LOOP;
    IF r.is_secret AND NOT v_owns_all THEN
      v_result := v_result || jsonb_build_object('id', r.id, 'secret', true, 'discovered', false, 'coin_cost', r.coin_cost);
    ELSE
      v_result := v_result || jsonb_build_object('id', r.id, 'name', r.name, 'inputs', r.inputs,
        'output', r.output, 'coin_cost', r.coin_cost, 'secret', r.is_secret, 'discovered', true, 'owns_all', v_owns_all);
    END IF;
  END LOOP;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_fusion_recipes() TO anon, authenticated;

-- fuse_items(recipe): atomic. Locks the session player's row FOR UPDATE, validates
-- ownership of every input + coins (all-or-nothing), consumes inputs, grants the
-- output, deducts coins, unequips any consumed cosmetic, and audit-logs the fuse.
CREATE OR REPLACE FUNCTION public.fuse_items(p_recipe_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid bigint; v_recipe fusion_recipes%ROWTYPE; v_coins int; v_inv jsonb;
  inp jsonb; v_k text; v_v text; v_out_k text; v_out_v text; v_arr jsonb;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_recipe FROM fusion_recipes WHERE id = p_recipe_id AND enabled = true;
  IF v_recipe.id IS NULL THEN RAISE EXCEPTION 'recipe_not_found'; END IF;

  SELECT coins, coalesce(gacha_inventory::jsonb, '{}'::jsonb) INTO v_coins, v_inv
    FROM players WHERE id = v_pid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'player_not_found'; END IF;
  IF v_coins < v_recipe.coin_cost THEN RAISE EXCEPTION 'insufficient_coins'; END IF;

  v_out_k := v_recipe.output->>'k'; v_out_v := v_recipe.output->>'v';
  IF coalesce(v_inv->v_out_k, '[]'::jsonb) @> to_jsonb(v_out_v) THEN RAISE EXCEPTION 'already_owns_output'; END IF;

  FOR inp IN SELECT * FROM jsonb_array_elements(v_recipe.inputs) LOOP
    IF NOT coalesce(v_inv->(inp->>'k'), '[]'::jsonb) @> to_jsonb(inp->>'v') THEN
      RAISE EXCEPTION 'missing_input:%', inp->>'v';
    END IF;
  END LOOP;

  FOR inp IN SELECT * FROM jsonb_array_elements(v_recipe.inputs) LOOP
    v_k := inp->>'k'; v_v := inp->>'v';
    v_arr := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
              FROM jsonb_array_elements_text(coalesce(v_inv->v_k, '[]'::jsonb)) e WHERE e <> v_v);
    v_inv := jsonb_set(v_inv, ARRAY[v_k], v_arr, true);
  END LOOP;

  v_arr := coalesce(v_inv->v_out_k, '[]'::jsonb) || to_jsonb(v_out_v);
  v_inv := jsonb_set(v_inv, ARRAY[v_out_k], v_arr, true);

  UPDATE players SET
    coins = coins - v_recipe.coin_cost,
    gacha_inventory = v_inv::text,
    gacha_frame = CASE WHEN gacha_frame IS NOT NULL
      AND NOT coalesce(v_inv->'frames','[]'::jsonb) @> to_jsonb(gacha_frame) THEN NULL ELSE gacha_frame END,
    gacha_name = CASE WHEN gacha_name IS NOT NULL
      AND NOT coalesce(v_inv->'names','[]'::jsonb) @> to_jsonb(gacha_name) THEN NULL ELSE gacha_name END,
    gacha_emoji = CASE WHEN gacha_emoji IS NOT NULL
      AND NOT coalesce(v_inv->'emojis','[]'::jsonb) @> to_jsonb(gacha_emoji) THEN NULL ELSE gacha_emoji END
  WHERE id = v_pid;

  INSERT INTO fusion_log (player_id, recipe_id, coins_spent, output_k, output_v)
  VALUES (v_pid, p_recipe_id, v_recipe.coin_cost, v_out_k, v_out_v);

  RETURN jsonb_build_object('ok', true, 'recipe', p_recipe_id, 'output', v_recipe.output,
    'coins_remaining', v_coins - v_recipe.coin_cost);
END; $$;
GRANT EXECUTE ON FUNCTION public.fuse_items(text) TO anon, authenticated;

-- Seed recipes (distinct-item; outputs reuse existing visual styles via
-- _FRAME_ALIAS/_NAME_ALIAS in js/utils.js: prismatic→halo, genesis→solaremperor, eclipse→void)
-- NOTE: eclipse_script's 'solaremperor' input matches the canonical value —
-- see the phase3 migration below for why (this seed originally said 'solar').
INSERT INTO public.fusion_recipes (id, name, inputs, output, coin_cost, is_secret, sort) VALUES
  ('eclipse_script', '🌘 Eclipse Script',
     '[{"k":"names","v":"solaremperor"},{"k":"names","v":"void"}]'::jsonb,
     '{"k":"names","v":"eclipse","label":"🌘 Eclipse Script","rarity":"legendary"}'::jsonb, 30, false, 1),
  ('prismatic_frame', '🌈 Prismatic Frame',
     '[{"k":"frames","v":"rainbow"},{"k":"frames","v":"robot"}]'::jsonb,
     '{"k":"frames","v":"prismatic","label":"🌈 Prismatic Frame","rarity":"legendary"}'::jsonb, 25, false, 2),
  ('genesis_frame', '👑 Genesis Frame',
     '[{"k":"frames","v":"void"},{"k":"frames","v":"halo"}]'::jsonb,
     '{"k":"frames","v":"genesis","label":"👑 Genesis Frame","rarity":"legendary"}'::jsonb, 60, true, 3)
ON CONFLICT (id) DO NOTHING;

-- QA hardening 2026-07-03 (migration economy_solar_canon_normalize_phase3):
-- 'solaremperor' is the catalog's canonical value (js/economy-catalog.js
-- VALUE_ALIASES maps legacy 'solar' → 'solaremperor' on READS only). But the
-- DB had raw 'solar' stored in gacha_inventory.{frames,names} for one player,
-- while Marketplace writes always used the canonical 'solaremperor' — so
-- that item could never actually be listed ('not_owned', since the DB still
-- said 'solar'). One-time data fix: replaced 'solar' → 'solaremperor' in
-- every player's gacha_inventory.frames[]/names[] and the equipped
-- gacha_frame/gacha_name scalar columns, and updated eclipse_script's input
-- to match (see seed above). Verified via a rollback DO-block test that
-- array length/other elements were untouched, then confirmed live that the
-- item became listable. VALUE_ALIASES is kept in economy-catalog.js as a
-- defensive fallback, not removed.
UPDATE public.players
SET gacha_inventory = jsonb_set(
      jsonb_set(
        gacha_inventory::jsonb,
        '{frames}',
        (SELECT coalesce(jsonb_agg(CASE WHEN e = 'solar' THEN 'solaremperor' ELSE e END), '[]'::jsonb)
         FROM jsonb_array_elements_text(coalesce(gacha_inventory::jsonb->'frames','[]'::jsonb)) e),
        true
      ),
      '{names}',
      (SELECT coalesce(jsonb_agg(CASE WHEN e = 'solar' THEN 'solaremperor' ELSE e END), '[]'::jsonb)
       FROM jsonb_array_elements_text(coalesce(gacha_inventory::jsonb->'names','[]'::jsonb)) e),
      true
    )::text
WHERE gacha_inventory::jsonb->'frames' @> '"solar"' OR gacha_inventory::jsonb->'names' @> '"solar"';
UPDATE public.players SET gacha_frame = 'solaremperor' WHERE gacha_frame = 'solar';
UPDATE public.players SET gacha_name = 'solaremperor' WHERE gacha_name = 'solar';
UPDATE public.fusion_recipes
SET inputs = (SELECT jsonb_agg(CASE WHEN inp->>'v' = 'solar' THEN jsonb_set(inp, '{v}', '"solaremperor"') ELSE inp END)
              FROM jsonb_array_elements(inputs) inp)
WHERE id = 'eclipse_script';

-- ─────────────────────────────────────────────────────────────
-- SYSTEM 2 — MARKETPLACE  (added in a later migration; see supabase_marketplace.sql)
-- ─────────────────────────────────────────────────────────────
