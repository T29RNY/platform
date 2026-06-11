-- ════════════════════════════════════════════════════════════
-- Down — Migration 248 (invite_links routing layer)
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.redeem_invite_link(text);
DROP FUNCTION IF EXISTS public.resolve_invite_link(text);
DROP TABLE IF EXISTS public.invite_links;

SELECT pg_notify('pgrst', 'reload schema');
