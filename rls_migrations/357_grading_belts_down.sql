-- 357_grading_belts_down.sql — reverse of 357_grading_belts.sql
--
-- Restores get_member_pass to its mig-356 body (without the 'grades' field) and
-- drops the Phase 2 grading RPCs + tables. Run only to fully unwind Phase 2.

DROP FUNCTION IF EXISTS public.venue_create_grading_scheme(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.venue_add_grade(text, uuid, text, int, text, int);
DROP FUNCTION IF EXISTS public.venue_award_grade(text, uuid, uuid, int, text);
DROP FUNCTION IF EXISTS public.venue_list_grading_schemes(text, text);
DROP FUNCTION IF EXISTS public.member_get_grade_history(text);

DROP TABLE IF EXISTS public.member_grades;
DROP TABLE IF EXISTS public.venue_grades;
DROP TABLE IF EXISTS public.venue_grading_schemes;

-- get_member_pass reverted to the mig-356 body (no 'grades' field).
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
