-- ============================================================================
-- Tournament V2 — admin RPCs: atomic series creation, event config, lifecycle
-- ============================================================================
-- Every function here is SECURITY DEFINER with a hardened search_path, asserts
-- session_uid() + is_admin_caller() before touching anything, and writes an
-- admin_actions audit row via log_admin_action.
--
-- GRANT NOTE: this database's ALTER DEFAULT PRIVILEGES already grants EXECUTE
-- on every new function to anon/authenticated, so `revoke ... from public` does
-- NOT lock a function down here. Internal helpers are revoked from anon and
-- authenticated by name; the RPCs are then granted back deliberately.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.fn_v2_assert_admin()
returns bigint
language plpgsql stable security definer set search_path = public
as $$
declare v_uid bigint;
begin
  v_uid := session_uid();
  if v_uid is null then raise exception 'ERR_NOT_AUTHENTICATED'; end if;
  if not is_admin_caller() then raise exception 'ERR_NOT_ADMIN'; end if;
  return v_uid;
end $$;

-- Team size is a property of the category, never of admin input. Singles are
-- one player; every doubles category is exactly two. This is why the wizard
-- renders team size as read-only.
create or replace function public.fn_v2_team_size(p_event_kind text, p_override int default null)
returns int
language sql immutable set search_path = public
as $$
  select case
    when p_event_kind in ('ms', 'ws') then 1
    when p_event_kind in ('md', 'wd', 'xd') then 2
    when p_event_kind = 'custom' then coalesce(p_override, 1)
    else null
  end;
$$;

-- Scoring is a property of the EVENT, not of the commercial tier. Pre-V2 code
-- inferred best-of-3 from tier = 'Super 1000' in three separate places.
create or replace function public.fn_v2_scoring_config(p_preset text, p_custom jsonb default null)
returns jsonb
language plpgsql immutable set search_path = public
as $$
declare
  v_points int; v_cap int; v_max int; v_win_by int;
begin
  if p_preset = 'bwf_standard' then
    return jsonb_build_object('points_to_win',21,'win_by',2,'cap',30,'max_games',3,'games_to_win',2);
  elsif p_preset = 'one_game_21' then
    return jsonb_build_object('points_to_win',21,'win_by',2,'cap',30,'max_games',1,'games_to_win',1);
  elsif p_preset = 'custom' then
    if p_custom is null then raise exception 'ERR_SCORING_CONFIG_REQUIRED'; end if;
    v_points  := coalesce((p_custom->>'points_to_win')::int, 21);
    v_cap     := coalesce((p_custom->>'cap')::int, v_points + 9);
    v_max     := coalesce((p_custom->>'max_games')::int, 1);
    v_win_by  := coalesce((p_custom->>'win_by')::int, 2);

    if v_points < 5  or v_points > 50 then raise exception 'ERR_SCORING_POINTS_RANGE'; end if;
    if v_cap    < v_points            then raise exception 'ERR_SCORING_CAP_TOO_LOW'; end if;
    if v_max    < 1  or v_max > 9     then raise exception 'ERR_SCORING_GAMES_RANGE'; end if;
    if v_max % 2 = 0                  then raise exception 'ERR_SCORING_GAMES_MUST_BE_ODD'; end if;
    if v_win_by < 1  or v_win_by > 5  then raise exception 'ERR_SCORING_WIN_BY_RANGE'; end if;

    return jsonb_build_object('points_to_win',v_points,'win_by',v_win_by,'cap',v_cap,
                              'max_games',v_max,'games_to_win',(v_max / 2) + 1);
  end if;
  raise exception 'ERR_BAD_SCORING_PRESET';
end $$;

-- The event state machine, in one place. Server-side enforcement means the UI
-- cannot skip a stage by calling a later RPC first.
create or replace function public.fn_v2_lifecycle_allowed(
  p_from text, p_to text, p_structure text, p_purpose text)
