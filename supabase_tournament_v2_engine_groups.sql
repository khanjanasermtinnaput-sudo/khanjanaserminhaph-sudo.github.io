-- ============================================================================
-- Tournament V2 — group stage engine: draw assignment, round robin, standings
-- ============================================================================
-- Standings are computed HERE and nowhere else. Pre-V2, the browser computed
-- group standings and the server merely rubber-stamped the winner the client
-- claimed (js/tournament-knockout.js koGenerateKnockout). In V2 the client is a
-- renderer: rpc_generate_knockout_from_qualifiers reads fn_event_standings and
-- ignores any client-supplied qualifier list entirely.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- fn_event_standings — the single authority on who is winning a group
-- ---------------------------------------------------------------------------
-- Tie-break ladder, in order:
--   1. match wins
--   2. head-to-head, but ONLY when exactly two entries are tied (with three or
--      more tied, head-to-head is frequently circular and is skipped)
--   3. game difference
--   4. point difference
--   5. games won
--   6. points won
--   7. entry id, purely so the ordering is stable and reproducible; a genuine
--      tie at this depth is surfaced to the admin as `is_tied` for a playoff
--      or an audited manual decision.
create or replace function public.fn_event_standings(p_event_id bigint)
returns table (
  group_id     bigint,
  group_letter text,
  entry_id     bigint,
  played       int,
  wins         int,
  losses       int,
  games_won    int,
  games_lost   int,
  game_diff    int,
  points_won   int,
  points_lost  int,
  point_diff   int,
  h2h          int,
  rank         int,
  is_tied      boolean,
  qualifies    boolean
)
language sql stable security definer set search_path = public
as $$
  with sides as (
    -- one row per (match, participating entry)
    select m.id as match_id, m.group_id, m.entry_a_id as eid, m.entry_b_id as opp,
           m.winner_entry_id, 'a'::text as side
      from tournament_matches m
     where m.tournament_id = p_event_id and m.stage = 'group'
       and m.status in ('completed','walkover','retired','disqualified')
       and m.entry_a_id is not null and m.entry_b_id is not null
    union all
    select m.id, m.group_id, m.entry_b_id, m.entry_a_id, m.winner_entry_id, 'b'
      from tournament_matches m
     where m.tournament_id = p_event_id and m.stage = 'group'
       and m.status in ('completed','walkover','retired','disqualified')
       and m.entry_a_id is not null and m.entry_b_id is not null
  ),
  per_match as (
    select s.match_id, s.group_id, s.eid, s.opp, s.winner_entry_id, s.side,
           coalesce(sum(case when s.side = 'a' then g.score_a else g.score_b end), 0)::int as pf,
           coalesce(sum(case when s.side = 'a' then g.score_b else g.score_a end), 0)::int as pa,
           count(*) filter (where g.winner_side = s.side)::int as gf,
           count(*) filter (where g.winner_side is not null and g.winner_side <> s.side)::int as ga
      from sides s
      left join tournament_match_games g on g.match_id = s.match_id
     group by s.match_id, s.group_id, s.eid, s.opp, s.winner_entry_id, s.side
  ),
  -- every assigned entry appears, including ones that have not played yet
  base as (
    select ge.group_id, gr.letter, ge.entry_id,
           count(pm.match_id)::int as played,
           count(*) filter (where pm.winner_entry_id = ge.entry_id)::int as wins,
           count(*) filter (where pm.winner_entry_id is not null
                              and pm.winner_entry_id <> ge.entry_id)::int as losses,
           coalesce(sum(pm.gf), 0)::int as games_won,
           coalesce(sum(pm.ga), 0)::int as games_lost,
           coalesce(sum(pm.pf), 0)::int as points_won,
           coalesce(sum(pm.pa), 0)::int as points_lost,
           gr.advance_count
      from tournament_group_entries ge
      join tournament_groups gr on gr.id = ge.group_id
      join tournament_entries e  on e.id = ge.entry_id
      left join per_match pm on pm.eid = ge.entry_id
     where gr.tournament_id = p_event_id
       and e.status in ('registered','waitlisted')
     group by ge.group_id, gr.letter, ge.entry_id, gr.advance_count
  ),
  tie_sizes as (
    select b.*, count(*) over (partition by b.group_id, b.wins) as tied_on_wins
      from base b
  ),
  -- head-to-head only decides a straight two-way tie
  h2h_calc as (
    select t.*,
           case when t.tied_on_wins = 2 then coalesce((
             select case when pm.winner_entry_id = t.entry_id then 1 else 0 end
               from per_match pm
               join tie_sizes o
                 on o.group_id = t.group_id and o.wins = t.wins and o.entry_id <> t.entry_id
              where pm.eid = t.entry_id and pm.opp = o.entry_id
              limit 1), 0)
           else 0 end as h2h_score
      from tie_sizes t
  ),
  ranked as (
    select h.*,
           row_number() over (
             partition by h.group_id
             order by h.wins desc, h.h2h_score desc,
                      (h.games_won - h.games_lost) desc,
                      (h.points_won - h.points_lost) desc,
                      h.games_won desc, h.points_won desc, h.entry_id asc
           )::int as rnk,
           count(*) over (
             partition by h.group_id, h.wins, h.h2h_score,
                          (h.games_won - h.games_lost), (h.points_won - h.points_lost),
                          h.games_won, h.points_won
           ) as identical
      from h2h_calc h
  )
  select r.group_id, r.letter, r.entry_id, r.played, r.wins, r.losses,
         r.games_won, r.games_lost, (r.games_won - r.games_lost)::int,
         r.points_won, r.points_lost, (r.points_won - r.points_lost)::int,
         r.h2h_score, r.rnk, (r.identical > 1), (r.rnk <= r.advance_count)
    from ranked r
   order by r.letter, r.rnk;
