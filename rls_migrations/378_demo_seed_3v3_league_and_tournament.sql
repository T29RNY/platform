-- 378_demo_seed_3v3_league_and_tournament.sql
-- PILOT DEMO SEED (session 172, 2026-06-22). DATA ONLY — no DDL, no RPC changes.
--
-- Seeds, idempotently, three demo surfaces anchored to the existing demo_venue /
-- club_demo (Finbar's FC), so the pilot demo shows tournaments + 3v3 end-to-end:
--
--   A) A 3v3 LEAGUE on demo_venue (league/season/competition/teams/players/fixtures/
--      match_events) with LIVE + completed + upcoming fixtures, so the reception TV
--      (display.in-or-out.com, venue token demo_venue_display_token, get_display_state)
--      shows live 3v3 scores, a table, top scorers, recent results and a goals ticker.
--
--   B) A complete Event OS TOURNAMENT (tournament_events + group stage + knockout) under
--      club_demo, status='live', with played group fixtures, two completed semis and one
--      LIVE final — so the public bracket page (/tournament/finbars-summer-cup,
--      get_tournament_public) is fully populated (groups w/ ADV, knockout stage, live final).
--
--   C) Grants demo Alex (member_profile 0d…0011) club-manager of club_demo "First Team"
--      and an active club_demo membership, so the consumer-app "Tournaments" tab
--      (SessionsScreen / club_admin_list_tournaments) is demo-able.
--
-- Idempotent: a leading cleanup block removes everything this migration owns (by stable
-- id) before re-inserting, so it is safe to re-run. Dates are computed relative to the
-- apply day (Europe/London), so live/today fixtures are correct whenever it is applied.
--
-- Teardown: 378_demo_seed_3v3_league_and_tournament_down.sql
-- Verify surfaces:
--   select get_display_state('demo_venue_display_token');
--   select get_tournament_public('finbars-summer-cup');

DO $$
DECLARE
  -- stable ids ---------------------------------------------------------------
  k_league       text := 'demo_league_3v3';
  k_season       uuid := '3a3a0000-0000-4000-8000-000000000001';
  k_comp         uuid := '3a3a0000-0000-4000-8000-000000000010';   -- 3v3 league competition
  k_tour         uuid := '70000000-0000-4000-8000-000000000001';   -- tournament_events
  k_grp          uuid := '70000000-0000-4000-8000-000000000010';   -- tournament group-stage competition
  k_ko           uuid := '70000000-0000-4000-8000-000000000020';   -- tournament knockout competition
  k_mgr          uuid := 'aa3a0000-0000-4000-8000-000000000001';   -- Alex club_team_managers row
  k_member       uuid := 'ab000000-0000-4000-8000-000000000012';   -- Alex club_demo membership

  v_today        date := (now() AT TIME ZONE 'Europe/London')::date;
  v_week1        date := (now() AT TIME ZONE 'Europe/London')::date - 7;

  -- 3v3 team ids
  t_jag text := 'team_3v3_jag'; t_pum text := 'team_3v3_pum'; t_cob text := 'team_3v3_cob';
  t_haw text := 'team_3v3_haw'; t_bol text := 'team_3v3_bol'; t_sha text := 'team_3v3_sha';

  -- 3v3 fixture ids
  f1 uuid := '3a3a0000-0000-4000-8000-000000000201';
  f2 uuid := '3a3a0000-0000-4000-8000-000000000202';
  f3 uuid := '3a3a0000-0000-4000-8000-000000000203';
  f4 uuid := '3a3a0000-0000-4000-8000-000000000204';  -- LIVE
  f5 uuid := '3a3a0000-0000-4000-8000-000000000205';  -- LIVE
  f6 uuid := '3a3a0000-0000-4000-8000-000000000206';  -- completed today
  f7 uuid := '3a3a0000-0000-4000-8000-000000000207';  -- upcoming
  f8 uuid := '3a3a0000-0000-4000-8000-000000000208';  -- upcoming
  f9 uuid := '3a3a0000-0000-4000-8000-000000000209';  -- upcoming

  -- tournament competition_team ids (group)
  g_red uuid := '70000000-0000-4000-8000-000000000101';  -- A1
  g_blu uuid := '70000000-0000-4000-8000-000000000102';  -- A2
  g_grn uuid := '70000000-0000-4000-8000-000000000103';  -- A3
  g_yel uuid := '70000000-0000-4000-8000-000000000104';  -- B1
  g_blk uuid := '70000000-0000-4000-8000-000000000105';  -- B2
  g_wht uuid := '70000000-0000-4000-8000-000000000106';  -- B3
  -- tournament competition_team ids (knockout — the four qualifiers)
  ko_red uuid := '70000000-0000-4000-8000-000000000201';
  ko_grn uuid := '70000000-0000-4000-8000-000000000202';
  ko_yel uuid := '70000000-0000-4000-8000-000000000203';
  ko_wht uuid := '70000000-0000-4000-8000-000000000204';
  -- tournament group fixtures
  gf1 uuid := '70000000-0000-4000-8000-000000000301';
  gf2 uuid := '70000000-0000-4000-8000-000000000302';
  gf3 uuid := '70000000-0000-4000-8000-000000000303';
  gf4 uuid := '70000000-0000-4000-8000-000000000304';
  gf5 uuid := '70000000-0000-4000-8000-000000000305';
  gf6 uuid := '70000000-0000-4000-8000-000000000306';
  -- tournament knockout fixtures
  sf1 uuid := '70000000-0000-4000-8000-000000000401';
  sf2 uuid := '70000000-0000-4000-8000-000000000402';
  fin uuid := '70000000-0000-4000-8000-000000000403';  -- LIVE final

  pa_main uuid := 'c0f26961-9dfc-41a1-8e53-9c774d9f1f81';  -- Main Pitch
  pa_side uuid := '5b866896-d907-4e6e-b1be-ec23ba7e57c8';  -- Side Pitch
