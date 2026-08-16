-- ============================================================================
-- Tournament System Upgrade — Phase 7 (partial): migrate remaining
-- round_robin_groups writes off raw client PostgREST calls onto RPCs
-- ============================================================================
-- rpc_tournament_submit_group_result: replaces dbAddTournamentMatch's raw,
-- unauthenticated POST. Requires only a valid session (not admin) — this
-- deliberately PRESERVES today's existing behavior where any logged-in
-- player can open the Referee modal and record a round-robin group result
-- (unlike the admin-only rpc_tournament_submit_result for the higher-stakes
-- single_elimination format). Adds a basic sanity check (winner must be one
-- of the two players, and must have the strictly higher score) that the raw
-- POST never had, without re-implementing the full 21-point/best-of-3 rule
-- set server-side in this pass (the existing Referee UI already enforces
-- that client-side before calling this).
--
-- rpc_tournament_delete: replaces dbDeleteTournament's raw DELETE calls
-- (used by cancel-tournament and the Hall of Fame delete flows), admin-only.
--
-- Both dbAddTournamentMatch/dbDeleteTournament in tournament.js keep their
-- exact existing names/signatures/no-meaningful-return-value contract, so
-- this migration only changes their IMPLEMENTATION — every call site
-- (_refFinish, confirmCancelTournament, the HoF delete flow) is untouched.
--
-- NOT included in this pass: migrating executeDeclareChampion's reward
-- payout (coins/ELO/achievements/mail — a large, intricate, currently-
-- working client-side sequence) onto a server-authoritative RPC, or
-- replacing the tournaments/tournament_matches "allow all" RLS policy.
-- Flipping RLS closed requires EVERY remaining write path to have an RPC
-- replacement first (including that reward payout and the draw-lock
-- _patchTournamentConfig call in runDraw/confirmDraw) — attempting that in
-- the same pass as this migration, without the ability to do live browser
-- regression testing in this environment, would risk breaking currently-
-- working tournament features. Both gaps are called out explicitly in the
-- final report rather than silently left undone.
-- ============================================================================

create or replace function rpc_tournament_submit_group_result(
  p_tournament_id bigint,
  p_group_letter text,
  p_player_a bigint,
  p_player_b bigint,
  p_score_a int,
  p_score_b int,
  p_winner_id bigint
) returns tournament_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid bigint;
  v_t tournaments%rowtype;
  v_row tournament_matches;
begin
  v_uid := session_uid();
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_t from tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament_not_found'; end if;
  if v_t.format <> 'round_robin_groups' then raise exception 'wrong_format'; end if;
  if v_t.status <> 'active' then raise exception 'tournament_not_active'; end if;

  if p_player_a is null or p_player_b is null or p_player_a = p_player_b then raise exception 'invalid_players'; end if;
  if p_winner_id is null or (p_winner_id <> p_player_a and p_winner_id <> p_player_b) then raise exception 'invalid_winner'; end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then raise exception 'invalid_score'; end if;
  if (p_winner_id = p_player_a and p_score_a <= p_score_b) or (p_winner_id = p_player_b and p_score_b <= p_score_a) then
    raise exception 'score_winner_mismatch';
  end if;

  insert into tournament_matches (tournament_id, group_letter, player_a, player_b, score_a, score_b, winner_id, status, played_at)
  values (p_tournament_id, p_group_letter, p_player_a, p_player_b, p_score_a, p_score_b, p_winner_id, 'completed', now())
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.rpc_tournament_submit_group_result(bigint, text, bigint, bigint, int, int, bigint) to anon, authenticated;


create or replace function rpc_tournament_delete(p_tournament_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;
  delete from tournament_matches where tournament_id = p_tournament_id;
  delete from tournaments where id = p_tournament_id;
end;
$$;

grant execute on function public.rpc_tournament_delete(bigint) to anon, authenticated;
