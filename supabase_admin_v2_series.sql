-- Admin V2 Phase 4 — Tournament Studio
-- Applied directly to production (project tprmqsfbeyqurwqpmpia) via Supabase MCP
-- on 2026-08-21. Additive only.
--
-- Design decision (see the plan's "Events model" section, approved): a
-- tournament_series PARENT wraps existing `tournaments` rows as its events
-- (series_id + event_kind + event_label). This is the whole reason the
-- decision was made this way — every existing knockout RPC
-- (rpc_tournament_generate_knockout, rpc_tournament_submit_knockout_result,
-- rpc_tournament_correct_knockout_result, rpc_tournament_grant_rewards), the
-- .brmx-* bracket viewer, and the public tournament viewer are UNTOUCHED by
-- this migration. series_id is nullable so every existing/legacy standalone
-- tournament (series_id IS NULL) keeps rendering exactly as it does today.

create table if not exists tournament_series (
  id bigserial primary key,
  name text not null,
  description text,
  event_date date,
  location text,
  cover_url text,
  is_public boolean not null default true,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_by bigint references players(id),
  created_at timestamptz not null default now()
);
alter table tournament_series enable row level security;
create policy series_read on tournament_series for select using (true);
create policy series_insert_admin on tournament_series for insert with check (is_admin_caller());
create policy series_update_admin on tournament_series for update using (is_admin_caller());
create policy series_delete_admin on tournament_series for delete using (is_admin_caller());

alter table tournaments add column if not exists series_id bigint references tournament_series(id);
alter table tournaments add column if not exists event_kind text;
alter table tournaments add column if not exists event_label text;
create index if not exists idx_tournaments_series on tournaments(series_id);

-- tournaments already has tournaments_update_admin RLS (USING(is_admin_caller())),
-- the same policy the existing client already relies on for direct PATCHes of
-- `groups`/`reward_overrides` — series_id/event_kind/event_label are written
-- the same established way, no new RPC needed for that part.

-- ── rpc_admin_register_entrant / rpc_admin_unregister_entrant ──────────────
-- rpc_tournament_register/_unregister (registration.sql) always act on
-- session_uid() — the CALLING session's own player — so there is currently no
-- way for an admin to place a *different* player into a slot on their behalf.
-- These mirror that exact slot-jsonb logic (verified against the live
-- function bodies before writing this) but take an explicit target player
-- and are admin-gated + logged.
create or replace function rpc_admin_register_entrant(p_tournament_id bigint, p_group text, p_slot_idx int, p_sub_idx int, p_target_player bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_groups jsonb;
  v_cfg jsonb;
  v_cfg_idx int;
  v_slots jsonb;
  v_is2v2 boolean;
  v_target jsonb;
  v_already boolean;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason_required'; end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;

  v_groups := coalesce(v_t.groups, '[]'::jsonb);
  select ord - 1, elem into v_cfg_idx, v_cfg
    from jsonb_array_elements(v_groups) with ordinality as t(elem, ord)
    where (elem->>'_config')::boolean is true
    limit 1;
  if v_cfg is null then raise exception 'registration_not_configured'; end if;

  v_is2v2 := (v_cfg->>'matchType') = '2v2';
  v_slots := coalesce(v_cfg->'slots', '{}'::jsonb);
  if not (v_slots ? p_group) then raise exception 'invalid_group'; end if;
  if p_slot_idx < 0 or p_slot_idx >= jsonb_array_length(v_slots->p_group) then raise exception 'invalid_slot'; end if;

  select true into v_already
    from jsonb_each(v_slots) g(gk, gv), jsonb_array_elements(gv) with ordinality s(sv, sidx)
    where (v_is2v2 and (sv->>0 = p_target_player::text or sv->>1 = p_target_player::text))
       or (not v_is2v2 and sv::text = p_target_player::text)
    limit 1;
  if v_already then raise exception 'already_registered'; end if;

  if v_is2v2 then
    if p_sub_idx is null or p_sub_idx not in (0, 1) then raise exception 'invalid_slot'; end if;
    v_target := (v_slots->p_group->p_slot_idx)->p_sub_idx;
    if v_target is not null and v_target <> 'null'::jsonb then raise exception 'slot_taken'; end if;
    v_slots := jsonb_set(v_slots, array[p_group, p_slot_idx::text, p_sub_idx::text], to_jsonb(p_target_player));
  else
    v_target := v_slots->p_group->p_slot_idx;
    if v_target is not null and v_target <> 'null'::jsonb then raise exception 'slot_taken'; end if;
    v_slots := jsonb_set(v_slots, array[p_group, p_slot_idx::text], to_jsonb(p_target_player));
  end if;

  v_cfg := jsonb_set(v_cfg, '{slots}', v_slots);
  v_groups := jsonb_set(v_groups, array[v_cfg_idx::text], v_cfg);
  update tournaments set groups = v_groups where id = p_tournament_id;

  perform log_admin_action('register_entrant', 'tournaments', p_tournament_id::text, null,
    jsonb_build_object('group', p_group, 'slot_idx', p_slot_idx, 'sub_idx', p_sub_idx, 'target_player', p_target_player, 'reason', p_reason));
  return v_cfg;
end;
$$;
grant execute on function rpc_admin_register_entrant(bigint, text, int, int, bigint, text) to anon, authenticated;

create or replace function rpc_admin_unregister_entrant(p_tournament_id bigint, p_target_player bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_groups jsonb;
  v_cfg jsonb;
  v_cfg_idx int;
  v_slots jsonb;
  v_is2v2 boolean;
  v_found boolean := false;
  v_gk text;
  v_gslots jsonb;
  v_si int;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason_required'; end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;

  v_groups := coalesce(v_t.groups, '[]'::jsonb);
  select ord - 1, elem into v_cfg_idx, v_cfg
    from jsonb_array_elements(v_groups) with ordinality as t(elem, ord)
    where (elem->>'_config')::boolean is true
    limit 1;
  if v_cfg is null then raise exception 'registration_not_configured'; end if;

  v_is2v2 := (v_cfg->>'matchType') = '2v2';
  v_slots := coalesce(v_cfg->'slots', '{}'::jsonb);
  for v_gk in select jsonb_object_keys(v_slots) loop
    v_gslots := v_slots->v_gk;
    if v_is2v2 then
      for v_si in 0 .. jsonb_array_length(v_gslots) - 1 loop
        if (v_gslots->v_si->>0) = p_target_player::text then
          v_slots := jsonb_set(v_slots, array[v_gk, v_si::text, '0'], 'null'::jsonb);
          v_found := true;
        end if;
        if (v_gslots->v_si->>1) = p_target_player::text then
          v_slots := jsonb_set(v_slots, array[v_gk, v_si::text, '1'], 'null'::jsonb);
          v_found := true;
        end if;
      end loop;
    else
      for v_si in 0 .. jsonb_array_length(v_gslots) - 1 loop
        if (v_gslots->>v_si) = p_target_player::text then
          v_slots := jsonb_set(v_slots, array[v_gk, v_si::text], 'null'::jsonb);
          v_found := true;
        end if;
      end loop;
    end if;
  end loop;
  if not v_found then raise exception 'not_registered'; end if;

  v_cfg := jsonb_set(v_cfg, '{slots}', v_slots);
  v_groups := jsonb_set(v_groups, array[v_cfg_idx::text], v_cfg);
  update tournaments set groups = v_groups where id = p_tournament_id;

  perform log_admin_action('unregister_entrant', 'tournaments', p_tournament_id::text, null,
    jsonb_build_object('target_player', p_target_player, 'reason', p_reason));
  return v_cfg;
end;
$$;
grant execute on function rpc_admin_unregister_entrant(bigint, bigint, text) to anon, authenticated;
