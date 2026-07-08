-- =============================================================================
-- Migration 511: PA Sports demo — documents & consents (placeholders/examples)
-- =============================================================================
-- Depends on 505–507.
--   • 4 club policy documents (current)
--   • Signed consent acceptances (guardians on behalf of kids; players for self)
--   • Proof-of-age ID documents (placeholder storage paths; mixed approved/pending)
--   • Medical record reviews (guardian-confirmed) for youth
--   • Photo-consent flags on all demo people + sample medical notes on 2 kids
-- All placeholders — storage paths point at demo files that need no real upload.
-- Policy ids: a5e1…0x. Set-based, idempotent (ON CONFLICT DO NOTHING).
-- Paired teardown: 511_pa_sports_documents_down.sql
-- =============================================================================

DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id='club_pa_sports') THEN
    RAISE EXCEPTION 'club_pa_sports not found — apply mig 505 first';
  END IF;
END $guard$;

-- ─── 1. Club policy documents ────────────────────────────────────────────────
INSERT INTO policy_documents (id, club_id, title, body, version, is_current)
VALUES
  ('a5e10000-0000-4000-8000-000000000001', 'club_pa_sports', 'Safeguarding Policy',
   'PA Sports is committed to safeguarding children and adults at risk. All staff and volunteers hold enhanced DBS checks and FA Safeguarding certification. Our Welfare Officer is the first point of contact for any concern. [Demo placeholder policy text.]', 1, true),
  ('a5e10000-0000-4000-8000-000000000002', 'club_pa_sports', 'Player Code of Conduct',
   'Players represent PA Sports on and off the pitch. Fair Play First. Respect Everyone. Enjoy the Game. Build Community. [Demo placeholder policy text.]', 1, true),
  ('a5e10000-0000-4000-8000-000000000003', 'club_pa_sports', 'Privacy Notice',
   'This notice explains how PA Sports collects and processes personal data under UK GDPR, including how long we keep it and your rights. [Demo placeholder policy text.]', 1, true),
  ('a5e10000-0000-4000-8000-000000000004', 'club_pa_sports', 'Photography & Social Media Policy',
   'How and when images of members (including children) may be captured and shared, and how to opt out. [Demo placeholder policy text.]', 1, true)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Consent acceptances ──────────────────────────────────────────────────
-- Kids: guardian signs Safeguarding + Photography on the child's behalf.
INSERT INTO consent_acceptances (document_id, member_profile_id, signed_on_behalf_of, typed_signature, ip_address, user_agent)
SELECT d.id, ctm.member_profile_id, mg.guardian_profile_id,
       gp.first_name || ' ' || coalesce(gp.last_name,''), '203.0.113.10', 'DemoSeed/1.0'
FROM club_team_members ctm
JOIN club_teams t   ON t.id = ctm.team_id AND t.club_id='club_pa_sports'
JOIN club_cohorts c ON c.id = t.cohort_id AND c.category='youth'
JOIN member_guardians mg ON mg.child_profile_id = ctm.member_profile_id
JOIN member_profiles gp  ON gp.id = mg.guardian_profile_id
JOIN policy_documents d  ON d.club_id='club_pa_sports' AND d.title IN ('Safeguarding Policy','Photography & Social Media Policy')
ON CONFLICT DO NOTHING;

-- Adults: sign Code of Conduct + Privacy themselves.
INSERT INTO consent_acceptances (document_id, member_profile_id, typed_signature, ip_address, user_agent)
SELECT d.id, ctm.member_profile_id, mp.first_name || ' ' || coalesce(mp.last_name,''), '203.0.113.20', 'DemoSeed/1.0'
FROM club_team_members ctm
JOIN club_teams t   ON t.id = ctm.team_id AND t.club_id='club_pa_sports'
JOIN club_cohorts c ON c.id = t.cohort_id AND c.category='adult'
JOIN member_profiles mp ON mp.id = ctm.member_profile_id
JOIN policy_documents d ON d.club_id='club_pa_sports' AND d.title IN ('Player Code of Conduct','Privacy Notice')
ON CONFLICT DO NOTHING;

-- ─── 3. Proof-of-age ID documents (placeholders) ─────────────────────────────
-- Kids: birth certificate. Adults: passport. Mixed approved/pending.
INSERT INTO member_id_documents (member_profile_id, club_id, document_type, storage_path, status)
SELECT ctm.member_profile_id, 'club_pa_sports',
       CASE WHEN c.category='youth' THEN 'birth_certificate' ELSE 'passport' END,
       'club_pa_sports/' || ctm.member_profile_id || '/proof_of_id.jpg',
       (ARRAY['approved','approved','approved','pending'])[1 + (row_number() OVER (ORDER BY ctm.member_profile_id))::int % 4]
FROM club_team_members ctm
JOIN club_teams t   ON t.id = ctm.team_id AND t.club_id='club_pa_sports'
JOIN club_cohorts c ON c.id = t.cohort_id
ON CONFLICT DO NOTHING;

-- ─── 4. Medical record reviews (guardian-confirmed) for youth ────────────────
INSERT INTO member_record_reviews (member_profile_id, review_kind, reviewed_on_behalf_by, snapshot)
SELECT ctm.member_profile_id, 'medical', mg.guardian_profile_id, '{"reviewed":"demo"}'::jsonb
FROM club_team_members ctm
JOIN club_teams t   ON t.id = ctm.team_id AND t.club_id='club_pa_sports'
JOIN club_cohorts c ON c.id = t.cohort_id AND c.category='youth'
JOIN member_guardians mg ON mg.child_profile_id = ctm.member_profile_id
ON CONFLICT DO NOTHING;

-- ─── 5. Photo-consent flags + sample medical notes ───────────────────────────
UPDATE member_profiles
SET photo_consent = '{"website":true,"social":true,"press":false,"marketing":false}'::jsonb,
    consent_emergency_treatment = true
WHERE (id::text LIKE 'a501%' OR id::text LIKE 'a502%' OR id::text LIKE 'a503%');

-- Two kids with special-category medical data (shows handling of it)
UPDATE member_profiles SET medical_conditions = 'Asthma — blue reliever inhaler kept in kit bag', consent_administer_medication = true
WHERE id = 'a5010000-0000-4000-8000-000000000001';
UPDATE member_profiles SET allergies = 'Nut allergy — carries antihistamine; no nuts at snack time', consent_administer_medication = true
WHERE id = 'a5020000-0000-4000-8000-000000000001';

-- ─── Verification ────────────────────────────────────────────────────────────
SELECT
 (SELECT count(*) FROM policy_documents      WHERE club_id='club_pa_sports') AS policies,      -- 4
 (SELECT count(*) FROM consent_acceptances ca JOIN policy_documents d ON d.id=ca.document_id WHERE d.club_id='club_pa_sports') AS consents,
 (SELECT count(*) FROM member_id_documents   WHERE club_id='club_pa_sports') AS id_docs,        -- 34
 (SELECT count(*) FROM member_record_reviews r JOIN member_profiles m ON m.id=r.member_profile_id WHERE m.id::text LIKE 'a50%') AS medical_reviews, -- 18
 (SELECT count(*) FROM member_profiles WHERE (id::text LIKE 'a501%' OR id::text LIKE 'a502%' OR id::text LIKE 'a503%') AND photo_consent ? 'website') AS photo_consent_set;
