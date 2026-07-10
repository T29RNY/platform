-- 524_gdpr_role_gate_customers_people.sql
--
-- GDPR role-gate for venue_list_customers_people (READ).
--
-- THE LEAK: since mig 282 §5 this reader returned EVERY member PII column —
-- email, phone, structured address, emergency contact, and SPECIAL-CATEGORY
-- data (medical_conditions / allergies / medications / gp_details) plus guardian
-- details — to ANY resolved venue caller, including a plain 'staff' (reception)
-- login. The mobile + desktop UIs hide these behind an owner/manager gate, but the
-- data was still shipped over the wire to every staff device (readable in memory /
-- devtools). Special-category + safeguarding PII to under-privileged staff is a UK
-- GDPR data-minimisation failure.
--
-- THE FIX (operator decision 2026-07-10, scope A): gate the sensitive columns
-- behind the SAME capability the write RPCs already use — manage_memberships
-- (owner + manager, via _venue_has_cap). When the caller lacks it (plain staff),
-- the sensitive columns return NULL. The gated set is EXACTLY the set the UIs
-- already hide from non-owner/manager, so there is ZERO behaviour change for
-- owners/managers and no UX change for staff (they were never shown these fields);
-- the wire simply stops carrying what the client already refused to display.
--
-- Staff still receive: id, venue_id, first_name, last_name, dob, gender,
-- household_id, status, all consent flags + timestamps, requested tier, created_at,
-- updated_at — enough for the roster, the pending-approval count, and name search.
--
-- Signature UNCHANGED — venue_list_customers_people(text, boolean) — so this is a
-- pure CREATE OR REPLACE: no DROP, no overload, no call-site or wrapper change.
-- The returned JSON KEYS are unchanged (sensitive keys are present but NULL for
-- staff), so no consumer's shape breaks — Hard Rule 7 satisfied (value change, not
-- shape change). SECURITY DEFINER + pinned search_path + REVOKE/GRANT preserved.

CREATE OR REPLACE FUNCTION public.venue_list_customers_people(
  p_venue_token   text,
  p_include_erased boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller record;
  v_venue_id text;
  v_pii boolean;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;

  -- Owner/manager (or an explicit manage_memberships grant) see full PII; plain
  -- staff do not. Same gate the write RPCs (create/update/erase customer) enforce.
  v_pii := public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships');

  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.first_name, c.last_name), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT vc.id, vc.venue_id, vc.first_name, vc.last_name,
             -- ── sensitive (contact + special-category + guardian) — owner/manager only ──
             CASE WHEN v_pii THEN vc.email            ELSE NULL END AS email,
             CASE WHEN v_pii THEN vc.phone            ELSE NULL END AS phone,
             vc.dob, vc.household_id, vc.gender,
             CASE WHEN v_pii THEN vc.address_line1    ELSE NULL END AS address_line1,
             CASE WHEN v_pii THEN vc.address_line2    ELSE NULL END AS address_line2,
             CASE WHEN v_pii THEN vc.address_city     ELSE NULL END AS address_city,
             CASE WHEN v_pii THEN vc.address_postcode ELSE NULL END AS address_postcode,
             CASE WHEN v_pii THEN vc.emergency_name         ELSE NULL END AS emergency_name,
             CASE WHEN v_pii THEN vc.emergency_relationship ELSE NULL END AS emergency_relationship,
             CASE WHEN v_pii THEN vc.emergency_phone        ELSE NULL END AS emergency_phone,
             CASE WHEN v_pii THEN vc.medical_conditions ELSE NULL END AS medical_conditions,
             CASE WHEN v_pii THEN vc.allergies          ELSE NULL END AS allergies,
             CASE WHEN v_pii THEN vc.medications        ELSE NULL END AS medications,
             CASE WHEN v_pii THEN vc.gp_details         ELSE NULL END AS gp_details,
             CASE WHEN v_pii THEN vc.guardian_name         ELSE NULL END AS guardian_name,
             CASE WHEN v_pii THEN vc.guardian_relationship ELSE NULL END AS guardian_relationship,
             CASE WHEN v_pii THEN vc.guardian_phone        ELSE NULL END AS guardian_phone,
             CASE WHEN v_pii THEN vc.guardian_email        ELSE NULL END AS guardian_email,
             -- ── non-sensitive (roster / consent / status) — all callers ──
             vc.status, vc.consent_marketing, vc.consent_at,
             vc.consent_data_processing, vc.consent_data_processing_at,
             vc.consent_terms, vc.consent_terms_at,
             vc.consent_photo, vc.consent_photo_at,
             vc.consent_medical, vc.consent_medical_at,
             vc.created_at, vc.updated_at,
             vc.requested_tier_id, t.name AS requested_tier_name
        FROM public.venue_customers vc
        LEFT JOIN public.venue_membership_tiers t ON t.id = vc.requested_tier_id
       WHERE vc.venue_id = v_venue_id
         AND (p_include_erased OR vc.status <> 'erased')
    ) c;
  RETURN jsonb_build_object('ok', true, 'customers', v_rows);
END; $fn$;
REVOKE ALL ON FUNCTION public.venue_list_customers_people(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_customers_people(text,boolean) TO anon, authenticated;
