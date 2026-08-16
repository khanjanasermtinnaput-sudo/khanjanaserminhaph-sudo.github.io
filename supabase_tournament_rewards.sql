-- ============================================================================
-- Tournament System Upgrade — Phase 6: server-authoritative reward granting
-- ============================================================================
-- rpc_tournament_grant_rewards(p_tournament_id): admin-only. Mirrors
-- admin_grant_item's shape (admin check -> reward_grant(..., target_player)
-- -> done) rather than inventing a new reward pipeline. Reads amounts from
-- tournament_reward_tiers (or tournaments.reward_overrides if set — same
-- column shape), and derives every recipient from the tournament's OWN
-- immutable _hof sentinel (written once, at Final completion, by
-- rpc_tournament_submit_result) plus its _config.entrants list for
-- doubles-partner expansion — never from live standings, so a later name
-- change or ranking shift can never alter who a historical tournament paid
-- out or how much.
--
-- Idempotency: reward_grant() already dedupes on (idempotency_key,
-- player_id) — this function builds one deterministic key per
-- (tournament, role, player) triple ('tournament:<id>:<role>:<player_id>')
-- and pre-checks reward_transactions for that key BEFORE calling
-- reward_grant, so the same pre-check guards both the coin grant AND the
-- ELO/pts update in one place (pts is not a reward_grant currency, so it
-- needs its own guard) — re-running this RPC (double-click, two admins,
-- retry) is a safe no-op for anyone already paid.
--
-- Roles: champion (full amount), runner_up and third_place (tier's
-- runnerup_pct/thirdplace_pct of the champion amount — matches the actual
-- 50%/25% coin split rpc_tournament_schema.sql seeded from
-- executeDeclareChampion's Math.floor(totalCoins/2 or /4)), and participant
-- (every other registered entrant, at participant_pct — extends the
-- existing round-robin precedent of a flat participation reward for
-- non-placing entrants, uniformly to both coins and ELO here since this
-- table applies one percentage to both rather than the two separate
-- coin/ELO percentage sets the legacy client-side reward manager exposed).
-- Doubles: both the anchor and their registered partner are paid.
-- ============================================================================

create or replace function rpc_tournament_grant_rewards(p_tournament_id bigint)
returns table(player_id bigint, role text, coins_granted int, elo_granted int, already_granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments%rowtype;
  v_hof jsonb;
  v_cfg jsonb;
  v_entrants jsonb;
  v_tier tournament_reward_tiers%rowtype;
  v_overrides jsonb;
  v_champion_coins int;
  v_champion_elo int;
  v_runnerup_pct numeric;
  v_thirdplace_pct numeric;
  v_participant_pct numeric;
  v_champion_anchors bigint[];
  v_runnerup_anchor bigint;
  v_thirdplace_anchors bigint[];
  v_all_entrant_ids bigint[];
  v_placed_ids bigint[] := '{}';
  v_anchor bigint;
  v_recipient bigint;
  v_partner bigint;
  v_role text;
  v_coin_amt int;
  v_elo_amt int;
  v_key text;
  v_existing uuid;
begin
  if session_uid() is null or not is_admin_caller() then
    raise exception 'not_authorized';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if v_t.format <> 'single_elimination' then raise exception 'wrong_format'; end if;
  if v_t.status <> 'completed' then raise exception 'tournament_not_completed'; end if;

  select elem into v_hof from jsonb_array_elements(v_t.groups) elem where (elem->>'_hof')::boolean is true limit 1;
  if v_hof is null then raise exception 'missing_hof'; end if;

  select elem into v_cfg from jsonb_array_elements(v_t.groups) elem where (elem->>'_config')::boolean is true limit 1;
  v_entrants := coalesce(v_cfg->'entrants', '[]'::jsonb);

  select * into v_tier from tournament_reward_tiers where tier = v_t.tier;
  v_overrides := v_t.reward_overrides;
  v_champion_coins := coalesce((v_overrides->>'champion_coins')::int, v_tier.champion_coins, 0);
  v_champion_elo := coalesce((v_overrides->>'champion_elo')::int, v_tier.champion_elo, 0);
  v_runnerup_pct := coalesce((v_overrides->>'runnerup_pct')::numeric, v_tier.runnerup_pct, 0.5);
  v_thirdplace_pct := coalesce((v_overrides->>'thirdplace_pct')::numeric, v_tier.thirdplace_pct, 0.25);
  v_participant_pct := coalesce((v_overrides->>'participant_pct')::numeric, v_tier.participant_pct, 0.2);

  select array_agg((x)::text::bigint) into v_champion_anchors from jsonb_array_elements(coalesce(v_hof->'champion_ids','[]'::jsonb)) x;
  v_runnerup_anchor := (v_hof->>'runner_up_id')::bigint;
  select array_agg((x)::text::bigint) into v_thirdplace_anchors from jsonb_array_elements(coalesce(v_hof->'third_place_ids','[]'::jsonb)) x;

  select array_agg(distinct pid) into v_all_entrant_ids
  from (
    select (e->>'playerId')::bigint as pid from jsonb_array_elements(v_entrants) e
    union all
    select (e->>'partnerId')::bigint from jsonb_array_elements(v_entrants) e where (e->>'partnerId') is not null
  ) s;

  -- champion
  foreach v_anchor in array coalesce(v_champion_anchors, '{}'::bigint[]) loop
    v_placed_ids := v_placed_ids || v_anchor;
    select (e->>'partnerId')::bigint into v_partner from jsonb_array_elements(v_entrants) e where (e->>'playerId')::bigint = v_anchor limit 1;
    if v_partner is not null then v_placed_ids := v_placed_ids || v_partner; end if;
    foreach v_recipient in array array_remove(array[v_anchor, v_partner], null) loop
      v_key := 'tournament:' || p_tournament_id || ':champion:' || v_recipient;
      select id into v_existing from reward_transactions where idempotency_key = v_key and reward_transactions.player_id = v_recipient;
      if v_existing is null then
        perform reward_grant('tournament', '[]'::jsonb,
          jsonb_build_array(jsonb_build_object('currency_id','coin','amount',v_champion_coins)),
          jsonb_build_object('tournament_id', p_tournament_id, 'role', 'champion'), v_key,
          null, null, null, v_recipient);
        if v_champion_elo > 0 then update players set pts = pts + v_champion_elo where id = v_recipient; end if;
        return query select v_recipient, 'champion'::text, v_champion_coins, v_champion_elo, false;
      else
        return query select v_recipient, 'champion'::text, 0, 0, true;
      end if;
    end loop;
  end loop;

  -- runner-up
  if v_runnerup_anchor is not null then
    v_placed_ids := v_placed_ids || v_runnerup_anchor;
    select (e->>'partnerId')::bigint into v_partner from jsonb_array_elements(v_entrants) e where (e->>'playerId')::bigint = v_runnerup_anchor limit 1;
    if v_partner is not null then v_placed_ids := v_placed_ids || v_partner; end if;
    v_coin_amt := floor(v_champion_coins * v_runnerup_pct)::int;
    v_elo_amt := floor(v_champion_elo * v_runnerup_pct)::int;
    foreach v_recipient in array array_remove(array[v_runnerup_anchor, v_partner], null) loop
      v_key := 'tournament:' || p_tournament_id || ':runner_up:' || v_recipient;
      select id into v_existing from reward_transactions where idempotency_key = v_key and reward_transactions.player_id = v_recipient;
      if v_existing is null then
        perform reward_grant('tournament', '[]'::jsonb,
          jsonb_build_array(jsonb_build_object('currency_id','coin','amount',v_coin_amt)),
          jsonb_build_object('tournament_id', p_tournament_id, 'role', 'runner_up'), v_key,
          null, null, null, v_recipient);
        if v_elo_amt > 0 then update players set pts = pts + v_elo_amt where id = v_recipient; end if;
        return query select v_recipient, 'runner_up'::text, v_coin_amt, v_elo_amt, false;
      else
        return query select v_recipient, 'runner_up'::text, 0, 0, true;
      end if;
    end loop;
  end if;

  -- third place (both semifinal losers)
  v_coin_amt := floor(v_champion_coins * v_thirdplace_pct)::int;
  v_elo_amt := floor(v_champion_elo * v_thirdplace_pct)::int;
  foreach v_anchor in array coalesce(v_thirdplace_anchors, '{}'::bigint[]) loop
    v_placed_ids := v_placed_ids || v_anchor;
    select (e->>'partnerId')::bigint into v_partner from jsonb_array_elements(v_entrants) e where (e->>'playerId')::bigint = v_anchor limit 1;
    if v_partner is not null then v_placed_ids := v_placed_ids || v_partner; end if;
    foreach v_recipient in array array_remove(array[v_anchor, v_partner], null) loop
      v_key := 'tournament:' || p_tournament_id || ':third_place:' || v_recipient;
      select id into v_existing from reward_transactions where idempotency_key = v_key and reward_transactions.player_id = v_recipient;
      if v_existing is null then
        perform reward_grant('tournament', '[]'::jsonb,
          jsonb_build_array(jsonb_build_object('currency_id','coin','amount',v_coin_amt)),
          jsonb_build_object('tournament_id', p_tournament_id, 'role', 'third_place'), v_key,
          null, null, null, v_recipient);
        if v_elo_amt > 0 then update players set pts = pts + v_elo_amt where id = v_recipient; end if;
        return query select v_recipient, 'third_place'::text, v_coin_amt, v_elo_amt, false;
      else
        return query select v_recipient, 'third_place'::text, 0, 0, true;
      end if;
    end loop;
  end loop;

  -- everyone else who registered: participation reward
  v_coin_amt := floor(v_champion_coins * v_participant_pct)::int;
  v_elo_amt := floor(v_champion_elo * v_participant_pct)::int;
  foreach v_recipient in array coalesce(v_all_entrant_ids, '{}'::bigint[]) loop
    if v_recipient = any(v_placed_ids) then continue; end if;
    v_key := 'tournament:' || p_tournament_id || ':participant:' || v_recipient;
    select id into v_existing from reward_transactions where idempotency_key = v_key and reward_transactions.player_id = v_recipient;
    if v_existing is null then
      perform reward_grant('tournament', '[]'::jsonb,
        jsonb_build_array(jsonb_build_object('currency_id','coin','amount',v_coin_amt)),
        jsonb_build_object('tournament_id', p_tournament_id, 'role', 'participant'), v_key,
        null, null, null, v_recipient);
      if v_elo_amt > 0 then update players set pts = pts + v_elo_amt where id = v_recipient; end if;
      return query select v_recipient, 'participant'::text, v_coin_amt, v_elo_amt, false;
    else
      return query select v_recipient, 'participant'::text, 0, 0, true;
    end if;
  end loop;

  return;
end;
$$;

grant execute on function public.rpc_tournament_grant_rewards(bigint) to anon, authenticated;
