-- 382_demo_tournament_hub_content.sql
-- Demo content for the Tournament Hub (session 172). Idempotent.
--   • Fills demo_venue address/contact (only where NULL) so the Info/Directions tab + map
--     pin have data.
--   • Sets the Finbar's FC Summer Cup info blob (parking, prices, rules, what to bring,
--     contact) + branding (club green + hero image bundled at /tournament-hero.jpg).
--   • Seeds 3 sponsors for the rotating banner.

UPDATE venues SET
  address       = COALESCE(address, '12 Riverside Way'),
  city          = COALESCE(city, 'Manchester'),
  postcode      = COALESCE(postcode, 'M1 2AB'),
  lat           = COALESCE(lat, 53.4808),
  lng           = COALESCE(lng, -2.2426),
  contact_email = COALESCE(contact_email, 'hello@demosports.co'),
  contact_phone = COALESCE(contact_phone, '0161 555 0100')
WHERE id = 'demo_venue';

UPDATE tournament_events SET
  branding = branding || jsonb_build_object(
    'primary_colour', '#27AE60',
    'hero_url', '/tournament-hero.jpg'
  ),
  info = jsonb_build_object(
    'tagline',   'Eight teams. One day. One trophy.',
    'parking',   'Free on-site parking (80 spaces) off Riverside Way. Overflow at the Civic car park, 3 min walk.',
    'prices',    'Free entry for spectators. £25 per team. Bar & hot food on site all day.',
    'rules',     '6-a-side, rolling subs, 12-min halves. Group stage then knockouts. Full rules handed out at registration.',
    'whats_on',  'Kick-off 10:00 · Group stage to 13:00 · Knockouts from 14:00 · Final 16:00. DJ + bar till late.',
    'contact',   'Tournament office at reception, or call the number below on the day.'
  )
WHERE id = '70000000-0000-4000-8000-000000000001';

DELETE FROM tournament_sponsors WHERE id IN (
  '70000000-0000-4000-8000-000000000501',
  '70000000-0000-4000-8000-000000000502',
  '70000000-0000-4000-8000-000000000503'
);
INSERT INTO tournament_sponsors (id, tournament_event_id, name, logo_url, website_url, display_order, active) VALUES
  ('70000000-0000-4000-8000-000000000501', '70000000-0000-4000-8000-000000000001', 'The Clubhouse Tap', NULL, 'https://example.com', 1, true),
  ('70000000-0000-4000-8000-000000000502', '70000000-0000-4000-8000-000000000001', 'RiverKit Sportswear', NULL, 'https://example.com', 2, true),
  ('70000000-0000-4000-8000-000000000503', '70000000-0000-4000-8000-000000000001', 'Northside Physio',   NULL, 'https://example.com', 3, true);
