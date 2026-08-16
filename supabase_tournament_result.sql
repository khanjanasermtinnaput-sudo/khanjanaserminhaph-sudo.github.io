-- ============================================================================
-- Tournament System Upgrade — Phase 5: result submission + auto-advancement
-- ============================================================================
-- rpc_tournament_submit_result(p_tournament_id, p_match_id, p_games,
-- p_winner_side, p_idempotency_key): admin-only. The winner is ALWAYS
-- recomputed server-side from p_games using the same rule as the existing
-- Referee UI (21 points win-by-2, hard cap at 30 where only 30-29 is valid,
-- best-of-3 only for tier='Super 1000' else single game decides) — the
-- client's p_winner_side is only a sanity cross-check (winner_mismatch if it
-- disagrees), never the source of truth.
--
-- Idempotent: if the match is already completed and the same
-- submit_idempotency_key is replayed, returns the existing row unchanged
-- instead of erroring or re-applying (safe retry on a flaky connection).
--
-- Auto-advancement: locks the match, then (if it has one) locks its
-- next_match_id row before writing the winner into the correct slot —
-- next_match_id/next_match_slot are set once at bracket-generation time and
-- never change afterward, so there is no lock-ordering cycle between two
-- sibling matches racing to complete into the same downstream match; each
-- transaction only ever locks its own row then its single downstream row.
--
-- Final match: auto-derives the champion (no manual admin dropdown for this
-- format) and writes a _hof sentinel matching the EXISTING round-robin shape
-- (champion_ids/champion_name/runner_up_name/third_place_name/tier/
-- match_type/ended_at) plus runner_up_id/third_place_ids that the round-robin
-- shape lacks but a later reward-granting RPC needs — so completed
-- single_elimination tournaments show up correctly in the existing Hall of
-- Fame browser for free. Third place = both semifinal losers jointly (no
-- bronze-medal match in this bracket format).
-- ============================================================================

create or replace function rpc_tournament_submit_result(
  p_tournament_id bigint,
  p_match_id bigint,
  p_games jsonb,
  p_winner_side text default null,
  p_idempotency_key text default null
) returns tournament_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_m tournament_matches%rowtype;
  v_need int;
  v_wa int := 0;
  v_wb int := 0;
  v_i int;
  v_g jsonb;
  v_a int;
  v_b int;
  v_hi int;
  v_lo int;
  v_winner_id bigint;
  v_target tournament_matches%rowtype;
  v_hof jsonb;
  v_runnerup_id bigint;
  v_sf_losers bigint[];
  v_match_type text;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if v_t.format <> 'single_elimination' then raise exception 'wrong_format'; end if;

  select * into v_m from tournament_matches where id = p_match_id and tournament_id = p_tournament_id for update;
  if not found then raise exception 'match_not_found'; end if;

  if v_m.status = 'completed' then
    if p_idempotency_key is not null and v_m.submit_idempotency_key = p_idempotency_key then
      return v_m;
    end if;
    raise exception 'match_already_completed';
  end if;
  if v_m.status <> 'ready' then raise exception 'match_not_ready'; end if;

  v_need := case when v_t.tier = 'Super 1000' then 2 else 1 end;

  if p_games is null or jsonb_array_length(p_games) < 1 then raise exception 'invalid_games'; end if;
  for v_i in 0 .. jsonb_array_length(p_games) - 1 loop
    v_g := p_games -> v_i;
    v_a := (v_g->>'a')::int;
    v_b := (v_g->>'b')::int;
    if v_a is null or v_b is null or v_a = v_b or v_a < 0 or v_b < 0 then raise exception 'invalid_games'; end if;
    v_hi := greatest(v_a, v_b);
    v_lo := least(v_a, v_b);
    if v_hi = 30 then
      if v_lo <> 29 then raise exception 'invalid_games'; end if;
    elsif v_hi < 21 or v_hi - v_lo < 2 then
      raise exception 'invalid_games';
    end if;
    if v_a > v_b then v_wa := v_wa + 1; else v_wb := v_wb + 1; end if;
  end loop;

  if v_wa < v_need and v_wb < v_need then raise exception 'match_incomplete'; end if;
  if v_wa >= v_need and v_wb >= v_need then raise exception 'invalid_games'; end if;

  v_winner_id := case when v_wa >= v_need then v_m.player_a else v_m.player_b end;

  if p_winner_side is not null then
    if p_winner_side not in ('a','b') then raise exception 'invalid_winner_side'; end if;
    if (p_winner_side = 'a' and v_winner_id <> v_m.player_a)
       or (p_winner_side = 'b' and v_winner_id <> v_m.player_b) then
      raise exception 'winner_mismatch';
    end if;
  end if;

  update tournament_matches
  set score_a = v_wa, score_b = v_wb, winner_id = v_winner_id, games = p_games,
      status = 'completed', played_at = now(), submit_idempotency_key = p_idempotency_key
  where id = p_match_id
  returning * into v_m;

  if v_m.next_match_id is not null then
    perform 1 from tournament_matches where id = v_m.next_match_id for update;
    if v_m.next_match_slot = 'a' then
      update tournament_matches set player_a = v_winner_id where id = v_m.next_match_id returning * into v_target;
    else
      update tournament_matches set player_b = v_winner_id where id = v_m.next_match_id returning * into v_target;
    end if;
    if v_target.player_a is not null and v_target.player_b is not null and v_target.status = 'pending' then
      update tournament_matches set status = 'ready' where id = v_target.id;
    end if;
  else
    -- this was the Final: auto-derive the champion and close out the tournament
    select array_agg(loser) into v_sf_losers
    from (
      select case when winner_id = player_a then player_b else player_a end as loser
      from tournament_matches
      where tournament_id = p_tournament_id and round_name = 'SF' and status = 'completed'
    ) s;

    v_runnerup_id := case when v_winner_id = v_m.player_a then v_m.player_b else v_m.player_a end;

    select (elem->>'matchType') into v_match_type
    from jsonb_array_elements(v_t.groups) elem
    where (elem->>'_meta')::boolean is true
    limit 1;

    v_hof := jsonb_build_object(
      '_hof', true,
      'champion_ids', jsonb_build_array(v_winner_id),
      'champion_name', (select name from players where id = v_winner_id),
      'runner_up_id', v_runnerup_id,
      'runner_up_name', (select name from players where id = v_runnerup_id),
      'third_place_ids', to_jsonb(coalesce(v_sf_losers, '{}'::bigint[])),
      'third_place_name', (
        select string_agg(name, ' / ') from players where id = any(coalesce(v_sf_losers, '{}'::bigint[]))
      ),
      'tier', v_t.tier,
      'match_type', coalesce(v_match_type, '1v1'),
      'ended_at', now()
    );

    update tournaments
    set status = 'completed',
        groups = (
          select coalesce(jsonb_agg(elem), '[]'::jsonb) || jsonb_build_array(v_hof)
          from jsonb_array_elements(v_t.groups) elem
          where not coalesce((elem->>'_hof')::boolean, false)
        )
    where id = p_tournament_id;
  end if;

  return v_m;
end;
$$;

grant execute on function public.rpc_tournament_submit_result(bigint, bigint, jsonb, text, text) to anon, authenticated;
