-- 519: Club Console consolidation PR #6 Phase B — adult-member SELF reliability/POTM reader.
--
-- The self-scoped twin of 517's coach board (club_manager_get_team_ratings_table).
-- Where 517 is coach-auth and returns the WHOLE squad (identities needed to pick
-- teams), THIS is member-auth and returns ONLY the caller's OWN row, per club team
-- they are an active member of. It powers the member track's "Stats" tab in the
-- native /hub shell (Club Console PR #6 Phase A shipped schedule/matches/membership;
-- reliability/POTM was deferred here because it needed a self reader).
--
-- DPIA (the load-bearing difference from 517): self scope ONLY. Auth is
-- auth.uid() -> member_profiles.id (the caller's OWN self profile, NEVER a child's,
-- NEVER a manager reading a squad). Every aggregate is filtered to
-- member_profile_id = v_profile_id, so the payload can only ever contain the caller's
-- own appearances/turnout — no other member's name, stats or identity is returned.
-- An adult who is ALSO a guardian of a U18 therefore gets their own player form here
-- with zero child PII, cleanly separated from the guardian child-proxy view.
--
-- Reliability semantics are IDENTICAL to 517 (all-time per CLAUDE.md convention):
-- denominator = the team's past, non-void fixtures where availability was actually
-- solicited (>=1 RSVP across the squad); numerator = the caller's own 'in' RSVPs.
-- Appearances/goals/POTM/form come from club_fixture_player_stats for the caller,
-- joined to club_fixtures for the W/D/L result (our score = is_home?home:away).
--
-- Per-team (a member can belong to more than one club team; reliability is a per-team
-- denominator, so aggregating across teams would be misleading). One card per team.
--
-- Reads only columns 517 already exercises live; no clubs-table dependency (the club
-- name already shows in the /hub header). SECDEF, search_path pinned, single overload,
-- REVOKE PUBLIC+anon / GRANT authenticated. Read-only -> no audit (matches 517).
CREATE OR REPLACE FUNCTION public.club_member_get_self_reliability()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_teams      jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;

  WITH my_teams AS (
    -- the caller's active club-team memberships (self scope entry point)
    SELECT ct.id AS team_id, ct.name AS team_name
    FROM club_team_members cm
    JOIN club_teams ct ON ct.id = cm.team_id
    WHERE cm.member_profile_id = v_profile_id AND cm.is_active = true
  ),
  past AS (
    -- per-team reliability denominator (517's rule: past non-void fixtures with >=1 RSVP)
    SELECT cf.club_team_id AS team_id, count(*) AS past_n
    FROM club_fixtures cf
    WHERE cf.club_team_id IN (SELECT team_id FROM my_teams)
      AND cf.status <> 'void'
      AND (cf.status = 'completed' OR cf.scheduled_date <= current_date)
      AND EXISTS (SELECT 1 FROM club_fixture_availability fa WHERE fa.fixture_id = cf.id)
    GROUP BY cf.club_team_id
  ),
  my_turnout AS (
    -- the caller's OWN 'in' count per team (numerator)
    SELECT cf.club_team_id AS team_id, count(*) FILTER (WHERE fa.status = 'in') AS in_ct
    FROM club_fixture_availability fa
    JOIN club_fixtures cf ON cf.id = fa.fixture_id
    WHERE fa.member_profile_id = v_profile_id
      AND cf.club_team_id IN (SELECT team_id FROM my_teams)
      AND cf.status <> 'void'
      AND (cf.status = 'completed' OR cf.scheduled_date <= current_date)
    GROUP BY cf.club_team_id
  ),
  my_appear AS (
    -- the caller's OWN appearances per team, with the fixture result
    SELECT cf.club_team_id AS team_id, s.fixture_id, cf.scheduled_date,
           s.goals, s.is_potm,
           CASE WHEN cf.home_score IS NOT NULL AND cf.away_score IS NOT NULL THEN
             CASE WHEN cf.home_score = cf.away_score THEN 'd'
                  WHEN (cf.is_home AND cf.home_score > cf.away_score)
                    OR (NOT cf.is_home AND cf.away_score > cf.home_score) THEN 'w'
                  ELSE 'l' END
           END AS result
    FROM club_fixture_player_stats s
    JOIN club_fixtures cf ON cf.id = s.fixture_id
    WHERE s.member_profile_id = v_profile_id
      AND cf.club_team_id IN (SELECT team_id FROM my_teams)
      AND cf.status <> 'void'
  ),
  my_agg AS (
    SELECT team_id,
           count(*) FILTER (WHERE result IS NOT NULL) AS played,
           count(*) FILTER (WHERE result = 'w')       AS wins,
           count(*) FILTER (WHERE result = 'd')       AS draws,
           count(*) FILTER (WHERE result = 'l')       AS losses,
           COALESCE(sum(goals), 0)                    AS goals,
           count(*) FILTER (WHERE is_potm)            AS potm
    FROM my_appear GROUP BY team_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_id',     mt.team_id,
           'team_name',   mt.team_name,
           'played',      COALESCE(ag.played, 0),
           'wins',        COALESCE(ag.wins, 0),
           'draws',       COALESCE(ag.draws, 0),
           'losses',      COALESCE(ag.losses, 0),
           'winRate',     CASE WHEN COALESCE(ag.played, 0) > 0
                               THEN round(100.0 * ag.wins / ag.played)::int ELSE 0 END,
           'goals',       COALESCE(ag.goals, 0),
           'potm',        COALESCE(ag.potm, 0),
           'form',        COALESCE((
                            SELECT jsonb_agg(upper(f.result) ORDER BY f.scheduled_date DESC, f.fixture_id)
                            FROM (SELECT ap.result, ap.scheduled_date, ap.fixture_id
                                  FROM my_appear ap
                                  WHERE ap.team_id = mt.team_id AND ap.result IS NOT NULL
                                  ORDER BY ap.scheduled_date DESC NULLS LAST, ap.fixture_id LIMIT 5) f
                          ), '[]'::jsonb),
           'reliability', round(100.0 * COALESCE(tn.in_ct, 0) / GREATEST(COALESCE(pa.past_n, 0), 1))::int,
           'invited',     COALESCE(pa.past_n, 0)
         ) ORDER BY mt.team_name), '[]'::jsonb)
  INTO v_teams
  FROM my_teams mt
  LEFT JOIN my_agg     ag ON ag.team_id = mt.team_id
  LEFT JOIN my_turnout tn ON tn.team_id = mt.team_id
  LEFT JOIN past       pa ON pa.team_id = mt.team_id;

  RETURN jsonb_build_object('ok', true, 'teams', v_teams);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_member_get_self_reliability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_member_get_self_reliability() TO authenticated;

SELECT pg_notify('pgrst','reload schema');
