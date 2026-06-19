-- 366: Link the two seeded combat clubs to demo_venue via club_venues.
-- Gap found during the s153 exhaustive e2e sweep: mig 363 created club_demo_box
-- (boxing) + club_demo_ma (martial_arts) and seeded belt ladders / fight records,
-- but never inserted club_venues rows. Result: the venue console Memberships →
-- Club tab and Grading tab showed only Finbar's FC and "No grading clubs", so the
-- seeded grading schemes were unmanageable from the operator UI. Member-level
-- Fight record / Award grade buttons already rendered (they key off the membership
-- row), so this only restores the club-level management surfaces.
-- Idempotent (WHERE NOT EXISTS); never touches existing rows.
INSERT INTO public.club_venues (club_id, venue_id)
SELECT v.club_id, 'demo_venue'
FROM (VALUES ('club_demo_box'), ('club_demo_ma')) AS v(club_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.club_venues cv
  WHERE cv.club_id = v.club_id AND cv.venue_id = 'demo_venue'
);
