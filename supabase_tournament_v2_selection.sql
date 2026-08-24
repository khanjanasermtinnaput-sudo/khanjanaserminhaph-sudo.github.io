-- ============================================================================
-- Tournament V2 Phase 5 — selection mode finalization + court scheduling
-- ============================================================================
-- โหมดคัดตัว is not a renamed championship: it must never award champion
-- rewards, and its results are selected/reserve/not_selected/withdrawn with a
-- reason and source rule, not a bracket placement.
--
-- Deployed as migrations tournament_v2_20 and tournament_v2_21 (the second
-- fixes a null-purpose guard bug found while testing — see below).
-- ============================================================================

-- rpc_admin_finalize_selection
-- p_results: [{"entry_id":1,"result":"selected","rank":1,"reason":"..."}...]
-- Every ACTIVE entry in the event must appear exactly once, so a partial
-- announcement (some players told, some not) cannot happen.
--
-- v_ev.purpose IS DISTINCT FROM 'selection', not <>: SQL's three-valued logic
-- makes `NULL <> 'selection'` evaluate to NULL, not TRUE, so `IF NULL THEN
-- raise` silently never fires. Found by testing this RPC against tournament
-- 58, a pre-V2 row whose purpose column was never set — the guard was skipped
-- and the call fell through to the lifecycle check instead, which happened to
-- also block it in that case. A null-purpose event that had reached
-- group_stage/knockout/published would NOT have been caught.
create or replace function public.rpc_admin_finalize_selection(
  p_event_id bigint, p_results jsonb, p_reason text, p_expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid bigint; v_ev tournaments; v_row jsonb; v_entry_id bigint; v_result text;
  v_seen bigint[] := '{}'; v_active_count int; v_selected int := 0; v_reserve int := 0;
begin
  v_uid := fn_v2_assert_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'ERR_REASON_REQUIRED'; end if;

  select * into v_ev from tournaments where id = p_event_id for update;
  if not found then raise exception 'ERR_EVENT_NOT_FOUND'; end if;
  if v_ev.lock_version <> p_expected_version then raise exception 'ERR_VERSION_CONFLICT'; end if;
  if v_ev.purpose is distinct from 'selection' then raise exception 'ERR_SELECTION_NOT_ENABLED'; end if;
  if v_ev.lifecycle_status = 'selection_completed' then
    raise exception 'ERR_SELECTION_ALREADY_FINALIZED'; end if;
  if v_ev.lifecycle_status not in ('group_stage', 'knockout', 'published') then
    raise exception 'ERR_BAD_TRANSITION' using detail = v_ev.lifecycle_status; end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception 'ERR_BAD_PAYLOAD'; end if;

  select count(*) into v_active_count from tournament_entries
   where tournament_id = p_event_id and status = 'registered';

  -- Pass 1: validate every row and require full coverage before writing.
  for v_row in select * from jsonb_array_elements(p_results) loop
    v_entry_id := (v_row->>'entry_id')::bigint;
    v_result := v_row->>'result';
    if v_result not in ('selected', 'reserve', 'not_selected', 'withdrawn') then
      raise exception 'ERR_SELECTION_ENTRY_INVALID' using detail = coalesce(v_result, 'null'); end if;
    if not exists (select 1 from tournament_entries
                    where id = v_entry_id and tournament_id = p_event_id) then
      raise exception 'ERR_SELECTION_ENTRY_INVALID' using detail = v_entry_id::text; end if;
    if v_entry_id = any(v_seen) then
      raise exception 'ERR_SELECTION_ENTRY_INVALID' using
        detail = format('entry %s listed twice', v_entry_id); end if;
    v_seen := v_seen || v_entry_id;
    if v_result = 'selected' then v_selected := v_selected + 1; end if;
    if v_result = 'reserve' then v_reserve := v_reserve + 1; end if;
  end loop;

  if array_length(v_seen, 1) is distinct from v_active_count then
    raise exception 'ERR_SELECTION_COUNT_MISMATCH' using
      detail = format('%s results submitted, %s active entries in the event',
                      coalesce(array_length(v_seen,1), 0), v_active_count);
  end if;
  if v_ev.selected_count is not null and v_selected <> v_ev.selected_count then
    raise exception 'ERR_SELECTION_COUNT_MISMATCH' using
      detail = format('%s selected, event configured for %s', v_selected, v_ev.selected_count);
  end if;

  -- Pass 2: write.
  delete from tournament_selection_results where tournament_id = p_event_id;
  for v_row in select * from jsonb_array_elements(p_results) loop
    insert into tournament_selection_results (
      tournament_id, entry_id, result, rank, reason, source_rule,
      evaluator_note, finalized_by, finalized_at
    ) values (
      p_event_id, (v_row->>'entry_id')::bigint, v_row->>'result',
      (v_row->>'rank')::int, p_reason, coalesce(v_row->>'source_rule', 'manual'),
      v_row->>'evaluator_note', v_uid, now()
    );
  end loop;

  update tournaments
     set lifecycle_status = 'selection_completed', status = 'completed',
         lock_version = lock_version + 1
   where id = p_event_id;

  perform log_admin_action('tournament_v2_finalize_selection', 'tournaments', p_event_id::text,
    null, jsonb_build_object('selected', v_selected, 'reserve', v_reserve, 'reason', p_reason));

  return jsonb_build_object('event_id', p_event_id, 'selected', v_selected,
    'reserve', v_reserve, 'total', array_length(v_seen, 1));
end $$;

-- rpc_admin_assign_court — court + schedule for one match, used by the
-- operations dashboard's match queue.
create or replace function public.rpc_admin_assign_court(
  p_match_id bigint, p_court_id bigint, p_scheduled_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid bigint; v_m tournament_matches; v_court tournament_courts;
begin
  v_uid := fn_v2_assert_admin();

  select * into v_m from tournament_matches where id = p_match_id for update;
  if not found then raise exception 'ERR_MATCH_NOT_FOUND'; end if;
  if v_m.status in ('completed','walkover','retired','disqualified','cancelled') then
    raise exception 'ERR_MATCH_ALREADY_COMPLETED'; end if;

  if p_court_id is not null then
    select * into v_court from tournament_courts where id = p_court_id;
    if not found then raise exception 'ERR_MATCH_NOT_FOUND' using detail = 'court not found'; end if;
    if v_court.series_id is distinct from (select series_id from tournaments where id = v_m.tournament_id) then
      raise exception 'ERR_MATCH_NOT_FOUND' using detail = 'court belongs to a different series'; end if;
  end if;

  update tournament_matches
     set court_id = p_court_id, scheduled_at = coalesce(p_scheduled_at, scheduled_at)
   where id = p_match_id;

  perform log_admin_action('tournament_v2_assign_court', 'tournament_matches', p_match_id::text,
    null, jsonb_build_object('court_id', p_court_id, 'scheduled_at', p_scheduled_at));

  return jsonb_build_object('match_id', p_match_id, 'court_id', p_court_id,
    'scheduled_at', p_scheduled_at);
end $$;

revoke execute on function public.rpc_admin_finalize_selection(bigint, jsonb, text, int) from public;
grant  execute on function public.rpc_admin_finalize_selection(bigint, jsonb, text, int) to anon, authenticated;
revoke execute on function public.rpc_admin_assign_court(bigint, bigint, timestamptz) from public;
grant  execute on function public.rpc_admin_assign_court(bigint, bigint, timestamptz) to anon, authenticated;

-- ============================================================================
-- ROLLBACK
--   drop function if exists public.rpc_admin_assign_court(bigint,bigint,timestamptz);
--   drop function if exists public.rpc_admin_finalize_selection(bigint,jsonb,text,int);
-- ============================================================================
