-- 371: Canonical person spine (Phase 0a — Unified Identity & Sync Spine)
-- One `people` row per real human; soft `person_id` links on the five identity silos
-- (players, member_profiles, match_officials, team_admins, venue_admins).
--
-- LINKAGE ONLY (no PII): canonical_email/canonical_name and the delete-account person-scrub
-- are DEFERRED to the backlog (operator timing) — see the epic plan. Keeping `people` PII-free
-- means deferring the scrub leaves no residue to leak.
--
-- Auto-maintained by BEFORE triggers so EVERY path that links a row to an auth user fills
-- person_id (claim/link RPCs, admin grants, future code) — no per-RPC edits, no crossovers.
--
-- NOTE: 370 was taken by the parallel App-Store session (delete_my_account_auth); this epic
-- starts at 371. The delete-account person-scrub will edit delete_my_account/_auth LATER,
-- on top of that session's merged version.

CREATE TABLE IF NOT EXISTS public.people (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
-- No policies: reachable only via SECURITY DEFINER functions / table owner (triggers).
-- Deny-by-default for anon + authenticated.

ALTER TABLE public.players         ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.match_officials ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.team_admins     ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.venue_admins    ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_players_person_id         ON public.players(person_id);
CREATE INDEX IF NOT EXISTS idx_member_profiles_person_id ON public.member_profiles(person_id);
CREATE INDEX IF NOT EXISTS idx_match_officials_person_id ON public.match_officials(person_id);
CREATE INDEX IF NOT EXISTS idx_team_admins_person_id     ON public.team_admins(person_id);
CREATE INDEX IF NOT EXISTS idx_venue_admins_person_id    ON public.venue_admins(person_id);

-- ensure_person: upsert one people row per auth user, return id. Owner-run; not client-callable.
CREATE OR REPLACE FUNCTION public.ensure_person(p_uid uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_uid IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.people WHERE auth_user_id = p_uid;
  IF v_id IS NULL THEN
    INSERT INTO public.people (auth_user_id) VALUES (p_uid)
      ON CONFLICT (auth_user_id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id
      RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_person(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_person(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_person(uuid) FROM authenticated;

-- Trigger fns: fill person_id when a row is linked to an auth user (no-op once set / when unlinked).
CREATE OR REPLACE FUNCTION public.tg_set_person_id_from_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.person_id IS NULL THEN
    NEW.person_id := public.ensure_person(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_set_person_id_from_auth_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL AND NEW.person_id IS NULL THEN
    NEW.person_id := public.ensure_person(NEW.auth_user_id);
  END IF;
  RETURN NEW;
END;
$$;

-- Least-privilege: trigger fns are fired by the system, never called via API (return type
-- trigger). Revoke default grants so anon/authenticated have no EXECUTE. Does not affect firing.
REVOKE ALL ON FUNCTION public.tg_set_person_id_from_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_set_person_id_from_user_id() FROM anon;
REVOKE ALL ON FUNCTION public.tg_set_person_id_from_user_id() FROM authenticated;
REVOKE ALL ON FUNCTION public.tg_set_person_id_from_auth_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_set_person_id_from_auth_user_id() FROM anon;
REVOKE ALL ON FUNCTION public.tg_set_person_id_from_auth_user_id() FROM authenticated;

DROP TRIGGER IF EXISTS trg_players_person_id ON public.players;
CREATE TRIGGER trg_players_person_id
  BEFORE INSERT OR UPDATE OF user_id ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_person_id_from_user_id();

DROP TRIGGER IF EXISTS trg_match_officials_person_id ON public.match_officials;
CREATE TRIGGER trg_match_officials_person_id
  BEFORE INSERT OR UPDATE OF user_id ON public.match_officials
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_person_id_from_user_id();

DROP TRIGGER IF EXISTS trg_team_admins_person_id ON public.team_admins;
CREATE TRIGGER trg_team_admins_person_id
  BEFORE INSERT OR UPDATE OF user_id ON public.team_admins
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_person_id_from_user_id();

DROP TRIGGER IF EXISTS trg_venue_admins_person_id ON public.venue_admins;
CREATE TRIGGER trg_venue_admins_person_id
  BEFORE INSERT OR UPDATE OF user_id ON public.venue_admins
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_person_id_from_user_id();

DROP TRIGGER IF EXISTS trg_member_profiles_person_id ON public.member_profiles;
CREATE TRIGGER trg_member_profiles_person_id
  BEFORE INSERT OR UPDATE OF auth_user_id ON public.member_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_person_id_from_auth_user_id();

-- BACKFILL: one people row per distinct auth user across silos (only auth users that still
-- exist; orphaned silo links → person_id stays NULL). person_id-only UPDATEs don't fire triggers.
INSERT INTO public.people (auth_user_id)
SELECT DISTINCT s.uid
FROM (
  SELECT user_id      AS uid FROM public.players         WHERE user_id IS NOT NULL
  UNION SELECT auth_user_id FROM public.member_profiles  WHERE auth_user_id IS NOT NULL
  UNION SELECT user_id      FROM public.match_officials  WHERE user_id IS NOT NULL
  UNION SELECT user_id      FROM public.team_admins      WHERE user_id IS NOT NULL
  UNION SELECT user_id      FROM public.venue_admins     WHERE user_id IS NOT NULL
) s
JOIN auth.users u ON u.id = s.uid
ON CONFLICT (auth_user_id) DO NOTHING;

UPDATE public.players p         SET person_id = pe.id FROM public.people pe WHERE p.user_id      = pe.auth_user_id AND p.person_id  IS NULL;
UPDATE public.member_profiles m SET person_id = pe.id FROM public.people pe WHERE m.auth_user_id = pe.auth_user_id AND m.person_id  IS NULL;
UPDATE public.match_officials o SET person_id = pe.id FROM public.people pe WHERE o.user_id      = pe.auth_user_id AND o.person_id  IS NULL;
UPDATE public.team_admins ta    SET person_id = pe.id FROM public.people pe WHERE ta.user_id     = pe.auth_user_id AND ta.person_id IS NULL;
UPDATE public.venue_admins va   SET person_id = pe.id FROM public.people pe WHERE va.user_id     = pe.auth_user_id AND va.person_id IS NULL;
