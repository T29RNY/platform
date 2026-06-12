-- 270_membership_venue_customers.sql
--
-- Phase 2 of the Venue Membership programme — PER-PERSON IDENTITY + GDPR.
-- The venue domain has never stored *people* (customers were derived from
-- pitch_bookings). Memberships need a real per-person/family identity.
--
-- New table `venue_customers` (RLS-walled, RPC-only) + 4 RPCs following the
-- canonical venue write pattern (resolve_venue_caller → manage_memberships
-- capability gate → validate → write → audit_events → jsonb). All PII lives
-- here, venue-scoped, never crossing the casual↔venue wall.
--
-- GDPR: explicit marketing consent (consent_marketing + consent_at);
-- right-to-erasure via venue_erase_customer (scrubs PII, keeps the row +
-- status='erased' so membership/charge history stays referentially intact).
-- De-dup: a returning person is matched on (venue_id, lower(email)); creating
-- a duplicate raises customer_exists carrying the existing id in DETAIL.
--
-- Audit metadata stores FLAGS not PII values (has_email etc.) — the audit
-- trail must not itself leak personal data.

-- ── 1. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  first_name        text NOT NULL,
  last_name         text,
  email             text,
  phone             text,
  dob               date,
  household_id      uuid,                       -- shared uuid groups a family; NULL = none
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','erased')),
  consent_marketing boolean NOT NULL DEFAULT false,
  consent_at        timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- one live person per (venue, email); erased rows excluded so a scrub frees the slot
CREATE UNIQUE INDEX IF NOT EXISTS venue_customers_uniq_email
  ON public.venue_customers (venue_id, lower(email))
  WHERE email IS NOT NULL AND status <> 'erased';
CREATE INDEX IF NOT EXISTS venue_customers_by_venue
  ON public.venue_customers (venue_id) WHERE status <> 'erased';
CREATE INDEX IF NOT EXISTS venue_customers_household
  ON public.venue_customers (household_id) WHERE household_id IS NOT NULL;

ALTER TABLE public.venue_customers ENABLE ROW LEVEL SECURITY;
-- No policies: all access via the SECURITY DEFINER RPCs below (venue posture).
REVOKE ALL ON public.venue_customers FROM anon, authenticated;

