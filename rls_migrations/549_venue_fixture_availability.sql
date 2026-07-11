-- 549: operator/club-admin fixture availability — add aggregate RSVP counts to
-- venue_list_club_fixtures (the reader both the desktop FixturesTab and the club-admin /hub
-- Schedule use).
--
-- Guardians see aggregate counts and coaches see counts+roster on a fixture, but the operator
-- and club-admin saw neither ("availability is managed in the team manager's app"). This adds a
-- `counts` object { in, out, maybe, pending, total } per fixture — AGGREGATE NUMBERS ONLY, NO
-- names — computed from the fixture's TEAM roster (club_team_members) LEFT JOIN the RSVPs, a
-- roster member with no row counting as 'pending'. Identical shape/privacy to the guardian reader
-- (mig 545). Additive: no existing key changed; club_team_id NULL (opponent-only fixture) → all 0.
--
-- Consumers (Hard Rule #14): apps/venue MembershipsView.jsx FixturesTab +
-- apps/inorout ClubAdminSchedule.jsx (club-admin /hub).

CREATE OR REPLACE FUNCTION public.venue_list_club_fixtures(p_venue_token text, p_league_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller record; v_venue text; v_out jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue := v_caller.venue_id;
  IF NOT EXISTS (SELECT 1 FROM public.club_leagues WHERE id = p_league_id AND venue_id = v_venue) THEN RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(jsonb_agg(row ORDER BY sd, kt), '[]'::jsonb) INTO v_out FROM (
    SELECT f.scheduled_date AS sd, f.kickoff_time AS kt,
           jsonb_build_object(
             'fixture_id', f.id, 'league_id', f.league_id, 'club_team_id', f.club_team_id,
             'club_team_name', COALESCE(f.club_team_name, ct.name),
             'opponent_name', f.opponent_name, 'is_home', f.is_home,
             'scheduled_date', f.scheduled_date, 'kickoff_time', to_char(f.kickoff_time, 'HH24:MI'),
             'playing_area_id', f.playing_area_id, 'pitch_name', pa.name,
             'venue_id', v.id, 'venue_name', v.name,
             'venue_address', NULLIF(concat_ws(', ', v.address, v.city, v.postcode), ''),
             'location', f.location,
             'official_id', f.official_id, 'referee_name', COALESCE(mo.name, f.ref_name),
             'home_score', f.home_score, 'away_score', f.away_score,
             'status', f.status, 'share_code', f.share_code, 'source', f.source, 'notes', f.notes,
             'counts', (
               SELECT jsonb_build_object(
                 'in',      count(*) FILTER (WHERE COALESCE(av.status, 'pending') = 'in'),
                 'out',     count(*) FILTER (WHERE COALESCE(av.status, 'pending') = 'out'),
                 'maybe',   count(*) FILTER (WHERE COALESCE(av.status, 'pending') = 'maybe'),
                 'pending', count(*) FILTER (WHERE COALESCE(av.status, 'pending') = 'pending'),
                 'total',   count(*)
               )
               FROM public.club_team_members m
               LEFT JOIN public.club_fixture_availability av
                 ON av.fixture_id = f.id AND av.member_profile_id = m.member_profile_id
               WHERE m.team_id = f.club_team_id AND m.is_active = true
             )
           ) AS row
    FROM public.club_fixtures f
    JOIN public.club_leagues cl ON cl.id = f.league_id
    LEFT JOIN public.club_teams ct ON ct.id = f.club_team_id
    LEFT JOIN public.playing_areas pa ON pa.id = f.playing_area_id
    LEFT JOIN public.venues v ON v.id = COALESCE(pa.venue_id, cl.venue_id)
    LEFT JOIN public.match_officials mo ON mo.id = f.official_id
    WHERE f.league_id = p_league_id
  ) s;
  RETURN jsonb_build_object('ok', true, 'fixtures', v_out);
END;
$function$;
