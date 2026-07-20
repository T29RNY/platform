-- 611_df_publish_trial_cta.sql
-- P5 Step 3 of the DF trial-booking epic (docs/epics/df-trial-booking.md) — DF GO-LIVE.
--
-- Publishes DF Sports Coaching's public page and turns ON the gated trial CTA (mig 610), so a
-- real parent can land on /c/df-sports-coaching and book a free trial via
-- /c/df-sports-coaching/trial. Verified before applying: DF has 5 trial-shaped sessions in the
-- next 8 weeks, so the picker won't dead-end. Mirrors PA Sports' page seed (mig 505) — a real
-- club's page brought live via a migration for reproducibility.
--
-- ⚠️ PLACEHOLDER BRANDING. primary_colour + tagline are tasteful launch defaults so the page
-- looks intentional; the operator should replace them with DF's real brand via the club page
-- editor (venue_set_club_page). COALESCE/NULLIF guard against overwriting anything already set,
-- so re-running or an operator edit is safe. The stored hex is club DATA (like PA's colour in
-- mig 505), not component styling — the tokens.css hex rule does not apply here.

BEGIN;

UPDATE public.club_pages
SET published         = true,
    trial_cta_enabled = true,
    primary_colour    = COALESCE(primary_colour, '#16A34A'),
    tagline           = COALESCE(NULLIF(btrim(tagline), ''), 'Football coaching where every child learns to love the game')
WHERE slug = 'df-sports-coaching';

COMMIT;
