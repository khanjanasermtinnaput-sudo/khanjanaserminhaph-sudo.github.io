-- ============================================================================
-- Fix: tournaments / tournament_matches had an "allow all" RLS policy
-- (qual: true, with_check: true, role: public) covering ALL commands
-- (SELECT/INSERT/UPDATE/DELETE) — confirmed live-exploitable: any client
-- holding only the public anon/publishable key (no admin, no session token
-- required) could INSERT/UPDATE/DELETE arbitrary rows in either table via
-- raw PostgREST, bypassing every tournament RPC's business rules (forge a
-- champion, corrupt bracket state, delete tournaments, etc).
--
-- Audit (2026-08-18) confirmed every legitimate client write path is
-- already either:
--   1) an admin-gated direct PATCH against `tournaments`
--      (runDraw/confirmDraw in js/tournament.js, both start with
--      `if (!isAdminUser()) return;`), or
--   2) a SECURITY DEFINER RPC (rpc_tournament_create,
--      rpc_tournament_register, rpc_tournament_submit_group_result,
--      rpc_tournament_generate_knockout, rpc_tournament_submit_knockout_result,
--      rpc_tournament_correct_knockout_result, rpc_tournament_delete, ...) —
--      these run with the function owner's privileges and are NOT subject
--      to RLS regardless of the policy on the underlying table, so locking
--      down direct-client RLS does not affect them.
-- `dbCompleteTournament` (old direct-PATCH helper) has zero callers — dead
-- code, unaffected.
--
-- So: replacing "allow all" with an admin-gated write policy (the same
-- pattern already used for `matches`) closes the hole with no functional
-- regression for the current codebase.
-- ============================================================================

drop policy if exists "allow all" on public.tournaments;
drop policy if exists "allow all" on public.tournament_matches;

-- tournaments: anyone can read; only admins (or SECURITY DEFINER RPCs, which
-- bypass RLS entirely) can write directly.
create policy "tournaments_read" on public.tournaments
  for select using (true);
create policy "tournaments_insert_admin" on public.tournaments
  for insert with check (is_admin_caller());
create policy "tournaments_update_admin" on public.tournaments
  for update using (is_admin_caller());
create policy "tournaments_delete_admin" on public.tournaments
  for delete using (is_admin_caller());

-- tournament_matches: anyone can read; all real writes go through
-- SECURITY DEFINER RPCs (which bypass RLS), so direct client writes are
-- admin-only here too (no known legitimate direct-write caller at all).
create policy "tournament_matches_read" on public.tournament_matches
  for select using (true);
create policy "tournament_matches_insert_admin" on public.tournament_matches
  for insert with check (is_admin_caller());
create policy "tournament_matches_update_admin" on public.tournament_matches
  for update using (is_admin_caller());
create policy "tournament_matches_delete_admin" on public.tournament_matches
  for delete using (is_admin_caller());
