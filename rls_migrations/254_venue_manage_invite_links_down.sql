-- ════════════════════════════════════════════════════════════
-- DOWN — Migration 254 (QR Onboarding slice 7 invite-link management)
-- Drops the four management RPCs + the shared ownership helper. The
-- invite_links table and slice-1/4/6 RPCs are untouched (earlier migs).
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.venue_list_invite_links(text);
DROP FUNCTION IF EXISTS public.venue_repoint_invite_link(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.venue_set_invite_link_active(text, text, boolean);
DROP FUNCTION IF EXISTS public.venue_create_invite_link(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.venue_owns_entity(text, text, text);

SELECT pg_notify('pgrst', 'reload schema');
