-- Fix: 42501 "permission denied for table players" on anon self-updates
-- (heartbeat, gacha spend, daily reward, cosmetic equip).
--
-- Root cause: the players_update RLS policy's WITH CHECK read `pin` via a
-- correlated subquery to enforce that non-admins can't change protected
-- columns. Postgres evaluates that subquery with the *caller's* column
-- privileges, and anon's SELECT on `pin` was revoked by the lockdown
-- migration (supabase_lockdown.sql) — so every non-admin self-UPDATE threw
-- 42501, even though it never selects pin itself.
--
-- Fix: move protected-column immutability into a BEFORE UPDATE trigger that
-- compares OLD/NEW (no column privileges required), and drop the pin-reading
-- subquery from the policy's WITH CHECK.
--
-- Applied to production (project tprmqsfbeyqurwqpmpia) via Supabase MCP
-- apply_migration as "fix_players_update_pin_perm"; verified live (register
-- -> presence heartbeat PATCH went from 401/42501 to 204) and via role-scoped
-- regression checks (self pts/is_admin escalation still blocked, legit
-- cosmetic/coin self-update still allowed, other players' rows untouched).

CREATE OR REPLACE FUNCTION public.players_block_protected_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF is_admin_caller() THEN
    RETURN NEW;
  END IF;
  IF NEW.id       IS DISTINCT FROM OLD.id
  OR NEW.pin      IS DISTINCT FROM OLD.pin
  OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
  OR NEW.pts      IS DISTINCT FROM OLD.pts
  OR NEW.wins     IS DISTINCT FROM OLD.wins
  OR NEW.losses   IS DISTINCT FROM OLD.losses
  OR NEW.name     IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'players: protected column may only be changed by an admin'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_players_block_protected_update ON public.players;
CREATE TRIGGER trg_players_block_protected_update
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.players_block_protected_update();

DROP POLICY IF EXISTS "players_update" ON public.players;
CREATE POLICY "players_update" ON public.players
  FOR UPDATE
  USING (id = session_uid() OR is_admin_caller())
  WITH CHECK (id = session_uid() OR is_admin_caller());

NOTIFY pgrst, 'reload schema';
