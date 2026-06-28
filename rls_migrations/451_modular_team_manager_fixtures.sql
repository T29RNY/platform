-- 451: Modular Platform Epic C — C3 Part 1 (team-manager "Fixtures & availability").
-- Stands up the FIRST real screen of the /hub team_manager track (its `league` tab).
--
-- New READER RPC `club_manager_list_team_fixtures()` — param-less, derives every
-- active-managed team server-side from auth.uid (no client trust), exactly mirroring
-- get_my_world()'s `coaching` derivation. For each team it returns upcoming (scheduled,
-- today-onward) + recent (completed, last 6) club_fixtures; each upcoming fixture
-- carries the availability roster + counts (in/out/maybe/pending). Source-agnostic:
-- FA-imported auto-opened fixtures (source='fa_import', club_team_id set) appear with
-- zero further change = the C3 payoff.
--
-- Auth: clones the mig-446 club-manager preamble (auth.uid -> member_profiles ->
-- club_team_managers JOIN club_teams, is_active). NO _club_feature_enabled gate —
-- this is the internal availability engine (cf. guardian_list_child_fixtures, mig 426,
-- which has no gate), NOT the public_web module. NO audit (read-only). SECDEF,
-- search_path pinned, single overload, anon REVOKEd, authenticated only.
--
-- Consumers (Hard Rule #14): apps/inorout TeamManagerLeague.jsx (/hub league tab).

CREATE OR REPLACE FUNCTION public.club_manager_list_team_fixtures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_teams   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'team_id',   ct.id,
      'team_name', ct.name,
      'club_id',   ct.club_id,
      'upcoming',  up.upcoming,
      'recent',    rc.recent
    ) ORDER BY ct.name
  ), '[]'::jsonb)
  INTO v_teams
  FROM club_team_managers ctm
  JOIN club_teams ct ON ct.id = ctm.team_id
  CROSS JOIN LATERAL (
    -- Upcoming: scheduled, today-onward (or undated), each with the availability
    -- roster + counts. Pending = an active roster member with no row (or status 'pending').
    SELECT COALESCE(jsonb_agg(fx ORDER BY (fx->>'scheduled_date') NULLS LAST, (fx->>'kickoff_time')), '[]'::jsonb) AS upcoming
    FROM (
      SELECT jsonb_build_object(
        'fixture_id',     cf.id,
        'opponent_name',  cf.opponent_name,
        'is_home',        cf.is_home,
        'scheduled_date', cf.scheduled_date,
        'kickoff_time',   to_char(cf.kickoff_time, 'HH24:MI'),
        'league_name',    cl.name,
        'pitch_name',     pa.name,
        'venue_name',     v.name,
        'ref_name',       COALESCE(mo.name, cf.ref_name),
        'notes',          cf.notes,
        'source',         cf.source,
        'status',         cf.status,
        'counts',         av.counts,
        'roster',         av.roster
      ) AS fx
      FROM club_fixtures cf
      LEFT JOIN club_leagues    cl ON cl.id = cf.league_id
      LEFT JOIN playing_areas   pa ON pa.id = cf.playing_area_id
      LEFT JOIN venues          v  ON v.id  = pa.venue_id
      LEFT JOIN match_officials mo ON mo.id = cf.official_id
      CROSS JOIN LATERAL (
        SELECT
          jsonb_build_object(
            'in',      count(*) FILTER (WHERE st = 'in'),
            'out',     count(*) FILTER (WHERE st = 'out'),
            'maybe',   count(*) FILTER (WHERE st = 'maybe'),
            'pending', count(*) FILTER (WHERE st = 'pending'),
            'total',   count(*)
          ) AS counts,
          COALESCE(jsonb_agg(jsonb_build_object('name', nm, 'status', st) ORDER BY nm), '[]'::jsonb) AS roster
        FROM (
          SELECT btrim(concat_ws(' ', mp.first_name, mp.last_name)) AS nm,
                 COALESCE(a.status, 'pending') AS st
          FROM club_team_members m
          JOIN member_profiles mp ON mp.id = m.member_profile_id
          LEFT JOIN club_fixture_availability a
            ON a.fixture_id = cf.id AND a.member_profile_id = m.member_profile_id
          WHERE m.team_id = ct.id AND m.is_active = true
        ) r
      ) av
      WHERE cf.club_team_id = ct.id
        AND cf.status = 'scheduled'
        AND (cf.scheduled_date IS NULL OR cf.scheduled_date >= (now() AT TIME ZONE 'Europe/London')::date)
    ) up_inner
  ) up
  CROSS JOIN LATERAL (
    -- Recent: completed fixtures (scores), most recent 6.
    SELECT COALESCE(jsonb_agg(fx ORDER BY (fx->>'scheduled_date') DESC), '[]'::jsonb) AS recent
    FROM (
      SELECT jsonb_build_object(
        'fixture_id',     cf.id,
        'opponent_name',  cf.opponent_name,
        'is_home',        cf.is_home,
        'scheduled_date', cf.scheduled_date,
        'kickoff_time',   to_char(cf.kickoff_time, 'HH24:MI'),
        'home_score',     cf.home_score,
        'away_score',     cf.away_score,
        'league_name',    cl.name,
        'source',         cf.source,
        'status',         cf.status
      ) AS fx
      FROM club_fixtures cf
      LEFT JOIN club_leagues cl ON cl.id = cf.league_id
      WHERE cf.club_team_id = ct.id AND cf.status = 'completed'
      ORDER BY cf.scheduled_date DESC NULLS LAST
      LIMIT 6
    ) rec_inner
  ) rc
  WHERE ctm.member_profile_id = v_profile
    AND ctm.is_active = true;

  -- Not an active manager of any team → reject (mirrors the mig-446 not_authorised gate).
  IF v_teams = '[]'::jsonb THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_manager_list_team_fixtures() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_list_team_fixtures() TO authenticated;

