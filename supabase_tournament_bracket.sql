-- ============================================================================
-- Tournament System Upgrade — Phase 4: single_elimination bracket generation
-- ============================================================================
-- rpc_tournament_generate_bracket(p_tournament_id): admin-only. Reads the flat
-- entrant list from the tournament's _config sentinel (written by
-- rpc_tournament_register, Phase 3), computes bracket size = next power of 2
-- >= entrant count (capped at 32 by rpc_tournament_create), and inserts the
-- entire match tree in one transaction with next_match_id/next_match_slot
-- wired end-to-end. Byes are resolved immediately (winner_id set, propagated
-- one level) — never a fabricated score.
--
-- Bye placement: byes = size - n is always strictly less than size/2 (the
-- number of leaf-round matches), because size is the SMALLEST power of 2 >= n,
-- so size/2 < n. This guarantees every bye can be paired with a real entrant
-- with at least one match left over with two real entrants — so byes are
-- assigned to a random subset of leaf-match slots (never two byes facing each
-- other), and each bye match gets exactly one real entrant on a random side.
--
-- A full single-elimination bracket of size S always has exactly S-1 match
-- rows (sum of a geometric series S/2 + S/4 + ... + 1), independent of how
-- many of the leaf-round rows are byes — this identity is asserted by the
-- verification tests run after applying this migration.
-- ============================================================================

create or replace function rpc_tournament_generate_bracket(p_tournament_id bigint)
returns setof tournament_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_groups jsonb;
  v_cfg jsonb;
  v_cfg_idx int;
  v_entrants jsonb;
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
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if v_t.format <> 'single_elimination' then raise exception 'wrong_format'; end if;
  if exists (select 1 from tournament_matches where tournament_id = p_tournament_id) then
    raise exception 'bracket_already_generated';
  end if;

  v_groups := coalesce(v_t.groups, '[]'::jsonb);
  select ord - 1, elem into v_cfg_idx, v_cfg
  from jsonb_array_elements(v_groups) with ordinality as t(elem, ord)
  where (elem->>'_config')::boolean is true
  limit 1;
  if v_cfg is null then raise exception 'registration_not_configured'; end if;

  v_entrants := coalesce(v_cfg->'entrants', '[]'::jsonb);
  v_n := jsonb_array_length(v_entrants);
  if v_n < 2 or v_n > 32 then raise exception 'invalid_entrant_count'; end if;

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

  -- shuffle the real entrants
  select array_agg(pid order by rnd) into v_real
  from (
    select (elem->>'playerId')::bigint as pid, random() as rnd
    from jsonb_array_elements(v_entrants) elem
  ) s;

  v_count := v_size / 2;          -- number of leaf-round matches
  v_byes := v_size - v_n;         -- always < v_count, see header note

  -- pick v_byes distinct leaf-match indices (0-based) to carry a bye
  select coalesce(array_agg(idx), '{}') into v_bye_match_idx
  from (
    select gs as idx
    from generate_series(0, v_count - 1) gs
    order by random()
    limit v_byes
  ) s;

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
       'R0-' || v_i, v_i*2+1, v_i*2+2, (v_winner is not null),
       case when v_winner is not null then 'bye' else 'ready' end, '[]'::jsonb)
    returning id into v_mid;
    v_cur_ids := v_cur_ids || v_mid;
  end loop;

  v_prev_ids := v_cur_ids;

  -- subsequent rounds: create empty pending matches, wire the previous
  -- round's next_match_id/next_match_slot, and propagate any bye winners
  for v_r in 1 .. v_rounds - 1 loop
    v_count := v_count / 2;
    v_cur_ids := '{}';
    for v_i in 0 .. v_count - 1 loop
      insert into tournament_matches
        (tournament_id, group_letter, round_index, round_name, bracket_slot, status, games)
      values
        (p_tournament_id, null, v_r, v_round_labels[v_r+1], 'R'||v_r||'-'||v_i, 'pending', '[]'::jsonb)
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

  -- registration closes once the bracket exists
  v_cfg := jsonb_set(v_cfg, '{registrationOpen}', 'false'::jsonb);
  v_groups := jsonb_set(v_groups, array[v_cfg_idx::text], v_cfg);
  update tournaments set groups = v_groups where id = p_tournament_id;

  return query select * from tournament_matches where tournament_id = p_tournament_id order by round_index, bracket_slot;
end;
$$;

grant execute on function public.rpc_tournament_generate_bracket(bigint) to anon, authenticated;
