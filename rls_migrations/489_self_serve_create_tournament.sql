-- 489_self_serve_create_tournament.sql
--
-- Standalone Tournament Self-Serve epic — PR #1, the CREATE FOUNDATION.
--
-- Lets an authenticated consumer (no club, no venue) spin up a runnable
-- tournament from their phone in one transaction. Clones the mig-484
-- self_serve_create_venue pattern (de-gated create + owner row) and extends it
-- to the Event OS tournament engine:
--
--   1. find-or-create ONE hidden "personal host" venue per user (is_personal_host)
--      — reused across all the user's tournaments so the mig-484 pending-venue cap
--      never blocks the Nth tournament, and it NEVER appears in any operator venue
--      chooser or the verified-only search_bookable_venues (mig 488).
--   2. insert the tournament_events row under that host venue (venue_id is NOT NULL
--      and consumed by 5+ INNER JOIN venues readers — mig 315:19 — so a standalone
--      tournament MUST hang off a venue; the hidden host keeps the word "venue"
--      off-screen entirely).
--   3. auto-create ONE default competition so teams can register immediately.
--
-- TWO non-obvious correctness requirements (SWEEP findings, both EV-asserted):
--   (i)  collision-safe slug — tournament_events.slug is globally UNIQUE and
--        unbounded untrusted users WILL collide on "sunday-6-a-side", so the slug
--        is slugify(name) + '-' + short-random-suffix with retry-on-conflict. EV
--        proves two users creating the same name both succeed.
--   (ii) status='open', NOT the table default 'draft' — a default competition is
--        auto-created in the same transaction so the tournament is immediately
--        shareable, and get_tournament_public returns not_found for 'draft'
--        (mig 452:68) — a 'draft' insert would make the headline "20-second create
--        -> live share URL" a DEAD link.
--
-- MULTI-SPORT (Decision #8): the wizard captures a curated sport code; the RPC
-- validates it, records it first-class on tournament_events.sport, and
-- materialises the matching ref-UI preset (score_label / show_cards / show_subs /
-- result_only) into tournament_events.branding->'ref_ui_config' — forward-wiring
-- for the PR #4 native run/ref screens. league_config.ref_ui_config (mig 315) is
-- keyed by league_id and read by nothing, so it is deliberately NOT used here.
--
-- OWNERSHIP is first-class via tournament_events.created_by_user (promoted to
-- load-bearing per the handoff FUTURE-PROOF note) — the escape hatch from the
-- venue-shell/Stage-1b coupling and the seam for a later "my tournaments" list,
-- co-organiser/transfer, and clean per-user caps. It is the source of truth for
-- the abuse cap here.
--
-- SECURITY (mirrors mig 484):
--   * SECURITY DEFINER, search_path pinned, authenticated-only, anon REVOKEd BY
--     NAME (default-privileges auto-grant anon; REVOKE FROM PUBLIC does not strip
--     it — feedback_default_privileges_revoke).
--   * Ownership derives from auth.uid() server-side. Never returns the venue's
--     master venue_admin_token — only the venue_id, which is a Stage-1b selector
--     re-gated on auth.uid() on every management call, not a secret.
--   * Abuse cap: at most 10 non-completed self-serve tournaments per user.
--   * Audit: canonical audit_events columns + actor_type='venue_admin' (a
--     CHECK-valid value, mig 171).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Additive columns (safe defaults — existing rows untouched)
-- ─────────────────────────────────────────────────────────────────────────

-- Marks the hidden per-user host venue so it never surfaces in an operator venue
-- chooser or the verified-only public search.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS is_personal_host boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS venues_is_personal_host_idx
  ON public.venues (is_personal_host) WHERE is_personal_host = true;

-- First-class tournament ownership. Nullable because existing operator/club
-- tournaments predate it (mirrors mig 484 venues.created_by_user); the self-serve
-- RPC ALWAYS populates it, and it is the source of truth for the abuse cap and
-- the future "my tournaments" surface.
ALTER TABLE public.tournament_events
  ADD COLUMN IF NOT EXISTS created_by_user uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS tournament_events_created_by_user_idx
  ON public.tournament_events (created_by_user);

-- Provenance: 'operator' for every existing (venue/club-created) tournament;
-- only the self-serve RPC writes 'self_serve'. Keeps self-serve tournaments
-- cheaply filterable for the abuse cap + PR #5 moderation.
ALTER TABLE public.tournament_events
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'operator'
    CHECK (origin IN ('operator','self_serve'));

-- Per-tournament sport (the venue's sport can't carry it — one hidden host is
-- reused across a user's tournaments of different sports). Default keeps every
-- existing row valid as the football skin.
ALTER TABLE public.tournament_events
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'football';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. The self-serve create RPC
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.self_serve_create_tournament(
  p_name       text,
  p_sport      text DEFAULT 'football',
  p_format     text DEFAULT 'knockout',
  p_event_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_email        text;
  v_name         text := NULLIF(btrim(p_name), '');
  v_sport        text := lower(btrim(coalesce(p_sport, 'football')));
  v_format       text := lower(btrim(coalesce(p_format, 'knockout')));
  v_event_date   date := coalesce(p_event_date, current_date);
  v_venue_id     text;
  v_owned_count  int;
  v_tournament_id uuid;
  v_competition_id uuid;
  v_slug         text;
  v_base         text;
  v_preset       jsonb;
  v_comp_type    text;
  v_comp_format  text;
  v_score_label  text;
  v_show_cards   boolean;
  v_show_subs    boolean;
  v_result_only  boolean := false;
  i              int;
BEGIN
  -- Auth gate — authenticated only. anon is REVOKEd below; defend in depth.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  -- Input validation
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'tournament_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_name) > 120 THEN
    RAISE EXCEPTION 'tournament_name_too_long' USING ERRCODE = 'P0001';
  END IF;

  -- Sport → ref-UI preset (Decision #8). v1 = single two-sided-score sports only.
  CASE v_sport
    WHEN 'football', 'futsal', '5aside', 'hockey' THEN
      v_score_label := 'Goals'; v_show_cards := true;  v_show_subs := true;
    WHEN 'rugby' THEN
      v_score_label := 'Points'; v_show_cards := true;  v_show_subs := true;
    WHEN 'basketball', 'netball', 'volleyball', 'handball' THEN
      v_score_label := 'Points'; v_show_cards := false; v_show_subs := false;
    WHEN 'tennis', 'badminton', 'squash', 'padel', 'table_tennis' THEN
      v_score_label := 'Sets';   v_show_cards := false; v_show_subs := false;
      v_result_only := true;
    WHEN 'other' THEN
      v_score_label := 'Score';  v_show_cards := false; v_show_subs := false;
    ELSE
      RAISE EXCEPTION 'sport_not_supported' USING ERRCODE = 'P0001';
  END CASE;

  v_preset := jsonb_build_object(
    'score_label', v_score_label,
    'show_cards',  v_show_cards,
    'show_subs',   v_show_subs,
    'result_only', v_result_only
  );

  -- Format → competition type + format
  CASE v_format
    WHEN 'knockout'    THEN v_comp_type := 'cup';    v_comp_format := 'single_elimination';
    WHEN 'round_robin' THEN v_comp_type := 'league'; v_comp_format := 'round_robin';
    WHEN 'groups'      THEN v_comp_type := 'cup';    v_comp_format := 'group_stage';
    ELSE
      RAISE EXCEPTION 'format_not_supported' USING ERRCODE = 'P0001';
  END CASE;

  -- Abuse cap — at most 10 non-completed self-serve tournaments per user
  -- (created_by_user is the first-class ownership seam). 'completed'/'cancelled'
  -- do not count; 'cancelled' arrives in PR #5 and is excluded automatically.
  -- Serialize per-user first: a bare count()->insert is a TOCTOU race, and this
  -- is a de-gated spam surface, so a concurrent burst from one uid could each
  -- read count=9 and all insert. A per-user advisory xact lock closes that.
  PERFORM pg_advisory_xact_lock(hashtext('self_serve_create_tournament:' || v_uid::text));

  SELECT count(*) INTO v_owned_count
  FROM public.tournament_events te
  WHERE te.created_by_user = v_uid
    AND te.origin = 'self_serve'
    AND te.status IN ('draft', 'open', 'closed', 'live');
  IF v_owned_count >= 10 THEN
    RAISE EXCEPTION 'self_serve_tournament_cap_reached' USING ERRCODE = 'P0001';
  END IF;

  -- Contact email — derived from the authenticated user, never a client param.
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;
  v_email := coalesce(v_email, v_uid::text || '@self-serve.local');

  -- find-or-create the hidden personal host venue (ONE per user, reused).
  SELECT v.id INTO v_venue_id
  FROM public.venues v
  JOIN public.venue_admins va ON va.venue_id = v.id
  WHERE va.user_id = v_uid
    AND va.role = 'owner'
    AND v.is_personal_host = true
  ORDER BY v.created_at
  LIMIT 1;

  IF v_venue_id IS NULL THEN
    v_venue_id := 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

    INSERT INTO public.venues (
      id, name, sport, contact_email, active,
      subscription_status, verification_status, origin, is_personal_host,
      created_by_user
    )
    VALUES (
      v_venue_id, 'Personal Host', v_sport, v_email, true,
      'trial', 'pending', 'self_serve', true,
      v_uid
    );

    INSERT INTO public.venue_admins (
      venue_id, user_id, email, role, status, granted_by, granted_at
    )
    VALUES (
      v_venue_id, v_uid, v_email, 'owner', 'active', v_uid, now()
    );
  END IF;

  -- Collision-safe slug: slugify(name) + '-' + short random, retry on conflict.
  v_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  IF v_base = '' THEN
    v_base := 'tournament';
  END IF;
  v_base := left(v_base, 60);

  FOR i IN 1..5 LOOP
    v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    BEGIN
      INSERT INTO public.tournament_events (
        venue_id, club_id, name, slug, event_date,
        status, sport, origin, created_by_user, branding
      )
      VALUES (
        v_venue_id, NULL, v_name, v_slug, v_event_date,
        'open', v_sport, 'self_serve', v_uid,
        jsonb_build_object('ref_ui_config', v_preset)
      )
      RETURNING id INTO v_tournament_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF i = 5 THEN
        RAISE EXCEPTION 'slug_generation_failed' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  -- Default competition so teams can register immediately.
  INSERT INTO public.competitions (
    season_id, tournament_event_id, name, type, format, status
  )
  VALUES (
    NULL, v_tournament_id, 'Main Draw', v_comp_type, v_comp_format, 'setup'
  )
  RETURNING id INTO v_competition_id;

  -- Audit — canonical columns; actor_type from the CHECK-valid set.
  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, v_uid, 'venue_admin', 'user_id:' || v_uid::text,
    'tournament_self_serve_created', 'tournament_event', v_tournament_id::text,
    jsonb_build_object(
      'name', v_name,
      'slug', v_slug,
      'sport', v_sport,
      'format', v_format,
      'venue_id', v_venue_id,
      'competition_id', v_competition_id,
      'origin', 'self_serve'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_id', v_tournament_id,
    'slug', v_slug,
    'venue_id', v_venue_id,
    'competition_id', v_competition_id
  );
END;
$function$;

-- Grants: authenticated-only. Strip PUBLIC and the auto-granted anon explicitly.
REVOKE ALL ON FUNCTION public.self_serve_create_tournament(text, text, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_create_tournament(text, text, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_create_tournament(text, text, text, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Fix the mig-484 venue cap to exclude hidden personal-host venues
-- ─────────────────────────────────────────────────────────────────────────
-- The hidden host inserted above is origin='self_serve' + verification_status=
-- 'pending', so mig-484's self_serve_create_venue abuse cap (which counts exactly
-- those) would silently count it — a user who ran a tournament could then create
-- only 2 (not 3) real self-serve venues. The two caps must be independent, so
-- re-create the venue RPC with an `is_personal_host = false` exclusion on the cap
-- query. Body is byte-identical to mig 484 apart from that one added clause.
CREATE OR REPLACE FUNCTION public.self_serve_create_venue(
  p_name          text,
  p_contact_email text,
  p_sport         text DEFAULT 'football'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_email       text;
  v_sport       text;
  v_venue_id    text;
  v_owned_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'venue_name_required' USING ERRCODE = 'P0001';
  END IF;
  IF length(trim(p_name)) > 120 THEN
    RAISE EXCEPTION 'venue_name_too_long' USING ERRCODE = 'P0001';
  END IF;
  IF p_contact_email IS NULL OR p_contact_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'contact_email_invalid' USING ERRCODE = 'P0001';
  END IF;
  v_email := lower(trim(p_contact_email));
  v_sport := COALESCE(NULLIF(trim(p_sport), ''), 'football');

  -- Abuse cap — at most 3 self-serve venues per user still awaiting
  -- verification. Excludes hidden personal-host venues (mig 489) so the
  -- tournament host never eats into the operator-venue cap.
  SELECT count(*) INTO v_owned_count
  FROM public.venue_admins va
  JOIN public.venues v ON v.id = va.venue_id
  WHERE va.user_id = v_uid
    AND va.role = 'owner'
    AND v.origin = 'self_serve'
    AND v.verification_status = 'pending'
    AND v.is_personal_host = false;
  IF v_owned_count >= 3 THEN
    RAISE EXCEPTION 'self_serve_venue_cap_reached' USING ERRCODE = 'P0001';
  END IF;

  v_venue_id := 'v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  INSERT INTO public.venues (
    id, name, sport, contact_email, active,
    subscription_status, verification_status, origin, created_by_user
  )
  VALUES (
    v_venue_id, trim(p_name), v_sport, v_email, true,
    'trial', 'pending', 'self_serve', v_uid
  );

  INSERT INTO public.venue_admins (
    venue_id, user_id, email, role, status, granted_by, granted_at
  )
  VALUES (
    v_venue_id, v_uid, v_email, 'owner', 'active', v_uid, now()
  );

  INSERT INTO public.audit_events (
    team_id, actor_user_id, actor_type, actor_identifier,
    action, entity_type, entity_id, metadata
  )
  VALUES (
    v_venue_id, v_uid, 'venue_admin', 'user_id:' || v_uid::text,
    'venue_self_serve_created', 'venue', v_venue_id,
    jsonb_build_object(
      'venue_name', trim(p_name),
      'sport', v_sport,
      'origin', 'self_serve',
      'verification_status', 'pending'
    )
  );

  PERFORM public.notify_venue_change(v_venue_id, 'venue_created');

  RETURN jsonb_build_object(
    'ok', true,
    'venue_id', v_venue_id,
    'verification_status', 'pending',
    'origin', 'self_serve'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.self_serve_create_venue(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_create_venue(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_serve_create_venue(text, text, text) TO authenticated;
