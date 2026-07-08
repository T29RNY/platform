-- =============================================================================
-- Migration 512 DOWN: remove PA Sports memberships/fees + shop + sponsors + content
-- =============================================================================

DELETE FROM venue_charges
 WHERE source_type='membership'
   AND source_id IN (SELECT id::text FROM venue_memberships WHERE club_id='club_pa_sports');
DELETE FROM venue_memberships       WHERE club_id='club_pa_sports';
DELETE FROM venue_membership_tiers  WHERE id::text LIKE 'a5f1%';
DELETE FROM club_merchandise        WHERE club_id='club_pa_sports';
DELETE FROM club_sponsors           WHERE club_id='club_pa_sports';
DELETE FROM club_events             WHERE club_id='club_pa_sports';
DELETE FROM club_documents          WHERE club_id='club_pa_sports';
DELETE FROM club_posts              WHERE club_id='club_pa_sports';
