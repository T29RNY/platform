-- 477: DEMO SEED — match-fitness data for team_demo so the Match Fitness surfaces light up.
--
-- Purpose: let the operator sign in as Alex Demo and SEE the shipped surfaces live (StatsView own
-- stats + trend, squad board, Head-to-Head compare). Everything gates on has-data, so without seeded
-- match_health_sessions the surfaces self-hide. NOT a schema/RPC change — pure demo data on team_demo.
--
-- What it does (idempotent — safe to re-run; ON CONFLICT DO NOTHING / UPDATE):
--   • Creates 5 lightweight auth.users to BACK 5 existing token-only team_demo players (health rows
--     FK to auth.users; the readers need auth.uid()). These accounts never sign in — they only give
--     the demo squad enough sharing watch-users to clear the squad board's min-N floor.
--   • Links those 5 players to their new auth ids + sets share_match_fitness=true on them + Alex + Sam.
--   • Adds 2 casual matches (mf_demo_1 last month, mf_demo_2 this month) on team_demo + player_match
--     co-participation (so H2H shared-games exist and the board scopes to this squad).
--   • Seeds match_health_sessions across the two months (Alex trends fitter; Dave is top distance;
--     Callum consents but has no watch → the board's "Add an Apple Watch to join" invite row; Chris
--     stays token-only + non-consenting → the H2H "not sharing" state). One route for Alex.
--
-- Revert: 477_..._down.sql removes every seeded row and the 5 auth users, and resets consent.
-- Teardown-safe: touches only mf_demo_* / cs_mf_* rows and the named demo players.

DO $seed$
DECLARE
  v_dave   uuid := 'd0d00000-0000-4000-8000-000000000002';
  v_mike   uuid := 'd0d00000-0000-4000-8000-000000000003';
  v_steve  uuid := 'd0d00000-0000-4000-8000-000000000004';
  v_liam   uuid := 'd0d00000-0000-4000-8000-000000000006';
  v_callum uuid := 'd0d00000-0000-4000-8000-000000000007';
  v_alex   uuid := (SELECT user_id FROM players WHERE id = 'p_demo_alex');
  v_sam    uuid := (SELECT user_id FROM players WHERE id = 'p_demo_sam');
  v_monA   timestamptz := date_trunc('month', now()) - interval '1 month' + interval '9 days';
  v_monB   timestamptz := date_trunc('month', now()) + interval '2 days';
BEGIN
  -- 1. backing auth.users (id only — never sign in; FK target)
  INSERT INTO auth.users (id) VALUES (v_dave),(v_mike),(v_steve),(v_liam),(v_callum)
  ON CONFLICT (id) DO NOTHING;

  -- 2. link players + consent
  UPDATE players SET user_id = v_dave   WHERE id = 'p_demo_02';
  UPDATE players SET user_id = v_mike   WHERE id = 'p_demo_03';
  UPDATE players SET user_id = v_steve  WHERE id = 'p_demo_04';
  UPDATE players SET user_id = v_liam   WHERE id = 'p_demo_06';
  UPDATE players SET user_id = v_callum WHERE id = 'p_demo_07';
  UPDATE players SET share_match_fitness = true
   WHERE id IN ('p_demo_02','p_demo_03','p_demo_04','p_demo_06','p_demo_07','p_demo_alex','p_demo_sam');

  -- 3. casual matches (team_demo)
  INSERT INTO matches (id, team_id, match_date) VALUES
    ('mf_demo_1','team_demo', (v_monA)::date),
    ('mf_demo_2','team_demo', (v_monB)::date)
  ON CONFLICT (id) DO NOTHING;

  -- 4. co-participation (Chris on mf_demo_1 only → H2H "not sharing")
  INSERT INTO player_match (team_id, player_id, match_id) VALUES
    ('team_demo','p_demo_alex','mf_demo_1'),('team_demo','p_demo_alex','mf_demo_2'),
    ('team_demo','p_demo_sam','mf_demo_1'), ('team_demo','p_demo_sam','mf_demo_2'),
    ('team_demo','p_demo_02','mf_demo_1'),  ('team_demo','p_demo_02','mf_demo_2'),
    ('team_demo','p_demo_03','mf_demo_1'),  ('team_demo','p_demo_03','mf_demo_2'),
    ('team_demo','p_demo_04','mf_demo_1'),  ('team_demo','p_demo_04','mf_demo_2'),
    ('team_demo','p_demo_06','mf_demo_1'),  ('team_demo','p_demo_06','mf_demo_2'),
    ('team_demo','p_demo_08','mf_demo_1')
  ON CONFLICT (match_id, player_id) DO NOTHING;

  -- 5. fitness sessions (metres; client formats to miles). Alex: HR 156→146 = fitter trend.
  INSERT INTO match_health_sessions
    (user_id, match_context, match_ref, client_session_id, distance_meters, active_energy_kcal, avg_hr, max_hr, source, started_at, ended_at) VALUES
    (v_alex, 'casual','mf_demo_1','cs_mf_alex_1', 6000,520,156,176,'watch_app',          v_monA, v_monA+interval '1 hour'),
    (v_alex, 'casual','mf_demo_2','cs_mf_alex_2', 6400,540,146,170,'apple_health_manual', v_monB, v_monB+interval '1 hour'),
    (v_sam,  'casual','mf_demo_1','cs_mf_sam_1',  5800,500,152,172,'watch_app',           v_monA, v_monA+interval '1 hour'),
    (v_sam,  'casual','mf_demo_2','cs_mf_sam_2',  6000,510,148,168,'watch_app',           v_monB, v_monB+interval '1 hour'),
    (v_dave, 'casual','mf_demo_1','cs_mf_dave_1', 6800,600,158,178,'watch_app',           v_monA, v_monA+interval '1 hour'),
    (v_dave, 'casual','mf_demo_2','cs_mf_dave_2', 7100,620,150,172,'watch_app',           v_monB, v_monB+interval '1 hour'),
    (v_mike, 'casual','mf_demo_1','cs_mf_mike_1', 5600,470,146,166,'watch_app',           v_monA, v_monA+interval '1 hour'),
    (v_mike, 'casual','mf_demo_2','cs_mf_mike_2', 5900,490,144,164,'apple_health_manual', v_monB, v_monB+interval '1 hour'),
    (v_steve,'casual','mf_demo_1','cs_mf_steve_1',4800,430,162,180,'watch_app',           v_monA, v_monA+interval '1 hour'),
    (v_steve,'casual','mf_demo_2','cs_mf_steve_2',5000,445,159,178,'watch_app',           v_monB, v_monB+interval '1 hour'),
    (v_liam, 'casual','mf_demo_1','cs_mf_liam_1', 3400,360,169,185,NULL,                  v_monA, v_monA+interval '1 hour'),
    (v_liam, 'casual','mf_demo_2','cs_mf_liam_2', 3600,375,167,183,'watch_app',           v_monB, v_monB+interval '1 hour')
  ON CONFLICT (user_id, client_session_id) DO NOTHING;

  -- 6. one route for Alex's latest session ("View route" + detach-cascade demo)
  INSERT INTO match_health_routes (session_id, track)
  SELECT id, '{"points":[[51.5,-0.12],[51.5008,-0.1212],[51.5012,-0.1198]]}'::jsonb
    FROM match_health_sessions WHERE client_session_id = 'cs_mf_alex_2'
  ON CONFLICT (session_id) DO NOTHING;
END $seed$;

SELECT pg_notify('pgrst', 'reload schema');
