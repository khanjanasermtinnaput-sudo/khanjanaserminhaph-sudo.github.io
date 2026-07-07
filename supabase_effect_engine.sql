-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 2.3 — Effect/Buff Engine (framework only, seeded EMPTY)
-- Applied via Supabase MCP apply_migration (migration name: p2_step3_effect_engine)
--
-- Every equippable item today is purely cosmetic (verified: 0 rows exist
-- anywhere with buff-shaped data). This builds the full data-driven
-- effect/stacking/condition machinery per user decision, but seeds ZERO
-- effect_definitions/item_effects rows and wires NOTHING into
-- _exp_apply/rpc_award_match_coins — zero gameplay-balance change for the
-- 35 live players. recalc_player_effects() replaces Step 2's no-op stub
-- (same signature = true replace, verified via pg_proc count).
--
-- effect_type/category/value_type/stack_rule are plain text (no CHECK) —
-- "support unlimited effect types" without a future migration.
-- effect_condition_met() implements a REAL subset of conditions now
-- (always/weekend/level_gte/pts_gte/is_admin); unimplemented types
-- (during_tournament, event_active, vip, premium_user, ...) are
-- recognized shapes that resolve to false — inert, not broken, ready to
-- wire up when those systems exist.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE effect_definitions (
  effect_key        text PRIMARY KEY,
  name              text NOT NULL,
  description       text,
  effect_type       text NOT NULL,  -- exp_bonus, coin_bonus, cosmetic, ... (unlimited, no CHECK)
  category          text NOT NULL DEFAULT 'cosmetic'
                      CHECK (category IN ('passive','active','cosmetic','temporary','permanent',
                        'conditional','timed','seasonal','event','admin','developer','stackable','unique')),
  value_type        text NOT NULL DEFAULT 'flat' CHECK (value_type IN ('flat','percent','bool','string')),
  value             numeric NOT NULL DEFAULT 0,
  stack_rule        text NOT NULL DEFAULT 'additive'
                      CHECK (stack_rule IN ('additive','multiplicative','highest','lowest',
                        'override','exclusive','unique','disabled','priority')),
  priority          int NOT NULL DEFAULT 0,
  execution_order   int NOT NULL DEFAULT 0,
  condition         jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_seconds  int,
  cooldown_seconds  int,
  source            text,
  enabled           boolean NOT NULL DEFAULT true,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE effect_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read ON effect_definitions FOR SELECT USING (true);
CREATE POLICY ref_admin_insert ON effect_definitions FOR INSERT WITH CHECK (is_admin_caller());
CREATE POLICY ref_admin_update ON effect_definitions FOR UPDATE USING (is_admin_caller()) WITH CHECK (is_admin_caller());
CREATE POLICY ref_admin_delete ON effect_definitions FOR DELETE USING (is_admin_caller());
GRANT ALL ON effect_definitions TO anon, authenticated;

CREATE TABLE item_effects (
  item_id    text NOT NULL REFERENCES item_catalog(id),
  effect_key text NOT NULL REFERENCES effect_definitions(effect_key),
  PRIMARY KEY (item_id, effect_key)
);

ALTER TABLE item_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read ON item_effects FOR SELECT USING (true);
CREATE POLICY ref_admin_insert ON item_effects FOR INSERT WITH CHECK (is_admin_caller());
CREATE POLICY ref_admin_update ON item_effects FOR UPDATE USING (is_admin_caller()) WITH CHECK (is_admin_caller());
CREATE POLICY ref_admin_delete ON item_effects FOR DELETE USING (is_admin_caller());
GRANT ALL ON item_effects TO anon, authenticated;
CREATE INDEX item_effects_effect_key_idx ON item_effects (effect_key);

CREATE TABLE player_active_effects (
  player_id      bigint NOT NULL REFERENCES players(id),
  effect_key     text NOT NULL REFERENCES effect_definitions(effect_key),
  resolved_value numeric NOT NULL,
  resolved_type  text NOT NULL,
  source_item_id text,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, effect_key)
);

ALTER TABLE player_active_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_active_effects_read ON player_active_effects FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON player_active_effects TO anon, authenticated;

