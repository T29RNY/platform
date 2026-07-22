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
// FAIL POSTURE, deliberate and asymmetric:
//   * A positive bot verdict           -> BLOCK (403). Fail CLOSED.
//   * BotID itself erroring/unreachable -> ALLOW, still rate-limited. Fail OPEN.
// This is a lead-capture form: silently dropping real parents because a bot-detection
// dependency hiccuped is a worse business outcome than letting a rare bot through to a
// volume-capped endpoint. The cap is the backstop that always applies.
//
// The per-IP bucket is per-CALLER, never per-club: an attacker can only rate-limit
// themselves. A per-club cap would have let them switch a victim club's form OFF — the
// denial-of-service primitive mig 596 explicitly rejected.

const { createClient } = require("@supabase/supabase-js");

// Generous by design: a real parent submits once or twice, but a shared network (club
// open day, school wifi, office NAT) legitimately produces a burst from ONE IP. This
// stops floods (thousands) without punishing a busy signup evening.
const RATE_MAX_PER_WINDOW = 20;
const RATE_WINDOW_SECONDS = 3600; // 1 hour

// Vercel sets these at the edge from the real connecting socket, so unlike the
// x-forwarded-for visible inside Postgres they are not client-spoofable here.
function clientIp(req) {
  const h = req.headers || {};
  const vercelIp = h["x-vercel-forwarded-for"] || h["x-real-ip"];
  if (vercelIp) return String(vercelIp).split(",")[0].trim();
  const fwd = h["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return "unknown";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "not_configured" });
  }

  // ── Layer 1: BotID (invisible CAPTCHA) ─────────────────────────────────────
  // Node serverless (not Next.js) has no async request context, so the headers are
  // passed explicitly. checkLevel 'basic' matches the Vercel dashboard tier in use;
  // 'deepAnalysis' is the paid Kasada upgrade and is deliberately not requested.
  try {
    const { checkBotId } = require("botid/server");
    const verdict = await checkBotId({
      advancedOptions: { checkLevel: "basic", headers: req.headers },
    });
    if (verdict?.isBot && !verdict?.isVerifiedBot) {
      return res.status(403).json({ ok: false, reason: "blocked" });
    }
  } catch (e) {
    // Fail OPEN — see the fail-posture note above. The volume cap below still applies.
    console.error("[club-lead] botid check failed (allowing, still rate-limited)", e);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── Layer 2: per-IP volume cap ─────────────────────────────────────────────
  const ip = clientIp(req);
  try {
    const { data: allowed, error: rlErr } = await supabase.rpc("_rate_limit_hit", {
      p_key: `club_lead:${ip}`,
      p_max: RATE_MAX_PER_WINDOW,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (rlErr) throw rlErr;
    if (allowed === false) {
      // Same shape the RPC uses for its own throttle, so the client needs no new branch.
      return res.status(429).json({ ok: false, reason: "too_many_requests" });
    }
  } catch (e) {
    // Fail OPEN on limiter failure for the same reason as BotID — but log loudly.
    console.error("[club-lead] rate-limit check failed (allowing)", e);
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
    console.error("[club-lead] club_capture_lead failed", e);
    return res.status(500).json({ ok: false, error: "capture_failed" });
  }
};
