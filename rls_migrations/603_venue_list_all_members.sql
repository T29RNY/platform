-- 603_venue_list_all_members.sql
--
-- Unified, filterable "people" reader for the operator Members surface — one shared RPC
-- so the mobile /hub operator view (apps/inorout OperatorPeople) and the desktop venue app
-- (apps/venue MembersView) show the SAME list and can't drift.
--
-- BUG (BUGS.md 2026-07-17): the two surfaces read DIFFERENT models today — mobile reads
-- venue-CRM customers (venue_list_customers_people; empty for PA → "No members yet") while
-- desktop reads memberships (venue_list_members). PA has 35 memberships + £1,175 owed but
-- 0 venue_customers, so the mobile Members tab looked empty. This unions both models:
--   • MEMBER rows  — venue_memberships (enrolled), with tier / status / team / cohort /
--                    outstanding balance / guardians.
--   • PAY-AS-YOU-GO — venue_customers with NO live membership (class/room bookings only).
-- Dedup: a customer WITH a live membership is represented by the membership row (bridge
-- venue_memberships.customer_id = venue_customers.id), never doubled.
--
-- Auth + PII gate copied VERBATIM from venue_list_members (mig 577): resolve_venue_caller
-- + _venue_has_cap('manage_memberships') — owner/manager see contact PII + guardians; plain
-- staff get NULL email/dob/phone + empty guardians. No new data exposure vs venue_list_members.
-- Filtering is done CLIENT-SIDE in both apps (search/team/cohort/status/tier/type) so a new
-- filter never needs an RPC change — this reader returns the full unfiltered set + every
-- filterable field.
--
-- Consumers (Hard Rule 14): apps/inorout OperatorPeople (Members tab) + apps/venue MembersView.
-- Outstanding balance = membership charges only (source_type='membership'); PAYG class/hire
-- arrears are a documented v1 gap (balance_pence = 0 for PAYG rows).

