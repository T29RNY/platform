-- =============================================================================
-- Migration 509 DOWN: remove PA Sports multi-role test logins
-- =============================================================================
-- Run FIRST (before 506/507 downs) so auth links are cleared.
-- =============================================================================

DELETE FROM venue_admins   WHERE id::text LIKE 'a5ad%';
UPDATE member_profiles SET auth_user_id = NULL WHERE auth_user_id::text LIKE 'a5f0%';
DELETE FROM auth.identities WHERE user_id::text LIKE 'a5f0%';
DELETE FROM auth.users      WHERE id::text LIKE 'a5f0%';
