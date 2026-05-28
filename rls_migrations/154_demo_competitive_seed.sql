-- Migration 154 — Demo COMPETITIVE testbed for League Mode (Phase 5) end-to-end testing.
--
-- Creates a fully-namespaced competitive setup so the real signed-in operator
-- (tarnysingh@gmail.com) can test the competitive surfaces as a TEAM ADMIN of a
-- real, app-loadable team. Everything lives under the `dc` / `p_dc_` / `democomp`
-- namespace so 154_..._down.sql removes it cleanly with zero risk to real data or
-- the existing `demo_venue` Summer League.
--
-- Namespace:
--   league         league_democomp
--   season         dc000000-0000-4000-8000-000000000001
--   competition    dc000000-0000-4000-8000-000000000002  (league / round_robin)
--   teams          team_dc_fc (Competitive FC) + team_dc_{rovers,city,athletic}
--   players        p_dc_tarny (real user_id, token p_dc_tarny_token) + p_dc_{fc1..7,rov1..5,cit1..5,ath1..5}
--   fixtures       dc000000-0000-4000-8000-0000000000f1..f6
--
-- Reuses the existing demo_venue (no venue seeded). Fixtures carry NO pitch
-- (playing_area_id NULL) deliberately, so the fixture→pitch_occupancy trigger
-- has nothing to project — keeps the seed side-effect-free.
--
-- Competitive FC gets full team scaffolding (schedule + settings + team_admins),
-- mirroring create_team, so the player/admin app loads it normally. Tarny is
-- team_admin (full access incl. teamsheet/availability when those cycles ship).
--
-- Idempotent: bails if team_dc_fc already exists.
--
-- TO PULL THE DATA OUT (any time): run 154_demo_competitive_seed_down.sql.

DO $seed$
DECLARE
  v_tarny  uuid;
  v_season uuid := 'dc000000-0000-4000-8000-000000000001';
  v_comp   uuid := 'dc000000-0000-4000-8000-000000000002';
  v_now    timestamptz := now();
