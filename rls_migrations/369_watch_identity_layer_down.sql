-- Down for 369 — watchOS companion identity layer.

DROP FUNCTION IF EXISTS public.get_my_next_assignment(text);
DROP FUNCTION IF EXISTS public.club_admin_assign_cohort_official(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.assign_casual_match_ref(text, text, text);
DROP FUNCTION IF EXISTS public.venue_link_official_to_user(text, uuid, text);
DROP FUNCTION IF EXISTS public.ref_link_self_to_official();

DROP INDEX IF EXISTS public.matches_ref_player_id_idx;
DROP INDEX IF EXISTS public.matches_ref_token_uniq;
ALTER TABLE public.matches        DROP COLUMN IF EXISTS ref_token;
ALTER TABLE public.matches        DROP COLUMN IF EXISTS ref_player_id;
ALTER TABLE public.club_cohorts   DROP COLUMN IF EXISTS primary_official_id;
DROP INDEX IF EXISTS public.match_officials_user_id_idx;
ALTER TABLE public.match_officials DROP COLUMN IF EXISTS user_id;

SELECT pg_notify('pgrst', 'reload schema');
