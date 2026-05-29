-- 174_hq_activity.sql
-- League Mode Phase 6 Cycle 6.4 — HQ live activity feed (centre column).
--
-- hq_get_activity — tonight's fixtures across all (scoped) venues with live scores + status,
-- a recent-goals ticker (match_events), the soonest upcoming fixtures when nothing is on
-- tonight, and the per-venue realtime channel keys so apps/hq can subscribe to each
-- `venue_live:<key>` (mig 121 publisher) and refetch on any goal/card/result broadcast.
-- Read-only; role/region scoped exactly like the other hq_* RPCs (mig 171).
--
-- CONSUMERS (hard-rule #14): apps/hq ActivityFeed (centre column).

CREATE OR REPLACE FUNCTION public.hq_get_activity(p_company_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_result jsonb;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH scoped AS (
    SELECT v.id, v.name, v.live_channel_key
    FROM venues v
    WHERE v.company_id = p_company_id
      AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
  ),
  fxv AS (
    SELECT f.id, f.status, f.home_score, f.away_score, f.scheduled_date, f.kickoff_time,
           sv.id AS venue_id, sv.name AS venue_name,
           ht.name AS home, at.name AS away
    FROM fixtures f
    JOIN competitions cp ON cp.id = f.competition_id
    JOIN seasons se ON se.id = cp.season_id
    JOIN leagues l ON l.id = se.league_id
    JOIN scoped sv ON sv.id = l.venue_id
    LEFT JOIN teams ht ON ht.id = f.home_team_id
    LEFT JOIN teams at ON at.id = f.away_team_id
  )
  SELECT jsonb_build_object(
    'live', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'fixture_id', id, 'venue', venue_name, 'home', home, 'away', away,
        'home_score', home_score, 'away_score', away_score, 'status', status,
        'kickoff_time', kickoff_time) ORDER BY kickoff_time, venue_name), '[]'::jsonb)
      FROM fxv WHERE scheduled_date = current_date),
    'upcoming', (
      SELECT COALESCE(jsonb_agg(j ORDER BY j->>'date', j->>'kickoff_time'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'fixture_id', id, 'venue', venue_name, 'home', home, 'away', away,
          'date', scheduled_date, 'kickoff_time', kickoff_time, 'status', status) AS j
        FROM fxv
        WHERE scheduled_date > current_date AND status IN ('scheduled','allocated')
        ORDER BY scheduled_date, kickoff_time LIMIT 10) u),
    'goals', (
      SELECT COALESCE(jsonb_agg(j ORDER BY (j->>'at') DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'player', COALESCE(p.name, me.player_name_override, 'Unknown'),
          'team', t.name, 'venue', fxv.venue_name, 'minute', me.minute,
          'at', me.created_at) AS j
        FROM match_events me
        JOIN fxv ON fxv.id = me.fixture_id
        LEFT JOIN players p ON p.id = me.player_id
        LEFT JOIN teams t ON t.id = me.team_id
        WHERE me.event_type = 'goal'
        ORDER BY me.created_at DESC LIMIT 20) g),
    'channels', (SELECT COALESCE(jsonb_agg(DISTINCT live_channel_key), '[]'::jsonb) FROM scoped WHERE live_channel_key IS NOT NULL)
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.hq_get_activity(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hq_get_activity(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hq_get_activity(text) TO authenticated;
