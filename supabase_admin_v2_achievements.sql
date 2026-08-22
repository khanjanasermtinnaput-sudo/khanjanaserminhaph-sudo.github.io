-- Admin V2 Phase 7 — Achievement Studio + Rewards Center
-- Applied directly to production (project tprmqsfbeyqurwqpmpia) via Supabase
-- MCP on 2026-08-22. Additive only.
--
-- Design decision, stated plainly: this does NOT touch or migrate the
-- existing built-in achievements (ACHIEVEMENTS_DEF / TOURNAMENT_ACHIEVEMENTS_DEF
-- in js/achievements.js) or the legacy admin-created-achievement catalog that
-- currently lives packed into players.prime_titles via a `__cach:` sentinel
-- (js/season.js). Migrating 43 real players' historical achievement data out
-- of that overloaded text column is a real, separate data-migration task with
-- real data-loss risk if rushed — not something to do unattended overnight.
-- Instead this establishes a proper, structured system for achievements
-- CREATED FROM NOW ON through Admin V2: a real table instead of a hacked
-- text-column blob, and a genuinely safe rule representation instead of an
-- arbitrary JS closure (the built-in achievements' check() functions are
-- developer-authored code, not admin-entered data, so they were never the
-- eval-safety problem the spec is warning about — the problem is only for
-- rules an ADMIN types into a form, which is exactly what this replaces).
--
-- Rule shape: {field, operator, value} — field is a WHITELISTED player
-- column (wins/losses/pts/level/coins/consecutive_wins/best_win_streak),
-- operator is one of >=/<=/>/</==. No eval, no arbitrary code — a rule is
-- pure data. Automatic rule-triggered granting (checking every player after
-- every match) is NOT wired up in this pass — rules are stored and can guide
-- a manual grant decision, but nothing evaluates them yet. Stated here so
-- it's not mistaken for done.

create table if not exists admin_achievements (
  id bigserial primary key,
  title text not null,
  description text,
  icon text,
  rarity text not null default 'bronze' check (rarity in ('bronze', 'silver', 'gold', 'legendary')),
  hidden boolean not null default false,
  repeatable boolean not null default false,
  rule jsonb,               -- {field, operator, value} or null (manual-only achievement)
  reward jsonb,             -- {coins?: int, elo?: int} — applied atomically on grant, if present
  archived_at timestamptz,
  created_by bigint references players(id),
  created_at timestamptz not null default now()
);
alter table admin_achievements enable row level security;
create policy admin_achievements_read on admin_achievements for select using (true);
create policy admin_achievements_write_admin on admin_achievements for all using (is_admin_caller()) with check (is_admin_caller());

create table if not exists player_achievement_grants (
  id bigserial primary key,
  achievement_id bigint not null references admin_achievements(id),
  player_id bigint not null references players(id),
  granted_at timestamptz not null default now(),
  granted_by bigint references players(id),
  revoked_at timestamptz,
  revoked_by bigint references players(id),
  note text
);
alter table player_achievement_grants enable row level security;
create policy grants_read on player_achievement_grants for select using (true);
create policy grants_write_admin on player_achievement_grants for all using (is_admin_caller()) with check (is_admin_caller());
create index if not exists idx_grants_player on player_achievement_grants(player_id) where revoked_at is null;

-- ── RPCs ─────────────────────────────────────────────────────────────────
create or replace function rpc_admin_create_achievement(p_title text, p_description text, p_icon text, p_rarity text, p_hidden boolean, p_repeatable boolean, p_rule jsonb, p_reward jsonb)
returns admin_achievements
language plpgsql security definer set search_path = public
as $$
declare v_row admin_achievements%rowtype;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'title_required'; end if;
  if p_rule is not null and not (p_rule ? 'field' and p_rule ? 'operator' and p_rule ? 'value') then
    raise exception 'invalid_rule_shape';
  end if;
  if p_rule is not null and not (p_rule->>'field' = any(array['wins','losses','pts','level','coins','consecutive_wins','best_win_streak'])) then
    raise exception 'invalid_rule_field';
  end if;
  if p_rule is not null and not (p_rule->>'operator' = any(array['>=','<=','>','<','=='])) then
    raise exception 'invalid_rule_operator';
  end if;

  insert into admin_achievements (title, description, icon, rarity, hidden, repeatable, rule, reward, created_by)
    values (p_title, p_description, p_icon, coalesce(p_rarity,'bronze'), coalesce(p_hidden,false), coalesce(p_repeatable,false), p_rule, p_reward, session_uid())
    returning * into v_row;
  perform log_admin_action('create_achievement', 'admin_achievements', v_row.id::text, null, to_jsonb(v_row));
  return v_row;
