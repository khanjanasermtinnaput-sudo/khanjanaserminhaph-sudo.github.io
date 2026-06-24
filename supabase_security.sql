-- ============================================================
-- Badminton Club — Server-side security hardening
-- รันใน Supabase → SQL Editor (ครั้งเดียว)
--
-- ไฟล์นี้ "ปลอดภัยต่อการรัน" — แอดมินยังตั้งคะแนน/แก้ผู้เล่นได้ตามปกติ
-- เพราะไม่แตะสิทธิ์การเขียน (UPDATE/INSERT/DELETE) เลย
--
-- สิ่งที่ทำ: ปิดไม่ให้ client อ่าน PIN ของใครได้ แล้วเปลี่ยนการเช็ค PIN
-- ตอน login ไปใช้ฟังก์ชันฝั่งเซิร์ฟเวอร์แทน
-- ============================================================

-- ── 1) ฟังก์ชันตรวจ PIN ฝั่งเซิร์ฟเวอร์ (client มองไม่เห็น PIN เลย) ──
create or replace function public.verify_player_pin(p_id bigint, p_pin text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.players
    where id = p_id and pin = p_pin
  );
$$;

grant execute on function public.verify_player_pin(bigint, text) to anon, authenticated;

-- ── 2) ห้าม client อ่านคอลัมน์ pin โดยตรง ──
-- หลังรัน: การ SELECT * จะใช้กับ pin ไม่ได้ — แต่แอปเลือกคอลัมน์เองอยู่แล้ว
-- (loadPlayers เลือกคอลัมน์ปลอดภัย, การ login ใช้ฟังก์ชัน verify_player_pin,
--  การตั้งคะแนนใช้ return=minimal จึงไม่อ่าน pin กลับ)
revoke select (pin) on public.players from anon;
revoke select (pin) on public.players from authenticated;

-- เสร็จแล้ว ✅  ทดสอบ: ออกจากระบบแล้ว login ใหม่ — ต้องเข้าได้ปกติ
--                และแอดมินกดแก้คะแนนผู้เล่น — ต้องบันทึกได้ปกติ


-- ============================================================
-- (ทางเลือก — ทำทีหลังเมื่อพร้อม) ปิดการ "โกงคะแนน" ฝั่ง client
--
-- ตอนนี้ใครเปิด DevTools ก็ยัง PATCH คะแนน/is_admin ของตัวเองได้ เพราะแอป
-- เขียน DB ตรงด้วย publishable key  วิธีปิดสมบูรณ์คือย้ายการอนุมัติแมตช์ +
-- ให้คะแนนไปเป็นฟังก์ชันเซิร์ฟเวอร์ (RPC) ที่ตรวจสิทธิ์แอดมินเอง แล้วค่อยรัน:
--
--   alter table public.players enable row level security;
--   create policy players_read   on public.players for select using (true);
--   create policy players_insert on public.players for insert with check (true);
--   -- ❌ อย่าเปิด RLS โดยไม่มี policy ของ UPDATE ไม่งั้นแอดมินจะตั้งคะแนนไม่ได้
-- ============================================================
