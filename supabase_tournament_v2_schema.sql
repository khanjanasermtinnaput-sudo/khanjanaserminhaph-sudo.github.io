-- ============================================================================
-- Tournament V2 — canonical normalized schema
-- ============================================================================
-- Phase 1 of the full-cycle tournament & selection system.
--
-- WHY THIS EXISTS
-- The pre-V2 model stored entrants inside `tournaments.groups` (jsonb) as
-- sentinel objects, and identified a doubles pair only by its "anchor player"
-- (playerIds[0]). That made partners second-class: they could not be seeded,
-- validated, substituted, or counted. This migration introduces first-class
-- entry/member rows and makes them the SOLE source of truth.
--
-- CLEAN REBUILD, NOT A DUAL-WRITE ADAPTER
-- Verified against production on 2026-08-24 before writing this file:
--   tournaments            = 1 row  (id 58, status 'active', no matches)
--   tournament_matches     = 0 rows
--   tournament_series      = 2 rows (zero events attached)
--   completed tournaments  = 0      (no `_hof` sentinels exist anywhere)
-- Because there is no real history to preserve, `tournaments.groups` becomes a
-- dormant legacy column: V2 code neither reads nor writes it. The one existing
-- row is converted by supabase_tournament_v2_backfill.sql.
--
-- ALSO VERIFIED (repo .sql files have drifted from production — do not trust
-- them as a record of what is deployed):
--   * `tournaments.format` does NOT exist in production. The ALTER in
--     supabase_tournament_schema.sql:47-52 that adds it, with
--     CHECK (format in ('round_robin_groups','single_elimination')), was never
--     applied. Do not apply it.
--   * rpc_tournament_generate_bracket and rpc_tournament_submit_result (the
--     single-elimination pair) do NOT exist in production.
--   => The "is single_elimination active or retired?" contradiction is settled:
--      it was never deployed. There is exactly one canonical structure model,
--      and it is the one defined by `tournaments.structure` below.
--
-- WRITE MODEL
-- These tables are granted SELECT only. anon/authenticated hold no INSERT,
-- UPDATE or DELETE privilege on any of them, so every mutation must go through
-- the SECURITY DEFINER RPCs in supabase_tournament_v2_rpc_*.sql / _engine.sql.
-- RLS is enabled on all of them regardless, so a future grant cannot silently
-- open a write path. Per the 2026 Supabase change, new tables are NOT exposed
-- to the Data API automatically — the explicit grants at the bottom are load
-- bearing, not decorative.
--
-- Additive and reversible. See the ROLLBACK section at the end of the file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Event configuration on `tournaments`
-- ---------------------------------------------------------------------------
-- `tournaments` stays the event table (one row per category inside a series);
-- `tournament_series` stays the competition container. Extending in place keeps
-- the existing series_id FK, RLS policies and reward/EXP RPCs working.
--
-- `lifecycle_status` is a NEW column deliberately kept separate from the legacy
-- `status` column: `status` has no CHECK constraint, is still read by pre-V2
-- code paths, and carries only 'active'/'completed'.

alter table public.tournaments
  add column if not exists team_size          int,
  add column if not exists purpose            text,
  add column if not exists structure          text,
  add column if not exists group_count        int,
  add column if not exists teams_per_group    int,
  add column if not exists advance_per_group  int,
  add column if not exists scoring_preset     text,
  add column if not exists scoring_config     jsonb,
  add column if not exists selected_count     int,
  add column if not exists reserve_count      int,
  add column if not exists is_published       boolean not null default false,
  add column if not exists lifecycle_status   text not null default 'draft',
  add column if not exists lock_version       int  not null default 0,
  add column if not exists draw_seed          bigint,
  add column if not exists registration_opens_at timestamptz;

