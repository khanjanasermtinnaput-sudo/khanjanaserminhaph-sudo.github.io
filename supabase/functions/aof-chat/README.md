# AOF Assistance — Backend Proxy (Supabase Edge Function)

แชตบอท AOF Assistance ยิงคำถามมาที่ฟังก์ชันนี้ ไม่ได้ยิงตรงไป Gemini อีกต่อไป
จุดประสงค์คือ **ซ่อน Gemini API Key ไว้ฝั่งเซิร์ฟเวอร์** ไม่ให้คีย์หลุดที่หน้าบ้าน

## ขอบเขตการตอบ (Hard Constraint)
ตอบได้เฉพาะ 3 หัวข้อ — นอกเหนือจากนี้จะปฏิเสธอย่างสุภาพทันที:
1. เว็บไซต์สโมสร (ELO, leaderboard, แมตช์, gacha, tournament ฯลฯ)
2. เทคนิคการเล่นแบดมินตัน / กติกาสากล BWF
3. การดูแลสุขภาพ–กายภาพของนักแบดมินตัน (บาดเจ็บ, กล้ามเนื้อ, ข้อผิดพลาดทางเทคนิค)

## วิธี Deploy (ทำครั้งเดียว)

ติดตั้ง Supabase CLI: https://supabase.com/docs/guides/cli

```bash
# 1) ล็อกอินและเชื่อมโปรเจกต์
supabase login
supabase link --project-ref tprmqsfbeyqurwqpmpia

# 2) ตั้งค่า Gemini API key เป็น secret (อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เข้า git)
#    ขอ key ฟรีได้ที่ https://aistudio.google.com/apikey
supabase secrets set GEMINI_API_KEY=AIza...your-key...

# 3) Deploy ฟังก์ชัน
supabase functions deploy aof-chat --no-verify-jwt
```

หลัง deploy endpoint จะอยู่ที่:
```
https://tprmqsfbeyqurwqpmpia.supabase.co/functions/v1/aof-chat
```

## เปลี่ยน Key ภายหลัง
```bash
supabase secrets set GEMINI_API_KEY=AIza...new-key...
```
ไม่ต้อง deploy ใหม่ — secret จะถูกใช้ทันทีในการเรียกครั้งถัดไป

## ทดสอบเร็วๆ
```bash
curl -X POST https://tprmqsfbeyqurwqpmpia.supabase.co/functions/v1/aof-chat \
  -H "content-type: application/json" \
  -H "Origin: https://khanjanasermtinnaput-sudo.github.io" \
  -d '{"model":"gemini-2.0-flash-lite","messages":[{"role":"user","content":"ตีโคลียร์ยังไงให้ลึก"}]}'
```
