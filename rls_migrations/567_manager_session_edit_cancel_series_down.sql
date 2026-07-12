-- 567 DOWN: drop the two additive manager write RPCs (edit + cancel-series). No
-- dependents beyond the same-PR @platform/core wrappers + calendar UI; the shipped
-- occupancy trigger/engine they reuse are untouched by this migration.
DROP FUNCTION IF EXISTS public.club_manager_update_session(uuid,text,timestamptz,int,text,uuid,text,text,int,timestamptz,boolean);
DROP FUNCTION IF EXISTS public.club_manager_cancel_series(uuid,text);
SELECT pg_notify('pgrst', 'reload schema');
