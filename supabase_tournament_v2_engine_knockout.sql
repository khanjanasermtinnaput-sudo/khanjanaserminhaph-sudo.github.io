-- ============================================================================
-- Tournament V2 — knockout generation, result submission, correction
-- ============================================================================
-- This file is the repo record of what is deployed. It was applied to
-- production in migrations tournament_v2_12..16; two defects were found by the
-- end-to-end run and are folded in here:
--
--   * match_no was numbered per round, so round 2 match 1 collided with round 1
--     match 1 under ux_tm_generation_key. It is now a running counter across
--     the whole generation; bracket_slot carries the display position.
--   * fn_v2_validate_games accepted 30-10. A game can only pass points_to_win
--     via deuce, so reaching the cap pins the margin to exactly 1.
--
-- Also applied alongside (migration tournament_v2_15): tournament_matches had
-- NO foreign key on tournament_id, so deleting a tournament orphaned its
-- matches. See the FK section at the bottom.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- rpc_generate_knockout_from_qualifiers
-- ---------------------------------------------------------------------------
-- Entrants come ONLY from stored standings and the configured advancement
-- rule. For groups_knockout the group stage must be complete first, which is
-- what makes "the group stage cannot be silently skipped" a real guarantee
-- rather than a UI convention.
--
-- Seeding uses the standard recursive bracket order — seedOrder(2n) interleaves
-- s with (2n+1-s) — which places seeds 1 and 2 in opposite halves and seeds 1-4
-- in different quarters. Pre-V2 explicitly did not implement seed separation.
-- Any seed position beyond the entry count becomes a BYE, and byes are resolved
-- and propagated before the bracket opens.
create or replace function public.rpc_generate_knockout_from_qualifiers(
  p_event_id bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid bigint; v_ev tournaments;
  v_seeds bigint[] := '{}'; v_order int[]; v_next int[];
  v_cur bigint[]; v_prev bigint[];
  v_n int; v_size int := 2; v_rounds int := 0; v_m int;
  v_s int; v_i int; v_r int; v_id bigint;
  v_incomplete int; v_created int := 0;
  v_sa int; v_sb int; v_ea bigint; v_eb bigint; v_pa bigint; v_pb bigint;
  v_name text; v_nid bigint; v_nslot text; rec record;
begin
  v_uid := fn_v2_assert_admin();
  if coalesce(trim(p_idempotency_key),'') = '' then raise exception 'ERR_IDEMPOTENCY_KEY_REQUIRED'; end if;

  select * into v_ev from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;
  if v_ev.structure = 'groups_only' then raise exception 'ERR_NO_KNOCKOUT_STAGE'; end if;

  if exists (select 1 from tournament_matches
              where tournament_id = p_event_id and generation_key = p_idempotency_key) then
    select count(*) into v_created from tournament_matches
     where tournament_id = p_event_id and generation_key = p_idempotency_key;
    return jsonb_build_object('event_id', p_event_id, 'created', 0,
      'existing', v_created, 'replayed', true);
  end if;
  if exists (select 1 from tournament_matches where tournament_id = p_event_id and stage='knockout') then
    raise exception 'ERR_KNOCKOUT_EXISTS'; end if;

  if v_ev.structure = 'groups_knockout' then
    if v_ev.lifecycle_status <> 'group_stage' then
      raise exception 'ERR_GROUP_STAGE_NOT_ACTIVE' using detail = v_ev.lifecycle_status; end if;
    select count(*) into v_incomplete from tournament_matches
     where tournament_id = p_event_id and stage='group'
       and status not in ('completed','walkover','retired','disqualified');
    if v_incomplete > 0 then
      raise exception 'ERR_GROUP_STAGE_INCOMPLETE' using
        detail = format('%s group matches are still outstanding', v_incomplete); end if;
    -- group winners become the top seeds, then all runners-up, and so on
    select array_agg(s.entry_id order by s.rank, s.group_letter) into v_seeds
      from fn_event_standings(p_event_id) s where s.qualifies;
  else
    if v_ev.lifecycle_status not in ('published','knockout') then
      raise exception 'ERR_DRAW_NOT_PUBLISHED' using detail = v_ev.lifecycle_status; end if;
    select array_agg(e.id order by e.seed nulls last, e.id) into v_seeds
      from tournament_entries e
     where e.tournament_id = p_event_id and e.status = 'registered';
  end if;

  v_n := coalesce(array_length(v_seeds,1), 0);
  if v_n = 0 then raise exception 'ERR_NO_QUALIFIERS'; end if;
  if v_n > 32 then raise exception 'ERR_TOO_MANY_ENTRIES' using detail = v_n::text; end if;

  -- One qualifier is a real auto-qualification, not a fabricated match.
  if v_n = 1 then
    update tournaments set lifecycle_status =
      case when v_ev.purpose='selection' then 'selection_completed' else 'completed' end,
      status='completed', lock_version=lock_version+1 where id = p_event_id;
    perform log_admin_action('tournament_v2_auto_qualify','tournaments', p_event_id::text, null,
      jsonb_build_object('entry_id', v_seeds[1]));
    return jsonb_build_object('event_id', p_event_id, 'created', 0, 'auto_qualified_entry', v_seeds[1]);
  end if;

  while v_size < v_n loop v_size := v_size * 2; end loop;
  v_m := v_size; while v_m > 1 loop v_rounds := v_rounds + 1; v_m := v_m / 2; end loop;

  v_order := array[1];
  while array_length(v_order,1) < v_size loop
    v_next := '{}';
    v_i := array_length(v_order,1) * 2;
    foreach v_s in array v_order loop
      v_next := v_next || v_s || (v_i + 1 - v_s);
    end loop;
    v_order := v_next;
  end loop;

  -- Build from the final backwards so next_match_id always already exists.
  v_prev := '{}';
  for v_r in reverse v_rounds..1 loop
    v_m := v_size / (2 ^ v_r)::int;
    v_name := case when v_m = 1 then 'F' when v_m = 2 then 'SF'
                   when v_m = 4 then 'QF' else 'R' || (v_m * 2)::text end;
    v_cur := '{}';
    for v_i in 1..v_m loop
      if v_r = v_rounds then v_nid := null; v_nslot := null;
      else
        v_nid := v_prev[ceil(v_i / 2.0)::int];
        v_nslot := case when v_i % 2 = 1 then 'a' else 'b' end;
      end if;
      v_created := v_created + 1;

      insert into tournament_matches (tournament_id, stage, status, round_index, round_name,
        bracket_slot, next_match_id, next_match_slot, match_no, generation_key, games)
      values (p_event_id, 'knockout', 'pending', v_r, v_name,
              v_name || '-' || v_i::text, v_nid, v_nslot, v_created, p_idempotency_key, '[]'::jsonb)
      returning id into v_id;

      v_cur := v_cur || v_id;
    end loop;
    v_prev := v_cur;
  end loop;
  -- v_prev now holds round 1

  for v_i in 1..array_length(v_prev,1) loop
    v_sa := v_order[2 * v_i - 1];
    v_sb := v_order[2 * v_i];
    v_ea := case when v_sa <= v_n then v_seeds[v_sa] else null end;
    v_eb := case when v_sb <= v_n then v_seeds[v_sb] else null end;

    v_pa := null; v_pb := null;
    if v_ea is not null then
      select player_id into v_pa from tournament_entry_members
       where entry_id = v_ea order by member_order limit 1; end if;
    if v_eb is not null then
      select player_id into v_pb from tournament_entry_members
       where entry_id = v_eb order by member_order limit 1; end if;

    update tournament_matches
       set entry_a_id = v_ea, entry_b_id = v_eb, player_a = v_pa, player_b = v_pb,
           seed_a = case when v_ea is not null then v_sa end,
           seed_b = case when v_eb is not null then v_sb end,
           is_bye = (v_ea is null or v_eb is null),
           status = case when v_ea is not null and v_eb is not null then 'ready' else 'bye' end,
           outcome = case when v_ea is null or v_eb is null then 'bye' end,
           winner_entry_id = case when v_ea is null then v_eb when v_eb is null then v_ea end,
           winner_id = case when v_ea is null then v_pb when v_eb is null then v_pa end
     where id = v_prev[v_i];
  end loop;

  for rec in select id, next_match_id, next_match_slot, winner_entry_id, winner_id
               from tournament_matches
              where tournament_id = p_event_id and stage='knockout'
                and status='bye' and next_match_id is not null loop
    if rec.next_match_slot = 'a' then
      update tournament_matches set entry_a_id = rec.winner_entry_id, player_a = rec.winner_id
       where id = rec.next_match_id;
    else
      update tournament_matches set entry_b_id = rec.winner_entry_id, player_b = rec.winner_id
       where id = rec.next_match_id;
    end if;
  end loop;

  update tournament_matches set status = 'ready'
   where tournament_id = p_event_id and stage='knockout' and status='pending'
     and entry_a_id is not null and entry_b_id is not null;

  update tournaments set lifecycle_status='knockout', lock_version=lock_version+1
   where id = p_event_id;

  perform log_admin_action('tournament_v2_generate_knockout','tournaments', p_event_id::text, null,
    jsonb_build_object('entries', v_n, 'bracket_size', v_size, 'rounds', v_rounds,
                       'matches', v_created, 'key', p_idempotency_key));

  return jsonb_build_object('event_id', p_event_id, 'entries', v_n, 'bracket_size', v_size,
    'rounds', v_rounds, 'created', v_created, 'replayed', false);
end $$;

-- ---------------------------------------------------------------------------
-- fn_v2_validate_games — scoring comes from the EVENT, never from the tier
-- ---------------------------------------------------------------------------
-- Three legal game shapes, which together make a cap score reachable only
-- through deuce:
--   winner == points_to_win        -> loser <= points_to_win - win_by  (21-19)
--   points_to_win < winner < cap   -> margin is exactly win_by         (24-22)
--   winner == cap                  -> margin is exactly 1              (30-29)
create or replace function public.fn_v2_validate_games(p_games jsonb, p_cfg jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_points int; v_win_by int; v_cap int; v_max int; v_need int;
  v_g jsonb; v_a int; v_b int; v_hi int; v_lo int;
  v_wa int := 0; v_wb int := 0; v_n int := 0; v_decided boolean := false;
begin
  if p_games is null or jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) = 0 then
    raise exception 'ERR_NO_GAMES'; end if;

  v_points := coalesce((p_cfg->>'points_to_win')::int, 21);
  v_win_by := coalesce((p_cfg->>'win_by')::int, 2);
  v_cap    := coalesce((p_cfg->>'cap')::int, 30);
  v_max    := coalesce((p_cfg->>'max_games')::int, 1);
  v_need   := coalesce((p_cfg->>'games_to_win')::int, 1);

  if jsonb_array_length(p_games) > v_max then
    raise exception 'ERR_TOO_MANY_GAMES' using
      detail = format('%s games submitted, max %s', jsonb_array_length(p_games), v_max); end if;

  for v_g in select * from jsonb_array_elements(p_games) loop
    v_n := v_n + 1;
    if v_decided then raise exception 'ERR_GAMES_AFTER_DECIDED'; end if;

    v_a := (v_g->>'score_a')::int;
    v_b := (v_g->>'score_b')::int;
    if v_a is null or v_b is null or v_a < 0 or v_b < 0 then raise exception 'ERR_BAD_SCORE'; end if;
    if v_a = v_b then raise exception 'ERR_GAME_NOT_DECIDED' using detail = format('game %s', v_n); end if;

    v_hi := greatest(v_a, v_b); v_lo := least(v_a, v_b);

    if v_hi > v_cap then
      raise exception 'ERR_SCORE_ABOVE_CAP' using detail = format('game %s: %s-%s', v_n, v_a, v_b); end if;
    if v_hi < v_points then
      raise exception 'ERR_GAME_NOT_FINISHED' using detail = format('game %s: %s-%s', v_n, v_a, v_b); end if;

    if v_hi = v_points then
      if (v_hi - v_lo) < v_win_by then
        raise exception 'ERR_WIN_BY_MARGIN' using detail = format('game %s: %s-%s', v_n, v_a, v_b); end if;
    elsif v_hi = v_cap then
      if (v_hi - v_lo) <> 1 then
        raise exception 'ERR_IMPOSSIBLE_CAP_SCORE' using
          detail = format('game %s: %s-%s can only be reached as %s-%s',
                          v_n, v_a, v_b, v_cap, v_cap - 1); end if;
    else
      if (v_hi - v_lo) <> v_win_by then
        raise exception 'ERR_DEUCE_MUST_END_ON_MARGIN' using
          detail = format('game %s: %s-%s', v_n, v_a, v_b); end if;
    end if;

    if v_a > v_b then v_wa := v_wa + 1; else v_wb := v_wb + 1; end if;
    if v_wa >= v_need or v_wb >= v_need then v_decided := true; end if;
  end loop;

  if not v_decided then raise exception 'ERR_MATCH_NOT_DECIDED'; end if;
  return case when v_wa > v_wb then 'a' else 'b' end;
end $$;

-- ---------------------------------------------------------------------------
-- rpc_submit_match_result
-- ---------------------------------------------------------------------------
-- Knockout results are admin-only. A group result may also be recorded by one
-- of the two participants, which preserves the club's referee workflow while
-- closing the real hole in the pre-V2 path: rpc_tournament_submit_group_result
-- accepted any authenticated caller AND performed no scoring validation at all.
create or replace function public.rpc_submit_match_result(
  p_match_id bigint, p_games jsonb, p_outcome text default 'normal',
  p_duration_seconds int default null, p_idempotency_key text default null,
  p_winner_entry_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid bigint; v_m tournament_matches; v_ev tournaments;
  v_side text; v_win bigint; v_win_player bigint; v_is_admin boolean;
  v_g jsonb; v_no int := 0; v_next tournament_matches;
begin
  v_uid := session_uid();
  if v_uid is null then raise exception 'ERR_NOT_AUTHENTICATED'; end if;
  v_is_admin := is_admin_caller();

  select * into v_m from tournament_matches where id = p_match_id for update;
  if not found then raise exception 'ERR_MATCH_NOT_FOUND'; end if;
  select * into v_ev from tournaments where id = v_m.tournament_id;

  if v_m.status in ('completed','walkover','retired','disqualified') then
    if p_idempotency_key is not null and v_m.submit_idempotency_key = p_idempotency_key then
      return jsonb_build_object('match_id', p_match_id, 'replayed', true,
        'winner_entry_id', v_m.winner_entry_id, 'status', v_m.status);
    end if;
    raise exception 'ERR_MATCH_ALREADY_COMPLETED';
  end if;

  if v_m.status not in ('ready','live') then
    raise exception 'ERR_MATCH_NOT_READY' using detail = v_m.status; end if;

  if not v_is_admin then
    if v_m.stage <> 'group' then raise exception 'ERR_NOT_ADMIN'; end if;
    if not exists (select 1 from tournament_entry_members
                    where entry_id in (v_m.entry_a_id, v_m.entry_b_id) and player_id = v_uid) then
      raise exception 'ERR_NOT_A_PARTICIPANT'; end if;
  end if;

  if p_outcome not in ('normal','walkover','retired','disqualified') then
    raise exception 'ERR_BAD_OUTCOME'; end if;

  if p_outcome = 'normal' then
    v_side := fn_v2_validate_games(p_games, v_ev.scoring_config);
    v_win  := case when v_side = 'a' then v_m.entry_a_id else v_m.entry_b_id end;
  else
    if p_winner_entry_id is null then raise exception 'ERR_WINNER_REQUIRED'; end if;
    if p_winner_entry_id not in (v_m.entry_a_id, v_m.entry_b_id) then
      raise exception 'ERR_WINNER_NOT_IN_MATCH'; end if;
    v_win := p_winner_entry_id;
    v_side := case when v_win = v_m.entry_a_id then 'a' else 'b' end;
  end if;

  select player_id into v_win_player from tournament_entry_members
   where entry_id = v_win order by member_order limit 1;

  delete from tournament_match_games where match_id = p_match_id;
  if p_games is not null and jsonb_typeof(p_games) = 'array' then
    for v_g in select * from jsonb_array_elements(p_games) loop
      v_no := v_no + 1;
      insert into tournament_match_games (match_id, game_no, score_a, score_b, winner_side)
      values (p_match_id, v_no, (v_g->>'score_a')::int, (v_g->>'score_b')::int,
              case when (v_g->>'score_a')::int > (v_g->>'score_b')::int then 'a' else 'b' end);
    end loop;
  end if;

  update tournament_matches set
    status = case when p_outcome = 'normal' then 'completed' else p_outcome end,
    outcome = p_outcome, winner_entry_id = v_win, winner_id = v_win_player,
    is_walkover = (p_outcome = 'walkover'),
    score_a = (select count(*) from tournament_match_games where match_id = p_match_id and winner_side='a'),
    score_b = (select count(*) from tournament_match_games where match_id = p_match_id and winner_side='b'),
    games = coalesce(p_games, '[]'::jsonb),
    duration_seconds = coalesce(p_duration_seconds, duration_seconds),
    ended_at = now(), played_at = now(), submit_idempotency_key = p_idempotency_key
  where id = p_match_id;

  -- Advance exactly once. Lock self, then the single downstream match: every
  -- match only ever locks itself and its one successor, so there is no cycle.
  if v_m.next_match_id is not null then
    select * into v_next from tournament_matches where id = v_m.next_match_id for update;
    if v_m.next_match_slot = 'a' then
      update tournament_matches set entry_a_id = v_win, player_a = v_win_player
       where id = v_m.next_match_id;
    else
      update tournament_matches set entry_b_id = v_win, player_b = v_win_player
       where id = v_m.next_match_id;
    end if;
    update tournament_matches set status = 'ready'
     where id = v_m.next_match_id and status = 'pending'
       and entry_a_id is not null and entry_b_id is not null;
  elsif v_m.stage = 'knockout' then
    update tournaments set
      lifecycle_status = case when purpose = 'selection' then 'selection_completed' else 'completed' end,
      status = 'completed', lock_version = lock_version + 1
    where id = v_m.tournament_id;
  end if;

  return jsonb_build_object('match_id', p_match_id, 'winner_entry_id', v_win,
    'winner_side', v_side, 'outcome', p_outcome, 'replayed', false,
    'advanced_to', v_m.next_match_id);
end $$;

-- ---------------------------------------------------------------------------
-- rpc_admin_correct_match_result
-- ---------------------------------------------------------------------------
-- Deliberately high friction: a reason is mandatory, old and new results both
-- go to the audit log, and a correction is refused outright once a downstream
-- match has started or rewards have been paid.
create or replace function public.rpc_admin_correct_match_result(
  p_match_id bigint, p_games jsonb, p_reason text,
  p_outcome text default 'normal', p_winner_entry_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid bigint; v_m tournament_matches; v_ev tournaments; v_next tournament_matches;
  v_side text; v_win bigint; v_win_player bigint; v_old jsonb;
  v_g jsonb; v_no int := 0; v_rewards int;
begin
  v_uid := fn_v2_assert_admin();
  if coalesce(trim(p_reason),'') = '' then raise exception 'ERR_REASON_REQUIRED'; end if;

  select * into v_m from tournament_matches where id = p_match_id for update;
  if not found then raise exception 'ERR_MATCH_NOT_FOUND'; end if;
  if v_m.status not in ('completed','walkover','retired','disqualified') then
    raise exception 'ERR_MATCH_NOT_COMPLETED' using detail = v_m.status; end if;

  select * into v_ev from tournaments where id = v_m.tournament_id;

  if v_m.next_match_id is not null then
    select * into v_next from tournament_matches where id = v_m.next_match_id for update;
    if v_next.status in ('live','completed','walkover','retired','disqualified') then
      raise exception 'ERR_DOWNSTREAM_LOCKED' using detail = format(
        'the following match is already %s; use the high-risk resolution flow', v_next.status);
    end if;
  end if;

  select count(*) into v_rewards from reward_transactions
   where metadata->>'tournament_id' = v_m.tournament_id::text;
  if v_rewards > 0 then raise exception 'ERR_REWARDS_ALREADY_GRANTED'; end if;

  v_old := jsonb_build_object('winner_entry_id', v_m.winner_entry_id, 'outcome', v_m.outcome,
                              'games', v_m.games, 'status', v_m.status);

  if p_outcome = 'normal' then
    v_side := fn_v2_validate_games(p_games, v_ev.scoring_config);
    v_win := case when v_side = 'a' then v_m.entry_a_id else v_m.entry_b_id end;
  else
    if p_winner_entry_id is null then raise exception 'ERR_WINNER_REQUIRED'; end if;
    if p_winner_entry_id not in (v_m.entry_a_id, v_m.entry_b_id) then
      raise exception 'ERR_WINNER_NOT_IN_MATCH'; end if;
    v_win := p_winner_entry_id;
  end if;

  select player_id into v_win_player from tournament_entry_members
   where entry_id = v_win order by member_order limit 1;

  delete from tournament_match_games where match_id = p_match_id;
  if p_games is not null and jsonb_typeof(p_games) = 'array' then
    for v_g in select * from jsonb_array_elements(p_games) loop
      v_no := v_no + 1;
      insert into tournament_match_games (match_id, game_no, score_a, score_b, winner_side)
      values (p_match_id, v_no, (v_g->>'score_a')::int, (v_g->>'score_b')::int,
              case when (v_g->>'score_a')::int > (v_g->>'score_b')::int then 'a' else 'b' end);
    end loop;
  end if;

  update tournament_matches set
    status = case when p_outcome = 'normal' then 'completed' else p_outcome end,
    outcome = p_outcome, winner_entry_id = v_win, winner_id = v_win_player,
    games = coalesce(p_games,'[]'::jsonb),
    score_a = (select count(*) from tournament_match_games where match_id = p_match_id and winner_side='a'),
    score_b = (select count(*) from tournament_match_games where match_id = p_match_id and winner_side='b'),
    correction_count = correction_count + 1
  where id = p_match_id;

  if v_m.next_match_id is not null and v_win is distinct from v_m.winner_entry_id then
    if v_m.next_match_slot = 'a' then
      update tournament_matches set entry_a_id = v_win, player_a = v_win_player
       where id = v_m.next_match_id;
    else
      update tournament_matches set entry_b_id = v_win, player_b = v_win_player
       where id = v_m.next_match_id;
    end if;
  end if;

  perform log_admin_action('tournament_v2_correct_result','tournament_matches', p_match_id::text,
    v_old, jsonb_build_object('winner_entry_id', v_win, 'games', p_games,
                              'outcome', p_outcome, 'reason', p_reason));

  return jsonb_build_object('match_id', p_match_id, 'winner_entry_id', v_win,
    'previous_winner_entry_id', v_m.winner_entry_id,
    'correction_count', v_m.correction_count + 1);
end $$;

-- ---------------------------------------------------------------------------
-- Referential integrity repair (migration tournament_v2_15)
-- ---------------------------------------------------------------------------
-- tournament_matches.tournament_id had NO foreign key, so deleting a tournament
-- left orphan matches pointing at a row that no longer existed. Safe to add:
-- the table was empty in production.
alter table public.tournament_matches drop constraint if exists tournament_matches_tournament_id_fkey;
alter table public.tournament_matches add constraint tournament_matches_tournament_id_fkey
  foreign key (tournament_id) references public.tournaments(id) on delete cascade;

alter table public.tournament_matches drop constraint if exists tournament_matches_entry_a_id_fkey;
alter table public.tournament_matches add constraint tournament_matches_entry_a_id_fkey
  foreign key (entry_a_id) references public.tournament_entries(id) on delete set null;

alter table public.tournament_matches drop constraint if exists tournament_matches_entry_b_id_fkey;
alter table public.tournament_matches add constraint tournament_matches_entry_b_id_fkey
  foreign key (entry_b_id) references public.tournament_entries(id) on delete set null;

alter table public.tournament_matches drop constraint if exists tournament_matches_winner_entry_id_fkey;
alter table public.tournament_matches add constraint tournament_matches_winner_entry_id_fkey
  foreign key (winner_entry_id) references public.tournament_entries(id) on delete set null;

alter table public.tournament_matches drop constraint if exists tournament_matches_next_match_id_fkey;
alter table public.tournament_matches add constraint tournament_matches_next_match_id_fkey
  foreign key (next_match_id) references public.tournament_matches(id) on delete cascade;

create index if not exists idx_tm_tournament on public.tournament_matches (tournament_id);

-- ---------------------------------------------------------------------------
-- Execution privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_v2_validate_games(jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.rpc_generate_knockout_from_qualifiers(bigint,text) from public;
grant  execute on function public.rpc_generate_knockout_from_qualifiers(bigint,text) to anon, authenticated;
revoke execute on function public.rpc_submit_match_result(bigint,jsonb,text,int,text,bigint) from public;
grant  execute on function public.rpc_submit_match_result(bigint,jsonb,text,int,text,bigint) to anon, authenticated;
revoke execute on function public.rpc_admin_correct_match_result(bigint,jsonb,text,text,bigint) from public;
grant  execute on function public.rpc_admin_correct_match_result(bigint,jsonb,text,text,bigint) to anon, authenticated;

-- ============================================================================
-- ROLLBACK
--   drop function if exists public.rpc_admin_correct_match_result(bigint,jsonb,text,text,bigint);
--   drop function if exists public.rpc_submit_match_result(bigint,jsonb,text,int,text,bigint);
--   drop function if exists public.fn_v2_validate_games(jsonb,jsonb);
--   drop function if exists public.rpc_generate_knockout_from_qualifiers(bigint,text);
--   -- the FK repairs above are strict improvements; leave them in place.
-- ============================================================================
