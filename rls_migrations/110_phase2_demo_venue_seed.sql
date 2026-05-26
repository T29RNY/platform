-- 110_phase2_demo_venue_seed.sql
--
-- Phase 2 (League Mode) — Cycle 2.7a demo venue seed.
--
-- Creates a fully populated demo venue + league + season + 4 teams
-- + round-robin fixtures + mixed past-result states + a sample
-- maintenance window. Drives every Phase 2 mutating RPC end-to-end
-- so the data shape mirrors what a real onboarding produces.
--
-- Idempotent: bails early if `demo_venue` already exists.
--
-- Demo identifiers (all under the `demo_` namespace so a sweep can
-- drop them cleanly via the _down.sql):
--   venue_id              = 'demo_venue'
--   venue_admin_token     = 'demo_venue_token_DO_NOT_USE_IN_PROD'
--   league_id             = 'demo_league'
--   league_admin_token    = 'demo_league_admin_token'
--   league_code           = 'DEMO0001'
--   team ids              = team_demo_{alpha,bravo,charlie,delta}
--
-- Data shape:
--   2 pitches (Main + Side; Side has a maintenance window
--     2026-07-01..2026-07-03)
--   3 refs (mixed channels + employment_type)
--   1 season "Summer 2026" (2026-06-03 .. 2026-07-22, 8 weeks)
--   1 competition "Summer League" (league/round_robin)
--   4 teams approved into competition
--   6 round-robin fixtures (week 1 + 2 + 3, all pitched, refs
--     assigned on past fixtures)
--   Past results for standings demo:
--     wk1: Alpha 4-2 Bravo; Charlie 1-1 Delta
--     wk2: Alpha (walkover, Charlie no-show); Delta 2-3 Bravo
--     wk3: scheduled, two future fixtures untouched
--
-- This script intentionally bypasses join_register_team for team
-- creation + approval — that RPC requires an auth.uid() per
-- team_admin claim, which is impractical from a seed. The team
-- rows + competition_teams rows go in directly via INSERT; everything
-- else routes through the live RPCs (venue_add_pitch, venue_add_ref,
-- venue_create_season, venue_generate_fixtures).

