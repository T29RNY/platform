-- 480_fix_demo_match_fitness_shape_and_durations.sql
--
-- Demo-data correction for the match-fitness seed (migs 475–478). Two defects surfaced
-- during live surface verification (session on 2026-07-04). BOTH touch demo rows only
-- (match_health_sessions.client_session_id LIKE 'cs_mf_%') and NO real user data:
--
--   1. duration_seconds was NULL on every seeded session, so the "Minutes" stat renders
--      blank ("—" / 0) on every fitness surface (MyIO card, per-game card, Stats section).
--      Backfill a realistic per-session duration derived from distance (~1.7 m/s average
--      incl. standing → a plausible 50–65 min 5-a-side match). Indoor rows (no distance)
--      fall back to a 50 min default.
--
--   2. GPS route tracks were seeded as bare [lat,lon] coordinate-pair arrays
--      ({"points":[[51.5,-0.12], …]}), but the canonical shape produced by the real
--      native ingestion (apps/inorout/src/native/native-health.js → {points:[{lat,lon,t}]})
--      is objects. MatchRouteHeatmap.parsePoints read only p.lat/p.lon, dropped every
--      pair, and rendered nothing — a silent blank "View route". Reshape the demo tracks
--      to the canonical {lat,lon} object form so the demo mirrors real data.
--      (The renderer is ALSO hardened in the same change set to accept both shapes, so it
--       degrades gracefully if a producer ever emits pairs.)
--
-- Idempotent: the duration update only fills NULLs; the route update only touches tracks
-- whose points are still arrays. Re-running is a no-op.

-- 1) Backfill durations.
UPDATE public.match_health_sessions
SET duration_seconds = round(coalesce(distance_meters, 5100) / 1.7)
WHERE client_session_id LIKE 'cs_mf_%'
  AND duration_seconds IS NULL;

-- 2) Reshape pair-array route points → {lat, lon} objects (demo routes only).
UPDATE public.match_health_routes r
SET track = jsonb_build_object(
  'points',
  (SELECT coalesce(jsonb_agg(jsonb_build_object('lat', pt->0, 'lon', pt->1)), '[]'::jsonb)
     FROM jsonb_array_elements(r.track->'points') AS pt)
)
FROM public.match_health_sessions s
WHERE s.id = r.session_id
  AND s.client_session_id LIKE 'cs_mf_%'
  AND jsonb_typeof(r.track->'points') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(r.track->'points') AS pt
    WHERE jsonb_typeof(pt) = 'array'
  );
