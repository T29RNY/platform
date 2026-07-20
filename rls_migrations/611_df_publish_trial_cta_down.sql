-- 611_df_publish_trial_cta_down.sql — reverse of 611_df_publish_trial_cta.sql
-- Unpublish DF + turn the trial CTA back off. Branding is left in place (harmless, and the
-- operator may have refined it since go-live).
BEGIN;

UPDATE public.club_pages
SET published = false, trial_cta_enabled = false
WHERE slug = 'df-sports-coaching';

COMMIT;
