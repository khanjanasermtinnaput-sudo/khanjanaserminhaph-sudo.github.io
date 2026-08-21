-- Admin V2 Phase 3 — Match Control Center
-- Applied directly to production (project tprmqsfbeyqurwqpmpia) via Supabase MCP
-- on 2026-08-21. Additive only.
--
-- Design decision (see the plan's "Match result rollback" section): this
-- does NOT add an in-place score/winner edit RPC. calcElo (js/elo.js) is not
-- zero-sum (the winner's gain carries a rank multiplier the loser's loss does
-- not, plus floors), so re-deriving a corrected ELO delta in place risks
-- exactly the inconsistent state the spec warns against. The safe correction
-- workflow is: void the match (exact reversal using the values ALREADY
-- STORED on the row, not recomputed) then record a new, correct one through
-- the existing save-match pipeline. rpc_admin_void_match below is that void
-- step; the Match Control Center UI drives the "record a new one" step
-- through the existing saveMatch()/approvePending() pipeline.

alter table matches add column if not exists status text not null default 'completed';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'matches_status_check') then
    alter table matches add constraint matches_status_check check (status in ('completed', 'voided'));
  end if;
end $$;
alter table matches add column if not exists voided_at timestamptz;
alter table matches add column if not exists voided_by bigint references players(id);
alter table matches add column if not exists void_reason text;

create index if not exists idx_matches_status on matches(status);

-- Public SELECT on `matches` is already USING(true) (supabase_lockdown.sql),
-- so the new columns are visible without a column-level grant — unlike
-- `players`, this table has no column-level restriction.

-- ── rpc_admin_void_match ─────────────────────────────────────────────────
-- Reverses ELO/wins/losses using the pts_gain/pts_loss ALREADY STORED on the
-- match row (not recomputed — those values already account for any
-- bronze/silver loss-protection or ELO x2 that applied at save time, so
-- reversing them exactly undoes exactly what was applied). Sets status to
-- 'voided' rather than deleting — the row, and its old score, stay visible
-- in history. Coins/EXP/achievements awarded from this match are explicitly
-- NOT touched (see the plan: these cannot be honestly reversed at this
-- club's current data model) — the caller must disclose that in the UI.
create or replace function rpc_admin_void_match(p_match bigint, p_reason text)
returns matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m matches%rowtype;
  v_admin bigint;
  v_p jsonb;
  v_pid bigint;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required';
  end if;
  v_admin := session_uid();

  select * into v_m from matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.status = 'voided' then raise exception 'match_already_voided'; end if;

  for v_p in select * from jsonb_array_elements(v_m.team_a) loop
    v_pid := (v_p->>'id')::bigint;
    if v_m.win_team = 'A' then
      update players set pts = greatest(0, pts - v_m.pts_gain), wins = greatest(0, wins - 1) where id = v_pid;
    else
      update players set pts = pts + v_m.pts_loss, losses = greatest(0, losses - 1) where id = v_pid;
    end if;
  end loop;

  for v_p in select * from jsonb_array_elements(v_m.team_b) loop
    v_pid := (v_p->>'id')::bigint;
    if v_m.win_team = 'B' then
      update players set pts = greatest(0, pts - v_m.pts_gain), wins = greatest(0, wins - 1) where id = v_pid;
    else
      update players set pts = pts + v_m.pts_loss, losses = greatest(0, losses - 1) where id = v_pid;
    end if;
  end loop;

  update matches
    set status = 'voided', voided_at = now(), voided_by = v_admin, void_reason = p_reason
    where id = p_match
    returning * into v_m;

  perform log_admin_action(
    'void_match', 'matches', p_match::text,
    jsonb_build_object('status', 'completed'),
    jsonb_build_object('status', 'voided', 'reason', p_reason, 'pts_gain', v_m.pts_gain, 'pts_loss', v_m.pts_loss, 'win_team', v_m.win_team)
  );
  return v_m;
end;
$$;
grant execute on function rpc_admin_void_match(bigint, text) to anon, authenticated;
