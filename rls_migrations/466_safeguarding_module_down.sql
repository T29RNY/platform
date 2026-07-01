-- Down migration for 466_safeguarding_module.sql

-- 1. Restore the mig-461 index definitions verbatim.
DROP INDEX IF EXISTS public.idx_incidents_queue;
CREATE INDEX IF NOT EXISTS idx_incidents_queue
  ON public.incidents (venue_id, priority, created_at)
  WHERE resolved_at IS NULL;

DROP INDEX IF EXISTS public.idx_incidents_escalation_inbox;
CREATE INDEX IF NOT EXISTS idx_incidents_escalation_inbox
  ON public.incidents (escalated_at)
  WHERE escalated_at IS NOT NULL AND resolved_at IS NULL;

-- 2. Drop the safeguarding partial index.
DROP INDEX IF EXISTS public.idx_incidents_safeguarding;

-- 3. Revert the caps CHECK constraint to its pre-466 form.
ALTER TABLE public.venue_admins DROP CONSTRAINT venue_admins_caps_known;
ALTER TABLE public.venue_admins ADD CONSTRAINT venue_admins_caps_known CHECK (
  caps_grant <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships','manage_tournaments']::text[]
  AND caps_deny <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships','manage_tournaments']::text[]
);

-- 4. Drop the flag columns.
ALTER TABLE public.incidents
  DROP COLUMN IF EXISTS is_safeguarding_flagged,
  DROP COLUMN IF EXISTS safeguarding_flagged_at,
  DROP COLUMN IF EXISTS safeguarding_flagged_by;
