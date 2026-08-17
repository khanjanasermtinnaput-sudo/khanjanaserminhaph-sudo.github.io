-- ─────────────────────────────────────────────────────────────────────────
-- Match duration tracking (Referee Mode)
-- Additive migration: adds nullable timing columns to the existing
-- matches/pending_matches tables. Existing rows get NULL — no backfill,
-- no data loss, safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS duration_seconds integer;

ALTER TABLE public.pending_matches ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.pending_matches ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.pending_matches ADD COLUMN IF NOT EXISTS duration_seconds integer;
