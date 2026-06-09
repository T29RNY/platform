-- Down migration 231 — remove the venue incident lifecycle RPCs.
-- Note: reported_by is NOT restored to NOT NULL — rows inserted by token callers may have
-- NULL reported_by, so re-adding the constraint could fail. Left nullable deliberately.

DROP FUNCTION IF EXISTS public.venue_log_incident(text, text, text, uuid);
DROP FUNCTION IF EXISTS public.venue_resolve_incident(text, uuid, text);
