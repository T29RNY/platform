-- ════════════════════════════════════════════════════════════════════════════
-- 130 — reserve_priority_order column + maintenance trigger
-- ════════════════════════════════════════════════════════════════════════════
-- Background: admin "Move to reserve" drag-to-reorder in AdminView/index.jsx
-- has been visual-only since the feature shipped (no DB column to persist
-- order into). Product decision: persist the order. New reserves append at
-- the back (created_at order). On promotion away from reserve, the player's
-- order clears and remaining reserves compact to close the gap.
--
-- This migration adds the column and an AFTER trigger on players.status that
-- auto-maintains the column for the simple lifecycle transitions:
--   - status becomes 'reserve' (INSERT or UPDATE)     → append at MAX+1
--   - status leaves 'reserve' (UPDATE)                → clear + compact
--
-- The trigger covers every status-change path in the codebase because both
-- set_player_status (player-self) and admin_set_player_status (admin) run
-- `UPDATE players SET status = ...` — verified via pg_proc inspection.
-- No INSERT path creates a player with status='reserve' currently (all start
-- 'none' then transition), so the INSERT branch is defensive-only.
--
-- Backfill: zero existing reserves in prod at write time (verified via
-- SELECT count by status='reserve'), so no backfill SQL needed. The column
-- is nullable and the trigger handles all subsequent transitions.
--
-- Manual ordering is overwritten by the admin_reorder_reserves RPC (mig 131).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.team_players
  ADD COLUMN IF NOT EXISTS reserve_priority_order int NULL;

COMMENT ON COLUMN public.team_players.reserve_priority_order IS
  'When the player is status=reserve, this is their position in the bench queue (0 = first off the bench). NULL when status is not reserve. Maintained by trigger manage_reserve_priority_order_trg and rewritten in bulk by admin_reorder_reserves.';

-- ── Trigger function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manage_reserve_priority_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id text;
  v_max     int;
BEGIN
  -- Find the team for this player. Post-mig-069 each player row has
  -- exactly one team_players row. LIMIT 1 is defensive.
  SELECT team_id INTO v_team_id
  FROM team_players
  WHERE player_id = NEW.id
  LIMIT 1;

  IF v_team_id IS NULL THEN
    -- Player not yet on any team (race between players INSERT and
    -- team_players INSERT in admin_add_player / player_join_team).
    -- Skip; the column stays NULL until the player's status is set
    -- to 'reserve' AFTER team_players is populated.
    RETURN NEW;
  END IF;

  -- Case 1: player just became a reserve. Append at MAX+1.
  IF NEW.status = 'reserve' AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'reserve'
     ) THEN
    SELECT COALESCE(MAX(tp2.reserve_priority_order), -1) + 1 INTO v_max
    FROM team_players tp2
    JOIN players p2 ON p2.id = tp2.player_id
    WHERE tp2.team_id = v_team_id
      AND p2.status = 'reserve'
      AND p2.id <> NEW.id;
    UPDATE team_players
       SET reserve_priority_order = v_max
     WHERE team_id = v_team_id AND player_id = NEW.id;
  END IF;

  -- Case 2: player just stopped being a reserve. Clear their order and
  -- compact remaining reserves so there are no gaps.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'reserve'
     AND NEW.status IS DISTINCT FROM 'reserve' THEN
    UPDATE team_players
       SET reserve_priority_order = NULL
     WHERE team_id = v_team_id AND player_id = NEW.id;

    WITH ranked AS (
      SELECT tp3.player_id,
             ROW_NUMBER() OVER (
               ORDER BY tp3.reserve_priority_order NULLS LAST, tp3.created_at
             ) - 1 AS new_order
      FROM team_players tp3
      JOIN players p3 ON p3.id = tp3.player_id
      WHERE tp3.team_id = v_team_id AND p3.status = 'reserve'
    )
    UPDATE team_players tp4
       SET reserve_priority_order = r.new_order
      FROM ranked r
     WHERE tp4.team_id = v_team_id AND tp4.player_id = r.player_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger declaration ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS manage_reserve_priority_order_trg ON public.players;

CREATE TRIGGER manage_reserve_priority_order_trg
  AFTER INSERT OR UPDATE OF status ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_reserve_priority_order();
