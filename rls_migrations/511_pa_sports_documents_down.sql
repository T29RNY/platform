-- =============================================================================
-- Migration 511 DOWN: remove PA Sports documents & consents
-- =============================================================================

DELETE FROM consent_acceptances
 WHERE document_id IN (SELECT id FROM policy_documents WHERE club_id='club_pa_sports');
DELETE FROM member_id_documents   WHERE club_id='club_pa_sports';
DELETE FROM member_record_reviews
 WHERE member_profile_id::text LIKE 'a501%' OR member_profile_id::text LIKE 'a502%';
DELETE FROM policy_documents      WHERE club_id='club_pa_sports';

-- Revert the profile flag updates
UPDATE member_profiles
SET photo_consent = '{}'::jsonb, consent_emergency_treatment = false,
    consent_administer_medication = false, medical_conditions = NULL, allergies = NULL
WHERE (id::text LIKE 'a501%' OR id::text LIKE 'a502%' OR id::text LIKE 'a503%');
