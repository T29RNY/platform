-- 599_pa_sports_demo_finish_down.sql
--
-- Exact inverse of 599. Each of the four fixes reverses cleanly:
--   #3a  remove the self_signup key (restores the absent -> hidden state)
--   #7   remove the website key (restores absent -> CTA falls back to #get-involved)
--   #6   fixtures back to scheduled, scores NULL
--   #8   shift the same non-kept charges back -21 days (same deterministic keep set)
--
-- ⚠️ Running this un-publishes PA's real tiers, re-breaks the CTA and returns the
-- finance screen to 41 overdue — i.e. reverts the demo to unsendable. Only for
-- rolling 599 back.

BEGIN;

-- ── #3a reverse
UPDATE venue_membership_tiers
SET benefits = benefits - 'self_signup'
WHERE id IN (
  'a5f10000-0000-4000-8000-000000000001',
  'a5f10000-0000-4000-8000-000000000002'
);

-- ── #7 reverse
UPDATE club_pages
SET socials = socials - 'website'
WHERE club_id = 'club_pa_sports';

-- ── #6 reverse
UPDATE club_fixtures SET home_score = NULL, away_score = NULL, status = 'scheduled'
WHERE id IN (
  'a5b10000-0000-4000-8000-000000000003',
  'a5b10000-0000-4000-8000-000000000011',
  'a5b10000-0000-4000-8000-000000000013'
);

-- ── #8 reverse (same keep set — the 6 kept rows still have the smallest due dates
-- after the up-migration, so this selects the identical set and reverses the +21d).
WITH keep AS (
  SELECT id FROM venue_charges
  WHERE venue_id = 'pa_peugeot' AND status IN ('unpaid','partial')
  ORDER BY due_date, id
  LIMIT 6
)
UPDATE venue_charges
SET due_date = due_date - interval '21 days'
WHERE venue_id = 'pa_peugeot'
  AND status IN ('unpaid','partial')
  AND id NOT IN (SELECT id FROM keep);

COMMIT;