do $$
begin
  -- Practical structural limits. The pre-V2 admin form had min=1/min=2 and no
  -- maximum at all, which allowed group letters past Z and unusable structures.
  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_team_size_check') then
    alter table public.tournaments add constraint tournaments_v2_team_size_check
      check (team_size is null or team_size in (1, 2));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_purpose_check') then
    alter table public.tournaments add constraint tournaments_v2_purpose_check
      check (purpose is null or purpose in ('championship', 'selection'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_structure_check') then
    alter table public.tournaments add constraint tournaments_v2_structure_check
      check (structure is null or structure in ('groups_knockout', 'knockout_only', 'groups_only'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_group_count_check') then
    alter table public.tournaments add constraint tournaments_v2_group_count_check
      check (group_count is null or (group_count between 1 and 8));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_teams_per_group_check') then
    alter table public.tournaments add constraint tournaments_v2_teams_per_group_check
      check (teams_per_group is null or (teams_per_group between 2 and 8));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_advance_check') then
    alter table public.tournaments add constraint tournaments_v2_advance_check
      check (
        advance_per_group is null
        or teams_per_group is null
        or (advance_per_group >= 1 and advance_per_group <= teams_per_group)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_scoring_preset_check') then
    alter table public.tournaments add constraint tournaments_v2_scoring_preset_check
      check (scoring_preset is null or scoring_preset in ('bwf_standard', 'one_game_21', 'custom'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_lifecycle_check') then
    alter table public.tournaments add constraint tournaments_v2_lifecycle_check
      check (lifecycle_status in (
        'draft', 'roster_ready', 'draw_ready', 'published',
        'group_stage', 'knockout', 'completed', 'selection_completed', 'cancelled'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_event_kind_check') then
    alter table public.tournaments add constraint tournaments_v2_event_kind_check
      check (event_kind is null or event_kind in ('ms', 'ws', 'md', 'wd', 'xd', 'custom'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournaments_v2_selection_check') then
    alter table public.tournaments add constraint tournaments_v2_selection_check
      check (
        purpose is distinct from 'selection'
        or selected_count is null
        or selected_count >= 1
      );
  end if;
end $$;

-- One row per standard event kind per series. 'custom' is exempt (a series may
-- carry several bespoke events); cancelled events free their slot.
create unique index if not exists ux_tournaments_series_event_kind
  on public.tournaments (series_id, event_kind)
  where series_id is not null
    and event_kind is not null
    and event_kind <> 'custom'
    and lifecycle_status <> 'cancelled';

create index if not exists idx_tournaments_lifecycle
  on public.tournaments (lifecycle_status);

-- ---------------------------------------------------------------------------
-- 2. Series-level operational config
-- ---------------------------------------------------------------------------

alter table public.tournament_series
  add column if not exists purpose             text,
  add column if not exists starts_at           timestamptz,
  add column if not exists ends_at             timestamptz,
  add column if not exists court_count         int,
  add column if not exists registration_deadline timestamptz,
  add column if not exists organizer_contact   text,
  add column if not exists lifecycle_status    text not null default 'draft',
  add column if not exists lock_version        int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_series_v2_purpose_check') then
    alter table public.tournament_series add constraint tournament_series_v2_purpose_check
      check (purpose is null or purpose in ('championship', 'selection'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournament_series_v2_lifecycle_check') then
    alter table public.tournament_series add constraint tournament_series_v2_lifecycle_check
      check (lifecycle_status in (
        'draft', 'registration_open', 'registration_closed',
        'in_progress', 'completed', 'archived', 'cancelled'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournament_series_v2_court_count_check') then
    alter table public.tournament_series add constraint tournament_series_v2_court_count_check
      check (court_count is null or (court_count between 1 and 64));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Entries — a first-class competitor slot (1 player, or a real doubles pair)
-- ---------------------------------------------------------------------------

create table if not exists public.tournament_entries (
  id            bigserial primary key,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  entry_type    text not null check (entry_type in ('singles', 'doubles')),
  display_name  text,
  seed          int check (seed is null or seed >= 1),
  status        text not null default 'registered'
                  check (status in ('registered', 'waitlisted', 'withdrawn', 'disqualified')),
  source        text not null default 'admin'
                  check (source in ('self', 'admin', 'import')),
  note          text,
  created_by    bigint references public.players(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  lock_version  int not null default 0
);

create index if not exists idx_tournament_entries_event
  on public.tournament_entries (tournament_id, status);
create index if not exists idx_tournament_entries_created_by
  on public.tournament_entries (created_by);

-- ---------------------------------------------------------------------------
-- 4. Entry members — the death of the anchor-player convention
-- ---------------------------------------------------------------------------
-- `tournament_id` and `entry_active` are denormalized from tournament_entries
-- purely so the "one player may hold at most one ACTIVE entry per event" rule
-- can be a real partial unique index rather than an RPC-only convention.
-- Both are maintained by triggers below; RPCs must not set them by hand.

create table if not exists public.tournament_entry_members (
  id            bigserial primary key,
  entry_id      bigint not null references public.tournament_entries(id) on delete cascade,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  player_id     bigint not null references public.players(id),
  member_order  int not null check (member_order in (1, 2)),
  invite_status text not null default 'accepted'
                  check (invite_status in ('pending', 'accepted', 'declined')),
  invited_by    bigint references public.players(id),
  responded_at  timestamptz,
  entry_active  boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (entry_id, member_order),
  unique (entry_id, player_id)
);

create unique index if not exists ux_entry_member_one_active_per_event
  on public.tournament_entry_members (tournament_id, player_id)
  where entry_active;

create index if not exists idx_entry_members_player
  on public.tournament_entry_members (player_id);
create index if not exists idx_entry_members_entry
  on public.tournament_entry_members (entry_id);
create index if not exists idx_entry_members_invited_by
  on public.tournament_entry_members (invited_by);

-- Keep the denormalized columns honest.
create or replace function public.tg_entry_member_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.tournament_entries;
begin
  select * into v_entry from public.tournament_entries where id = new.entry_id;
  if not found then
    raise exception 'ERR_ENTRY_NOT_FOUND';
  end if;
  new.tournament_id := v_entry.tournament_id;
  -- A withdrawn/disqualified entry must release the player for re-registration.
  new.entry_active  := (v_entry.status in ('registered', 'waitlisted'));
  return new;
end $$;

drop trigger if exists trg_entry_member_sync on public.tournament_entry_members;
create trigger trg_entry_member_sync
  before insert or update of entry_id on public.tournament_entry_members
  for each row execute function public.tg_entry_member_sync();

create or replace function public.tg_entry_status_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    update public.tournament_entry_members
       set entry_active = (new.status in ('registered', 'waitlisted'))
     where entry_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_entry_status_cascade on public.tournament_entries;
create trigger trg_entry_status_cascade
  after update of status on public.tournament_entries
  for each row execute function public.tg_entry_status_cascade();

-- Exact member count, enforced at COMMIT so an RPC can insert an entry and both
-- of its members inside one transaction. This is the database-level half of
-- "a half-filled doubles pair is never a valid entry" — the RPC layer and the
-- roster_ready lifecycle gate are the other two halves.
create or replace function public.tg_entry_member_count_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry    public.tournament_entries;
  v_count    int;
  v_distinct int;
  v_entry_id bigint;
begin
  -- This one function backs triggers on two different tables, so resolve the
  -- entry id from whichever record shape actually fired. plpgsql evaluates
  -- record fields lazily, so the untaken branch never touches a missing field.
  if tg_table_name = 'tournament_entries' then
    if tg_op = 'DELETE' then
      return null;
    end if;
    v_entry_id := new.id;
  else
    if tg_op = 'DELETE' then
      v_entry_id := old.entry_id;
    else
      v_entry_id := new.entry_id;
    end if;
  end if;

  select * into v_entry from public.tournament_entries where id = v_entry_id;
  if not found then
    return null;   -- entry was deleted; members cascaded with it
  end if;

  -- Withdrawn / disqualified entries keep their historical membership as-is.
  if v_entry.status in ('withdrawn', 'disqualified') then
    return null;
  end if;

  select count(*), count(distinct player_id)
    into v_count, v_distinct
    from public.tournament_entry_members
   where entry_id = v_entry_id;

  if v_entry.entry_type = 'singles' and v_count <> 1 then
    raise exception 'ERR_SINGLES_MEMBER_COUNT' using
      detail = format('entry %s must have exactly 1 member, found %s', v_entry_id, v_count);
  end if;

  if v_entry.entry_type = 'doubles' then
    if v_count <> 2 then
      raise exception 'ERR_DOUBLES_MEMBER_COUNT' using
        detail = format('entry %s must have exactly 2 members, found %s', v_entry_id, v_count);
    end if;
    if v_distinct <> 2 then
      raise exception 'ERR_DOUBLES_DUPLICATE_MEMBER' using
        detail = format('entry %s lists the same player twice', v_entry_id);
    end if;
  end if;

  return null;
end $$;

drop trigger if exists trg_entry_members_count on public.tournament_entry_members;
create constraint trigger trg_entry_members_count
  after insert or update or delete on public.tournament_entry_members
  deferrable initially deferred
  for each row execute function public.tg_entry_member_count_check();

drop trigger if exists trg_entries_member_count on public.tournament_entries;
create constraint trigger trg_entries_member_count
  after insert or update of entry_type on public.tournament_entries
  deferrable initially deferred
  for each row execute function public.tg_entry_member_count_check();

-- ---------------------------------------------------------------------------
-- 5. Groups and group assignment
-- ---------------------------------------------------------------------------

create table if not exists public.tournament_groups (
  id            bigserial primary key,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  letter        text not null check (letter ~ '^[A-H]$'),
  sort_order    int not null default 0,
  advance_count int not null default 1 check (advance_count >= 1),
  created_at    timestamptz not null default now(),
  unique (tournament_id, letter)
);

create index if not exists idx_tournament_groups_event
  on public.tournament_groups (tournament_id, sort_order);

create table if not exists public.tournament_group_entries (
  id         bigserial primary key,
  group_id   bigint not null references public.tournament_groups(id) on delete cascade,
  entry_id   bigint not null unique references public.tournament_entries(id) on delete cascade,
  slot       int not null check (slot >= 1),
  seed       int,
  created_at timestamptz not null default now(),
  unique (group_id, slot)
);

create index if not exists idx_group_entries_group
  on public.tournament_group_entries (group_id, slot);

-- ---------------------------------------------------------------------------
-- 6. Draw versions — a draw is a draft until an admin publishes it
-- ---------------------------------------------------------------------------

create table if not exists public.tournament_draw_versions (
  id            bigserial primary key,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  version       int not null check (version >= 1),
  config        jsonb not null default '{}'::jsonb,
  assignments   jsonb not null default '[]'::jsonb,
  draw_seed     bigint,
  draw_method   text check (draw_method is null or draw_method in ('random', 'seeded', 'manual')),
  is_published  boolean not null default false,
  created_by    bigint references public.players(id),
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  published_by  bigint references public.players(id),
  unique (tournament_id, version)
);

create index if not exists idx_draw_versions_event
  on public.tournament_draw_versions (tournament_id, version desc);
create index if not exists idx_draw_versions_created_by
  on public.tournament_draw_versions (created_by);
create index if not exists idx_draw_versions_published_by
  on public.tournament_draw_versions (published_by);

-- ---------------------------------------------------------------------------
-- 7. Courts
-- ---------------------------------------------------------------------------

create table if not exists public.tournament_courts (
  id         bigserial primary key,
  series_id  bigint not null references public.tournament_series(id) on delete cascade,
  court_no   int not null check (court_no >= 1),
  label      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (series_id, court_no)
);

create index if not exists idx_tournament_courts_series
  on public.tournament_courts (series_id);

-- ---------------------------------------------------------------------------
-- 8. Matches — entry references, stage, scheduling, duration
-- ---------------------------------------------------------------------------
-- COMPAT EXCEPTION (the only one in V2): player_a / player_b / winner_id keep
-- being written with each team's member_order = 1 player, because
-- rpc_tournament_grant_rewards and rpc_award_tournament_exp read those columns.
-- V2 logic itself reads entry_a_id / entry_b_id / winner_entry_id exclusively.

alter table public.tournament_matches
  add column if not exists entry_a_id       bigint references public.tournament_entries(id),
  add column if not exists entry_b_id       bigint references public.tournament_entries(id),
  add column if not exists winner_entry_id  bigint references public.tournament_entries(id),
  add column if not exists group_id         bigint references public.tournament_groups(id) on delete cascade,
  add column if not exists stage            text,
  add column if not exists court_id         bigint references public.tournament_courts(id),
  add column if not exists scheduled_at     timestamptz,
  add column if not exists started_at       timestamptz,
  add column if not exists ended_at         timestamptz,
  add column if not exists duration_seconds int,
  add column if not exists correction_count int not null default 0,
  add column if not exists outcome          text,
  add column if not exists draw_version     int,
  add column if not exists match_no         int,
  add column if not exists generation_key   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_matches_v2_stage_check') then
    alter table public.tournament_matches add constraint tournament_matches_v2_stage_check
      check (stage is null or stage in ('group', 'knockout', 'playoff'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tournament_matches_v2_outcome_check') then
    alter table public.tournament_matches add constraint tournament_matches_v2_outcome_check
      check (outcome is null or outcome in
        ('normal', 'walkover', 'retired', 'disqualified', 'bye', 'cancelled'));
  end if;
end $$;

-- Widen the lifecycle. Pre-V2 allowed pending|ready|bye|walkover|completed;
-- V2 adds live (referee in progress) and the abandonment outcomes.
alter table public.tournament_matches drop constraint if exists tournament_matches_status_check;
alter table public.tournament_matches add constraint tournament_matches_status_check
  check (status in (
    'pending', 'ready', 'live', 'bye', 'walkover',
    'completed', 'cancelled', 'retired', 'disqualified'
  ));

create index if not exists idx_tm_event_stage_status
  on public.tournament_matches (tournament_id, stage, status);
create index if not exists idx_tm_group
  on public.tournament_matches (group_id);
create index if not exists idx_tm_round
  on public.tournament_matches (tournament_id, round_index);
create index if not exists idx_tm_court_schedule
  on public.tournament_matches (court_id, scheduled_at);
create index if not exists idx_tm_entry_a on public.tournament_matches (entry_a_id);
create index if not exists idx_tm_entry_b on public.tournament_matches (entry_b_id);
create index if not exists idx_tm_winner_entry on public.tournament_matches (winner_entry_id);

-- Idempotency for generation: one generation_key may only ever produce one set.
create unique index if not exists ux_tm_generation_key
  on public.tournament_matches (tournament_id, generation_key, match_no)
  where generation_key is not null;

-- Active/pending match partial index for the operations dashboard.
create index if not exists idx_tm_active
  on public.tournament_matches (tournament_id, scheduled_at)
  where status in ('pending', 'ready', 'live');

-- ---------------------------------------------------------------------------
-- 9. Per-game scores — replaces the localStorage `tgame_*` hack
-- ---------------------------------------------------------------------------

create table if not exists public.tournament_match_games (
  id           bigserial primary key,
  match_id     bigint not null references public.tournament_matches(id) on delete cascade,
  game_no      int not null check (game_no between 1 and 9),
  score_a      int not null check (score_a >= 0),
  score_b      int not null check (score_b >= 0),
  winner_side  text check (winner_side is null or winner_side in ('a', 'b')),
  created_at   timestamptz not null default now(),
  unique (match_id, game_no)
);

create index if not exists idx_match_games_match
  on public.tournament_match_games (match_id, game_no);

-- ---------------------------------------------------------------------------
-- 10. Selection results — โหมดคัดตัว is not a renamed championship
-- ---------------------------------------------------------------------------

create table if not exists public.tournament_selection_results (
  id            bigserial primary key,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  entry_id      bigint not null references public.tournament_entries(id) on delete cascade,
  result        text not null check (result in ('selected', 'reserve', 'not_selected', 'withdrawn')),
  rank          int check (rank is null or rank >= 1),
  reason        text,
  source_rule   text,
  evaluator_note text,
  finalized_by  bigint references public.players(id),
  finalized_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (tournament_id, entry_id)
);

create index if not exists idx_selection_results_event
  on public.tournament_selection_results (tournament_id, result, rank);
create index if not exists idx_selection_results_entry
  on public.tournament_selection_results (entry_id);
create index if not exists idx_selection_results_finalized_by
  on public.tournament_selection_results (finalized_by);

-- ---------------------------------------------------------------------------
-- 11. RLS + Data API grants
-- ---------------------------------------------------------------------------
-- Read-only exposure. No write privilege is granted to anon/authenticated on
-- any V2 table, so PostgREST cannot mutate them at all; the SECURITY DEFINER
-- RPCs own every write. RLS is still enabled on each table so that a future
-- accidental GRANT cannot open a hole on its own.

alter table public.tournament_entries            enable row level security;
alter table public.tournament_entry_members      enable row level security;
alter table public.tournament_groups             enable row level security;
alter table public.tournament_group_entries      enable row level security;
alter table public.tournament_draw_versions      enable row level security;
alter table public.tournament_courts             enable row level security;
alter table public.tournament_match_games        enable row level security;
alter table public.tournament_selection_results  enable row level security;

drop policy if exists tournament_entries_read on public.tournament_entries;
create policy tournament_entries_read on public.tournament_entries
  for select using (true);

drop policy if exists tournament_entry_members_read on public.tournament_entry_members;
create policy tournament_entry_members_read on public.tournament_entry_members
  for select using (true);

drop policy if exists tournament_groups_read on public.tournament_groups;
create policy tournament_groups_read on public.tournament_groups
  for select using (true);

drop policy if exists tournament_group_entries_read on public.tournament_group_entries;
create policy tournament_group_entries_read on public.tournament_group_entries
  for select using (true);

-- An unpublished draw is an admin working document: never show a draft bracket
-- to players, or they will treat a preview as the real draw.
drop policy if exists tournament_draw_versions_read on public.tournament_draw_versions;
create policy tournament_draw_versions_read on public.tournament_draw_versions
  for select using (is_published or public.is_admin_caller());

drop policy if exists tournament_courts_read on public.tournament_courts;
create policy tournament_courts_read on public.tournament_courts
  for select using (true);

drop policy if exists tournament_match_games_read on public.tournament_match_games;
create policy tournament_match_games_read on public.tournament_match_games
  for select using (true);

-- Selection outcomes stay private until an admin finalizes them.
drop policy if exists tournament_selection_results_read on public.tournament_selection_results;
create policy tournament_selection_results_read on public.tournament_selection_results
  for select using (finalized_at is not null or public.is_admin_caller());

-- !! `grant select` ALONE IS NOT ENOUGH ON THIS DATABASE. !!
-- Verified on 2026-08-24: pg_default_acl carries ALTER DEFAULT PRIVILEGES from
-- BOTH `postgres` and `supabase_admin` granting arwdDxtm (ALL) on every newly
-- created table in `public` to anon and authenticated. A new table is therefore
-- born writable, and `grant select` adds nothing. Immediately after part 4/4 was
-- applied, anon held SELECT+INSERT+UPDATE+DELETE on all eight V2 tables, with
-- only the absence of a write RLS policy standing between the public anon key
-- and direct PostgREST writes.
--
-- The REVOKE below is the load-bearing statement. Any future table added to
-- this schema needs the same treatment — do not assume "I only granted SELECT".
revoke insert, update, delete, truncate, references, trigger
  on public.tournament_entries,
     public.tournament_entry_members,
     public.tournament_groups,
     public.tournament_group_entries,
     public.tournament_draw_versions,
     public.tournament_courts,
     public.tournament_match_games,
     public.tournament_selection_results
  from anon, authenticated;

grant select
  on public.tournament_entries,
     public.tournament_entry_members,
     public.tournament_groups,
     public.tournament_group_entries,
     public.tournament_draw_versions,
     public.tournament_courts,
     public.tournament_match_games,
     public.tournament_selection_results
  to anon, authenticated;

-- Identity sequences are auto-granted rwU by the same default privileges.
revoke usage, update on sequence
     public.tournament_entries_id_seq,
     public.tournament_entry_members_id_seq,
     public.tournament_groups_id_seq,
     public.tournament_group_entries_id_seq,
     public.tournament_draw_versions_id_seq,
     public.tournament_courts_id_seq,
     public.tournament_match_games_id_seq,
     public.tournament_selection_results_id_seq
  from anon, authenticated;

-- Pre-V2 tables (tournaments, tournament_matches, tournament_series,
-- tournament_reward_tiers) still hold anon SIUD. They are guarded by
-- is_admin_caller() write policies and the pre-V2 client still PATCHes
-- `tournaments` directly, so tightening them is deferred to Phase 8, once no
-- client code performs a direct write.

-- Triggers are internal machinery, never called over the API.
revoke execute on function public.tg_entry_member_sync()          from public;
revoke execute on function public.tg_entry_status_cascade()       from public;
revoke execute on function public.tg_entry_member_count_check()   from public;

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- All V2 tables are additive; the added columns are nullable or defaulted and
-- are harmless if left in place. To fully revert:
--
--   drop table if exists public.tournament_selection_results cascade;
--   drop table if exists public.tournament_match_games       cascade;
--   drop table if exists public.tournament_group_entries     cascade;
--   drop table if exists public.tournament_groups            cascade;
--   drop table if exists public.tournament_draw_versions     cascade;
--   drop table if exists public.tournament_entry_members     cascade;
--   drop table if exists public.tournament_entries           cascade;
--   drop table if exists public.tournament_courts            cascade;
--   drop function if exists public.tg_entry_member_count_check() cascade;
--   drop function if exists public.tg_entry_status_cascade()     cascade;
--   drop function if exists public.tg_entry_member_sync()        cascade;
--   alter table public.tournament_matches drop constraint if exists tournament_matches_status_check;
--   alter table public.tournament_matches add constraint tournament_matches_status_check
--     check (status in ('pending','ready','bye','walkover','completed'));
--
-- The tournaments/tournament_series/tournament_matches column additions may be
-- dropped individually if desired, but leaving them costs nothing.
-- ============================================================================
