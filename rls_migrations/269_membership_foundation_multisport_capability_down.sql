-- 269_membership_foundation_multisport_capability_down.sql
-- Reverse of 269. Restores the pre-membership caps CHECK and drops the two
-- additive columns. NOTE: the caps-CHECK restore will fail if any venue_admins
-- row still grants/denies 'manage_memberships' — clear those first.

ALTER TABLE public.venue_admins DROP CONSTRAINT IF EXISTS venue_admins_caps_known;
ALTER TABLE public.venue_admins ADD CONSTRAINT venue_admins_caps_known CHECK (
  caps_grant <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins']::text[]
  AND caps_deny <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins']::text[]
);

ALTER TABLE public.playing_areas DROP COLUMN IF EXISTS sport;
ALTER TABLE public.venues DROP COLUMN IF EXISTS sports;
