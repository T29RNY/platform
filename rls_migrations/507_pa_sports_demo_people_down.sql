-- =============================================================================
-- Migration 507 DOWN: remove PA Sports demo players + guardians + rosters
-- =============================================================================
-- This is also the GO-LIVE teardown for demo players (structure/staff untouched).
-- Ranges: a501* (Dortmund), a502* (Milan), a503* (Mens) member_profiles.
-- =============================================================================

DELETE FROM club_team_members
 WHERE member_profile_id::text LIKE 'a501%'
    OR member_profile_id::text LIKE 'a502%'
    OR member_profile_id::text LIKE 'a503%';

DELETE FROM member_guardians
 WHERE child_profile_id::text LIKE 'a501%'
    OR child_profile_id::text LIKE 'a502%';

DELETE FROM member_profiles
 WHERE id::text LIKE 'a501%'
    OR id::text LIKE 'a502%'
    OR id::text LIKE 'a503%';
