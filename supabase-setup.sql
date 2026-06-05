-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- 1. Create the api_keys table
create table if not exists api_keys (
  id         bigint generated always as identity primary key,
  name       text   not null unique,
  value      text   not null,
  created_at timestamptz default now()
);

-- 2. Enable Row Level Security so anonymous/authenticated roles cannot read keys
alter table api_keys enable row level security;

-- No RLS policies are added for anon or authenticated roles.
-- The service-role key (used server-side in /api/chat) bypasses RLS entirely.

-- 3. Insert a placeholder row for the Gemini API key
--    Replace 'YOUR_GEMINI_API_KEY_HERE' with your actual key before running,
--    or update it later via the Supabase table editor.
insert into api_keys (name, value)
values ('gemini', 'YOUR_GEMINI_API_KEY_HERE')
on conflict (name) do nothing;
