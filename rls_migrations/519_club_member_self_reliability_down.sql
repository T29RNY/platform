-- 519 down: remove the adult-member self reliability/POTM reader.
DROP FUNCTION IF EXISTS public.club_member_get_self_reliability();

SELECT pg_notify('pgrst','reload schema');
