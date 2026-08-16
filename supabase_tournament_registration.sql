-- ============================================================================
-- Tournament System Upgrade — Phase 3: registration + creation RPCs
-- ============================================================================
-- Replaces:
--   - dbCreateTournament's raw unauthenticated POST -> rpc_tournament_create
--     (admin-only, server validates format/tier/match_type/capacity)
--   - claimTournamentSlot -> _patchTournamentConfig's racy client-side
--     read-modify-write PATCH of the whole groups jsonb -> rpc_tournament_register
--     / rpc_tournament_unregister, both atomic (row-locked) SECURITY DEFINER
--     functions keyed off session_uid(), never a client-supplied player id.
--
-- Two registration config shapes live inside the same _config sentinel object
-- (tournaments.groups jsonb), branched on tournaments.format:
--   round_robin_groups (existing, UNCHANGED shape): _config.slots is
--     {groupLetter: [playerId|null, ...]} for 1v1, or
--     {groupLetter: [[playerId|null, playerId|null], ...]} for 2v2 — exactly
--     what createTournament()/claimTournamentSlot() already produce/consume.
--   single_elimination (new): _config.entrants is a flat
--     [{playerId, partnerId}] array (partnerId null for singles) — there are
--     no round-robin groups to key into since the bracket doesn't exist until
--     rpc_tournament_generate_bracket (Phase 4) runs.
-- ============================================================================

create or replace function rpc_tournament_create(
  p_name text,
  p_tier text,
  p_match_type text,
  p_format text,
  p_groups jsonb,
  p_max_participants int default null,
  p_registration_deadline timestamptz default null
) returns tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row tournaments;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;
  if p_format not in ('round_robin_groups','single_elimination') then
    raise exception 'invalid_format';
  end if;
  if p_match_type not in ('1v1','2v2') then
    raise exception 'invalid_match_type';
  end if;
  if trim(coalesce(p_name,'')) = '' then
    raise exception 'invalid_name';
  end if;
  if p_format = 'single_elimination' then
    if p_max_participants is null or p_max_participants < 2 or p_max_participants > 32 then
      raise exception 'invalid_max_participants';
    end if;
  end if;

  insert into tournaments (name, tier, groups, format, max_participants, registration_deadline)
  values (p_name, p_tier, coalesce(p_groups, '[]'::jsonb), p_format, p_max_participants, p_registration_deadline)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.rpc_tournament_create(text, text, text, text, jsonb, int, timestamptz) to anon, authenticated;


