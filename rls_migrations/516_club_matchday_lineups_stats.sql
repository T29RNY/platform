-- 516: Club Manager epic PR #8 — MATCHDAY DEPTH (line-ups + per-player stats).
--
-- The one substantial new-build of the epic. A coach picks a starting XI from the
-- availability roster, logs per-player match stats (goals/assists/cards/minutes) + a
-- per-match POTM, and sets the aggregate result — and the public club page's
-- top-scorer board finally populates.
--
-- LOCKED DECISION 4: build NEW club-side tables; do NOT unify with or route through
-- the casual/ref match_events/player_match engine. These tables + RPCs are the
-- club-side matchday store; the shared *compute* engines (PR #7) read from them later.
--
-- AUTH = club-manager (coach): auth.uid → member_profiles → club_team_managers(is_active)
-- for the fixture's OWN team (club_fixtures.club_team_id). Surfaced in the /hub coach
-- track (apps/inorout/src/mobile), NOT the venue-admin console. All writers authenticated-
-- only (anon REVOKEd), SECDEF, search_path pinned, single overload, audit HR#9 (ids/counts,
-- never child names/PII).
--
-- Consumers (HR#14): apps/inorout /hub TeamManagerMatchday.jsx (the 3 club_manager_*
-- matchday RPCs); club_fixture_player_stats is ALSO read by get_club_public top-scorer
-- (anon-facing) — so a later stat-shape change must keep the public board in view.

