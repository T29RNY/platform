// POST /api/room-hire-enquiry — the guarded front door for public_enquire_room_hire (mig 616).
//
// FORM GUARD, phase 2 of 6. Same recipe as phase 1 (/api/club-lead, mig 615), applied to the
// second of the six unauthenticated public write endpoints.
//
// WHY THIS EXISTS. public_enquire_room_hire is an UNAUTHENTICATED write: a public space_id
// plus attacker-supplied PII, which stores a venue_room_hires row AND queues an email to the
// venue (mig 342, drain fixed in mig 613). Called straight from the browser it was open to
// scripted flooding — junk enquiries on the venue's bookings board, an inbox-bombed operator,
// burnt Resend quota. The RPC's own in-DB throttle (3 enquiries per EMAIL per space per
// 10 min) is not flood control: the attacker picks the email, so they simply rotate it.
//
// Two layers, then the call:
//   1. Vercel BotID (invisible CAPTCHA, 'basic' tier) — is the caller a real browser?
//   2. Per-IP fixed-window volume cap via _rate_limit_hit (mig 615, reused UNCHANGED).
// Only then is the RPC invoked, with the SERVICE ROLE. mig 616 revokes anon/authenticated
// EXECUTE on public_enquire_room_hire, so this route is the ONLY way in — without that revoke
// the guard would be decorative (a bot would simply call the RPC directly).
//
// SERVICE-ROLE IS SAFE HERE. The RPC reads no auth.uid() and hardcodes booker_type
// 'non_member', so nothing about its behaviour depends on WHICH role calls it. Moving the
// caller from anon to service_role changes the guard, not the semantics.
//
// ⚠️ SETUP THIS ROUTE DEPENDS ON (security review, PR #618): BotID needs the two proxy
// rewrites in apps/inorout/vercel.json, ABOVE the SPA catch-all. They already exist (added in
// phase 1) and are shared by every protected route — do NOT add a second copy. Without them
// the challenge script resolves to index.html, the client's patched fetch never resolves, and
// every submit hangs — silent 100% enquiry loss.
//
// FAIL POSTURE — asymmetric, and DEGRADED rather than silent (identical to phase 1):
//   * A positive bot verdict            -> BLOCK (403). Fail CLOSED.
//   * BotID erroring / not provisioned  -> ALLOW, but drop to a much TIGHTER cap and
//                                          record it, so a permanently-broken BotID is
//                                          visible instead of masquerading as healthy.
//
// The per-IP bucket is per-CALLER, never per-space or per-venue: an attacker can only
// rate-limit themselves. A per-venue cap would have let them switch a victim venue's enquiry
// form OFF — the denial-of-service primitive mig 596 explicitly rejected.
//
// DEPLOY CHECK (do once, after the first deploy): submit a space enquiry on a venue landing
// page and confirm the Vercel function log does NOT contain "[room-hire] botid degraded".
// If it does, BotID is not actually running — check the vercel.json rewrites and that
// BotID/OIDC is provisioned for the project.

const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

// Matched to phase 1 deliberately. A real hirer enquires once or twice, but a shared network
// (a venue's own wifi, an office NAT, a club open day) legitimately produces a burst from ONE
// IP. This stops floods (thousands) without punishing a busy enquiry evening.
const RATE_MAX_PER_WINDOW = 20;
// Applied instead when BotID could not run: the cap is then the ONLY defence, so it tightens
// to roughly "a real person filling the form in", not a scripted burst.
const RATE_MAX_DEGRADED = 3;
const RATE_WINDOW_SECONDS = 3600; // 1 hour

// Its own bucket namespace, separate from club_lead: one endpoint's legitimate traffic must
// never consume another's allowance.
const BUCKET_PREFIX = "room_hire:";

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
  if (!ip) return BUCKET_PREFIX + "noip";
  // Hash it: an IP is personal data, and this ledger is retained for a day. The digest is
  // just as good a bucket key, is fixed-length (so an oversized header can't overflow the
  // index and make the limiter throw), and stores no identifier.
  const pepper = process.env.RATE_LIMIT_PEPPER || "";
  return BUCKET_PREFIX + crypto.createHash("sha256").update(ip + pepper).digest("hex").slice(0, 32);
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
    console.error("[room-hire] botid degraded (allowing at tightened cap)", e?.message || e);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── Layer 2: per-IP volume cap ─────────────────────────────────────────────
  try {
    if (botDegraded) {
      // A countable, queryable trace that the degraded path is being taken: a broken
      // BotID otherwise looks identical to a healthy one from outside.
      // (audit_events is not usable here — its team_id is NOT NULL and the venue isn't
      // resolved until the RPC runs.)
      await supabase.rpc("_rate_limit_hit", {
        p_key: BUCKET_PREFIX + "_botid_degraded", p_max: 2147483647, p_window_seconds: RATE_WINDOW_SECONDS,
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
    console.error("[room-hire] rate-limit check failed (allowing)", e?.message || e);
  }

  // ── The actual write ───────────────────────────────────────────────────────
  const { spaceId, name, email, phone, startsAt, endsAt, purpose, attendeeCount } = req.body || {};
  // Mirrors the RPC's own required fields (space, name, email, purpose, time range). The RPC
  // re-validates all of these and RAISES on anything bad — this is a cheap early exit, not the
  // validation boundary.
  if (!spaceId || !name || !email || !startsAt || !endsAt || !purpose) {
    return res.status(400).json({ error: "missing_params" });
  }

  try {
    const { data, error } = await supabase.rpc("public_enquire_room_hire", {
      p_space_id: spaceId,
      p_name: name,
      p_email: email,
      p_phone: phone ?? null,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_purpose: purpose,
      p_attendee_count: attendeeCount ?? null,
    });
    if (error) throw error;
    // Pass the RPC's jsonb straight through — the client contract is unchanged.
    return res.status(200).json(data ?? { ok: true });
  } catch (e) {
    // UNLIKE club_capture_lead, this RPC signals EVERY validation failure by RAISING
    // (space_not_found, not_enquiry_only, feature_disabled, bad_email, bad_time_range,
    // input_too_long, ...) rather than returning {ok:false}. Those all land here and become a
    // 500, which the wrapper turns into a throw — exactly what a direct supabase.rpc() call
    // did before this route existed. The UI's generic "Couldn't send that" is unchanged.
    console.error("[room-hire] public_enquire_room_hire failed", e?.message || e);
    return res.status(500).json({ ok: false, error: "enquiry_failed" });
  }
};
