-- 395 — Public opposition-coach matchday link (Pilot demo sprint, item #8 Phase B)
-- A single, no-login, anon-readable read RPC keyed on club_fixtures.share_code.
-- Mirrors the get_tournament_public pattern (mig 321/382): SECURITY DEFINER,
-- granted to anon+authenticated, read-only (no audit — it's a public read).
-- The share_code IS the auth signal (minted per fixture in mig 394).
--
-- Returns the matchday essentials for ONE fixture branded as the home club:
--   our team / opponent / home-away, date + kickoff, pitch, ref, score/status,
--   venue name + address + lat/lng + contact, and the venue's matchday_info
--   ground rules (parking / rules / directions / contact). The consumer
--   MatchdayScreen renders these in the tournament Info/MatchSheet visual.

CREATE OR REPLACE FUNCTION public.get_club_fixture_matchday(p_share_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  SELECT
    f.id, f.opponent_name, f.is_home, f.scheduled_date,
    to_char(f.kickoff_time, 'HH24:MI') AS kickoff_time,
    f.home_score, f.away_score, f.status, f.notes,
    COALESCE(f.club_team_name, ct.name) AS our_team,
    pa.name  AS pitch_name,
    COALESCE(mo.name, f.ref_name) AS referee_name,
    cl.name  AS league_name,
    c.name   AS club_name,
    v.name AS venue_name, v.address AS venue_address, v.city AS venue_city,
    v.postcode AS venue_postcode, v.lat AS venue_lat, v.lng AS venue_lng,
    v.contact_phone AS venue_contact_phone, v.contact_email AS venue_contact_email,
    COALESCE(v.matchday_info, '{}'::jsonb) AS info
  INTO r
  FROM public.club_fixtures f
  JOIN public.club_leagues  cl ON cl.id = f.league_id
  JOIN public.clubs         c  ON c.id  = cl.club_id
  JOIN public.venues        v  ON v.id  = cl.venue_id
  LEFT JOIN public.club_teams      ct ON ct.id = f.club_team_id
  LEFT JOIN public.playing_areas   pa ON pa.id = f.playing_area_id
  LEFT JOIN public.match_officials mo ON mo.id = f.official_id
  WHERE f.share_code = p_share_code;

  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'our_team', r.our_team, 'opponent', r.opponent_name, 'is_home', r.is_home,
    'scheduled_date', r.scheduled_date, 'kickoff_time', r.kickoff_time,
    'pitch_name', r.pitch_name, 'referee_name', r.referee_name,
    'home_score', r.home_score, 'away_score', r.away_score, 'status', r.status,
    'notes', r.notes, 'league_name', r.league_name, 'club_name', r.club_name,
    'venue_name', r.venue_name, 'venue_address', r.venue_address, 'venue_city', r.venue_city,
    'venue_postcode', r.venue_postcode, 'venue_lat', r.venue_lat, 'venue_lng', r.venue_lng,
    'venue_contact_phone', r.venue_contact_phone, 'venue_contact_email', r.venue_contact_email,
    'info', r.info
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_club_fixture_matchday(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_club_fixture_matchday(text) TO anon, authenticated;
