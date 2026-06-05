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

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not set');

    const model = modelId || 'llama-3.3-70b-versatile';

    const groqMessages = [];
    if (systemPrompt) groqMessages.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => groqMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const cfg = generationConfig || {};
    const body = {
      model,
      messages: groqMessages,
      max_tokens: cfg.maxOutputTokens || 1500,
      temperature: cfg.temperature ?? 0.7,
    };

    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: err?.error?.message || `Groq error ${upstream.status}` }),
        { status: upstream.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await upstream.json();
    const text = data.choices?.[0]?.message?.content || '';

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

export const config = { path: '/api/chat' };
