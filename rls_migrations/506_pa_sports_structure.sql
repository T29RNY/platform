-- =============================================================================
-- Migration 506: PA Sports demo — cohorts + teams + coaches/staff + DBS
-- =============================================================================
-- Depends on 505 (club_pa_sports must exist).
--   • 2 cohorts: U7s (youth), Mens (adult)
--   • 3 club_teams: U7 Dortmund, U7 Milan, PA Sports Mens
--   • 8 named staff/coach member_profiles (Pav + 7) — real people, first names only
--   • club_team_managers assignments (coaches/managers per team)
--   • enhanced DBS records for coaches + welfare officer
-- Deterministic ids: a5c0=cohorts, a510=teams, a504=staff profiles, a530=managers
-- Paired teardown: 506_pa_sports_structure_down.sql
-- =============================================================================

DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id='club_pa_sports') THEN
    RAISE EXCEPTION 'club_pa_sports not found — apply mig 505 first';
  END IF;
END $guard$;

-- ─── 1. Cohorts (age-group layer, youth vs adult) ────────────────────────────
INSERT INTO club_cohorts (id, club_id, name, description, min_age, max_age, active, category)
VALUES
  ('a5c00000-0000-4000-8000-000000000001', 'club_pa_sports', 'Under 7s', 'U7 age group', 6, 7, true, 'youth'),
  ('a5c00000-0000-4000-8000-000000000002', 'club_pa_sports', 'Mens', 'Adult mens', 16, NULL, true, 'adult')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Teams (nested in cohorts) ────────────────────────────────────────────
INSERT INTO club_teams (id, club_id, cohort_id, name, gender, priority_rank)
VALUES
  ('a5100000-0000-4000-8000-000000000001', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000001', 'U7 Dortmund', 'mixed', 1),
  ('a5100000-0000-4000-8000-000000000002', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000001', 'U7 Milan',    'mixed', 2),
  ('a5100000-0000-4000-8000-000000000003', 'club_pa_sports', 'a5c00000-0000-4000-8000-000000000002', 'PA Sports Mens', NULL, 1)
ON CONFLICT (id) DO NOTHING;

-- ─── 3. Named staff / coach profiles (real people — first names only) ─────────
INSERT INTO member_profiles (id, first_name, last_name)
VALUES
  ('a5040000-0000-4000-8000-000000000001', 'Pav',       'Somal'),
  ('a5040000-0000-4000-8000-000000000002', 'Ranvir',    NULL),
  ('a5040000-0000-4000-8000-000000000003', 'Iknam',     NULL),
  ('a5040000-0000-4000-8000-000000000004', 'Inderpal',  NULL),
  ('a5040000-0000-4000-8000-000000000005', 'Gurchetan', NULL),
  ('a5040000-0000-4000-8000-000000000006', 'Jas',       NULL),
  ('a5040000-0000-4000-8000-000000000007', 'Nihal',     NULL),
  ('a5040000-0000-4000-8000-000000000008', 'Gurbinder', NULL)
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Team managers / coaches ──────────────────────────────────────────────
--   U7 Dortmund  : Nihal (coach)
--   U7 Milan     : Gurbinder (coach)
--   PA Sports Mens: Inderpal (manager) + Iknam (coach)
INSERT INTO club_team_managers (id, team_id, member_profile_id, role, is_active)
VALUES
  ('a5300000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000001', 'a5040000-0000-4000-8000-000000000007', 'coach',   true),
  ('a5300000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000002', 'a5040000-0000-4000-8000-000000000008', 'coach',   true),
  ('a5300000-0000-4000-8000-000000000003', 'a5100000-0000-4000-8000-000000000003', 'a5040000-0000-4000-8000-000000000004', 'manager', true),
  ('a5300000-0000-4000-8000-000000000004', 'a5100000-0000-4000-8000-000000000003', 'a5040000-0000-4000-8000-000000000003', 'coach',   true)
ON CONFLICT (id) DO NOTHING;

-- ─── 5. DBS records (coaches + welfare officer) ──────────────────────────────
-- recorded_by NULL (no operator auth user at seed time; set on real audit later).
INSERT INTO club_staff_dbs (member_profile_id, club_id, check_type, certificate_number, issued_date, expiry_date, status, notes, recorded_by)
VALUES
  ('a5040000-0000-4000-8000-000000000007', 'club_pa_sports', 'enhanced', 'DBS-PA-NH-0007', '2025-01-15', '2028-01-14', 'valid', 'FA Safeguarding current.', NULL),
  ('a5040000-0000-4000-8000-000000000008', 'club_pa_sports', 'enhanced', 'DBS-PA-GB-0008', '2025-02-10', '2028-02-09', 'valid', 'FA Safeguarding current.', NULL),
  ('a5040000-0000-4000-8000-000000000004', 'club_pa_sports', 'enhanced', 'DBS-PA-IP-0004', '2024-11-20', '2027-11-19', 'valid', 'Mens manager.', NULL),
  ('a5040000-0000-4000-8000-000000000003', 'club_pa_sports', 'enhanced', 'DBS-PA-IK-0003', '2025-03-05', '2028-03-04', 'valid', 'Mens coach + U7 assist.', NULL),
  ('a5040000-0000-4000-8000-000000000006', 'club_pa_sports', 'enhanced', 'DBS-PA-JS-0006', '2024-09-01', '2027-08-31', 'valid', 'Welfare Officer.', NULL)
ON CONFLICT DO NOTHING;

-- ─── Verification ────────────────────────────────────────────────────────────
SELECT
 (SELECT count(*) FROM club_cohorts       WHERE club_id='club_pa_sports')      AS cohorts,   -- 2
 (SELECT count(*) FROM club_teams         WHERE club_id='club_pa_sports')      AS teams,     -- 3
 (SELECT count(*) FROM member_profiles    WHERE id::text LIKE 'a5040000%')     AS staff,     -- 8
 (SELECT count(*) FROM club_team_managers WHERE id::text LIKE 'a5300000%')     AS managers,  -- 4
 (SELECT count(*) FROM club_staff_dbs     WHERE club_id='club_pa_sports')      AS dbs;       -- 5
