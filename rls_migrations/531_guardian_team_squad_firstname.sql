-- mig 531 — Guardian "Team" screen: squad roster → FIRST-NAME ONLY, no ids (privacy).
--
-- CHANGE vs mig 436: the `squad` array previously exposed every OTHER child's FULL name
-- (first + last) AND their stable member_profile_id to any guardian on the team. That
-- breaks the data-minimisation posture already applied on the fixtures screen (mig 530,
-- aggregate counts only). This rewrite:
--   • DROPS member_profile_id from the squad payload entirely — no stable id leaves the DB;
--   • sends FIRST NAME ONLY — the full surname never leaves the database at all;
--   • disambiguates same-first-name teammates with a single last-name INITIAL, computed
--     server-side (two "Jack"s → "Jack S." / "Jack T."; a lone "Jack" stays "Jack").
-- `is_child` (the caller's OWN child, highlighted client-side) is kept — that is the
-- caller's own child, not another family's data. Everything else (header, form, coaches,
-- FA link) is byte-identical to mig 436. Read-only, guardian-gated, single overload,
-- public REVOKEd — identical security envelope to 436.
CREATE OR REPLACE FUNCTION public.guardian_list_child_team(p_child_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_caller uuid;
  v_child  uuid := NULLIF(p_child_profile_id, '')::uuid;
  v_teams  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  IF v_child IS NULL THEN RAISE EXCEPTION 'child_required' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_caller FROM member_profiles WHERE auth_user_id = v_uid;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'no_member_profile' USING ERRCODE='P0001'; END IF;
  IF v_child <> v_caller AND NOT EXISTS (
    SELECT 1 FROM public.member_guardians
    WHERE guardian_profile_id = v_caller AND child_profile_id = v_child AND invite_state = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE='P0001';
  END IF;

  WITH child_teams AS (
    SELECT t.id AS team_id, t.name AS team_name, t.club_id
    FROM public.club_team_members ctm
    JOIN public.club_teams t ON t.id = ctm.team_id AND t.archived_at IS NULL
    WHERE ctm.member_profile_id = v_child AND ctm.is_active = true
  ),
  played AS (
    SELECT ct.team_id,
      (CASE WHEN cf.is_home THEN cf.home_score ELSE cf.away_score END) AS us,
      (CASE WHEN cf.is_home THEN cf.away_score ELSE cf.home_score END) AS them
    FROM child_teams ct
    JOIN public.club_fixtures cf ON cf.club_team_id = ct.team_id
    WHERE cf.status = 'completed' AND cf.home_score IS NOT NULL AND cf.away_score IS NOT NULL
  ),
  form AS (
    SELECT team_id,
      COUNT(*)                          AS played,
      COUNT(*) FILTER (WHERE us > them)  AS won,
      COUNT(*) FILTER (WHERE us = them)  AS drawn,
      COUNT(*) FILTER (WHERE us < them)  AS lost,
      COALESCE(SUM(us - them), 0)        AS gd
    FROM played GROUP BY team_id
  )
  SELECT COALESCE(jsonb_agg(block ORDER BY team_name), '[]'::jsonb)
  INTO v_teams
  FROM (
    SELECT ct.team_name, jsonb_build_object(
      'club_team_id',    ct.team_id,
      'club_team_name',  ct.team_name,
      'club_name',       c.name,
      'league_name',     lg.league_name,
      'season_label',    lg.season_label,
      'fa_embed_code',   lg.fa_embed_code,
      'fa_source_url',   lg.fa_source_url,
      -- reserved: populated by the future FA-standings scrape; header pill hidden while NULL
      'league_position', NULL,
      'form', jsonb_build_object(
        'played', COALESCE(f.played, 0), 'won', COALESCE(f.won, 0),
        'drawn',  COALESCE(f.drawn, 0),  'lost', COALESCE(f.lost, 0),
        'gd',     COALESCE(f.gd, 0)
      ),
      'coaches', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), ''),
          'role', tm.role
        ) ORDER BY tm.assigned_at)
        FROM public.club_team_managers tm
        JOIN public.member_profiles mp ON mp.id = tm.member_profile_id
        WHERE tm.team_id = ct.team_id AND tm.is_active = true
          AND NULLIF(btrim(COALESCE(mp.first_name,'') || ' ' || COALESCE(mp.last_name,'')), '') IS NOT NULL
      ), '[]'::jsonb),
      -- squad: FIRST NAME ONLY, last-initial tiebreak on same-first-name collisions,
      -- NO member_profile_id (privacy — mig 531). Surnames are used only server-side
      -- (collision test + sort); only the first name (+ a single initial) is emitted.
      'squad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', CASE
                    WHEN s.dupe AND s.last_name <> ''
                      THEN s.first_name || ' ' || upper(left(s.last_name, 1)) || '.'
                    ELSE s.first_name
                  END,
          'is_child', s.is_child
        ) ORDER BY lower(s.first_name), lower(s.last_name))
        FROM (
          SELECT
            btrim(COALESCE(mp.first_name, ''))                        AS first_name,
            btrim(COALESCE(mp.last_name, ''))                         AS last_name,
            (mp.id = v_child)                                         AS is_child,
            COUNT(*) OVER (PARTITION BY lower(btrim(COALESCE(mp.first_name, '')))) > 1 AS dupe
          FROM public.club_team_members sm
          JOIN public.member_profiles mp ON mp.id = sm.member_profile_id
          WHERE sm.team_id = ct.team_id AND sm.is_active = true
            AND NULLIF(btrim(COALESCE(mp.first_name, '')), '') IS NOT NULL
        ) s
      ), '[]'::jsonb)
    ) AS block
    FROM child_teams ct
    JOIN public.clubs c ON c.id = ct.club_id
    LEFT JOIN form f ON f.team_id = ct.team_id
    LEFT JOIN LATERAL (
      SELECT cl.name AS league_name, cl.season_label, cl.fa_embed_code, cl.fa_source_url
      FROM public.club_fixtures cf
      JOIN public.club_leagues cl ON cl.id = cf.league_id AND cl.archived_at IS NULL
      WHERE cf.club_team_id = ct.team_id
      ORDER BY cf.scheduled_date DESC NULLS LAST
      LIMIT 1
    ) lg ON true
  ) blocks;

  RETURN jsonb_build_object(
    'ok', true,
    'child_profile_id', v_child,
    'caller_profile_id', v_caller,
    'teams', COALESCE(v_teams, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guardian_list_child_team(text) FROM public;
GRANT EXECUTE ON FUNCTION public.guardian_list_child_team(text) TO anon, authenticated;
