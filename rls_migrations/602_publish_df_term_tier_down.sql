-- 602_publish_df_term_tier_down.sql
-- Reverses 602 — un-publish DF's Term tier (remove the self_signup flag → fail-closed hidden).
UPDATE public.venue_membership_tiers
SET benefits   = benefits - 'self_signup',
    updated_at = now()
WHERE venue_id = 'v_ffff5528a0' AND name = 'Term Membership';
