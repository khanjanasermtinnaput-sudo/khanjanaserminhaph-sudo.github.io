-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 12 — Indexes, RLS matrix polish, advisors pass
-- Applied via Supabase MCP apply_migration (migration name: inv_step12_hardening)
--
-- Ran get_advisors (security + performance) across everything built in
-- Steps 1-11. Security: every new RPC is flagged as "SECURITY DEFINER
-- executable by anon/authenticated" — expected, not a regression, since
-- every RPC (new and pre-existing alike, e.g. list_fusion_recipes) starts
-- with session_uid() resolving to NULL for any caller without a valid
-- x-player-token, immediately raising not_authenticated. This is the
-- established security model for this whole app (custom PIN auth, no
-- Supabase Auth), not something introduced here.
--
-- Performance: fixed the two real, actionable findings below.
-- ═══════════════════════════════════════════════════════════════════════

-- Duplicate indexes (byte-identical to pre-existing ones) — drop mine,
-- keep the pre-existing ones.
DROP INDEX IF EXISTS economy_ledger_player_created_idx;  -- duplicate of pre-existing idx_ledger_player
DROP INDEX IF EXISTS player_items_item_id_idx;            -- duplicate of pre-existing idx_player_items_item

-- Multiple permissive policies: every ref table I created paired a
-- `ref_read FOR SELECT USING(true)` with a `ref_admin FOR ALL` policy —
-- since FOR ALL includes SELECT, both policies were evaluated (OR'd) on
-- every SELECT. Split ref_admin into per-command policies that exclude
-- SELECT, so each command has exactly one applicable permissive policy.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_categories','item_rarities','currencies','reward_sources',
                            'shop_items','daily_login_rewards','event_rewards','battle_pass_rewards']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS ref_admin ON %I', t);
    EXECUTE format('CREATE POLICY ref_admin_insert ON %I FOR INSERT WITH CHECK (is_admin_caller())', t);
    EXECUTE format('CREATE POLICY ref_admin_update ON %I FOR UPDATE USING (is_admin_caller()) WITH CHECK (is_admin_caller())', t);
    EXECUTE format('CREATE POLICY ref_admin_delete ON %I FOR DELETE USING (is_admin_caller())', t);
  END LOOP;
END $$;

-- Indexes for real query patterns (player-scoped history/lookup), not a
-- blanket index on every FK — most FKs point at tiny reference tables
-- (item_catalog ~35 rows, currencies 8, reward_sources 18) where an index
-- on the referencing column gives negligible benefit at this scale.
CREATE INDEX market_listings_buyer_idx ON market_listings (buyer_id);
CREATE INDEX market_transactions_buyer_idx ON market_transactions (buyer_id);
CREATE INDEX market_transactions_seller_idx ON market_transactions (seller_id);
CREATE INDEX gifts_sender_idx ON gifts (sender_id);
CREATE INDEX trade_items_owner_idx ON trade_items (owner_id);
CREATE INDEX trade_logs_sender_idx ON trade_logs (sender_id);
CREATE INDEX trade_logs_receiver_idx ON trade_logs (receiver_id);
CREATE INDEX admin_item_grants_admin_idx ON admin_item_grants (admin_id);
CREATE INDEX security_events_player_idx ON security_events (player_id);

-- ═══════════════════════════════════════════════════════════════════════
-- Critical fix found while re-testing after the above: Step 10's
-- `CREATE OR REPLACE FUNCTION reward_grant(..., p_target_player bigint
-- DEFAULT NULL)` did NOT replace the Step 5/7 8-parameter version — adding
-- a new parameter changes the signature enough that Postgres created a
-- SECOND overload instead. This made every call with the original 4-8 arg
-- shapes ambiguous ("function reward_grant(...) is not unique"), breaking
-- shop_purchase/coupon_redeem/admin_grant_item and the Reward Engine
-- itself for any caller not specifying all 9 params. The security advisor
-- pass above had actually already surfaced this ("reward_grant — two
-- overloads flagged") but it wasn't recognized as a live bug until a
-- fresh rollback test hit the ambiguity error directly.
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION reward_grant(text, jsonb, jsonb, jsonb, text, text, text, text);
