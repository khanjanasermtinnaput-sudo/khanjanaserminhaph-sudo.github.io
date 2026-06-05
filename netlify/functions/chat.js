const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

export default async (request) => {
  const origin = request.headers.get('origin') || '';
  const corsOrigin =
    ALLOWED_ORIGIN === '*' ? '*' : origin === ALLOWED_ORIGIN ? origin : '';

  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { messages, modelId, systemPrompt, generationConfig } =
      await request.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: '`messages` array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: generationConfig || { maxOutputTokens: 1500, temperature: 0.7 },
    };
    if (systemPrompt) {
      body.system_instruction = { parts: [{ text: systemPrompt }] };
    }

    const model = modelId || 'gemini-2.5-flash-lite-preview-06-17';
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: err?.error?.message || `Gemini error ${upstream.status}` }),
        { status: upstream.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await upstream.json();
    const text =
      data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[chat]', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

// Map this function to /api/chat so the HTML needs no changes
export const config = { path: '/api/chat' };
