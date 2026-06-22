-- 385_demo_open_tournament_signup.sql
-- A second demo tournament in the OPEN (taking-entries) state so the Tournament Hub's
-- pre-event / signup experience is demoable at /tournament/autumn-6s. Different accent
-- (blue) to show per-club theming. No fixtures (pre-event); a few teams already in.
-- Idempotent.

DELETE FROM competition_teams WHERE competition_id IN (
  '70000000-0000-4000-8000-000000000a10','70000000-0000-4000-8000-000000000a20');
DELETE FROM competitions WHERE id IN (
  '70000000-0000-4000-8000-000000000a10','70000000-0000-4000-8000-000000000a20');
DELETE FROM tournament_sponsors WHERE tournament_event_id = '70000000-0000-4000-8000-000000000002';
DELETE FROM tournament_events WHERE id = '70000000-0000-4000-8000-000000000002';

INSERT INTO tournament_events (id, venue_id, club_id, name, slug, event_date, status,
                               entry_fee_pence, entry_fee_payer, track_stats, registration_deadline, branding, info)
VALUES ('70000000-0000-4000-8000-000000000002', 'demo_venue', 'club_demo',
        'Finbar''s FC Autumn 6s', 'autumn-6s',
        (now() AT TIME ZONE 'Europe/London')::date + 45, 'open',
        2500, 'per_team', true,
        (now() + interval '30 days'),
        jsonb_build_object('primary_colour', '#2E86DE', 'hero_url', '/tournament-hero.jpg'),
        jsonb_build_object(
          'tagline',  'Autumn''s biggest 6-a-side. Lock your team in.',
          'parking',  'Free on-site parking off Riverside Way.',
          'prices',   '£25 per team. Cash or card on the day. Spectators free.',
          'rules',    '6-a-side, squads of up to 9. Group stage then cup & plate knockouts.',
          'whats_on', 'Saturday all-dayer: groups from 10:00, finals ~17:00. Bar & BBQ on.',
          'contact',  'Questions? Call the venue on the number in the Info tab.'
        ));

INSERT INTO competitions (id, tournament_event_id, name, type, format, status, config) VALUES
  ('70000000-0000-4000-8000-000000000a10', '70000000-0000-4000-8000-000000000002', 'Open (6-a-side)', 'cup', 'group_stage', 'setup', '{"num_groups":2,"qualifiers_per_group":2}'::jsonb),
  ('70000000-0000-4000-8000-000000000a20', '70000000-0000-4000-8000-000000000002', 'Vets (35+)',      'cup', 'group_stage', 'setup', '{"num_groups":1,"qualifiers_per_group":2}'::jsonb);

INSERT INTO competition_teams (id, competition_id, team_name, status) VALUES
  ('70000000-0000-4000-8000-000000000a11', '70000000-0000-4000-8000-000000000a10', 'Parkside Rangers', 'active'),
  ('70000000-0000-4000-8000-000000000a12', '70000000-0000-4000-8000-000000000a10', 'The Vampires',     'active'),
  ('70000000-0000-4000-8000-000000000a13', '70000000-0000-4000-8000-000000000a10', 'Real Ale Madrid',  'active'),
  ('70000000-0000-4000-8000-000000000a21', '70000000-0000-4000-8000-000000000a20', 'Once Were Quick',  'active');

INSERT INTO tournament_sponsors (id, tournament_event_id, name, logo_url, website_url, display_order, active) VALUES
  ('70000000-0000-4000-8000-000000000a51', '70000000-0000-4000-8000-000000000002', 'The Clubhouse Tap', NULL, 'https://example.com', 1, true),
  ('70000000-0000-4000-8000-000000000a52', '70000000-0000-4000-8000-000000000002', 'RiverKit Sportswear', NULL, 'https://example.com', 2, true);
