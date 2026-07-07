-- 492_get_my_tournaments.sql
--
-- Standalone Tournament Self-Serve epic — PR #4b, the manage-UI entry point.
--
-- THE DEPENDENCY (found in the PR #4b build): a returning organiser needs the
-- personal-host venue_id (the Stage-1b management token) to call the venue_*
-- manage wrappers. The PR #4b audit assumed this was "free" via
-- listVenueTournaments(personal_host_venue_id) — but that venue_id was only
-- reachable because the hidden host leaked into get_my_world's admin_roles. The
-- PR #5 role-leak fix (mig 493) removes exactly that leak, so the manage UI would
-- lose its own token. This RPC is the correct replacement: it resolves the
-- organiser's own tournaments directly from tournament_events.created_by_user
-- (the load-bearing column promoted in mig 489 precisely for this — "render 'my
-- tournaments' without joining through the personal-host venue"), and returns each
-- tournament's venue_id as the management token. Ownership is expressed as a
-- first-class queryable attribute, independent of the venue-shell hack.
--
-- AUTH: authenticated-only, derives identity from auth.uid() (never trusts a
-- passed id). Read-only. Returns ONLY tournaments the caller created.

CREATE OR REPLACE FUNCTION public.get_my_tournaments()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY row->>'event_date' DESC NULLS LAST, row->>'created_at' DESC)
    FROM (
      SELECT jsonb_build_object(
        'tournament_id', te.id,
        'slug',          te.slug,
        'name',          te.name,
        'status',        te.status,
        'sport',         te.sport,
        'event_date',    te.event_date,
        'created_at',    te.created_at,
        -- the Stage-1b management token the venue_* wrappers expect
        'venue_id',      te.venue_id,
        'active_teams', (
          SELECT count(*)::int FROM public.competition_teams ct
          JOIN public.competitions c ON c.id = ct.competition_id
          WHERE c.tournament_event_id = te.id AND ct.status = 'active'
        ),
        'pending_teams', (
          SELECT count(*)::int FROM public.competition_teams ct
          JOIN public.competitions c ON c.id = ct.competition_id
          WHERE c.tournament_event_id = te.id AND ct.status = 'pending'
        )
      ) AS row
      FROM public.tournament_events te
      WHERE te.created_by_user = v_uid
    ) rows
  ), '[]'::jsonb);
END;
$function$;

-- Grants: authenticated-only. Strip PUBLIC and the auto-granted anon explicitly.
REVOKE ALL ON FUNCTION public.get_my_tournaments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_tournaments() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_tournaments() TO authenticated;
