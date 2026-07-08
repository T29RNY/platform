-- =============================================================================
-- Migration 505: PA Sports demo — operator + venues + pitches + club + branding
-- =============================================================================
-- Pilot club "PA Sports" (formerly Panjab Athletic FC), Coventry.
-- This is the REAL club in pre-launch state: real name, branding, grounds,
-- pitches, committee. Only the PLAYERS are demo (seeded in migs 506–508) and
-- get swapped for real families/players at go-live.
--
-- Seed data only — no structural changes.
-- Deterministic ids so re-running is idempotent:
--   text ids : company_pa_sports / pa_peugeot / seva_school / club_pa_sports
--   uuid rows: 'a5…' range (a5a=pitches, a5e=club_venues, a5c1=committee)
-- Paired teardown: 505_pa_sports_operator_and_venues_down.sql
-- =============================================================================

-- ─── 1. Operator company (shared company_id → cross-site scheduling seam) ─────
INSERT INTO companies (id, name, slug, sport, contact_email, primary_colour, secondary_colour)
VALUES ('company_pa_sports', 'PA Sports', 'pa-sports', 'football',
        'pav_somal@yahoo.com', '#1E2A4A', '#C6A44E')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Two grounds (venues) ─────────────────────────────────────────────────
-- PA Peugeot Ground = matches (2× 11-a-side grass, cricket pitch coming).
-- Seva School        = training (1× 4G, 7-a-side / splits to 2× 5-a-side).
INSERT INTO venues (id, company_id, name, slug, sport, address, city, postcode,
                    contact_email, verification_status, origin, active)
VALUES
  ('pa_peugeot', 'company_pa_sports', 'PA Peugeot Ground', 'pa-peugeot-ground',
   'football', 'Pinley House, 2 Sunbeam Way', 'Coventry', 'CV3 1ND',
   'pav_somal@yahoo.com', 'verified', 'superadmin', true),
  ('seva_school', 'company_pa_sports', 'Seva School', 'seva-school',
   'football', 'Eden Road, Walsgrave on Sowe', 'Coventry', 'CV2 2TB',
   'pav_somal@yahoo.com', 'verified', 'superadmin', true)
ON CONFLICT (id) DO NOTHING;

-- ─── 3. Pitches (playing_areas) ──────────────────────────────────────────────
INSERT INTO playing_areas (id, venue_id, name, surface, capacity, active, sort_order)
VALUES
  ('a5a00000-0000-4000-8000-000000000001', 'pa_peugeot', 'Pitch 1 (11-a-side)', 'grass', 11, true,  1),
  ('a5a00000-0000-4000-8000-000000000002', 'pa_peugeot', 'Pitch 2 (11-a-side)', 'grass', 11, true,  2),
  -- Cricket pitch is "coming soon" — seeded inactive so it shows as planned, not bookable.
  ('a5a00000-0000-4000-8000-000000000003', 'pa_peugeot', 'Cricket Pitch (coming soon)', 'grass', NULL, false, 3),
  -- One 4G that splits into 5-a-sides; modelled as a single 7-a-side area (no split model in schema yet).
  ('a5a00000-0000-4000-8000-000000000004', 'seva_school', '4G (7-a-side)', '4g', 7, true, 1)
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Club (PA Sports) ─────────────────────────────────────────────────────
INSERT INTO clubs (id, name, short_name, founded_year, contact_name, contact_email,
                   id_mandate, safeguarding_config, discipline)
VALUES ('club_pa_sports', 'PA Sports', 'PA', NULL, 'Pav Somal', 'pav_somal@yahoo.com',
        false, '{}'::jsonb, 'football')
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Club ↔ both grounds ──────────────────────────────────────────────────
INSERT INTO club_venues (id, club_id, venue_id)
VALUES
  ('a5e00000-0000-4000-8000-000000000001', 'club_pa_sports', 'pa_peugeot'),
  ('a5e00000-0000-4000-8000-000000000002', 'club_pa_sports', 'seva_school')
ON CONFLICT DO NOTHING;

-- ─── 6. Club branding (public page) ──────────────────────────────────────────
-- Navy primary / gold secondary (crest colours). crest_url is set once the PNG
-- is uploaded to the club-media bucket (manual step — see handoff doc).
INSERT INTO club_pages (club_id, slug, published, primary_colour, secondary_colour, accent_colour,
                        crest_url, tagline, about, socials)
VALUES (
  'club_pa_sports', 'pa-sports', true,
  '#1E2A4A', '#C6A44E', '#C6A44E',
  NULL,
  'Play. Learn. Compete. Together.',
  'PA Sports is a Coventry grassroots football club running youth and adult teams across two grounds — PA Peugeot Ground and Seva School. Fair Play First. Respect Everyone. Enjoy the Game. Build Community.',
  '{"instagram":"https://www.instagram.com/pa_sportsfc"}'::jsonb
)
ON CONFLICT (club_id) DO NOTHING;

-- ─── 7. Committee (incl. welfare officer) ────────────────────────────────────
INSERT INTO club_committee (id, club_id, role, name, is_welfare, display_order)
VALUES
  ('a5c10000-0000-4000-8000-000000000001', 'club_pa_sports', 'Club Secretary', 'Pav Somal',  false, 1),
  ('a5c10000-0000-4000-8000-000000000002', 'club_pa_sports', 'Chairperson',    'Ranvir',      false, 2),
  ('a5c10000-0000-4000-8000-000000000003', 'club_pa_sports', 'Treasurer',      'Gurchetan',   false, 3),
  ('a5c10000-0000-4000-8000-000000000004', 'club_pa_sports', 'Welfare Officer','Jas',         true,  4)
ON CONFLICT (id) DO NOTHING;

-- ─── Verification ────────────────────────────────────────────────────────────
-- [A] Company + venues (expected: 1 company, 2 venues sharing company_pa_sports)
SELECT (SELECT count(*) FROM companies WHERE id='company_pa_sports') AS companies,
       (SELECT count(*) FROM venues WHERE company_id='company_pa_sports') AS venues;
-- [B] Pitches (expected: 4 — 3 at PA Peugeot incl 1 inactive, 1 at Seva)
SELECT venue_id, count(*) FILTER (WHERE active) AS active, count(*) AS total
FROM playing_areas WHERE venue_id IN ('pa_peugeot','seva_school') GROUP BY venue_id;
-- [C] Club + link + branding (expected: 1 / 2 / 1)
SELECT (SELECT count(*) FROM clubs WHERE id='club_pa_sports') AS club,
       (SELECT count(*) FROM club_venues WHERE club_id='club_pa_sports') AS venue_links,
       (SELECT count(*) FROM club_pages WHERE club_id='club_pa_sports') AS pages;
-- [D] Committee (expected: 4, one welfare)
SELECT count(*) AS committee, count(*) FILTER (WHERE is_welfare) AS welfare
FROM club_committee WHERE club_id='club_pa_sports';
