-- demo-display-showroom.sql — reset the DEMO venue's matchday to "right now"
-- so the reception display (platform-display.vercel.app/display/
-- demo_venue_display_token) is fully populated for client demos.
--
-- RE-RUNNABLE: every run re-times the whole matchday relative to now() —
-- run it just before a demo. Touches DEMO rows only (demo_venue, team_dc_*,
-- team_demo_*, p_dc_*). Companion: demo-display-goal.sql fires a live goal
-- mid-demo (celebration overlay + score punch on the wall).
--
-- What it sets up:
--   · 3 live games (kickoffs ~58/41/23 min ago): hero (2-1 with events +
--     momentum), both mini tiles, two comps live -> rotating Live Table tabs
--   · fresh match events today -> goals ticker + richer Golden Boot
--   · tonight's upcoming fixtures incl. one "Needs ref" + TBC pitch row
--   · today's two casual bookings re-timed to later this evening (blue rows)
--   · real player names + shirt numbers on the demo competitive rosters
--   · full display_config: all zones, sponsor creative + 60/40 rotation
--
-- Run via Supabase SQL editor or MCP execute_sql. Fires venue_updated at the
-- end so live screens re-pull immediately.

DO $showroom$
DECLARE
  v_now   timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Europe/London')::date;

  -- demo seed ids (stable)
  f_live1 uuid := '92e4be46-04e5-4635-96aa-43d98e9a3b5c';  -- Demo Athletic v Competitive FC (hero)
  f_live2 uuid := 'f42d82ef-7dd5-43af-a272-e636dba6cd11';  -- Demo Rovers v Demo City
  f_live3 uuid := '4db5873b-ea94-4c01-b4c1-230f592ea11a';  -- Summer: Demo Bravo v Demo Charlie
  f_up1   uuid := 'dc000000-0000-4000-8000-0000000000f5';  -- Competitive FC v Demo Athletic
  f_up2   uuid := 'dc000000-0000-4000-8000-0000000000f6';  -- Demo Rovers v Demo City (needs ref + TBC)
  f_up3   uuid := '732c354a-5e5e-40ef-abe4-f7de2bfa1001';  -- Summer: Demo Alpha v Demo Bravo
  f_up4   uuid := 'db6f21af-f7f4-464d-a409-0c66aec453d7';  -- Summer: Demo Charlie v Demo Delta
  bk_1    uuid := '98528c4b-9d90-4849-8f48-72e84ec9e8a3';
  bk_2    uuid := 'ec0af169-6c81-4ca1-aff0-c514ba6f4a34';
  pa_main uuid := 'c0f26961-9dfc-41a1-8e53-9c774d9f1f81';
  pa_side uuid := '5b866896-d907-4e6e-b1be-ec23ba7e57c8';
  ref_sam    uuid := '298ae709-52d4-4f31-a127-0b9656951b71'; -- Sam Cooper
  ref_priya  uuid := 'b61f2c2e-d08f-4794-a78f-8d687b39a1f3'; -- Priya Sharma
  ref_marcus uuid := 'af9065ab-653a-4b85-91d5-c380653fecf0'; -- Marcus Reid

  ko1 timestamptz := v_now - interval '58 minutes';
  ko2 timestamptz := v_now - interval '41 minutes';
  ko3 timestamptz := v_now - interval '23 minutes';
