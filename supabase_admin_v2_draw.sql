-- Admin V2 Phase 6 — BWF Bracket Editor
-- Applied directly to production (project tprmqsfbeyqurwqpmpia) via Supabase
-- MCP on 2026-08-21. Additive only — rpc_tournament_generate_knockout itself
-- is UNCHANGED (fetched and diffed against before writing this).
--
-- Why a sibling RPC instead of relaxing the existing one: rpc_tournament_
-- generate_knockout requires every entrant to be the winner of a completed
-- round-robin group (`winner_not_in_group` / `group_incomplete` checks) and
-- caps at 16. That is real, working, tested machinery for the
-- round-robin-into-knockout format and changing its validation would risk
-- regressing it. rpc_admin_tournament_generate_draw below reuses the exact
-- same proven bracket-wiring loop (bye placement, next_match_id/
-- next_match_slot construction, round labels) verbatim, but skips the
-- group-membership requirement and accepts 1-32 entrants directly — the
-- "paste a roster, generate a bracket immediately" path the spec asks for,
-- which the original RPC has no path for at all.
--
-- Scope, stated plainly: BYE placement supports 'random' (identical
-- distribution to the original RPC) and 'seeded' (the best `v_byes` seeds —
-- lowest p_seed value — get the round-1 bye, in seed order). 'manual' accepts
-- explicit bye flags per entrant. None of these modes do full seed-separation
-- bracket placement (e.g. "seed 1 and seed 2 never meet before the final") —
-- that is a larger feature deliberately left for later, not silently skipped.

create or replace function rpc_admin_tournament_generate_draw(
  p_tournament_id bigint,
  p_entrants jsonb,          -- [{winnerId: bigint, seed?: int, bye?: boolean}, ...]
  p_bye_placement text default 'random'  -- 'random' | 'seeded' | 'manual'
)
returns setof tournament_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_n int;
  v_size int := 1;
  v_rounds int := 0;
  v_s int;
  v_entries jsonb[];
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
  v_sole_id bigint;
  v_hof jsonb;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if exists (select 1 from tournament_matches where tournament_id = p_tournament_id and round_index is not null) then
    raise exception 'knockout_already_generated';
  end if;
  if p_bye_placement not in ('random', 'seeded', 'manual') then
    raise exception 'invalid_bye_placement';
  end if;

  v_n := jsonb_array_length(coalesce(p_entrants, '[]'::jsonb));
  if v_n < 1 or v_n > 32 then raise exception 'invalid_entrant_count'; end if;

  perform log_admin_action('admin_tournament_generate_draw', 'tournaments', p_tournament_id::text, null,
    jsonb_build_object('entrants', p_entrants, 'bye_placement', p_bye_placement));

  -- ── n = 1: Automatic Qualification, no fake match (spec explicit) ──
  if v_n = 1 then
    v_sole_id := (p_entrants -> 0 ->> 'winnerId')::bigint;
    v_hof := jsonb_build_object(
      '_hof', true, 'champion_ids', jsonb_build_array(v_sole_id),
      'champion_name', (select name from players where id = v_sole_id),
      'runner_up_id', null, 'runner_up_name', null,
      'third_place_ids', '[]'::jsonb, 'third_place_name', null,
      'tier', v_t.tier, 'match_type', '1v1', 'ended_at', now(),
      'auto_qualified', true
    );
    update tournaments set status = 'completed',
      groups = coalesce(v_t.groups, '[]'::jsonb) || jsonb_build_array(v_hof)
      where id = p_tournament_id;
    return;
  end if;

  v_size := 1; while v_size < v_n loop v_size := v_size * 2; end loop;
  v_s := v_size; v_rounds := 0; while v_s > 1 loop v_s := v_s / 2; v_rounds := v_rounds + 1; end loop;

  v_round_labels := case v_rounds
    when 1 then array['F'] when 2 then array['SF','F'] when 3 then array['QF','SF','F']
    when 4 then array['R16','QF','SF','F'] when 5 then array['R32','R16','QF','SF','F']
    else array['F']
  end;

  v_count := v_size / 2;
  v_byes := v_size - v_n;

  -- ── Order entrants (who is "real", i.e. non-bye) per bye_placement mode ──
  if p_bye_placement = 'seeded' then
    select array_agg(elem order by coalesce((elem->>'seed')::int, 999999), ord) into v_entries
      from jsonb_array_elements(p_entrants) with ordinality as t(elem, ord);
  elsif p_bye_placement = 'manual' then
    if (select count(*) from jsonb_array_elements(p_entrants) e where (e->>'bye')::boolean is true) <> v_byes then
      raise exception 'manual_bye_count_mismatch';
    end if;
    select array_agg(elem order by coalesce((elem->>'bye')::boolean, false) desc, ord) into v_entries
      from jsonb_array_elements(p_entrants) with ordinality as t(elem, ord);
  else
    select array_agg(elem order by random()) into v_entries
      from jsonb_array_elements(p_entrants) elem;
  end if;

  select array_agg((e->>'winnerId')::bigint) into v_real from unnest(v_entries) e;

  if p_bye_placement = 'random' then
    select coalesce(array_agg(idx), '{}') into v_bye_match_idx
      from (select gs as idx from generate_series(0, v_count - 1) gs order by random() limit v_byes) s;
  else
    -- seeded/manual: byes land on match slots 0..v_byes-1 in order, so the
    -- earliest-seeded (or manually-flagged) entrants — who are first in
    -- v_real per the ordering above — land on those matches deterministically.
    select coalesce(array_agg(idx), '{}') into v_bye_match_idx
      from generate_series(0, v_byes - 1) idx;
  end if;

  v_real_ptr := 1;
  v_cur_ids := '{}';
  for v_i in 0 .. v_count - 1 loop
    if v_i = any(v_bye_match_idx) then
      if p_bye_placement = 'random' then
        if random() < 0.5 then v_a := v_real[v_real_ptr]; v_b := null;
        else v_a := null; v_b := v_real[v_real_ptr]; end if;
      else
        v_a := v_real[v_real_ptr]; v_b := null;
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

      update tournament_matches set next_match_id = v_target_id, next_match_slot = v_slot where id = v_mid;

      select winner_id into v_prev_winner from tournament_matches where id = v_mid;
      if v_prev_winner is not null then
        if v_slot = 'a' then update tournament_matches set player_a = v_prev_winner where id = v_target_id;
        else update tournament_matches set player_b = v_prev_winner where id = v_target_id; end if;
      end if;
    end loop;

    update tournament_matches set status = 'ready'
      where id = any(v_cur_ids) and player_a is not null and player_b is not null and status = 'pending';

    v_prev_ids := v_cur_ids;
  end loop;

  return query select * from tournament_matches
    where tournament_id = p_tournament_id and round_index is not null
    order by round_index, bracket_slot;
end;
$$;
grant execute on function rpc_admin_tournament_generate_draw(bigint, jsonb, text) to anon, authenticated;
