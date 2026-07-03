-- ═══════════════════════════════════════════════════════════════════════════
-- BK CLUB — MARKETPLACE (System 2)
-- Canonical record. ALREADY APPLIED to project tprmqsfbeyqurwqpmpia via the
-- Supabase MCP migrations:
--   • economy_marketplace                    (original)
--   • economy_marketplace_escrow_fix_phase2  (QA hardening 2026-07-03)
--
-- AUTH: no Supabase Auth. Acting player resolved by session_uid() from the
-- x-player-token header (see supabase_lockdown.sql). Every mutation is
-- SECURITY DEFINER + FOR UPDATE (race / double-buy safe).
--
-- ESCROW MODEL: listing an item REMOVES it from the seller's gacha_inventory
-- (anti-duplication — you can't list then equip/re-list). It is returned on
-- cancel and granted to the buyer on sale. Coin sinks: 🪙1 listing fee + 5% tax.
--
-- QA hardening 2026-07-03 (phase2 migration): market_list_item/market_buy/
-- market_cancel now also keep two additional pieces of equip/ownership state
-- in sync when the traded item is an 'elements' or 'effects' cosmetic:
--   • gacha_inventory.equippedElement (scalar) / .equippedEffects (array) —
--     previously only gacha_frame/gacha_name/gacha_emoji were cleared on
--     sale, so a sold-but-equipped element/effect kept rendering on the
--     seller's avatar (equippedElement is read cross-device as a fallback —
--     see js/gacha-element.js _geGetData).
--   • players.owned_effects — a column DUPLICATING gacha_inventory.effects
--     (see js/utils.js normalizePlayer, which reads owned_effects FIRST).
--     The original RPCs only ever touched gacha_inventory, so selling an
--     effect left it permanently "owned" via this stale column regardless
--     of what the JSON said. Now kept in sync on list/buy/cancel.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_listings (
  id         bigserial PRIMARY KEY,
  seller_id  bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  item_k     text   NOT NULL,   -- frames|names|emojis|elements|effects
  item_v     text   NOT NULL,
  price      int    NOT NULL CHECK (price >= 1 AND price <= 1000000),
  status     text   NOT NULL DEFAULT 'active',   -- active|sold|cancelled
  buyer_id   bigint REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  sold_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_market_active ON public.market_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_seller ON public.market_listings(seller_id, status);

CREATE TABLE IF NOT EXISTS public.market_transactions (
  id bigserial PRIMARY KEY, listing_id bigint,
  seller_id bigint NOT NULL, buyer_id bigint NOT NULL,
  item_k text NOT NULL, item_v text NOT NULL,
  price int NOT NULL, tax int NOT NULL DEFAULT 0, fee int NOT NULL DEFAULT 0,
  traded_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_tx_time ON public.market_transactions(traded_at DESC);
-- QA hardening 2026-07-03: ledger integrity backstop (M1)
ALTER TABLE public.market_transactions
  ADD CONSTRAINT market_transactions_price_nonneg CHECK (price >= 0);
ALTER TABLE public.market_transactions
  ADD CONSTRAINT market_transactions_tax_nonneg CHECK (tax >= 0);
ALTER TABLE public.market_transactions
  ADD CONSTRAINT market_transactions_fee_nonneg CHECK (fee >= 0);

ALTER TABLE public.market_listings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ml_read ON public.market_listings;
CREATE POLICY ml_read ON public.market_listings FOR SELECT USING (true);
DROP POLICY IF EXISTS mt_read ON public.market_transactions;
CREATE POLICY mt_read ON public.market_transactions FOR SELECT USING (true);

-- market_list_item(k,v,price): validates ownership + price 1..1e6, charges
-- 🪙1 fee, ESCROWS the item out of inventory (+ unequips it — including
-- equippedElement/equippedEffects and the owned_effects column, see header),
-- inserts the listing.
CREATE OR REPLACE FUNCTION public.market_list_item(p_item_k text, p_item_v text, p_price integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid bigint; v_coins int; v_inv jsonb; v_fee int := 1; v_arr jsonb; v_id bigint;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_price IS NULL OR p_price < 1 OR p_price > 1000000 THEN RAISE EXCEPTION 'bad_price'; END IF;
  IF p_item_k NOT IN ('frames','names','emojis','elements','effects') THEN RAISE EXCEPTION 'bad_slot'; END IF;

  SELECT coins, coalesce(gacha_inventory::jsonb, '{}'::jsonb) INTO v_coins, v_inv
    FROM players WHERE id = v_pid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'player_not_found'; END IF;
  IF NOT coalesce(v_inv->p_item_k, '[]'::jsonb) @> to_jsonb(p_item_v) THEN RAISE EXCEPTION 'not_owned'; END IF;
  IF v_coins < v_fee THEN RAISE EXCEPTION 'insufficient_coins'; END IF;

  -- escrow: remove the item from inventory
  v_arr := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
            FROM jsonb_array_elements_text(coalesce(v_inv->p_item_k, '[]'::jsonb)) e WHERE e <> p_item_v);
  v_inv := jsonb_set(v_inv, ARRAY[p_item_k], v_arr, true);

  -- clear equip state that referenced the now-escrowed item
  IF p_item_k = 'elements' AND v_inv->>'equippedElement' = p_item_v THEN
    v_inv := jsonb_set(v_inv, '{equippedElement}', 'null'::jsonb);
  END IF;
  IF p_item_k = 'effects' THEN
    v_arr := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
              FROM jsonb_array_elements_text(coalesce(v_inv->'equippedEffects', '[]'::jsonb)) e WHERE e <> p_item_v);
    v_inv := jsonb_set(v_inv, '{equippedEffects}', v_arr, true);
  END IF;

  UPDATE players SET
    coins = coins - v_fee,
    gacha_inventory = v_inv::text,
    gacha_frame = CASE WHEN p_item_k='frames' AND gacha_frame = p_item_v THEN NULL ELSE gacha_frame END,
    gacha_name  = CASE WHEN p_item_k='names'  AND gacha_name  = p_item_v THEN NULL ELSE gacha_name  END,
    gacha_emoji = CASE WHEN p_item_k='emojis' AND gacha_emoji = p_item_v THEN NULL ELSE gacha_emoji END,
    owned_effects = CASE WHEN p_item_k = 'effects' THEN
        (SELECT coalesce(jsonb_agg(e), '[]'::jsonb)::text
         FROM jsonb_array_elements_text(coalesce(NULLIF(owned_effects, ''), '[]')::jsonb) e
         WHERE e <> p_item_v)
      ELSE owned_effects END
  WHERE id = v_pid;

  INSERT INTO market_listings (seller_id, item_k, item_v, price)
    VALUES (v_pid, p_item_k, p_item_v, p_price) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'listing_id', v_id, 'fee', v_fee, 'coins_remaining', v_coins - v_fee);