$$;

create or replace function public.rpc_compute_event_standings(p_event_id bigint)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.group_letter, s.rank), '[]'::jsonb)
    from fn_event_standings(p_event_id) s;
$$;

-- ---------------------------------------------------------------------------
-- rpc_admin_assign_groups
-- ---------------------------------------------------------------------------
-- The client proposes a draw (random / seeded / manual, computed by the pure
-- JS module so it stays unit-testable); this RPC independently validates and
-- commits it. A proposal is never trusted: slot counts, duplicate entries and
-- foreign entries are all re-checked here.
--
-- p_assignments: [{"letter":"A","entries":[{"entry_id":1,"slot":1,"seed":1}, ...]}, ...]
create or replace function public.rpc_admin_assign_groups(
  p_event_id         bigint,
  p_assignments      jsonb,
  p_draw_seed        bigint,
  p_expected_version int,
  p_draw_method      text default 'random'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      bigint;
  v_ev       tournaments;
  v_grp      jsonb;
  v_row      jsonb;
  v_group_id bigint;
  v_seen     bigint[] := '{}';
  v_entry    bigint;
  v_total    int := 0;
  v_version  int;
begin
  v_uid := fn_v2_assert_admin();

  select * into v_ev from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;
  if v_ev.lock_version <> p_expected_version then raise exception 'ERR_VERSION_CONFLICT'; end if;
  if v_ev.lifecycle_status not in ('roster_ready','draw_ready') then
    raise exception 'ERR_DRAW_NOT_ALLOWED' using
      detail = format('event is %s; the roster must be ready first', v_ev.lifecycle_status);
  end if;
  if v_ev.structure not in ('groups_knockout','groups_only') then
    raise exception 'ERR_NO_GROUP_STAGE' using detail = v_ev.structure;
  end if;
  if p_draw_method not in ('random','seeded','manual') then raise exception 'ERR_BAD_DRAW_METHOD'; end if;
  if jsonb_typeof(p_assignments) <> 'array' then raise exception 'ERR_BAD_PAYLOAD'; end if;

  -- ---- validate before writing ---------------------------------------------
  for v_grp in select * from jsonb_array_elements(p_assignments) loop
    select id into v_group_id from tournament_groups
     where tournament_id = p_event_id and letter = v_grp->>'letter';
    if v_group_id is null then
      raise exception 'ERR_GROUP_NOT_FOUND' using detail = coalesce(v_grp->>'letter','null');
    end if;

    if jsonb_array_length(v_grp->'entries') > coalesce(v_ev.teams_per_group, 8) then
      raise exception 'ERR_GROUP_OVERFULL' using
        detail = format('group %s holds %s of %s slots', v_grp->>'letter',
                        jsonb_array_length(v_grp->'entries'), v_ev.teams_per_group);
    end if;

    for v_row in select * from jsonb_array_elements(v_grp->'entries') loop
      v_entry := (v_row->>'entry_id')::bigint;
      if v_entry = any(v_seen) then
        raise exception 'ERR_ENTRY_IN_TWO_GROUPS' using detail = v_entry::text;
      end if;
      v_seen := v_seen || v_entry;

      if not exists (select 1 from tournament_entries
                      where id = v_entry and tournament_id = p_event_id
                        and status = 'registered') then
        raise exception 'ERR_ENTRY_NOT_ELIGIBLE' using detail = v_entry::text;
      end if;
      v_total := v_total + 1;
    end loop;
  end loop;

  if v_total < 2 then raise exception 'ERR_TOO_FEW_ENTRIES'; end if;

  -- ---- commit ---------------------------------------------------------------
  delete from tournament_group_entries
   where group_id in (select id from tournament_groups where tournament_id = p_event_id);

  for v_grp in select * from jsonb_array_elements(p_assignments) loop
    select id into v_group_id from tournament_groups
     where tournament_id = p_event_id and letter = v_grp->>'letter';
    for v_row in select * from jsonb_array_elements(v_grp->'entries') loop
      insert into tournament_group_entries (group_id, entry_id, slot, seed)
      values (v_group_id, (v_row->>'entry_id')::bigint,
              (v_row->>'slot')::int, (v_row->>'seed')::int);
    end loop;
  end loop;

  select coalesce(max(version), 0) + 1 into v_version
    from tournament_draw_versions where tournament_id = p_event_id;

  insert into tournament_draw_versions (
    tournament_id, version, config, assignments, draw_seed, draw_method, created_by)
  values (p_event_id, v_version,
          jsonb_build_object('structure', v_ev.structure, 'group_count', v_ev.group_count,
                             'teams_per_group', v_ev.teams_per_group,
                             'advance_per_group', v_ev.advance_per_group),
          p_assignments, p_draw_seed, p_draw_method, v_uid);

  update tournaments
     set draw_seed = p_draw_seed,
         lifecycle_status = 'draw_ready',
         lock_version = lock_version + 1
   where id = p_event_id;

  perform log_admin_action('tournament_v2_assign_groups', 'tournaments', p_event_id::text, null,
    jsonb_build_object('draw_version', v_version, 'method', p_draw_method,
                       'seed', p_draw_seed, 'entries', v_total));

  return jsonb_build_object('event_id', p_event_id, 'draw_version', v_version,
    'assigned', v_total, 'lock_version', v_ev.lock_version + 1, 'lifecycle_status', 'draw_ready');
end $$;

-- ---------------------------------------------------------------------------
-- rpc_admin_publish_draw — a draw is a draft until this is called
-- ---------------------------------------------------------------------------
create or replace function public.rpc_admin_publish_draw(
  p_event_id bigint, p_draw_version int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_uid bigint; v_ev tournaments;
begin
  v_uid := fn_v2_assert_admin();

  select * into v_ev from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;
  if v_ev.lifecycle_status <> 'draw_ready' then
    raise exception 'ERR_DRAW_NOT_READY' using detail = v_ev.lifecycle_status;
  end if;
  if not exists (select 1 from tournament_draw_versions
                  where tournament_id = p_event_id and version = p_draw_version) then
    raise exception 'ERR_DRAW_VERSION_NOT_FOUND';
  end if;

  update tournament_draw_versions set is_published = false
   where tournament_id = p_event_id and is_published;
  update tournament_draw_versions
     set is_published = true, published_at = now(), published_by = v_uid
   where tournament_id = p_event_id and version = p_draw_version;

  update tournaments
     set lifecycle_status = 'published', is_published = true, lock_version = lock_version + 1
   where id = p_event_id;

  perform log_admin_action('tournament_v2_publish_draw', 'tournaments', p_event_id::text, null,
    jsonb_build_object('draw_version', p_draw_version));

  return jsonb_build_object('event_id', p_event_id, 'draw_version', p_draw_version,
    'lifecycle_status', 'published');
end $$;

-- ---------------------------------------------------------------------------
-- rpc_generate_group_matches — idempotent round robin
-- ---------------------------------------------------------------------------
-- Every unique pairing once: n*(n-1)/2 per group. Re-running with the same
-- idempotency key returns the existing set instead of duplicating fixtures.
create or replace function public.rpc_generate_group_matches(
  p_event_id        bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     bigint;
  v_ev      tournaments;
  v_grp     record;
  v_a       record;
  v_b       record;
  v_no      int := 0;
  v_created int := 0;
  v_pa      bigint;
  v_pb      bigint;
begin
  v_uid := fn_v2_assert_admin();
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'ERR_IDEMPOTENCY_KEY_REQUIRED'; end if;

  select * into v_ev from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;
  if v_ev.structure not in ('groups_knockout','groups_only') then
    raise exception 'ERR_NO_GROUP_STAGE';
  end if;
  if v_ev.lifecycle_status not in ('published','group_stage') then
    raise exception 'ERR_DRAW_NOT_PUBLISHED' using detail = v_ev.lifecycle_status;
  end if;

  -- Idempotent replay: same key, same result, no new rows.
  if exists (select 1 from tournament_matches
              where tournament_id = p_event_id and generation_key = p_idempotency_key) then
    select count(*) into v_created from tournament_matches
     where tournament_id = p_event_id and generation_key = p_idempotency_key;
    return jsonb_build_object('event_id', p_event_id, 'created', 0,
      'existing', v_created, 'replayed', true);
  end if;

  -- A different key must not be able to double-book the same group stage.
  if exists (select 1 from tournament_matches
              where tournament_id = p_event_id and stage = 'group') then
    raise exception 'ERR_GROUP_MATCHES_EXIST' using
      detail = 'group fixtures already exist for this event';
  end if;

  for v_grp in
    select g.id, g.letter from tournament_groups g
     where g.tournament_id = p_event_id order by g.sort_order
  loop
    for v_a in
      select ge.entry_id, ge.slot from tournament_group_entries ge
       where ge.group_id = v_grp.id order by ge.slot
    loop
      for v_b in
        select ge.entry_id, ge.slot from tournament_group_entries ge
         where ge.group_id = v_grp.id and ge.slot > v_a.slot order by ge.slot
      loop
        v_no := v_no + 1;

        -- Compat surface: the reward/EXP RPCs still read player_a/player_b.
        select player_id into v_pa from tournament_entry_members
         where entry_id = v_a.entry_id order by member_order limit 1;
        select player_id into v_pb from tournament_entry_members
         where entry_id = v_b.entry_id order by member_order limit 1;

        insert into tournament_matches (
          tournament_id, group_id, group_letter, stage, status,
          entry_a_id, entry_b_id, player_a, player_b,
          match_no, generation_key, games)
        values (p_event_id, v_grp.id, v_grp.letter, 'group', 'ready',
                v_a.entry_id, v_b.entry_id, v_pa, v_pb,
                v_no, p_idempotency_key, '[]'::jsonb);
        v_created := v_created + 1;
      end loop;
    end loop;
  end loop;

  if v_created = 0 then raise exception 'ERR_NO_FIXTURES_GENERATED'; end if;

  update tournaments
     set lifecycle_status = 'group_stage', lock_version = lock_version + 1
   where id = p_event_id and lifecycle_status = 'published';

  perform log_admin_action('tournament_v2_generate_group_matches', 'tournaments',
    p_event_id::text, null, jsonb_build_object('created', v_created, 'key', p_idempotency_key));

  return jsonb_build_object('event_id', p_event_id, 'created', v_created, 'replayed', false);
end $$;

-- ---------------------------------------------------------------------------
-- Execution privileges
-- ---------------------------------------------------------------------------
-- fn_event_standings is readable by anyone: the public hub renders it.
revoke execute on function public.fn_event_standings(bigint) from public;
grant  execute on function public.fn_event_standings(bigint) to anon, authenticated;
revoke execute on function public.rpc_compute_event_standings(bigint) from public;
grant  execute on function public.rpc_compute_event_standings(bigint) to anon, authenticated;
revoke execute on function public.rpc_admin_assign_groups(bigint, jsonb, bigint, int, text) from public;
grant  execute on function public.rpc_admin_assign_groups(bigint, jsonb, bigint, int, text) to anon, authenticated;
revoke execute on function public.rpc_admin_publish_draw(bigint, int) from public;
grant  execute on function public.rpc_admin_publish_draw(bigint, int) to anon, authenticated;
revoke execute on function public.rpc_generate_group_matches(bigint, text) from public;
grant  execute on function public.rpc_generate_group_matches(bigint, text) to anon, authenticated;

-- ============================================================================
-- ROLLBACK
--   drop function if exists public.rpc_generate_group_matches(bigint,text);
--   drop function if exists public.rpc_admin_publish_draw(bigint,int);
--   drop function if exists public.rpc_admin_assign_groups(bigint,jsonb,bigint,int,text);
--   drop function if exists public.rpc_compute_event_standings(bigint);
--   drop function if exists public.fn_event_standings(bigint);
-- ============================================================================
