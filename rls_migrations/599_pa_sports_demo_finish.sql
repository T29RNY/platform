-- 599_pa_sports_demo_finish.sql
--
-- P4 + P5 of the PA Sports demo readiness work (see PA_SPORTS_DEMO_HANDOFF.md §0).
-- The last data pass before the demo is sendable. Four independent fixes:
--
--   #3a  Publish the two REAL membership tiers to public signup.
--   #7   Point the "Play for us" public-page CTA at the club's join link.
--   #6   Enter results for the three 12 Jul fixtures stuck under "UPCOMING".
--   #8   Re-age charges so a realistic handful are overdue, not 41 of 68.
--
-- ⚠️ #3a is a real go-live action, not demo dressing: flipping self_signup=true
-- PUBLISHES these tiers to public PAID signup. Operator explicitly authorised BOTH
-- Junior + Adult on 2026-07-17.
--
-- Fully reversible — see the paired _down.sql. The charge re-age (#8) uses an exact
-- arithmetic shift with a deterministic "keep" set so the down is a precise inverse.

BEGIN;

-- ── #3a. Publish the two real tiers (was: self_signup absent -> fail-closed -> hidden)
UPDATE venue_membership_tiers
SET benefits = COALESCE(benefits, '{}'::jsonb) || '{"self_signup": true}'::jsonb
WHERE id IN (
  'a5f10000-0000-4000-8000-000000000001',  -- Junior Membership
  'a5f10000-0000-4000-8000-000000000002'   -- Adult Membership
);

-- ── #7. Give the public-page CTA a real destination.
-- ClubPublicScreen falls back to socials.website for the "Play for us" join button;
-- with none set it linked to #get-involved (its own anchor) and did nothing. Point it
-- at the club's public signup landing (venue_landing invite q_L8hbfm3fXy4 -> /q/…).
UPDATE club_pages
SET socials = COALESCE(socials, '{}'::jsonb)
              || '{"website": "https://app.in-or-out.com/q/q_L8hbfm3fXy4"}'::jsonb
WHERE club_id = 'club_pa_sports';

-- ── #6. Enter the three 12 Jul results (PA are home in all three). Removes them from
-- the public "UPCOMING" list and adds to the form guide. 'completed' + scores is the
-- same shape as the 4 existing Mens results, so the occupancy trigger is a no-op path.
UPDATE club_fixtures SET home_score = 2, away_score = 1, status = 'completed'
  WHERE id = 'a5b10000-0000-4000-8000-000000000003';  -- Mens 2–1 Bedworth United (W)
UPDATE club_fixtures SET home_score = 3, away_score = 1, status = 'completed'
  WHERE id = 'a5b10000-0000-4000-8000-000000000011';  -- U7 Dortmund 3–1 Earlsdon Lions (W)
UPDATE club_fixtures SET home_score = 2, away_score = 2, status = 'completed'
  WHERE id = 'a5b10000-0000-4000-8000-000000000013';  -- U7 Milan 2–2 Finham Park (D)

-- ── #8. Re-age charges. Currently 41 of 68 unpaid/partial are past due because the
-- original seed's due dates aged with real time. Keep the 6 oldest unpaid/partial
-- genuinely overdue (a believable set of stragglers) and shift the rest +21 days into
-- the near future so they read as "upcoming". Paid/refunded left untouched (a paid
-- charge past its due date is normal history, not a red flag).
-- The "keep" set is defined deterministically (6 smallest by due_date,id) so the
-- _down.sql selects the SAME rows and reverses the shift exactly.
WITH keep AS (
  SELECT id FROM venue_charges
  WHERE venue_id = 'pa_peugeot' AND status IN ('unpaid','partial')
  ORDER BY due_date, id
  LIMIT 6
)
UPDATE venue_charges
SET due_date = due_date + interval '21 days'
WHERE venue_id = 'pa_peugeot'
  AND status IN ('unpaid','partial')
  AND id NOT IN (SELECT id FROM keep);

COMMIT;
