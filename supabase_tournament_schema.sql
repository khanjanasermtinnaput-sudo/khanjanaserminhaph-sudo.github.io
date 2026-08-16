-- ============================================================================
-- Tournament System Upgrade — Phase 1: additive schema hardening
-- ============================================================================
-- Adds columns/tables needed for the new "single_elimination" bracket format,
-- per-game score storage, registration deadlines/capacity, and a reward-tier
-- config table. Every new column is nullable (or has a default that matches
-- today's implicit behavior), so existing round_robin_groups tournaments are
-- completely unaffected. RLS/grants on tournaments/tournament_matches are
-- deliberately left untouched here — they are only tightened in the final
-- lockdown migration, once every write path has an RPC replacement.
--
-- Verified live against the production schema before writing this file:
--   - tournaments(id, name, tier, status, groups jsonb, created_at)
--   - tournament_matches(id, tournament_id, group_letter, player_a int,
--     player_b int, score_a, score_b, winner_id, played_at)
--   - both tables: RLS "allow all" policy + full anon/authenticated grants
--     (INSERT/UPDATE/DELETE/TRUNCATE/SELECT) — confirmed unchanged from what
--     index.html's inline setup SQL documents.
-- ============================================================================

-- ── tournament_matches: bracket-tree + per-game score columns ──────────────
alter table tournament_matches
  add column if not exists round_index int,
  add column if not exists round_name text,
  add column if not exists bracket_slot text,
  add column if not exists next_match_id bigint references tournament_matches(id),
  add column if not exists next_match_slot text check (next_match_slot in ('a','b')),
  add column if not exists seed_a int,
  add column if not exists seed_b int,
  add column if not exists is_bye boolean not null default false,
  add column if not exists is_walkover boolean not null default false,
  add column if not exists status text not null default 'pending'
    check (status in ('pending','ready','bye','walkover','completed')),
  add column if not exists games jsonb not null default '[]'::jsonb,
  add column if not exists submit_idempotency_key text;

-- Existing round-robin rows are always "completed" the moment they're
-- inserted (dbAddTournamentMatch writes a finished result in one shot) —
-- backfill status so the new status column reflects that reality instead of
-- leaving every historical row stuck at the 'pending' default.
update tournament_matches set status = 'completed' where winner_id is not null;

create index if not exists idx_tm_next_match on tournament_matches(next_match_id);
create index if not exists idx_tm_tournament_status on tournament_matches(tournament_id, status);

-- ── tournaments: format discriminator + registration/reward columns ────────
alter table tournaments
  add column if not exists format text not null default 'round_robin_groups'
    check (format in ('round_robin_groups','single_elimination')),
  add column if not exists registration_deadline timestamptz,
  add column if not exists max_participants int,
  add column if not exists reward_overrides jsonb;

-- ── tournament_reward_tiers: server-side config, replaces the localStorage-only
--    tour_rewards_<id> store (getTournamentRewards/saveTournamentRewards) ──────
create table if not exists tournament_reward_tiers (
  tier text primary key,
  champion_coins int not null default 0,
  champion_elo int not null default 0,
  runnerup_pct numeric not null default 0.5,     -- matches today's Math.floor(totalCoins/2)
  thirdplace_pct numeric not null default 0.25,  -- matches today's Math.floor(totalCoins/4)
  participant_pct numeric not null default 0.2,  -- matches today's default eloPts participant %
  updated_at timestamptz not null default now(),
  updated_by bigint references players(id)
);

alter table tournament_reward_tiers enable row level security;

drop policy if exists ref_read on tournament_reward_tiers;
create policy ref_read on tournament_reward_tiers for select using (true);

drop policy if exists ref_admin on tournament_reward_tiers;
create policy ref_admin on tournament_reward_tiers for all using (is_admin_caller()) with check (is_admin_caller());

-- Seed from today's client-side TOUR_COIN_REWARDS constant (tournament.js:467).
-- champion_elo defaults to 0 because ELO reward is currently an admin-set,
-- per-tournament discretionary value (savedRewards.eloPts, default 0) with no
-- baked-in per-tier default today — admins can override via reward_overrides.
insert into tournament_reward_tiers (tier, champion_coins, champion_elo)
values
  ('Regular', 100, 0),
  ('Super 500', 500, 0),
  ('Super 1000', 1000, 0)
on conflict (tier) do nothing;
