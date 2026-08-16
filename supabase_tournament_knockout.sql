-- ============================================================================
-- Retire Single Elimination — Phase 1: generalized round-robin knockout RPCs
-- ============================================================================
-- Reuses the bracket-tree columns/bye-safe seeding algorithm/atomic auto-
-- advance pattern originally built for the (retired) single_elimination
-- format, repointed at the EXISTING round-robin tournament's knockout stage.
-- Entrants for the knockout bracket are each group's WINNER, not a flat
-- registered-player list.
--
-- Trust boundary (explicit, not silently accepted): which player/team is a
-- group's "winner" is still computed client-side (calculateGroupStandings'
-- head-to-head tiebreak logic has no SQL port in this pass) and passed in as
-- p_entrants — admin-attested, not server-recomputed. This function only
-- validates that the claimed winner actually belongs to that group and that
-- every match in the group is complete. Mitigated with an audit-log entry
-- (log_admin_action) of the full attested payload at generation time, so a
-- wrong bracket is traceable/correctable, not silent. Group cap: 16 (well
-- inside the existing 5-row round-name lookup table's range).
--
-- This migration is purely additive — nothing existing is dropped yet. The
-- old single_elimination-only rpc_tournament_generate_bracket/
-- rpc_tournament_submit_result stay in place (dead but harmless) until a
-- later phase confirms the new path works and no real SE tournament exists.
-- ============================================================================

create or replace function rpc_tournament_generate_knockout(
  p_tournament_id bigint,
  p_entrants jsonb
) returns setof tournament_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_groups jsonb;
  v_n int;
  v_size int := 1;
  v_rounds int := 0;
  v_s int;
  v_real bigint[];
  v_byes int;
  v_bye_match_idx int[];
  v_real_ptr int;
  v_round_labels text[];
  v_cur_ids bigint[];
  v_prev_ids bigint[];
  v_count int;
  v_i int;
  v_r int;
  v_a bigint;
  v_b bigint;
  v_mid bigint;
  v_winner bigint;
  v_target_id bigint;
  v_slot text;
  v_prev_winner bigint;
  v_entry jsonb;
  v_group_letter text;
  v_winner_id bigint;
  v_group_elem jsonb;
  v_group_match_count int;
  v_group_completed_count int;
  v_group_size int;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if exists (select 1 from tournament_matches where tournament_id = p_tournament_id and round_index is not null) then
    raise exception 'knockout_already_generated';
  end if;

  v_groups := coalesce(v_t.groups, '[]'::jsonb);
  v_n := jsonb_array_length(coalesce(p_entrants, '[]'::jsonb));
  if v_n < 2 or v_n > 16 then raise exception 'invalid_group_count'; end if;

  for v_i in 0 .. v_n - 1 loop
    v_entry := p_entrants -> v_i;
    v_group_letter := v_entry ->> 'group';
    v_winner_id := (v_entry ->> 'winnerId')::bigint;
    if v_group_letter is null or v_winner_id is null then raise exception 'invalid_entrant_entry'; end if;

    select elem into v_group_elem from jsonb_array_elements(v_groups) elem
      where elem->>'letter' = v_group_letter limit 1;
    if v_group_elem is null then raise exception 'invalid_group'; end if;

    if not (
      (v_group_elem ? 'playerIds' and v_group_elem->'playerIds' @> to_jsonb(v_winner_id))
      or exists (
        select 1 from jsonb_array_elements(coalesce(v_group_elem->'teams','[]'::jsonb)) t
        where (t->'playerIds'->>0)::bigint = v_winner_id
      )
    ) then
      raise exception 'winner_not_in_group';
    end if;

    if v_group_elem ? 'teams' then
      select jsonb_array_length(v_group_elem->'teams') into v_group_size;
    else
      select jsonb_array_length(v_group_elem->'playerIds') into v_group_size;
    end if;
    v_group_match_count := v_group_size * (v_group_size - 1) / 2;
    select count(*) into v_group_completed_count from tournament_matches
      where tournament_id = p_tournament_id and group_letter = v_group_letter
        and status = 'completed' and round_index is null;
    if v_group_completed_count < v_group_match_count then
      raise exception 'group_incomplete';
    end if;
  end loop;

  perform log_admin_action('tournament_generate_knockout', 'tournaments', p_tournament_id::text, null, p_entrants);

  v_size := 1;
  while v_size < v_n loop v_size := v_size * 2; end loop;

  v_s := v_size; v_rounds := 0;
  while v_s > 1 loop v_s := v_s / 2; v_rounds := v_rounds + 1; end loop;

  v_round_labels := case v_rounds
    when 1 then array['F']
    when 2 then array['SF','F']
    when 3 then array['QF','SF','F']
    when 4 then array['R16','QF','SF','F']
    when 5 then array['R32','R16','QF','SF','F']
    else array['F']
  end;

  select array_agg((elem->>'winnerId')::bigint order by random()) into v_real
  from jsonb_array_elements(p_entrants) elem;

  v_count := v_size / 2;
  v_byes := v_size - v_n;

  select coalesce(array_agg(idx), '{}') into v_bye_match_idx
  from (select gs as idx from generate_series(0, v_count - 1) gs order by random() limit v_byes) s;

  v_real_ptr := 1;
  v_cur_ids := '{}';
  for v_i in 0 .. v_count - 1 loop
    if v_i = any(v_bye_match_idx) then
      if random() < 0.5 then
        v_a := v_real[v_real_ptr]; v_b := null;
      else
        v_a := null; v_b := v_real[v_real_ptr];
      end if;
      v_real_ptr := v_real_ptr + 1;
    else
      v_a := v_real[v_real_ptr];
      v_b := v_real[v_real_ptr + 1];
      v_real_ptr := v_real_ptr + 2;
    end if;

    v_winner := case when v_a is null then v_b when v_b is null then v_a else null end;
    insert into tournament_matches
      (tournament_id, group_letter, player_a, player_b, winner_id, round_index, round_name,
       bracket_slot, seed_a, seed_b, is_bye, status, games)
    values
      (p_tournament_id, null, v_a, v_b, v_winner, 0, v_round_labels[1],
       'K0-' || v_i, v_i*2+1, v_i*2+2, (v_winner is not null),
       case when v_winner is not null then 'bye' else 'ready' end, '[]'::jsonb)
    returning id into v_mid;
    v_cur_ids := v_cur_ids || v_mid;
  end loop;

  v_prev_ids := v_cur_ids;

  for v_r in 1 .. v_rounds - 1 loop
    v_count := v_count / 2;
    v_cur_ids := '{}';
    for v_i in 0 .. v_count - 1 loop
      insert into tournament_matches
        (tournament_id, group_letter, round_index, round_name, bracket_slot, status, games)
      values
        (p_tournament_id, null, v_r, v_round_labels[v_r+1], 'K'||v_r||'-'||v_i, 'pending', '[]'::jsonb)
      returning id into v_mid;
      v_cur_ids := v_cur_ids || v_mid;
    end loop;

    for v_i in 0 .. array_length(v_prev_ids,1) - 1 loop
      v_mid := v_prev_ids[v_i+1];
      v_target_id := v_cur_ids[(v_i/2)+1];
      v_slot := case when v_i % 2 = 0 then 'a' else 'b' end;

      update tournament_matches set next_match_id = v_target_id, next_match_slot = v_slot
      where id = v_mid;

      select winner_id into v_prev_winner from tournament_matches where id = v_mid;
      if v_prev_winner is not null then
        if v_slot = 'a' then
          update tournament_matches set player_a = v_prev_winner where id = v_target_id;
        else
          update tournament_matches set player_b = v_prev_winner where id = v_target_id;
        end if;
      end if;
    end loop;

    update tournament_matches
    set status = 'ready'
    where id = any(v_cur_ids) and player_a is not null and player_b is not null and status = 'pending';

    v_prev_ids := v_cur_ids;
  end loop;

  return query select * from tournament_matches
    where tournament_id = p_tournament_id and round_index is not null
    order by round_index, bracket_slot;
end;
$$;

grant execute on function public.rpc_tournament_generate_knockout(bigint, jsonb) to anon, authenticated;


-- ============================================================================
-- rpc_tournament_submit_knockout_result: repurpose of rpc_tournament_submit_result
-- (SE format) minus the format check, plus a round_index guard so it can't be
-- called on a group-stage row by mistake. Becomes the permanent knockout
-- completion path — auto-derives champion on the Final, no manual dropdown.
-- ============================================================================

create or replace function rpc_tournament_submit_knockout_result(
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

  select * into v_m from tournament_matches where id = p_match_id and tournament_id = p_tournament_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.round_index is null then raise exception 'not_a_knockout_match'; end if;

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

grant execute on function public.rpc_tournament_submit_knockout_result(bigint, bigint, jsonb, text, text) to anon, authenticated;


-- ============================================================================
-- rpc_tournament_complete_single_group: the no-knockout-possible edge case
-- (exactly 1 real group). Same admin-attested-winner trust boundary as
-- generate_knockout. Writes the same _hof shape.
-- ============================================================================

create or replace function rpc_tournament_complete_single_group(
  p_tournament_id bigint,
  p_winner_id bigint
) returns tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_groups jsonb;
  v_group_elem jsonb;
  v_letter text;
  v_real_group_count int;
  v_group_size int;
  v_group_match_count int;
  v_group_completed_count int;
  v_hof jsonb;
  v_match_type text;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if v_t.status <> 'active' then raise exception 'tournament_not_active'; end if;

  v_groups := coalesce(v_t.groups, '[]'::jsonb);

  select count(*) into v_real_group_count from jsonb_array_elements(v_groups) elem
    where not coalesce((elem->>'_meta')::boolean,false)
      and not coalesce((elem->>'_config')::boolean,false)
      and not coalesce((elem->>'_hof')::boolean,false);
  if v_real_group_count <> 1 then raise exception 'not_single_group'; end if;

  select elem, elem->>'letter' into v_group_elem, v_letter from jsonb_array_elements(v_groups) elem
    where not coalesce((elem->>'_meta')::boolean,false)
      and not coalesce((elem->>'_config')::boolean,false)
      and not coalesce((elem->>'_hof')::boolean,false)
    limit 1;

  if not (
    (v_group_elem ? 'playerIds' and v_group_elem->'playerIds' @> to_jsonb(p_winner_id))
    or exists (select 1 from jsonb_array_elements(coalesce(v_group_elem->'teams','[]'::jsonb)) t
               where (t->'playerIds'->>0)::bigint = p_winner_id)
  ) then
    raise exception 'winner_not_in_group';
  end if;

  if v_group_elem ? 'teams' then
    select jsonb_array_length(v_group_elem->'teams') into v_group_size;
  else
    select jsonb_array_length(v_group_elem->'playerIds') into v_group_size;
  end if;
  v_group_match_count := v_group_size * (v_group_size - 1) / 2;
  select count(*) into v_group_completed_count from tournament_matches
    where tournament_id = p_tournament_id and group_letter = v_letter
      and status = 'completed' and round_index is null;
  if v_group_completed_count < v_group_match_count then raise exception 'group_incomplete'; end if;

  perform log_admin_action('tournament_complete_single_group', 'tournaments', p_tournament_id::text, null,
    jsonb_build_object('winnerId', p_winner_id));

  select (elem->>'matchType') into v_match_type from jsonb_array_elements(v_groups) elem
    where (elem->>'_meta')::boolean is true limit 1;

  v_hof := jsonb_build_object(
    '_hof', true,
    'champion_ids', jsonb_build_array(p_winner_id),
    'champion_name', (select name from players where id = p_winner_id),
    'runner_up_id', null,
    'runner_up_name', null,
    'third_place_ids', '[]'::jsonb,
    'third_place_name', null,
    'tier', v_t.tier,
    'match_type', coalesce(v_match_type, '1v1'),
    'ended_at', now()
  );

  update tournaments set status = 'completed', groups = (
    select coalesce(jsonb_agg(elem), '[]'::jsonb) || jsonb_build_array(v_hof)
    from jsonb_array_elements(v_groups) elem
    where not coalesce((elem->>'_hof')::boolean, false)
  ) where id = p_tournament_id
  returning * into v_t;

  return v_t;
end;
$$;

grant execute on function public.rpc_tournament_complete_single_group(bigint, bigint) to anon, authenticated;


-- ============================================================================
-- rpc_tournament_correct_knockout_result: admin safety-net now that champion
-- declaration is fully automatic (no manual dropdown to fall back on). Can
-- only correct a match whose downstream isn't already completed, and can't
-- correct a Final once real rewards have already been paid out (claw-back is
-- out of scope) — both are hard blocks, not soft warnings.
-- ============================================================================

create or replace function rpc_tournament_correct_knockout_result(
  p_tournament_id bigint,
  p_match_id bigint,
  p_games jsonb,
  p_winner_side text,
  p_reason text
) returns tournament_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_m tournament_matches%rowtype;
  v_next tournament_matches%rowtype;
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
  v_reward_count int;
  v_sf_losers bigint[];
  v_runnerup_id bigint;
  v_match_type text;
  v_hof jsonb;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'reason_required'; end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;

  select * into v_m from tournament_matches where id = p_match_id and tournament_id = p_tournament_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.round_index is null then raise exception 'not_a_knockout_match'; end if;
  if v_m.status <> 'completed' then raise exception 'match_not_completed'; end if;

  if v_m.next_match_id is not null then
    select * into v_next from tournament_matches where id = v_m.next_match_id for update;
    if v_next.status = 'completed' then
      raise exception 'downstream_already_completed_cannot_correct';
    end if;
  else
    if v_t.status = 'completed' then
      select count(*) into v_reward_count from reward_transactions
        where metadata->>'tournament_id' = p_tournament_id::text;
      if v_reward_count > 0 then
        raise exception 'rewards_already_granted_cannot_correct';
      end if;
    end if;
  end if;

  v_need := case when v_t.tier = 'Super 1000' then 2 else 1 end;
  if p_games is null or jsonb_array_length(p_games) < 1 then raise exception 'invalid_games'; end if;
  for v_i in 0 .. jsonb_array_length(p_games) - 1 loop
    v_g := p_games -> v_i;
    v_a := (v_g->>'a')::int; v_b := (v_g->>'b')::int;
    if v_a is null or v_b is null or v_a = v_b or v_a < 0 or v_b < 0 then raise exception 'invalid_games'; end if;
    v_hi := greatest(v_a, v_b); v_lo := least(v_a, v_b);
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
    if (p_winner_side = 'a' and v_winner_id <> v_m.player_a) or (p_winner_side = 'b' and v_winner_id <> v_m.player_b) then
      raise exception 'winner_mismatch';
    end if;
  end if;

  perform log_admin_action('tournament_correct_knockout_result', 'tournament_matches', p_match_id::text,
    to_jsonb(v_m), jsonb_build_object('games', p_games, 'winner_id', v_winner_id, 'reason', p_reason));

  update tournament_matches
  set score_a = v_wa, score_b = v_wb, winner_id = v_winner_id, games = p_games, played_at = now()
  where id = p_match_id
  returning * into v_m;

  if v_m.next_match_id is not null then
    if v_m.next_match_slot = 'a' then
      update tournament_matches set player_a = v_winner_id where id = v_m.next_match_id returning * into v_next;
    else
      update tournament_matches set player_b = v_winner_id where id = v_m.next_match_id returning * into v_next;
    end if;
    if v_next.player_a is not null and v_next.player_b is not null and v_next.status = 'pending' then
      update tournament_matches set status = 'ready' where id = v_next.id;
    end if;
  else
    select array_agg(loser) into v_sf_losers
    from (
      select case when winner_id = player_a then player_b else player_a end as loser
      from tournament_matches
      where tournament_id = p_tournament_id and round_name = 'SF' and status = 'completed'
    ) s;
    v_runnerup_id := case when v_winner_id = v_m.player_a then v_m.player_b else v_m.player_a end;
    select (elem->>'matchType') into v_match_type from jsonb_array_elements(v_t.groups) elem
      where (elem->>'_meta')::boolean is true limit 1;
    v_hof := jsonb_build_object(
      '_hof', true, 'champion_ids', jsonb_build_array(v_winner_id),
      'champion_name', (select name from players where id = v_winner_id),
      'runner_up_id', v_runnerup_id, 'runner_up_name', (select name from players where id = v_runnerup_id),
      'third_place_ids', to_jsonb(coalesce(v_sf_losers, '{}'::bigint[])),
      'third_place_name', (select string_agg(name, ' / ') from players where id = any(coalesce(v_sf_losers, '{}'::bigint[]))),
      'tier', v_t.tier, 'match_type', coalesce(v_match_type, '1v1'), 'ended_at', now()
    );
    update tournaments set status = 'completed', groups = (
      select coalesce(jsonb_agg(elem), '[]'::jsonb) || jsonb_build_array(v_hof)
      from jsonb_array_elements(v_t.groups) elem where not coalesce((elem->>'_hof')::boolean, false)
    ) where id = p_tournament_id;
  end if;

  return v_m;
end;
$$;

grant execute on function public.rpc_tournament_correct_knockout_result(bigint, bigint, jsonb, text, text) to anon, authenticated;


-- ============================================================================
-- rpc_tournament_grant_rewards: CREATE OR REPLACE — drop the SE-only format
-- check, replace the _config.entrants doubles-partner lookup with a scan of
-- each real group's teams[] array (mirrors getTeamByAnchor's JS logic).
-- Percentage model is UNCHANGED (it already applied one pct to both coins
-- and ELO — champion 100% implicit, runnerup/thirdplace/participant pct
-- shared across both currencies).
-- ============================================================================

create or replace function rpc_tournament_grant_rewards(p_tournament_id bigint)
returns table(player_id bigint, role text, coins_granted int, elo_granted int, already_granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_hof jsonb;
  v_groups jsonb;
  v_tier tournament_reward_tiers%rowtype;
  v_overrides jsonb;
  v_champion_coins int;
  v_champion_elo int;
  v_runnerup_pct numeric;
  v_thirdplace_pct numeric;
  v_participant_pct numeric;
  v_champion_anchors bigint[];
  v_runnerup_anchor bigint;
  v_thirdplace_anchors bigint[];
  v_all_entrant_ids bigint[];
  v_placed_ids bigint[] := '{}';
  v_anchor bigint;
  v_recipient bigint;
  v_partner bigint;
  v_coin_amt int;
  v_elo_amt int;
  v_key text;
  v_existing uuid;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if v_t.status <> 'completed' then raise exception 'tournament_not_completed'; end if;

  v_groups := coalesce(v_t.groups, '[]'::jsonb);

  select elem into v_hof from jsonb_array_elements(v_groups) elem where (elem->>'_hof')::boolean is true limit 1;
  if v_hof is null then raise exception 'missing_hof'; end if;

  select * into v_tier from tournament_reward_tiers where tier = v_t.tier;
  v_overrides := v_t.reward_overrides;
  v_champion_coins := coalesce((v_overrides->>'champion_coins')::int, v_tier.champion_coins, 0);
  v_champion_elo := coalesce((v_overrides->>'champion_elo')::int, v_tier.champion_elo, 0);
  v_runnerup_pct := coalesce((v_overrides->>'runnerup_pct')::numeric, v_tier.runnerup_pct, 0.5);
  v_thirdplace_pct := coalesce((v_overrides->>'thirdplace_pct')::numeric, v_tier.thirdplace_pct, 0.25);
  v_participant_pct := coalesce((v_overrides->>'participant_pct')::numeric, v_tier.participant_pct, 0.2);

  select array_agg((x)::text::bigint) into v_champion_anchors from jsonb_array_elements(coalesce(v_hof->'champion_ids','[]'::jsonb)) x;
  v_runnerup_anchor := (v_hof->>'runner_up_id')::bigint;
  select array_agg((x)::text::bigint) into v_thirdplace_anchors from jsonb_array_elements(coalesce(v_hof->'third_place_ids','[]'::jsonb)) x;

  -- every registered player across every real group: 1v1 groups' flat
  -- playerIds, plus 2v2 groups' teams[].playerIds flattened
  select array_agg(distinct pid) into v_all_entrant_ids
  from (
    select (p)::text::bigint as pid
    from jsonb_array_elements(v_groups) g,
         jsonb_array_elements(coalesce(g->'playerIds','[]'::jsonb)) p
    where not coalesce((g->>'_meta')::boolean,false)
      and not coalesce((g->>'_config')::boolean,false)
      and not coalesce((g->>'_hof')::boolean,false)
    union all
    select (p)::text::bigint as pid
    from jsonb_array_elements(v_groups) g,
         jsonb_array_elements(coalesce(g->'teams','[]'::jsonb)) t,
         jsonb_array_elements(coalesce(t->'playerIds','[]'::jsonb)) p
    where not coalesce((g->>'_meta')::boolean,false)
      and not coalesce((g->>'_config')::boolean,false)
      and not coalesce((g->>'_hof')::boolean,false)
  ) s;

  -- champion
  foreach v_anchor in array coalesce(v_champion_anchors, '{}'::bigint[]) loop
    v_placed_ids := v_placed_ids || v_anchor;
    select (t->'playerIds'->>1)::bigint into v_partner
    from jsonb_array_elements(v_groups) g, jsonb_array_elements(coalesce(g->'teams','[]'::jsonb)) t
    where not coalesce((g->>'_meta')::boolean,false) and not coalesce((g->>'_config')::boolean,false)
      and not coalesce((g->>'_hof')::boolean,false) and (t->'playerIds'->>0)::bigint = v_anchor
    limit 1;
    if v_partner is not null then v_placed_ids := v_placed_ids || v_partner; end if;
    foreach v_recipient in array array_remove(array[v_anchor, v_partner], null) loop
      v_key := 'tournament:' || p_tournament_id || ':champion:' || v_recipient;
      select id into v_existing from reward_transactions where idempotency_key = v_key and reward_transactions.player_id = v_recipient;
      if v_existing is null then
        perform reward_grant('tournament', '[]'::jsonb,
          jsonb_build_array(jsonb_build_object('currency_id','coin','amount',v_champion_coins)),
          jsonb_build_object('tournament_id', p_tournament_id, 'role', 'champion'), v_key,
          null, null, null, v_recipient);
        if v_champion_elo > 0 then update players set pts = pts + v_champion_elo where id = v_recipient; end if;
        return query select v_recipient, 'champion'::text, v_champion_coins, v_champion_elo, false;
      else
        return query select v_recipient, 'champion'::text, 0, 0, true;
      end if;
    end loop;
  end loop;

  -- runner-up
  if v_runnerup_anchor is not null then
    v_placed_ids := v_placed_ids || v_runnerup_anchor;
    select (t->'playerIds'->>1)::bigint into v_partner
    from jsonb_array_elements(v_groups) g, jsonb_array_elements(coalesce(g->'teams','[]'::jsonb)) t
    where not coalesce((g->>'_meta')::boolean,false) and not coalesce((g->>'_config')::boolean,false)
      and not coalesce((g->>'_hof')::boolean,false) and (t->'playerIds'->>0)::bigint = v_runnerup_anchor
    limit 1;
    if v_partner is not null then v_placed_ids := v_placed_ids || v_partner; end if;
    v_coin_amt := floor(v_champion_coins * v_runnerup_pct)::int;
    v_elo_amt := floor(v_champion_elo * v_runnerup_pct)::int;
    foreach v_recipient in array array_remove(array[v_runnerup_anchor, v_partner], null) loop
      v_key := 'tournament:' || p_tournament_id || ':runner_up:' || v_recipient;
      select id into v_existing from reward_transactions where idempotency_key = v_key and reward_transactions.player_id = v_recipient;
      if v_existing is null then
        perform reward_grant('tournament', '[]'::jsonb,
          jsonb_build_array(jsonb_build_object('currency_id','coin','amount',v_coin_amt)),
          jsonb_build_object('tournament_id', p_tournament_id, 'role', 'runner_up'), v_key,
          null, null, null, v_recipient);
        if v_elo_amt > 0 then update players set pts = pts + v_elo_amt where id = v_recipient; end if;
        return query select v_recipient, 'runner_up'::text, v_coin_amt, v_elo_amt, false;
      else
        return query select v_recipient, 'runner_up'::text, 0, 0, true;
      end if;
    end loop;
  end if;

  -- third place (both semifinal losers)
  v_coin_amt := floor(v_champion_coins * v_thirdplace_pct)::int;
  v_elo_amt := floor(v_champion_elo * v_thirdplace_pct)::int;
  foreach v_anchor in array coalesce(v_thirdplace_anchors, '{}'::bigint[]) loop
    v_placed_ids := v_placed_ids || v_anchor;
    select (t->'playerIds'->>1)::bigint into v_partner
    from jsonb_array_elements(v_groups) g, jsonb_array_elements(coalesce(g->'teams','[]'::jsonb)) t
    where not coalesce((g->>'_meta')::boolean,false) and not coalesce((g->>'_config')::boolean,false)
      and not coalesce((g->>'_hof')::boolean,false) and (t->'playerIds'->>0)::bigint = v_anchor
    limit 1;
    if v_partner is not null then v_placed_ids := v_placed_ids || v_partner; end if;
    foreach v_recipient in array array_remove(array[v_anchor, v_partner], null) loop
      v_key := 'tournament:' || p_tournament_id || ':third_place:' || v_recipient;
      select id into v_existing from reward_transactions where idempotency_key = v_key and reward_transactions.player_id = v_recipient;
      if v_existing is null then
        perform reward_grant('tournament', '[]'::jsonb,
          jsonb_build_array(jsonb_build_object('currency_id','coin','amount',v_coin_amt)),
          jsonb_build_object('tournament_id', p_tournament_id, 'role', 'third_place'), v_key,
          null, null, null, v_recipient);
        if v_elo_amt > 0 then update players set pts = pts + v_elo_amt where id = v_recipient; end if;
        return query select v_recipient, 'third_place'::text, v_coin_amt, v_elo_amt, false;
      else
        return query select v_recipient, 'third_place'::text, 0, 0, true;
      end if;
    end loop;
  end loop;

  -- everyone else who registered: participation reward
  v_coin_amt := floor(v_champion_coins * v_participant_pct)::int;
  v_elo_amt := floor(v_champion_elo * v_participant_pct)::int;
  foreach v_recipient in array coalesce(v_all_entrant_ids, '{}'::bigint[]) loop
    if v_recipient = any(v_placed_ids) then continue; end if;
    v_key := 'tournament:' || p_tournament_id || ':participant:' || v_recipient;
    select id into v_existing from reward_transactions where idempotency_key = v_key and reward_transactions.player_id = v_recipient;
    if v_existing is null then
      perform reward_grant('tournament', '[]'::jsonb,
        jsonb_build_array(jsonb_build_object('currency_id','coin','amount',v_coin_amt)),
        jsonb_build_object('tournament_id', p_tournament_id, 'role', 'participant'), v_key,
        null, null, null, v_recipient);
      if v_elo_amt > 0 then update players set pts = pts + v_elo_amt where id = v_recipient; end if;
      return query select v_recipient, 'participant'::text, v_coin_amt, v_elo_amt, false;
    else
      return query select v_recipient, 'participant'::text, 0, 0, true;
    end if;
  end loop;

  return;
end;
$$;

grant execute on function public.rpc_tournament_grant_rewards(bigint) to anon, authenticated;
