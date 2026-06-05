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

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { claim } = await request.json();
    if (!claim || typeof claim !== 'string') {
      return new Response(JSON.stringify({ error: '`claim` string is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tavilyKey = process.env.TAVILY_API_KEY;
    const groqKey   = process.env.GROQ_API_KEY;
    if (!tavilyKey) throw new Error('TAVILY_API_KEY is not set');
    if (!groqKey)   throw new Error('GROQ_API_KEY is not set');

    // 1. Search the web
    const searchRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: claim,
        search_depth: 'advanced',
        max_results: 6,
        include_answer: false,
        include_images: false,
      }),
    });

    if (!searchRes.ok) {
      const e = await searchRes.json().catch(() => ({}));
      throw new Error(e?.detail || `Tavily error ${searchRes.status}`);
    }

    const searchData = await searchRes.json();
    const results = (searchData.results || []).slice(0, 6);

    const sourcesContext = results
      .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content?.slice(0, 400) || ''}`)
      .join('\n\n');

    // 2. Analyze with Groq
    const prompt = `You are a professional fact-checker and political analyst.

A user submitted the following claim for fact-checking:
"${claim}"

Here are search results from the web:
${sourcesContext}

Your task:
1. Verdict — choose ONE: ✅ TRUE / ❌ FALSE / ⚠️ MISLEADING / ❓ UNVERIFIED
2. Explanation — 2-4 sentences explaining why, citing the sources by number [1], [2], etc.
3. Key facts — 2-3 bullet points of the most important facts found
4. Sources used — list which source numbers you relied on most

Be direct. Do not introduce yourself. Respond in the same language as the claim (Thai or English).`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.3,
      }),
    });

    if (!groqRes.ok) {
      const e = await groqRes.json().catch(() => ({}));
      throw new Error(e?.error?.message || `Groq error ${groqRes.status}`);
    }

    const groqData = await groqRes.json();
    const analysis = groqData.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ analysis, sources: results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[factcheck]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/api/factcheck' };
