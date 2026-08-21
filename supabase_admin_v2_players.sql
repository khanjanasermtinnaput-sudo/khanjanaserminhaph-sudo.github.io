-- Admin V2 Phase 2 — Player Manager
-- Applied directly to production (project tprmqsfbeyqurwqpmpia) via Supabase MCP
-- on 2026-08-21. Additive only: no existing column dropped or retyped.
--
-- IMPORTANT (see supabase_lockdown.sql CRIT-07): `players` has COLUMN-LEVEL
-- grants, not table-level SELECT. Any new column is invisible to the client
-- until explicitly granted below — and js/db.js's PLAYER_PUBLIC_COLS must be
-- extended to match, or it silently reads undefined.
--
-- Writes to the three new columns are NOT granted at the column level on
-- purpose: every write goes through the SECURITY DEFINER RPCs below (which
-- run as the function owner and are unaffected by column grants), so every
-- privileged change is logged via log_admin_action(). This is stricter than
-- the legacy admin panel, which still writes pts/is_admin/etc. via raw PATCH
-- (that gets re-pointed in a later phase, not this one).

alter table players add column if not exists nickname text;
alter table players add column if not exists class_label text;
alter table players add column if not exists deleted_at timestamptz;

grant select (nickname, class_label, deleted_at) on players to anon, authenticated;

-- ── rpc_admin_adjust_points ────────────────────────────────────────────────
-- Replaces the raw `pts` PATCH in js/leaderboard.js saveEditPlayer(). Floors
-- at 0 (ELO should never go negative from a manual adjustment). Reason is
-- mandatory and is recorded verbatim in admin_actions.new_data.
create or replace function rpc_admin_adjust_points(p_player bigint, p_delta int, p_reason text)
returns players
language plpgsql
security definer
set search_path = public
as $$
declare v_row players%rowtype; v_old int;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required';
  end if;

  select * into v_row from players where id = p_player for update;
  if not found then raise exception 'player_not_found'; end if;
  v_old := v_row.pts;

  update players set pts = greatest(0, coalesce(v_row.pts, 0) + p_delta)
    where id = p_player returning * into v_row;

  perform log_admin_action(
    'adjust_points', 'players', p_player::text,
    jsonb_build_object('pts', v_old),
    jsonb_build_object('pts', v_row.pts, 'delta', p_delta, 'reason', p_reason)
  );
  return v_row;
end;
$$;
grant execute on function rpc_admin_adjust_points(bigint, int, text) to anon, authenticated;

-- ── rpc_admin_set_player_fields ─────────────────────────────────────────────
-- Explicit whitelist (no dynamic SQL / no arbitrary column injection).
-- Each key in p_patch is applied only if present, so a partial patch is safe.
create or replace function rpc_admin_set_player_fields(p_player bigint, p_patch jsonb, p_reason text)
returns players
language plpgsql
security definer
set search_path = public
as $$
declare v_row players%rowtype; v_old jsonb;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required';
  end if;

  select * into v_row from players where id = p_player for update;
  if not found then raise exception 'player_not_found'; end if;

  v_old := jsonb_build_object(
    'name', v_row.name, 'nickname', v_row.nickname,
    'class_label', v_row.class_label, 'is_admin', v_row.is_admin
  );

  update players set
    name        = case when p_patch ? 'name' then (p_patch->>'name') else name end,
    nickname    = case when p_patch ? 'nickname' then nullif(p_patch->>'nickname', '') else nickname end,
    class_label = case when p_patch ? 'class_label' then nullif(p_patch->>'class_label', '') else class_label end,
    is_admin    = case when p_patch ? 'is_admin' then (p_patch->>'is_admin')::boolean else is_admin end
  where id = p_player
  returning * into v_row;

  perform log_admin_action(
    'set_player_fields', 'players', p_player::text,
    v_old, p_patch || jsonb_build_object('reason', p_reason)
  );
  return v_row;
end;
$$;
grant execute on function rpc_admin_set_player_fields(bigint, jsonb, text) to anon, authenticated;

-- ── rpc_admin_soft_delete_player / rpc_admin_restore_player ────────────────
-- Replaces the hard DELETE in js/leaderboard.js deletePlayer(). A soft-deleted
-- player is filtered out of loadPlayers() (js/db.js) so they disappear from
-- the public leaderboard/rankings exactly as a hard delete would have —
-- otherwise "soft delete" would be a flag with no visible effect anywhere
-- outside Admin, which is not a real substitute for the feature it replaces.
create or replace function rpc_admin_soft_delete_player(p_player bigint, p_reason text)
returns players
language plpgsql
security definer
set search_path = public
as $$
declare v_row players%rowtype;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required';
  end if;

  update players set deleted_at = now()
    where id = p_player and deleted_at is null
    returning * into v_row;
  if not found then raise exception 'player_not_found_or_already_deleted'; end if;

  perform log_admin_action(
    'soft_delete_player', 'players', p_player::text,
    jsonb_build_object('deleted_at', null),
    jsonb_build_object('deleted_at', v_row.deleted_at, 'reason', p_reason)
  );
  return v_row;
end;
$$;
grant execute on function rpc_admin_soft_delete_player(bigint, text) to anon, authenticated;

create or replace function rpc_admin_restore_player(p_player bigint)
returns players
language plpgsql
security definer
set search_path = public
as $$
declare v_row players%rowtype;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;

  update players set deleted_at = null
    where id = p_player and deleted_at is not null
    returning * into v_row;
  if not found then raise exception 'player_not_found_or_not_deleted'; end if;

  perform log_admin_action(
    'restore_player', 'players', p_player::text,
    jsonb_build_object('deleted_at', '(was deleted)'),
    jsonb_build_object('deleted_at', null)
  );
  return v_row;
end;
$$;
grant execute on function rpc_admin_restore_player(bigint) to anon, authenticated;
