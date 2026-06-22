-- 387_demo_sponsor_banner_creatives.sql
-- Give the demo tournament sponsors real banner-ad creatives (wide 21:9 images bundled
-- under apps/inorout/public/sponsors/). tournament_sponsors.logo_url holds the sponsor's
-- creative image, which the Tournament Hub renders as a full-width rotating banner ad.
-- Idempotent.

UPDATE tournament_sponsors SET logo_url = '/sponsors/clubhouse-tap.jpg'   WHERE id = '70000000-0000-4000-8000-000000000501';
UPDATE tournament_sponsors SET logo_url = '/sponsors/riverkit.jpg'        WHERE id = '70000000-0000-4000-8000-000000000502';
UPDATE tournament_sponsors SET logo_url = '/sponsors/northside-physio.jpg' WHERE id = '70000000-0000-4000-8000-000000000503';
UPDATE tournament_sponsors SET logo_url = '/sponsors/clubhouse-tap.jpg'   WHERE id = '70000000-0000-4000-8000-000000000a51';
UPDATE tournament_sponsors SET logo_url = '/sponsors/riverkit.jpg'        WHERE id = '70000000-0000-4000-8000-000000000a52';
