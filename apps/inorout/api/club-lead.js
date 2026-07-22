// POST /api/club-lead — the guarded front door for club_capture_lead (mig 615).
//
// WHY THIS EXISTS. club_capture_lead is an UNAUTHENTICATED write: a public slug plus
// attacker-supplied PII, which stores a lead AND queues an email to the club owner
// (mig 612). Called straight from the browser it was open to scripted flooding —
// junk leads, an inbox-bombed owner, burnt Resend quota. mig 596's own header conceded
// the in-DB per-email throttle is not flood control and named a captcha / edge limit as
// the real answer, "MUST be settled before the CTA goes live". This is that guard.
//
// Two layers, then the call:
//   1. Vercel BotID (invisible CAPTCHA, 'basic' tier) — is the caller a real browser?
//   2. Per-IP fixed-window volume cap via _rate_limit_hit (mig 615).
// Only then is the RPC invoked, with the SERVICE ROLE. mig 615 revokes anon/authenticated
// EXECUTE on club_capture_lead, so this route is the ONLY way in — without that revoke the
// guard would be decorative (a bot would simply call the RPC directly).
//
// ⚠️ SETUP THIS ROUTE DEPENDS ON (security review, PR #618): BotID needs the two proxy
// rewrites in apps/inorout/vercel.json, ABOVE the SPA catch-all. Without them the
// challenge script resolves to index.html, the client's patched fetch never resolves, and
// every submit hangs — silent 100% lead loss. Verify after deploy (see DEPLOY CHECK below).
//
// FAIL POSTURE — asymmetric, and DEGRADED rather than silent:
//   * A positive bot verdict            -> BLOCK (403). Fail CLOSED.
//   * BotID erroring / not provisioned  -> ALLOW, but drop to a much TIGHTER cap and
//                                          record it, so a permanently-broken BotID is
//                                          visible instead of masquerading as healthy.
// Rationale: silently dropping real parents because a bot-detection dependency hiccuped is
// a worse business outcome than letting a rare bot reach a capped endpoint. But an
// unnoticed permanent failure would leave the endpoint on the cap alone, so the degraded
// path must cost the caller something AND leave a trace.
//
// The per-IP bucket is per-CALLER, never per-club: an attacker can only rate-limit
// themselves. A per-club cap would have let them switch a victim club's form OFF — the
// denial-of-service primitive mig 596 explicitly rejected.
//
// DEPLOY CHECK (do once, after the first deploy): submit the form on
// /c/df-sports-coaching and confirm the Vercel function log does NOT contain
// "[club-lead] botid degraded". If it does, BotID is not actually running — check the
// vercel.json rewrites and that BotID/OIDC is provisioned for the project.

const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

// Generous by design: a real parent submits once or twice, but a shared network (club
// open day, school wifi, office NAT) legitimately produces a burst from ONE IP. This
// stops floods (thousands) without punishing a busy signup evening.
const RATE_MAX_PER_WINDOW = 20;
// Applied instead when BotID could not run: the cap is then the ONLY defence, so it
// tightens to roughly "a real family filling the form in", not a scripted burst.
const RATE_MAX_DEGRADED = 3;
const RATE_WINDOW_SECONDS = 3600; // 1 hour

// Only headers VERCEL sets from the real connecting socket. `x-forwarded-for` is
// deliberately NOT trusted: it is client-settable, and honouring it would let an attacker
// (a) evade their own bucket by rotating the header and (b) poison a victim's bucket by
// sending the victim's IP — the same class of denial-of-service primitive mig 596 rejected.
// Absent those headers we fall back to a single shared bucket, which fails toward
// throttling rather than toward an open door.
function clientIpKey(req) {
  const h = req.headers || {};
  const raw = h["x-vercel-forwarded-for"] || h["x-real-ip"];
  const ip = raw ? String(raw).split(",")[0].trim().slice(0, 64) : "";
  if (!ip) return "club_lead:noip";
  // Hash it: an IP is personal data, and this ledger is retained for a day. The digest is
  // just as good a bucket key, is fixed-length (so an oversized header can't overflow the
  // index and make the limiter throw), and stores no identifier.
  const pepper = process.env.RATE_LIMIT_PEPPER || "";
  return "club_lead:" + crypto.createHash("sha256").update(ip + pepper).digest("hex").slice(0, 32);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "not_configured" });
  }

  // ── Layer 1: BotID (invisible CAPTCHA) ─────────────────────────────────────
  // checkLevel 'basic' matches the Vercel dashboard tier in use; 'deepAnalysis' is the
  // paid Kasada upgrade and is deliberately not requested. `headers` is passed for
  // completeness only — in production the package reads Vercel's request context and
  // ignores this argument, so it must NOT be relied on as the mechanism.
  let botDegraded = false;
  try {
    const { checkBotId } = require("botid/server");
    const verdict = await checkBotId({
      advancedOptions: { checkLevel: "basic", headers: req.headers },
    });
    if (verdict?.isBot && !verdict?.isVerifiedBot) {
      return res.status(403).json({ ok: false, reason: "blocked" });
    }
  } catch (e) {
    // Fail OPEN but DEGRADED — see the fail-posture note above.
    botDegraded = true;
    console.error("[club-lead] botid degraded (allowing at tightened cap)", e?.message || e);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── Layer 2: per-IP volume cap ─────────────────────────────────────────────
  try {
    if (botDegraded) {
      // A countable, queryable trace that the degraded path is being taken: a broken
      // BotID otherwise looks identical to a healthy one from outside.
      // (audit_events is not usable here — its team_id is NOT NULL and the club isn't
      // resolved until the RPC runs.)
      await supabase.rpc("_rate_limit_hit", {
        p_key: "club_lead:_botid_degraded", p_max: 2147483647, p_window_seconds: RATE_WINDOW_SECONDS,
      });
    }
    const { data: allowed, error: rlErr } = await supabase.rpc("_rate_limit_hit", {
      p_key: clientIpKey(req),
      p_max: botDegraded ? RATE_MAX_DEGRADED : RATE_MAX_PER_WINDOW,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (rlErr) throw rlErr;
    if (allowed === false) {
      // Same shape the RPC uses for its own throttle, so the client needs no new branch.
      return res.status(429).json({ ok: false, reason: "too_many_requests" });
    }
  } catch (e) {
    // Fail OPEN on limiter failure for the same reason as BotID — but log loudly.
    console.error("[club-lead] rate-limit check failed (allowing)", e?.message || e);
  }

  // ── The actual write ───────────────────────────────────────────────────────
  const { slug, parentName, parentEmail, parentPhone, childFirstName, childDob } = req.body || {};
  if (!slug || !parentName || !parentEmail) {
    return res.status(400).json({ error: "missing_params" });
  }

  try {
    const { data, error } = await supabase.rpc("club_capture_lead", {
      p_slug: slug,
      p_parent_name: parentName,
      p_parent_email: parentEmail,
      p_parent_phone: parentPhone ?? null,
      p_child_first_name: childFirstName ?? null,
      p_child_dob: childDob ?? null,
    });
    if (error) throw error;
    // Pass the RPC's jsonb straight through — the client contract is unchanged.
    return res.status(200).json(data ?? { ok: true });
  } catch (e) {
    console.error("[club-lead] club_capture_lead failed", e?.message || e);
    return res.status(500).json({ ok: false, error: "capture_failed" });
  }
};
