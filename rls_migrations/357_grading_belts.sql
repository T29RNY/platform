-- 357_grading_belts.sql
-- Gym/Boxing vertical, Phase 2 — grading / belt progression.
--
-- Per-club, per-discipline grading SCHEMES (a club can have many: a "Juniors"
-- ladder and an "Adults" ladder are two schemes — that's how the real-world
-- kids-vs-adults split works in BJJ (kids grey/yellow/orange/green can't get
-- blue until 16) and taekwondo (under-15 poom vs dan). age_band labels the two.
--
-- A scheme owns an ordered list of GRADES (named + coloured + rank_order). Half/
-- tag belts (TKD white-yellow stripe, kids karate tags) are just extra rows.
-- Each grade carries max_stripes (BJJ belts = 4; dan belts use degrees).
--
-- member_grades is the APPEND-ONLY award log (mirrors consent_acceptances).
-- "Current grade" = latest award per (member_profile_id, scheme_id). A past
-- award is NEVER updated or deleted — a kid ageing onto the adults scheme just
-- gets a fresh award there; their juniors history stays intact.
--
-- All three tables are RLS-walled with NO policies → every client read/write is
-- blocked; only the SECURITY DEFINER RPCs below reach them. Writes are gated on
-- manage_facility (operator decision s145, 1A) via resolve_venue_caller +
-- _venue_has_cap, and every write INSERTs audit_events (Hard Rule #9).

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venue_grading_schemes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  discipline  text        NOT NULL,
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  age_band    text        NOT NULL DEFAULT 'all' CHECK (age_band IN ('juniors','adults','all')),
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_grading_schemes_by_club
  ON public.venue_grading_schemes (club_id);

CREATE TABLE IF NOT EXISTS public.venue_grades (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id   uuid        NOT NULL REFERENCES public.venue_grading_schemes(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  rank_order  int         NOT NULL,
  colour_hex  text,
  max_stripes int         NOT NULL DEFAULT 0 CHECK (max_stripes >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheme_id, rank_order)
);
CREATE INDEX IF NOT EXISTS venue_grades_by_scheme
  ON public.venue_grades (scheme_id);

CREATE TABLE IF NOT EXISTS public.member_grades (   -- APPEND-ONLY award log
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_profile_id     uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  scheme_id             uuid        NOT NULL REFERENCES public.venue_grading_schemes(id) ON DELETE CASCADE,
  grade_id              uuid        NOT NULL REFERENCES public.venue_grades(id) ON DELETE RESTRICT,
  stripes               int         NOT NULL DEFAULT 0 CHECK (stripes >= 0),
  note                  text,
  awarded_at            timestamptz NOT NULL DEFAULT now(),
  awarded_by            text,
  awarded_by_actor_type text,
  -- monotonic tie-break: within a single transaction now() is constant, so two
  -- awards can share awarded_at. awarded_seq makes "current = latest" deterministic
  -- regardless of timestamp ties (caught by ephemeral-verify, s146).
  awarded_seq           bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS member_grades_current
  ON public.member_grades (member_profile_id, scheme_id, awarded_at DESC, awarded_seq DESC);

ALTER TABLE public.venue_grading_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_grades          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_grades         ENABLE ROW LEVEL SECURITY;
-- No policies by design: all client access blocked; SECURITY DEFINER RPCs only.

-- ---------------------------------------------------------------------------
-- RPC: venue_create_grading_scheme  (gated manage_facility, audited)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_create_grading_scheme(
  p_venue_token text,
  p_club_id     text,
  p_name        text,
  p_age_band    text DEFAULT 'all',
  p_discipline  text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_linked     boolean;
  v_discipline text;
  v_id         uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_age_band,'all') NOT IN ('juniors','adults','all') THEN
    RAISE EXCEPTION 'invalid_age_band' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  -- discipline defaults to the club's own discipline
  SELECT discipline INTO v_discipline FROM public.clubs WHERE id = p_club_id;
  IF v_discipline IS NULL THEN
    RAISE EXCEPTION 'club_not_found' USING ERRCODE = 'P0001';
  END IF;
  v_discipline := COALESCE(p_discipline, v_discipline);

  INSERT INTO public.venue_grading_schemes (club_id, discipline, name, age_band)
  VALUES (p_club_id, v_discipline, btrim(p_name), COALESCE(p_age_band,'all'))
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'grading_scheme_created', 'grading_scheme', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', p_club_id,
                             'name', btrim(p_name), 'age_band', COALESCE(p_age_band,'all'),
                             'discipline', v_discipline));

  RETURN jsonb_build_object('ok', true, 'scheme_id', v_id, 'club_id', p_club_id,
                            'name', btrim(p_name), 'age_band', COALESCE(p_age_band,'all'),
                            'discipline', v_discipline);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_create_grading_scheme(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_create_grading_scheme(text, text, text, text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: venue_add_grade  (gated manage_facility, audited)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_add_grade(
  p_venue_token text,
  p_scheme_id   uuid,
  p_name        text,
  p_rank_order  int,
  p_colour_hex  text DEFAULT NULL,
  p_max_stripes int  DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_club_id  text;
  v_linked   boolean;
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_scheme_id IS NULL THEN
    RAISE EXCEPTION 'scheme_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_rank_order IS NULL THEN
    RAISE EXCEPTION 'rank_order_required' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_max_stripes,0) < 0 THEN
    RAISE EXCEPTION 'invalid_max_stripes' USING ERRCODE = 'P0001';
  END IF;

  -- the scheme's club must belong to this caller's venue
  SELECT s.club_id INTO v_club_id FROM public.venue_grading_schemes s WHERE s.id = p_scheme_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'scheme_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = v_club_id AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'scheme_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.venue_grades (scheme_id, name, rank_order, colour_hex, max_stripes)
    VALUES (p_scheme_id, btrim(p_name), p_rank_order, p_colour_hex, COALESCE(p_max_stripes,0))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'rank_order_taken' USING ERRCODE = 'P0001';
  END;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'grade_added', 'grade', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', v_club_id,
                             'scheme_id', p_scheme_id, 'name', btrim(p_name),
                             'rank_order', p_rank_order, 'max_stripes', COALESCE(p_max_stripes,0)));

  RETURN jsonb_build_object('ok', true, 'grade_id', v_id, 'scheme_id', p_scheme_id,
                            'name', btrim(p_name), 'rank_order', p_rank_order,
                            'colour_hex', p_colour_hex, 'max_stripes', COALESCE(p_max_stripes,0));
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_add_grade(text, uuid, text, int, text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_add_grade(text, uuid, text, int, text, int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: venue_award_grade  (gated manage_facility, audited, APPEND-ONLY)
--   Stripes are capped at the grade's max_stripes server-side. Returns at_max
--   so the operator UI can suggest promotion to the next grade.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_award_grade(
  p_venue_token   text,
  p_membership_id uuid,
  p_grade_id      uuid,
  p_stripes       int  DEFAULT 0,
  p_note          text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     record;
  v_venue_id   text;
  v_mem        record;
  v_scheme_id  uuid;
  v_grade_club text;
  v_max        int;
  v_stripes    int;
  v_id         uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_facility') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  IF p_membership_id IS NULL OR p_grade_id IS NULL THEN
    RAISE EXCEPTION 'membership_and_grade_required' USING ERRCODE = 'P0001';
  END IF;

  -- membership must belong to caller's venue, and carry a member_profile + club
  SELECT m.venue_id, m.club_id, m.member_profile_id
    INTO v_mem
    FROM public.venue_memberships m
   WHERE m.id = p_membership_id;
  IF v_mem.venue_id IS NULL THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_mem.venue_id <> v_venue_id THEN
    RAISE EXCEPTION 'membership_not_in_venue' USING ERRCODE = 'P0001';
  END IF;
  IF v_mem.member_profile_id IS NULL THEN
    RAISE EXCEPTION 'membership_has_no_member_profile' USING ERRCODE = 'P0001';
  END IF;

  -- grade → scheme → club; the scheme's club must match the membership's club
  SELECT gr.scheme_id, gr.max_stripes, s.club_id
    INTO v_scheme_id, v_max, v_grade_club
    FROM public.venue_grades gr
    JOIN public.venue_grading_schemes s ON s.id = gr.scheme_id
   WHERE gr.id = p_grade_id;
  IF v_scheme_id IS NULL THEN
    RAISE EXCEPTION 'grade_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_mem.club_id IS NULL OR v_grade_club <> v_mem.club_id THEN
    RAISE EXCEPTION 'grade_club_mismatch' USING ERRCODE = 'P0001';
  END IF;

  -- cap stripes into [0, max_stripes]
  v_stripes := LEAST(GREATEST(COALESCE(p_stripes, 0), 0), COALESCE(v_max, 0));

  INSERT INTO public.member_grades
    (member_profile_id, scheme_id, grade_id, stripes, note, awarded_by, awarded_by_actor_type)
  VALUES
    (v_mem.member_profile_id, v_scheme_id, p_grade_id, v_stripes,
     NULLIF(btrim(COALESCE(p_note,'')), ''), v_caller.actor_ident, v_caller.actor_type)
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier,
                            action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'grade_awarded', 'member_grade', v_id::text,
          jsonb_build_object('venue_id', v_venue_id, 'club_id', v_mem.club_id,
                             'membership_id', p_membership_id,
                             'member_profile_id', v_mem.member_profile_id,
                             'scheme_id', v_scheme_id, 'grade_id', p_grade_id,
                             'stripes', v_stripes));

  RETURN jsonb_build_object('ok', true, 'award_id', v_id, 'grade_id', p_grade_id,
                            'scheme_id', v_scheme_id, 'stripes', v_stripes,
                            'max_stripes', COALESCE(v_max,0),
                            'at_max', v_stripes >= COALESCE(v_max,0) AND COALESCE(v_max,0) > 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_award_grade(text, uuid, uuid, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_award_grade(text, uuid, uuid, int, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: venue_list_grading_schemes  (operator read; valid venue token + club in venue)
--   Returns each scheme with its ordered grades nested.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_list_grading_schemes(
  p_venue_token text,
  p_club_id     text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_linked   boolean;
  v_out      jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_id_required' USING ERRCODE = 'P0001';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.club_venues cv
    WHERE cv.club_id = p_club_id AND cv.venue_id = v_venue_id
  ) INTO v_linked;
  IF NOT v_linked THEN
    RAISE EXCEPTION 'club_not_in_venue' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(scheme ORDER BY scheme->>'name'), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT jsonb_build_object(
        'scheme_id',  s.id,
        'name',       s.name,
        'age_band',   s.age_band,
        'discipline', s.discipline,
        'active',     s.active,
        'grades', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'grade_id',    gr.id,
                   'name',        gr.name,
                   'rank_order',  gr.rank_order,
                   'colour_hex',  gr.colour_hex,
                   'max_stripes', gr.max_stripes
                 ) ORDER BY gr.rank_order)
            FROM public.venue_grades gr WHERE gr.scheme_id = s.id
        ), '[]'::jsonb)
      ) AS scheme
      FROM public.venue_grading_schemes s
      WHERE s.club_id = p_club_id
    ) q;

  RETURN jsonb_build_object('ok', true, 'club_id', p_club_id, 'schemes', v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_grading_schemes(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_list_grading_schemes(text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: member_get_grade_history  (member read via pass_token; own awards)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_get_grade_history(
  p_token text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mp    uuid;
  v_club  text;
  v_out   jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT m.member_profile_id, m.club_id
    INTO v_mp, v_club
    FROM public.venue_memberships m
   WHERE m.pass_token = p_token AND m.status <> 'cancelled';
  IF v_mp IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'award_id',    mg.id,
           'scheme_id',   s.id,
           'scheme_name', s.name,
           'age_band',    s.age_band,
           'grade_id',    gr.id,
           'grade_name',  gr.name,
           'colour_hex',  gr.colour_hex,
           'rank_order',  gr.rank_order,
           'stripes',     mg.stripes,
           'max_stripes', gr.max_stripes,
           'note',        mg.note,
           'awarded_at',  mg.awarded_at
         ) ORDER BY mg.awarded_at DESC, mg.awarded_seq DESC), '[]'::jsonb)
    INTO v_out
    FROM public.member_grades mg
    JOIN public.venue_grading_schemes s ON s.id = mg.scheme_id
    JOIN public.venue_grades gr         ON gr.id = mg.grade_id
   WHERE mg.member_profile_id = v_mp
     AND (v_club IS NULL OR s.club_id = v_club);

  -- (jsonb_agg above ordered by awarded_at DESC, awarded_seq DESC)
  RETURN jsonb_build_object('ok', true, 'history', v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.member_get_grade_history(text) FROM public;
GRANT EXECUTE ON FUNCTION public.member_get_grade_history(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- EXTEND get_member_pass — add current grade(s) for the member's club.
--   'grades' = latest award per scheme (DISTINCT ON scheme_id, awarded_at DESC),
--   restricted to schemes belonging to the membership's club. [] when none.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_m      record;
  v_offers jsonb;
  v        jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT m.id, m.venue_id, m.club_id, m.tier_id, m.member_profile_id
    INTO v_m
    FROM public.venue_memberships m
   WHERE m.pass_token = p_token AND m.status <> 'cancelled';
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_id',     o.id,
      'partner_name', pn.name,
      'title',        o.title,
      'description',  o.description,
      'code',         o.code
    ) ORDER BY o.created_at), '[]'::jsonb)
    INTO v_offers
    FROM public.partner_offers o
    JOIN public.venue_partners pn ON pn.id = o.partner_id
   WHERE o.venue_id = v_m.venue_id AND o.active AND pn.active
     AND (o.tier_ids IS NULL OR array_length(o.tier_ids,1) IS NULL OR v_m.tier_id = ANY(o.tier_ids));

  SELECT jsonb_build_object(
    'ok',               true,
    'member_profile_id', m.member_profile_id,
    'club_id',          m.club_id,
    'discipline',       cl.discipline,
    'first_name',       COALESCE(c.first_name, mp.first_name),
    'last_name',        COALESCE(c.last_name,  mp.last_name),
    'tier_name',        t.name,
    'benefits',         t.benefits,
    'period',           m.period,
    'amount_pence',     m.amount_pence,
    'status',           m.status,
    'payment_state',    m.payment_state,
    'started_at',       m.started_at,
    'renews_at',        m.renews_at,
    'frozen_until',     m.frozen_until,
    'venue_name',       vn.name,
    'venue_logo',       vn.logo_url,
    'primary_colour',   vn.primary_colour,
    'secondary_colour', vn.secondary_colour,
    'check_in_code',    m.pass_token,
    'offers',           v_offers,
    'grades', COALESCE((
      SELECT jsonb_agg(g.obj)
        FROM (
          SELECT DISTINCT ON (mg.scheme_id) jsonb_build_object(
                   'scheme_id',   s.id,
                   'scheme_name', s.name,
                   'age_band',    s.age_band,
                   'grade_id',    gr.id,
                   'grade_name',  gr.name,
                   'colour_hex',  gr.colour_hex,
                   'rank_order',  gr.rank_order,
                   'stripes',     mg.stripes,
                   'max_stripes', gr.max_stripes,
                   'awarded_at',  mg.awarded_at
                 ) AS obj
            FROM public.member_grades mg
            JOIN public.venue_grading_schemes s ON s.id = mg.scheme_id
            JOIN public.venue_grades gr         ON gr.id = mg.grade_id
           WHERE mg.member_profile_id = m.member_profile_id
             AND s.club_id = m.club_id
           ORDER BY mg.scheme_id, mg.awarded_at DESC, mg.awarded_seq DESC
        ) g
    ), '[]'::jsonb),
    'valid_venues',     COALESCE(
      CASE WHEN m.club_id IS NOT NULL THEN
        (SELECT jsonb_agg(jsonb_build_object('venue_id', v2.id, 'venue_name', v2.name)
                          ORDER BY v2.name)
           FROM public.club_venues cv2
           JOIN public.venues v2 ON v2.id = cv2.venue_id
          WHERE cv2.club_id = m.club_id)
      END,
      jsonb_build_array(jsonb_build_object('venue_id', vn.id, 'venue_name', vn.name))
    )
  ) INTO v
  FROM public.venue_memberships m
  LEFT JOIN public.venue_customers c    ON c.id  = m.customer_id
  LEFT JOIN public.member_profiles mp   ON mp.id = m.member_profile_id
  LEFT JOIN public.clubs cl             ON cl.id = m.club_id
  JOIN  public.venue_membership_tiers t  ON t.id  = m.tier_id
  JOIN  public.venues vn                ON vn.id  = m.venue_id
  WHERE m.id = v_m.id;

  IF v IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN v;
END;
$function$;

-- ---------------------------------------------------------------------------
-- EXTEND venue_list_members — add club_id + discipline so the operator roster
-- can offer the right club's grades on the per-member "Award grade" action.
-- Additive only (existing consumers ignore the new keys).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venue_list_members(p_venue_token text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', m.id, 'status', m.status, 'period', m.period, 'amount_pence', m.amount_pence,
    'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until, 'cancel_at', m.cancel_at,
    'due_soon', (m.status='active' AND m.renews_at <= current_date + 7),
    'pass_token', m.pass_token, 'customer_id', m.customer_id, 'member_profile_id', m.member_profile_id,
    'club_id', m.club_id, 'discipline', cl.discipline,
    'first_name', COALESCE(c.first_name, mp.first_name), 'last_name', COALESCE(c.last_name, mp.last_name),
    'email', COALESCE(c.email, mp.email), 'tier_id', t.id, 'tier_name', t.name
  ) ORDER BY m.status, COALESCE(c.first_name, mp.first_name)), '[]'::jsonb) INTO v_rows
  FROM public.venue_memberships m
  LEFT JOIN public.venue_customers c ON c.id=m.customer_id
  LEFT JOIN public.member_profiles mp ON mp.id=m.member_profile_id
  LEFT JOIN public.clubs cl ON cl.id=m.club_id
  JOIN public.venue_membership_tiers t ON t.id=m.tier_id
  WHERE m.status<>'cancelled'
    AND (m.venue_id=v_venue_id OR (m.club_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.club_venues WHERE club_id=m.club_id AND venue_id=v_venue_id)));
  RETURN jsonb_build_object('ok', true, 'members', v_rows);
END; $function$;