-- Data-driven condition evaluator. {} or NULL => always true.
CREATE OR REPLACE FUNCTION effect_condition_met(p_player bigint, p_condition jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type text; v_player players%ROWTYPE;
BEGIN
  IF p_condition IS NULL OR p_condition = '{}'::jsonb THEN RETURN true; END IF;
  v_type := p_condition ->> 'type';
  IF v_type IS NULL OR v_type = 'always' THEN RETURN true; END IF;

  IF v_type = 'weekend' THEN
    RETURN EXTRACT(ISODOW FROM now()) IN (6, 7);
  END IF;

  SELECT * INTO v_player FROM players WHERE id = p_player;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_type = 'level_gte' THEN
    RETURN v_player.level >= COALESCE((p_condition ->> 'value')::int, 999999);
  ELSIF v_type IN ('rank_gte', 'pts_gte') THEN
    RETURN v_player.pts >= COALESCE((p_condition ->> 'value')::int, 999999);
  ELSIF v_type = 'is_admin' THEN
    RETURN v_player.is_admin;
  END IF;

  -- Recognized-but-not-yet-implemented condition shapes (during_tournament,
  -- event_active, quest_completed, premium_user, vip, own_badge,
  -- daily_login, weather_event, holiday, time_range, custom_sql) resolve
  -- inert (false) rather than erroring, since none of those systems exist
  -- yet — wiring them up later needs no schema change here.
  RETURN false;
END $$;

-- Real implementation, replacing Step 2's no-op stub.
CREATE OR REPLACE FUNCTION recalc_player_effects(p_player bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text; v_rule text; v_value_type text;
  v_resolved numeric; v_source text;
  v_row record; v_product numeric;
BEGIN
  DELETE FROM player_active_effects WHERE player_id = p_player;

  FOR v_key, v_rule, v_value_type IN
    SELECT DISTINCT ed.effect_key, ed.stack_rule, ed.value_type
    FROM player_items pi
    JOIN item_effects ie ON ie.item_id = pi.item_id
    JOIN effect_definitions ed ON ed.effect_key = ie.effect_key
    WHERE pi.player_id = p_player AND pi.is_equipped AND pi.deleted_at IS NULL AND ed.enabled
  LOOP
    IF v_rule = 'disabled' THEN CONTINUE; END IF;

    IF v_rule = 'multiplicative' THEN
      v_product := 1; v_source := NULL; v_resolved := NULL;
      FOR v_row IN
        SELECT ed.value, pi.item_id FROM player_items pi
        JOIN item_effects ie ON ie.item_id = pi.item_id AND ie.effect_key = v_key
        JOIN effect_definitions ed ON ed.effect_key = v_key
        WHERE pi.player_id = p_player AND pi.is_equipped AND pi.deleted_at IS NULL
          AND effect_condition_met(p_player, ed.condition)
      LOOP
        v_product := v_product * (CASE WHEN v_value_type = 'percent' THEN (1 + v_row.value / 100.0) ELSE v_row.value END);
        v_source := v_row.item_id;
        v_resolved := 0; -- mark "at least one contributor found"
      END LOOP;
      IF v_resolved IS NOT NULL THEN
        v_resolved := CASE WHEN v_value_type = 'percent' THEN (v_product - 1) * 100 ELSE v_product END;
      END IF;
    ELSE
      SELECT
        CASE v_rule
          WHEN 'additive' THEN SUM(ed.value)
          WHEN 'highest'  THEN MAX(ed.value)
          WHEN 'lowest'   THEN MIN(ed.value)
          ELSE (array_agg(ed.value ORDER BY ed.priority DESC, ed.execution_order DESC))[1]
        END,
        (array_agg(pi.item_id ORDER BY ed.priority DESC, ed.execution_order DESC))[1]
      INTO v_resolved, v_source
      FROM player_items pi
      JOIN item_effects ie ON ie.item_id = pi.item_id AND ie.effect_key = v_key
      JOIN effect_definitions ed ON ed.effect_key = v_key
      WHERE pi.player_id = p_player AND pi.is_equipped AND pi.deleted_at IS NULL
        AND effect_condition_met(p_player, ed.condition);
    END IF;

    IF v_resolved IS NOT NULL THEN
      INSERT INTO player_active_effects (player_id, effect_key, resolved_value, resolved_type, source_item_id, computed_at)
      VALUES (p_player, v_key, v_resolved, v_value_type, v_source, now());
    END IF;
  END LOOP;
END $$;

-- Read API for the current player's (or admin's target) resolved buffs.
CREATE OR REPLACE FUNCTION get_active_buffs(p_player bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target bigint;
BEGIN
  v_target := COALESCE(p_player, session_uid());
  IF v_target IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_target <> session_uid() AND NOT is_admin_caller() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN COALESCE((
    SELECT jsonb_object_agg(effect_key, jsonb_build_object(
      'value', resolved_value, 'type', resolved_type, 'source_item_id', source_item_id))
    FROM player_active_effects WHERE player_id = v_target
  ), '{}'::jsonb);
END $$;
