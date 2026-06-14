-- =============================================================================
-- Migration 312: Club OS demo reseed (club_demo / Finbar's FC)
-- =============================================================================
-- Populates the full Club OS feature set with realistic demo data:
--   • 2 club_teams (First Team + U12 Falcons)
--   • Team member assignments
--   • 2 managers with DBS records
--   • RSVPs on both upcoming sessions
--   • 1 past session with attendance already marked
--   • 3 sent announcements (club / cohort / team)
--   • 4 merchandise items
-- ALL writes scoped to club_id = 'club_demo'. No production data touched.
-- Deterministic UUIDs (0t range) for idempotency.
-- =============================================================================

-- ─── Guard ────────────────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = 'club_demo') THEN
    RAISE EXCEPTION 'club_demo not found — aborting mig 312';
  END IF;
END $guard$;

-- ─── 1. Club teams ────────────────────────────────────────────────────────────
-- Two playing groups within club_demo's cohorts.
INSERT INTO club_teams (id, club_id, cohort_id, name)
VALUES
  (
    'c0000000-0000-4000-8000-000000000001',
    'club_demo',
    '0f000000-0000-4000-8000-000000000002',  -- Adults cohort
    'First Team'
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    'club_demo',
    '0f000000-0000-4000-8000-000000000001',  -- U12s cohort
    'U12 Falcons'
  )
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Team member assignments ───────────────────────────────────────────────
-- First Team: Sarah, Daniel, Tom, Grace, Marcus (active adult members)
INSERT INTO club_team_members (team_id, member_profile_id, is_active)
VALUES
  ('c0000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001', true),  -- Sarah Mitchell
  ('c0000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000002', true),  -- Daniel Okafor
  ('c0000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000004', true),  -- Tom Whitfield
  ('c0000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000007', true),  -- Grace Adeyemi
  ('c0000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000008', true)   -- Marcus Reid
ON CONFLICT DO NOTHING;

-- U12 Falcons: Leo Bennett
INSERT INTO club_team_members (team_id, member_profile_id, is_active)
VALUES
  ('c0000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000006', true)  -- Leo Bennett
ON CONFLICT DO NOTHING;

-- ─── 3. Team managers ─────────────────────────────────────────────────────────
-- Marcus Reid manages the First Team; Daniel Okafor coaches U12 Falcons.
INSERT INTO club_team_managers (team_id, member_profile_id, role, is_active)
VALUES
  ('c0000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000008', 'manager', true),  -- Marcus
  ('c0000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000002', 'coach',   true)   -- Daniel
ON CONFLICT DO NOTHING;

-- ─── 4. DBS records for the two managers ─────────────────────────────────────
-- Marcus: enhanced DBS (valid). Daniel: enhanced DBS (valid, expires sooner).
-- recorded_by = tarny's user_id (the venue admin who entered these records).
INSERT INTO club_staff_dbs
  (member_profile_id, club_id, check_type, certificate_number, issued_date, expiry_date, status, notes, recorded_by)
VALUES
  (
    '0d000000-0000-4000-8000-000000000008',  -- Marcus Reid
    'club_demo',
    'enhanced',
    'DBS-2024-MR-00471',
    '2024-08-15',
    '2027-08-14',
    'valid',
    'Renewed August 2024. FA Safeguarding certificate also current.',
    '11e35b81-5fa7-4bee-b57d-f6e70449b013'  -- tarny (venue admin)
  ),
  (
    '0d000000-0000-4000-8000-000000000002',  -- Daniel Okafor
    'club_demo',
    'enhanced',
    'DBS-2025-DO-00182',
    '2025-01-20',
    '2028-01-19',
    'valid',
    'First time coach. Safeguarding in Children Sport certificate attached.',
    '11e35b81-5fa7-4bee-b57d-f6e70449b013'
  )
ON CONFLICT DO NOTHING;

-- ─── 5. RSVPs on upcoming sessions ───────────────────────────────────────────
-- Session 1: Tuesday Adults Training (Jun 20) — 0f100000-...-000000000001
-- Session 2: Saturday Juniors Session (Jun 22) — 0f100000-...-000000000002

