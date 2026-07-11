-- 559_coach_venue_gate_futureproof.sql
-- Coach self-service pitch booking — PR #2a (venue-gate future-proof fix).
--
-- Two coupled changes that MUST ship atomically (relaxing #1 without #2 opens a
-- cross-operator soft-DoS window):
--
--   #1 RELAX the BOOKING gate `_venue_in_club_operator` (mig 412) so a club-manager
--      (NULL-caller) can book on ANY venue their club is linked to via club_venues —
--      including a standalone venue whose `company_id IS NULL`. The `company_id IS NOT
--      NULL` requirement was incidental over-restriction for the NULL caller (there is
--      no caller company to match); it stays for VENUE-TOKEN callers (league / fixture
--      same-operator placement), which are BYTE-IDENTICAL to before. Only the two
--      NULL-caller sites — club_manager_create_session / _series (mig 412) — change.
--      Fixes the "see-but-can't-book" asymmetry with PR #1's reader (mig 558), which
--      already gates on plain club_venues membership. (Operator decision Y, 2026-07-11.)
--
--   #2 HARDEN the LINK gate `venue_add_club_venue` (mig 308) so a club_venues link may
--      only be created for a venue the caller CONTROLS. Rationale: a club_venues row
--      GRANTS the club booking/occupancy authority over the target (that is exactly
--      what #1 leans on). Today venue_add_club_venue links ANY existing target with no
--      ownership/consent check, so a venue-admin in club C could link a FOREIGN venue B
--      and — after #1 — a C manager could reserve/bump slots on B, blocking B's real
--      owner (a cross-operator soft-DoS surfaced by the adversarial review). "Control" =
--      the caller's own venue, OR a same-operator (same company) sibling, OR a venue the
--      authenticated caller is an active admin of. This mirrors the control check
--      club_create (mig 286) already enforces, and makes the invariant
--      "linked ⇒ controlled ⇒ safe to reserve" hold. The other two link-creation paths
--      (club_create 286, self-serve club_create 518) already require control — verified.
--
-- Both are same-signature CREATE OR REPLACE (no DROP/overload). Reversible via _down.
-- Blast radius #2: only 5 club_venues links exist today, all same-company (0 standalone)
-- — none are re-validated; only NEW link attempts are gated. Existing behaviour of every
-- venue-token caller of _venue_in_club_operator (migs 413/415/421/545) is unchanged.
--
-- Proof: ephemeral-verify against a throwaway _e2e_ fixture (rolled back, leak-check 0):
--   #1 BEFORE=old helper rejects a company_id-NULL linked venue end-to-end; AFTER=coach
--      books it end-to-end + occupancy reserved; unlinked still rejected; venue-token
--      matrix unchanged. #2 same-company / own-venue / admin-of-target links succeed; a
--      foreign venue is rejected 'target_venue_not_controlled'.

-- ════════════════════════════════════════════════════════════════════════════
-- #1. RELAX the booking gate for club-manager (NULL) callers
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._venue_in_club_operator(
  p_caller_venue_id text,   -- NULL for non-venue callers (a club manager, auth.uid()-only)
  p_club_id         text,
  p_target_venue_id text
) RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.club_venues cv
    JOIN public.venues tv ON tv.id = cv.venue_id
    WHERE cv.club_id    = p_club_id
      AND cv.venue_id   = p_target_venue_id
      AND (
        -- Club-manager caller (no venue token): the club↔venue link IS the authorization,
        -- exactly as club_manager_pitch_availability's reader gate treats it (mig 558).
        -- company_id is irrelevant here — a standalone linked venue must be bookable.
        p_caller_venue_id IS NULL
        -- Venue-token caller (league / fixture placement): same-operator only — UNCHANGED.
        OR (tv.company_id IS NOT NULL
            AND tv.company_id = (SELECT company_id FROM public.venues WHERE id = p_caller_venue_id))
      )
  );
$fn$;

REVOKE ALL     ON FUNCTION public._venue_in_club_operator(text, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public._venue_in_club_operator(text, text, text) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- #2. HARDEN the link gate — a club_venues link requires control of the target
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.venue_add_club_venue(
  p_venue_token    text,
  p_club_id        text,
  p_target_venue_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_caller         record;
  v_venue_id       text;
  v_caller_company text;
  v_target_company text;
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

  -- CONTROL GATE (mig 559): a club_venues link grants the club booking/occupancy
  -- authority over the target, so the caller must CONTROL it — not merely name a
  -- venue that exists. Control = the caller's own venue, OR a same-operator (same
  -- company) sibling, OR a venue the authenticated caller is an active admin of.
  SELECT company_id INTO v_caller_company FROM public.venues WHERE id = v_venue_id;
  SELECT company_id INTO v_target_company FROM public.venues WHERE id = p_target_venue_id;
  -- COALESCE(...,false) = default-deny: any NULL in the predicate (e.g. a standalone
  -- caller venue whose company_id IS NULL) must REJECT, never fall through the RAISE.
  -- Both company_id sides are guarded IS NOT NULL so the same-company branch is boolean.
  IF NOT COALESCE(
       p_target_venue_id = v_venue_id
    OR (v_caller_company IS NOT NULL AND v_target_company IS NOT NULL
        AND v_target_company = v_caller_company)
    OR (auth.uid() IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.venue_admins
          WHERE venue_id = p_target_venue_id AND user_id = auth.uid()
            AND status = 'active' AND revoked_at IS NULL))
  , false) THEN
    RAISE EXCEPTION 'target_venue_not_controlled' USING ERRCODE='P0001';
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
