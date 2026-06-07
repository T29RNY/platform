-- 214: drop the dead cast_potm_vote RPC.
--
-- Session-71 audit (finding B3): cast_potm_vote is a complete but superseded POTM
-- voting RPC — the inorout client votes via submit_potm_vote only (supabase.js),
-- which audits correctly. cast_potm_vote has ZERO callers (verified across apps/ +
-- packages/ and across pg_proc) and is missing the HARD RULE 9 audit_events insert.
-- It is an anon+authenticated-granted write RPC that nothing uses — exactly the dead
-- surface mig 081 swept. Dropped. (Down recreates it verbatim incl. grants.)

DROP FUNCTION IF EXISTS public.cast_potm_vote(text, text, text);

SELECT pg_notify('pgrst', 'reload schema');
