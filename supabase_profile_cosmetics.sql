-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 2.5 — Profile cosmetics read API
-- Applied via Supabase MCP apply_migration (migration name: p2_step5_profile_cosmetics)
--
-- Public read: cosmetics are meant to be visible on leaderboard/profile/
-- tournament (spec's Profile & Tournament Integration sections), so this
-- doesn't require the caller to own the profile. Buff summary is the
-- exception — only included when viewing your own profile or as admin
-- (reusing get_active_buffs' authorization), omitted (not erroring)
-- otherwise so viewing someone else's profile never breaks.
-- p_context='tournament' additionally allows slots marked
-- visibility='tournament' in equipment_slots (none exist yet — inert
-- until tournament-specific cosmetics are added, no schema change needed).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_profile_cosmetics(p_player bigint, p_context text DEFAULT 'profile') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_equipped jsonb; v_collection jsonb; v_buffs jsonb := '{}'::jsonb; v_caller bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player) THEN RAISE EXCEPTION 'player_not_found'; END IF;

  SELECT COALESCE(jsonb_object_agg(es.slot_key, jsonb_build_object(
      'item_id', c.id, 'value', c.value, 'label_en', c.label_en, 'label_th', c.label_th,
      'rarity', c.rarity, 'icon', c.icon, 'preview_meta', c.preview_meta
    )), '{}'::jsonb)
  INTO v_equipped
  FROM player_items pi
  JOIN item_catalog c ON c.id = pi.item_id
  JOIN equipment_slots es ON es.slot_key = pi.equip_slot AND es.enabled
  WHERE pi.player_id = p_player AND pi.is_equipped AND pi.deleted_at IS NULL
    AND (p_context <> 'tournament' OR es.visibility IN ('public', 'tournament'));

  SELECT jsonb_build_object(
    'owned', count(*) FILTER (WHERE pi.player_id IS NOT NULL),
    'total', count(*)
  ) INTO v_collection
  FROM item_catalog c
  LEFT JOIN player_items pi ON pi.item_id = c.id AND pi.player_id = p_player AND pi.deleted_at IS NULL
  WHERE NOT c.hidden;

  v_caller := session_uid();
  IF v_caller = p_player OR is_admin_caller() THEN
    v_buffs := get_active_buffs(p_player);
  END IF;

  RETURN jsonb_build_object('player_id', p_player, 'equipped', v_equipped, 'collection', v_collection, 'buffs', v_buffs);
END $$;
