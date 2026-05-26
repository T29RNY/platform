-- 076_platform_admins_gmail_grant_down.sql
--
-- Revoke the Gmail platform-admin grant added by migration 076.
-- Leaves the original tarny@desicity.com seed in place.

DELETE FROM platform_admins
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'tarnysingh@gmail.com');
