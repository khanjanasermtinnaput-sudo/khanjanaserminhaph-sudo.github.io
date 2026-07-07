-- ═══════════════════════════════════════════════════════════════════════
-- PHASE 2.1 — equipment_slots (data-driven slot config)
-- Applied via Supabase MCP apply_migration (migration name: p2_step1_equipment_slots)
--
-- "Never hardcode slot names" — seeds the 5 slots actually in use today
-- (mapped to their real item_categories) PLUS the spec's full aspirational
-- slot list as disabled placeholder rows (category=NULL, no items exist
-- for them yet). Flipping enabled=true + adding a category/items later
-- requires zero schema change. `title` has an item_categories row already
-- (0 items) — kept disabled here; see plan note on not conflating this
-- with the separate prime_titles achievement system.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE equipment_slots (
  slot_key         text PRIMARY KEY,
  display_name_en  text NOT NULL,
  display_name_th  text NOT NULL,
  icon             text,
  category         text REFERENCES item_categories(code),
  max_equipped     int NOT NULL DEFAULT 1,
  display_priority int NOT NULL DEFAULT 0,
  visibility       text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private','tournament')),
  enabled          boolean NOT NULL DEFAULT true,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO equipment_slots (slot_key, display_name_en, display_name_th, icon, category, display_priority, enabled) VALUES
  ('frame',   'Frame',       'กรอบ',         '🖼️', 'frame',   0, true),
  ('name',    'Name Effect', 'ชื่อเอฟเฟกต์',  '✨', 'name',    1, true),
  ('emoji',   'Emoji',       'อีโมจิ',        '🎭', 'emoji',   2, true),
  ('element', 'Element',     'ธาตุ',          '☯️', 'element', 3, true),
  ('effect',  'Special',     'เอฟเฟกต์',      '⚡', 'effect',  4, true),
  ('title',   'Title',       'ตำแหน่ง',       '🏷️', 'title',   5, false);

INSERT INTO equipment_slots (slot_key, display_name_en, display_name_th, icon, category, enabled) VALUES
  ('avatar',             'Avatar',              'อวตาร',            '👤', NULL, false),
  ('avatar_border',      'Avatar Border',       'ขอบอวตาร',         '🔲', NULL, false),
  ('badge',              'Badge',               'ตรา',              '🎖️', NULL, false),
  ('aura',               'Aura',                'ออร่า',            '🌟', NULL, false),
  ('name_color',         'Name Color',          'สีชื่อ',           '🎨', NULL, false),
  ('chat_bubble',        'Chat Bubble',         'ฟองแชท',           '💬', NULL, false),
  ('chat_effect',        'Chat Effect',         'เอฟเฟกต์แชท',      '💭', NULL, false),
  ('racket_skin',        'Racket Skin',         'สกินไม้แร็กเกต',   '🏸', NULL, false),
  ('court_effect',       'Court Effect',        'เอฟเฟกต์สนาม',     '🎾', NULL, false),
  ('smash_effect',       'Smash Effect',        'เอฟเฟกต์สแมช',     '💥', NULL, false),
  ('win_animation',      'Win Animation',       'แอนิเมชันชนะ',     '🏆', NULL, false),
  ('profile_background', 'Profile Background',  'พื้นหลังโปรไฟล์',  '🖼️', NULL, false),
  ('profile_music',      'Profile Music',       'เพลงโปรไฟล์',      '🎵', NULL, false),
  ('banner',             'Banner',              'แบนเนอร์',         '🚩', NULL, false),
  ('medal',              'Medal',               'เหรียญ',           '🥇', NULL, false),
  ('event_cosmetic',     'Event Cosmetic',      'ของแต่งอีเวนต์',   '🎉', NULL, false),
  ('tournament_cosmetic','Tournament Cosmetic', 'ของแต่งทัวร์นาเมนต์', '🏆', NULL, false);

ALTER TABLE equipment_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY ref_read ON equipment_slots FOR SELECT USING (true);
CREATE POLICY ref_admin_insert ON equipment_slots FOR INSERT WITH CHECK (is_admin_caller());
CREATE POLICY ref_admin_update ON equipment_slots FOR UPDATE USING (is_admin_caller()) WITH CHECK (is_admin_caller());
CREATE POLICY ref_admin_delete ON equipment_slots FOR DELETE USING (is_admin_caller());
GRANT ALL ON equipment_slots TO anon, authenticated;

-- FK: item_categories.equip_slot must reference a real slot (all 6
-- non-null values already seeded above, so this validates immediately).
ALTER TABLE item_categories ADD CONSTRAINT item_categories_equip_slot_fkey
  FOREIGN KEY (equip_slot) REFERENCES equipment_slots(slot_key);
