-- 608_pitchbox_arena_demo_seed.sql
--
-- Provisions the **Pitchbox Arena** demo — a VENUE-operator prospect (owner Joe).
-- Pitchbox maps to the Venue SKU: a physical venue with pitches + a venue_admins
-- OWNER login, NOT the facility-less coaching-club shape of PA/DF. See
-- project_pitchbox_arena_demo.md + PA_SPORTS_DEMO_HANDOFF.md §6 (reusable template).
--
-- What it seeds (all anchored to venue_id='pitchbox_arena', own id range):
--   • company_pitchbox + venue pitchbox_arena + 3 playing areas
--   • club_pitchbox (discipline='football') + club_venues link  -> disciplines=['football']
--     (the competition-organising entity, exactly as demo_venue has club_demo; keeps
--      the venue nav football-relevant and declutters PT/gym items)
--   • Joe's OWNER login: auth.users + auth.identities + venue_admins(role='owner')
--   • A LIVE Event OS tournament "Pitchbox Summer 6s" (6 teams / 2 groups, part-played
--     + live standings) with a public page at /tournament/pitchbox-summer-6s
--   • An ACTIVE internal league "Pitchbox Monday League" (6 teams; past results for a
--     standings table + 3 fixtures dated TODAY so the mig-607 "Enter result" button shows)
--   • ~14 confirmed pitch bookings across the next 2 weeks (pitch_bookings + the matching
--     pitch_occupancy rows the calendar actually renders from)
--   • Reception display wired (display_token default + display_pin; the active league
--     competition drives the live standings)
--
-- Feature flags: NONE are seeded. venue_features/club_features are default-ON / fail-open,
-- so Bookings + Competition + Tournaments are already enabled (mig 399). Linking a
-- football club makes disciplines=['football'] explicit.
--
-- Idempotent: bails at the top if pitchbox_arena already exists. Reversible via
-- 608_pitchbox_arena_demo_seed_down.sql (Hard Rule 11).
--
-- Login (demo): tarnysingh+pitchbox@gmail.com / PitchboxDemo1!  (password login = no OTP).
-- Re-point to Joe's real inbox at handover with a mig-600-style UPDATE (email columns only).

