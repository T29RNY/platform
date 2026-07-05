-- 481: get_match_health_for_match — add per-row team_assignment (Team A vs Team B fitness card)
--
-- TEAM_VS_TEAM_FITNESS_HANDOFF.md, PR #1. Additive-only display-shape change over data the
-- per-match card already shows per-player. The Results "MATCH FITNESS" block gains a Team A vs
-- Team B distance comparison line; all A/B aggregation is client-side, so the ONLY server change
-- is returning which scrimmage side each already-returned row was on.
--
-- Base = the mig-475 body VERBATIM (U18 read-guard + consent gate), with ONE additive change:
--   • LEFT JOIN player_match pm ON pm.player_id = p.id AND pm.match_id = s.match_ref  (inside the
--     existing `disp` lateral) → select pm.team_assignment; add disp.team_assignment to the outer
--     SELECT (rides into to_jsonb(r) automatically).
--
-- Why no new consent surface (HANDOFF security note): team_assignment ONLY rides rows the reader
-- already consent-gates + U18-filters. It reveals nothing new — every figure summed into a side
-- total is already individually attributed on the same card. No min-N floor needed BECAUSE totals
-- render ALONGSIDE the per-player rows (LOCKED DECISION 1).
--
-- No fan-out: player_match has UNIQUE (match_id, player_id) → at most one pm row per pair, so the
-- join adds at most one row per session; the lateral's LIMIT 1 is redundant-but-harmless belt.
-- No side/name desync: pm.player_id = p.id keys off the SAME resolved player the name/consent come
-- from, inside the same lateral (matches m ON m.team_id = tp.team_id disambiguates multi-players users).
-- player_match.match_id is TEXT and match_health_sessions.match_ref is text → valid text=text join.
-- Casual match_ref = matches.id → joins; league match_ref = fixtures.id → never equals a
-- player_match.match_id → team_assignment NULL → no block. Automatic (no league guard needed).
--
-- Signature unchanged (one text arg) → no overload, no grant change. SECDEF + search_path pin +
-- REVOKE anon,authenticated,public / GRANT authenticated all preserved (HR#11: no other line drifts).
-- Tier-3 (RLS + special-category health data reader). Ephemeral-verified with rollback, APPLIED
-- ONLY after operator sign-off.

CREATE OR REPLACE FUNCTION get_match_health_for_match(p_match_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_rows    jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;
  IF p_match_ref IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='missing_required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.is_self DESC, r.ended_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id                                   AS session_id,
      (s.user_id = v_user_id)                AS is_self,
      COALESCE(disp.name, 'Player')          AS player_name,
      disp.team_assignment                   AS team_assignment,
      s.match_context,
      s.duration_seconds,
      s.active_energy_kcal,
      s.distance_meters,
      s.avg_hr,
      s.max_hr,
      s.hr_zones,
      s.source,
      EXISTS (SELECT 1 FROM match_health_routes mr WHERE mr.session_id = s.id) AS has_route,
      s.started_at,
      s.ended_at
    FROM match_health_sessions s
    LEFT JOIN LATERAL (
      SELECT p.name, p.share_match_fitness, pm.team_assignment
        FROM players p
        JOIN team_players tp ON tp.player_id = p.id
        JOIN matches m       ON m.id = s.match_ref AND m.team_id = tp.team_id
        LEFT JOIN player_match pm ON pm.player_id = p.id AND pm.match_id = s.match_ref
       WHERE p.user_id = s.user_id
       LIMIT 1
    ) disp ON true
    WHERE s.match_ref = p_match_ref
      AND NOT _health_is_under_18(s.user_id)
      AND (
        s.user_id = v_user_id
        OR (s.match_context = 'casual' AND COALESCE(disp.share_match_fitness, false) = true)
      )
  ) r;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION get_match_health_for_match(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION get_match_health_for_match(text) TO authenticated;

-- Refresh PostgREST so the changed RPC resolves immediately (avoids the 404 cache trap).
SELECT pg_notify('pgrst', 'reload schema');