create or replace function rpc_tournament_register(
  p_tournament_id bigint,
  p_group text default null,
  p_slot_idx int default null,
  p_sub_idx int default null,
  p_partner_id bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid bigint;
  v_t tournaments%rowtype;
  v_groups jsonb;
  v_cfg jsonb;
  v_cfg_idx int;
  v_slots jsonb;
  v_is2v2 boolean;
  v_target jsonb;
  v_already boolean;
  v_entrants jsonb;
  v_i int;
  v_entry jsonb;
begin
  v_uid := session_uid();
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if v_t.status <> 'active' then raise exception 'tournament_not_active'; end if;

  v_groups := coalesce(v_t.groups, '[]'::jsonb);

  select ord - 1, elem into v_cfg_idx, v_cfg
  from jsonb_array_elements(v_groups) with ordinality as t(elem, ord)
  where (elem->>'_config')::boolean is true
  limit 1;

  if v_cfg is null then raise exception 'registration_not_configured'; end if;
  if coalesce((v_cfg->>'registrationOpen')::boolean, false) is not true then
    raise exception 'registration_closed';
  end if;
  if v_t.registration_deadline is not null and now() > v_t.registration_deadline then
    raise exception 'deadline_passed';
  end if;

  v_is2v2 := (v_cfg->>'matchType') = '2v2';

  if v_t.format = 'round_robin_groups' then
    if p_group is null or p_slot_idx is null then raise exception 'invalid_slot'; end if;
    v_slots := coalesce(v_cfg->'slots', '{}'::jsonb);
    if not (v_slots ? p_group) then raise exception 'invalid_group'; end if;
    if p_slot_idx < 0 or p_slot_idx >= jsonb_array_length(v_slots->p_group) then
      raise exception 'invalid_slot';
    end if;

    -- one slot per player, anywhere in this tournament
    select true into v_already
    from jsonb_each(v_slots) g(gk, gv),
         jsonb_array_elements(gv) with ordinality s(sv, sidx)
    where (v_is2v2 and (sv->>0 = v_uid::text or sv->>1 = v_uid::text))
       or (not v_is2v2 and sv::text = v_uid::text)
    limit 1;
    if v_already then raise exception 'already_registered'; end if;

    if v_is2v2 then
      if p_sub_idx is null or p_sub_idx not in (0,1) then raise exception 'invalid_slot'; end if;
      v_target := (v_slots->p_group->p_slot_idx)->p_sub_idx;
      if v_target is not null and v_target <> 'null'::jsonb then raise exception 'slot_taken'; end if;
      v_slots := jsonb_set(v_slots, array[p_group, p_slot_idx::text, p_sub_idx::text], to_jsonb(v_uid));
    else
      v_target := v_slots->p_group->p_slot_idx;
      if v_target is not null and v_target <> 'null'::jsonb then raise exception 'slot_taken'; end if;
      v_slots := jsonb_set(v_slots, array[p_group, p_slot_idx::text], to_jsonb(v_uid));
    end if;

    v_cfg := jsonb_set(v_cfg, '{slots}', v_slots);

  else -- single_elimination
    v_entrants := coalesce(v_cfg->'entrants', '[]'::jsonb);
    if v_t.max_participants is not null and jsonb_array_length(v_entrants) >= v_t.max_participants then
      raise exception 'tournament_full';
    end if;
    for v_i in 0 .. jsonb_array_length(v_entrants) - 1 loop
      v_entry := v_entrants->v_i;
      if (v_entry->>'playerId')::bigint = v_uid or (v_entry->>'partnerId')::bigint = v_uid then
        raise exception 'already_registered';
      end if;
    end loop;
    if v_is2v2 then
      if p_partner_id is null or p_partner_id = v_uid then raise exception 'invalid_partner'; end if;
      if not exists (select 1 from players where id = p_partner_id) then raise exception 'invalid_partner'; end if;
      for v_i in 0 .. jsonb_array_length(v_entrants) - 1 loop
        v_entry := v_entrants->v_i;
        if (v_entry->>'playerId')::bigint = p_partner_id or (v_entry->>'partnerId')::bigint = p_partner_id then
          raise exception 'invalid_partner';
        end if;
      end loop;
      v_entrants := v_entrants || jsonb_build_array(jsonb_build_object('playerId', v_uid, 'partnerId', p_partner_id));
    else
      v_entrants := v_entrants || jsonb_build_array(jsonb_build_object('playerId', v_uid, 'partnerId', null));
    end if;
    v_cfg := jsonb_set(v_cfg, '{entrants}', v_entrants);
  end if;

  v_groups := jsonb_set(v_groups, array[v_cfg_idx::text], v_cfg);
  update tournaments set groups = v_groups where id = p_tournament_id;

  return v_cfg;
end;
$$;

grant execute on function public.rpc_tournament_register(bigint, text, int, int, bigint) to anon, authenticated;


create or replace function rpc_tournament_unregister(p_tournament_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid bigint;
  v_t tournaments%rowtype;
  v_groups jsonb;
  v_cfg jsonb;
  v_cfg_idx int;
  v_slots jsonb;
  v_is2v2 boolean;
  v_entrants jsonb;
  v_new_entrants jsonb := '[]'::jsonb;
  v_i int;
  v_entry jsonb;
  v_found boolean := false;
  v_gk text;
  v_gslots jsonb;
  v_si int;
begin
  v_uid := session_uid();
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;

  v_groups := coalesce(v_t.groups, '[]'::jsonb);
  select ord - 1, elem into v_cfg_idx, v_cfg
  from jsonb_array_elements(v_groups) with ordinality as t(elem, ord)
  where (elem->>'_config')::boolean is true
  limit 1;
  if v_cfg is null then raise exception 'registration_not_configured'; end if;

  v_is2v2 := (v_cfg->>'matchType') = '2v2';

  if v_t.format = 'round_robin_groups' then
    v_slots := coalesce(v_cfg->'slots', '{}'::jsonb);
    for v_gk in select jsonb_object_keys(v_slots) loop
      v_gslots := v_slots->v_gk;
      if v_is2v2 then
        for v_si in 0 .. jsonb_array_length(v_gslots) - 1 loop
          if (v_gslots->v_si->>0) = v_uid::text then
            v_slots := jsonb_set(v_slots, array[v_gk, v_si::text, '0'], 'null'::jsonb);
            v_found := true;
          end if;
          if (v_gslots->v_si->>1) = v_uid::text then
            v_slots := jsonb_set(v_slots, array[v_gk, v_si::text, '1'], 'null'::jsonb);
            v_found := true;
          end if;
        end loop;
      else
        for v_si in 0 .. jsonb_array_length(v_gslots) - 1 loop
          if (v_gslots->>v_si) = v_uid::text then
            v_slots := jsonb_set(v_slots, array[v_gk, v_si::text], 'null'::jsonb);
            v_found := true;
          end if;
        end loop;
      end if;
    end loop;
    if not v_found then raise exception 'not_registered'; end if;
    v_cfg := jsonb_set(v_cfg, '{slots}', v_slots);
  else
    v_entrants := coalesce(v_cfg->'entrants', '[]'::jsonb);
    for v_i in 0 .. jsonb_array_length(v_entrants) - 1 loop
      v_entry := v_entrants->v_i;
      if (v_entry->>'playerId')::bigint = v_uid then
        v_found := true;
      else
        v_new_entrants := v_new_entrants || jsonb_build_array(v_entry);
      end if;
    end loop;
    if not v_found then raise exception 'not_registered'; end if;
    v_cfg := jsonb_set(v_cfg, '{entrants}', v_new_entrants);
  end if;

  v_groups := jsonb_set(v_groups, array[v_cfg_idx::text], v_cfg);
  update tournaments set groups = v_groups where id = p_tournament_id;

  return v_cfg;
end;
$$;

grant execute on function public.rpc_tournament_unregister(bigint) to anon, authenticated;
