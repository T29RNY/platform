-- 308_multi_venue_activation.sql
--
-- Phase 8 — Multi-venue activation.
-- One club spans multiple venues via the existing club_venues M:N table.
-- A membership issued at any club venue is valid for check-in at ALL venues
-- in that club's footprint — the single-venue equality check in member_check_in
-- is replaced with a club_venues EXISTS lookup.
--
-- V2 member bug fix (live bug since Phase 1):
--   get_member_pass and member_check_in both JOIN venue_customers directly.
--   V2 members have customer_id=NULL, so those JOINs produce no row.
--   Result: get_member_pass returns {ok:false} for every V2 member.
--   Fix: LEFT JOIN both tables, COALESCE first_name/last_name.
--
-- Schema changes:
--   venue_member_checkins.customer_id  → nullable (was NOT NULL; V2 has no customer)
--   venue_member_checkins.member_profile_id uuid nullable FK → member_profiles
--
-- New RPCs: venue_add_club_venue, venue_remove_club_venue,
--           venue_list_club_venues, venue_search
-- Rewrites: get_member_pass, member_check_in, venue_list_members
-- Extend:   member_get_self (venues array per active_clubs row)

-- ── 1. Schema: make customer_id nullable, add member_profile_id ───────────────

ALTER TABLE public.venue_member_checkins
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.venue_member_checkins
  ADD COLUMN IF NOT EXISTS member_profile_id uuid
    REFERENCES public.member_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS venue_member_checkins_by_profile
  ON public.venue_member_checkins (member_profile_id, checked_in_at DESC)
  WHERE member_profile_id IS NOT NULL;

-- ── 2. Rewrite get_member_pass — V2 fix + valid_venues + member_profile_id ────

