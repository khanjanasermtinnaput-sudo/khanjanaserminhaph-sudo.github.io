const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function corsHeaders(reqOrigin) {
  const origin =
    ALLOWED_ORIGIN === '*' ? '*' : reqOrigin === ALLOWED_ORIGIN ? reqOrigin : '';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function fetchGeminiKey() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  const table       = process.env.SUPABASE_TABLE      || 'api_keys';
  const keyColumn   = process.env.SUPABASE_KEY_COLUMN || 'value';
  const keyName     = process.env.SUPABASE_KEY_NAME   || 'gemini';

  const res = await fetch(
    `${supabaseUrl}/rest/v1/${table}?name=eq.${encodeURIComponent(keyName)}&select=${encodeURIComponent(keyColumn)}&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Supabase fetch failed: ${res.status}`);
  }

  const rows = await res.json();
  if (!rows.length) throw new Error('Gemini API key not found in Supabase');
  return rows[0][keyColumn];
}

export default async function handler(req, res) {
  const headers = corsHeaders(req.headers.origin || '');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { messages, modelId, systemPrompt, generationConfig } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: '`messages` array is required' });
      return;
    }

    const apiKey = await fetchGeminiKey();

    // Convert [{role, content}] → Gemini format [{role: 'user'|'model', parts}]
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const requestBody = {
      contents,
      generationConfig: generationConfig || { maxOutputTokens: 1500, temperature: 0.7 },
    };
    if (systemPrompt) {
      requestBody.system_instruction = { parts: [{ text: systemPrompt }] };
    }

    const model    = modelId || 'gemini-2.5-flash-lite-preview-06-17';
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(requestBody),
      }
    );

    if (!upstream.ok) {
      const errBody = await upstream.json().catch(() => ({}));
      res
        .status(upstream.status)
        .json({ error: errBody?.error?.message || `Gemini error ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    const text =
      data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    res.status(200).json({ text });
  } catch (err) {
    console.error('[/api/chat]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
