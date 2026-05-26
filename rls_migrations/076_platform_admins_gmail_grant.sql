-- 076_platform_admins_gmail_grant.sql
--
-- Grant platform_admins to tarnysingh@gmail.com (operator's daily
-- Gmail account) in addition to the existing tarny@desicity.com
-- seed. Both addresses belong to the same human operator; the
-- Gmail is what's signed in on the PWA day-to-day so it's the more
-- convenient identity for opening the superadmin dashboard.
--
-- Applied live 2026-05-26 via MCP execute_sql. Source file lands
-- here per CLAUDE.md hard rule #11 to keep live DB and source code
-- aligned.
--
-- This is idempotent — re-runnable safely via ON CONFLICT.

INSERT INTO platform_admins (user_id, granted_by, note)
SELECT
  (SELECT id FROM auth.users WHERE email = 'tarnysingh@gmail.com'),
  (SELECT id FROM auth.users WHERE email = 'tarny@desicity.com'),
  'Self-grant via SQL — tarnysingh@gmail.com for daily PWA-account access. 2026-05-26.'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'tarnysingh@gmail.com')
ON CONFLICT (user_id) DO NOTHING;