DO $function$
DECLARE
  v_venue_id text := 'demo_venue';
  v_venue_token text := 'demo_venue_token_DO_NOT_USE_IN_PROD';
  v_league_id text := 'demo_league';
  v_pitch_a uuid;
  v_pitch_b uuid;
  v_ref1 uuid;
  v_ref2 uuid;
  v_ref3 uuid;
  v_season_id uuid;
  v_comp_id uuid;
  v_result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM venues WHERE id = v_venue_id) THEN
    RAISE NOTICE 'demo venue already seeded; mig 110 skipping';
    RETURN;
  END IF;

  ------------------------------------------------------------------
  -- Venue + league (direct insert — no public RPC for venue create
  -- exists; the live one is superadmin_create_venue which requires
  -- is_platform_admin())
  ------------------------------------------------------------------
  INSERT INTO venues (id, name, sport, venue_admin_token, live_channel_key,
                      active, slug, city)
  VALUES (v_venue_id, 'Demo Sports Centre', 'football', v_venue_token,
          'demo_venue_live', true, 'demo-sports-centre', 'London');

  INSERT INTO leagues (id, name, venue_id, sport, format,
                       league_admin_token, display_token, live_channel_key,
                       league_code, squad_mode, standings_visibility, active,
                       short_name, day_of_week, default_kickoff_time)
  VALUES (v_league_id, 'Demo Summer League', v_venue_id, 'football', '5-a-side',
          'demo_league_admin_token', 'demo_league_display_token',
          'demo_league_live', 'DEMO0001',
          'registered', 'public', true,
          'Demo SL', 3, '19:30:00');

  -- Dates: relative to seed time so the dashboard always has
  -- realistic past + future fixtures regardless of when run.
  -- (See mig 112 for the post-110 shift to this scheme.)

  ------------------------------------------------------------------
  -- Pitches via venue_add_pitch
  ------------------------------------------------------------------
  v_result := public.venue_add_pitch(v_venue_token,
    '{"name":"Main Pitch","surface":"3g","capacity":10,"sort_order":1}'::jsonb);
  v_pitch_a := (v_result->>'pitch_id')::uuid;

  v_result := public.venue_add_pitch(v_venue_token,
    jsonb_build_object(
      'name', 'Side Pitch',
      'surface', '3g',
      'capacity', 8,
      'sort_order', 2,
      'maintenance_windows', jsonb_build_array(
        jsonb_build_object(
          'start_date', '2026-07-01',
          'end_date', '2026-07-03',
          'reason', 'annual line marking')
      )
    ));
  v_pitch_b := (v_result->>'pitch_id')::uuid;

  ------------------------------------------------------------------
  -- Refs via venue_add_ref
  ------------------------------------------------------------------
  v_result := public.venue_add_ref(v_venue_token,
    '{"name":"Sam Cooper","preferred_channel":"whatsapp","employment_type":"in_house","overall_rating":4.6,"whatsapp_number":"+447000000001"}'::jsonb);
  v_ref1 := (v_result->>'ref_id')::uuid;

  v_result := public.venue_add_ref(v_venue_token,
    '{"name":"Priya Sharma","preferred_channel":"sms","employment_type":"freelance","overall_rating":4.8,"phone":"+447000000002"}'::jsonb);
  v_ref2 := (v_result->>'ref_id')::uuid;

  v_result := public.venue_add_ref(v_venue_token,
    '{"name":"Marcus Reid","preferred_channel":"email","employment_type":"freelance","overall_rating":4.2,"email":"marcus@example.com"}'::jsonb);
  v_ref3 := (v_result->>'ref_id')::uuid;

  ------------------------------------------------------------------
  -- Teams (direct insert; join_register_team needs auth.uid())
  ------------------------------------------------------------------
  INSERT INTO teams (id, name, admin_token, team_type, primary_colour, secondary_colour, onboarding_complete)
  VALUES
    ('team_demo_alpha',   'Alpha United',   'demo_team_alpha_token',   'competitive', '#60A0FF', '#FFFFFF', true),
    ('team_demo_bravo',   'Bravo Athletic', 'demo_team_bravo_token',   'competitive', '#FF6060', '#FFFFFF', true),
    ('team_demo_charlie', 'Charlie City',   'demo_team_charlie_token', 'competitive', '#60D060', '#000000', true),
    ('team_demo_delta',   'Delta FC',       'demo_team_delta_token',   'competitive', '#F0B040', '#000000', true);

  ------------------------------------------------------------------
  -- Season + competition via venue_create_season
  ------------------------------------------------------------------
  v_result := public.venue_create_season(v_venue_token, jsonb_build_object(
    'league_id',   v_league_id,
    'name',        'Summer 2026',
    'start_date',  (current_date - 21)::text,
    'end_date',    (current_date + 56)::text,
    'num_weeks',   8,
    'competitions', jsonb_build_array(
      jsonb_build_object('name','Summer League','type','league','format','round_robin')
    )
  ));
  v_season_id := (v_result->>'season_id')::uuid;
  v_comp_id   := ((v_result->'competitions')->0->>'id')::uuid;

  -- Approve all 4 teams into the competition (would normally come
  -- via join_register_team + venue_approve_team_registration)
  INSERT INTO competition_teams (competition_id, team_id, status) VALUES
    (v_comp_id, 'team_demo_alpha',   'active'),
    (v_comp_id, 'team_demo_bravo',   'active'),
    (v_comp_id, 'team_demo_charlie', 'active'),
    (v_comp_id, 'team_demo_delta',   'active');

  -- Bump season + competition to active so standings RPC counts them
  UPDATE seasons     SET status='active' WHERE id = v_season_id;
  UPDATE competitions SET status='active' WHERE id = v_comp_id;

  ------------------------------------------------------------------
  -- Fixtures via venue_generate_fixtures (round-robin, hand-crafted
  -- pairings for predictability)
  ------------------------------------------------------------------
  v_result := public.venue_generate_fixtures(v_venue_token, v_comp_id, jsonb_build_array(
    jsonb_build_object('week_number',1,'home_team_id','team_demo_alpha',  'away_team_id','team_demo_bravo',  'scheduled_date',(current_date - 13)::text,'kickoff_time','19:30','playing_area_id', v_pitch_a::text),
    jsonb_build_object('week_number',1,'home_team_id','team_demo_charlie','away_team_id','team_demo_delta',  'scheduled_date',(current_date - 13)::text,'kickoff_time','20:30','playing_area_id', v_pitch_b::text),
    jsonb_build_object('week_number',2,'home_team_id','team_demo_alpha',  'away_team_id','team_demo_charlie','scheduled_date',(current_date -  6)::text,'kickoff_time','19:30','playing_area_id', v_pitch_a::text),
    jsonb_build_object('week_number',2,'home_team_id','team_demo_delta',  'away_team_id','team_demo_bravo',  'scheduled_date',(current_date -  6)::text,'kickoff_time','20:30','playing_area_id', v_pitch_b::text),
    jsonb_build_object('week_number',3,'home_team_id','team_demo_alpha',  'away_team_id','team_demo_delta',  'scheduled_date',(current_date +  8)::text,'kickoff_time','19:30','playing_area_id', v_pitch_a::text),
    jsonb_build_object('week_number',3,'home_team_id','team_demo_bravo',  'away_team_id','team_demo_charlie','scheduled_date',(current_date +  8)::text,'kickoff_time','20:30','playing_area_id', v_pitch_b::text)
  ));

  ------------------------------------------------------------------
  -- Past results state variety
  ------------------------------------------------------------------
  -- Week 1: Alpha 4-2 Bravo (Sam reffed)
  UPDATE fixtures
     SET status='completed', home_score=4, away_score=2, official_id=v_ref1
   WHERE competition_id=v_comp_id AND week_number=1 AND home_team_id='team_demo_alpha';

  -- Week 1: Charlie 1-1 Delta (Priya reffed)
  UPDATE fixtures
     SET status='completed', home_score=1, away_score=1, official_id=v_ref2
   WHERE competition_id=v_comp_id AND week_number=1 AND home_team_id='team_demo_charlie';

  -- Week 2: Alpha walkover (Charlie no-show)
  UPDATE fixtures
     SET status='walkover', walkover_winner_id='team_demo_alpha', official_id=v_ref1
   WHERE competition_id=v_comp_id AND week_number=2 AND home_team_id='team_demo_alpha';

  -- Week 2: Delta 2-3 Bravo (Marcus reffed)
  UPDATE fixtures
     SET status='completed', home_score=2, away_score=3, official_id=v_ref3
   WHERE competition_id=v_comp_id AND week_number=2 AND home_team_id='team_demo_delta';

  -- Week 3: leave as scheduled with pitch assigned, no ref yet (so
  -- the dashboard has "needs ref" items in its Open Issues panel)
  -- Status is 'allocated' because pitches are set
  UPDATE fixtures
     SET status='allocated'
   WHERE competition_id=v_comp_id AND week_number=3;

  ------------------------------------------------------------------
  -- One sample player attached to Alpha so the player-token
  -- standings RPC has a caller to test through.
  ------------------------------------------------------------------
  INSERT INTO players (id, name, token, status)
  VALUES ('p_demo_alpha1', 'Demo Captain', 'tok_demo_player', 'none')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO team_players (team_id, player_id)
  VALUES ('team_demo_alpha', 'p_demo_alpha1')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'demo venue seeded — venue_token=%, league_code=DEMO0001', v_venue_token;
END;
$function$;
