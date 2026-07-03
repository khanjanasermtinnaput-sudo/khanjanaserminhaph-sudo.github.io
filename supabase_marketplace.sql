-- ═══════════════════════════════════════════════════════════════════════════
-- BK CLUB — MARKETPLACE (System 2)
-- Canonical record. ALREADY APPLIED to project tprmqsfbeyqurwqpmpia via the
-- Supabase MCP migration `economy_marketplace`.
--
-- AUTH: no Supabase Auth. Acting player resolved by session_uid() from the
-- x-player-token header (see supabase_lockdown.sql). Every mutation is
-- SECURITY DEFINER + FOR UPDATE (race / double-buy safe).
--
-- ESCROW MODEL: listing an item REMOVES it from the seller's gacha_inventory
-- (anti-duplication — you can't list then equip/re-list). It is returned on
-- cancel and granted to the buyer on sale. Coin sinks: 🪙1 listing fee + 5% tax.
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

ALTER TABLE public.market_listings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ml_read ON public.market_listings;
CREATE POLICY ml_read ON public.market_listings FOR SELECT USING (true);
DROP POLICY IF EXISTS mt_read ON public.market_transactions;
CREATE POLICY mt_read ON public.market_transactions FOR SELECT USING (true);

-- Full function bodies (market_list_item / market_cancel / market_buy /
-- market_stats) live in migration `economy_marketplace`. Summary of guarantees:
--   market_list_item(k,v,price)  — validates ownership + price 1..1e6, charges
--     🪙1 fee, ESCROWS the item out of inventory (+ unequips it), inserts listing.
--   market_cancel(listing_id)    — seller-only, active-only; returns item.
--   market_buy(listing_id)       — locks listing FOR UPDATE first (serialises
--     concurrent buyers → 2nd sees 'not_available'); blocks cannot_buy_own,
--     already_owned, insufficient_coins; debits buyer full price, credits seller
--     price − ceil(5%) tax, grants item, marks sold, writes ledger row.
--   market_stats()               — read-only {volume, sales, activeListings}.
-- All GRANT EXECUTE ... TO anon, authenticated.
--
-- Verified via rollback DO-block tests (4 players + real session tokens):
-- happy path, double-buy→not_available, buy-own→cannot_buy_own, already_owned,
-- insufficient_coins, cancel-returns-item. No test rows left in prod.