DO $seed$
DECLARE
  v_joe   uuid := 'bbc00000-0000-4000-8000-000000000001';  -- fixed so re-point/teardown can target it
  v_email text := 'tarnysingh+pitchbox@gmail.com';
  v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_season uuid; v_lcomp uuid;
  v_tourn uuid; v_tcomp uuid;
  v_ta1 uuid; v_ta2 uuid; v_ta3 uuid; v_tb1 uuid; v_tb2 uuid; v_tb3 uuid;
  v_bk uuid; v_pa uuid; v_d date;
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.venues WHERE id = 'pitchbox_arena') THEN
    RAISE NOTICE 'Pitchbox Arena already seeded — skipping.';
    RETURN;
  END IF;

  -- 1. Operator + venue --------------------------------------------------------
  INSERT INTO public.companies (id, name, slug, sport, subscription_status, active, contact_email)
  VALUES ('company_pitchbox', 'Pitchbox Arena', 'pitchbox-arena', 'football', 'active', true, v_email);

  INSERT INTO public.venues (id, company_id, name, slug, sport, sports, bookings_enabled,
                             verification_status, origin, active, display_pin, display_config)
  VALUES ('pitchbox_arena', 'company_pitchbox', 'Pitchbox Arena', 'pitchbox-arena', 'football',
          ARRAY['football']::text[], true, 'verified', 'superadmin', true, '1234',
          '{"ad_rotation_seconds": 12, "sponsors": [], "tagline": "Football. Any day. Any time."}'::jsonb);

  -- 2. Pitches -----------------------------------------------------------------
  v_p1 := gen_random_uuid(); v_p2 := gen_random_uuid(); v_p3 := gen_random_uuid();
  INSERT INTO public.playing_areas (id, venue_id, name, surface, capacity, active, sort_order,
                                    default_fee_pence, booking_windows)
  VALUES
    (v_p1, 'pitchbox_arena', 'Main Arena (11-a-side)', '3g', 22, true, 1, 9000,
     '[{"day_of_week":0,"open_time":"08:00","close_time":"22:00","slot_lengths":[60,90]},
       {"day_of_week":1,"open_time":"08:00","close_time":"22:00","slot_lengths":[60,90]},
       {"day_of_week":2,"open_time":"08:00","close_time":"22:00","slot_lengths":[60,90]},
       {"day_of_week":3,"open_time":"08:00","close_time":"22:00","slot_lengths":[60,90]},
       {"day_of_week":4,"open_time":"08:00","close_time":"22:00","slot_lengths":[60,90]},
       {"day_of_week":5,"open_time":"08:00","close_time":"22:00","slot_lengths":[60,90]},
       {"day_of_week":6,"open_time":"08:00","close_time":"22:00","slot_lengths":[60,90]}]'::jsonb),
    (v_p2, 'pitchbox_arena', 'Pitch 2 (7-a-side)', '4g', 14, true, 2, 6500,
     '[{"day_of_week":0,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":1,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":2,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":3,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":4,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":5,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":6,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]}]'::jsonb),
    (v_p3, 'pitchbox_arena', 'Pitch 3 (5-a-side)', '4g', 10, true, 3, 5000,
     '[{"day_of_week":0,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":1,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":2,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":3,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":4,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":5,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]},
       {"day_of_week":6,"open_time":"08:00","close_time":"22:00","slot_lengths":[60]}]'::jsonb);

  -- 3. Football club (disciplines) + link --------------------------------------
  INSERT INTO public.clubs (id, name, short_name, discipline)
  VALUES ('club_pitchbox', 'Pitchbox Arena', 'PBX', 'football');
  INSERT INTO public.club_venues (club_id, venue_id) VALUES ('club_pitchbox', 'pitchbox_arena');

  -- 4. Owner login (Joe) -------------------------------------------------------
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_joe, 'authenticated', 'authenticated',
    v_email, crypt('PitchboxDemo1!', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name','Joe','email',v_email,'email_verified',true),
    now(), now(), '', '', '', '', '', '', '', ''
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
                               last_sign_in_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_joe, v_joe::text, 'email',
    jsonb_build_object('sub', v_joe::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  ) ON CONFLICT DO NOTHING;

  INSERT INTO public.venue_admins (id, venue_id, user_id, email, role, status)
  VALUES (gen_random_uuid(), 'pitchbox_arena', v_joe, v_email, 'owner', 'active');

  -- 5. Internal league (System A: teams -> fixtures) ---------------------------
  INSERT INTO public.teams (id, name, admin_token, team_type, primary_colour, secondary_colour) VALUES
    ('team_pbx_rvr','Riverside Rangers','tk_pbx_rvr','casual','#1F6FEB','#0B1F3A'),
    ('team_pbx_atl','Athletico Latte','tk_pbx_atl','casual','#8B5E3C','#F2E6D8'),
    ('team_pbx_ram','Real Ale Madrid','tk_pbx_ram','casual','#C0392B','#F5F5F5'),
    ('team_pbx_int','Inter Milano''s','tk_pbx_int','casual','#1B1B1B','#2E86DE'),
    ('team_pbx_ctb','Cross Town Blazers','tk_pbx_ctb','casual','#E67E22','#2C3E50'),
    ('team_pbx_dwd','Deportivo Wanderers','tk_pbx_dwd','casual','#27AE60','#145A32');

  INSERT INTO public.leagues (id, venue_id, name, short_name, sport, format, day_of_week,
                              default_kickoff_time, default_playing_area_id, active, standings_visibility)
  VALUES ('league_pitchbox', 'pitchbox_arena', 'Pitchbox Monday League', 'PML', 'football',
          '7-a-side', 1, '19:00', v_p1, true, 'public');

  INSERT INTO public.league_config (league_id, sport, format, match_duration_mins, slot_minutes,
                                    points_win, points_draw, points_loss)
  VALUES ('league_pitchbox', 'football', '7-a-side', 60, 60, 3, 1, 0);

  v_season := gen_random_uuid();
  INSERT INTO public.seasons (id, league_id, name, start_date, end_date, num_weeks, status)
  VALUES (v_season, 'league_pitchbox', 'Autumn 2026', CURRENT_DATE - 28, CURRENT_DATE + 56, 8, 'active');

  v_lcomp := gen_random_uuid();
  INSERT INTO public.competitions (id, season_id, name, type, format, status)
  VALUES (v_lcomp, v_season, 'Autumn 2026 Division', 'league', 'round_robin', 'active');

  INSERT INTO public.competition_teams (competition_id, team_id, status)
  SELECT v_lcomp, t, 'active' FROM unnest(ARRAY[
    'team_pbx_rvr','team_pbx_atl','team_pbx_ram','team_pbx_int','team_pbx_ctb','team_pbx_dwd']) t;

  -- League fixtures: 9 completed (results/form) + 3 TODAY (scheduled -> "Enter result"
  -- in the "Tonight" bucket) + 2 next-week (upcoming). Occupancy auto-syncs on pitches.
  FOR r IN SELECT * FROM (VALUES
      ('team_pbx_rvr','team_pbx_atl',1,-21,'19:00'::time,1,3,1,'completed'),
      ('team_pbx_ram','team_pbx_int',1,-21,'20:00'::time,1,2,2,'completed'),
      ('team_pbx_ctb','team_pbx_dwd',1,-21,'19:00'::time,2,0,1,'completed'),
      ('team_pbx_rvr','team_pbx_ram',2,-14,'19:00'::time,1,2,0,'completed'),
      ('team_pbx_atl','team_pbx_ctb',2,-14,'20:00'::time,1,1,1,'completed'),
      ('team_pbx_int','team_pbx_dwd',2,-14,'19:00'::time,2,3,2,'completed'),
      ('team_pbx_rvr','team_pbx_int',3, -7,'19:00'::time,1,1,0,'completed'),
      ('team_pbx_atl','team_pbx_dwd',3, -7,'20:00'::time,1,2,1,'completed'),
      ('team_pbx_ram','team_pbx_ctb',3, -7,'19:00'::time,2,2,2,'completed'),
      ('team_pbx_rvr','team_pbx_ctb',4,  0,'19:00'::time,1,0,0,'scheduled'),
      ('team_pbx_atl','team_pbx_int',4,  0,'20:00'::time,1,0,0,'scheduled'),
      ('team_pbx_ram','team_pbx_dwd',4,  0,'19:00'::time,2,0,0,'scheduled'),
      ('team_pbx_ctb','team_pbx_rvr',5,  7,'19:00'::time,1,0,0,'scheduled'),
      ('team_pbx_dwd','team_pbx_atl',5,  7,'20:00'::time,1,0,0,'scheduled')
    ) AS t(h,a,wk,off,tm,pitch,hs,ascore,st)
  LOOP
    v_pa := CASE r.pitch WHEN 1 THEN v_p1 WHEN 2 THEN v_p2 ELSE v_p3 END;
    INSERT INTO public.fixtures (competition_id, home_team_id, away_team_id, week_number,
                                 scheduled_date, kickoff_time, playing_area_id, slot_minutes,
                                 status, home_score, away_score)
    VALUES (v_lcomp, r.h, r.a, r.wk, CURRENT_DATE + r.off, r.tm, v_pa, 60, r.st,
            CASE WHEN r.st = 'completed' THEN r.hs END,
            CASE WHEN r.st = 'completed' THEN r.ascore END);
  END LOOP;

  -- 6. LIVE Event OS tournament (System B: competition_teams -> fixtures) -------
  v_tourn := gen_random_uuid();
  INSERT INTO public.tournament_events (id, venue_id, club_id, name, slug, event_date, status,
                                        entry_fee_pence, entry_fee_payer, sport, origin, track_stats,
                                        branding, info)
  VALUES (v_tourn, 'pitchbox_arena', 'club_pitchbox', 'Pitchbox Summer 6s', 'pitchbox-summer-6s',
          CURRENT_DATE, 'live', 3000, 'per_team', 'football', 'operator', true,
          '{"primary_colour":"#1FA67A"}'::jsonb,
          jsonb_build_object(
            'tagline','Six-a-side. One day. Bragging rights all year.',
            'whats_on','Groups from 10:00 · Cup & Plate knockouts from 13:00 · Final 15:30. Bar & BBQ all day.',
            'parking','Free on-site parking off the main entrance. Overflow on the retail park, 4 min walk.',
            'prices','£30 per team. Free entry for spectators.',
            'rules','6-a-side, rolling subs, 10-min games in the group stage. Full rules at the tournament desk.',
            'contact','Tournament desk at reception, or call the arena on the day.'));

  v_tcomp := gen_random_uuid();
  INSERT INTO public.competitions (id, tournament_event_id, name, type, format, status, config)
  VALUES (v_tcomp, v_tourn, 'Group Stage', 'cup', 'group_stage', 'active',
          '{"num_groups": 2, "qualifiers_per_group": 2, "knockout_seeded": true}'::jsonb);

  v_ta1 := gen_random_uuid(); v_ta2 := gen_random_uuid(); v_ta3 := gen_random_uuid();
  v_tb1 := gen_random_uuid(); v_tb2 := gen_random_uuid(); v_tb3 := gen_random_uuid();
  INSERT INTO public.competition_teams (id, competition_id, team_name, status, group_label, seed) VALUES
    (v_ta1, v_tcomp, 'Baller FC',        'active', 'A', 1),
    (v_ta2, v_tcomp, 'Route One Rovers', 'active', 'A', 2),
    (v_ta3, v_tcomp, 'The Substitutes',  'active', 'A', 3),
    (v_tb1, v_tcomp, 'Net Reapers',      'active', 'B', 1),
    (v_tb2, v_tcomp, 'Toe Punt United',  'active', 'B', 2),
    (v_tb3, v_tcomp, 'Sunday Fundays',   'active', 'B', 3);

  -- Group fixtures: 4 completed (live standings) + 2 still to play. No pitch assigned
  -- (playing_area_id NULL) so the occupancy trigger stays out of it — zero clash risk.
  FOR r IN SELECT * FROM (VALUES
      (1,2,'A','10:00'::time,'completed',2,1),
      (1,3,'A','11:00'::time,'completed',3,0),
      (2,3,'A','12:00'::time,'scheduled',0,0),
      (4,5,'B','10:30'::time,'completed',1,1),
      (4,6,'B','11:30'::time,'completed',2,0),
      (5,6,'B','12:30'::time,'scheduled',0,0)
    ) AS t(hsel,asel,grp,tm,st,hs,ascore)
  LOOP
    INSERT INTO public.fixtures (competition_id, home_competition_team_id, away_competition_team_id,
                                 week_number, group_label, round_name, scheduled_date, kickoff_time,
                                 slot_minutes, status, home_score, away_score)
    VALUES (v_tcomp,
            CASE r.hsel WHEN 1 THEN v_ta1 WHEN 2 THEN v_ta2 WHEN 3 THEN v_ta3
                        WHEN 4 THEN v_tb1 WHEN 5 THEN v_tb2 ELSE v_tb3 END,
            CASE r.asel WHEN 1 THEN v_ta1 WHEN 2 THEN v_ta2 WHEN 3 THEN v_ta3
                        WHEN 4 THEN v_tb1 WHEN 5 THEN v_tb2 ELSE v_tb3 END,
            1, r.grp, 'Group ' || r.grp, CURRENT_DATE, r.tm, 30, r.st,
            CASE WHEN r.st = 'completed' THEN r.hs END,
            CASE WHEN r.st = 'completed' THEN r.ascore END);
  END LOOP;

  -- 7. Bookings calendar (pitch_bookings + the pitch_occupancy rows it renders from) --
  -- Spread over the next 2 weeks. Kept clear of the league's occupied slots
  -- (P1 today 19:00-21:00, P2 today 19:00-20:00, P1 +7d 19:00-21:00).
  FOR r IN SELECT * FROM (VALUES
      (3, 0,'10:00'::time, 90,'adhoc','Kids Birthday Party — 5s',   4500),
      (2, 0,'14:00'::time, 60,'adhoc','Red Lion FC — friendly',     6500),
      (1, 1,'10:00'::time, 90,'block','Deloitte Corporate 7s',      9000),
      (2, 1,'18:00'::time, 60,'block','Walking Football',           4000),
      (2, 2,'19:00'::time, 60,'block','The Griffins — 7s',          6500),
      (3, 2,'20:00'::time, 60,'adhoc','Thursday 5s Casuals',        5000),
      (1, 3,'20:00'::time, 60,'block','Athletico — training',       9000),
      (2, 4,'18:00'::time, 60,'block','Junior Academy',             5500),
      (3, 5,'19:00'::time, 60,'block','Ladies 5s',                  5000),
      (1, 6,'11:00'::time, 90,'block','Saturday Junior Football',   8000),
      (2, 7,'18:00'::time, 60,'block','Walking Football',           4000),
      (3, 8,'19:00'::time, 60,'adhoc','Monday 5s Casuals',          5000),
      (2,10,'20:00'::time, 60,'block','KPMG Corporate 5s',          6500),
      (1,12,'19:00'::time, 60,'block','Wanderers — 7s',             9000)
    ) AS t(pitch,off,tm,slot,knd,nm,amt)
  LOOP
    v_pa := CASE r.pitch WHEN 1 THEN v_p1 WHEN 2 THEN v_p2 ELSE v_p3 END;
    v_d  := CURRENT_DATE + r.off;
    INSERT INTO public.pitch_bookings (venue_id, playing_area_id, booking_date, kickoff_time,
                                       slot_minutes, kind, status, booked_by_name, amount_pence, payment_status)
    VALUES ('pitchbox_arena', v_pa, v_d, r.tm, r.slot, r.knd, 'confirmed', r.nm, r.amt, 'not_required')
    RETURNING id INTO v_bk;

    INSERT INTO public.pitch_occupancy (playing_area_id, venue_id, time_range, source_kind, source_id, priority, active)
    VALUES (v_pa, 'pitchbox_arena',
            tstzrange((v_d + r.tm) AT TIME ZONE 'Europe/London',
                      (v_d + r.tm + make_interval(mins => r.slot)) AT TIME ZONE 'Europe/London', '[)'),
            'booking', v_bk::text, CASE r.knd WHEN 'block' THEN 2 ELSE 3 END, true);
  END LOOP;

  RAISE NOTICE 'Pitchbox Arena demo seeded: venue=pitchbox_arena, owner=%, league=league_pitchbox, tournament=pitchbox-summer-6s', v_email;
END
$seed$;
