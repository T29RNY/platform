-- 524_gdpr_role_gate_customers_people_down.sql
--
-- Revert 524: restore the mig 282 §5 venue_list_customers_people that returned
-- ALL PII columns to every resolved venue caller (no role gate). Reintroduces the
-- GDPR over-share — down-migration only, for rollback parity.

CREATE OR REPLACE FUNCTION public.venue_list_customers_people(
  p_venue_token   text,
  p_include_erased boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_caller record; v_venue_id text; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.first_name, c.last_name), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT vc.id, vc.venue_id, vc.first_name, vc.last_name, vc.email, vc.phone, vc.dob, vc.household_id,
             vc.gender, vc.address_line1, vc.address_line2, vc.address_city, vc.address_postcode,
             vc.emergency_name, vc.emergency_relationship, vc.emergency_phone,
             vc.medical_conditions, vc.allergies, vc.medications, vc.gp_details,
             vc.guardian_name, vc.guardian_relationship, vc.guardian_phone, vc.guardian_email,
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
