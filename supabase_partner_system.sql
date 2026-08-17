-- ─────────────────────────────────────────────────────────────────────────
-- PARTNER SYSTEM — mutual/greedy doubles-partner detection + Double Rank
--
-- Derives each player's official doubles partner from real match history
-- (matches.team_a/team_b doubles rows + completed 2v2 tournament_matches),
-- using greedy max-weight matching over the tie-break chain: total matches
-- together > wins together > pair win rate > most recent match > stable id
-- ordering. Everything is a derived cache, fully rebuilt inside one
-- transaction by rpc_recalc_partner_system() — never hand-edited, never
-- drifts from source match history. Double Rank score is NOT stored; it is
-- always computed at read time as (p1.pts + p2.pts) / 2 from live players.pts
-- (see v_official_pairs).
--
-- Idempotent: safe to re-run in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. pair_stats — derived cache of aggregate doubles stats per unordered pair.
--    Rebuilt in full by _recalc_pair_stats(); never hand-edited.
CREATE TABLE IF NOT EXISTS public.pair_stats (
  player_id_low    bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  player_id_high   bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  matches_together int NOT NULL DEFAULT 0,
  wins_together    int NOT NULL DEFAULT 0,
  losses_together  int NOT NULL DEFAULT 0,
  last_played_at   timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id_low, player_id_high),
  CONSTRAINT pair_stats_ordered CHECK (player_id_low < player_id_high)
);
CREATE INDEX IF NOT EXISTS idx_pair_stats_low  ON public.pair_stats(player_id_low);
CREATE INDEX IF NOT EXISTS idx_pair_stats_high ON public.pair_stats(player_id_high);

ALTER TABLE public.pair_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pair_stats_read ON public.pair_stats;
CREATE POLICY pair_stats_read ON public.pair_stats FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE grants to anon/authenticated — RPC-only writes
-- (matches the exp_match_ledger / players level-columns convention).

