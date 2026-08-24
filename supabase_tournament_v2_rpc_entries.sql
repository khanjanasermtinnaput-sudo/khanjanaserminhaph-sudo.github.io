-- ============================================================================
-- Tournament V2 — entries: admin import, self-registration, partner invites
-- ============================================================================
-- Player-facing RPCs derive identity from session_uid() and NEVER accept a
-- caller-supplied player id, so a client cannot register (or withdraw) someone
-- else by editing the request body.
--
-- Capacity and deadline are enforced under a row lock on the event, so two
-- simultaneous registrations for the last slot cannot both succeed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- rpc_admin_import_entries
-- ---------------------------------------------------------------------------
-- Bulk create entries from the roster/CSV/paste importer. Each element of
-- p_entries is {"player_ids":[id] | [id1,id2], "seed":int?, "display_name":text?}.
-- Rows that cannot be created are reported back rather than silently dropped —
-- the importer shows them to the admin for resolution.
create or replace function public.rpc_admin_import_entries(
  p_event_id         bigint,
  p_entries          jsonb,
  p_expected_version int,
  p_replace          boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       bigint;
  v_ev        tournaments;
  v_item      jsonb;
  v_ids       bigint[];
  v_type      text;
  v_entry_id  bigint;
  v_inserted  int := 0;
  v_rejected  jsonb := '[]'::jsonb;
  v_existing  int;
  v_capacity  int;
  i           int;
begin
  v_uid := fn_v2_assert_admin();

  select * into v_ev from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;
  if v_ev.lock_version <> p_expected_version then raise exception 'ERR_VERSION_CONFLICT'; end if;
  if v_ev.lifecycle_status not in ('draft','roster_ready') then
    raise exception 'ERR_ROSTER_LOCKED' using
      detail = format('event is %s; entries can only be imported while draft or roster_ready',
                      v_ev.lifecycle_status);
  end if;
  if jsonb_typeof(p_entries) <> 'array' then raise exception 'ERR_BAD_PAYLOAD'; end if;

  v_type := case when coalesce(v_ev.team_size, 1) = 2 then 'doubles' else 'singles' end;

  if p_replace then
    delete from tournament_entries where tournament_id = p_event_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_entries) loop
    begin
      select array_agg(x::bigint) into v_ids
        from jsonb_array_elements_text(v_item->'player_ids') as x;

      if v_ids is null or array_length(v_ids, 1) <> coalesce(v_ev.team_size, 1) then
        v_rejected := v_rejected || jsonb_build_object(
          'item', v_item, 'code', 'ERR_MEMBER_COUNT',
          'detail', format('expected %s player(s)', coalesce(v_ev.team_size, 1)));
        continue;
      end if;

      if array_length(v_ids, 1) = 2 and v_ids[1] = v_ids[2] then
        v_rejected := v_rejected || jsonb_build_object(
          'item', v_item, 'code', 'ERR_DOUBLES_DUPLICATE_MEMBER');
        continue;
      end if;

      -- Every referenced player must exist and not be soft-deleted.
      if (select count(*) from players
           where id = any(v_ids) and deleted_at is null) <> array_length(v_ids, 1) then
        v_rejected := v_rejected || jsonb_build_object(
          'item', v_item, 'code', 'ERR_PLAYER_NOT_FOUND');
        continue;
      end if;

      insert into tournament_entries (tournament_id, entry_type, display_name, seed, source, created_by)
      values (p_event_id, v_type,
              nullif(trim(coalesce(v_item->>'display_name','')), ''),
              (v_item->>'seed')::int, 'import', v_uid)
      returning id into v_entry_id;

      for i in 1..array_length(v_ids, 1) loop
        insert into tournament_entry_members (entry_id, tournament_id, player_id, member_order, invite_status)
        values (v_entry_id, p_event_id, v_ids[i], i, 'accepted');
      end loop;

      v_inserted := v_inserted + 1;
    exception when unique_violation then
      v_rejected := v_rejected || jsonb_build_object(
        'item', v_item, 'code', 'ERR_PLAYER_ALREADY_ENTERED');
    end;
  end loop;

  -- Capacity is a warning at import time, not a hard stop: the admin may be
  -- deliberately over-filling before trimming. It is enforced hard on the
  -- player-facing path and again at roster_ready.
  v_capacity := v_ev.max_participants;
  select count(*) into v_existing
    from tournament_entries where tournament_id = p_event_id and status = 'registered';

  update tournaments set lock_version = lock_version + 1 where id = p_event_id;

  perform log_admin_action('tournament_v2_import_entries', 'tournaments', p_event_id::text,
    null, jsonb_build_object('inserted', v_inserted,
                             'rejected', jsonb_array_length(v_rejected)));

  return jsonb_build_object(
    'inserted', v_inserted,
    'rejected', v_rejected,
    'total_registered', v_existing,
    'capacity', v_capacity,
    'over_capacity', (v_capacity is not null and v_existing > v_capacity),
    'lock_version', v_ev.lock_version + 1);
end $$;