END; $function$;
GRANT EXECUTE ON FUNCTION public.market_list_item(text, text, integer) TO anon, authenticated;

-- market_buy(listing_id): locks listing FOR UPDATE first (serialises concurrent
-- buyers → 2nd sees 'not_available'); blocks cannot_buy_own, already_owned,
-- insufficient_coins; debits buyer full price, credits seller price − ceil(5%)
-- tax, grants item (+ syncs owned_effects for effects), marks sold, writes ledger.
CREATE OR REPLACE FUNCTION public.market_buy(p_listing_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid bigint; v_l market_listings%ROWTYPE; v_coins int; v_inv jsonb; v_tax int; v_arr jsonb;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_l FROM market_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'listing_not_found'; END IF;
  IF v_l.status <> 'active' THEN RAISE EXCEPTION 'not_available'; END IF;
  IF v_l.seller_id = v_pid THEN RAISE EXCEPTION 'cannot_buy_own'; END IF;

  SELECT coins, coalesce(gacha_inventory::jsonb, '{}'::jsonb) INTO v_coins, v_inv
    FROM players WHERE id = v_pid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'player_not_found'; END IF;
  IF v_coins < v_l.price THEN RAISE EXCEPTION 'insufficient_coins'; END IF;
  IF coalesce(v_inv->v_l.item_k, '[]'::jsonb) @> to_jsonb(v_l.item_v) THEN RAISE EXCEPTION 'already_owned'; END IF;

  v_tax := ceil(v_l.price * 0.05)::int;

  -- grant item + debit buyer
  v_arr := coalesce(v_inv->v_l.item_k, '[]'::jsonb) || to_jsonb(v_l.item_v);
  v_inv := jsonb_set(v_inv, ARRAY[v_l.item_k], v_arr, true);
  UPDATE players SET
    coins = coins - v_l.price,
    gacha_inventory = v_inv::text,
    owned_effects = CASE WHEN v_l.item_k = 'effects' THEN
        (SELECT coalesce(jsonb_agg(DISTINCT e), '[]'::jsonb)::text
         FROM jsonb_array_elements_text(
           coalesce(NULLIF(owned_effects, ''), '[]')::jsonb || to_jsonb(v_l.item_v)) e)
      ELSE owned_effects END
    WHERE id = v_pid;

  -- credit seller (proceeds net of tax)
  UPDATE players SET coins = coins + (v_l.price - v_tax) WHERE id = v_l.seller_id;

  UPDATE market_listings SET status = 'sold', buyer_id = v_pid, sold_at = now() WHERE id = p_listing_id;
  INSERT INTO market_transactions (listing_id, seller_id, buyer_id, item_k, item_v, price, tax, fee)
    VALUES (p_listing_id, v_l.seller_id, v_pid, v_l.item_k, v_l.item_v, v_l.price, v_tax, 0);

  RETURN jsonb_build_object('ok', true, 'item', jsonb_build_object('k', v_l.item_k, 'v', v_l.item_v),
    'price', v_l.price, 'coins_remaining', v_coins - v_l.price);
END; $function$;
GRANT EXECUTE ON FUNCTION public.market_buy(bigint) TO anon, authenticated;

-- market_cancel(listing_id): seller-only, active-only; returns item to
-- inventory (+ restores owned_effects for effects).
CREATE OR REPLACE FUNCTION public.market_cancel(p_listing_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid bigint; v_l market_listings%ROWTYPE; v_inv jsonb; v_arr jsonb;
BEGIN
  v_pid := session_uid();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_l FROM market_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'listing_not_found'; END IF;
  IF v_l.seller_id <> v_pid THEN RAISE EXCEPTION 'not_seller'; END IF;
  IF v_l.status <> 'active' THEN RAISE EXCEPTION 'not_available'; END IF;

  SELECT coalesce(gacha_inventory::jsonb, '{}'::jsonb) INTO v_inv FROM players WHERE id = v_pid FOR UPDATE;
  IF NOT coalesce(v_inv->v_l.item_k, '[]'::jsonb) @> to_jsonb(v_l.item_v) THEN
    v_arr := coalesce(v_inv->v_l.item_k, '[]'::jsonb) || to_jsonb(v_l.item_v);
    v_inv := jsonb_set(v_inv, ARRAY[v_l.item_k], v_arr, true);
    UPDATE players SET
      gacha_inventory = v_inv::text,
      owned_effects = CASE WHEN v_l.item_k = 'effects' THEN
          (SELECT coalesce(jsonb_agg(DISTINCT e), '[]'::jsonb)::text
           FROM jsonb_array_elements_text(
             coalesce(NULLIF(owned_effects, ''), '[]')::jsonb || to_jsonb(v_l.item_v)) e)
        ELSE owned_effects END
      WHERE id = v_pid;
  END IF;

  UPDATE market_listings SET status = 'cancelled' WHERE id = p_listing_id;
  RETURN jsonb_build_object('ok', true, 'returned', jsonb_build_object('k', v_l.item_k, 'v', v_l.item_v));
END; $function$;
GRANT EXECUTE ON FUNCTION public.market_cancel(bigint) TO anon, authenticated;

-- market_stats(): read-only global aggregate for the Economy dashboard.
CREATE OR REPLACE FUNCTION public.market_stats()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'volume', coalesce((SELECT sum(price) FROM market_transactions), 0),
    'sales',  (SELECT count(*) FROM market_transactions),
    'activeListings', (SELECT count(*) FROM market_listings WHERE status = 'active')
  );
$function$;
GRANT EXECUTE ON FUNCTION public.market_stats() TO anon, authenticated;

-- Verified via rollback DO-block tests (multiple players + real session tokens):
-- happy path, double-buy→not_available, buy-own→cannot_buy_own, already_owned,
-- insufficient_coins, cancel-returns-item, list/buy/cancel of an EQUIPPED
-- element and effect (equip state + owned_effects column correctly cleared/
-- restored), coin conservation across a full list→buy cycle, ledger CHECK
-- constraints. No test rows left in prod.
