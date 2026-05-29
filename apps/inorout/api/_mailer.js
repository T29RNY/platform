// /api/_mailer.js — transactional email via Resend. Phase 9 Cycle 9.1.
//
// No-ops safely when RESEND_API_KEY is absent (logs + returns {skipped:'no_api_key'})
// so this is deployable before the Resend account/domain exist. The TEMPLATES registry
// is the reusable core a later cycle's SMS/WhatsApp channel router will share.
//
// Required env: RESEND_API_KEY, EMAIL_FROM (e.g. "In or Out <notifications@in-or-out.com>")

// Guarded require: if the dep isn't installed (or key absent) the module still loads,
// so importing this from cron.js can never crash the whole cron handler.
let Resend = null;
try { ({ Resend } = require("resend")); } catch (e) { /* resend not installed yet */ }

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || "In or Out <onboarding@resend.dev>";
const resend = API_KEY && Resend ? new Resend(API_KEY) : null;

async function sendEmail(to, { subject, html, text }) {
  if (!to) return { skipped: "no_recipient" };
  if (!resend) {
    console.error("[mailer] RESEND_API_KEY not set — skipping send to", to);
    return { skipped: "no_api_key" };
  }
  try {
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) {
      console.error("[mailer] send error", error);
      return { error: error.message || String(error) };
    }
    return { id: data?.id };
  } catch (e) {
    console.error("[mailer] send threw", e);
    return { error: e.message || String(e) };
  }
}

// ── Templates ────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const wrap = (bodyHtml) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#111;line-height:1.55;max-width:520px">` +
  bodyHtml +
  `<hr style="border:none;border-top:1px solid #eee;margin:24px 0">` +
  `<p style="font-size:12px;color:#888">In or Out · league football, sorted</p></div>`;

const TEMPLATES = {
  team_approved: (c) => ({
    subject: `You're in — ${c.competitionName} approved`,
    text:
      `Good news — ${c.teamName} has been approved for ${c.competitionName}. ` +
      `You can now submit your teamsheet for upcoming fixtures from your admin view.`,
    html: wrap(
      `<p>Good news — <b>${esc(c.teamName)}</b> has been approved for <b>${esc(c.competitionName)}</b>.</p>` +
      `<p>You can now submit your teamsheet for upcoming fixtures from your admin view.</p>`
    ),
  }),
  team_rejected: (c) => ({
    subject: `Registration not approved — ${c.competitionName}`,
    text:
      `${c.teamName}'s registration for ${c.competitionName} wasn't approved.` +
      (c.reason ? ` Reason: ${c.reason}` : ""),
    html: wrap(
      `<p><b>${esc(c.teamName)}</b>'s registration for <b>${esc(c.competitionName)}</b> wasn't approved.</p>` +
      (c.reason ? `<p><b>Reason:</b> ${esc(c.reason)}</p>` : "") +
      `<p>Reply to the venue if you think this is a mistake.</p>`
    ),
  }),
  team_registration_pending: (c) => ({
    subject: `New team wants to join — ${c.teamName}`,
    text:
      `${c.teamName} has requested to join ${c.competitionName}.` +
      (c.link ? ` Review: ${c.link}` : " Open your venue dashboard to approve or reject."),
    html: wrap(
      `<p><b>${esc(c.teamName)}</b> has requested to join <b>${esc(c.competitionName)}</b>.</p>` +
      (c.link
        ? `<p><a href="${esc(c.link)}">Review the request in your venue dashboard →</a></p>`
        : `<p>Open your venue dashboard to approve or reject.</p>`)
    ),
  }),
  ref_assigned: (c) => ({
    subject: `Match assigned — ${c.matchLabel}`,
    text:
      `You've been assigned to referee ${c.matchLabel}` +
      (c.dateLabel ? ` on ${c.dateLabel}` : "") + "." +
      (c.link ? ` Open your match sheet: ${c.link}` : ""),
    html: wrap(
      `<p>You've been assigned to referee <b>${esc(c.matchLabel)}</b>` +
      (c.dateLabel ? ` on <b>${esc(c.dateLabel)}</b>` : "") + `.</p>` +
      (c.link ? `<p><a href="${esc(c.link)}">Open your match sheet →</a></p>` : "")
    ),
  }),
};

async function sendTemplated(type, to, ctx) {
  const t = TEMPLATES[type];
  if (!t) {
    console.error("[mailer] unknown template", type);
    return { skipped: "no_template" };
  }
  return sendEmail(to, t(ctx));
}

module.exports = { sendEmail, sendTemplated, TEMPLATES };
