-- 600_pa_admin_real_email_down.sql
--
-- Reverses 600: restores the PA admin account's email to the +pa_admin operator alias.
-- Password, venue_admins grants and profile link were never touched, so this is a
-- straight email/identity restore.

BEGIN;

UPDATE auth.users
SET email = 'tarnysingh+pa_admin@gmail.com',
    raw_user_meta_data = jsonb_set(
      COALESCE(raw_user_meta_data, '{}'::jsonb), '{email}', '"tarnysingh+pa_admin@gmail.com"'),
    updated_at = now()
WHERE id = 'a5f00000-0000-4000-8000-000000000001';

UPDATE auth.identities
SET identity_data = jsonb_set(identity_data, '{email}', '"tarnysingh+pa_admin@gmail.com"'),
    updated_at = now()
WHERE user_id = 'a5f00000-0000-4000-8000-000000000001'
  AND provider = 'email';

COMMIT;
