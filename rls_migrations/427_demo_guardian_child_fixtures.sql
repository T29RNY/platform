-- Migration 427 — Demo seed: make the Guardian Matches screen visible for the
-- demo child Charlie Carter (member_profiles 0d000000-0000-4000-8000-000000000013,
-- guardian Sam Carter 0d...0012, dob 2014 → U12).
--
-- WHY: guardian_list_child_fixtures(child) (mig 426) returns a child's league
-- fixtures by joining club_fixtures → club_team_members for that child. Charlie
-- was on NO club_team, so the reader returned empty and the /hub Guardian Matches
-- screen showed all-empty states. A fitting team + league already exist in the
-- demo (U12 Falcons c0...0002 in Finbar's FC club_demo; U12 Saturday League
-- d0...394, mig 394) with 2 Falcons fixtures — so this seed REUSES them rather
-- than duplicating: it (1) puts Charlie on the existing U12 Falcons, and (2) tops
-- the existing league up to 3 upcoming + 3 completed fixtures so Up-next, the
-- In/Out buttons, and Recent-results all populate with a W/D/L mix.
--
-- ADDITIVE ONLY. Touches no existing rows. All new rows carry deterministic ids
-- (ON CONFLICT DO NOTHING) so the seed is idempotent and reproducible.

-- ─── 1. Charlie → U12 Falcons (active) ───────────────────────────────────────
INSERT INTO public.club_team_members (id, team_id, member_profile_id, is_active)
SELECT
  'c0000000-0000-4000-8000-000000000427'::uuid,
  'c0000000-0000-4000-8000-000000000002'::uuid,   -- U12 Falcons
  '0d000000-0000-4000-8000-000000000013'::uuid,   -- Charlie Carter
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.club_team_members
  WHERE team_id           = 'c0000000-0000-4000-8000-000000000002'::uuid
    AND member_profile_id = '0d000000-0000-4000-8000-000000000013'::uuid
)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Extra fixtures in the existing U12 Saturday League (d0...394) ─────────
-- for U12 Falcons (c0...0002). Combined with the 2 existing Falcons fixtures this
-- yields 3 upcoming (scheduled, > today) + 3 completed (with a W/D/L mix).
-- Scores are absolute home/away: the screen derives us/them from is_home.
INSERT INTO public.club_fixtures
  (id, league_id, club_team_id, club_team_name, opponent_name, is_home,
   scheduled_date, kickoff_time, home_score, away_score, status, source)
VALUES
  -- upcoming
  ('d0000000-0000-4000-8000-000000000428'::uuid,
   'd0000000-0000-4000-8000-000000000394'::uuid,
   'c0000000-0000-4000-8000-000000000002'::uuid, 'U12 Falcons',
   'Honor Oak Owls U12', true,  DATE '2026-07-04', TIME '10:00', NULL, NULL, 'scheduled', 'manual'),
  ('d0000000-0000-4000-8000-000000000429'::uuid,
   'd0000000-0000-4000-8000-000000000394'::uuid,
   'c0000000-0000-4000-8000-000000000002'::uuid, 'U12 Falcons',
   'Peckham Pumas U12', false, DATE '2026-07-11', TIME '10:30', NULL, NULL, 'scheduled', 'manual'),
  -- completed (D, then L)
  ('d0000000-0000-4000-8000-000000000430'::uuid,
   'd0000000-0000-4000-8000-000000000394'::uuid,
   'c0000000-0000-4000-8000-000000000002'::uuid, 'U12 Falcons',
   'Camberwell Comets U12', true,  DATE '2026-06-13', TIME '11:00', 2, 2, 'completed', 'manual'),
  ('d0000000-0000-4000-8000-000000000431'::uuid,
   'd0000000-0000-4000-8000-000000000394'::uuid,
   'c0000000-0000-4000-8000-000000000002'::uuid, 'U12 Falcons',
   'Dulwich Dragons U12', false, DATE '2026-06-06', TIME '10:00', 2, 1, 'completed', 'manual')
ON CONFLICT (id) DO NOTHING;