BEGIN
  -- ========================================================================
  -- 0. IDEMPOTENT CLEANUP (children -> parents)
  -- ========================================================================
  DELETE FROM match_events WHERE fixture_id IN (
    SELECT id FROM fixtures WHERE competition_id IN (k_comp, k_grp, k_ko));
  DELETE FROM fixtures WHERE competition_id IN (k_comp, k_grp, k_ko);
  DELETE FROM competition_teams WHERE competition_id IN (k_comp, k_grp, k_ko);
  DELETE FROM competitions WHERE id IN (k_comp, k_grp, k_ko);
  DELETE FROM seasons WHERE id = k_season;
  DELETE FROM leagues WHERE id = k_league;
  DELETE FROM players WHERE team LIKE 'team_3v3_%';
  DELETE FROM teams WHERE id LIKE 'team_3v3_%';
  DELETE FROM tournament_events WHERE id = k_tour;
  DELETE FROM club_team_managers WHERE id = k_mgr;
  DELETE FROM venue_memberships WHERE id = k_member;

  -- ========================================================================
  -- A. 3v3 LEAGUE  (reception TV: live scores, table, scorers, ticker)
  -- ========================================================================
  INSERT INTO leagues (id, venue_id, name, short_name, sport, format, day_of_week,
                       default_kickoff_time, display_token, standings_visibility, active)
  VALUES (k_league, 'demo_venue', 'Demo 3v3 League', '3V3', 'football', '3v3', 1,
          '19:00', 'demo_3v3_display_token', 'public', true);

  INSERT INTO seasons (id, league_id, name, start_date, end_date, num_weeks, status)
  VALUES (k_season, k_league, '3v3 Series 2026', v_week1, v_today + 21, 4, 'active');

  INSERT INTO competitions (id, season_id, name, type, format, status, config)
  VALUES (k_comp, k_season, '3v3 Summer Series', 'league', 'round_robin', 'active', '{}'::jsonb);

  -- teams (with kit colours for the TV)
  INSERT INTO teams (id, name, admin_token, team_type, primary_colour, secondary_colour) VALUES
    (t_jag, '3v3 Jaguars', 'tk_3v3_jag', 'casual', '#E6A817', '#1A1A1A'),
    (t_pum, '3v3 Pumas',   'tk_3v3_pum', 'casual', '#2E86DE', '#FFFFFF'),
    (t_cob, '3v3 Cobras',  'tk_3v3_cob', 'casual', '#27AE60', '#0A0A0A'),
    (t_haw, '3v3 Hawks',   'tk_3v3_haw', 'casual', '#E74C3C', '#FFFFFF'),
    (t_bol, '3v3 Bolts',   'tk_3v3_bol', 'casual', '#9B59B6', '#FFD700'),
    (t_sha, '3v3 Sharks',  'tk_3v3_sha', 'casual', '#16A085', '#ECF0F1');

  -- players (3 per team)
  INSERT INTO players (id, name, type, notification_channel, admin_locked_in, pending_approval, team, status) VALUES
    ('p_3v3_jag_1','Marcus Bell','regular','push',false,false,t_jag,'active'),
    ('p_3v3_jag_2','Tariq Khan','regular','push',false,false,t_jag,'active'),
    ('p_3v3_jag_3','Danny Fox','regular','push',false,false,t_jag,'active'),
    ('p_3v3_pum_1','Ravi Shah','regular','push',false,false,t_pum,'active'),
    ('p_3v3_pum_2','Joe Mills','regular','push',false,false,t_pum,'active'),
    ('p_3v3_pum_3','Sam Reed','regular','push',false,false,t_pum,'active'),
    ('p_3v3_cob_1','Kofi Mensah','regular','push',false,false,t_cob,'active'),
    ('p_3v3_cob_2','Liam Doyle','regular','push',false,false,t_cob,'active'),
    ('p_3v3_cob_3','Niko Petrov','regular','push',false,false,t_cob,'active'),
    ('p_3v3_haw_1','Aaron Cole','regular','push',false,false,t_haw,'active'),
    ('p_3v3_haw_2','Ben Frost','regular','push',false,false,t_haw,'active'),
    ('p_3v3_haw_3','Carl Webb','regular','push',false,false,t_haw,'active'),
    ('p_3v3_bol_1','Dev Rana','regular','push',false,false,t_bol,'active'),
    ('p_3v3_bol_2','Eli Stone','regular','push',false,false,t_bol,'active'),
    ('p_3v3_bol_3','Finn Hart','regular','push',false,false,t_bol,'active'),
    ('p_3v3_sha_1','Gus Lane','regular','push',false,false,t_sha,'active'),
    ('p_3v3_sha_2','Hugo Marsh','regular','push',false,false,t_sha,'active'),
    ('p_3v3_sha_3','Ivan Roy','regular','push',false,false,t_sha,'active');

  -- competition_teams (register all 6)
  INSERT INTO competition_teams (id, competition_id, team_id, status) VALUES
    ('3a3a0000-0000-4000-8000-000000000101', k_comp, t_jag, 'active'),
    ('3a3a0000-0000-4000-8000-000000000102', k_comp, t_pum, 'active'),
    ('3a3a0000-0000-4000-8000-000000000103', k_comp, t_cob, 'active'),
    ('3a3a0000-0000-4000-8000-000000000104', k_comp, t_haw, 'active'),
    ('3a3a0000-0000-4000-8000-000000000105', k_comp, t_bol, 'active'),
    ('3a3a0000-0000-4000-8000-000000000106', k_comp, t_sha, 'active');

  -- fixtures: week 1 (completed), today (2 LIVE + 1 completed + 3 upcoming)
  INSERT INTO fixtures (id, competition_id, home_team_id, away_team_id, week_number, scheduled_date,
                        kickoff_time, playing_area_id, slot_minutes, status, home_score, away_score,
                        current_period, actual_kickoff_at, ref_token) VALUES
    (f1, k_comp, t_jag, t_pum, 1, v_week1, '19:00', pa_main, 20, 'completed', 3, 2, NULL, NULL, 'ref_3v3_w1_jagpum'),
    (f2, k_comp, t_cob, t_haw, 1, v_week1, '19:00', pa_side, 20, 'completed', 1, 1, NULL, NULL, 'ref_3v3_w1_cobhaw'),
    (f3, k_comp, t_bol, t_sha, 1, v_week1, '19:45', pa_main, 20, 'completed', 4, 1, NULL, NULL, 'ref_3v3_w1_bolsha'),
    (f4, k_comp, t_jag, t_cob, 2, v_today, '19:00', pa_main, 20, 'in_progress', NULL, NULL, '2H', now() - interval '28 minutes', 'ref_3v3_jag_cob'),
    (f5, k_comp, t_pum, t_haw, 2, v_today, '19:00', pa_side, 20, 'in_progress', NULL, NULL, '2H', now() - interval '20 minutes', 'ref_3v3_pum_haw'),
    (f6, k_comp, t_bol, t_sha, 2, v_today, '18:00', pa_main, 20, 'completed', 2, 0, NULL, now() - interval '75 minutes', 'ref_3v3_bol_sha'),
    (f7, k_comp, t_jag, t_sha, 3, v_today, '20:00', pa_main, 20, 'scheduled', NULL, NULL, NULL, NULL, 'ref_3v3_jag_sha'),
    (f8, k_comp, t_pum, t_cob, 3, v_today, '20:00', pa_side, 20, 'scheduled', NULL, NULL, NULL, NULL, 'ref_3v3_pum_cob'),
    (f9, k_comp, t_haw, t_bol, 3, v_today, '20:45', pa_main, 20, 'scheduled', NULL, NULL, NULL, NULL, 'ref_3v3_haw_bol');

  -- match_events (goals) — drive live scores, scorers, recent top-scorer, ticker
  INSERT INTO match_events (fixture_id, team_id, player_id, event_type, minute, period,
                            recorded_by_token, recorded_by_type, local_timestamp) VALUES
    -- f1 Jaguars 3-2 Pumas
    (f1, t_jag, 'p_3v3_jag_1', 'goal',  6, '1H', 'ref_3v3_w1_jagpum', 'referee', now()),
    (f1, t_jag, 'p_3v3_jag_1', 'goal', 14, '1H', 'ref_3v3_w1_jagpum', 'referee', now()),
    (f1, t_jag, 'p_3v3_jag_2', 'goal', 22, '2H', 'ref_3v3_w1_jagpum', 'referee', now()),
    (f1, t_pum, 'p_3v3_pum_1', 'goal', 11, '1H', 'ref_3v3_w1_jagpum', 'referee', now()),
    (f1, t_pum, 'p_3v3_pum_2', 'goal', 19, '2H', 'ref_3v3_w1_jagpum', 'referee', now()),
    -- f2 Cobras 1-1 Hawks
    (f2, t_cob, 'p_3v3_cob_1', 'goal',  9, '1H', 'ref_3v3_w1_cobhaw', 'referee', now()),
    (f2, t_haw, 'p_3v3_haw_1', 'goal', 17, '2H', 'ref_3v3_w1_cobhaw', 'referee', now()),
    -- f3 Bolts 4-1 Sharks
    (f3, t_bol, 'p_3v3_bol_1', 'goal',  5, '1H', 'ref_3v3_w1_bolsha', 'referee', now()),
    (f3, t_bol, 'p_3v3_bol_1', 'goal', 13, '1H', 'ref_3v3_w1_bolsha', 'referee', now()),
    (f3, t_bol, 'p_3v3_bol_2', 'goal', 20, '2H', 'ref_3v3_w1_bolsha', 'referee', now()),
    (f3, t_bol, 'p_3v3_bol_3', 'goal', 24, '2H', 'ref_3v3_w1_bolsha', 'referee', now()),
    (f3, t_sha, 'p_3v3_sha_1', 'goal', 16, '2H', 'ref_3v3_w1_bolsha', 'referee', now()),
    -- f6 Bolts 2-0 Sharks (today, completed)
    (f6, t_bol, 'p_3v3_bol_1', 'goal',  8, '1H', 'ref_3v3_bol_sha', 'referee', now()),
    (f6, t_bol, 'p_3v3_bol_2', 'goal', 21, '2H', 'ref_3v3_bol_sha', 'referee', now()),
    -- f4 LIVE Jaguars 2-1 Cobras
    (f4, t_jag, 'p_3v3_jag_1', 'goal',  7, '1H', 'ref_3v3_jag_cob', 'referee', now()),
    (f4, t_jag, 'p_3v3_jag_2', 'goal', 18, '2H', 'ref_3v3_jag_cob', 'referee', now()),
    (f4, t_cob, 'p_3v3_cob_1', 'goal', 12, '1H', 'ref_3v3_jag_cob', 'referee', now()),
    -- f5 LIVE Pumas 1-1 Hawks
    (f5, t_pum, 'p_3v3_pum_1', 'goal', 10, '1H', 'ref_3v3_pum_haw', 'referee', now()),
    (f5, t_haw, 'p_3v3_haw_2', 'goal', 23, '2H', 'ref_3v3_pum_haw', 'referee', now());

  -- ========================================================================
  -- B. EVENT OS TOURNAMENT  (public bracket page /tournament/finbars-summer-cup)
  -- ========================================================================
  INSERT INTO tournament_events (id, venue_id, club_id, name, slug, event_date, status,
                                 entry_fee_pence, entry_fee_payer, track_stats, branding, points_config)
  VALUES (k_tour, 'demo_venue', 'club_demo', 'Finbar''s FC Summer Cup', 'finbars-summer-cup',
          v_today, 'live', 0, 'per_team', true,
          '{"primary_colour":"#27AE60"}'::jsonb, '{}'::jsonb);

  -- group stage competition (2 groups of 3; top 2 advance)
  INSERT INTO competitions (id, tournament_event_id, name, type, format, status, config)
  VALUES (k_grp, k_tour, 'Group Stage', 'cup', 'group_stage', 'active',
          '{"num_groups":2,"qualifiers_per_group":2,"knockout_seeded":true}'::jsonb);

  -- knockout competition
  INSERT INTO competitions (id, tournament_event_id, name, type, format, status, config)
  VALUES (k_ko, k_tour, 'Knockout', 'cup', 'single_elimination', 'active', '{}'::jsonb);

  -- group competition_teams (group_label + final group_rank)
  INSERT INTO competition_teams (id, competition_id, team_name, status, group_label, seed, group_rank) VALUES
    (g_red, k_grp, 'Riverside Reds',  'active', 'A', 1, 1),
    (g_grn, k_grp, 'Garden Greens',   'active', 'A', 2, 2),
    (g_blu, k_grp, 'Bridge Blues',    'active', 'A', 3, 3),
    (g_yel, k_grp, 'Yard Yellows',    'active', 'B', 1, 1),
    (g_wht, k_grp, 'Wharf Whites',    'active', 'B', 2, 2),
    (g_blk, k_grp, 'Backstreet Blacks','active','B', 3, 3);

  -- knockout competition_teams (the 4 qualifiers)
  INSERT INTO competition_teams (id, competition_id, team_name, status, seed) VALUES
    (ko_red, k_ko, 'Riverside Reds', 'active', 1),
    (ko_grn, k_ko, 'Garden Greens',  'active', 4),
    (ko_yel, k_ko, 'Yard Yellows',   'active', 2),
    (ko_wht, k_ko, 'Wharf Whites',   'active', 3);

  -- group fixtures (all completed) — Group A. NB: tournament fixtures use a NULL
  -- playing_area_id — the pitch-occupancy trigger resolves venue only via the league
  -- path (season->league->venue), which is NULL for tournament competitions, so a set
  -- pitch would violate pitch_occupancy.venue_id NOT NULL. Pitch name is cosmetic here.
  INSERT INTO fixtures (id, competition_id, home_competition_team_id, away_competition_team_id,
                        week_number, round_name, scheduled_date, kickoff_time, playing_area_id, slot_minutes,
                        status, home_score, away_score) VALUES
    (gf1, k_grp, g_red, g_blu, 1, 'Group A', v_today, '10:00', NULL, 20, 'completed', 3, 1),
    (gf2, k_grp, g_red, g_grn, 2, 'Group A', v_today, '11:00', NULL, 20, 'completed', 2, 2),
    (gf3, k_grp, g_blu, g_grn, 3, 'Group A', v_today, '12:00', NULL, 20, 'completed', 0, 1),
    -- Group B
    (gf4, k_grp, g_yel, g_blk, 1, 'Group B', v_today, '10:00', NULL, 20, 'completed', 2, 0),
    (gf5, k_grp, g_yel, g_wht, 2, 'Group B', v_today, '11:00', NULL, 20, 'completed', 1, 1),
    (gf6, k_grp, g_blk, g_wht, 3, 'Group B', v_today, '12:00', NULL, 20, 'completed', 1, 2);

  -- knockout fixtures (feeders set so they surface in knockout_fixtures; NULL pitch — see above)
  INSERT INTO fixtures (id, competition_id, home_competition_team_id, away_competition_team_id,
                        week_number, round_name, scheduled_date, kickoff_time, playing_area_id, slot_minutes,
                        status, home_score, away_score, current_period,
                        knockout_home_feeder_id, knockout_away_feeder_id, actual_kickoff_at, ref_token) VALUES
    (sf1, k_ko, ko_red, ko_wht, 1, 'Semi-final', v_today, '14:00', NULL, 20, 'completed', 2, 1, NULL, gf1, gf5, NULL, 'ref_cup_sf1'),
    (sf2, k_ko, ko_yel, ko_grn, 1, 'Semi-final', v_today, '14:45', NULL, 20, 'completed', 0, 1, NULL, gf4, gf2, NULL, 'ref_cup_sf2'),
    (fin, k_ko, ko_red, ko_grn, 2, 'Final',      v_today, '16:00', NULL, 20, 'in_progress', 1, 1, '2H', sf1, sf2, now() - interval '15 minutes', 'ref_cup_final');

  -- ========================================================================
  -- C. ALEX: club_demo manager + active membership (consumer Tournaments tab)
  -- ========================================================================
  INSERT INTO club_team_managers (id, team_id, member_profile_id, role, is_active)
  VALUES (k_mgr, 'c0000000-0000-4000-8000-000000000001',
          '0d000000-0000-4000-8000-000000000011', 'manager', true);

  INSERT INTO venue_memberships (id, venue_id, club_id, tier_id, period, amount_pence, status,
                                 started_at, renews_at, pricing_model, member_profile_id)
  VALUES (k_member, 'demo_venue', 'club_demo', '0a000000-0000-4000-8000-000000000002',
          'monthly', 3000, 'active', v_today - 30, v_today + 30, 'term',
          '0d000000-0000-4000-8000-000000000011');
END $$;
