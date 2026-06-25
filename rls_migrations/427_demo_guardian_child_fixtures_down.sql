-- Down 427 — remove the demo seed rows added in 427 (additive, by deterministic id).
-- Leaves all pre-existing demo rows (U12 Falcons, U12 Saturday League, Leo Bennett,
-- the 2 original Falcons fixtures) untouched.

DELETE FROM public.club_fixtures
WHERE id IN (
  'd0000000-0000-4000-8000-000000000428'::uuid,
  'd0000000-0000-4000-8000-000000000429'::uuid,
  'd0000000-0000-4000-8000-000000000430'::uuid,
  'd0000000-0000-4000-8000-000000000431'::uuid
);

DELETE FROM public.club_team_members
WHERE id = 'c0000000-0000-4000-8000-000000000427'::uuid;
