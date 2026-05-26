-- Down migration for 077_admin_go_live.
-- Drops the RPC. Does NOT touch any data rows created by the RPC
-- (matches rows, audit_events rows) — those are real domain data.

DROP FUNCTION IF EXISTS admin_go_live(text);