returns boolean
language sql immutable set search_path = public
as $$
  select case
    when p_from = p_to then true
    when p_to = 'cancelled' then p_from not in ('completed','selection_completed','cancelled')
    when p_from = 'draft'        then p_to = 'roster_ready'
    when p_from = 'roster_ready' then p_to in ('draw_ready','draft')
    when p_from = 'draw_ready'   then p_to in ('published','roster_ready')
    when p_from = 'published'    then
      (p_to = 'group_stage' and p_structure in ('groups_knockout','groups_only'))
      or (p_to = 'knockout' and p_structure = 'knockout_only')
    when p_from = 'group_stage'  then
      (p_to = 'knockout' and p_structure = 'groups_knockout')
      or (p_to = 'completed' and p_structure = 'groups_only' and p_purpose = 'championship')
      or (p_to = 'selection_completed' and p_purpose = 'selection')
    when p_from = 'knockout' then
      p_to = 'completed' or (p_to = 'selection_completed' and p_purpose = 'selection')
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- rpc_admin_create_series_with_events
-- ---------------------------------------------------------------------------
-- ONE admin action creates the series and every enabled event. Validation runs
-- over the whole payload BEFORE the first insert, so a partial series (two of
-- five events) is not a reachable state.
create or replace function public.rpc_admin_create_series_with_events(
  p_series jsonb,
  p_events jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid        bigint;
  v_series_id  bigint;
  v_event      jsonb;
  v_kind       text;
  v_kinds      text[] := '{}';
  v_purpose    text;
  v_structure  text;
  v_groups     int;
  v_per_group  int;
  v_advance    int;
  v_team_size  int;
  v_preset     text;
  v_event_id   bigint;
  v_out        jsonb := '[]'::jsonb;
  v_court      int;
  i            int;
begin
  v_uid := fn_v2_assert_admin();

  if coalesce(trim(p_series->>'name'), '') = '' then
    raise exception 'ERR_SERIES_NAME_REQUIRED';
  end if;

  v_purpose := coalesce(p_series->>'purpose', 'championship');
  if v_purpose not in ('championship', 'selection') then
    raise exception 'ERR_BAD_PURPOSE';
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'ERR_NO_EVENTS';
  end if;
  if jsonb_array_length(p_events) > 12 then
    raise exception 'ERR_TOO_MANY_EVENTS';
  end if;

  -- ---- Pass 1: validate everything, write nothing --------------------------
  for v_event in select * from jsonb_array_elements(p_events) loop
    if coalesce((v_event->>'enabled')::boolean, true) is false then
      continue;
    end if;

    v_kind := v_event->>'event_kind';
    if v_kind is null or v_kind not in ('ms','ws','md','wd','xd','custom') then
      raise exception 'ERR_BAD_EVENT_KIND' using detail = coalesce(v_kind, 'null');
    end if;
    if v_kind <> 'custom' and v_kind = any(v_kinds) then
      raise exception 'ERR_DUPLICATE_EVENT_KIND' using detail = v_kind;
    end if;
    v_kinds := v_kinds || v_kind;

    v_structure := coalesce(v_event->>'structure', 'groups_knockout');
    if v_structure not in ('groups_knockout','knockout_only','groups_only') then
      raise exception 'ERR_BAD_STRUCTURE' using detail = v_structure;
    end if;

    v_preset := coalesce(v_event->>'scoring_preset', 'one_game_21');
    perform fn_v2_scoring_config(v_preset, v_event->'scoring_config');

    if v_structure in ('groups_knockout','groups_only') then
      v_groups    := coalesce((v_event->>'group_count')::int, 2);
      v_per_group := coalesce((v_event->>'teams_per_group')::int, 4);
      v_advance   := coalesce((v_event->>'advance_per_group')::int, 1);

      if v_groups    < 1 or v_groups    > 8 then raise exception 'ERR_GROUP_COUNT_RANGE'; end if;
      if v_per_group < 2 or v_per_group > 8 then raise exception 'ERR_TEAMS_PER_GROUP_RANGE'; end if;
      if v_advance   < 1                    then raise exception 'ERR_ADVANCE_RANGE'; end if;
      if v_advance > v_per_group then
        raise exception 'ERR_ADVANCE_EXCEEDS_TEAMS' using
          detail = format('%s advancers from a group of %s', v_advance, v_per_group);
      end if;

      -- groups_knockout must yield at least two qualifiers, or there is no bracket
      if v_structure = 'groups_knockout' and (v_groups * v_advance) < 2 then
        raise exception 'ERR_TOO_FEW_QUALIFIERS';
      end if;
    end if;

    if v_purpose = 'selection' then
      if coalesce((v_event->>'selected_count')::int, 0) < 1 then
        raise exception 'ERR_SELECTION_COUNT_REQUIRED' using detail = v_kind;
      end if;
    end if;

    if fn_v2_team_size(v_kind, (v_event->>'team_size')::int) is null then
      raise exception 'ERR_BAD_EVENT_KIND' using detail = v_kind;
    end if;
  end loop;

  -- ---- Pass 2: write, all inside this one transaction ----------------------
  insert into tournament_series (
    name, description, event_date, location, cover_url, is_public, status,
    purpose, starts_at, ends_at, court_count, registration_deadline,
    organizer_contact, lifecycle_status, created_by
  ) values (
    trim(p_series->>'name'),
    nullif(trim(coalesce(p_series->>'description','')), ''),
    (p_series->>'event_date')::date,
    nullif(trim(coalesce(p_series->>'location','')), ''),
    nullif(trim(coalesce(p_series->>'cover_url','')), ''),
    coalesce((p_series->>'is_public')::boolean, true),
    'active',
    v_purpose,
    (p_series->>'starts_at')::timestamptz,
    (p_series->>'ends_at')::timestamptz,
    (p_series->>'court_count')::int,
    (p_series->>'registration_deadline')::timestamptz,
    nullif(trim(coalesce(p_series->>'organizer_contact','')), ''),
    'draft',
    v_uid
  ) returning id into v_series_id;

  v_court := coalesce((p_series->>'court_count')::int, 0);
  if v_court > 0 then
    for i in 1..least(v_court, 64) loop
      insert into tournament_courts (series_id, court_no, label)
      values (v_series_id, i, format('คอร์ต %s', i));
    end loop;
  end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    if coalesce((v_event->>'enabled')::boolean, true) is false then
      continue;
    end if;

    v_kind      := v_event->>'event_kind';
    v_structure := coalesce(v_event->>'structure', 'groups_knockout');
    v_preset    := coalesce(v_event->>'scoring_preset', 'one_game_21');
    v_team_size := fn_v2_team_size(v_kind, (v_event->>'team_size')::int);

    if v_structure in ('groups_knockout','groups_only') then
      v_groups    := coalesce((v_event->>'group_count')::int, 2);
      v_per_group := coalesce((v_event->>'teams_per_group')::int, 4);
      v_advance   := coalesce((v_event->>'advance_per_group')::int, 1);
    else
      v_groups := null; v_per_group := null; v_advance := null;
    end if;

    insert into tournaments (
      name, tier, status, groups, series_id, event_kind, event_label,
      team_size, purpose, structure, group_count, teams_per_group, advance_per_group,
      scoring_preset, scoring_config, selected_count, reserve_count,
      max_participants, registration_deadline, is_published, lifecycle_status
    ) values (
      coalesce(nullif(trim(coalesce(v_event->>'name','')), ''),
               trim(p_series->>'name') || ' — ' || coalesce(v_event->>'event_label', v_kind)),
      coalesce(v_event->>'tier', 'Regular'),
      'active',
      '[]'::jsonb,              -- legacy column: V2 never reads or writes it
      v_series_id,
      v_kind,
      v_event->>'event_label',
      v_team_size,
      v_purpose,
      v_structure,
      v_groups,
      v_per_group,
      v_advance,
      v_preset,
      fn_v2_scoring_config(v_preset, v_event->'scoring_config'),
      (v_event->>'selected_count')::int,
      (v_event->>'reserve_count')::int,
      (v_event->>'capacity')::int,
      (v_event->>'registration_deadline')::timestamptz,
      false,
      'draft'
    ) returning id into v_event_id;

    if v_groups is not null then
      for i in 1..v_groups loop
        insert into tournament_groups (tournament_id, letter, sort_order, advance_count)
        values (v_event_id, chr(64 + i), i, v_advance);
      end loop;
    end if;

    v_out := v_out || jsonb_build_object(
      'id', v_event_id, 'event_kind', v_kind, 'team_size', v_team_size,
      'structure', v_structure, 'group_count', v_groups);
  end loop;

  perform log_admin_action(
    'tournament_v2_create_series', 'tournament_series', v_series_id::text, null,
    jsonb_build_object('series', p_series, 'events', v_out));

  return jsonb_build_object('series_id', v_series_id, 'events', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- rpc_admin_update_event_config
-- ---------------------------------------------------------------------------
-- Optimistic concurrency via lock_version. Structural fields freeze once the
-- group stage starts, so a late edit cannot invalidate matches already played.
create or replace function public.rpc_admin_update_event_config(
  p_event_id        bigint,
  p_expected_version int,
  p_config          jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       bigint;
  v_old       tournaments;
  v_structure text;
  v_groups    int;
  v_per_group int;
  v_advance   int;
  v_preset    text;
  v_locked    boolean;
  i           int;
begin
  v_uid := fn_v2_assert_admin();

  select * into v_old from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;

  if v_old.lock_version <> p_expected_version then
    raise exception 'ERR_VERSION_CONFLICT' using
      detail = format('expected %s, current %s', p_expected_version, v_old.lock_version);
  end if;

  if v_old.lifecycle_status in ('completed','selection_completed','cancelled') then
    raise exception 'ERR_EVENT_FINALIZED';
  end if;

  v_locked := v_old.lifecycle_status in ('group_stage','knockout');

  v_structure := coalesce(p_config->>'structure', v_old.structure, 'groups_knockout');
  v_preset    := coalesce(p_config->>'scoring_preset', v_old.scoring_preset, 'one_game_21');
  v_groups    := coalesce((p_config->>'group_count')::int, v_old.group_count);
  v_per_group := coalesce((p_config->>'teams_per_group')::int, v_old.teams_per_group);
  v_advance   := coalesce((p_config->>'advance_per_group')::int, v_old.advance_per_group);

  if v_locked and (
       v_structure is distinct from v_old.structure
    or v_groups    is distinct from v_old.group_count
    or v_per_group is distinct from v_old.teams_per_group
    or v_advance   is distinct from v_old.advance_per_group
  ) then
    raise exception 'ERR_STRUCTURE_LOCKED' using
      detail = 'structural configuration is frozen once the event is under way';
  end if;

  if v_structure not in ('groups_knockout','knockout_only','groups_only') then
    raise exception 'ERR_BAD_STRUCTURE';
  end if;
  if v_structure in ('groups_knockout','groups_only') then
    if v_groups    is null or v_groups    < 1 or v_groups    > 8 then raise exception 'ERR_GROUP_COUNT_RANGE'; end if;
    if v_per_group is null or v_per_group < 2 or v_per_group > 8 then raise exception 'ERR_TEAMS_PER_GROUP_RANGE'; end if;
    if v_advance   is null or v_advance   < 1 then raise exception 'ERR_ADVANCE_RANGE'; end if;
    if v_advance > v_per_group then raise exception 'ERR_ADVANCE_EXCEEDS_TEAMS'; end if;
  end if;

  update tournaments set
    name              = coalesce(nullif(trim(coalesce(p_config->>'name','')), ''), name),
    tier              = coalesce(p_config->>'tier', tier),
    event_label       = coalesce(p_config->>'event_label', event_label),
    structure         = v_structure,
    group_count       = v_groups,
    teams_per_group   = v_per_group,
    advance_per_group = v_advance,
    scoring_preset    = v_preset,
    scoring_config    = fn_v2_scoring_config(v_preset, p_config->'scoring_config'),
    selected_count    = coalesce((p_config->>'selected_count')::int, selected_count),
    reserve_count     = coalesce((p_config->>'reserve_count')::int, reserve_count),
    max_participants  = coalesce((p_config->>'capacity')::int, max_participants),
    registration_deadline = coalesce((p_config->>'registration_deadline')::timestamptz, registration_deadline),
    lock_version      = lock_version + 1
  where id = p_event_id;

  -- Keep the group rows aligned with the (possibly new) structure while the
  -- event is still editable.
  if v_structure in ('groups_knockout','groups_only') and not v_locked then
    delete from tournament_groups
      where tournament_id = p_event_id and ascii(letter) - 64 > v_groups;
    for i in 1..v_groups loop
      insert into tournament_groups (tournament_id, letter, sort_order, advance_count)
      values (p_event_id, chr(64 + i), i, coalesce(v_advance, 1))
      on conflict (tournament_id, letter) do update
        set advance_count = excluded.advance_count, sort_order = excluded.sort_order;
    end loop;
  end if;

  perform log_admin_action('tournament_v2_update_event', 'tournaments', p_event_id::text,
    to_jsonb(v_old), p_config);

  return jsonb_build_object('event_id', p_event_id, 'lock_version', v_old.lock_version + 1);
end $$;

-- ---------------------------------------------------------------------------
-- rpc_admin_set_event_lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.rpc_admin_set_event_lifecycle(
  p_event_id         bigint,
  p_next_status      text,
  p_expected_version int,
  p_reason           text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       bigint;
  v_old       tournaments;
  v_bad_pairs int;
  v_entries   int;
begin
  v_uid := fn_v2_assert_admin();

  select * into v_old from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;
  if v_old.lock_version <> p_expected_version then
    raise exception 'ERR_VERSION_CONFLICT';
  end if;

  if not fn_v2_lifecycle_allowed(v_old.lifecycle_status, p_next_status,
                                 v_old.structure, v_old.purpose) then
    raise exception 'ERR_BAD_TRANSITION' using
      detail = format('%s -> %s not allowed for structure %s / purpose %s',
                      v_old.lifecycle_status, p_next_status, v_old.structure, v_old.purpose);
  end if;

  -- roster_ready is the gate that makes "no half-filled doubles pair" real.
  if p_next_status = 'roster_ready' then
    select count(*) into v_entries
      from tournament_entries
     where tournament_id = p_event_id and status = 'registered';
    if v_entries < 2 then raise exception 'ERR_TOO_FEW_ENTRIES'; end if;

    select count(*) into v_bad_pairs
      from tournament_entries e
      left join lateral (
        select count(*) as n, count(distinct player_id) as d
          from tournament_entry_members m where m.entry_id = e.id
      ) m on true
     where e.tournament_id = p_event_id
       and e.status = 'registered'
       and (
            (e.entry_type = 'singles' and m.n <> 1)
         or (e.entry_type = 'doubles' and (m.n <> 2 or m.d <> 2))
       );
    if v_bad_pairs > 0 then
      raise exception 'ERR_INCOMPLETE_ENTRIES' using
        detail = format('%s entries do not have the required members', v_bad_pairs);
    end if;
  end if;

  update tournaments
     set lifecycle_status = p_next_status,
         is_published     = case when p_next_status = 'published' then true else is_published end,
         status           = case when p_next_status in ('completed','selection_completed')
                                 then 'completed' else status end,
         lock_version     = lock_version + 1
   where id = p_event_id;

  perform log_admin_action('tournament_v2_lifecycle', 'tournaments', p_event_id::text,
    jsonb_build_object('from', v_old.lifecycle_status),
    jsonb_build_object('to', p_next_status, 'reason', p_reason));

  return jsonb_build_object('event_id', p_event_id, 'lifecycle_status', p_next_status,
                            'lock_version', v_old.lock_version + 1);
end $$;

-- ---------------------------------------------------------------------------
-- Execution privileges
-- ---------------------------------------------------------------------------
-- Internal helpers: not part of the API surface.
revoke execute on function public.fn_v2_assert_admin()                         from public, anon, authenticated;
revoke execute on function public.fn_v2_team_size(text, int)                   from public, anon, authenticated;
revoke execute on function public.fn_v2_scoring_config(text, jsonb)            from public, anon, authenticated;
revoke execute on function public.fn_v2_lifecycle_allowed(text, text, text, text) from public, anon, authenticated;

-- RPCs: reachable by the anon key, authorization enforced inside each body.
revoke execute on function public.rpc_admin_create_series_with_events(jsonb, jsonb) from public;
grant  execute on function public.rpc_admin_create_series_with_events(jsonb, jsonb) to anon, authenticated;

revoke execute on function public.rpc_admin_update_event_config(bigint, int, jsonb) from public;
grant  execute on function public.rpc_admin_update_event_config(bigint, int, jsonb) to anon, authenticated;

revoke execute on function public.rpc_admin_set_event_lifecycle(bigint, text, int, text) from public;
grant  execute on function public.rpc_admin_set_event_lifecycle(bigint, text, int, text) to anon, authenticated;

-- ============================================================================
-- ROLLBACK
--   drop function if exists public.rpc_admin_set_event_lifecycle(bigint,text,int,text);
--   drop function if exists public.rpc_admin_update_event_config(bigint,int,jsonb);
--   drop function if exists public.rpc_admin_create_series_with_events(jsonb,jsonb);
--   drop function if exists public.fn_v2_lifecycle_allowed(text,text,text,text);
--   drop function if exists public.fn_v2_scoring_config(text,jsonb);
--   drop function if exists public.fn_v2_team_size(text,int);
--   drop function if exists public.fn_v2_assert_admin();
-- ============================================================================
