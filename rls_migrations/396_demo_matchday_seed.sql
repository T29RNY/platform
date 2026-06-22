-- 396 — Demo seed for the opposition-coach matchday link (#8 Phase B).
-- Idempotent. Seeds one club_league + one home fixture on Finbar's FC (club_demo)
-- at demo_venue, with a STABLE share_code so the demo link never changes, plus
-- demo matchday ground rules on demo_venue. Safe to re-run (ON CONFLICT DO NOTHING
-- on fixed ids; matchday_info set unconditionally to the demo copy).

INSERT INTO public.club_leagues (id, club_id, venue_id, name, season_label)
VALUES ('d0000000-0000-4000-8000-000000000394', 'club_demo', 'demo_venue',
        'U12 Saturday League', '2026/27')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.club_fixtures (
  id, league_id, club_team_id, opponent_name, is_home, scheduled_date, kickoff_time,
  playing_area_id, official_id, status, share_code, source)
VALUES (
  'd0000000-0000-4000-8000-000000000395',
  'd0000000-0000-4000-8000-000000000394',
  'c0000000-0000-4000-8000-000000000002',          -- U12 Falcons
  'Riverside Rangers U12', true, DATE '2026-06-27', TIME '10:30',
  'c0f26961-9dfc-41a1-8e53-9c774d9f1f81',           -- Main Pitch
  '298ae709-52d4-4f31-a127-0b9656951b71',           -- ref Sam Cooper
  'scheduled', 'demofalcons01', 'manual')
ON CONFLICT (id) DO NOTHING;

UPDATE public.venues SET matchday_info = jsonb_build_object(
  'parking',   'Free parking in the main car park off Stadium Way — please don''t park on Coach Road.',
  'rules',     'Spectators behind the respect barrier. No smoking or dogs in the ground. Studded boots on grass only.',
  'directions','Sat nav to the postcode brings you to the main gate; the pitches are signposted from reception.',
  'contact',   'Matchday secretary: 07700 900123')
WHERE id = 'demo_venue';