-- ─── 1. tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_fixture_lineups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id        uuid NOT NULL REFERENCES public.club_fixtures(id) ON DELETE CASCADE,
  member_profile_id uuid NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  is_starter        boolean NOT NULL DEFAULT true,
  position          text,
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, member_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_club_fixture_lineups_fixture ON public.club_fixture_lineups(fixture_id);
ALTER TABLE public.club_fixture_lineups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_fixture_lineups FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.club_fixture_player_stats (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id        uuid NOT NULL REFERENCES public.club_fixtures(id) ON DELETE CASCADE,
  member_profile_id uuid NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  goals             int NOT NULL DEFAULT 0 CHECK (goals >= 0),
  assists           int NOT NULL DEFAULT 0 CHECK (assists >= 0),
  yellow_cards      int NOT NULL DEFAULT 0 CHECK (yellow_cards >= 0 AND yellow_cards <= 2),
  red_cards         int NOT NULL DEFAULT 0 CHECK (red_cards >= 0 AND red_cards <= 1),
  minutes           int CHECK (minutes IS NULL OR (minutes >= 0 AND minutes <= 200)),
  is_potm           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, member_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_club_fixture_player_stats_fixture ON public.club_fixture_player_stats(fixture_id);
-- at most one POTM per fixture
CREATE UNIQUE INDEX IF NOT EXISTS uq_club_fixture_potm ON public.club_fixture_player_stats(fixture_id) WHERE is_potm;
ALTER TABLE public.club_fixture_player_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_fixture_player_stats FROM anon, authenticated;

-- ─── 2. shared coach-auth resolver for a fixture ──────────────────────────────
-- Given a fixture id + the signed-in caller, returns the fixture's OWN club_team_id
-- ONLY if the caller actively manages that team. Raises otherwise. Keeps the 3 RPCs DRY.
CREATE OR REPLACE FUNCTION public._club_manager_fixture_team(p_fixture_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_team_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'not_authorised' USING ERRCODE='P0001'; END IF;
  SELECT club_team_id INTO v_team_id FROM club_fixtures WHERE id = p_fixture_id;
  IF v_team_id IS NULL THEN
    -- either the fixture doesn't exist or it has no "our team" attributed → can't manage
    RAISE EXCEPTION 'fixture_no_team' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers
    WHERE team_id = v_team_id AND member_profile_id = v_profile_id AND is_active = true
  ) THEN RAISE EXCEPTION 'not_manager' USING ERRCODE='P0001'; END IF;
  RETURN v_team_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public._club_manager_fixture_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._club_manager_fixture_team(uuid) TO authenticated;

-- ─── 3. reader: one fixture's full matchday detail ────────────────────────────
-- The list reader (club_manager_list_team_fixtures) roster carries no member_profile_id;
-- the lineup/stat picker needs ids, so this is the single fetch the matchday screen loads.
CREATE OR REPLACE FUNCTION public.club_manager_get_fixture_detail(p_fixture_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_team_id uuid := public._club_manager_fixture_team(p_fixture_id);   -- gate + team
  v_fx      record;
  v_roster  jsonb;
  v_stats   jsonb;
BEGIN
  SELECT cf.id, cf.opponent_name, cf.is_home, cf.scheduled_date,
         to_char(cf.kickoff_time,'HH24:MI') AS kickoff_time,
         cf.home_score, cf.away_score, cf.status, cf.club_team_id,
         COALESCE(cf.club_team_name, ct.name) AS our_team
    INTO v_fx
    FROM club_fixtures cf LEFT JOIN club_teams ct ON ct.id = cf.club_team_id
   WHERE cf.id = p_fixture_id;

  -- active roster + availability + any existing lineup selection (ids INCLUDED)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'member_profile_id', mp.id,
           'name', mp.first_name || COALESCE(' ' || mp.last_name, ''),
           'status', COALESCE(fa.status, 'pending'),
           'is_starter', ln.is_starter,
           'position', ln.position,
           'selected', (ln.member_profile_id IS NOT NULL)
         ) ORDER BY mp.first_name), '[]'::jsonb)
    INTO v_roster
    FROM club_team_members cm
    JOIN member_profiles mp ON mp.id = cm.member_profile_id
    LEFT JOIN club_fixture_availability fa
      ON fa.fixture_id = p_fixture_id AND fa.member_profile_id = cm.member_profile_id
    LEFT JOIN club_fixture_lineups ln
      ON ln.fixture_id = p_fixture_id AND ln.member_profile_id = cm.member_profile_id
   WHERE cm.team_id = v_team_id AND cm.is_active = true;

  -- existing per-player stats
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'member_profile_id', s.member_profile_id,
           'goals', s.goals, 'assists', s.assists,
           'yellow_cards', s.yellow_cards, 'red_cards', s.red_cards,
           'minutes', s.minutes, 'is_potm', s.is_potm
         )), '[]'::jsonb)
    INTO v_stats
    FROM club_fixture_player_stats s
   WHERE s.fixture_id = p_fixture_id;

  RETURN jsonb_build_object(
    'ok', true,
    'fixture', jsonb_build_object(
      'fixture_id', v_fx.id, 'opponent_name', v_fx.opponent_name, 'is_home', v_fx.is_home,
      'scheduled_date', v_fx.scheduled_date, 'kickoff_time', v_fx.kickoff_time,
      'home_score', v_fx.home_score, 'away_score', v_fx.away_score, 'status', v_fx.status,
      'our_team', v_fx.our_team, 'team_id', v_fx.club_team_id
    ),
    'roster', v_roster,
    'stats', v_stats
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_manager_get_fixture_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_get_fixture_detail(uuid) TO authenticated;

-- ─── 4. writer: set the line-up (replace-all XI) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.club_manager_set_fixture_lineup(p_fixture_id uuid, p_selections jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_team_id uuid := public._club_manager_fixture_team(p_fixture_id);   -- gate + team
  v_uid     uuid := auth.uid();
  v_sel     jsonb;
  v_pid     uuid;
  v_n       int := 0;
BEGIN
  IF p_selections IS NULL OR jsonb_typeof(p_selections) <> 'array' THEN
    RAISE EXCEPTION 'selections_invalid' USING ERRCODE='P0001';
  END IF;

  -- validate every selected member is on THIS team's active roster (reject strangers)
  FOR v_sel IN SELECT * FROM jsonb_array_elements(p_selections) LOOP
    v_pid := NULLIF(v_sel->>'member_profile_id','')::uuid;
    IF v_pid IS NULL THEN RAISE EXCEPTION 'member_required' USING ERRCODE='P0001'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM club_team_members
      WHERE team_id = v_team_id AND member_profile_id = v_pid AND is_active = true
    ) THEN RAISE EXCEPTION 'member_not_on_team' USING ERRCODE='P0001'; END IF;
  END LOOP;

  -- replace-all (idempotent)
  DELETE FROM club_fixture_lineups WHERE fixture_id = p_fixture_id;
  INSERT INTO club_fixture_lineups (fixture_id, member_profile_id, is_starter, position, sort_order)
  SELECT p_fixture_id,
         (e->>'member_profile_id')::uuid,
         COALESCE((e->>'is_starter')::boolean, true),
         NULLIF(btrim(COALESCE(e->>'position','')),''),
         COALESCE((e->>'sort_order')::int, 0)
    FROM jsonb_array_elements(p_selections) e;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'player', 'club_manager_set_lineup', 'club_fixture', p_fixture_id::text,
          jsonb_build_object('team_id', v_team_id, 'fixture_id', p_fixture_id, 'selected', v_n));
  RETURN jsonb_build_object('ok', true, 'selected', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_manager_set_fixture_lineup(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_set_fixture_lineup(uuid, jsonb) TO authenticated;

-- ─── 5. writer: record per-player stats + aggregate result ────────────────────
CREATE OR REPLACE FUNCTION public.club_manager_record_fixture_stats(
  p_fixture_id uuid,
  p_stats      jsonb,
  p_home_score int  DEFAULT NULL,
  p_away_score int  DEFAULT NULL,
  p_status     text DEFAULT 'completed'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_team_id uuid := public._club_manager_fixture_team(p_fixture_id);   -- gate + team
  v_uid     uuid := auth.uid();
  v_status  text := lower(btrim(COALESCE(p_status,'completed')));
  v_e       jsonb;
  v_pid     uuid;
  v_potm    int := 0;
  v_n       int := 0;
BEGIN
  IF p_stats IS NULL OR jsonb_typeof(p_stats) <> 'array' THEN
    RAISE EXCEPTION 'stats_invalid' USING ERRCODE='P0001';
  END IF;
  IF v_status NOT IN ('scheduled','completed','postponed','void') THEN
    RAISE EXCEPTION 'status_invalid' USING ERRCODE='P0001';
  END IF;
  IF p_home_score IS NOT NULL AND p_home_score < 0 THEN RAISE EXCEPTION 'score_invalid' USING ERRCODE='P0001'; END IF;
  IF p_away_score IS NOT NULL AND p_away_score < 0 THEN RAISE EXCEPTION 'score_invalid' USING ERRCODE='P0001'; END IF;

  -- validate roster membership + count POTM
  FOR v_e IN SELECT * FROM jsonb_array_elements(p_stats) LOOP
    v_pid := NULLIF(v_e->>'member_profile_id','')::uuid;
    IF v_pid IS NULL THEN RAISE EXCEPTION 'member_required' USING ERRCODE='P0001'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM club_team_members
      WHERE team_id = v_team_id AND member_profile_id = v_pid AND is_active = true
    ) THEN RAISE EXCEPTION 'member_not_on_team' USING ERRCODE='P0001'; END IF;
    IF COALESCE((v_e->>'is_potm')::boolean, false) THEN v_potm := v_potm + 1; END IF;
  END LOOP;
  IF v_potm > 1 THEN RAISE EXCEPTION 'multiple_potm' USING ERRCODE='P0001'; END IF;

  -- replace-all stats for this fixture (idempotent), so removing a player drops their row
  DELETE FROM club_fixture_player_stats WHERE fixture_id = p_fixture_id;
  INSERT INTO club_fixture_player_stats
    (fixture_id, member_profile_id, goals, assists, yellow_cards, red_cards, minutes, is_potm, updated_at)
  SELECT p_fixture_id,
         (e->>'member_profile_id')::uuid,
         COALESCE((e->>'goals')::int, 0),
         COALESCE((e->>'assists')::int, 0),
         COALESCE((e->>'yellow_cards')::int, 0),
         COALESCE((e->>'red_cards')::int, 0),
         NULLIF(e->>'minutes','')::int,
         COALESCE((e->>'is_potm')::boolean, false),
         now()
    FROM jsonb_array_elements(p_stats) e;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- aggregate result on the fixture (score optional; status set)
  UPDATE club_fixtures
     SET home_score = COALESCE(p_home_score, home_score),
         away_score = COALESCE(p_away_score, away_score),
         status     = v_status,
         updated_at = now()
   WHERE id = p_fixture_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'player', 'club_manager_record_stats', 'club_fixture', p_fixture_id::text,
          jsonb_build_object('team_id', v_team_id, 'fixture_id', p_fixture_id,
                             'players', v_n, 'status', v_status,
                             'home_score', p_home_score, 'away_score', p_away_score));
  RETURN jsonb_build_object('ok', true, 'players', v_n, 'status', v_status);
END;
$fn$;
REVOKE ALL ON FUNCTION public.club_manager_record_fixture_stats(uuid, jsonb, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_manager_record_fixture_stats(uuid, jsonb, int, int, text) TO authenticated;

-- ─── 6. get_club_public — un-null top-scorer (SENIOR squads only) ─────────────
-- CREATE OR REPLACE (same signature). ONLY the `stats` slice changes:
--   · potm: inner JOIN → LEFT JOIN club_team_potm, so a team with goals but no monthly
--     POTM still surfaces (potm becomes null — the public StatsSection guards `s.potm &&`).
--   · topScorer: was hardcoded NULL → season goal leader from club_fixture_player_stats.
--   · team set widened to (has a POTM pick OR has any player stats).
-- U18 SAFETY: the youth-cohort suppression is UNCHANGED (youth cohorts excluded from the
-- whole stats slice — senior-only boards), so a minor never reaches topScorer; the
-- name-truncation is defence-in-depth. hide_public_rosters still blanks the whole slice.
CREATE OR REPLACE FUNCTION public.get_club_public(p_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_row          record;
  v_sg           jsonb;
  v_min_age      int;
  v_hide_rosters boolean;
BEGIN
  SELECT cp.*,
         c.name           AS club_name,
         c.short_name     AS club_short_name,
         c.discipline     AS club_discipline,
         c.founded_year   AS club_founded_year,
         c.contact_name   AS club_contact_name,
         c.contact_email  AS club_contact_email,
         c.safeguarding_config AS safeguarding_config
    INTO v_row
    FROM public.club_pages cp
    JOIN public.clubs c ON c.id = cp.club_id
   WHERE cp.slug = p_slug
   LIMIT 1;

  IF v_row.club_id IS NULL OR NOT COALESCE(v_row.published, false) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_sg           := COALESCE(v_row.safeguarding_config, '{}'::jsonb);
  v_min_age      := COALESCE(NULLIF(v_sg->>'min_public_age','')::int, 18);
  v_hide_rosters := COALESCE((v_sg->>'hide_public_rosters')::boolean, false);

  RETURN jsonb_build_object(
    'found', true,
    'club', jsonb_build_object(
      'id',           v_row.club_id,
      'name',         v_row.club_name,
      'short_name',   v_row.club_short_name,
      'discipline',   v_row.club_discipline,
      'founded_year', v_row.club_founded_year
    ),
    'branding', jsonb_build_object(
      'primary_colour',   v_row.primary_colour,
      'secondary_colour', v_row.secondary_colour,
      'accent_colour',    v_row.accent_colour,
      'crest_url',        v_row.crest_url,
      'hero_url',         v_row.hero_url,
      'tagline',          v_row.tagline,
      'about',            v_row.about,
      'socials',          v_row.socials,
      'sections',         v_row.sections
    ),
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cohort_id', cc.id, 'name', cc.name, 'category', cc.category,
        'min_age', cc.min_age, 'max_age', cc.max_age,
        'teams', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'team_id', t.id, 'name', t.name, 'gender', t.gender,
            'priority_rank', t.priority_rank,
            'members', CASE WHEN v_hide_rosters THEN '[]'::jsonb ELSE COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'member_id', mp.id,
                'name', CASE
                  WHEN (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age)
                  THEN mp.first_name || COALESCE(' ' || left(mp.last_name, 1) || '.', '')
                  ELSE mp.first_name || COALESCE(' ' || mp.last_name, '')
                END,
                'is_minor', (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age),
                'photo_url', NULL
              ) ORDER BY mp.first_name)
              FROM public.club_team_members cm
              JOIN public.member_profiles mp ON mp.id = cm.member_profile_id
              WHERE cm.team_id = t.id AND cm.is_active = true
            ), '[]'::jsonb) END
          ) ORDER BY t.priority_rank NULLS LAST, t.name)
          FROM public.club_teams t
          WHERE t.cohort_id = cc.id AND t.archived_at IS NULL
        ), '[]'::jsonb)
      ) ORDER BY cc.name)
      FROM public.club_cohorts cc
      WHERE cc.club_id = v_row.club_id AND cc.active = true
    ), '[]'::jsonb),
    'leagues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'league_id', cl.id, 'name', cl.name, 'season_label', cl.season_label,
        'fixtures', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'our_team',       COALESCE(f.club_team_name, ct.name),
            'opponent',       f.opponent_name,
            'is_home',        f.is_home,
            'scheduled_date', f.scheduled_date,
            'kickoff_time',   to_char(f.kickoff_time, 'HH24:MI'),
            'home_score',     f.home_score,
            'away_score',     f.away_score,
            'status',         f.status
          ) ORDER BY f.scheduled_date NULLS LAST, f.kickoff_time NULLS LAST)
          FROM public.club_fixtures f
          LEFT JOIN public.club_teams ct ON ct.id = f.club_team_id
          WHERE f.league_id = cl.id AND f.status <> 'void'
        ), '[]'::jsonb)
      ) ORDER BY cl.created_at)
      FROM public.club_leagues cl
      WHERE cl.club_id = v_row.club_id AND cl.archived_at IS NULL
    ), '[]'::jsonb),
    'sponsors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sponsor_id', s.id, 'name', s.name,
        'logo_url', s.logo_url, 'website_url', s.website_url, 'tier', s.tier
      ) ORDER BY s.display_order, s.name)
      FROM public.club_sponsors s
      WHERE s.club_id = v_row.club_id AND s.active = true
    ), '[]'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'post_id', p.id, 'slug', p.slug, 'title', p.title, 'body', p.body,
        'hero_url', p.hero_url, 'author_name', p.author_name,
        'published_at', p.published_at
      ) ORDER BY p.published_at DESC NULLS LAST)
      FROM public.club_posts p
      WHERE p.club_id = v_row.club_id AND p.status = 'published'
    ), '[]'::jsonb),
    'tournaments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', te.slug, 'name', te.name, 'status', te.status, 'event_date', te.event_date
      ) ORDER BY te.event_date DESC NULLS LAST)
      FROM public.tournament_events te
      WHERE te.club_id = v_row.club_id AND te.status <> 'draft'
    ), '[]'::jsonb),
    'getInvolved', COALESCE(v_row.links, '[]'::jsonb),
    'contacts', jsonb_build_object(
      'contact_name',  v_row.club_contact_name,
      'contact_email', v_row.club_contact_email,
      'welfareOfficer', (
        SELECT jsonb_build_object('name', cm.name, 'email', cm.email)
        FROM public.club_committee cm
        WHERE cm.club_id = v_row.club_id AND cm.is_welfare = true
        ORDER BY cm.display_order, cm.name
        LIMIT 1
      ),
      'committee', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('role', cm.role, 'name', cm.name, 'email', cm.email)
                 ORDER BY cm.display_order, cm.name)
        FROM public.club_committee cm
        WHERE cm.club_id = v_row.club_id AND cm.is_welfare = false
      ), '[]'::jsonb)
    ),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', d.title, 'url', d.url, 'type', d.doc_type, 'size', d.size_label
      ) ORDER BY d.display_order, d.created_at)
      FROM public.club_documents d WHERE d.club_id = v_row.club_id
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', e.title, 'date', e.event_date, 'blurb', e.blurb
      ) ORDER BY e.event_date NULLS LAST, e.display_order)
      FROM public.club_events e WHERE e.club_id = v_row.club_id
    ), '[]'::jsonb),
    'stats', CASE WHEN v_hide_rosters THEN '{}'::jsonb ELSE COALESCE((
      SELECT jsonb_object_agg(t.id::text, jsonb_build_object(
        'potm', CASE WHEN pm.team_id IS NOT NULL
                     THEN jsonb_build_object('name', pm.name, 'month', pm.month)
                     ELSE NULL END,
        'topScorer', (
          -- season goal leader for this team (SENIOR only — youth teams excluded below).
          -- Name uses the U18 truncation as defence-in-depth even though youth is suppressed.
          SELECT jsonb_build_object(
            'name', CASE
              WHEN (mp.dob IS NULL OR extract(year FROM age(mp.dob)) < v_min_age)
              THEN mp.first_name || COALESCE(' ' || left(mp.last_name, 1) || '.', '')
              ELSE mp.first_name || COALESCE(' ' || mp.last_name, '')
            END,
            'goals', ld.total_goals
          )
          FROM (
            SELECT s.member_profile_id, SUM(s.goals) AS total_goals
            FROM public.club_fixture_player_stats s
            JOIN public.club_fixtures cf ON cf.id = s.fixture_id
            WHERE cf.club_team_id = t.id AND cf.status <> 'void'   -- ignore voided matches
            GROUP BY s.member_profile_id
            HAVING SUM(s.goals) > 0
            ORDER BY SUM(s.goals) DESC, s.member_profile_id
            LIMIT 1
          ) ld
          JOIN public.member_profiles mp ON mp.id = ld.member_profile_id
        ),
        'reliability', '[]'::jsonb
      ))
      FROM public.club_teams t
      LEFT JOIN public.club_team_potm pm ON pm.team_id = t.id
      LEFT JOIN public.club_cohorts cc ON cc.id = t.cohort_id
      WHERE t.club_id = v_row.club_id
        AND t.archived_at IS NULL
        AND NOT (COALESCE(cc.category,'') = 'youth'
                 OR (cc.max_age IS NOT NULL AND cc.max_age < v_min_age))
        AND (pm.team_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.club_fixture_player_stats s2
                        JOIN public.club_fixtures cf2 ON cf2.id = s2.fixture_id
                        WHERE cf2.club_team_id = t.id AND cf2.status <> 'void'))
    ), '{}'::jsonb) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_club_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_club_public(text) TO anon, authenticated;

SELECT pg_notify('pgrst','reload schema');