end;
$$;
grant execute on function rpc_admin_create_achievement(text, text, text, text, boolean, boolean, jsonb, jsonb) to anon, authenticated;

create or replace function rpc_admin_archive_achievement(p_id bigint)
returns admin_achievements
language plpgsql security definer set search_path = public
as $$
declare v_row admin_achievements%rowtype;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;
  update admin_achievements set archived_at = now() where id = p_id and archived_at is null returning * into v_row;
  if not found then raise exception 'achievement_not_found_or_archived'; end if;
  perform log_admin_action('archive_achievement', 'admin_achievements', p_id::text, null, jsonb_build_object('archived_at', v_row.archived_at));
  return v_row;
end;
$$;
grant execute on function rpc_admin_archive_achievement(bigint) to anon, authenticated;

-- Grants the achievement AND, if it has a reward, applies coins/elo
-- atomically in the same transaction — a real reward, not decorative data.
create or replace function rpc_admin_grant_achievement(p_achievement_id bigint, p_player_id bigint, p_note text)
returns player_achievement_grants
language plpgsql security definer set search_path = public
as $$
declare v_ach admin_achievements%rowtype; v_grant player_achievement_grants%rowtype; v_coins int; v_elo int;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;

  select * into v_ach from admin_achievements where id = p_achievement_id and archived_at is null;
  if not found then raise exception 'achievement_not_found'; end if;

  if not v_ach.repeatable and exists (
    select 1 from player_achievement_grants where achievement_id = p_achievement_id and player_id = p_player_id and revoked_at is null
  ) then
    raise exception 'already_granted';
  end if;

  insert into player_achievement_grants (achievement_id, player_id, granted_by, note)
    values (p_achievement_id, p_player_id, session_uid(), p_note)
    returning * into v_grant;

  v_coins := coalesce((v_ach.reward->>'coins')::int, 0);
  v_elo := coalesce((v_ach.reward->>'elo')::int, 0);
  if v_coins <> 0 then update players set coins = greatest(0, coins + v_coins) where id = p_player_id; end if;
  if v_elo <> 0 then update players set pts = greatest(0, pts + v_elo) where id = p_player_id; end if;

  perform log_admin_action('grant_achievement', 'player_achievement_grants', v_grant.id::text, null,
    jsonb_build_object('achievement_id', p_achievement_id, 'player_id', p_player_id, 'coins', v_coins, 'elo', v_elo, 'note', p_note));
  return v_grant;
end;
$$;
grant execute on function rpc_admin_grant_achievement(bigint, bigint, text) to anon, authenticated;

create or replace function rpc_admin_revoke_achievement(p_grant_id bigint, p_reason text)
returns player_achievement_grants
language plpgsql security definer set search_path = public
as $$
declare v_grant player_achievement_grants%rowtype;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason_required'; end if;

  update player_achievement_grants set revoked_at = now(), revoked_by = session_uid()
    where id = p_grant_id and revoked_at is null
    returning * into v_grant;
  if not found then raise exception 'grant_not_found_or_already_revoked'; end if;

  perform log_admin_action('revoke_achievement', 'player_achievement_grants', p_grant_id::text, null, jsonb_build_object('reason', p_reason));
  return v_grant;
end;
$$;
grant execute on function rpc_admin_revoke_achievement(bigint, text) to anon, authenticated;

-- ── Rewards Center: single + bulk currency grant ────────────────────────
-- Replaces the raw `coins` PATCH in adminGiveCoins() (index.html). Supports
-- bulk by taking an array of player ids; each one is a separate logged
-- action so the audit trail stays per-player, not one opaque batch entry.
create or replace function rpc_admin_grant_currency(p_player_ids bigint[], p_amount int, p_reason text)
returns setof players
language plpgsql security definer set search_path = public
as $$
declare v_pid bigint;
begin
  if session_uid() is null or not is_admin_caller() then raise exception 'not_authorized'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason_required'; end if;
  if p_amount = 0 then raise exception 'amount_required'; end if;

  foreach v_pid in array p_player_ids loop
    update players set coins = greatest(0, coins + p_amount) where id = v_pid;
    perform log_admin_action('grant_currency', 'players', v_pid::text, null,
      jsonb_build_object('amount', p_amount, 'reason', p_reason));
  end loop;

  return query select * from players where id = any(p_player_ids);
end;
$$;
grant execute on function rpc_admin_grant_currency(bigint[], int, text) to anon, authenticated;