CREATE OR REPLACE FUNCTION public.get_member_pass(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
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

  -- Offers scoped to the issuing venue; tier-gated as before
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_id',    o.id,
      'partner_name', pn.name,
      'title',       o.title,
      'description', o.description,
      'code',        o.code
    ) ORDER BY o.created_at), '[]'::jsonb)
    INTO v_offers
    FROM public.partner_offers o
    JOIN public.venue_partners pn ON pn.id = o.partner_id
   WHERE o.venue_id = v_m.venue_id AND o.active AND pn.active
     AND (o.tier_ids IS NULL OR array_length(o.tier_ids,1) IS NULL OR v_m.tier_id = ANY(o.tier_ids));

  SELECT jsonb_build_object(
    'ok',              true,
    'member_profile_id', m.member_profile_id,
    'first_name',      COALESCE(c.first_name, mp.first_name),
    'last_name',       COALESCE(c.last_name,  mp.last_name),
    'tier_name',       t.name,
    'benefits',        t.benefits,
    'period',          m.period,
    'amount_pence',    m.amount_pence,
    'status',          m.status,
    'started_at',      m.started_at,
    'renews_at',       m.renews_at,
    'frozen_until',    m.frozen_until,
    'venue_name',      vn.name,
    'venue_logo',      vn.logo_url,
    'primary_colour',  vn.primary_colour,
    'secondary_colour', vn.secondary_colour,
    'check_in_code',   m.pass_token,
    'offers',          v_offers,
    -- valid_venues: all club footprint venues, or single issuing venue for V1
    'valid_venues',    COALESCE(
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
  LEFT JOIN public.venue_customers c   ON c.id  = m.customer_id
  LEFT JOIN public.member_profiles mp  ON mp.id = m.member_profile_id
  JOIN  public.venue_membership_tiers t ON t.id  = m.tier_id
  JOIN  public.venues vn               ON vn.id  = m.venue_id
  WHERE m.id = v_m.id;

  IF v IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_member_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_pass(text) TO anon, authenticated;

-- ── 3. Rewrite member_check_in — multi-venue + V2 names + nullable INSERT ─────

CREATE OR REPLACE FUNCTION public.member_check_in(p_display_token text, p_pass_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_venue_id text;
  v_m        record;
  v_recent   timestamptz;
  v_count    int;
  v_already  boolean := false;
BEGIN
  IF p_display_token IS NULL OR btrim(p_display_token) = '' THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;

  -- Strip URL prefix and query string from scanned value
  p_pass_token := regexp_replace(COALESCE(p_pass_token, ''), '^.*/m/', '');
  p_pass_token := split_part(p_pass_token, '?', 1);
  p_pass_token := btrim(p_pass_token);
  IF p_pass_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_token');
  END IF;

  SELECT id INTO v_venue_id FROM public.venues WHERE display_token = p_display_token LIMIT 1;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_display_token' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.id, m.venue_id, m.club_id, m.customer_id, m.member_profile_id, m.status,
         COALESCE(c.first_name, mp.first_name) AS first_name,
         COALESCE(c.last_name,  mp.last_name)  AS last_name,
         t.name AS tier_name
    INTO v_m
    FROM public.venue_memberships m
    LEFT JOIN public.venue_customers c  ON c.id  = m.customer_id
    LEFT JOIN public.member_profiles mp ON mp.id = m.member_profile_id
    JOIN  public.venue_membership_tiers t ON t.id = m.tier_id
   WHERE m.pass_token = p_pass_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pass_not_found');
  END IF;

  -- Multi-venue: direct match OR membership's club operates at this display's venue
  IF v_m.venue_id <> v_venue_id THEN
    IF v_m.club_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.club_venues
       WHERE club_id = v_m.club_id AND venue_id = v_venue_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'wrong_venue');
    END IF;
  END IF;

  IF v_m.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cancelled', 'first_name', v_m.first_name);
  END IF;

  -- De-dupe: a re-scan within 4h is the same physical visit
  SELECT max(checked_in_at) INTO v_recent
    FROM public.venue_member_checkins
   WHERE membership_id = v_m.id AND checked_in_at > now() - interval '4 hours';
  IF v_recent IS NOT NULL THEN
    v_already := true;
  ELSE
    INSERT INTO public.venue_member_checkins
      (venue_id, membership_id, customer_id, member_profile_id, source)
    VALUES
      (v_venue_id, v_m.id, v_m.customer_id, v_m.member_profile_id, 'display_qr');
  END IF;

  SELECT count(*) INTO v_count
    FROM public.venue_member_checkins WHERE membership_id = v_m.id;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier,
     action, entity_type, entity_id, metadata)
  VALUES
    (v_venue_id, NULL, 'system', 'display_token:' || md5(p_display_token),
     'member_checkin', 'venue_membership', v_m.id::text,
     jsonb_build_object('via', 'display_qr', 'already_checked_in', v_already,
                        'status', v_m.status, 'visit_count', v_count));

  RETURN jsonb_build_object(
    'ok',               true,
    'first_name',       v_m.first_name,
    'last_name',        v_m.last_name,
    'tier_name',        v_m.tier_name,
    'status',           v_m.status,
    'frozen',           (v_m.status = 'paused'),
    'visit_count',      v_count,
    'already_checked_in', v_already
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.member_check_in(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_check_in(text,text) TO anon, authenticated;

-- ── 4. Extend member_get_self — venues array per active_clubs row ─────────────
-- Signature unchanged (no DROP needed — same () → jsonb overload).

CREATE OR REPLACE FUNCTION public.member_get_self()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_profile          record;
  v_id_mandate_clubs jsonb;
  v_active_clubs     jsonb;
  v_managed_teams    jsonb;
BEGIN
  SELECT * INTO v_profile
  FROM public.member_profiles
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Clubs requiring ID verification (existing logic, unchanged)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',   c.id,
    'club_name', c.name
  )), '[]'::jsonb)
  INTO v_id_mandate_clubs
  FROM public.venue_memberships vm
  JOIN public.clubs c ON c.id = vm.club_id
  WHERE vm.member_profile_id = v_profile.id
    AND vm.status = 'active'
    AND c.id_mandate = true;

  -- Active/ending memberships — one row per (club, cohort) — extended with venues
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'club_id',     c.id,
    'club_name',   c.name,
    'cohort_id',   vm.cohort_id,
    'cohort_name', cc.name,
    'venues',      (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('venue_id', v.id, 'venue_name', v.name)
        ORDER BY v.name
      ), '[]'::jsonb)
      FROM public.club_venues cv
      JOIN public.venues v ON v.id = cv.venue_id
      WHERE cv.club_id = c.id
    )
  ) ORDER BY c.name, cc.name), '[]'::jsonb)
  INTO v_active_clubs
  FROM public.venue_memberships vm
  JOIN public.clubs c ON c.id = vm.club_id
  LEFT JOIN public.club_cohorts cc ON cc.id = vm.cohort_id
  WHERE vm.member_profile_id = v_profile.id
    AND vm.status IN ('active', 'ending');

  -- Teams where this member is an active manager/coach (unchanged)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id',   ct.id,
    'team_name', ct.name,
    'club_id',   ct.club_id,
    'role',      ctm.role
  ) ORDER BY ct.name), '[]'::jsonb)
  INTO v_managed_teams
  FROM public.club_team_managers ctm
  JOIN public.club_teams ct ON ct.id = ctm.team_id
  WHERE ctm.member_profile_id = v_profile.id
    AND ctm.is_active = true;

  RETURN jsonb_build_object(
    'found',                          true,
    'id',                             v_profile.id,
    'member_profile_id',              v_profile.id,
    'first_name',                     v_profile.first_name,
    'last_name',                      v_profile.last_name,
    'email',                          v_profile.email,
    'phone',                          v_profile.phone,
    'dob',                            v_profile.dob,
    'gender',                         v_profile.gender,
    'address_line1',                  v_profile.address_line1,
    'address_line2',                  v_profile.address_line2,
    'address_city',                   v_profile.address_city,
    'address_postcode',               v_profile.address_postcode,
    'ec1_name',                       v_profile.ec1_name,
    'ec1_relationship',               v_profile.ec1_relationship,
    'ec1_phone',                      v_profile.ec1_phone,
    'ec2_name',                       v_profile.ec2_name,
    'ec2_relationship',               v_profile.ec2_relationship,
    'ec2_phone',                      v_profile.ec2_phone,
    'send_notes',                     v_profile.send_notes,
    'dietary_notes',                  v_profile.dietary_notes,
    'consent_emergency_treatment',    v_profile.consent_emergency_treatment,
    'consent_administer_medication',  v_profile.consent_administer_medication,
    'may_leave_unaccompanied',        v_profile.may_leave_unaccompanied,
    'authorised_collectors',          v_profile.authorised_collectors,
    'photo_consent',                  v_profile.photo_consent,
    'created_at',                     v_profile.created_at,
    'updated_at',                     v_profile.updated_at,
    'id_mandate_clubs',               v_id_mandate_clubs,
    'active_clubs',                   v_active_clubs,
    'managed_teams',                  v_managed_teams
  );
