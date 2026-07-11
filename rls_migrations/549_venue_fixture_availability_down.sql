-- 549 DOWN: restore venue_list_club_fixtures without the `counts` object (pre-549 body).
-- Removing an additive key is backward-safe (clients read counts defensively).

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
             'status', f.status, 'share_code', f.share_code, 'source', f.source, 'notes', f.notes
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