CREATE OR REPLACE FUNCTION public.venue_list_all_members(p_venue_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  record;
  v_venue_id text;
  v_pii     boolean;
  v_rows    jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001';
  END IF;
  v_venue_id := v_caller.venue_id;
  v_pii := public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships');

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY sort_key, sort_name), '[]'::jsonb) INTO v_rows FROM (
    -- ── MEMBERS (enrolled: venue_memberships) ──
    SELECT
      jsonb_build_object(
        'person_type',        'member',
        'membership_id',      m.id,
        'customer_id',        m.customer_id,
        'member_profile_id',  m.member_profile_id,
        'first_name',         COALESCE(c.first_name, mp.first_name),
        'last_name',          COALESCE(c.last_name, mp.last_name),
        'email',              CASE WHEN v_pii THEN COALESCE(c.email, mp.email) ELSE NULL END,
        'phone',              CASE WHEN v_pii THEN c.phone ELSE NULL END,
        'dob',                CASE WHEN v_pii THEN COALESCE(mp.dob, c.dob) ELSE NULL END,
        'status',             m.status,
        'period',             m.period,
        'amount_pence',       m.amount_pence,
        'tier_id',            t.id,
        'tier_name',          t.name,
        'club_id',            m.club_id,
        'discipline',         cl.discipline,
        'cohort_id',          m.cohort_id,
        'cohort_name',        coh.name,
        'team_id',            tm.team_id,
        'team_name',          tm.team_name,
        'renews_at',          m.renews_at,
        'started_at',         m.started_at,
        'due_soon',           (m.status='active' AND m.renews_at <= current_date + 7),
        'pass_token',         m.pass_token,
        'balance_pence',
          COALESCE((
            SELECT SUM(ch.amount_due_pence) FROM public.venue_charges ch
            WHERE ch.source_type='membership'
              AND split_part(ch.source_id, ':', 1) = m.id::text
              AND ch.status IN ('unpaid','partial')
          ), 0)
          - COALESCE((
            SELECT SUM(vp.amount_pence) FROM public.venue_payments vp
            JOIN public.venue_charges ch2 ON ch2.id = vp.charge_id
            WHERE ch2.source_type='membership'
              AND split_part(ch2.source_id, ':', 1) = m.id::text
              AND ch2.status IN ('unpaid','partial')
              AND vp.kind='payment' AND vp.voided_at IS NULL
          ), 0),
        'guardians', CASE
          WHEN v_pii AND m.member_profile_id IS NOT NULL THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'profile_id',   g.id,
              'name',         TRIM(BOTH ' ' FROM COALESCE(g.first_name,'') || ' ' || COALESCE(g.last_name,'')),
              'email',        g.email,
              'phone',        g.phone,
              'relationship', mg.relationship,
              'is_primary',   mg.is_primary,
              'can_collect',  mg.can_collect,
              'invite_state', mg.invite_state
            ) ORDER BY mg.is_primary DESC, g.first_name)
            FROM public.member_guardians mg
            JOIN public.member_profiles g ON g.id = mg.guardian_profile_id
            WHERE mg.child_profile_id = m.member_profile_id
          ), '[]'::jsonb)
          ELSE '[]'::jsonb END
      ) AS row_obj,
      CASE m.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'ending' THEN 2 ELSE 3 END AS sort_key,
      LOWER(COALESCE(c.first_name, mp.first_name, '')) AS sort_name
    FROM public.venue_memberships m
    LEFT JOIN public.venue_customers c        ON c.id  = m.customer_id
    LEFT JOIN public.member_profiles mp       ON mp.id = m.member_profile_id
    LEFT JOIN public.clubs cl                 ON cl.id = m.club_id
    JOIN      public.venue_membership_tiers t ON t.id  = m.tier_id
    LEFT JOIN public.club_cohorts coh         ON coh.id = m.cohort_id
    LEFT JOIN LATERAL (
      SELECT ct.id AS team_id, ct.name AS team_name
      FROM public.club_team_members ctm
      JOIN public.club_teams ct ON ct.id = ctm.team_id
      WHERE ctm.member_profile_id = m.member_profile_id
        AND ctm.is_active = true
        AND ct.archived_at IS NULL
      ORDER BY ct.priority_rank NULLS LAST, ct.name
      LIMIT 1
    ) tm ON true
    WHERE m.status <> 'cancelled'
      AND (m.venue_id = v_venue_id
           OR (m.club_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.club_venues WHERE club_id = m.club_id AND venue_id = v_venue_id)))

    UNION ALL

    -- ── PAY-AS-YOU-GO (venue_customers with NO live membership) ──
    SELECT
      jsonb_build_object(
        'person_type',        'payg',
        'membership_id',      NULL,
        'customer_id',        vc.id,
        'member_profile_id',  NULL,
        'first_name',         vc.first_name,
        'last_name',          vc.last_name,
        'email',              CASE WHEN v_pii THEN vc.email ELSE NULL END,
        'phone',              CASE WHEN v_pii THEN vc.phone ELSE NULL END,
        'dob',                CASE WHEN v_pii THEN vc.dob   ELSE NULL END,
        'status',             'payg',
        'period',             NULL,
        'amount_pence',       NULL,
        'tier_id',            NULL,
        'tier_name',          NULL,
        'club_id',            NULL,
        'discipline',         NULL,
        'cohort_id',          NULL,
        'cohort_name',        NULL,
        'team_id',            NULL,
        'team_name',          NULL,
        'renews_at',          NULL,
        'started_at',         NULL,
        'due_soon',           false,
        'pass_token',         NULL,
        'balance_pence',      0,        -- v1: PAYG class/hire arrears not aggregated here yet
        'guardians',          '[]'::jsonb
      ) AS row_obj,
      4 AS sort_key,
      LOWER(COALESCE(vc.first_name, '')) AS sort_name
    FROM public.venue_customers vc
    WHERE vc.venue_id = v_venue_id
      AND vc.status <> 'erased'
      AND NOT EXISTS (
            SELECT 1 FROM public.venue_memberships m2
            WHERE m2.customer_id = vc.id AND m2.status IN ('active','paused','ending'))
  ) u;

  RETURN jsonb_build_object('ok', true, 'members', v_rows);
END;
$function$;

REVOKE ALL     ON FUNCTION public.venue_list_all_members(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.venue_list_all_members(text) TO anon, authenticated;
