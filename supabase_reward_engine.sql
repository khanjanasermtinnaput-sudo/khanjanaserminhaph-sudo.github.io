-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 4 — Currencies (wallet system)
-- Applied via Supabase MCP apply_migration (migration name: inv_step4_currencies)
--
-- players.coins stays the actively-written column — 10+ existing RPCs
-- (econ_adjust_coins, rpc_award_match_coins, gacha_pull, daily rewards...)
-- write it directly and are out of scope for this step. user_currencies is
-- a new wallet ledger that MIRRORS players.coins via trigger, so every
-- future system (shop, coupons, battle pass) has a proper multi-currency
-- table to read/write without an immediate rewrite of every existing coin
-- path. Once the Reward Engine (Step 5) is live, new grants can write
-- user_currencies directly; the mirror keeps the legacy client correct
-- either way.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE currencies (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  icon        text,
  color       text,
  max_balance bigint,
  tradeable   boolean NOT NULL DEFAULT false,
  premium     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO currencies (code, name, icon, color, tradeable, premium) VALUES
  ('coin',             'Coin',              '🪙', '#fbbf24', false, false),
  ('diamond',          'Diamond',           '💎', '#60a5fa', false, true),
  ('tournament_point', 'Tournament Point',  '🏆', '#c084fc', false, false),
  ('event_token',      'Event Token',       '🎫', '#f472b6', false, false),
  ('ticket',           'Ticket',            '🎟️', '#34d399', false, false),
  ('voucher',          'Voucher',           '🧾', '#9ca3af', false, false),
  ('battle_pass_point','Battle Pass Point', '⭐', '#f97316', false, false),
  ('clan_point',       'Clan Point',        '🛡️', '#00d4ff', false, false);

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read  ON currencies FOR SELECT USING (true);
CREATE POLICY ref_admin ON currencies FOR ALL    USING (is_admin_caller()) WITH CHECK (is_admin_caller());
GRANT ALL ON currencies TO anon, authenticated;

CREATE TABLE user_currencies (
  player_id   bigint NOT NULL REFERENCES players(id),
  currency_id text   NOT NULL REFERENCES currencies(code),
  balance     bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, currency_id)
);

ALTER TABLE user_currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_currencies_read ON user_currencies FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON user_currencies TO anon, authenticated;

-- Backfill wallets from the current authoritative column
INSERT INTO user_currencies (player_id, currency_id, balance)
SELECT id, 'coin', COALESCE(coins, 0) FROM players;

-- Mirror trigger: players.coins -> user_currencies (keeps working even
-- though every existing RPC still writes players.coins directly).
CREATE OR REPLACE FUNCTION econ_mirror_coins_to_wallet() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO user_currencies (player_id, currency_id, balance, updated_at)
  VALUES (NEW.id, 'coin', COALESCE(NEW.coins, 0), now())
  ON CONFLICT (player_id, currency_id) DO UPDATE
    SET balance = EXCLUDED.balance, updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_mirror_coins_to_wallet
  AFTER INSERT OR UPDATE OF coins ON players
  FOR EACH ROW EXECUTE FUNCTION econ_mirror_coins_to_wallet();

-- Extend economy_ledger (doubling as currency_transactions per the plan;
-- inventory_history reuse happens in later steps).
ALTER TABLE economy_ledger
  ADD COLUMN currency_id    text REFERENCES currencies(code),
  ADD COLUMN balance_before bigint,
  ADD COLUMN balance_after  bigint;

UPDATE economy_ledger SET currency_id = 'coin' WHERE coins_delta <> 0;

CREATE INDEX economy_ledger_player_created_idx ON economy_ledger (player_id, created_at DESC);