BEGIN
  ------------------------------------------------------------------
  -- 0. Park the demo bookings' pitch occupancy first. The fixture
  --    trigger (tg_sync_fixture_occupancy) re-places fixture slots on
  --    UPDATE, and pitch_occupancy_no_overlap (WHERE active) would
  --    reject any transient overlap with the old booking windows.
  --    Final pitch timetable (60-min fixture slots, minutes from now —
  --    kept tight so nothing crosses midnight on an evening demo):
  --      Main: live1 [-58,+2) · bk_2 [+8,+38) · f_up1 [+45,+105)
  --      Side: live2 [-41,+19) · bk_1 [+25,+55) · f_up3 [+60,+120)
  --      f_up2 (+45) + f_up4 (+90) have no pitch -> TBC chip
  ------------------------------------------------------------------
  UPDATE pitch_occupancy SET active=false
  WHERE source_kind='booking' AND source_id IN (bk_1::text, bk_2::text);

  ------------------------------------------------------------------
  -- 1. Real-looking names + shirt numbers on the competitive rosters
  ------------------------------------------------------------------
  UPDATE players p SET name = v.nm, shirt_number = v.sh
  FROM (VALUES
    ('p_dc_tarny','Tarny',9),
    ('p_dc_fc1','Marcus Lee',7),   ('p_dc_fc2','Jay Patel',10),  ('p_dc_fc3','Tom Reid',4),
    ('p_dc_fc4','Sol Greene',5),   ('p_dc_fc5','Femi Ade',11),   ('p_dc_fc6','Rob Hart',6),
    ('p_dc_fc7','Niko Vasilev',8),
    ('p_dc_ath1','Dre Walker',11), ('p_dc_ath2','Kofi Mensah',7),('p_dc_ath3','Louis Park',9),
    ('p_dc_ath4','Theo Brandt',5), ('p_dc_ath5','Idris Kane',10),
    ('p_dc_cit1','Ollie Shaw',9),  ('p_dc_cit2','Mo Farouk',8),  ('p_dc_cit3','Danny Brooks',6),
    ('p_dc_cit4','Stefan Ilic',4), ('p_dc_cit5','Ben Archer',10),
    ('p_dc_rov1','Cal Hughes',10), ('p_dc_rov2','Andre Gomes',9),('p_dc_rov3','Sam Whitlock',7),
    ('p_dc_rov4','Jude Okoro',5),  ('p_dc_rov5','Harvey Lin',8),
    -- summer-league rosters (Golden Boot / mini tile / ticker show these too)
    ('team_demo_alpha_p1','Leo Grant',9),    ('team_demo_alpha_p2','Max Caulfield',7),
    ('team_demo_alpha_p3','Owen Price',4),   ('team_demo_alpha_p4','Zane Hollis',10),
    ('team_demo_alpha_p5','Eddie Vance',6),
    ('team_demo_bravo_p1','Kieran Holt',9),  ('team_demo_bravo_p2','Dylan Mercer',8),
    ('team_demo_bravo_p3','Ash Winters',5),  ('team_demo_bravo_p4','Cole Bryant',10),
    ('team_demo_bravo_p5','Finn Castor',7),
    ('team_demo_charlie_p1','Reece Walsh',9),('team_demo_charlie_p2','Ty Sandoval',6),
    ('team_demo_charlie_p3','Jamal Reyes',8),('team_demo_charlie_p4','Nico Ferrara',10),
    ('team_demo_charlie_p5','Brad Olsen',4),
    ('team_demo_delta_p1','Ivan Petrov',7),  ('team_demo_delta_p2','Gus Moreau',9),
    ('team_demo_delta_p3','Silas Kane',5),   ('team_demo_delta_p4','Marco Dent',10),
    ('team_demo_delta_p5','Abe Fischer',8),
    ('team_demo_echo_p1','Hugh Barker',9),   ('team_demo_echo_p2','Seb Nkem',7),
    ('team_demo_echo_p3','Olly Frame',6),    ('team_demo_echo_p4','Pat Quigley',10),
    ('team_demo_echo_p5','Ray Stanton',5)
  ) AS v(id, nm, sh)
  WHERE p.id = v.id;

  ------------------------------------------------------------------
  -- 2. Three live games, kickoffs staggered from now
  ------------------------------------------------------------------
  UPDATE fixtures SET status='in_progress', scheduled_date=v_today,
    kickoff_time=(ko1 AT TIME ZONE 'Europe/London')::time,
    actual_kickoff_at=ko1, home_score=2, away_score=1,
    round_name='R6', official_id=ref_sam, playing_area_id=pa_main
  WHERE id=f_live1;

  UPDATE fixtures SET status='in_progress', scheduled_date=v_today,
    kickoff_time=(ko2 AT TIME ZONE 'Europe/London')::time,
    actual_kickoff_at=ko2, home_score=2, away_score=1,
    round_name='R6', official_id=ref_marcus, playing_area_id=pa_side
  WHERE id=f_live2;

  UPDATE fixtures SET status='in_progress', scheduled_date=v_today,
    kickoff_time=(ko3 AT TIME ZONE 'Europe/London')::time,
    actual_kickoff_at=ko3, home_score=1, away_score=0,
    round_name='W3', official_id=ref_priya, playing_area_id=NULL
  WHERE id=f_live3;

  ------------------------------------------------------------------
  -- 3. Fresh match events (goals ticker + hero strip + golden boot)
  ------------------------------------------------------------------
  DELETE FROM match_events WHERE fixture_id IN (f_live1, f_live2, f_live3);
  INSERT INTO match_events (fixture_id, event_type, minute, period, player_id, team_id,
                            recorded_by_token, recorded_by_type, local_timestamp, created_at)
  VALUES
    (f_live1,'goal',       12,'1H','p_dc_ath1','team_dc_athletic','demo_showroom','system', ko1+interval '12 min', ko1+interval '12 min'),
    (f_live1,'yellow_card',27,'1H','p_dc_fc6', 'team_dc_fc',      'demo_showroom','system', ko1+interval '27 min', ko1+interval '27 min'),
    (f_live1,'goal',       33,'1H','p_dc_fc2', 'team_dc_fc',      'demo_showroom','system', ko1+interval '33 min', ko1+interval '33 min'),
    (f_live1,'goal',       51,'2H','p_dc_ath3','team_dc_athletic','demo_showroom','system', ko1+interval '51 min', ko1+interval '51 min'),
    (f_live2,'goal',        8,'1H','p_dc_rov2','team_dc_rovers',  'demo_showroom','system', ko2+interval '8 min',  ko2+interval '8 min'),
    (f_live2,'goal',       19,'1H','p_dc_cit1','team_dc_city',    'demo_showroom','system', ko2+interval '19 min', ko2+interval '19 min'),
    (f_live2,'red_card',   31,'2H','p_dc_cit4','team_dc_city',    'demo_showroom','system', ko2+interval '31 min', ko2+interval '31 min'),
    (f_live2,'goal',       36,'2H','p_dc_rov1','team_dc_rovers',  'demo_showroom','system', ko2+interval '36 min', ko2+interval '36 min'),
    (f_live3,'yellow_card', 9,'1H','team_demo_charlie_p3','team_demo_charlie','demo_showroom','system', ko3+interval '9 min',  ko3+interval '9 min'),
    (f_live3,'goal',       17,'1H','team_demo_bravo_p1',  'team_demo_bravo',  'demo_showroom','system', ko3+interval '17 min', ko3+interval '17 min');

  ------------------------------------------------------------------
  -- 4. Tonight's upcoming fixtures
  ------------------------------------------------------------------
  UPDATE fixtures SET status='allocated', scheduled_date=v_today, actual_kickoff_at=NULL,
    home_score=NULL, away_score=NULL,
    kickoff_time=((v_now + interval '45 minutes') AT TIME ZONE 'Europe/London')::time,
    playing_area_id=pa_main, official_id=ref_marcus, round_name='R7'
  WHERE id=f_up1;

  UPDATE fixtures SET status='scheduled', scheduled_date=v_today, actual_kickoff_at=NULL,
    home_score=NULL, away_score=NULL,
    kickoff_time=((v_now + interval '45 minutes') AT TIME ZONE 'Europe/London')::time,
    playing_area_id=NULL, official_id=NULL, round_name='R7'        -- TBC pitch + "Needs ref"
  WHERE id=f_up2;

  UPDATE fixtures SET status='allocated', scheduled_date=v_today, actual_kickoff_at=NULL,
    home_score=NULL, away_score=NULL,
    kickoff_time=((v_now + interval '60 minutes') AT TIME ZONE 'Europe/London')::time,
    playing_area_id=pa_side, official_id=ref_priya, round_name='W4'
  WHERE id=f_up3;

  UPDATE fixtures SET status='allocated', scheduled_date=v_today, actual_kickoff_at=NULL,
    home_score=NULL, away_score=NULL,
    kickoff_time=((v_now + interval '90 minutes') AT TIME ZONE 'Europe/London')::time,
    playing_area_id=NULL, official_id=ref_sam, round_name='W4'     -- TBC pitch
  WHERE id=f_up4;

  ------------------------------------------------------------------
  -- 5. Re-place today's casual bookings into the free pitch windows
  --    (bk_1 → Side +35, bk_2 → Main +10; both blue rows in Coming Up)
  ------------------------------------------------------------------
  UPDATE pitch_bookings SET booking_date=v_today, status='confirmed',
    playing_area_id=pa_side,
    kickoff_time=((v_now + interval '25 minutes') AT TIME ZONE 'Europe/London')::time
  WHERE id=bk_1;
  UPDATE pitch_bookings SET booking_date=v_today, status='confirmed',
    playing_area_id=pa_main,
    kickoff_time=((v_now + interval '8 minutes') AT TIME ZONE 'Europe/London')::time
  WHERE id=bk_2;
  UPDATE pitch_occupancy SET active=true, playing_area_id=pa_side,
    time_range=tstzrange(v_now + interval '25 minutes', v_now + interval '55 minutes')
  WHERE source_kind='booking' AND source_id=bk_1::text;
  UPDATE pitch_occupancy SET active=true, playing_area_id=pa_main,
    time_range=tstzrange(v_now + interval '8 minutes', v_now + interval '38 minutes')
  WHERE source_kind='booking' AND source_id=bk_2::text;

  ------------------------------------------------------------------
  -- 6. Full display config: all zones + sponsor creative
  ------------------------------------------------------------------
  UPDATE venues SET display_config = jsonb_build_object(
    'zones', jsonb_build_array('live_scores','standings','top_scorers','upcoming','recent','goals_ticker','custom_message'),
    'mode', 'smart',
    'interval_secs', 12,
    'custom_message', 'Welcome to Demo Sports Centre — bar open till 11pm',
    'sponsor_image_url', 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=640&q=80',
    'sponsor_label', 'Sponsor · The Clubhouse Tap',
    'sponsor_title', 'Post-match pint? £4 til 10pm.',
    'sponsor_body', 'Show your matchday wristband at the side bar.',
    'sponsor_url', 'demosports.co/tap',
    'sponsor_ratio', 0.6,
    'featured_fixture_id', NULL,
    'featured_pin_expires_at', NULL,
    'featured_pin_story_tag', NULL
  )
  WHERE id='demo_venue';

  PERFORM public.notify_venue_change('demo_venue', 'venue_updated');
END
$showroom$;
