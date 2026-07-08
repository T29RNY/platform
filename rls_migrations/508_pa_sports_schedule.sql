-- =============================================================================
-- Migration 508: PA Sports demo — training series + sessions + leagues + fixtures
-- =============================================================================
-- Depends on 505/506 (venues, pitches, teams).
--   • 3 recurring training series (Wed U7s @ Seva 4G staggered, Thu Mens @ Seva)
--   • Next 2 concrete training sessions per team (for in/out RSVPs)
--   • 2 leagues: Mens FA Sunday league + U7 youth league
--   • Fixtures: Mens (2 played w/ scores + 2 upcoming), U7 Dortmund & Milan (upcoming)
-- Dates computed relative to current_date so the demo always looks "live".
-- Pitch assignment kept clash-free: training staggered on the 4G; Mens home
-- fixtures on PA Peugeot Pitch 1; youth/away fixtures leave the pitch unset.
-- Deterministic ids: a5d0=series, a5d1=sessions, a5b0=leagues, a5b1=fixtures
-- Paired teardown: 508_pa_sports_schedule_down.sql
-- =============================================================================

DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM club_teams WHERE club_id='club_pa_sports') THEN
    RAISE EXCEPTION 'PA Sports teams not found — apply mig 506 first';
  END IF;
END $guard$;

-- ─── 1. Recurring training series (0=Sun … 3=Wed, 4=Thu) ─────────────────────
INSERT INTO club_session_series (id, club_id, cohort_id, team_id, title, session_type, day_of_week, start_time, from_date, to_date, venue_id, playing_area_id)
VALUES
  ('a5d00000-0000-4000-8000-000000000001', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000001',
   'U7 Dortmund Training', 'training', 3, '17:00', current_date, current_date + 365, 'seva_school', 'a5a00000-0000-4000-8000-000000000004'),
  ('a5d00000-0000-4000-8000-000000000002', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000002',
   'U7 Milan Training', 'training', 3, '18:00', current_date, current_date + 365, 'seva_school', 'a5a00000-0000-4000-8000-000000000004'),
  ('a5d00000-0000-4000-8000-000000000003', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000003',
   'PA Sports Mens Training', 'training', 4, '20:00', current_date, current_date + 365, 'seva_school', 'a5a00000-0000-4000-8000-000000000004')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Concrete upcoming training sessions + leagues + fixtures ──────────────
DO $sched$
DECLARE
  next_wed date := current_date + ((3 - extract(dow from current_date)::int + 7) % 7);
  next_thu date := current_date + ((4 - extract(dow from current_date)::int + 7) % 7);
  next_sun date := current_date + ((0 - extract(dow from current_date)::int + 7) % 7);
  w int;
