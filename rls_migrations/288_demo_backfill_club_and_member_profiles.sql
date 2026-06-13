-- Migration 288 — Demo backfill: club_demo + member_profiles + guardians + membership re-point
-- Seed data only — no structural changes.
-- Deterministic UUIDs (0d000000-0000-4000-8000-00000000000N) so re-running is idempotent.
-- venue_customers rows kept intact — dual-readable until Phase 4 rebuilds the membership builder.
-- No touch to casual players / teams / their RLS wall.

-- ─── 1. club_demo ────────────────────────────────────────────────────────────
INSERT INTO clubs (id, name, short_name, contact_name, contact_email, id_mandate, safeguarding_config)
VALUES (
  'club_demo',
  'Finbar''s FC',
  'FFC',
  'Finbar O''Sullivan',
  'finbar@demo.inorout.com',
  false,
  '{}'
)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. club_venues: club_demo ↔ demo_venue ──────────────────────────────────
INSERT INTO club_venues (id, club_id, venue_id)
VALUES ('0e000000-0000-4000-8000-000000000001', 'club_demo', 'demo_venue')
ON CONFLICT ON CONSTRAINT uq_club_venue DO NOTHING;

-- ─── 3. club_cohorts: one demo cohort ────────────────────────────────────────
INSERT INTO club_cohorts (id, club_id, name, description, min_age, max_age, active)
VALUES ('0f000000-0000-4000-8000-000000000001', 'club_demo', 'U12s', 'Under 12s squad', 10, 12, true)
ON CONFLICT (id) DO NOTHING;

-- ─── 4. member_profiles: one per venue_customer ──────────────────────────────
-- Deterministic UUIDs match the 0c000000... pattern of venue_customers (suffix incremented by 1 in the 0d range).
-- auth_user_id = NULL (unclaimed) — members claim via member_claim_profile.

INSERT INTO member_profiles (id, first_name, last_name, email, dob, source_customer_id)
VALUES
  ('0d000000-0000-4000-8000-000000000001', 'Sarah',  'Mitchell', 'sarah.mitchell@example.com',   '1989-03-22', '0c000000-0000-4000-8000-000000000001'),
  ('0d000000-0000-4000-8000-000000000002', 'Daniel', 'Okafor',   'd.okafor@example.com',         '1995-11-08', '0c000000-0000-4000-8000-000000000002'),
  ('0d000000-0000-4000-8000-000000000003', 'Priya',  'Sharma',   'priya.sharma@example.com',     '1991-06-30', '0c000000-0000-4000-8000-000000000003'),
  ('0d000000-0000-4000-8000-000000000004', 'Tom',    'Whitfield', 'tom.whitfield@example.com',   '1983-01-17', '0c000000-0000-4000-8000-000000000004'),
  ('0d000000-0000-4000-8000-000000000005', 'Linda',  'Crawford', 'linda.crawford@example.com',   '1976-09-02', '0c000000-0000-4000-8000-000000000005'),
  ('0d000000-0000-4000-8000-000000000006', 'Leo',    'Bennett',  'bennett.family@example.com',   '2012-09-14', '0c000000-0000-4000-8000-000000000006'),
  ('0d000000-0000-4000-8000-000000000007', 'Grace',  'Adeyemi',  'grace.adeyemi@example.com',    '1998-12-11', '0c000000-0000-4000-8000-000000000007'),
  ('0d000000-0000-4000-8000-000000000008', 'Marcus', 'Reid',     'marcus.reid@example.com',      '1987-04-19', '0c000000-0000-4000-8000-000000000008'),
  ('0d000000-0000-4000-8000-000000000009', 'Helen',  'Voss',     'helen.voss@example.com',       '1969-07-25', '0c000000-0000-4000-8000-000000000009')
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Claire Bennett — guardian-only profile (not in venue_customers) ──────
-- Shares email with Leo (bennett.family@example.com) — she is the account holder,
-- Leo's profile is the child. She would claim via that email.
INSERT INTO member_profiles (id, first_name, last_name, email, source_customer_id)
VALUES ('0d000000-0000-4000-8000-000000000010', 'Claire', 'Bennett', 'bennett.family@example.com', NULL)
ON CONFLICT (id) DO NOTHING;

-- ─── 6. member_guardians: Leo ← Claire ──────────────────────────────────────
INSERT INTO member_guardians (
  id, child_profile_id, guardian_profile_id,
  relationship, is_primary, can_collect, invite_state, accepted_at
)
VALUES (
  '0d000000-0000-4000-8000-000000000011',
  '0d000000-0000-4000-8000-000000000006',   -- Leo Bennett
  '0d000000-0000-4000-8000-000000000010',   -- Claire Bennett
  'parent', true, true, 'accepted', now()
)
ON CONFLICT ON CONSTRAINT uq_guardian_child DO NOTHING;

-- ─── 7. Re-point venue_memberships ───────────────────────────────────────────
-- Set club_id + member_profile_id for all 8 demo memberships.
-- Leo's row also gets payer_profile_id = Claire's profile.

UPDATE venue_memberships vm
SET club_id           = 'club_demo',
    member_profile_id = mp.id
FROM member_profiles mp
WHERE mp.source_customer_id = vm.customer_id
  AND vm.venue_id = 'demo_venue';

-- Leo's membership: payer = Claire (the guardian account)
UPDATE venue_memberships
SET payer_profile_id = '0d000000-0000-4000-8000-000000000010'
WHERE customer_id = '0c000000-0000-4000-8000-000000000006'
  AND venue_id = 'demo_venue';