-- ─── Demo seed: enrich the demo manager's view (Alex Demo → First Team) ───────────
-- tarny+demo@lettrack.co.uk manages First Team (c0000000-…0001) in club_demo. That
-- team had one junk dateless 'Test' fixture and zero availability — too thin to demo
-- the C3 payoff. Curate it into a real upcoming fixture with a full availability
-- spread (2 in / 1 out / 1 maybe / 1 pending), and add one all-pending upcoming + one
-- completed result. League = U12 Saturday League (d0000000-…394, the only club_demo
-- league). Demo data only; idempotent.

UPDATE club_fixtures
SET opponent_name = 'Northwood United',
    scheduled_date = '2026-07-05',
    kickoff_time   = '14:00',
    updated_at     = now()
WHERE id = 'a88a9397-aff7-42ac-8928-4a2d2d5654f2';

INSERT INTO club_fixture_availability (id, fixture_id, member_profile_id, rsvp_by_profile_id, status)
VALUES
  ('ca000000-0000-4000-8000-000000000401','a88a9397-aff7-42ac-8928-4a2d2d5654f2','0d000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000001','in'),     -- Sarah Mitchell
  ('ca000000-0000-4000-8000-000000000402','a88a9397-aff7-42ac-8928-4a2d2d5654f2','0d000000-0000-4000-8000-000000000004','0d000000-0000-4000-8000-000000000004','in'),     -- Tom Whitfield
  ('ca000000-0000-4000-8000-000000000403','a88a9397-aff7-42ac-8928-4a2d2d5654f2','0d000000-0000-4000-8000-000000000008','0d000000-0000-4000-8000-000000000008','out'),    -- Marcus Reid
  ('ca000000-0000-4000-8000-000000000404','a88a9397-aff7-42ac-8928-4a2d2d5654f2','0d000000-0000-4000-8000-000000000007','0d000000-0000-4000-8000-000000000007','maybe')   -- Grace Adeyemi
ON CONFLICT (fixture_id, member_profile_id) DO NOTHING;
-- Daniel Okafor (0d…002) intentionally left with no row → pending.

INSERT INTO club_fixtures (id, league_id, club_team_id, opponent_name, is_home, scheduled_date, kickoff_time, status, source)
VALUES
  ('cf000000-0000-4000-8000-000000000401','d0000000-0000-4000-8000-000000000394','c0000000-0000-4000-8000-000000000001','Riverton Athletic', false, '2026-07-12','15:00','scheduled','manual'),
  ('cf000000-0000-4000-8000-000000000403','d0000000-0000-4000-8000-000000000394','c0000000-0000-4000-8000-000000000001','Eastvale FC',        true,  '2026-06-21','14:00','completed','manual')
ON CONFLICT (id) DO NOTHING;

UPDATE club_fixtures SET home_score = 3, away_score = 1, updated_at = now()
WHERE id = 'cf000000-0000-4000-8000-000000000403';