-- ---------------------------------------------------------------------------
-- rpc_register_event  (player-facing)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_register_event(
  p_event_id   bigint,
  p_partner_id bigint default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      bigint;
  v_ev       tournaments;
  v_entry_id bigint;
  v_count    int;
  v_status   text := 'registered';
begin
  v_uid := session_uid();
  if v_uid is null then raise exception 'ERR_NOT_AUTHENTICATED'; end if;

  -- FOR UPDATE serialises concurrent registrations so the capacity check below
  -- cannot be won twice for the same final slot.
  select * into v_ev from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;

  if v_ev.lifecycle_status not in ('draft','roster_ready') then
    raise exception 'ERR_REGISTRATION_CLOSED';
  end if;
  if v_ev.registration_deadline is not null and now() > v_ev.registration_deadline then
    raise exception 'ERR_REGISTRATION_DEADLINE_PASSED';
  end if;

  if exists (select 1 from tournament_entry_members
              where tournament_id = p_event_id and player_id = v_uid and entry_active) then
    raise exception 'ERR_ALREADY_REGISTERED';
  end if;

  if coalesce(v_ev.team_size, 1) = 2 then
    if p_partner_id is null then raise exception 'ERR_PARTNER_REQUIRED'; end if;
    if p_partner_id = v_uid then raise exception 'ERR_DOUBLES_DUPLICATE_MEMBER'; end if;
    if not exists (select 1 from players where id = p_partner_id and deleted_at is null) then
      raise exception 'ERR_PLAYER_NOT_FOUND';
    end if;
    if exists (select 1 from tournament_entry_members
                where tournament_id = p_event_id and player_id = p_partner_id and entry_active) then
      raise exception 'ERR_PARTNER_ALREADY_REGISTERED';
    end if;
  end if;

  select count(*) into v_count
    from tournament_entries where tournament_id = p_event_id and status = 'registered';
  if v_ev.max_participants is not null and v_count >= v_ev.max_participants then
    v_status := 'waitlisted';
  end if;

  insert into tournament_entries (tournament_id, entry_type, status, source, created_by)
  values (p_event_id,
          case when coalesce(v_ev.team_size, 1) = 2 then 'doubles' else 'singles' end,
          v_status, 'self', v_uid)
  returning id into v_entry_id;

  insert into tournament_entry_members (entry_id, tournament_id, player_id, member_order, invite_status, responded_at)
  values (v_entry_id, p_event_id, v_uid, 1, 'accepted', now());

  if coalesce(v_ev.team_size, 1) = 2 then
    insert into tournament_entry_members (entry_id, tournament_id, player_id, member_order, invite_status, invited_by)
    values (v_entry_id, p_event_id, p_partner_id, 2, 'pending', v_uid);
  end if;

  return jsonb_build_object('entry_id', v_entry_id, 'status', v_status,
    'partner_pending', (coalesce(v_ev.team_size, 1) = 2));
end $$;

-- ---------------------------------------------------------------------------
-- rpc_respond_partner_invite  (player-facing)
-- ---------------------------------------------------------------------------
-- Declining withdraws the whole entry rather than leaving a half-filled pair
-- behind; the trigger on tournament_entries then frees BOTH players to enter
-- again with someone else.
create or replace function public.rpc_respond_partner_invite(
  p_entry_id bigint,
  p_decision text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid bigint;
  v_ev  tournaments;
  v_mem tournament_entry_members;
begin
  v_uid := session_uid();
  if v_uid is null then raise exception 'ERR_NOT_AUTHENTICATED'; end if;
  if p_decision not in ('accept','decline') then raise exception 'ERR_BAD_DECISION'; end if;

  select m.* into v_mem from tournament_entry_members m
   where m.entry_id = p_entry_id and m.player_id = v_uid for update;
  if not found then raise exception 'ERR_INVITE_NOT_FOUND'; end if;
  if v_mem.invite_status <> 'pending' then raise exception 'ERR_INVITE_ALREADY_ANSWERED'; end if;

  select * into v_ev from tournaments where id = v_mem.tournament_id;
  if v_ev.lifecycle_status not in ('draft','roster_ready') then
    raise exception 'ERR_REGISTRATION_CLOSED';
  end if;

  if p_decision = 'accept' then
    update tournament_entry_members
       set invite_status = 'accepted', responded_at = now()
     where id = v_mem.id;
    return jsonb_build_object('entry_id', p_entry_id, 'invite_status', 'accepted');
  end if;

  update tournament_entry_members
     set invite_status = 'declined', responded_at = now()
   where id = v_mem.id;
  update tournament_entries set status = 'withdrawn', updated_at = now()
   where id = p_entry_id;

  return jsonb_build_object('entry_id', p_entry_id, 'invite_status', 'declined',
                            'entry_status', 'withdrawn');
end $$;

-- ---------------------------------------------------------------------------
-- rpc_withdraw_event  (player-facing)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_withdraw_event(p_event_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      bigint;
  v_ev       tournaments;
  v_entry_id bigint;
begin
  v_uid := session_uid();
  if v_uid is null then raise exception 'ERR_NOT_AUTHENTICATED'; end if;

  select * into v_ev from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;
  if v_ev.lifecycle_status in ('group_stage','knockout','completed','selection_completed') then
    raise exception 'ERR_EVENT_LOCKED' using
      detail = 'the event is under way; ask an admin to record a withdrawal';
  end if;

  select entry_id into v_entry_id from tournament_entry_members
   where tournament_id = p_event_id and player_id = v_uid and entry_active limit 1;
  if v_entry_id is null then raise exception 'ERR_NOT_REGISTERED'; end if;

  update tournament_entries set status = 'withdrawn', updated_at = now() where id = v_entry_id;

  return jsonb_build_object('entry_id', v_entry_id, 'status', 'withdrawn');
end $$;

-- ---------------------------------------------------------------------------
-- rpc_admin_set_entry_status  (admin override + waitlist promotion)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_admin_set_entry_status(
  p_entry_id bigint,
  p_status   text,
  p_reason   text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_uid bigint; v_old tournament_entries;
begin
  v_uid := fn_v2_assert_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'ERR_REASON_REQUIRED'; end if;
  if p_status not in ('registered','waitlisted','withdrawn','disqualified') then
    raise exception 'ERR_BAD_ENTRY_STATUS';
  end if;

  select * into v_old from tournament_entries where id = p_entry_id for update;
  if not found then raise exception 'ERR_ENTRY_NOT_FOUND'; end if;

  update tournament_entries
     set status = p_status, updated_at = now(), lock_version = lock_version + 1
   where id = p_entry_id;

  perform log_admin_action('tournament_v2_entry_status', 'tournament_entries', p_entry_id::text,
    to_jsonb(v_old), jsonb_build_object('status', p_status, 'reason', p_reason));

  return jsonb_build_object('entry_id', p_entry_id, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------------
-- rpc_admin_substitute_member
-- ---------------------------------------------------------------------------
create or replace function public.rpc_admin_substitute_member(
  p_entry_id     bigint,
  p_out_player   bigint,
  p_in_player    bigint,
  p_reason       text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_uid bigint; v_mem tournament_entry_members; v_ev tournaments;
begin
  v_uid := fn_v2_assert_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'ERR_REASON_REQUIRED'; end if;

  select m.* into v_mem from tournament_entry_members m
   where m.entry_id = p_entry_id and m.player_id = p_out_player for update;
  if not found then raise exception 'ERR_MEMBER_NOT_FOUND'; end if;

  select * into v_ev from tournaments where id = v_mem.tournament_id;
  if v_ev.lifecycle_status in ('completed','selection_completed','cancelled') then
    raise exception 'ERR_EVENT_FINALIZED';
  end if;
  if not exists (select 1 from players where id = p_in_player and deleted_at is null) then
    raise exception 'ERR_PLAYER_NOT_FOUND';
  end if;
  if exists (select 1 from tournament_entry_members
              where tournament_id = v_mem.tournament_id and player_id = p_in_player and entry_active) then
    raise exception 'ERR_PLAYER_ALREADY_ENTERED';
  end if;

  update tournament_entry_members
     set player_id = p_in_player, invite_status = 'accepted', responded_at = now()
   where id = v_mem.id;

  perform log_admin_action('tournament_v2_substitute', 'tournament_entry_members', v_mem.id::text,
    jsonb_build_object('player_id', p_out_player),
    jsonb_build_object('player_id', p_in_player, 'reason', p_reason));

  return jsonb_build_object('entry_id', p_entry_id, 'out', p_out_player, 'in', p_in_player);
end $$;

-- ---------------------------------------------------------------------------
-- Execution privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.rpc_admin_import_entries(bigint, jsonb, int, boolean) from public;
grant  execute on function public.rpc_admin_import_entries(bigint, jsonb, int, boolean) to anon, authenticated;
revoke execute on function public.rpc_register_event(bigint, bigint) from public;
grant  execute on function public.rpc_register_event(bigint, bigint) to anon, authenticated;
revoke execute on function public.rpc_respond_partner_invite(bigint, text) from public;
grant  execute on function public.rpc_respond_partner_invite(bigint, text) to anon, authenticated;
revoke execute on function public.rpc_withdraw_event(bigint) from public;
grant  execute on function public.rpc_withdraw_event(bigint) to anon, authenticated;
revoke execute on function public.rpc_admin_set_entry_status(bigint, text, text) from public;
grant  execute on function public.rpc_admin_set_entry_status(bigint, text, text) to anon, authenticated;
revoke execute on function public.rpc_admin_substitute_member(bigint, bigint, bigint, text) from public;
grant  execute on function public.rpc_admin_substitute_member(bigint, bigint, bigint, text) to anon, authenticated;

-- ============================================================================
-- ROLLBACK
--   drop function if exists public.rpc_admin_substitute_member(bigint,bigint,bigint,text);
--   drop function if exists public.rpc_admin_set_entry_status(bigint,text,text);
--   drop function if exists public.rpc_withdraw_event(bigint);
--   drop function if exists public.rpc_respond_partner_invite(bigint,text);
--   drop function if exists public.rpc_register_event(bigint,bigint);
--   drop function if exists public.rpc_admin_import_entries(bigint,jsonb,int,boolean);
-- ============================================================================
