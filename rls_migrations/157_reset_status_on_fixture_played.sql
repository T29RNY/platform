-- 157_reset_status_on_fixture_played.sql
--
-- League Mode Phase 5 — Cycle 5.5. "Start fresh each game" for competitive
-- availability.
--
-- Cycle 5.5 reuses the casual IN/OUT board for competitive availability: a
-- competitive team's player marks in/out for their next league fixture using the
-- existing board (writes players.status via set_player_status). The board shows
-- the next upcoming fixture and auto-rolls forward as completed fixtures leave
-- the "upcoming" set.
--
-- To make each fixture start with a clean slate, this trigger resets BOTH teams'
-- players to status='none' the moment a fixture is played (scheduled → a terminal
-- state). A trigger is the single robust hook that captures every completion path
-- (ref ref_confirm_full_time mig 120, venue venue_update_fixture_result mig 127,
-- walkover/forfeit) without editing those shipped RPCs.
--
-- notify_team_change(..., 'schedule_updated') is fired for each team so open apps
-- refetch and reflect the cleared board ('schedule_updated' is already whitelisted
-- in notify_team_change, mig 151).
--
-- EDGE (documented, not solved here): players.status is global per player. A
-- player who is BOTH casual and competitive would have their casual availability
-- reset when their league game completes. Phase 5 testbed teams are
-- competitive-only; the casual→competitive cutover for existing teams is already
-- an operator task in the Phase 5 plan. Revisit if a real dual-context team lands.

CREATE OR REPLACE FUNCTION public.reset_team_status_on_fixture_played()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status = 'scheduled'
     AND NEW.status IN ('completed','walkover','forfeit','void') THEN
    UPDATE players SET status = 'none'
    WHERE id IN (
      SELECT tp.player_id FROM team_players tp
      WHERE tp.team_id = NEW.home_team_id
         OR (NEW.away_team_id IS NOT NULL AND tp.team_id = NEW.away_team_id)
    );
    PERFORM public.notify_team_change(NEW.home_team_id, 'schedule_updated');
    IF NEW.away_team_id IS NOT NULL THEN
      PERFORM public.notify_team_change(NEW.away_team_id, 'schedule_updated');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reset_status_on_fixture_played ON public.fixtures;
CREATE TRIGGER trg_reset_status_on_fixture_played
  AFTER UPDATE ON public.fixtures
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_team_status_on_fixture_played();