BEGIN
  IF EXISTS (SELECT 1 FROM teams WHERE id='team_dc_fc') THEN
    RAISE NOTICE 'democomp already seeded; mig 154 skipping'; RETURN;
  END IF;
  SELECT id INTO v_tarny FROM auth.users WHERE email='tarnysingh@gmail.com';
  IF v_tarny IS NULL THEN RAISE EXCEPTION 'tarny auth user not found — cannot seed competitive admin'; END IF;

  INSERT INTO leagues (id, name, venue_id, sport, format, league_admin_token, display_token,
                       live_channel_key, league_code, squad_mode, standings_visibility, active,
                       short_name, day_of_week, default_kickoff_time)
  VALUES ('league_democomp','Demo Competitive League','demo_venue','football','5-a-side',
          'democomp_league_admin_token','democomp_display_token','democomp_league_live',
          'DEMOCOMP','registered','public', true,'Demo CL', 4,'20:00:00');

  INSERT INTO seasons (id, league_id, name, start_date, end_date, num_weeks, status)
  VALUES (v_season,'league_democomp','Test Season',(current_date-21),(current_date+35),8,'active');

  INSERT INTO competitions (id, season_id, name, type, format, status)
  VALUES (v_comp, v_season,'Demo Competitive League','league','round_robin','active');

  INSERT INTO teams (id, name, admin_token, join_code, onboarding_complete, admin_email, live_channel_key, team_type) VALUES
   ('team_dc_fc','Competitive FC','democomp_fc_admin_token','DCFC01', true,'tarnysingh@gmail.com', gen_random_uuid()::text,'competitive'),
   ('team_dc_rovers','Demo Rovers','democomp_rov_admin_token','DCRV01', true,'demo+rovers@example.com', gen_random_uuid()::text,'competitive'),
   ('team_dc_city','Demo City','democomp_cit_admin_token','DCCT01', true,'demo+city@example.com', gen_random_uuid()::text,'competitive'),
   ('team_dc_athletic','Demo Athletic','democomp_ath_admin_token','DCAT01', true,'demo+athletic@example.com', gen_random_uuid()::text,'competitive');

  INSERT INTO schedule (id, team_id, day_of_week, kickoff, venue, city, squad_size, price_per_player,
                        bibs_enabled, opens_day, opens_time, priority_lead_mins, game_date_time,
                        auto_open_pending, active, is_draft, is_cancelled, game_is_live)
  VALUES ('sched_team_dc_fc','team_dc_fc','Thursday','20:00','Demo Sports Centre','London',7,5,
          true,'Wednesday','20:00',60,(date_trunc('day',now())+interval '6 day'+time '20:00'),
          true, true, false, false, false);

  INSERT INTO settings (id, team_id, group_name) VALUES ('sett_team_dc_fc','team_dc_fc','Competitive FC');

  INSERT INTO players (id, name, token, status, user_id) VALUES ('p_dc_tarny','Tarny','p_dc_tarny_token','none', v_tarny);
  INSERT INTO players (id, name, status)
    SELECT 'p_dc_fc'||g, (ARRAY['Marcus Lee','Jay Patel','Tom Reid','Sol Greene','Femi Ade','Rob Hart','Niko Vasilev'])[g],'none' FROM generate_series(1,7) g;
  INSERT INTO players (id, name, status) SELECT 'p_dc_rov'||g,'Rovers Player '||g,'none'   FROM generate_series(1,5) g;
  INSERT INTO players (id, name, status) SELECT 'p_dc_cit'||g,'City Player '||g,'none'     FROM generate_series(1,5) g;
  INSERT INTO players (id, name, status) SELECT 'p_dc_ath'||g,'Athletic Player '||g,'none' FROM generate_series(1,5) g;

  INSERT INTO team_players (team_id, player_id) VALUES ('team_dc_fc','p_dc_tarny');
  INSERT INTO team_players (team_id, player_id) SELECT 'team_dc_fc','p_dc_fc'||g FROM generate_series(1,7) g;
  INSERT INTO team_players (team_id, player_id) SELECT 'team_dc_rovers','p_dc_rov'||g FROM generate_series(1,5) g;
  INSERT INTO team_players (team_id, player_id) SELECT 'team_dc_city','p_dc_cit'||g FROM generate_series(1,5) g;
  INSERT INTO team_players (team_id, player_id) SELECT 'team_dc_athletic','p_dc_ath'||g FROM generate_series(1,5) g;

  INSERT INTO team_admins (team_id, user_id, role, granted_by) VALUES ('team_dc_fc', v_tarny,'team_admin', null);

  INSERT INTO competition_teams (competition_id, team_id, status) VALUES
   (v_comp,'team_dc_fc','active'),(v_comp,'team_dc_rovers','active'),
   (v_comp,'team_dc_city','active'),(v_comp,'team_dc_athletic','active');

  INSERT INTO player_registrations (player_id, competition_id, team_id, status)
    SELECT tp.player_id, v_comp, tp.team_id,'active' FROM team_players tp
    WHERE tp.team_id IN ('team_dc_fc','team_dc_rovers','team_dc_city','team_dc_athletic');

  -- 4-team single round-robin. Competitive FC: 2 completed + 1 upcoming.
  -- playing_area_id NULL on purpose (no occupancy-trigger projection).
  INSERT INTO fixtures (id, competition_id, home_team_id, away_team_id, week_number, scheduled_date, kickoff_time, status, home_score, away_score) VALUES
   ('dc000000-0000-4000-8000-0000000000f1', v_comp,'team_dc_fc','team_dc_rovers',1,(current_date-14),'20:00','completed',3,1),
   ('dc000000-0000-4000-8000-0000000000f2', v_comp,'team_dc_city','team_dc_athletic',1,(current_date-14),'20:00','completed',2,2),
   ('dc000000-0000-4000-8000-0000000000f3', v_comp,'team_dc_fc','team_dc_city',2,(current_date-7),'20:00','completed',2,0),
   ('dc000000-0000-4000-8000-0000000000f4', v_comp,'team_dc_rovers','team_dc_athletic',2,(current_date-7),'20:00','completed',1,4),
   ('dc000000-0000-4000-8000-0000000000f5', v_comp,'team_dc_fc','team_dc_athletic',3,(current_date+7),'20:00','scheduled',null,null),
   ('dc000000-0000-4000-8000-0000000000f6', v_comp,'team_dc_rovers','team_dc_city',3,(current_date+7),'20:00','scheduled',null,null);

  -- Goal events on FC's completed fixtures (for top scorers + fixture detail).
  INSERT INTO match_events (client_event_id, fixture_id, team_id, player_id, event_type, minute, period, recorded_by_token, recorded_by_type, local_timestamp) VALUES
   (gen_random_uuid(),'dc000000-0000-4000-8000-0000000000f1','team_dc_fc','p_dc_tarny','goal',12,'1H','seed_democomp','system',v_now),
   (gen_random_uuid(),'dc000000-0000-4000-8000-0000000000f1','team_dc_fc','p_dc_fc1','goal',34,'1H','seed_democomp','system',v_now),
   (gen_random_uuid(),'dc000000-0000-4000-8000-0000000000f1','team_dc_fc','p_dc_tarny','goal',58,'2H','seed_democomp','system',v_now),
   (gen_random_uuid(),'dc000000-0000-4000-8000-0000000000f1','team_dc_rovers','p_dc_rov1','goal',70,'2H','seed_democomp','system',v_now),
   (gen_random_uuid(),'dc000000-0000-4000-8000-0000000000f3','team_dc_fc','p_dc_tarny','goal',22,'1H','seed_democomp','system',v_now),
   (gen_random_uuid(),'dc000000-0000-4000-8000-0000000000f3','team_dc_fc','p_dc_fc2','goal',49,'2H','seed_democomp','system',v_now);

  RAISE NOTICE 'democomp competitive testbed seeded — Competitive FC, Tarny admin, player token p_dc_tarny_token';
END;
$seed$;
