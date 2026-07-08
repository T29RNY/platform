-- =============================================================================
-- Migration 507: PA Sports demo — demo players, guardians, rosters
-- =============================================================================
-- DEMO people only (swapped for real families/players at go-live).
--   • U7 Dortmund: 9 kids + 9 guardians
--   • U7 Milan   : 9 kids + 9 guardians
--   • PA Sports Mens: 16 adult players
--   • club_team_members rosters + member_guardians links
-- Deterministic id ranges (so teardown removes exactly these, nothing else):
--   a5010000 = Dortmund kids   a5019000 = Dortmund guardians
--   a5020000 = Milan kids      a5029000 = Milan guardians
--   a5030000 = Mens players
-- Paired teardown: 507_pa_sports_demo_people_down.sql
-- =============================================================================

DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM club_teams WHERE id='a5100000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'PA Sports teams not found — apply mig 506 first';
  END IF;
END $guard$;

-- ─── Youth teams: kids + guardians + link + roster ───────────────────────────
DO $youth$
DECLARE
  kid_first  text[];
  surname    text[];
  guard_first text[];
  kid_pfx    text;
  guard_pfx  text;
  team_id    uuid;
  i          int;
  kid_id     uuid;
  guard_id   uuid;
  fam_email  text;
BEGIN
  FOR t IN 1..2 LOOP
    IF t = 1 THEN
      kid_first   := ARRAY['Arjan','Reuben','Kai','Zayn','Rohan','Theo','Aarav','Ishaan','Leo'];
      surname     := ARRAY['Sandhu','Dhaliwal','Bassi','Gill','Chana','Johal','Sahota','Bhullar','Mangat'];
      guard_first := ARRAY['Harpreet','Simran','Manpreet','Amrit','Baljit','Navdeep','Rajveer','Gagan','Sukhdeep'];
      kid_pfx     := 'a5010000-0000-4000-8000-';
      guard_pfx   := 'a5019000-0000-4000-8000-';
      team_id     := 'a5100000-0000-4000-8000-000000000001';  -- U7 Dortmund
    ELSE
      kid_first   := ARRAY['Vihaan','Devan','Noah','Ayaan','Krish','Ethan','Shay','Aran','Jude'];
      surname     := ARRAY['Grewal','Sidhu','Aujla','Rai','Dosanjh','Virk','Toor','Heer','Sohal'];
      guard_first := ARRAY['Parminder','Kiran','Harjit','Davinder','Jasbir','Ravinder','Inderjit','Balwinder','Charnjit'];
      kid_pfx     := 'a5020000-0000-4000-8000-';
      guard_pfx   := 'a5029000-0000-4000-8000-';
      team_id     := 'a5100000-0000-4000-8000-000000000002';  -- U7 Milan
    END IF;

    FOR i IN 1..9 LOOP
      kid_id    := (kid_pfx   || lpad(i::text, 12, '0'))::uuid;
      guard_id  := (guard_pfx || lpad(i::text, 12, '0'))::uuid;
      fam_email := lower(guard_first[i] || '.' || surname[i] || '@example.com');

      -- Guardian (adult) profile
      INSERT INTO member_profiles (id, first_name, last_name, email, dob, phone)
      VALUES (guard_id, guard_first[i], surname[i], fam_email,
              ('1986-01-01'::date + (i*97)), '077009001' || lpad(((t-1)*9 + i)::text, 2, '0'))
      ON CONFLICT (id) DO NOTHING;

      -- Child profile (U7) with guardian as emergency contact
      INSERT INTO member_profiles (id, first_name, last_name, dob, ec1_name, ec1_relationship, ec1_phone, may_leave_unaccompanied)
      VALUES (kid_id, kid_first[i], surname[i],
              ('2018-09-01'::date + (i*11)),
              guard_first[i] || ' ' || surname[i], 'Parent',
              '077009001' || lpad(((t-1)*9 + i)::text, 2, '0'), false)
      ON CONFLICT (id) DO NOTHING;

      -- Guardian link
      INSERT INTO member_guardians (child_profile_id, guardian_profile_id, relationship, is_primary, can_collect, invite_state, accepted_at)
      VALUES (kid_id, guard_id, 'parent', true, true, 'accepted', now())
      ON CONFLICT DO NOTHING;

      -- Roster: child in the team
      INSERT INTO club_team_members (team_id, member_profile_id, is_active)
      VALUES (team_id, kid_id, true)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $youth$;

-- ─── Mens: 16 adult players + roster ─────────────────────────────────────────
DO $mens$
DECLARE
  first_n text[] := ARRAY['Sonny','Deep','Manny','Vik','Raj','Harry','Bal','Jag','Amar','Sim','Kav','Tony','Prit','Dan','Rick','Monty'];
  last_n  text[] := ARRAY['Athwal','Rana','Basra','Purewal','Kalsi','Gill','Sekhon','Deol','Bains','Ghuman','Randhawa','Marwaha','Sangha','Chahal','Bhogal','Dhindsa'];
  team_id uuid   := 'a5100000-0000-4000-8000-000000000003';
  i       int;
  pid     uuid;
BEGIN
  FOR i IN 1..16 LOOP
    pid := ('a5030000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO member_profiles (id, first_name, last_name, dob)
    VALUES (pid, first_n[i], last_n[i], ('1988-01-01'::date + (i*211)))
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO club_team_members (team_id, member_profile_id, is_active)
    VALUES (team_id, pid, true)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $mens$;

-- ─── Verification ────────────────────────────────────────────────────────────
SELECT
 (SELECT count(*) FROM member_profiles WHERE id::text LIKE 'a501%')        AS dort_kids,   -- 9
 (SELECT count(*) FROM member_profiles WHERE id::text LIKE 'a5019%')       AS dort_guard,  -- 9
 (SELECT count(*) FROM member_profiles WHERE id::text LIKE 'a502%' AND id::text NOT LIKE 'a5029%') AS milan_kids, -- 9
 (SELECT count(*) FROM member_profiles WHERE id::text LIKE 'a5029%')       AS milan_guard, -- 9
 (SELECT count(*) FROM member_profiles WHERE id::text LIKE 'a503%')        AS mens,        -- 16
 (SELECT count(*) FROM member_guardians mg JOIN member_profiles c ON c.id=mg.child_profile_id WHERE c.id::text LIKE 'a50%') AS links, -- 18
 (SELECT count(*) FROM club_team_members ctm JOIN club_teams ct ON ct.id=ctm.team_id WHERE ct.club_id='club_pa_sports') AS roster; -- 34
