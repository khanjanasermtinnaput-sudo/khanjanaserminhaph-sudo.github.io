-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 2.6 — Realtime, remaining indexes, advisors pass
-- Applied via Supabase MCP apply_migration (migrations: p2_step6_realtime_hardening, p2_step6_fk_indexes)
--
-- equipment_presets/item_effects(effect_key)/player_active_effects(player_id
-- via PK)/equipment_presets(player_id) were already indexed at creation
-- time (Steps 3-4). Ran get_advisors after all of Phase 2: only 3 real
-- unindexed-FK findings on new tables (equipment_slots.category,
-- item_categories.equip_slot, player_active_effects.effect_key) - fixed
-- below. "Unused index" notices on brand-new indexes (item_effects_
-- effect_key_idx etc.) are expected for a framework seeded empty with no
-- real traffic yet, not a real issue. No multiple-permissive-policy
-- regressions this time (per-command policies used from the start).
-- Security: every new RPC flagged as "SECURITY DEFINER executable by
-- anon/authenticated" is the same expected pattern as every RPC across
-- this whole app (session_uid()-gated) - not a Phase 2 regression.
-- ═══════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE equipment_presets;

CREATE INDEX equipment_slots_category_idx ON equipment_slots (category);
CREATE INDEX item_categories_equip_slot_idx ON item_categories (equip_slot);
CREATE INDEX player_active_effects_effect_key_idx ON player_active_effects (effect_key);
