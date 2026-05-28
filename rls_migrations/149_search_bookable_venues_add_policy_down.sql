-- Down for 149 — restore mig 140 search_bookable_venues (no cancellation_policy field).

CREATE OR REPLACE FUNCTION public.search_bookable_venues(p_query text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'venue_id', s.id, 'name', s.name, 'slug', s.slug, 'city', s.city)
         ORDER BY s.name), '[]'::jsonb)
  FROM (
    SELECT v.id, v.name, v.slug, v.city
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
