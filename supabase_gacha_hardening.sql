-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 3.5 — Backend hardening (realtime, indexes, advisors pass)
-- Applied via Supabase MCP apply_migration (migrations: p3_step5_realtime,
-- p3_step5_fk_indexes). Last step before touching the live client (P3.6).
--
-- Confirmed zero overload duplicates across all 11 Phase 3 functions
-- (rpc_gacha_pull_v2, 9 admin_* RPCs, gacha_analytics) before this step —
-- the reward_grant/rpc_gacha_pull_v2 overload lesson applied proactively.
--
-- Ran get_advisors (security + performance) scoped to every new/modified
-- gacha object. Performance: fixed 2 real unindexed-FK findings on
-- gacha_history (currency_id, reward_transaction_id) plus gacha_pools
-- (currency_id) for consistency; everything else was either pre-existing
-- (Phase 1B/2 objects, not touched here) or an expected "unused index"
-- notice on indexes just created with no traffic yet. Security: all 22
-- findings on the 11 new functions are the same already-accepted
-- SECURITY DEFINER/session_uid()-gated pattern every RPC in this app has
-- — explicitly verified nothing else (no missing RLS, no overly-permissive
-- policy, no mutable search_path) touches any of the 5 new tables or 11
-- new functions.
-- ═══════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE gacha_history;

CREATE INDEX gacha_history_currency_idx ON gacha_history (currency_id);
CREATE INDEX gacha_history_reward_txn_idx ON gacha_history (reward_transaction_id);
CREATE INDEX gacha_pools_currency_idx ON gacha_pools (currency_id);