INSERT INTO club_session_rsvps (session_id, member_profile_id, rsvp_by_profile_id, status)
VALUES
  -- Tuesday Adults
  ('0f100000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001', 'in'),    -- Sarah
  ('0f100000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000002', 'in'),    -- Daniel
  ('0f100000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000004', '0d000000-0000-4000-8000-000000000004', 'in'),    -- Tom
  ('0f100000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000007', '0d000000-0000-4000-8000-000000000007', 'maybe'), -- Grace
  ('0f100000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000008', '0d000000-0000-4000-8000-000000000008', 'in'),    -- Marcus
  ('0f100000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000003', 'out'),   -- Priya (can't make it)
  -- Saturday Juniors (Claire RSVPs on Leo's behalf)
  ('0f100000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000006', '0d000000-0000-4000-8000-000000000010', 'in')    -- Leo (RSVP by Claire)
ON CONFLICT (session_id, member_profile_id) DO UPDATE SET status = EXCLUDED.status;

-- ─── 6. Past session with attendance marked ───────────────────────────────────
-- Adds a session from 8 days ago to show historical attendance in the
-- manager's dashboard. Status stays 'scheduled' (no 'completed' state exists).

INSERT INTO club_sessions (id, club_id, cohort_id, title, status, scheduled_at, session_type)
VALUES (
  '0f100000-0000-4000-8000-000000000003',
  'club_demo',
  '0f000000-0000-4000-8000-000000000002',  -- Adults cohort
  'Tuesday Adults Training',
  'scheduled',
  (current_date - 8 + time '18:30:00')::timestamptz,
  'training'
)
ON CONFLICT (id) DO NOTHING;

-- Attendance from that past session
INSERT INTO club_session_attendance (session_id, member_profile_id, status)
VALUES
  ('0f100000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000001', 'attended'),  -- Sarah
  ('0f100000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000002', 'attended'),  -- Daniel
  ('0f100000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000004', 'attended'),  -- Tom
  ('0f100000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000007', 'attended'),  -- Grace
  ('0f100000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000008', 'attended'),  -- Marcus
  ('0f100000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000003', 'absent'),    -- Priya
  ('0f100000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000005', 'late')       -- Linda (arrived late)
ON CONFLICT (session_id, member_profile_id) DO UPDATE SET status = EXCLUDED.status;

-- ─── 7. Announcements (status = 'sent' so members can see them) ───────────────
INSERT INTO club_announcements
  (club_id, venue_id, title, body, audience, cohort_id, team_id, status, email_sent_count, sent_at)
VALUES
  (
    'club_demo', 'demo_venue',
    'Welcome to Finbar''s FC 2026/27 Season!',
    'We''re excited to kick off another great season together. Please ensure your membership is up to date and all consent forms are signed before our first session on June 20th. See you on the pitch!',
    'club', NULL, NULL,
    'sent', 42, now() - interval '5 days'
  ),
  (
    'club_demo', 'demo_venue',
    'U12 Falcons — Kit Collection This Saturday',
    'U12 Falcons: your new 2026/27 kits are ready for collection this Saturday after training. Please arrive 10 minutes early. Any queries, contact Daniel.',
    'cohort', '0f000000-0000-4000-8000-000000000001', NULL,  -- U12s cohort
    'sent', 8, now() - interval '2 days'
  ),
  (
    'club_demo', 'demo_venue',
    'First Team — Pre-Season Schedule',
    'Pre-season begins June 18th with 6 training sessions before our opening competitive fixture on July 5th. Full schedule in the app. Please RSVP by Thursday so Marcus can plan sessions.',
    'team', NULL, 'c0000000-0000-4000-8000-000000000001',  -- First Team
    'sent', 12, now() - interval '1 day'
  )
ON CONFLICT DO NOTHING;

-- ─── 8. Merchandise items ─────────────────────────────────────────────────────
INSERT INTO club_merchandise (club_id, venue_id, name, description, category, price_pence, stock_qty, active)
VALUES
  (
    'club_demo', 'demo_venue',
    'Home Kit 2026/27',
    'Full home strip: shirt, shorts and socks in club colours (navy/white). Available in S, M, L, XL.',
    'kit', 4500, 30, true
  ),
  (
    'club_demo', 'demo_venue',
    'Training Hoodie',
    'Club-branded training hoodie — heavy fleece, embroidered badge. Sizes XS–2XL.',
    'kit', 2800, 20, true
  ),
  (
    'club_demo', 'demo_venue',
    'Club Holdall',
    'Drawstring gym bag with embroidered club crest. Navy/white colourway.',
    'accessories', 1500, NULL, true  -- NULL stock = unlimited
  ),
  (
    'club_demo', 'demo_venue',
    'Water Bottle',
    'Finbar''s FC branded 750 ml BPA-free bottle with flip-top lid.',
    'accessories', 800, 50, true
  )
ON CONFLICT DO NOTHING;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- [A] Club teams (expected: 2)
SELECT name, cohort_id FROM club_teams WHERE club_id = 'club_demo';

-- [B] Team members (expected: 6 total — 5 First Team + 1 U12)
SELECT ct.name AS team, count(*) AS members
FROM club_team_members ctm
JOIN club_teams ct ON ct.id = ctm.team_id
WHERE ct.club_id = 'club_demo'
GROUP BY ct.name;

-- [C] RSVPs (expected: 7)
SELECT count(*) AS rsvps
FROM club_session_rsvps csr
JOIN club_sessions cs ON cs.id = csr.session_id
WHERE cs.club_id = 'club_demo';

-- [D] Attendance rows (expected: 7 on the past session)
SELECT status, count(*) FROM club_session_attendance
WHERE session_id = '0f100000-0000-4000-8000-000000000003'
GROUP BY status;

-- [E] Announcements (expected: 3 sent)
SELECT title, audience, status FROM club_announcements WHERE club_id = 'club_demo';

-- [F] Merchandise (expected: 4 active items)
SELECT name, price_pence, stock_qty FROM club_merchandise WHERE club_id = 'club_demo';
