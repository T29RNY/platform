// /api/_sms.js — SMS + WhatsApp transport via Twilio. Phase 9 (SMS/WhatsApp cycle).
//
// TRANSPORT CORE ONLY — this module is the reusable counterpart to _mailer.js
// (the session-56 note: "_mailer.js TEMPLATES registry is the reusable core a later
// SMS/WhatsApp router shares"). It is NOT imported anywhere yet. Wiring it into a
// send path is a later 9.x cycle:
//   - refs: route ref_assigned through pickChannel() honouring
//     match_officials.preferred_channel (whatsapp→sms→email) — match_officials already
//     carries phone / whatsapp_number / preferred_channel (mig 055).
//   - players: the push→email→SMS fallback model needs a contact-capture + preference
//     UI first (players.phone / players.notification_channel exist from mig 056 but
//     nothing captures a phone yet), so player SMS cannot deliver until that ships.
//
// No-ops safely when TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are absent (logs + returns
// {skipped:'no_credentials'}), so this is deployable before the Twilio account exists —
// exactly like _mailer.js no-ops without RESEND_API_KEY.
//
// Required env (when wired): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//   TWILIO_SMS_FROM (e.g. "+447700900123"), TWILIO_WHATSAPP_FROM (e.g. "+14155238886").

// Guarded require: if the dep isn't installed (or creds absent) the module still loads,
// so a future importer can never crash the whole handler.
let twilioLib = null;
try { twilioLib = require("twilio"); } catch (e) { /* twilio not installed yet */ }

const SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH = process.env.TWILIO_AUTH_TOKEN;
const SMS_FROM = process.env.TWILIO_SMS_FROM || null;
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || null;
const client = SID && AUTH && twilioLib ? twilioLib(SID, AUTH) : null;

// Twilio addresses a WhatsApp number with the "whatsapp:" scheme prefix; SMS is bare E.164.
const waAddr = (num) => (num ? `whatsapp:${String(num).replace(/^whatsapp:/, "")}` : null);

async function sendVia(channel, to, body) {
  if (!to) return { skipped: "no_recipient" };
  if (!client) {
    console.error("[sms] TWILIO credentials not set — skipping", channel, "to", to);
    return { skipped: "no_credentials" };
  }
  const from = channel === "whatsapp" ? WHATSAPP_FROM : SMS_FROM;
  if (!from) {
    console.error("[sms] no from-number configured for channel", channel);
    return { skipped: "no_from" };
  }
  try {
    const msg = await client.messages.create({
      from: channel === "whatsapp" ? waAddr(from) : from,
      to: channel === "whatsapp" ? waAddr(to) : to,
      body,
    });
    return { id: msg?.sid };
  } catch (e) {
    console.error("[sms] send threw", channel, e);
    return { error: e.message || String(e) };
  }
}

async function sendSms(to, body) {
  return sendVia("sms", to, body);
}

async function sendWhatsApp(to, body) {
  return sendVia("whatsapp", to, body);
}

// ── Templates ────────────────────────────────────────────────────────────────
// SMS/WhatsApp are plain text only — no HTML wrapper. Each template returns a single
// body string. Mirrors the _mailer.js TEMPLATES shape (keyed by the same type names)
// so a later channel router can resolve one type across email + sms + whatsapp.
const TEMPLATES = {
  ref_assigned: (c) =>
    `In or Out — you've been assigned to referee ${c.matchLabel}` +
    (c.dateLabel ? ` on ${c.dateLabel}` : "") + "." +
    (c.link ? ` Open your match sheet: ${c.link}` : ""),
  leagueAvailability48h: (c) =>
    `In or Out — league fixture vs ${c.opponent} on ${c.dateLabel}. Are you in? ${c.link || ""}`.trim(),
  leagueFixtureReminder2h: (c) =>
    `In or Out — last call: kickoff vs ${c.opponent} in 2h. Mark in/out: ${c.link || ""}`.trim(),
};

async function sendTemplated(type, channel, to, ctx) {
  const t = TEMPLATES[type];
  if (!t) {
    console.error("[sms] unknown template", type);
    return { skipped: "no_template" };
  }
  return sendVia(channel === "whatsapp" ? "whatsapp" : "sms", to, t(ctx));
}

// pickChannel — resolve the best channel for a recipient given their preference and
// which contact methods they actually have. Returns one of 'whatsapp'|'sms'|'email'|
// 'push'|null. The future fallback model's decision point; not exercised yet.
function pickChannel(preferred, contacts = {}) {
  const order = {
    whatsapp: ["whatsapp", "sms", "email", "push"],
    sms: ["sms", "whatsapp", "email", "push"],
    email: ["email", "push"],
    push: ["push", "email"],
  }[preferred] || ["push", "email"];
  const has = {
    whatsapp: !!contacts.whatsapp_number,
    sms: !!contacts.phone,
    email: !!contacts.email,
    push: !!contacts.push,
  };
  return order.find((ch) => has[ch]) || null;
}

module.exports = { sendSms, sendWhatsApp, sendTemplated, pickChannel, TEMPLATES };
