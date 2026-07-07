-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 3.1 — Banner config expansion + dup-refund config + gacha_history
-- Applied via Supabase MCP apply_migration (migration name: p3_step1_banner_config)
--
-- Purely additive schema — no live behavior change yet (that's P3.6).
-- gacha_pools already exists (Phase 1B Step 6: banner_type/start_time/
-- end_time/pity_enabled/soft_pity/hard_pity); this adds the remaining
-- spec fields (subtitle/image/currency/limits/visibility) plus a proper
-- currency_id (both live pools spend coins; multi-currency banners are
-- now possible without a schema change).
--
-- Dup-refund is DATA-DRIVEN on item_rarities rather than the client's
-- current hardcoded `GACHA_DUP_REFUND = {emoji:1,frame:3,ultra:6,secret:20}`
-- (js/gacha.js) — that map is keyed inconsistently by item TYPE/legacy-tier,
-- not rarity, and can't be reverse-engineered exactly; seeded to a
-- monotonic scale anchored on its 4 known points (common=1, rare=3 for
-- rare-tier frames, epic=6 for what the client calls "ultra", secret=20)
-- with uncommon/mythic/legendary/event/limited filled in sensibly.
-- Per-item overrides remain possible via the existing item_catalog.meta
-- jsonb (key 'dup_refund') with no further schema change.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE gacha_pools
  ADD COLUMN subtitle      text,
  ADD COLUMN description   text,
  ADD COLUMN image         text,
  ADD COLUMN video         text,
  ADD COLUMN background    text,
  ADD COLUMN music         text,
  ADD COLUMN currency_id   text NOT NULL DEFAULT 'coin' REFERENCES currencies(code),
  ADD COLUMN max_pull      int,
  ADD COLUMN daily_limit   int,
  ADD COLUMN weekly_limit  int,
  ADD COLUMN monthly_limit int,
  ADD COLUMN visibility    text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private','tournament')),
  ADD COLUMN sort          int NOT NULL DEFAULT 0,
  ADD COLUMN meta          jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE item_rarities ADD COLUMN dup_refund_coins int NOT NULL DEFAULT 0;
UPDATE item_rarities SET dup_refund_coins = CASE code
  WHEN 'common'    THEN 1
  WHEN 'uncommon'  THEN 2
  WHEN 'rare'      THEN 3
  WHEN 'epic'      THEN 6
  WHEN 'mythic'    THEN 10
  WHEN 'legendary' THEN 15
  WHEN 'secret'    THEN 20
  WHEN 'event'     THEN 5
  WHEN 'limited'   THEN 8
  ELSE 0 END;

CREATE TABLE gacha_history (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id             bigint NOT NULL REFERENCES players(id),
  banner_id             text NOT NULL REFERENCES gacha_pools(id),
  pull_type             text NOT NULL,  -- '1','5','10','50','100', 'admin', 'free', ...
  currency_id           text NOT NULL REFERENCES currencies(code),
  currency_spent        int NOT NULL DEFAULT 0,
  items                 jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{item_id, rarity, was_dup, refund}]
  pity_before           int,
  pity_after            int,
  dup_status            jsonb NOT NULL DEFAULT '{}'::jsonb,
  server_seed           text,
  reward_transaction_id uuid REFERENCES reward_transactions(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gacha_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY gacha_history_read ON gacha_history FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON gacha_history TO anon, authenticated;
CREATE TRIGGER trg_gacha_history_immutable BEFORE UPDATE OR DELETE ON gacha_history
  FOR EACH ROW EXECUTE FUNCTION econ_block_mutation();
CREATE INDEX gacha_history_player_idx ON gacha_history (player_id, created_at DESC);
CREATE INDEX gacha_history_banner_idx ON gacha_history (banner_id, created_at DESC);

-- Backfill currency_id on the two live pools explicitly (both spend coins
-- today; the column default already covers this, this is just clarity).
UPDATE gacha_pools SET currency_id = 'coin' WHERE id IN ('coin', 'element');