BEGIN
  -- Two weeks of concrete training sessions per team (for RSVP / in-out)
  FOR w IN 0..1 LOOP
    INSERT INTO club_sessions (id, club_id, cohort_id, team_id, title, session_type, scheduled_at, status, series_id, venue_id, playing_area_id)
    VALUES
      (('a5d10000-0000-4000-8000-0000000000' || lpad((10+w)::text,2,'0'))::uuid, 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000001',
       'U7 Dortmund Training', 'training', ((next_wed + w*7) + time '17:00')::timestamptz, 'scheduled', 'a5d00000-0000-4000-8000-000000000001', 'seva_school', 'a5a00000-0000-4000-8000-000000000004'),
      (('a5d10000-0000-4000-8000-0000000000' || lpad((20+w)::text,2,'0'))::uuid, 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000002',
       'U7 Milan Training', 'training', ((next_wed + w*7) + time '18:00')::timestamptz, 'scheduled', 'a5d00000-0000-4000-8000-000000000002', 'seva_school', 'a5a00000-0000-4000-8000-000000000004'),
      (('a5d10000-0000-4000-8000-0000000000' || lpad((30+w)::text,2,'0'))::uuid, 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000003',
       'PA Sports Mens Training', 'training', ((next_thu + w*7) + time '20:00')::timestamptz, 'scheduled', 'a5d00000-0000-4000-8000-000000000003', 'seva_school', 'a5a00000-0000-4000-8000-000000000004')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- Leagues
  INSERT INTO club_leagues (id, club_id, venue_id, name, season_label)
  VALUES
    ('a5b00000-0000-4000-8000-000000000001', 'club_pa_sports', 'pa_peugeot', 'Coventry & District Sunday League — Division Two', '2025/26'),
    ('a5b00000-0000-4000-8000-000000000002', 'club_pa_sports', 'pa_peugeot', 'Coventry Youth Mini-Soccer — U7', '2025/26')
  ON CONFLICT (id) DO NOTHING;

  -- Mens fixtures: 2 played (with scores) + 2 upcoming. Home games on Pitch 1.
  INSERT INTO club_fixtures (id, league_id, club_team_id, club_team_name, opponent_name, is_home, scheduled_date, kickoff_time, playing_area_id, home_score, away_score, status)
  VALUES
    ('a5b10000-0000-4000-8000-000000000001', 'a5b00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000003', 'PA Sports Mens', 'Coventry Sphinx',   true,  next_sun - 14, '11:00', 'a5a00000-0000-4000-8000-000000000001', 3, 1, 'completed'),
    ('a5b10000-0000-4000-8000-000000000002', 'a5b00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000003', 'PA Sports Mens', 'Foleshill Rangers', false, next_sun - 7,  '11:00', NULL, 2, 2, 'completed'),
    ('a5b10000-0000-4000-8000-000000000003', 'a5b00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000003', 'PA Sports Mens', 'Bedworth United',   true,  next_sun,      '11:00', 'a5a00000-0000-4000-8000-000000000001', NULL, NULL, 'scheduled'),
    ('a5b10000-0000-4000-8000-000000000004', 'a5b00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000003', 'PA Sports Mens', 'Coventry Copsewood', false, next_sun + 7,  '11:00', NULL, NULL, NULL, 'scheduled')
  ON CONFLICT (id) DO NOTHING;

  -- U7 fixtures (mini-soccer festivals; no pitch reservation, no scores recorded at U7)
  INSERT INTO club_fixtures (id, league_id, club_team_id, club_team_name, opponent_name, is_home, scheduled_date, kickoff_time, playing_area_id, status)
  VALUES
    ('a5b10000-0000-4000-8000-000000000011', 'a5b00000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000001', 'U7 Dortmund', 'Earlsdon Lions U7', true,  next_sun,     '09:30', NULL, 'scheduled'),
    ('a5b10000-0000-4000-8000-000000000012', 'a5b00000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000001', 'U7 Dortmund', 'Coventry Utd U7',   false, next_sun + 7, '09:30', NULL, 'scheduled'),
    ('a5b10000-0000-4000-8000-000000000013', 'a5b00000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000002', 'U7 Milan',    'Finham Park U7',    true,  next_sun,     '09:30', NULL, 'scheduled'),
    ('a5b10000-0000-4000-8000-000000000014', 'a5b00000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000002', 'U7 Milan',    'Westwood U7',       false, next_sun + 7, '09:30', NULL, 'scheduled')
  ON CONFLICT (id) DO NOTHING;
END $sched$;

-- ─── Verification ────────────────────────────────────────────────────────────
SELECT
 (SELECT count(*) FROM club_session_series WHERE club_id='club_pa_sports') AS series,     -- 3
 (SELECT count(*) FROM club_sessions       WHERE club_id='club_pa_sports') AS sessions,   -- 6
 (SELECT count(*) FROM club_leagues        WHERE club_id='club_pa_sports') AS leagues,    -- 2
 (SELECT count(*) FROM club_fixtures f JOIN club_leagues l ON l.id=f.league_id WHERE l.club_id='club_pa_sports') AS fixtures; -- 8
