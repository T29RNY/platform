-- Migration 466: Safeguarding module — schema only (Incident Triage Phase 2, PR #1)
-- Additive/defaulted throughout: every existing incidents row and venue_admins row
-- stays byte-identical after apply. No RPC bodies touched here (PR #2/#3).
--
-- LD#1/#2: the flag is the SOLE source of truth for visibility — orthogonal to the
-- existing `category` enum (which already has a reserved 'safeguarding' value, mig 461,
-- kept as a soft descriptive hint only).
-- LD#4: 'safeguarding_lead' is a grant-only cap — deliberately NOT wired into
-- `_venue_has_cap`'s owner/manager default-pass. That helper (`_venue_is_safeguarding_lead`)
-- ships in PR #2. This migration only makes the cap value legal to grant/deny.

-- ---------------------------------------------------------------------------
-- 1. Additive safeguarding-flag columns on incidents
-- ---------------------------------------------------------------------------
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS is_safeguarding_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS safeguarding_flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS safeguarding_flagged_by text;

-- ---------------------------------------------------------------------------
-- 2. Extend the venue_admins capability whitelist with 'safeguarding_lead'
--    (DROP/ADD CONSTRAINT — additive-safe, every existing granted/denied cap stays
--    valid). Reproduced verbatim from live (2026-07-01) with ONLY the new value added.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_admins DROP CONSTRAINT venue_admins_caps_known;
ALTER TABLE public.venue_admins ADD CONSTRAINT venue_admins_caps_known CHECK (
  caps_grant <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships','manage_tournaments','safeguarding_lead']::text[]
  AND caps_deny <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships','manage_tournaments','safeguarding_lead']::text[]
);

-- ---------------------------------------------------------------------------
-- 3. Partial index for the Lead-only safeguarding list (PR #3's
--    venue_list_safeguarding_incidents).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_incidents_safeguarding
  ON public.incidents (venue_id, created_at)
  WHERE is_safeguarding_flagged AND resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Replace the two mig-461 hot-path indexes to exclude flagged rows, matching
--    PR #3's read-filter (`AND is_safeguarding_flagged IS NOT TRUE`) so the ops/HQ
--    queue reads stay index-only scans instead of falling back to a seq scan once
--    that predicate is added.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_incidents_queue;
CREATE INDEX IF NOT EXISTS idx_incidents_queue
  ON public.incidents (venue_id, priority, created_at)
  WHERE resolved_at IS NULL AND is_safeguarding_flagged IS NOT TRUE;

DROP INDEX IF EXISTS public.idx_incidents_escalation_inbox;
CREATE INDEX IF NOT EXISTS idx_incidents_escalation_inbox
  ON public.incidents (escalated_at)
  WHERE escalated_at IS NOT NULL AND resolved_at IS NULL AND is_safeguarding_flagged IS NOT TRUE;

-- ---------------------------------------------------------------------------
-- 5. GDPR carve-out (LD#8, UK GDPR Art. 17(3)(b)): do NOT add
--    safeguarding_flagged_by to the delete_my_account* NULL-cascade. A flagged
--    incident's routing record must survive the flagger's or reporter's own
--    account deletion — the safeguarding legal obligation overrides the ordinary
--    erasure right. This is the OPPOSITE of the mig-461 NULL-cascade applied to
--    reported_by/resolved_by/assigned_to on the same table. No RPC body changes
--    in this migration; this comment exists so a future editor of
--    delete_my_account* does not "complete the pattern" by adding this column.
-- ---------------------------------------------------------------------------
