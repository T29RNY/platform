-- 615_formguard_club_lead.sql
-- FORM GUARD, phase 1 of 6 — protect the unauthenticated public write endpoints.
-- This migration covers `club_capture_lead` (the LIVE DF Sports trial CTA on
-- /c/df-sports-coaching). The other five open endpoints follow the same recipe.
--
-- THE GAP. `club_capture_lead` is callable by `anon` with no secret: a public slug +
-- attacker-supplied PII. It writes a club_leads row AND (mig 612) queues an email to the
-- club owner. So an unauthenticated script can flood the owner's inbox, pollute the leads
-- table and burn Resend quota. mig 596's own header already conceded the in-DB per-email
-- throttle is NOT flood control ("a cap on a bucket the attacker SHARES with the victim is
-- a denial-of-service primitive"), and named edge rate-limit / captcha as the real answer,
-- filed as an open item that "MUST be settled before the CTA goes live in P5". P5 shipped
-- without it. This closes it.
--
-- THE SHAPE. Protection moves in front of the RPC, at a Vercel function
-- (apps/inorout/api/club-lead.js) that runs Vercel BotID (invisible CAPTCHA) + a per-IP
-- volume cap, then calls the RPC with the service role. This migration does the two DB
-- halves of that:
--
--   1. THE BACK-DOOR LOCK (the load-bearing part). REVOKE EXECUTE on club_capture_lead
--      from anon + authenticated. Without this the guard is decorative — an attacker just
--      skips the form and calls the RPC directly from the browser, exactly as the app does
--      today. After this, the ONLY caller is the service role, i.e. the protected route.
--      The function body is NOT touched (no CREATE OR REPLACE) — grants only.
--
--   2. A GENERIC FIXED-WINDOW RATE LIMITER (`_rate_limit_hit`) the route calls per request.
--      Keyed on a caller-supplied bucket string; the route passes the VERCEL-observed client
--      IP. That IP is trustworthy in a way the in-DB one is not: mig 596 correctly rejected
--      in-DB IP limiting because the only IP available there is request.headers ->
--      x-forwarded-for, whose client-side entry is attacker-spoofable. At the Vercel function
--      the platform sets the real connecting IP, so the same idea becomes sound one layer up.
--      Deliberately generic (bucket/max/window are parameters) so phases 2–6 reuse it
--      unchanged rather than minting five more limiters.
--
-- NOT A DoS PRIMITIVE (the mig-596 trap, deliberately avoided). The bucket is per-IP, i.e.
-- per-CALLER — NOT per-club. An attacker can only rate-limit THEMSELVES; they cannot switch
-- a victim club's form off, which is precisely what a per-club cap would have allowed.
--
-- NO BACKFILL / NO DATA CHANGE. Grants + one new table + one new function.

BEGIN;

-- ── 1. Rate-limit ledger ─────────────────────────────────────────────────────
-- Fixed-window counters. RLS ON with NO policies => no client role can read or write it;
-- only the service role (which bypasses RLS) and SECURITY DEFINER functions touch it.
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Default privileges can hand new public tables to anon/authenticated
-- (feedback_default_privileges_revoke) — revoke from the NAMED roles, not just PUBLIC.
REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
  ON public.api_rate_limits (window_start);

COMMENT ON TABLE public.api_rate_limits IS
  'Fixed-window API rate-limit counters, written only by _rate_limit_hit (service-role callers). Pruned opportunistically to 1 day.';

-- ── 2. _rate_limit_hit — atomic fixed-window counter ─────────────────────────
-- Returns TRUE when the call is ALLOWED, FALSE when the bucket is over its limit.
-- Atomic: the INSERT ... ON CONFLICT DO UPDATE ... RETURNING is a single statement, so
-- concurrent requests cannot both read a stale count (no read-then-write race).
-- Internal only: never granted to a client role; the Vercel function calls it as service_role.
CREATE OR REPLACE FUNCTION public._rate_limit_hit(
  p_key            text,
  p_max            integer,
  p_window_seconds integer)
RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_window timestamptz;
  v_hits   integer;
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) = 0 THEN
    RAISE EXCEPTION 'rate_limit_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max IS NULL OR p_max < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'rate_limit_bad_params' USING ERRCODE = 'P0001';
  END IF;

  -- Floor now() to the current fixed window.
  v_window := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.api_rate_limits (bucket_key, window_start, hits)
  VALUES (btrim(p_key), v_window, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET hits = public.api_rate_limits.hits + 1
  RETURNING hits INTO v_hits;

  -- Opportunistic prune: only on the first hit of a brand-new window for this key, so
  -- this is rare (not once per request) and the table stays bounded without a cron.
  IF v_hits = 1 THEN
    DELETE FROM public.api_rate_limits WHERE window_start < now() - INTERVAL '1 day';
  END IF;

  RETURN v_hits <= p_max;
END;
$fn$;

REVOKE ALL ON FUNCTION public._rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ── 3. THE BACK-DOOR LOCK ────────────────────────────────────────────────────
-- club_capture_lead may no longer be called straight from a browser. The protected
-- Vercel route (BotID + volume cap) calls it as service_role, which retains EXECUTE.
-- Function body unchanged — this is a grant change only, so no CREATE OR REPLACE, no
-- new overload, no return-shape change, and no JS mapper impact (Hard Rules 7/12).
REVOKE EXECUTE ON FUNCTION public.club_capture_lead(text, text, text, text, text, date)
  FROM anon, authenticated;

-- Refresh PostgREST's cache so the revoked grant takes effect promptly.
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
