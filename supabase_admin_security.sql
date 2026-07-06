-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 1B STEP 10 (scaffold) — Audit & security tables
-- Applied via Supabase MCP apply_migration (migration name: inv_step10_admin_security)
--
-- Admin/system visibility only — no player-facing UI needed. All writes
-- go through helper functions (log_admin_action / log_security_event /
-- log_audit / admin_grant_item), never direct client inserts. Append-only
-- tables reuse the existing econ_block_mutation() trigger from Step 5.
-- admin_grant_item never inserts into player_items directly — it routes
-- through reward_grant() like every other source, per the spec's explicit
-- "never insert directly into inventory" rule for admin grants.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE admin_actions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id     bigint NOT NULL REFERENCES players(id),
  action       text NOT NULL,
  target_table text,
  target_id    text,
  old_data     jsonb,
  new_data     jsonb,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_actions_read ON admin_actions FOR SELECT USING (is_admin_caller());
GRANT ALL ON admin_actions TO anon, authenticated;
CREATE TRIGGER trg_admin_actions_immutable BEFORE UPDATE OR DELETE ON admin_actions
  FOR EACH ROW EXECUTE FUNCTION econ_block_mutation();
CREATE INDEX admin_actions_admin_idx ON admin_actions (admin_id, created_at DESC);

CREATE OR REPLACE FUNCTION log_admin_action(p_action text, p_target_table text DEFAULT NULL,
  p_target_id text DEFAULT NULL, p_old_data jsonb DEFAULT NULL, p_new_data jsonb DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin bigint; v_id bigint;
BEGIN
  v_admin := session_uid();
  IF v_admin IS NULL OR NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  INSERT INTO admin_actions (admin_id, action, target_table, target_id, old_data, new_data)
  VALUES (v_admin, p_action, p_target_table, p_target_id, p_old_data, p_new_data)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE TABLE security_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id   bigint REFERENCES players(id),
  event_type  text NOT NULL CHECK (event_type IN
                ('rapid_requests','duplicate_transaction','inventory_desync','currency_mismatch',
                 'trade_exploit','marketplace_exploit','packet_manipulation','authentication_failure',
                 'suspicious_login','impossible_equip','duplicate_reward')),
  severity    text NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  description text,
  ip_address  text,
  device      text,
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_events_read ON security_events FOR SELECT USING (is_admin_caller());
CREATE POLICY security_events_resolve ON security_events FOR UPDATE
  USING (is_admin_caller()) WITH CHECK (is_admin_caller());
GRANT ALL ON security_events TO anon, authenticated;
CREATE INDEX security_events_unresolved_idx ON security_events (resolved, severity, created_at DESC);

CREATE OR REPLACE FUNCTION log_security_event(p_player bigint, p_event_type text, p_severity text,
  p_description text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO security_events (player_id, event_type, severity, description)
  VALUES (p_player, p_event_type, p_severity, p_description)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  bigint REFERENCES players(id),
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON audit_logs TO anon, authenticated;
CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION econ_block_mutation();
CREATE INDEX audit_logs_player_idx ON audit_logs (player_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);

CREATE OR REPLACE FUNCTION log_audit(p_player bigint, p_action text, p_entity text DEFAULT NULL,
  p_entity_id text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO audit_logs (player_id, action, entity, entity_id, metadata)
  VALUES (p_player, p_action, p_entity, p_entity_id, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE TABLE admin_item_grants (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id      bigint NOT NULL REFERENCES players(id),
  player_id     bigint NOT NULL REFERENCES players(id),
  item_id       text NOT NULL REFERENCES item_catalog(id),
  quantity      int NOT NULL DEFAULT 1,
  reason        text,
  approved      boolean NOT NULL DEFAULT true,
  reward_transaction_id uuid REFERENCES reward_transactions(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_item_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_item_grants_read ON admin_item_grants FOR SELECT
  USING (player_id = session_uid() OR is_admin_caller());
GRANT ALL ON admin_item_grants TO anon, authenticated;
CREATE INDEX admin_item_grants_player_idx ON admin_item_grants (player_id, created_at DESC);

-- Admin item grants NEVER insert into player_items directly - they route
-- through reward_grant() like every other source (spec: "never insert
-- directly into inventory"; "every grant creates Reward Transaction").
CREATE OR REPLACE FUNCTION admin_grant_item(p_player bigint, p_item_id text, p_qty int DEFAULT 1,
  p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin bigint; v_txn uuid; v_grant_id bigint;
BEGIN
  v_admin := session_uid();
  IF v_admin IS NULL OR NOT is_admin_caller() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player) THEN RAISE EXCEPTION 'player_not_found'; END IF;

  v_txn := reward_grant('admin', jsonb_build_array(jsonb_build_object('item_id', p_item_id, 'qty', p_qty)),
    '[]'::jsonb, jsonb_build_object('admin_id', v_admin, 'reason', p_reason),
    NULL, NULL, NULL, NULL, p_player);

  INSERT INTO admin_item_grants (admin_id, player_id, item_id, quantity, reason, reward_transaction_id)
  VALUES (v_admin, p_player, p_item_id, p_qty, p_reason, v_txn) RETURNING id INTO v_grant_id;

  PERFORM log_admin_action('grant_item', 'player_items', p_player::text, NULL,
    jsonb_build_object('item_id', p_item_id, 'qty', p_qty, 'reason', p_reason, 'grant_id', v_grant_id));

  RETURN v_txn;
END $$;
