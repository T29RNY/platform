-- Migration 266 — Ref V2: surface per-fixture clock pause + added time on the reception display.
-- Cycle "RefSix-killer" / apps/ref/REF_V2_BUILD_PLAN.md, §5 (display-side).
--
-- The ref RPCs already broadcast venue_live (mig 121/187), so the display already refetches on
-- every event. This adds the DATA the screen needs to (a) freeze a paused match's clock and
-- (b) render "45 +N" stoppage. Surgical: three fields added to the live_fx fixture object
-- (clock_paused_at, clock_paused_ms, added_time). Everything else is the mig-247 body verbatim.
-- ADDITIVE — apps/display reads them when present, ignores them otherwise.

CREATE OR REPLACE FUNCTION public.get_display_state(p_display_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue  public.venues%ROWTYPE;
  v_today  date := (now() AT TIME ZONE 'Europe/London')::date;
  v_result jsonb;
BEGIN
  IF p_display_token IS NULL OR length(trim(p_display_token)) = 0 THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_venue FROM public.venues WHERE display_token = p_display_token LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;

  WITH
  venue_comps AS (
    SELECT c.id AS competition_id, c.name AS competition_name, c.type AS competition_type,
           c.format AS competition_format,
           s.id AS season_id, s.name AS season_name, s.start_date AS season_start, s.end_date AS season_end,
           l.id AS league_id, l.name AS league_name, l.standings_visibility
    FROM public.competitions c
    JOIN public.seasons s ON s.id = c.season_id
    JOIN public.leagues l ON l.id = s.league_id
    WHERE l.venue_id = v_venue.id AND c.status = 'active'
  ),
  comp_teams_all AS (
    SELECT ct.competition_id, ct.team_id, ct.status AS ct_status,
           t.name AS team_name, t.primary_colour, t.secondary_colour
    FROM public.competition_teams ct
    JOIN public.teams t ON t.id = ct.team_id
    JOIN venue_comps vc ON vc.competition_id = ct.competition_id
    WHERE ct.status IN ('active','withdrawn','expelled')
  ),
  live_scores AS (
    SELECT f.id AS fixture_id,
           SUM(CASE WHEN me.event_type='goal'     AND me.team_id=f.home_team_id THEN 1
                    WHEN me.event_type='own_goal' AND me.team_id=f.away_team_id THEN 1 ELSE 0 END)::int AS home_live,
           SUM(CASE WHEN me.event_type='goal'     AND me.team_id=f.away_team_id THEN 1
                    WHEN me.event_type='own_goal' AND me.team_id=f.home_team_id THEN 1 ELSE 0 END)::int AS away_live
    FROM public.fixtures f
    JOIN venue_comps vc ON vc.competition_id = f.competition_id
    LEFT JOIN public.match_events me ON me.fixture_id = f.id AND me.event_type IN ('goal','own_goal')
    GROUP BY f.id, f.home_team_id, f.away_team_id
  ),
  fixture_scored AS (
    SELECT f.competition_id, f.home_team_id, f.away_team_id,
      CASE WHEN f.status IN ('completed','walkover','forfeit') THEN COALESCE(f.home_score, CASE
             WHEN f.status='walkover' AND f.walkover_winner_id=f.home_team_id THEN 3
             WHEN f.status='walkover' AND f.walkover_winner_id=f.away_team_id THEN 0
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.home_team_id THEN 3
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.away_team_id THEN 0 ELSE NULL END) END AS c_hs,
      CASE WHEN f.status IN ('completed','walkover','forfeit') THEN COALESCE(f.away_score, CASE
             WHEN f.status='walkover' AND f.walkover_winner_id=f.away_team_id THEN 3
             WHEN f.status='walkover' AND f.walkover_winner_id=f.home_team_id THEN 0
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.away_team_id THEN 3
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.home_team_id THEN 0 ELSE NULL END) END AS c_as,
      CASE WHEN f.status IN ('completed','walkover','forfeit') THEN COALESCE(f.home_score, CASE
             WHEN f.status='walkover' AND f.walkover_winner_id=f.home_team_id THEN 3
             WHEN f.status='walkover' AND f.walkover_winner_id=f.away_team_id THEN 0
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.home_team_id THEN 3
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.away_team_id THEN 0 ELSE NULL END)
           WHEN f.status='in_progress' THEN COALESCE(f.home_score, ls.home_live, 0) END AS l_hs,
      CASE WHEN f.status IN ('completed','walkover','forfeit') THEN COALESCE(f.away_score, CASE
             WHEN f.status='walkover' AND f.walkover_winner_id=f.away_team_id THEN 3
             WHEN f.status='walkover' AND f.walkover_winner_id=f.home_team_id THEN 0
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.away_team_id THEN 3
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.home_team_id THEN 0 ELSE NULL END)
           WHEN f.status='in_progress' THEN COALESCE(f.away_score, ls.away_live, 0) END AS l_as
    FROM public.fixtures f
    JOIN venue_comps vc ON vc.competition_id = f.competition_id
    LEFT JOIN live_scores ls ON ls.fixture_id = f.id
  ),
  completed_fx AS (
    SELECT f.id, f.competition_id, f.home_team_id, f.away_team_id,
           f.actual_kickoff_at, f.scheduled_date,
           COALESCE(f.home_score, CASE
             WHEN f.status='walkover' AND f.walkover_winner_id=f.home_team_id THEN 3
             WHEN f.status='walkover' AND f.walkover_winner_id=f.away_team_id THEN 0
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.home_team_id THEN 3
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.away_team_id THEN 0 ELSE NULL END) AS hs,
           COALESCE(f.away_score, CASE
             WHEN f.status='walkover' AND f.walkover_winner_id=f.away_team_id THEN 3
             WHEN f.status='walkover' AND f.walkover_winner_id=f.home_team_id THEN 0
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.away_team_id THEN 3
             WHEN f.status='forfeit'  AND f.forfeit_winner_id =f.home_team_id THEN 0 ELSE NULL END) AS as_
    FROM public.fixtures f
    JOIN venue_comps vc ON vc.competition_id = f.competition_id
    WHERE f.status IN ('completed','walkover','forfeit')
  ),
  team_results AS (
    SELECT competition_id, home_team_id AS team_id,
           CASE WHEN hs>as_ THEN 'W' WHEN hs=as_ THEN 'D' ELSE 'L' END AS res,
           actual_kickoff_at, scheduled_date, id
    FROM completed_fx WHERE hs IS NOT NULL AND as_ IS NOT NULL
    UNION ALL
    SELECT competition_id, away_team_id,
           CASE WHEN as_>hs THEN 'W' WHEN as_=hs THEN 'D' ELSE 'L' END,
           actual_kickoff_at, scheduled_date, id
    FROM completed_fx WHERE hs IS NOT NULL AND as_ IS NOT NULL AND away_team_id IS NOT NULL
  ),
  team_form AS (
    SELECT competition_id, team_id, jsonb_agg(res ORDER BY rn) AS form
    FROM (
      SELECT competition_id, team_id, res,
             ROW_NUMBER() OVER (PARTITION BY competition_id, team_id
               ORDER BY actual_kickoff_at DESC NULLS LAST, scheduled_date DESC NULLS LAST, id DESC) AS rn
      FROM team_results
    ) r WHERE rn <= 5
    GROUP BY competition_id, team_id
  ),
  rows_confirmed AS (
    SELECT competition_id, home_team_id AS team_id,
           CASE WHEN c_hs>c_as THEN 1 ELSE 0 END AS w, CASE WHEN c_hs=c_as THEN 1 ELSE 0 END AS d,
           CASE WHEN c_hs<c_as THEN 1 ELSE 0 END AS l, c_hs AS gf, c_as AS ga
    FROM fixture_scored WHERE c_hs IS NOT NULL AND c_as IS NOT NULL
    UNION ALL
    SELECT competition_id, away_team_id AS team_id,
           CASE WHEN c_as>c_hs THEN 1 ELSE 0 END, CASE WHEN c_as=c_hs THEN 1 ELSE 0 END,
           CASE WHEN c_as<c_hs THEN 1 ELSE 0 END, c_as, c_hs
    FROM fixture_scored WHERE c_hs IS NOT NULL AND c_as IS NOT NULL AND away_team_id IS NOT NULL
  ),
  rows_live AS (
    SELECT competition_id, home_team_id AS team_id,
           CASE WHEN l_hs>l_as THEN 1 ELSE 0 END AS w, CASE WHEN l_hs=l_as THEN 1 ELSE 0 END AS d,
           CASE WHEN l_hs<l_as THEN 1 ELSE 0 END AS l, l_hs AS gf, l_as AS ga
    FROM fixture_scored WHERE l_hs IS NOT NULL AND l_as IS NOT NULL
    UNION ALL
    SELECT competition_id, away_team_id AS team_id,
           CASE WHEN l_as>l_hs THEN 1 ELSE 0 END, CASE WHEN l_as=l_hs THEN 1 ELSE 0 END,
           CASE WHEN l_as<l_hs THEN 1 ELSE 0 END, l_as, l_hs
    FROM fixture_scored WHERE l_hs IS NOT NULL AND l_as IS NOT NULL AND away_team_id IS NOT NULL
  ),
  agg_confirmed AS (
    SELECT competition_id, team_id, SUM(w+d+l)::int AS played, SUM(w)::int AS w, SUM(d)::int AS d,
           SUM(l)::int AS l, SUM(gf)::int AS gf, SUM(ga)::int AS ga, (SUM(gf)-SUM(ga))::int AS gd,
           (SUM(w)*3+SUM(d))::int AS pts
    FROM rows_confirmed GROUP BY competition_id, team_id
  ),
  agg_live AS (
    SELECT competition_id, team_id, SUM(w+d+l)::int AS played, SUM(w)::int AS w, SUM(d)::int AS d,
           SUM(l)::int AS l, SUM(gf)::int AS gf, SUM(ga)::int AS ga, (SUM(gf)-SUM(ga))::int AS gd,
           (SUM(w)*3+SUM(d))::int AS pts
    FROM rows_live GROUP BY competition_id, team_id
  ),
  standings_confirmed AS (
    SELECT cta.competition_id, jsonb_agg(jsonb_build_object(
             'team_id',cta.team_id,'team_name',cta.team_name,'ct_status',cta.ct_status,
             'primary_colour',cta.primary_colour,'secondary_colour',cta.secondary_colour,
             'played',COALESCE(a.played,0),'w',COALESCE(a.w,0),'d',COALESCE(a.d,0),'l',COALESCE(a.l,0),
             'gf',COALESCE(a.gf,0),'ga',COALESCE(a.ga,0),'gd',COALESCE(a.gd,0),'pts',COALESCE(a.pts,0),
             'form',COALESCE(tf.form,'[]'::jsonb)
           ) ORDER BY COALESCE(a.pts,0) DESC, COALESCE(a.gd,0) DESC, COALESCE(a.gf,0) DESC, cta.team_name) AS arr
    FROM comp_teams_all cta
    LEFT JOIN agg_confirmed a ON a.competition_id=cta.competition_id AND a.team_id=cta.team_id
    LEFT JOIN team_form tf     ON tf.competition_id=cta.competition_id AND tf.team_id=cta.team_id
    GROUP BY cta.competition_id
  ),
  standings_live AS (
    SELECT cta.competition_id, jsonb_agg(jsonb_build_object(
             'team_id',cta.team_id,'team_name',cta.team_name,'ct_status',cta.ct_status,
             'primary_colour',cta.primary_colour,'secondary_colour',cta.secondary_colour,
             'played',COALESCE(a.played,0),'w',COALESCE(a.w,0),'d',COALESCE(a.d,0),'l',COALESCE(a.l,0),
             'gf',COALESCE(a.gf,0),'ga',COALESCE(a.ga,0),'gd',COALESCE(a.gd,0),'pts',COALESCE(a.pts,0),
             'form',COALESCE(tf.form,'[]'::jsonb)
           ) ORDER BY COALESCE(a.pts,0) DESC, COALESCE(a.gd,0) DESC, COALESCE(a.gf,0) DESC, cta.team_name) AS arr
    FROM comp_teams_all cta
    LEFT JOIN agg_live a   ON a.competition_id=cta.competition_id AND a.team_id=cta.team_id
    LEFT JOIN team_form tf ON tf.competition_id=cta.competition_id AND tf.team_id=cta.team_id
    GROUP BY cta.competition_id
  ),
  scorers AS (
    SELECT f.competition_id, me.player_id, p.name AS player_name, p.shirt_number, me.team_id,
           t.name AS team_name, t.primary_colour, COUNT(*) AS goals
    FROM public.match_events me
    JOIN public.fixtures f ON f.id = me.fixture_id
    JOIN venue_comps vc ON vc.competition_id = f.competition_id
    JOIN public.players p ON p.id = me.player_id
    LEFT JOIN public.teams t ON t.id = me.team_id
    WHERE me.event_type='goal' AND me.player_id IS NOT NULL
    GROUP BY f.competition_id, me.player_id, p.name, p.shirt_number, me.team_id, t.name, t.primary_colour
  ),
  player_apps AS (
    SELECT f.competition_id, ids.pid AS player_id, COUNT(DISTINCT f.id)::int AS apps
    FROM public.fixture_lineups fl
    JOIN public.fixtures f ON f.id = fl.fixture_id
    JOIN venue_comps vc ON vc.competition_id = f.competition_id
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(fl.starting) AS pid
      UNION ALL
      SELECT jsonb_array_elements_text(fl.bench)
    ) ids
    WHERE f.status IN ('completed','walkover','forfeit')
    GROUP BY f.competition_id, ids.pid
  ),
  top_scorers AS (
    SELECT competition_id, jsonb_agg(obj ORDER BY goals DESC, player_name) FILTER (WHERE rn<=15) AS arr
    FROM (
      SELECT s.competition_id, s.player_name, s.goals,
             jsonb_build_object('player_id',s.player_id,'name',s.player_name,'team_id',s.team_id,
                                'team_name',s.team_name,'primary_colour',s.primary_colour,'goals',s.goals,
                                'apps',COALESCE(pa.apps,0),'shirt_number',s.shirt_number) AS obj,
             ROW_NUMBER() OVER (PARTITION BY s.competition_id ORDER BY s.goals DESC, s.player_name) AS rn
      FROM scorers s
      LEFT JOIN player_apps pa ON pa.competition_id=s.competition_id AND pa.player_id=s.player_id
    ) r GROUP BY competition_id
  ),
  competitions_json AS (
    SELECT jsonb_agg(jsonb_build_object(
             'competition_id',vc.competition_id,'name',vc.competition_name,'type',vc.competition_type,
             'format',vc.competition_format,'league_id',vc.league_id,'league_name',vc.league_name,
             'standings_visibility',vc.standings_visibility,
             'season',jsonb_build_object('name',vc.season_name,'start_date',vc.season_start,'end_date',vc.season_end),
             'standings_confirmed', CASE WHEN vc.standings_visibility='public' THEN COALESCE(sc.arr,'[]'::jsonb) ELSE '[]'::jsonb END,
             'standings_live',      CASE WHEN vc.standings_visibility='public' THEN COALESCE(sl.arr,'[]'::jsonb) ELSE '[]'::jsonb END,
             'top_scorers', COALESCE(ts.arr,'[]'::jsonb)
           ) ORDER BY vc.league_name, vc.competition_name) AS arr
    FROM venue_comps vc
    LEFT JOIN standings_confirmed sc ON sc.competition_id=vc.competition_id
    LEFT JOIN standings_live      sl ON sl.competition_id=vc.competition_id
    LEFT JOIN top_scorers         ts ON ts.competition_id=vc.competition_id
  ),
  live_fx AS (
    SELECT jsonb_agg(jsonb_build_object(
             'fixture_id',f.id,'competition_id',f.competition_id,'competition_name',vc.competition_name,
             'competition_type',vc.competition_type,
             'home_team_id',f.home_team_id,'home_team_name',ht.name,
             'home_primary_colour',ht.primary_colour,'home_secondary_colour',ht.secondary_colour,
             'away_team_id',f.away_team_id,'away_team_name',at.name,
             'away_primary_colour',at.primary_colour,'away_secondary_colour',at.secondary_colour,
             'home_score',COALESCE(f.home_score, ls.home_live, 0),
             'away_score',COALESCE(f.away_score, ls.away_live, 0),
             'pitch_name',pa.name,'actual_kickoff_at',f.actual_kickoff_at,
             'clock_paused_at',f.clock_paused_at,'clock_paused_ms',f.clock_paused_ms,'added_time',f.added_time,
             'round_name',f.round_name,'official_id',f.official_id,'official_name',lmo.name,
             'recent_events',COALESCE(re.events,'[]'::jsonb)
           ) ORDER BY f.actual_kickoff_at NULLS LAST, f.id) AS arr
    FROM public.fixtures f
    JOIN venue_comps vc ON vc.competition_id=f.competition_id
    LEFT JOIN public.teams ht ON ht.id=f.home_team_id
    LEFT JOIN public.teams at ON at.id=f.away_team_id
    LEFT JOIN public.playing_areas pa ON pa.id=f.playing_area_id
    LEFT JOIN live_scores ls ON ls.fixture_id=f.id
    LEFT JOIN public.match_officials lmo ON lmo.id=f.official_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(ev ORDER BY ord DESC) AS events FROM (
        SELECT jsonb_build_object('type',me.event_type,'minute',me.minute,'period',me.period,
                 'player_name',pl.name,'team_id',me.team_id) AS ev, me.created_at AS ord
        FROM public.match_events me
        LEFT JOIN public.players pl ON pl.id=me.player_id
        WHERE me.fixture_id=f.id AND me.event_type IN ('goal','own_goal','yellow_card','red_card')
        ORDER BY me.created_at DESC LIMIT 6
      ) e
    ) re ON true
    WHERE f.status='in_progress'
  ),
  upcoming AS (
    SELECT jsonb_agg(jsonb_build_object(
             'fixture_id',f.id,'competition_name',vc.competition_name,
             'competition_type',vc.competition_type,'round_name',f.round_name,
             'official_id',f.official_id,'official_name',mo.name,
             'home_team_name',ht.name,'home_primary_colour',ht.primary_colour,
             'away_team_name',at.name,'away_primary_colour',at.primary_colour,
             'kickoff_time',f.kickoff_time,'pitch_name',pa.name
           ) ORDER BY f.kickoff_time NULLS LAST, f.id) AS arr
    FROM public.fixtures f
    JOIN venue_comps vc ON vc.competition_id=f.competition_id
    LEFT JOIN public.teams ht ON ht.id=f.home_team_id
    LEFT JOIN public.teams at ON at.id=f.away_team_id
    LEFT JOIN public.playing_areas pa ON pa.id=f.playing_area_id
    LEFT JOIN public.match_officials mo ON mo.id=f.official_id
    WHERE f.status IN ('scheduled','allocated') AND f.scheduled_date=v_today AND f.actual_kickoff_at IS NULL
  ),
  bookings AS (
    SELECT jsonb_agg(jsonb_build_object(
             'booking_id',pb.id,
             'kickoff_time',pb.kickoff_time,
             'pitch_name',bpa.name,
             'booked_name',COALESCE(bt.name, pb.booked_by_name),
             'source_kind','booking'
           ) ORDER BY pb.kickoff_time, pb.id) AS arr
    FROM public.pitch_bookings pb
    JOIN public.playing_areas bpa ON bpa.id = pb.playing_area_id
    LEFT JOIN public.teams bt ON bt.id = pb.team_id
    WHERE pb.venue_id = v_venue.id
      AND pb.booking_date = v_today
      AND pb.status = 'confirmed'
      AND pb.superseded_at IS NULL
      AND EXISTS (SELECT 1 FROM public.pitch_occupancy po
                  WHERE po.source_kind='booking' AND po.source_id=pb.id::text AND po.active)
  ),
  recent AS (
    SELECT jsonb_agg(jsonb_build_object(
             'fixture_id',f.id,'competition_name',vc.competition_name,
             'home_team_name',ht.name,'home_primary_colour',ht.primary_colour,
             'away_team_name',at.name,'away_primary_colour',at.primary_colour,
             'home_score',COALESCE(f.home_score, ls.home_live, 0),
             'away_score',COALESCE(f.away_score, ls.away_live, 0),
             'status',f.status,'top_scorer_name',fts.top_scorer_name
           ) ORDER BY f.actual_kickoff_at DESC NULLS LAST, f.id DESC) AS arr
    FROM public.fixtures f
    JOIN venue_comps vc ON vc.competition_id=f.competition_id
    LEFT JOIN public.teams ht ON ht.id=f.home_team_id
    LEFT JOIN public.teams at ON at.id=f.away_team_id
    LEFT JOIN live_scores ls ON ls.fixture_id=f.id
    LEFT JOIN LATERAL (
      SELECT pl.name AS top_scorer_name FROM public.match_events me
      JOIN public.players pl ON pl.id=me.player_id
      WHERE me.fixture_id=f.id AND me.event_type='goal'
      GROUP BY pl.id, pl.name ORDER BY COUNT(*) DESC, pl.name LIMIT 1
    ) fts ON true
    WHERE f.status IN ('completed','walkover','forfeit') AND f.scheduled_date=v_today
  ),
  ticker AS (
    SELECT jsonb_agg(obj ORDER BY ord DESC) FILTER (WHERE rn<=30) AS arr
    FROM (
      SELECT jsonb_build_object('player_name',pl.name,'team_name',t.name,'primary_colour',t.primary_colour,
               'minute',me.minute,'competition_name',vc.competition_name) AS obj,
             me.created_at AS ord, ROW_NUMBER() OVER (ORDER BY me.created_at DESC) AS rn
      FROM public.match_events me
      JOIN public.fixtures f ON f.id=me.fixture_id
      JOIN venue_comps vc ON vc.competition_id=f.competition_id
      LEFT JOIN public.players pl ON pl.id=me.player_id
      LEFT JOIN public.teams t ON t.id=me.team_id
      WHERE me.event_type='goal' AND f.scheduled_date=v_today
    ) g
  )
  SELECT jsonb_build_object(
    'venue', jsonb_build_object(
      'id',v_venue.id,'name',v_venue.name,'logo_url',v_venue.logo_url,
      'primary_colour',v_venue.primary_colour,'secondary_colour',v_venue.secondary_colour,
      'live_channel_key',v_venue.live_channel_key,
      'display_config',COALESCE(v_venue.display_config,'null'::jsonb)
    ),
    'server_time',       now(),
    'competitions',      COALESCE((SELECT arr FROM competitions_json),'[]'::jsonb),
    'live_fixtures',     COALESCE((SELECT arr FROM live_fx),'[]'::jsonb),
    'upcoming_fixtures', COALESCE((SELECT arr FROM upcoming),'[]'::jsonb),
    'bookings',          COALESCE((SELECT arr FROM bookings),'[]'::jsonb),
    'recent_results',    COALESCE((SELECT arr FROM recent),'[]'::jsonb),
    'goals_ticker',      COALESCE((SELECT arr FROM ticker),'[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