-- ── 2. venue_create_customer (WRITE, gated) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.venue_create_customer(
  p_venue_token       text,
  p_first_name        text,
  p_last_name         text DEFAULT NULL,
  p_email             text DEFAULT NULL,
  p_phone             text DEFAULT NULL,
  p_dob               date DEFAULT NULL,
  p_household_id      uuid DEFAULT NULL,
  p_consent_marketing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_first    text := NULLIF(btrim(p_first_name), '');
  v_email    text := NULLIF(lower(btrim(p_email)), '');
  v_phone    text := NULLIF(btrim(p_phone), '');
  v_existing uuid;
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'first_name_required' USING ERRCODE = 'P0001';
  END IF;

  -- returning-person de-dup on email within the venue
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.venue_customers
     WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased'
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'customer_exists' USING ERRCODE = 'P0001', DETAIL = v_existing::text;
    END IF;
  END IF;

  INSERT INTO public.venue_customers
    (venue_id, first_name, last_name, email, phone, dob, household_id,
     consent_marketing, consent_at)
  VALUES
    (v_venue_id, v_first, NULLIF(btrim(p_last_name), ''), v_email, v_phone, p_dob, p_household_id,
     COALESCE(p_consent_marketing, false),
     CASE WHEN COALESCE(p_consent_marketing, false) THEN now() ELSE NULL END)
  RETURNING id INTO v_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_customer_created', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id,
                             'has_email', v_email IS NOT NULL,
                             'has_phone', v_phone IS NOT NULL,
                             'consent_marketing', COALESCE(p_consent_marketing, false)));

  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_create_customer(text,text,text,text,text,date,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_create_customer(text,text,text,text,text,date,uuid,boolean) TO anon, authenticated;

-- ── 3. venue_update_customer (WRITE, gated) ──────────────────────────────────
-- Partial update: a NULL argument leaves that field UNCHANGED (COALESCE).
-- (Full clear of a field is via venue_erase_customer; v1 keeps update simple.)
CREATE OR REPLACE FUNCTION public.venue_update_customer(
  p_venue_token       text,
  p_customer_id       uuid,
  p_first_name        text DEFAULT NULL,
  p_last_name         text DEFAULT NULL,
  p_email             text DEFAULT NULL,
  p_phone             text DEFAULT NULL,
  p_dob               date DEFAULT NULL,
  p_household_id      uuid DEFAULT NULL,
  p_consent_marketing boolean DEFAULT NULL,
  p_notes             text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_email    text := NULLIF(lower(btrim(p_email)), '');
  v_existing uuid;
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  -- if email is changing, re-check the venue de-dup
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.venue_customers
     WHERE venue_id = v_venue_id AND lower(email) = v_email AND status <> 'erased'
       AND id <> p_customer_id
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'customer_exists' USING ERRCODE = 'P0001', DETAIL = v_existing::text;
    END IF;
  END IF;

  UPDATE public.venue_customers SET
    first_name        = COALESCE(NULLIF(btrim(p_first_name), ''), first_name),
    last_name         = COALESCE(NULLIF(btrim(p_last_name), ''), last_name),
    email             = COALESCE(v_email, email),
    phone             = COALESCE(NULLIF(btrim(p_phone), ''), phone),
    dob               = COALESCE(p_dob, dob),
    household_id      = COALESCE(p_household_id, household_id),
    consent_marketing = COALESCE(p_consent_marketing, consent_marketing),
    consent_at        = CASE WHEN p_consent_marketing IS TRUE AND NOT consent_marketing THEN now()
                             ELSE consent_at END,
    notes             = COALESCE(NULLIF(btrim(p_notes), ''), notes),
    updated_at        = now()
  WHERE id = p_customer_id AND venue_id = v_venue_id AND status <> 'erased'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_customer_updated', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id));

  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text) TO anon, authenticated;

-- ── 4. venue_erase_customer (WRITE, gated) — GDPR right-to-erasure ────────────
-- Scrubs all PII but KEEPS the row (status='erased') so any membership/charge
-- history referencing this customer stays referentially intact.
CREATE OR REPLACE FUNCTION public.venue_erase_customer(
  p_venue_token text,
  p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_id       uuid;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venue_customers SET
    first_name='[erased]', last_name=NULL, email=NULL, phone=NULL, dob=NULL,
    household_id=NULL, notes=NULL, consent_marketing=false, consent_at=NULL,
    status='erased', updated_at=now()
  WHERE id = p_customer_id AND venue_id = v_venue_id AND status <> 'erased'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue_id, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'venue_customer_erased', 'venue_customer', v_id::text,
          jsonb_build_object('venue_id', v_venue_id));

  RETURN jsonb_build_object('ok', true, 'customer_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_erase_customer(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_erase_customer(text,uuid) TO anon, authenticated;

-- ── 5. venue_list_customers_people (READ) ────────────────────────────────────
-- The people directory — DISTINCT from venue_list_customers (mig 223), which
-- derives bookers from pitch_bookings. Read open to any venue member (matches
-- venue_list_customers posture); excludes erased rows by default.
CREATE OR REPLACE FUNCTION public.venue_list_customers_people(
  p_venue_token   text,
  p_include_erased boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller   record;
  v_venue_id text;
  v_rows     jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.first_name, c.last_name), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT id, venue_id, first_name, last_name, email, phone, dob, household_id,
             status, consent_marketing, consent_at, created_at, updated_at
        FROM public.venue_customers
       WHERE venue_id = v_venue_id
         AND (p_include_erased OR status <> 'erased')
    ) c;

  RETURN jsonb_build_object('ok', true, 'customers', v_rows);
END;
$fn$;
REVOKE ALL ON FUNCTION public.venue_list_customers_people(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_customers_people(text,boolean) TO anon, authenticated;
