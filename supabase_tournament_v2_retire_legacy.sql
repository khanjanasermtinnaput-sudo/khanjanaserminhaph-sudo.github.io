-- ============================================================================
-- Tournament V2 Phase 8 — retire the superseded legacy RPCs
-- ============================================================================
-- NOT YET APPLIED. This file is ready to run but was deliberately held back:
-- as of 2026-08-25 there is one real, still-open legacy tournament in
-- production ("Gay", id 58, Super 500, created 2026-08-16) with a real player
-- registered into a slot and zero matches played. Revoking these RPCs now
-- would permanently break that player's ability to register, withdraw, or
-- play through the pre-V2 UI (js/tournament.js, js/tournament-knockout.js),
-- which is still live and still reachable via renderLegacyTournamentTab().
--
-- Run this once tournament 58 (or any other legacy tournament that appears
-- before this migration runs) has been completed, cancelled, or migrated —
-- i.e. once `select id from tournaments where structure is null and status <>
-- 'completed'` returns no rows.
--
-- This REVOKES only; it does not DROP. Revoking first (rather than dropping)
-- means the entire operation is reversible with a single GRANT statement — no
-- function body is destroyed, so there is nothing to reconstruct if this
-- needs to be undone.
--
-- rpc_tournament_submit_group_result is the priority among these seven: it is
-- callable by ANY authenticated session (not just admins) and performs no
-- score validation at all — the exact hole rpc_submit_match_result /
-- fn_v2_validate_games closes for V2 events. It stays open only because
-- tournament 58 still depends on it.
-- ============================================================================

-- Signatures confirmed against production on 2026-08-25 via
-- pg_get_function_identity_arguments before writing this file.
revoke execute on function public.rpc_tournament_register(bigint, text, int, int, bigint)
  from anon, authenticated;
revoke execute on function public.rpc_tournament_unregister(bigint)
  from anon, authenticated;
revoke execute on function public.rpc_tournament_submit_group_result(bigint, text, bigint, bigint, int, int, bigint)
  from anon, authenticated;
revoke execute on function public.rpc_tournament_generate_knockout(bigint, jsonb)
  from anon, authenticated;
revoke execute on function public.rpc_tournament_submit_knockout_result(bigint, bigint, jsonb, text, text)
  from anon, authenticated;
revoke execute on function public.rpc_tournament_correct_knockout_result(bigint, bigint, jsonb, text, text)
  from anon, authenticated;
revoke execute on function public.rpc_tournament_complete_single_group(bigint, bigint)
  from anon, authenticated;

-- ============================================================================
-- ROLLBACK — restores every legacy tournament flow immediately, no data loss
-- ============================================================================
--   grant execute on function public.rpc_tournament_register(bigint, text, int, int, bigint) to anon, authenticated;
--   grant execute on function public.rpc_tournament_unregister(bigint) to anon, authenticated;
--   grant execute on function public.rpc_tournament_submit_group_result(bigint, text, bigint, bigint, int, int, bigint) to anon, authenticated;
--   grant execute on function public.rpc_tournament_generate_knockout(bigint, jsonb) to anon, authenticated;
--   grant execute on function public.rpc_tournament_submit_knockout_result(bigint, bigint, jsonb, text, text) to anon, authenticated;
--   grant execute on function public.rpc_tournament_correct_knockout_result(bigint, bigint, jsonb, text, text) to anon, authenticated;
--   grant execute on function public.rpc_tournament_complete_single_group(bigint, bigint) to anon, authenticated;
-- ============================================================================
