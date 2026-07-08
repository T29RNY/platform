-- =============================================================================
-- Migration 505 DOWN: remove PA Sports operator + venues + pitches + club + branding
-- =============================================================================
-- Deletes ONLY the deterministic PA Sports seed rows. Never touches other data.
-- Run AFTER the later PA Sports teardowns (509→508→507→506→505) so FKs are clear.
-- =============================================================================

DELETE FROM club_committee   WHERE club_id = 'club_pa_sports';
DELETE FROM club_pages       WHERE club_id = 'club_pa_sports';
DELETE FROM club_venues      WHERE club_id = 'club_pa_sports';
DELETE FROM playing_areas    WHERE venue_id IN ('pa_peugeot','seva_school');
DELETE FROM clubs            WHERE id = 'club_pa_sports';
DELETE FROM venues           WHERE id IN ('pa_peugeot','seva_school');
DELETE FROM companies        WHERE id = 'company_pa_sports';
