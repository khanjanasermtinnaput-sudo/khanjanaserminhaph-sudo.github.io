# khanjanaserminhaph-sudo.github.io
Badminton website for my friends

---

# Political AI Expert

A chat application powered by the Gemini API, with the API key secured server-side via Supabase.

```
Browser  →  /api/chat (Vercel serverless)  →  Supabase (fetch key)  →  Gemini API
```

## Project structure

```
├── api/
│   └── chat.js          # Vercel serverless function — proxies Gemini calls
├── public/
│   └── index.html       # Full UI (no API key inside)
├── vercel.json          # Routes /* → /public, /api/* → serverless functions
├── package.json
├── .env.example         # Copy to .env.local for local development
├── supabase-setup.sql   # One-time SQL to create the api_keys table
└── README.md
```

---

## Deploy in 5 steps

### 1. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of `supabase-setup.sql`, replace `YOUR_GEMINI_API_KEY_HERE` with your real Gemini key, then **Run**.
3. Copy these values from **Project Settings → API**:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret → `SUPABASE_SERVICE_KEY`

### 2. Deploy to Vercel

1. Push this repo to GitHub (or fork it).
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Vercel auto-detects the `api/` directory and `public/` static assets — no framework preset needed.

### 3. Add environment variables in Vercel

In **Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://your-project-id.supabase.co` |
| `SUPABASE_SERVICE_KEY` | your service-role key |
| `SUPABASE_TABLE` | `api_keys` |
| `SUPABASE_KEY_COLUMN` | `value` |
| `SUPABASE_KEY_NAME` | `gemini` |
| `ALLOWED_ORIGIN` | your Vercel deployment URL (e.g. `https://political-ai.vercel.app`) |

### 4. Redeploy

Trigger a redeployment from the Vercel dashboard so the new env vars take effect.

### 5. Done

Visit your Vercel URL — the app should be live with no API key exposed in the browser.

---

## Local development

```bash
# Install the Vercel CLI
npm i -g vercel

# Copy the example env file and fill in your values
cp .env.example .env.local

# Start the local dev server (serves /public + /api)
vercel dev
```

---

## Environment variables reference

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key (server-only, bypasses RLS) |
| `SUPABASE_TABLE` | Table name storing API keys (`api_keys`) |
| `SUPABASE_KEY_COLUMN` | Column that holds the key value (`value`) |
| `SUPABASE_KEY_NAME` | Row identifier for the Gemini key (`gemini`) |
| `ALLOWED_ORIGIN` | CORS allowed origin — set to your production domain |

## Security notes

- The Gemini API key never leaves the server — it is fetched at request time from Supabase and used directly in `api/chat.js`.
- The Supabase table has RLS enabled with no public policies; only the service-role key (used server-side) can read it.
- Never commit `.env.local` or expose `SUPABASE_SERVICE_KEY` in client-side code.