-- 2. player_partners — the CURRENT official disjoint pairing (one row per
--    official pair, normalized so player_id_low < player_id_high). This is
--    the "answer" the leaderboard's Double Rank mode reads. Overwritten
--    wholesale by _recalc_official_pairs() every recalc.
CREATE TABLE IF NOT EXISTS public.player_partners (
  player_id_low   bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  player_id_high  bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  paired_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id_low, player_id_high),
  CONSTRAINT player_partners_ordered CHECK (player_id_low < player_id_high)
);
-- Disjointness (a player belongs to at most one official pair) is enforced by
-- the greedy-matching algorithm in _recalc_official_pairs(), not by a DB
-- constraint (Postgres has no built-in cross-row exclusion for "id appears in
-- at most one of two columns across the whole table"); the recalc always
-- TRUNCATEs+rebuilds inside one transaction so no partial/inconsistent state
-- is ever visible to readers.
CREATE INDEX IF NOT EXISTS idx_player_partners_low  ON public.player_partners(player_id_low);
CREATE INDEX IF NOT EXISTS idx_player_partners_high ON public.player_partners(player_id_high);

ALTER TABLE public.player_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_partners_read ON public.player_partners;
CREATE POLICY player_partners_read ON public.player_partners FOR SELECT USING (true);
-- No write grants — RPC-only.

-- 3. partner_recalc_log — informational audit trail only (recalc is
--    idempotent-by-full-rebuild, not skip-if-seen, so this is NOT used to
--    gate work — purely observability for admins).
CREATE TABLE IF NOT EXISTS public.partner_recalc_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger_match_id  bigint,          -- nullable: null for tournament-triggered or manual recalcs
  trigger_source    text NOT NULL,   -- 'matches' | 'tournament_matches' | 'manual'
  pairs_count       int NOT NULL,
  ran_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.partner_recalc_log ENABLE ROW LEVEL SECURITY;
-- No policies/grants — fully internal (admin can inspect via SQL editor).

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Source rows — every legitimate completed doubles game, from both the
--    plain casual/ranked matches table and completed 2v2 tournament matches.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._pair_source_rows()
RETURNS TABLE(player_id_low bigint, player_id_high bigint, won boolean, played_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Source A: plain doubles matches (team_a/team_b jsonb, 2 elements each).
  -- `matches` rows only ever exist once finalized (no cancelled/pending rows
  -- live here — those stay in pending_matches until admin-approved), so
  -- "row exists" already means "legitimate completed match".
  WITH matches_pairs AS (
    SELECT LEAST(a1, a2) AS player_id_low, GREATEST(a1, a2) AS player_id_high,
           (m.win_team = 'A') AS won, m.played_at
    FROM public.matches m,
      LATERAL (SELECT (m.team_a->0->>'id')::bigint AS a1, (m.team_a->1->>'id')::bigint AS a2) ta
    WHERE m.type = 'doubles' AND jsonb_array_length(m.team_a) = 2 AND a1 IS NOT NULL AND a2 IS NOT NULL
    UNION ALL
    SELECT LEAST(b1, b2), GREATEST(b1, b2),
           (m.win_team = 'B'), m.played_at
    FROM public.matches m,
      LATERAL (SELECT (m.team_b->0->>'id')::bigint AS b1, (m.team_b->1->>'id')::bigint AS b2) tb
    WHERE m.type = 'doubles' AND jsonb_array_length(m.team_b) = 2 AND b1 IS NOT NULL AND b2 IS NOT NULL
  ),
  -- Source B: completed 2v2 tournament matches. tournament_matches only
  -- stores the team "anchor" as player_a/player_b; the partner is
  -- reconstructed by walking tournaments.groups[].teams[].playerIds and
  -- matching the anchor at index 0 — the exact same jsonb-walk pattern
  -- rpc_tournament_grant_rewards uses for partner lookups
  -- (supabase_tournament_knockout.sql ~lines 687-747), including the same
  -- _meta/_config/_hof sentinel-object exclusion.
  tourney_pairs AS (
    SELECT LEAST(tm.player_a, pa_partner) AS player_id_low, GREATEST(tm.player_a, pa_partner) AS player_id_high,
           (tm.winner_id = tm.player_a) AS won, tm.played_at
    FROM public.tournament_matches tm
    JOIN public.tournaments t ON t.id = tm.tournament_id
    CROSS JOIN LATERAL (
      SELECT (team->'playerIds'->>1)::bigint AS pa_partner
      FROM jsonb_array_elements(COALESCE(t.groups, '[]'::jsonb)) g,
           jsonb_array_elements(COALESCE(g->'teams', '[]'::jsonb)) team
      WHERE NOT COALESCE((g->>'_meta')::boolean, false)
        AND NOT COALESCE((g->>'_config')::boolean, false)
        AND NOT COALESCE((g->>'_hof')::boolean, false)
        AND (team->'playerIds'->>0)::bigint = tm.player_a
      LIMIT 1
    ) pa_lookup
    WHERE tm.status = 'completed' AND tm.player_a IS NOT NULL AND pa_partner IS NOT NULL
    UNION ALL
    SELECT LEAST(tm.player_b, pb_partner), GREATEST(tm.player_b, pb_partner),
           (tm.winner_id = tm.player_b), tm.played_at
    FROM public.tournament_matches tm
    JOIN public.tournaments t ON t.id = tm.tournament_id
    CROSS JOIN LATERAL (
      SELECT (team->'playerIds'->>1)::bigint AS pb_partner
      FROM jsonb_array_elements(COALESCE(t.groups, '[]'::jsonb)) g,
           jsonb_array_elements(COALESCE(g->'teams', '[]'::jsonb)) team
      WHERE NOT COALESCE((g->>'_meta')::boolean, false)
        AND NOT COALESCE((g->>'_config')::boolean, false)
        AND NOT COALESCE((g->>'_hof')::boolean, false)
        AND (team->'playerIds'->>0)::bigint = tm.player_b
      LIMIT 1
    ) pb_lookup
    WHERE tm.status = 'completed' AND tm.player_b IS NOT NULL AND pb_partner IS NOT NULL
  )
  SELECT * FROM matches_pairs
  UNION ALL
  SELECT * FROM tourney_pairs;
$$;
REVOKE ALL ON FUNCTION public._pair_source_rows() FROM anon, authenticated, public;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Rebuild pair_stats from source rows (full TRUNCATE + rebuild).
--    GROUP BY aggregation over real PK-backed source rows structurally
--    prevents any duplicate-row inflation. Pairs where either player no
--    longer exists are silently excluded (no crash) via the WHERE EXISTS
--    filter — deleted players just drop out.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._recalc_pair_stats()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  TRUNCATE public.pair_stats;
  INSERT INTO public.pair_stats (player_id_low, player_id_high, matches_together, wins_together, losses_together, last_played_at)
  SELECT player_id_low, player_id_high,
         COUNT(*),
         COUNT(*) FILTER (WHERE won),
         COUNT(*) FILTER (WHERE NOT won),
         MAX(played_at)
  FROM public._pair_source_rows() s
  WHERE EXISTS (SELECT 1 FROM public.players WHERE id = s.player_id_low)
    AND EXISTS (SELECT 1 FROM public.players WHERE id = s.player_id_high)
  GROUP BY player_id_low, player_id_high;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._recalc_pair_stats() FROM anon, authenticated, public;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Rebuild player_partners via greedy max-weight matching over pair_stats,
--    ordered by the exact tie-break chain from the spec. Deterministic,
--    never random, structurally disjoint (each player claimed at most once).
--    This is the chosen conflict-resolution algorithm: when A's strongest
--    relationship is B but B's strongest is C, whichever edge is globally
--    stronger is locked in first; the loser gets their next-best *available*
--    partner (or none, if all remaining candidates are already claimed).
--    Mutual-strongest pairs (A/B each other's #1) naturally form first,
--    since the globally strongest edge touching two players is picked before
--    any weaker edge involving either of them can claim them.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._recalc_official_pairs()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int; r record;
  v_assigned bigint[] := '{}';
BEGIN
  TRUNCATE public.player_partners;

  FOR r IN
    SELECT player_id_low, player_id_high, matches_together, wins_together,
           CASE WHEN matches_together > 0
                THEN wins_together::numeric / matches_together ELSE 0 END AS win_rate,
           last_played_at
    FROM public.pair_stats
    ORDER BY
      matches_together DESC,           -- tie-break 1: total doubles matches together (primary factor)
      wins_together DESC,              -- tie-break 2: more wins together
      win_rate DESC,                   -- tie-break 3: higher pair win rate
      last_played_at DESC NULLS LAST,  -- tie-break 4: more recent match together
      player_id_low ASC, player_id_high ASC  -- tie-break 5: stable id ordering, never random
  LOOP
    IF r.player_id_low = ANY(v_assigned) OR r.player_id_high = ANY(v_assigned) THEN CONTINUE; END IF;
    INSERT INTO public.player_partners (player_id_low, player_id_high) VALUES (r.player_id_low, r.player_id_high);
    v_assigned := v_assigned || r.player_id_low || r.player_id_high;
  END LOOP;

  SELECT COUNT(*) INTO v_n FROM public.player_partners;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._recalc_official_pairs() FROM anon, authenticated, public;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Public entrypoint — triggered after a qualifying match completes.
--    Requires only a valid session (not admin): recalc is read-only against
--    already-authoritative match history (matches/tournament_matches) and
--    writes only the derived pair_stats/player_partners cache, so a caller
--    can't forge or inflate anything by invoking it — same reasoning
--    rpc_tournament_submit_group_result already applies (session required,
--    not admin) since round-robin group results are self-submitted by
--    players, not admins; gating this to admin-only would leave tournament-
--    submitted doubles matches never triggering a recalc. Follows the
--    current session-header auth convention (session_uid() reads
--    x-player-token via request headers — no p_token param needed, matching
--    rpc_tournament_register and friends rather than the older explicit-
--    p_token style).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_recalc_partner_system(p_trigger_match_id bigint DEFAULT NULL, p_source text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stats_n int; v_pairs_n int; v_source text;
BEGIN
  IF session_uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_stats_n := public._recalc_pair_stats();
  v_pairs_n := public._recalc_official_pairs();

  v_source := COALESCE(p_source, CASE WHEN p_trigger_match_id IS NULL THEN 'manual' ELSE 'matches' END);
  INSERT INTO public.partner_recalc_log (trigger_match_id, trigger_source, pairs_count)
  VALUES (p_trigger_match_id, v_source, v_pairs_n);

  RETURN jsonb_build_object('ok', true, 'pair_stats_rows', v_stats_n, 'official_pairs', v_pairs_n);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_recalc_partner_system(bigint, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Read-time view for Double Rank — joins live players.pts so the score
--    can never go stale independent of individual ranking-point changes.
--    The leaderboard JS may alternatively compute (p1.pts+p2.pts)/2
--    client-side from already-loaded db.players; both read the same source.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_official_pairs AS
SELECT
  pp.player_id_low, pp.player_id_high,
  p1.name AS name_low, p2.name AS name_high,
  p1.pts  AS pts_low,  p2.pts  AS pts_high,
  ROUND((p1.pts + p2.pts) / 2.0) AS double_rank_score,
  COALESCE(ps.matches_together, 0) AS matches_together,
  COALESCE(ps.wins_together, 0)    AS wins_together,
  COALESCE(ps.losses_together, 0)  AS losses_together,
  CASE WHEN COALESCE(ps.matches_together, 0) > 0
       THEN ROUND(ps.wins_together::numeric / ps.matches_together * 100, 1)
       ELSE 0 END AS win_rate_pct,
  ps.last_played_at
FROM public.player_partners pp
JOIN public.players p1 ON p1.id = pp.player_id_low
JOIN public.players p2 ON p2.id = pp.player_id_high
LEFT JOIN public.pair_stats ps
  ON ps.player_id_low = pp.player_id_low AND ps.player_id_high = pp.player_id_high;
GRANT SELECT ON public.v_official_pairs TO anon, authenticated;
