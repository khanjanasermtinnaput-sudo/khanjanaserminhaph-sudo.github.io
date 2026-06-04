// ────────────────────────────────────────────────────────────────────────────
// Supabase Edge Function: aof-chat
// AOF Assistance — backend proxy to Google Gemini.
//
// Why this exists:
//   The Gemini API key MUST NOT live in the browser. This function keeps the key
//   server-side (as the GEMINI_API_KEY secret) and is the ONLY thing that talks
//   to Gemini. The static site (GitHub Pages) calls this endpoint instead.
//
// Deploy:
//   supabase secrets set GEMINI_API_KEY=AIza...      # store the key (never in git)
//   supabase functions deploy aof-chat --no-verify-jwt
//
// Endpoint:
//   https://<project-ref>.supabase.co/functions/v1/aof-chat
// ────────────────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

// Models the client is allowed to request. Anything else falls back to default.
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
]);
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

// ── General-purpose assistant ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `คุณคือ "AOF Assistance" — AI ผู้ช่วยอัจฉริยะประจำเว็บไซต์สโมสรแบดมินตัน (Badminton Club)

คุณสามารถช่วยได้ทุกเรื่อง ได้แก่:
- เว็บไซต์สโมสร — ฟีเจอร์และวิธีใช้งาน: ระบบ ELO ranking, leaderboard, การบันทึก/อนุมัติแมตช์, ประวัติการแข่ง, โปรไฟล์ผู้เล่น, ระบบ gacha, tournament, daily challenge
- เทคนิคการเล่นแบดมินตัน และกติกาสากลของ BWF
- การดูแลสุขภาพและการกายภาพของผู้เล่นแบดมินตัน
- คณิตศาสตร์, วิทยาศาสตร์, การเขียนโปรแกรม, ภาษา, ประวัติศาสตร์, ความรู้ทั่วไป และอื่นๆ อีกมากมาย

ข้อกำหนดการตอบ: ตอบเป็นภาษาไทยสุภาพ กระชับ เข้าใจง่าย สำหรับคำแนะนำด้านสุขภาพ/การบาดเจ็บ ให้เสริมเสมอว่าหากอาการรุนแรงหรือเรื้อรังควรพบแพทย์หรือนักกายภาพบำบัดผู้เชี่ยวชาญ`;

// ── CORS: allow the GitHub Pages site + local dev ─────────────────────────────
function allowOrigin(origin: string): string {
  try {
    const host = new URL(origin).hostname;
    if (host.endsWith(".github.io")) return origin;
    if (host === "localhost" || host === "127.0.0.1") return origin;
  } catch (_) { /* no/!valid Origin header */ }
  return ""; // disallowed
}

function corsHeaders(origin: string): HeadersInit {
  const allowed = allowOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed || "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}

// Map Gemini errors to friendly Thai messages.
function mapGeminiError(status: number, detail: string): string {
  if (status === 429) {
    const m = detail.match(/retryDelay"?:\s*"?(\d+)s/);
    const wait = m ? ` ลองใหม่ในอีก ~${m[1]} วินาที` : "";
    return `ใช้งานเกินโควต้าฟรีชั่วคราว.${wait} กรุณารอสักครู่แล้วลองใหม่ หรือเปลี่ยนโมเดลในแท็บ ⚙️ ตั้งค่าครับ`;
  }
  if (status === 404) return "ไม่พบโมเดลนี้ (อาจถูกปิดบริการแล้ว) — ลองเปลี่ยนโมเดลในแท็บ ⚙️ ตั้งค่าครับ";
  if (status === 400) return "คำขอไม่ถูกต้อง หรือ API key ฝั่งเซิร์ฟเวอร์มีปัญหา";
  if (status === 403) return "API key ฝั่งเซิร์ฟเวอร์ไม่มีสิทธิ์ใช้งานโมเดลนี้";
  return `เกิดข้อผิดพลาดจาก AI (HTTP ${status})`;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors = corsHeaders(origin);

  // Preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  if (!GEMINI_API_KEY) {
    return json({ error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า GEMINI_API_KEY" }, 500, cors);
  }

  // Parse body
  let body: { messages?: Array<{ role?: string; content?: string }>; model?: string };
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, 400, cors);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const model = ALLOWED_MODELS.has(body.model ?? "") ? body.model! : DEFAULT_MODEL;

  // Build Gemini contents: system prompt injected as the first user+model turn
  // (Gemini's standard generateContent has no dedicated system field).
  const contents = [
    { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n(เริ่มการสนทนา)" }] },
    { role: "model", parts: [{ text: "เข้าใจแล้วครับ พร้อมช่วยเหลือตามขอบเขตที่กำหนด!" }] },
    // keep only the last 20 turns; cap each message length
    ...messages.slice(-20).map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: String(m.content ?? "").slice(0, 2000) }],
    })),
  ];

  let resp: Response;
  try {
    resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
        }),
      },
    );
  } catch (e) {
    return json({ error: "เชื่อมต่อ Gemini ไม่สำเร็จ: " + String(e) }, 502, cors);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return json({ error: mapGeminiError(resp.status, detail), status: resp.status }, resp.status, cors);
  }

  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const reply = parts.map((p: { text?: string }) => p.text ?? "").join("").trim()
    || "ขออภัยครับ ตอนนี้ยังตอบไม่ได้ ลองใหม่อีกครั้งนะครับ";

  return json({ reply, model }, 200, cors);
});
