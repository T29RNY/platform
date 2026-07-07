-- Down-migration for 488 — Venue Setup Wizard PR-W5.
-- Drops the three new RPCs and restores search_bookable_venues to its mig-149 body
-- (WITHOUT the verification_status filter).

DROP FUNCTION IF EXISTS public.venue_finalize_setup(text);
DROP FUNCTION IF EXISTS public.superadmin_set_venue_verification(text, text);
DROP FUNCTION IF EXISTS public.superadmin_list_venues();

-- Restore search_bookable_venues verbatim from mig 149 (pre-enforcement).
CREATE OR REPLACE FUNCTION public.search_bookable_venues(p_query text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'venue_id', s.id, 'name', s.name, 'slug', s.slug, 'city', s.city,
           'cancellation_policy', s.cancellation_policy)
         ORDER BY s.name), '[]'::jsonb)
  FROM (
    SELECT v.id, v.name, v.slug, v.city, v.cancellation_policy
    FROM venues v
    WHERE v.bookings_enabled = true AND v.active = true
      AND (
        p_query IS NULL OR length(trim(p_query)) = 0
        OR v.name ILIKE '%' || trim(p_query) || '%'
        OR v.slug ILIKE '%' || trim(p_query) || '%'
        OR v.city ILIKE '%' || trim(p_query) || '%'
      )
    ORDER BY v.name
    LIMIT 20
  ) s;
$function$;
REVOKE ALL ON FUNCTION public.search_bookable_venues(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_bookable_venues(text) TO anon, authenticated;
