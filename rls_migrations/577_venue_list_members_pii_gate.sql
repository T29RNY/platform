-- 577_venue_list_members_pii_gate.sql
--
-- PII role-gate for venue_list_members (READ). DF Sports Phase 0 / PR #0.
--
-- THE LEAK: since mig 410 this reader returned each member's `email`, `dob`, and
-- the full `guardians` array (guardian name + email + phone) to ANY resolved venue
-- caller — including a plain 'staff' (reception) login that lacks
-- manage_memberships. The member list is child-heavy (member_profiles carrying
-- guardians), so this shipped children's DOB + guardian contact details over the
-- wire to under-privileged staff devices (readable in memory / devtools) even
-- though the UIs hide those fields behind an owner/manager gate. This is the exact
-- same data-minimisation failure mig 524 fixed for venue_list_customers_people;
-- this migration applies the identical capability gate to the member reader.
--
-- THE FIX: gate email, dob, and the guardians array behind the SAME capability the
-- membership write RPCs already use — manage_memberships (owner + manager, via
-- _venue_has_cap). When the caller lacks it (plain staff), email + dob return NULL
-- and guardians returns an empty array ('[]'::jsonb — kept as an ARRAY, not null,
-- so the shape is preserved and client .map()s over guardians never break; same
-- privacy outcome as NULLing a scalar). For owner/manager (v_pii = true) every
-- returned value is byte-identical to the mig-410 output.
--
-- Signature UNCHANGED — venue_list_members(text). Pure CREATE OR REPLACE: no DROP,
-- no overload, no wrapper or call-site change. Returned JSON KEYS are unchanged
-- (email/dob present-but-NULL, guardians present-but-empty for staff) so no
-- consumer's shape breaks — Hard Rule 7 satisfied (value change, not shape change).
-- Read-only; no audit row (mirrors 524 — a gated read, not a write). SECURITY
-- DEFINER + pinned search_path + REVOKE/GRANT preserved.

CREATE OR REPLACE FUNCTION public.venue_list_members(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_caller record; v_venue_id text; v_pii boolean; v_rows jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue_id := v_caller.venue_id;
  -- Owner/manager (or an explicit manage_memberships grant) see member contact PII
  -- + guardian details; plain staff do not. Same gate the membership write RPCs use.
  v_pii := public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', m.id, 'status', m.status, 'period', m.period, 'amount_pence', m.amount_pence,
    'started_at', m.started_at, 'renews_at', m.renews_at, 'frozen_until', m.frozen_until, 'cancel_at', m.cancel_at,
    'due_soon', (m.status='active' AND m.renews_at <= current_date + 7),
    'pass_token', m.pass_token, 'customer_id', m.customer_id, 'member_profile_id', m.member_profile_id,
    'club_id', m.club_id, 'discipline', cl.discipline,
    'first_name', COALESCE(c.first_name, mp.first_name), 'last_name', COALESCE(c.last_name, mp.last_name),
    'email', CASE WHEN v_pii THEN COALESCE(c.email, mp.email) ELSE NULL END,
    'dob', CASE WHEN v_pii THEN COALESCE(mp.dob, c.dob) ELSE NULL END,
    'tier_id', t.id, 'tier_name', t.name,
    -- FAIL-CLOSED + symmetric with email/dob: guardian PII is emitted ONLY on the
    -- positive (v_pii AND has-a-profile) path; every other case — staff, NULL
    -- member_profile_id, or a hypothetical NULL v_pii — falls to ELSE '[]'. This is
    -- self-contained: it does NOT rely on _venue_has_cap never returning NULL
    -- (which it can't today, but a future refactor of that helper must not be able
    -- to silently re-open this children's-guardian array). Byte-identical output to
    -- mig 410 for owner/manager; '[]' for staff.
    'guardians', CASE
      WHEN v_pii AND m.member_profile_id IS NOT NULL THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'profile_id', g.id,
          'name', TRIM(BOTH ' ' FROM COALESCE(g.first_name,'') || ' ' || COALESCE(g.last_name,'')),
          'email', g.email, 'phone', g.phone,
          'relationship', mg.relationship, 'is_primary', mg.is_primary,
          'can_collect', mg.can_collect, 'invite_state', mg.invite_state
        ) ORDER BY mg.is_primary DESC, g.first_name)
        FROM public.member_guardians mg
        JOIN public.member_profiles g ON g.id = mg.guardian_profile_id
        WHERE mg.child_profile_id = m.member_profile_id
      ), '[]'::jsonb)
      ELSE '[]'::jsonb END
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

REVOKE ALL ON FUNCTION public.venue_list_members(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_members(text) TO anon, authenticated;
