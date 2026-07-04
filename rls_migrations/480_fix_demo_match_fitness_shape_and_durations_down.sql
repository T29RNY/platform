-- 480_fix_demo_match_fitness_shape_and_durations_down.sql
-- Revert the demo-data correction: restore NULL durations and pair-array route points
-- on the seeded demo rows only (client_session_id LIKE 'cs_mf_%').

UPDATE public.match_health_sessions
SET duration_seconds = NULL
WHERE client_session_id LIKE 'cs_mf_%';

UPDATE public.match_health_routes r
SET track = jsonb_build_object(
  'points',
  (SELECT coalesce(jsonb_agg(jsonb_build_array(pt->'lat', pt->'lon')), '[]'::jsonb)
     FROM jsonb_array_elements(r.track->'points') AS pt)
)
FROM public.match_health_sessions s
WHERE s.id = r.session_id
  AND s.client_session_id LIKE 'cs_mf_%'
  AND jsonb_typeof(r.track->'points') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(r.track->'points') AS pt
    WHERE jsonb_typeof(pt) = 'object'
  );