END;
$$;
REVOKE ALL ON FUNCTION public.member_get_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_get_self() TO authenticated;

-- ── 5. Rewrite venue_list_members — V2 COALESCE + club-scoped footprint ───────

CREATE OR REPLACE FUNCTION public.venue_list_members(p_venue_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_venue_id text;
  v_rows    jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id',    m.id,
    'status',           m.status,
    'period',           m.period,
    'amount_pence',     m.amount_pence,
    'started_at',       m.started_at,
    'renews_at',        m.renews_at,
    'frozen_until',     m.frozen_until,
    'cancel_at',        m.cancel_at,
    'due_soon',         (m.status = 'active' AND m.renews_at <= current_date + 7),
    'pass_token',       m.pass_token,
    'customer_id',      m.customer_id,
    'member_profile_id', m.member_profile_id,
    'first_name',       COALESCE(c.first_name, mp.first_name),
    'last_name',        COALESCE(c.last_name,  mp.last_name),
    'email',            COALESCE(c.email,      mp.email),
    'tier_id',          t.id,
    'tier_name',        t.name
  ) ORDER BY m.status, COALESCE(c.first_name, mp.first_name)), '[]'::jsonb)
  INTO v_rows
  FROM public.venue_memberships m
  LEFT JOIN public.venue_customers c  ON c.id  = m.customer_id
  LEFT JOIN public.member_profiles mp ON mp.id = m.member_profile_id
  JOIN  public.venue_membership_tiers t ON t.id = m.tier_id
  WHERE m.status <> 'cancelled'
    AND (
      -- V1: membership issued directly to this venue
      m.venue_id = v_venue_id
      OR
      -- V2: membership issued at any venue in a club that includes this venue
      (m.club_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.club_venues
         WHERE club_id = m.club_id AND venue_id = v_venue_id
      ))
    );

  RETURN jsonb_build_object('ok', true, 'members', v_rows);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_members(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_members(text) TO anon, authenticated;

-- ── 6. NEW: venue_add_club_venue ──────────────────────────────────────────────
-- Trust model: caller's venue must already be in the club's footprint.
-- Idempotent: already_existed=true if already linked.

CREATE OR REPLACE FUNCTION public.venue_add_club_venue(
  p_venue_token    text,
  p_club_id        text,
  p_target_venue_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  -- Caller must be a venue already inside this club
  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'not_club_venue' USING ERRCODE='P0001';
  END IF;

  -- Target venue must exist
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_target_venue_id) THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE='P0001';
  END IF;

  -- Idempotent
  IF EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = p_target_venue_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_existed', true);
  END IF;

  INSERT INTO public.club_venues (club_id, venue_id) VALUES (p_club_id, p_target_venue_id);

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier,
     action, entity_type, entity_id, metadata)
  VALUES
    (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
     'club_venue_added', 'club', p_club_id,
     jsonb_build_object('target_venue_id', p_target_venue_id));

  RETURN jsonb_build_object('ok', true, 'already_existed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_add_club_venue(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_add_club_venue(text,text,text) TO anon, authenticated;

-- ── 7. NEW: venue_remove_club_venue ──────────────────────────────────────────
-- Guards: caller in club; at least 2 venues; no active members issued at target.

CREATE OR REPLACE FUNCTION public.venue_remove_club_venue(
  p_venue_token     text,
  p_club_id         text,
  p_target_venue_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller    record;
  v_venue_id  text;
  v_count     int;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'not_club_venue' USING ERRCODE='P0001';
  END IF;

  -- Must keep at least one venue in the club
  SELECT count(*) INTO v_count FROM public.club_venues WHERE club_id = p_club_id;
  IF v_count <= 1 THEN
    RAISE EXCEPTION 'last_venue_cannot_be_removed' USING ERRCODE='P0001';
  END IF;

  -- Block if active members were issued at the target venue for this club
  -- (their passes would become unreachable at any venue after removal)
  IF EXISTS (
    SELECT 1 FROM public.venue_memberships
     WHERE club_id = p_club_id
       AND venue_id = p_target_venue_id
       AND status NOT IN ('cancelled')
  ) THEN
    RAISE EXCEPTION 'venue_has_active_members' USING ERRCODE='P0001';
  END IF;

  DELETE FROM public.club_venues WHERE club_id = p_club_id AND venue_id = p_target_venue_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_removed', true);
  END IF;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier,
     action, entity_type, entity_id, metadata)
  VALUES
    (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
     'club_venue_removed', 'club', p_club_id,
     jsonb_build_object('target_venue_id', p_target_venue_id));

  RETURN jsonb_build_object('ok', true, 'already_removed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_remove_club_venue(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_remove_club_venue(text,text,text) TO anon, authenticated;

-- ── 8. NEW: venue_list_club_venues ────────────────────────────────────────────
-- Returns all venues in a club's footprint with 30-day check-in counts.

CREATE OR REPLACE FUNCTION public.venue_list_club_venues(
  p_venue_token text,
  p_club_id     text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller  record;
  v_venue_id text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v_venue_id
  ) THEN
    RAISE EXCEPTION 'not_club_venue' USING ERRCODE='P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'venues', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'venue_id',        v.id,
        'venue_name',      v.name,
        'city',            v.city,
        'is_self',         (v.id = v_venue_id),
        'recent_checkins', (
          SELECT count(*)
            FROM public.venue_member_checkins vmc
            JOIN public.venue_memberships vm ON vm.id = vmc.membership_id
           WHERE vmc.venue_id = v.id
             AND vm.club_id = p_club_id
             AND vmc.checked_in_at > now() - interval '30 days'
        )
      ) ORDER BY v.name), '[]'::jsonb)
      FROM public.club_venues cv
      JOIN public.venues v ON v.id = cv.venue_id
      WHERE cv.club_id = p_club_id
    )
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_club_venues(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_club_venues(text,text) TO anon, authenticated;

-- ── 9. NEW: venue_search ──────────────────────────────────────────────────────
-- Free-text ILIKE across name + city. When p_club_id is supplied, already-linked
-- venues are excluded so the results list only shows venues eligible to add.

CREATE OR REPLACE FUNCTION public.venue_search(
  p_venue_token text,
  p_query       text,
  p_club_id     text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_q        text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;

  v_q := btrim(COALESCE(p_query, ''));
  IF length(v_q) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'venues', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'venues', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'venue_id',   v.id,
        'venue_name', v.name,
        'city',       v.city
      ) ORDER BY v.name), '[]'::jsonb)
      FROM public.venues v
      WHERE (v.name ILIKE '%' || v_q || '%' OR v.city ILIKE '%' || v_q || '%')
        AND (
          p_club_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.club_venues WHERE club_id = p_club_id AND venue_id = v.id
          )
        )
      LIMIT 10
    )
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_search(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_search(text,text,text) TO anon, authenticated;
