-- =============================================================================
-- Migration 510: PA Sports demo — match & training ACTIVITY (lived-in demo)
-- =============================================================================
-- Depends on 505–508.
--   • Past training sessions (1 wk ago) per team + attendance marked
--   • In/Out RSVPs on all upcoming training (guardians for kids, self for adults)
--   • In/Out availability on all upcoming fixtures
--   • 2 extra played Mens fixtures (form guide) + Player-of-the-Month per team
--   • 3 club announcements (sent)
-- Set-based inserts keyed off rosters — idempotent (ON CONFLICT DO NOTHING).
-- Extra session ids: a5d1…4x. Extra fixture ids: a5b1…0x (05,06).
-- Paired teardown: 510_pa_sports_activity_down.sql
-- =============================================================================

DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM club_teams WHERE club_id='club_pa_sports') THEN
    RAISE EXCEPTION 'PA Sports teams not found — apply migs 505–508 first';
  END IF;
END $guard$;

-- ─── 1. Past training sessions (a week ago) for attendance history ───────────
INSERT INTO club_sessions (id, club_id, cohort_id, team_id, title, session_type, scheduled_at, status, series_id, venue_id, playing_area_id)
VALUES
  ('a5d10000-0000-4000-8000-000000000041', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000001', 'U7 Dortmund Training', 'training', ((current_date - 7) + time '17:00')::timestamptz, 'scheduled', 'a5d00000-0000-4000-8000-000000000001', 'seva_school', 'a5a00000-0000-4000-8000-000000000004'),
  ('a5d10000-0000-4000-8000-000000000042', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000002', 'U7 Milan Training',    'training', ((current_date - 7) + time '18:00')::timestamptz, 'scheduled', 'a5d00000-0000-4000-8000-000000000002', 'seva_school', 'a5a00000-0000-4000-8000-000000000004'),
  ('a5d10000-0000-4000-8000-000000000043', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000003', 'PA Sports Mens Training', 'training', ((current_date - 7) + time '20:00')::timestamptz, 'scheduled', 'a5d00000-0000-4000-8000-000000000003', 'seva_school', 'a5a00000-0000-4000-8000-000000000004')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Attendance on those past sessions (mostly attended, a few absent/late) ─
INSERT INTO club_session_attendance (session_id, member_profile_id, status)
SELECT cs.id, ctm.member_profile_id,
       (ARRAY['attended','attended','attended','attended','late','absent'])[1 + (row_number() OVER (PARTITION BY cs.id ORDER BY ctm.member_profile_id))::int % 6]
FROM club_sessions cs
JOIN club_team_members ctm ON ctm.team_id = cs.team_id AND ctm.is_active
WHERE cs.id::text IN ('a5d10000-0000-4000-8000-000000000041','a5d10000-0000-4000-8000-000000000042','a5d10000-0000-4000-8000-000000000043')
ON CONFLICT DO NOTHING;

-- ─── 3. RSVPs on ALL upcoming training (guardian for kids, self for adults) ───
INSERT INTO club_session_rsvps (session_id, member_profile_id, rsvp_by_profile_id, status)
SELECT cs.id, ctm.member_profile_id,
       coalesce(mg.guardian_profile_id, ctm.member_profile_id),
       (ARRAY['in','in','in','in','maybe','out'])[1 + (row_number() OVER (PARTITION BY cs.id ORDER BY ctm.member_profile_id))::int % 6]
FROM club_sessions cs
JOIN club_team_members ctm ON ctm.team_id = cs.team_id AND ctm.is_active
LEFT JOIN member_guardians mg ON mg.child_profile_id = ctm.member_profile_id
WHERE cs.club_id='club_pa_sports' AND cs.scheduled_at > now()
ON CONFLICT DO NOTHING;

-- ─── 4. Availability on ALL upcoming fixtures ────────────────────────────────
INSERT INTO club_fixture_availability (fixture_id, member_profile_id, rsvp_by_profile_id, status)
SELECT f.id, ctm.member_profile_id,
       coalesce(mg.guardian_profile_id, ctm.member_profile_id),
       (ARRAY['in','in','in','maybe','out'])[1 + (row_number() OVER (PARTITION BY f.id ORDER BY ctm.member_profile_id))::int % 5]
FROM club_fixtures f
JOIN club_leagues l ON l.id = f.league_id AND l.club_id='club_pa_sports'
JOIN club_team_members ctm ON ctm.team_id = f.club_team_id AND ctm.is_active
LEFT JOIN member_guardians mg ON mg.child_profile_id = ctm.member_profile_id
WHERE f.status='scheduled' AND f.scheduled_date >= current_date
ON CONFLICT DO NOTHING;

-- ─── 5. Two more played Mens fixtures (form guide) ───────────────────────────
DO $more$
DECLARE next_sun date := current_date + ((0 - extract(dow from current_date)::int + 7) % 7);
BEGIN
  INSERT INTO club_fixtures (id, league_id, club_team_id, club_team_name, opponent_name, is_home, scheduled_date, kickoff_time, playing_area_id, home_score, away_score, status)
  VALUES
    ('a5b10000-0000-4000-8000-000000000005', 'a5b00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000003', 'PA Sports Mens', 'Nuneaton Griff',   true,  next_sun - 21, '11:00', 'a5a00000-0000-4000-8000-000000000001', 1, 0, 'completed'),
    ('a5b10000-0000-4000-8000-000000000006', 'a5b00000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000003', 'PA Sports Mens', 'Bulkington Sports', false, next_sun - 28, '11:00', NULL, 0, 3, 'completed')
  ON CONFLICT (id) DO NOTHING;
END $more$;

-- ─── 6. Player of the Month per team ─────────────────────────────────────────
INSERT INTO club_team_potm (team_id, club_id, name, month)
VALUES
  ('a5100000-0000-4000-8000-000000000003', 'club_pa_sports', 'Sonny Athwal', to_char(current_date, 'YYYY-MM')),
  ('a5100000-0000-4000-8000-000000000001', 'club_pa_sports', 'Arjan Sandhu', to_char(current_date, 'YYYY-MM')),
  ('a5100000-0000-4000-8000-000000000002', 'club_pa_sports', 'Vihaan Grewal', to_char(current_date, 'YYYY-MM'))
ON CONFLICT DO NOTHING;

-- ─── 7. Announcements (sent) ─────────────────────────────────────────────────
INSERT INTO club_announcements (id, club_id, venue_id, title, body, audience, cohort_id, team_id, status, email_sent_count, sent_at)
VALUES
  ('a5c20000-0000-4000-8000-000000000001', 'club_pa_sports', 'pa_peugeot', 'Welcome to the 2025/26 season!', 'Great to have everyone back. Please keep your availability up to date each week so the coaches can plan. Fair Play First.', 'club', NULL, NULL, 'sent', 60, now() - interval '6 days'),
  ('a5c20000-0000-4000-8000-000000000002', 'club_pa_sports', 'pa_peugeot', 'U7 parents — kit & drop-off', 'A reminder that Wednesday training is 5pm (Dortmund) and 6pm (Milan) at Seva School. Please arrive 5 minutes early and sign your child in.', 'cohort', 'a5c00000-0000-4000-8000-000000000001', NULL, 'sent', 18, now() - interval '3 days'),
  ('a5c20000-0000-4000-8000-000000000003', 'club_pa_sports', 'pa_peugeot', 'Mens — Sunday XI', 'Good result last week. Mark yourselves in for Sunday''s home game vs Bedworth United, 11am at PA Peugeot Ground. Meet 10:15.', 'team', NULL, 'a5100000-0000-4000-8000-000000000003', 'sent', 16, now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ─── Verification ────────────────────────────────────────────────────────────
SELECT
 (SELECT count(*) FROM club_session_attendance a JOIN club_sessions s ON s.id=a.session_id WHERE s.club_id='club_pa_sports') AS attendance,
 (SELECT count(*) FROM club_session_rsvps r JOIN club_sessions s ON s.id=r.session_id WHERE s.club_id='club_pa_sports') AS rsvps,
 (SELECT count(*) FROM club_fixture_availability av JOIN club_fixtures f ON f.id=av.fixture_id JOIN club_leagues l ON l.id=f.league_id WHERE l.club_id='club_pa_sports') AS availability,
 (SELECT count(*) FROM club_fixtures f JOIN club_leagues l ON l.id=f.league_id WHERE l.club_id='club_pa_sports' AND f.status='completed') AS played,
 (SELECT count(*) FROM club_team_potm WHERE club_id='club_pa_sports') AS potm,
 (SELECT count(*) FROM club_announcements WHERE club_id='club_pa_sports') AS announcements;
