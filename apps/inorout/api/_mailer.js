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

// pence → "£X" / "£X.YZ"
const gbp = (p) => {
  const n = Number(p || 0) / 100;
  return "£" + (Number.isInteger(n) ? String(n) : n.toFixed(2));
};

// New squad (≤14d) gone quiet — onboarding-risk label shared by both ops digests.
const quietLabel = (q) =>
  `${q.name} (${q.days_old}d old, ${q.days_quiet == null ? "never active" : q.days_quiet + "d quiet"})`;

// ── Email design system ───────────────────────────────────────────────────────

// Branded dark wrapper matching the auth email aesthetic.
// opts.glowColor: header radial glow colour (default = red, for cancellations/urgency)
// opts.tagline:   sub-header line under the logotype
const wrap = (bodyHtml, opts = {}) => {
  const glowColor = opts.glowColor || "rgba(255,64,64,0.20)";
  const tagline   = opts.tagline   || "league football, sorted";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#060605;margin:0;padding:0;width:100%;">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;width:100%;">` +
    `<tr><td style="background:#0E0E0C;border:1px solid #1C1C19;border-radius:22px;overflow:hidden;">` +

    `<div style="background:radial-gradient(120% 90% at 50% 0%,${glowColor} 0%,rgba(14,14,12,0) 62%);padding:40px 36px 8px 36px;text-align:center;">` +
      `<div style="font-family:'Bebas Neue','Arial Narrow',Helvetica,Arial,sans-serif;font-size:42px;line-height:1;letter-spacing:3px;font-weight:700;">` +
        `<span style="color:#3DDC6A;">IN</span><span style="color:#F2F0EA;"> OR </span><span style="color:#FF4040;">OUT</span>` +
      `</div>` +
      `<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#6E6E66;margin-top:10px;">${tagline}</div>` +
    `</div>` +

    `<div style="padding:24px 36px 28px 36px;">` +
    bodyHtml +
    `</div>` +

    `<div style="border-top:1px solid #1C1C19;padding:18px 36px;text-align:center;">` +
      `<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1px;color:#4A4A44;">IN OR OUT &mdash; football, sorted.</div>` +
    `</div>` +

    `</td></tr></table>` +
    `</td></tr></table>`
  );
};

// Full-width gold CTA button. Pass esc(url) as href.
const btn = (href, label) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">` +
  `<tr><td>` +
  `<a href="${href}" style="display:block;background:#E8A020;color:#0A0A08;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;text-align:center;padding:14px 24px;border-radius:12px;">${label}</a>` +
  `</td></tr>` +
  `</table>`;

// Dark highlight box for key facts. rows: [{label, value}]
// value is rendered as HTML — pre-escape user data with esc() before passing.
const detailBox = (rows) =>
  `<div style="background:linear-gradient(180deg,#17170F 0%,#121210 100%);border:1px solid #2C2C22;border-radius:18px;padding:20px 20px 4px 20px;margin:16px 0 20px 0;">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
  rows.map((r) =>
    `<tr><td style="padding:0 0 16px 0;">` +
    `<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin-bottom:4px;">${r.label}</div>` +
    `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#F2F0EA;line-height:1.3;">${r.value}</div>` +
    `</td></tr>`
  ).join("") +
  `</table></div>`;

// Inline status pill. color: 'green' | 'red' | 'amber'
const statusBadge = (text, color) => {
  const p = {
    green: { bg: "#0D2B12", fg: "#3DDC6A", border: "#1D4A24" },
    red:   { bg: "#2B0D0D", fg: "#FF4040", border: "#4A1D1D" },
    amber: { bg: "#2B1E08", fg: "#E8A020", border: "#4A3210" },
  }[color] || { bg: "#2B1E08", fg: "#E8A020", border: "#4A3210" };
  return (
    `<span style="display:inline-block;font-family:Helvetica,Arial,sans-serif;font-size:11px;` +
    `font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:3px 10px;border-radius:20px;` +
    `background:${p.bg};color:${p.fg};border:1px solid ${p.border};">${text}</span>`
  );
};

// Shared inline style shorthands
const H1 = "font-family:Helvetica,Arial,sans-serif;font-size:25px;line-height:1.22;color:#F2F0EA;font-weight:700;margin:0 0 16px 0;";
const P  = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#A0A097;margin:0 0 16px 0;";
const P0 = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#A0A097;margin:0;";

const TEMPLATES = {
  // ── Casual debt chase (ADMIN_DEBT_CHASE_HANDOFF PR #4) ────────────────────
  // The FIRST casual-player template in this registry — everything else here is
  // venue/club/league/membership-facing. Sent only to a debtor with no working push, so it
  // exists to reach the people the chase would otherwise silently miss.
  //
  // Amount is WHOLE POUNDS, not pence — do NOT use gbp() below. The casual ledger
  // (payment_ledger.amount) is pounds; venue_charges.amount_due_pence is the other model.
  // Passing pounds through gbp() would divide by 100 and tell someone they owe £0.15.
  //
  // Tone: the sender is a mate, not a creditor. The automated cron can get away with
  // "before the admin starts naming names" because a robot said it; this is fired by a human
  // pressing a button, so the same line reads as an actual threat. Softer on purpose.
  admin_chase_payment: (c) => ({
    subject: `Subs outstanding — £${c.amount} for ${c.dayOfWeek}`,
    text:
      `Hi ${c.firstName},\n\n` +
      `You've got £${c.amount} outstanding for ${c.dayOfWeek} at ${c.squadName}.\n\n` +
      `Settle up whenever you get a sec — you can see the breakdown week by week and mark it ` +
      `paid here:\n${c.payUrl}\n\n` +
      `If you've already paid, tap "I've paid" on that page and ${c.squadName}'s admin will confirm it.`,
    html: wrap(
      `<h1 style="${H1}">Subs outstanding.</h1>` +
      `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span> &mdash; a quick nudge on your outstanding subs.</p>` +
      detailBox([
        { label: "Squad",       value: esc(c.squadName) },
        { label: "For",         value: esc(c.dayOfWeek) },
        { label: "Outstanding", value: `<span style="color:#E8A020;font-weight:700;">&pound;${esc(c.amount)}</span>` },
      ]) +
      `<p style="${P}">Settle up whenever you get a sec &mdash; you can see the breakdown week by week and mark it paid:</p>` +
      btn(esc(c.payUrl), "See what you owe") +
      `<p style="${P0}">Already paid? Tap &ldquo;I've paid&rdquo; on that page and ${esc(c.squadName)}'s admin will confirm it.</p>`
    ),
  }),

  // ── Classes Booking — Phase 3 member-facing emails (mig 340) ──────────────
  class_booking_confirmation: (c) => ({
    subject: `You're booked — ${c.className} on ${c.dateLabel}`,
    text:
      `Hi ${c.firstName},\n\nYou're booked into ${c.className} at ${c.venueName}` +
      (c.spaceName ? ` (${c.spaceName})` : "") + ` on ${c.dateLabel} at ${c.timeLabel}.` +
      `\n\nSee you there. To cancel, open your membership pass.`,
    html: wrap(
      `<h1 style="${H1}">You're booked.</h1>` +
      `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span> &mdash; see you on the pitch.</p>` +
      detailBox([
        { label: "Class", value: esc(c.className) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        { label: "Venue", value: esc(c.venueName) + (c.spaceName ? ` <span style="color:#6E6E66;font-weight:400;font-size:13px;">(${esc(c.spaceName)})</span>` : "") },
      ]) +
      `<p style="${P0}">You can cancel from your membership pass if your plans change.</p>`,
      { glowColor: "rgba(61,220,106,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  class_waitlist_joined: (c) => ({
    subject: `You're on the waitlist — ${c.className}`,
    text:
      `Hi ${c.firstName},\n\n${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} is full, ` +
      `so you're on the waitlist` + (c.waitlistPosition ? ` (position ${c.waitlistPosition})` : "") +
      `. We'll let you know if a spot opens up.`,
    html: wrap(
      `<h1 style="${H1}">You're on the waitlist.</h1>` +
      `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span> &mdash; ${esc(c.className)} at ${esc(c.venueName)} is full right now.</p>` +
      detailBox([
        { label: "Class",    value: esc(c.className) },
        { label: "Date",     value: esc(c.dateLabel) },
        { label: "Time",     value: esc(c.timeLabel) },
        { label: "Venue",    value: esc(c.venueName) },
        ...(c.waitlistPosition ? [{ label: "Position", value: `#${esc(String(c.waitlistPosition))}` }] : []),
      ]) +
      `<p style="${P0}">We'll email you straight away if a spot opens up.</p>`,
      { glowColor: "rgba(232,160,32,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  class_spot_offered: (c) => ({
    subject: `A spot opened — claim your place in ${c.className}`,
    text:
      `Good news — a spot just opened in ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel}. ` +
      `It's being held for you for a short while — open your membership pass and tap "Claim spot" to take it ` +
      `before it rolls to the next person on the waitlist.`,
    html: wrap(
      `<h1 style="${H1}">Spot available.</h1>` +
      `<p style="${P}">A place just opened in your waitlisted class &mdash; it's being held for you briefly.</p>` +
      detailBox([
        { label: "Class", value: esc(c.className) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        { label: "Venue", value: esc(c.venueName) },
      ]) +
      `<p style="${P}">Claim it before it rolls to the next person on the waitlist.</p>` +
      (c.link ? btn(esc(c.link), "Claim your spot") : ""),
      { glowColor: "rgba(61,220,106,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  class_waitlist_promoted: (c) => ({
    subject: `A spot opened — you're in for ${c.className}`,
    text:
      `Good news — a spot opened in ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel}, ` +
      `and you're now confirmed. See you there.`,
    html: wrap(
      `<h1 style="${H1}">You're in.</h1>` +
      `<p style="${P}">A spot opened up &mdash; you've been moved from the waitlist and you're now confirmed.</p>` +
      detailBox([
        { label: "Class", value: esc(c.className) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        { label: "Venue", value: esc(c.venueName) },
      ]) +
      `<p style="${P0}">See you there.</p>`,
      { glowColor: "rgba(61,220,106,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  class_booking_cancelled: (c) => ({
    subject: `Booking cancelled — ${c.className}`,
    text:
      `Your booking for ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} has been cancelled. ` +
      `Any prepaid charge has been refunded.`,
    html: wrap(
      `<h1 style="${H1}">Booking cancelled.</h1>` +
      detailBox([
        { label: "Class", value: esc(c.className) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        { label: "Venue", value: esc(c.venueName) },
      ]) +
      `<p style="${P0}">Any prepaid charge has been refunded to your original payment method.</p>`,
      { tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  class_cancelled: (c) => ({
    subject: `Class cancelled — ${c.className} on ${c.dateLabel}`,
    text:
      `Unfortunately ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} has been cancelled` +
      (c.reason ? ` (${c.reason})` : "") + `. Any prepaid charge has been refunded.`,
    html: wrap(
      `<h1 style="${H1}">Class cancelled.</h1>` +
      detailBox([
        { label: "Class", value: esc(c.className) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        { label: "Venue", value: esc(c.venueName) },
        ...(c.reason ? [{ label: "Reason", value: esc(c.reason) }] : []),
      ]) +
      `<p style="${P0}">Any prepaid charge has been refunded. Sorry for the inconvenience.</p>`,
      { tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  class_instructor_changed: (c) => ({
    subject: `Instructor change — ${c.className} on ${c.dateLabel}`,
    text:
      `Heads up: the instructor for ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} has changed. ` +
      `Your booking is unaffected.`,
    html: wrap(
      `<h1 style="${H1}">Instructor change.</h1>` +
      `<p style="${P}">Heads up &mdash; the instructor for your upcoming class has changed.</p>` +
      detailBox([
        { label: "Class", value: esc(c.className) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        { label: "Venue", value: esc(c.venueName) },
      ]) +
      `<p style="${P0}">Your booking is unaffected &mdash; see you there.</p>`,
      { glowColor: "rgba(232,160,32,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  class_reminder: (c) => ({
    subject: `Tomorrow: ${c.className} at ${c.timeLabel}`,
    text:
      `Hi ${c.firstName},\n\nReminder — you're booked into ${c.className} at ${c.venueName}` +
      (c.spaceName ? ` (${c.spaceName})` : "") + ` on ${c.dateLabel} at ${c.timeLabel}.` +
      `\n\nCan't make it? Cancel from your membership pass so someone on the waitlist can take your spot.`,
    html: wrap(
      `<h1 style="${H1}">See you tomorrow.</h1>` +
      `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span> &mdash; here's your reminder.</p>` +
      detailBox([
        { label: "Class", value: esc(c.className) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        { label: "Venue", value: esc(c.venueName) + (c.spaceName ? ` <span style="color:#6E6E66;font-weight:400;font-size:13px;">(${esc(c.spaceName)})</span>` : "") },
      ]) +
      `<p style="${P0}">Can't make it? Cancel from your membership pass so someone on the waitlist can take your spot.</p>`,
      { glowColor: "rgba(232,160,32,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  // ── Room hire — Phase 5 booker-facing emails (mig 342) ────────────────────
  room_hire_requested: (c) => ({
    subject: `Enquiry received — ${c.spaceName} at ${c.venueName}`,
    text:
      `Thanks — we've received your enquiry to hire ${c.spaceName} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel}` +
      (c.purpose ? ` (${c.purpose})` : "") + `.\n\nThe venue will be in touch to confirm availability and price.`,
    html: wrap(
      `<h1 style="${H1}">Enquiry received.</h1>` +
      `<p style="${P}">We've passed your hire request on to the venue.</p>` +
      detailBox([
        { label: "Space", value: esc(c.spaceName) },
        { label: "Venue", value: esc(c.venueName) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        ...(c.purpose ? [{ label: "Purpose", value: esc(c.purpose) }] : []),
      ]) +
      `<p style="${P0}">The venue will be in touch to confirm availability and price.</p>`,
      { glowColor: "rgba(232,160,32,0.20)" }
    ),
  }),
  room_hire_confirmed: (c) => ({
    subject: `Confirmed — ${c.spaceName} at ${c.venueName}`,
    text:
      `Good news — your hire of ${c.spaceName} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} is confirmed` +
      (c.price_pence > 0 ? `. Fee: £${(c.price_pence / 100).toFixed(c.price_pence % 100 ? 2 : 0)}` : "") +
      (c.deposit_pence > 0 ? `, deposit £${(c.deposit_pence / 100).toFixed(c.deposit_pence % 100 ? 2 : 0)}` : "") + `.`,
    html: wrap(
      `<h1 style="${H1}">Hire confirmed.</h1>` +
      detailBox([
        { label: "Space",   value: esc(c.spaceName) },
        { label: "Venue",   value: esc(c.venueName) },
        { label: "Date",    value: esc(c.dateLabel) },
        { label: "Time",    value: esc(c.timeLabel) },
        ...(c.price_pence > 0   ? [{ label: "Fee",     value: gbp(c.price_pence) }] : []),
        ...(c.deposit_pence > 0 ? [{ label: "Deposit", value: gbp(c.deposit_pence) }] : []),
      ]) +
      `<p style="${P0}">Your booking is locked in. See you there.</p>`,
      { glowColor: "rgba(61,220,106,0.20)" }
    ),
  }),
  room_hire_cancelled: (c) => ({
    subject: `Hire cancelled — ${c.spaceName} at ${c.venueName}`,
    text:
      `Your hire of ${c.spaceName} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} has been cancelled` +
      (c.reason ? ` (${c.reason})` : "") + `. Any charge has been refunded.`,
    html: wrap(
      `<h1 style="${H1}">Hire cancelled.</h1>` +
      detailBox([
        { label: "Space", value: esc(c.spaceName) },
        { label: "Venue", value: esc(c.venueName) },
        { label: "Date",  value: esc(c.dateLabel) },
        { label: "Time",  value: esc(c.timeLabel) },
        ...(c.reason ? [{ label: "Reason", value: esc(c.reason) }] : []),
      ]) +
      `<p style="${P0}">Any charge has been refunded.</p>`,
    ),
  }),
  // ── Club trial lead — owner-facing enquiry alert (mig 612) ────────────────
  // Fired when club_capture_lead lands a public free-trial enquiry; drained by
  // clubLeadNotificationsJob. A bare NUDGE only — deliberately carries no child or
  // parent detail (the queued_payload has the club name and nothing else). The owner
  // reads the actual lead through the Enquiries tab (club_list_leads, RLS-scoped),
  // which is why this email points them there rather than repeating the data.
  club_lead_captured: (c) => ({
    subject: `New trial enquiry — ${c.clubName}`,
    text:
      `You've got a new free-trial enquiry for ${c.clubName}.\n\n` +
      `Open the In or Out app and go to People → Enquiries to see the parent's details and get in touch.`,
    html: wrap(
      `<h1 style="${H1}">New trial enquiry.</h1>` +
      `<p style="${P}">You've got a new free-trial enquiry for <span style="color:#F2F0EA;font-weight:700;">${esc(c.clubName)}</span>.</p>` +
      `<p style="${P0}">Open the In or Out app and go to <span style="color:#F2F0EA;">People &rarr; Enquiries</span> to see the parent's details and get in touch.</p>`
    ),
  }),
  team_approved: (c) => ({
    subject: `You're in — ${c.competitionName} approved`,
    text:
      `Good news — ${c.teamName} has been approved for ${c.competitionName}. ` +
      `You can now submit your teamsheet for upcoming fixtures from your admin view.`,
    html: wrap(
      `<h1 style="${H1}">You're in.</h1>` +
      `<p style="${P}">Good news &mdash; your team has been approved for the competition.</p>` +
      detailBox([
        { label: "Team",        value: esc(c.teamName) },
        { label: "Competition", value: esc(c.competitionName) },
        { label: "Status",      value: statusBadge("Approved", "green") },
      ]) +
      `<p style="${P0}">You can now submit your teamsheet for upcoming fixtures from your admin view.</p>`,
      { glowColor: "rgba(61,220,106,0.20)" }
    ),
  }),
  team_rejected: (c) => ({
    subject: `Registration not approved — ${c.competitionName}`,
    text:
      `${c.teamName}'s registration for ${c.competitionName} wasn't approved.` +
      (c.reason ? ` Reason: ${c.reason}` : ""),
    html: wrap(
      `<h1 style="${H1}">Registration not approved.</h1>` +
      detailBox([
        { label: "Team",        value: esc(c.teamName) },
        { label: "Competition", value: esc(c.competitionName) },
        { label: "Status",      value: statusBadge("Not approved", "red") },
        ...(c.reason ? [{ label: "Reason", value: esc(c.reason) }] : []),
      ]) +
      `<p style="${P0}">Reply to the venue if you think this is a mistake.</p>`,
    ),
  }),
  team_registration_pending: (c) => ({
    subject: `New team wants to join — ${c.teamName}`,
    text:
      `${c.teamName} has requested to join ${c.competitionName}.` +
      (c.link ? ` Review: ${c.link}` : " Open your venue dashboard to approve or reject."),
    html: wrap(
      `<h1 style="${H1}">New team registration.</h1>` +
      `<p style="${P}">A team is requesting to join a competition on your platform.</p>` +
      detailBox([
        { label: "Team",        value: esc(c.teamName) },
        { label: "Competition", value: esc(c.competitionName) },
        { label: "Status",      value: statusBadge("Pending review", "amber") },
      ]) +
      (c.link
        ? btn(esc(c.link), "Review request")
        : `<p style="${P0}">Open your venue dashboard to approve or reject.</p>`),
      { glowColor: "rgba(232,160,32,0.20)" }
    ),
  }),
  ref_assigned: (c) => ({
    subject: `Match assigned — ${c.matchLabel}`,
    text:
      `You've been assigned to referee ${c.matchLabel}` +
      (c.dateLabel ? ` on ${c.dateLabel}` : "") + "." +
      (c.link ? ` Open your match sheet: ${c.link}` : ""),
    html: wrap(
      `<h1 style="${H1}">Match assigned.</h1>` +
      `<p style="${P}">You've been assigned to referee the following fixture.</p>` +
      detailBox([
        { label: "Match", value: esc(c.matchLabel) },
        ...(c.dateLabel ? [{ label: "Date", value: esc(c.dateLabel) }] : []),
      ]) +
      (c.link
        ? btn(esc(c.link), "Open match sheet")
        : `<p style="${P0}">Check your schedule for further details.</p>`),
      { glowColor: "rgba(232,160,32,0.20)" }
    ),
  }),
  // Venue Nudge (mig 224) — a venue messaging one of its team bookers. The send
  // is server-side (cron resolves the team admin email); the venue never sees it.
  venue_nudge: (c) => {
    const msg = {
      dormant_winback: `We've missed ${c.teamName} at ${c.venueName}! Your pitch is still here — come back for a game whenever you're ready.`,
      check_in: `Just a friendly hello from ${c.venueName}. Fancy getting ${c.teamName} back on the pitch? Reply to book your next session.`,
      offer_slot: `${c.venueName} has some prime slots opening up — want us to hold one for ${c.teamName}?`,
    }[c.template] || `A quick hello from ${c.venueName} — we'd love to see ${c.teamName} back on the pitch.`;
    return {
      subject: `A note from ${c.venueName}`,
      text: `Hi ${c.teamName},\n\n${msg}`,
      html: wrap(
        `<h1 style="${H1}">A note from ${esc(c.venueName)}.</h1>` +
        `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.teamName)}</span>,</p>` +
        `<p style="${P0}">${esc(msg)}</p>`,
        { glowColor: "rgba(232,160,32,0.20)" }
      ),
    };
  },
  // Venue booking confirmation (mig 232) — sent to the booker's captured contact email
  // when a venue creates a booking. Covers single + block (weeks > 1).
  booking_confirmation: (c) => {
    const whenLine = c.weeks > 1
      ? `${c.weeks} weeks from ${c.dateLabel} at ${c.timeLabel}`
      : `${c.dateLabel} at ${c.timeLabel}`;
    return {
      subject: `Booking confirmed — ${c.venueName}`,
      text:
        `Your booking at ${c.venueName} is confirmed.\n` +
        `${c.pitchName} — ${whenLine}` + (c.slotMinutes ? ` (${c.slotMinutes} min)` : "") + `.`,
      html: wrap(
        `<h1 style="${H1}">Booking confirmed.</h1>` +
        detailBox([
          { label: "Venue",    value: esc(c.venueName) },
          { label: "Pitch",    value: esc(c.pitchName) },
          { label: "When",     value: esc(whenLine) },
          ...(c.slotMinutes ? [{ label: "Duration", value: `${c.slotMinutes} min` }] : []),
          ...(c.weeks > 1 ? [{ label: "Recurring", value: `${c.weeks} weeks` }] : []),
        ]) +
        `<p style="${P0}">Your slot is confirmed. See you there.</p>`,
        { glowColor: "rgba(61,220,106,0.20)" }
      ),
    };
  },
  // ── Membership reminders (Phase 6, mig 276) — member-facing, sent by
  // membershipRemindersJob from get_membership_reminders_due. ctx:
  // {firstName, venueName, tierName, amountPence, period, dateLabel, passUrl}.
  membership_welcome: (c) => ({
    subject: `Welcome to ${c.venueName}`,
    text:
      `Hi ${c.firstName},\n\nWelcome to ${c.venueName}! Your ${c.tierName} membership is active.` +
      (c.passUrl ? ` Your membership pass: ${c.passUrl}` : ""),
    html: wrap(
      `<h1 style="${H1}">Welcome aboard.</h1>` +
      `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span> &mdash; your membership is now active.</p>` +
      detailBox([
        { label: "Membership", value: esc(c.tierName) },
        { label: "Venue",      value: esc(c.venueName) },
        { label: "Status",     value: statusBadge("Active", "green") },
      ]) +
      (c.passUrl
        ? `<p style="${P}">Your pass is ready &mdash; show it at reception to check in.</p>` +
          btn(esc(c.passUrl), "Open your membership pass")
        : `<p style="${P0}">Show your pass at reception to check in.</p>`),
      { glowColor: "rgba(61,220,106,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  membership_renewal_due: (c) => ({
    subject: `Your ${c.venueName} membership renews on ${c.dateLabel}`,
    text:
      `Hi ${c.firstName},\n\nYour ${c.tierName} membership at ${c.venueName} renews on ${c.dateLabel} ` +
      `(${gbp(c.amountPence)}/${c.period}).` + (c.passUrl ? ` Your pass: ${c.passUrl}` : ""),
    html: wrap(
      `<h1 style="${H1}">Membership renews soon.</h1>` +
      `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span> &mdash; just a heads up on your upcoming renewal.</p>` +
      detailBox([
        { label: "Membership", value: esc(c.tierName) },
        { label: "Venue",      value: esc(c.venueName) },
        { label: "Renews on",  value: esc(c.dateLabel) },
        { label: "Amount",     value: `${gbp(c.amountPence)} / ${esc(c.period)}` },
      ]) +
      (c.passUrl ? btn(esc(c.passUrl), "View your membership") : ""),
      { glowColor: "rgba(232,160,32,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  // P11 cadence: reminderStage ∈ due_7 | due_1 | due_0 | overdue varies the subject + "is <when>"
  // phrasing so the -7 / -1 / 0 / overdue touchpoints read distinctly (falls back to generic "due").
  // Branded-dark HTML per the redesign; overdue flips the title + status badge red.
  membership_payment_due: (c) => {
    const st = c.reminderStage || "";
    const when = st === "due_7" ? "due next week"
      : st === "due_1" ? "due tomorrow"
      : st === "due_0" ? "due today"
      : st === "overdue" ? "now overdue"
      : "due";
    const subject = st === "overdue" ? `Payment overdue — ${c.venueName} membership`
      : st === "due_7" ? `Payment due next week — ${c.venueName} membership`
      : st === "due_1" ? `Payment due tomorrow — ${c.venueName} membership`
      : st === "due_0" ? `Payment due today — ${c.venueName} membership`
      : `Payment due — ${c.venueName} membership`;
    const overdue = st === "overdue";
    return {
      subject,
      text:
        `Hi ${c.firstName},\n\nA membership payment of ${gbp(c.amountPence)} is ${when}${c.dateLabel ? ` (due ${c.dateLabel})` : ""} ` +
        `at ${c.venueName}.` +
        (c.payUrl ? ` Pay now: ${c.payUrl}` : ` Please settle it at reception to keep your membership active.`),
      html: wrap(
        `<h1 style="${H1}">${overdue ? "Payment overdue." : "Payment due."}</h1>` +
        `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span> &mdash; your membership payment is ${esc(when)}.</p>` +
        detailBox([
          { label: "Membership", value: `${esc(c.tierName)} at ${esc(c.venueName)}` },
          { label: "Amount due", value: `<span style="color:#E8A020;font-weight:700;">${gbp(c.amountPence)}</span>` },
          ...(c.dateLabel ? [{ label: "Due by", value: `<span style="color:${overdue ? "#FF4040" : "#A0A097"};">${esc(c.dateLabel)}</span>` }] : []),
          { label: "Status",     value: statusBadge(overdue ? "Overdue" : "Payment required", overdue ? "red" : "amber") },
        ]) +
        (c.payUrl
          ? btn(esc(c.payUrl), "Pay now")
          : `<p style="${P0}">Please settle it at reception to keep your membership active.</p>`),
        { tagline: "Your team &middot; your game &middot; your stats" }
      ),
    };
  },
  membership_freeze_ending: (c) => ({
    subject: `Your ${c.venueName} membership unfreezes on ${c.dateLabel}`,
    text:
      `Hi ${c.firstName},\n\nYour ${c.tierName} membership at ${c.venueName} comes out of freeze on ${c.dateLabel} ` +
      `and billing resumes (${gbp(c.amountPence)}/${c.period}).`,
    html: wrap(
      `<h1 style="${H1}">Freeze ending soon.</h1>` +
      `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span> &mdash; your membership is coming out of freeze.</p>` +
      detailBox([
        { label: "Membership",   value: esc(c.tierName) },
        { label: "Venue",        value: esc(c.venueName) },
        { label: "Unfreezes on", value: esc(c.dateLabel) },
        { label: "Billing",      value: `${gbp(c.amountPence)} / ${esc(c.period)} resumes` },
      ]) +
      (c.passUrl ? btn(esc(c.passUrl), "View your membership") : ""),
      { glowColor: "rgba(232,160,32,0.20)", tagline: "Your team &middot; your game &middot; your stats" }
    ),
  }),
  // Phase 9 finish — league reminder emails (the email leg of the push→email→SMS fallback;
  // same type names + ctx as the _sms.js templates so one router resolves a type per channel).
  leagueAvailability48h: (c) => ({
    subject: `Are you in? ${c.opponent} on ${c.dateLabel}`,
    text:
      `League fixture vs ${c.opponent} on ${c.dateLabel}. Are you in?` +
      (c.link ? ` Mark in or out: ${c.link}` : ""),
    html: wrap(
      `<h1 style="${H1}">Are you in?</h1>` +
      `<p style="${P}">Your league fixture is coming up &mdash; let your team know before the deadline.</p>` +
      detailBox([
        { label: "Fixture", value: `vs <span style="color:#F2F0EA;">${esc(c.opponent)}</span>` },
        { label: "Date",    value: esc(c.dateLabel) },
      ]) +
      (c.link ? btn(esc(c.link), "Mark in or out") : ""),
      { glowColor: "rgba(61,220,106,0.20)" }
    ),
  }),
  leagueFixtureReminder2h: (c) => ({
    subject: `Last call — kickoff vs ${c.opponent} in 2h`,
    text:
      `Kickoff vs ${c.opponent} in about 2 hours — are you in?` +
      (c.link ? ` Mark in or out now: ${c.link}` : ""),
    html: wrap(
      `<h1 style="${H1}">Kickoff in 2 hours.</h1>` +
      `<p style="${P}">Last call &mdash; are you playing today?</p>` +
      detailBox([
        { label: "Fixture", value: `vs <span style="color:#F2F0EA;">${esc(c.opponent)}</span>` },
        { label: "Kickoff", value: `<span style="color:#FF4040;">In approximately 2 hours</span>` },
      ]) +
      (c.link ? btn(esc(c.link), "Mark in or out now") : ""),
    ),
  }),
  // Phase 9 finish — HQ weekly digest (template-first; the AI narration of this same dataset
  // rides Phase 7). ctx is built in cron.js weeklyDigestJob from hq_get_analytics_for_company.
  // Pence→£ conversion happens here. Sections, never bullets, per the house style.
  hqWeeklyDigest: (c) => {
    const r = c.revenue || {};
    const inc = c.incidents || {};
    const venues = Array.isArray(c.topVenues) ? c.topVenues : [];
    const money = (p) => {
      const n = Number(p || 0) / 100;
      return "£" + (Number.isInteger(n) ? String(n) : n.toFixed(2));
    };
    const incTotal = (inc.critical || 0) + (inc.warning || 0) + (inc.info || 0);
    const darkRow = (left, right, isAlert = false) =>
      `<tr>` +
      `<td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#F2F0EA;padding:8px 12px 8px 0;border-bottom:1px solid #1C1C19;">${left}</td>` +
      `<td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${isAlert ? "#FF4040" : "#6E6E66"};text-align:right;padding:8px 0;border-bottom:1px solid #1C1C19;">${right}</td>` +
      `</tr>`;
    const venueRows = venues
      .map((v) => darkRow(esc(v.venue), v.completionPct == null ? "&mdash;" : `${v.completionPct}% complete`))
      .join("");
    const scorerLine = c.topScorer && c.topScorer.player
      ? `Top scorer this week: <span style="color:#F2F0EA;font-weight:700;">${esc(c.topScorer.player)}</span> with ${c.topScorer.goals} goal${c.topScorer.goals === 1 ? "" : "s"}.`
      : "No goals logged across the group this week.";
    return {
      subject: `This week at ${c.companyName} — ${c.weekLabel}`,
      text:
        `${c.companyName} — week of ${c.weekLabel}.\n` +
        `${c.venues} venue(s). Fixtures: ${c.fixturesCompleted} completed, ${c.fixturesRemaining} remaining. ${c.totalGoals} goals.\n` +
        `Revenue: ${money(r.collectedPence)} collected of ${money(r.owedPence)} owed` +
        `${r.rate == null ? "" : ` (${r.rate}% collection rate)`}, ${money(r.outstandingPence)} outstanding.\n` +
        `Open incidents: ${incTotal} (${inc.critical || 0} critical, ${inc.warning || 0} warning).\n` +
        (c.topScorer && c.topScorer.player ? `Top scorer: ${c.topScorer.player} (${c.topScorer.goals}).\n` : "") +
        (c.link ? `Open HQ: ${c.link}` : ""),
      html: wrap(
        `<p style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:#F2F0EA;margin:0 0 4px 0;">${esc(c.companyName)}</p>` +
        `<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin:0 0 20px 0;">Week of ${esc(c.weekLabel)}</p>` +
        `<p style="${P}">` +
          `<span style="color:#F2F0EA;font-weight:700;">${c.venues}</span> venue${c.venues === 1 ? "" : "s"} &mdash; ` +
          `<span style="color:#F2F0EA;font-weight:700;">${c.fixturesCompleted}</span> fixture${c.fixturesCompleted === 1 ? "" : "s"} completed, ` +
          `<span style="color:#F2F0EA;font-weight:700;">${c.fixturesRemaining}</span> still to play, ` +
          `<span style="color:#F2F0EA;font-weight:700;">${c.totalGoals}</span> goal${c.totalGoals === 1 ? "" : "s"} scored. ` +
          scorerLine +
        `</p>` +
        `<p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin:0 0 8px 0;">Revenue</p>` +
        detailBox([
          { label: "Collected",       value: money(r.collectedPence) },
          { label: "Owed",            value: money(r.owedPence) },
          { label: "Outstanding",     value: `<span style="color:#FF4040;">${money(r.outstandingPence)}</span>` },
          ...(r.rate != null ? [{ label: "Collection rate", value: `${r.rate}%` }] : []),
        ]) +
        (incTotal > 0
          ? `<p style="${P}">Open incidents: <span style="color:#FF4040;font-weight:700;">${inc.critical || 0} critical</span>, ${inc.warning || 0} warning, ${inc.info || 0} info</p>`
          : `<p style="${P}">${statusBadge("All clear", "green")} &nbsp;No open incidents.</p>`) +
        (venueRows
          ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin:4px 0 8px 0;">Venues</p>` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">${venueRows}</table>`
          : "") +
        (c.link ? btn(esc(c.link), "Open HQ dashboard") : ""),
        { glowColor: "rgba(232,160,32,0.20)" }
      ),
    };
  },
  // Casual-app ops digest (mig 234) — operator-only "is the app being used?" email.
  // ctx is built in cron.js opsDailyDigestJob / opsWeeklyDigestJob from get_ops_usage_digest
  // (real squads only; demo/dc seeds stripped in SQL). EMAIL ONLY. Sections, never bullets.
  opsDailyDigest: (c) => {
    const newSquads = Array.isArray(c.newSquads) ? c.newSquads : [];
    const quiet = Array.isArray(c.newAndQuiet) ? c.newAndQuiet : [];
    const churn = (c.disabled || 0) + (c.deleted || 0);
    return {
      subject: `In or Out — ${c.dateLabel}: ${c.squadsActive}/${c.squadsTotal} squads active`,
      text:
        `In or Out — ${c.dateLabel}.\n` +
        `${c.squadsActive} of ${c.squadsTotal} squads active, ${c.activePlayers} players opened the app, ${c.totalEvents} actions (${c.availabilityMarks} in/out marks).\n` +
        (newSquads.length ? `New squads: ${newSquads.map((s) => s.name).join(", ")}.\n` : "") +
        (c.newPlayers ? `${c.newPlayers} new player(s).\n` : "") +
        (quiet.length ? `⚠ New & quiet (needs a nudge): ${quiet.map(quietLabel).join("; ")}.\n` : "") +
        (churn ? `Churn: ${c.disabled} disabled, ${c.deleted} removed.\n` : "No churn.\n"),
      html: wrap(
        `<p style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:#F2F0EA;margin:0 0 4px 0;">In or Out</p>` +
        `<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin:0 0 20px 0;">${esc(c.dateLabel)}</p>` +
        detailBox([
          { label: "Squads active",  value: `${c.squadsActive} of ${c.squadsTotal}` },
          { label: "Players in app", value: String(c.activePlayers) },
          { label: "Actions",        value: `${c.totalEvents} (${c.availabilityMarks} in/out marks)` },
          ...(c.newPlayers ? [{ label: "New players", value: String(c.newPlayers) }] : []),
        ]) +
        (newSquads.length
          ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin:0 0 6px 0;">New squads</p>` +
            `<p style="${P}"><span style="color:#3DDC6A;">${newSquads.map((s) => esc(s.name)).join(", ")}</span></p>`
          : "") +
        (quiet.length
          ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#FF4040;margin:0 0 6px 0;">${statusBadge("Needs a nudge", "red")} New &amp; quiet</p>` +
            `<p style="${P}"><span style="color:#FF4040;">${quiet.map((q) => esc(quietLabel(q))).join("<br>")}</span></p>`
          : "") +
        (churn
          ? `<p style="${P0}">${statusBadge("Churn", "red")} &nbsp;<span style="color:#FF4040;">${c.disabled} disabled, ${c.deleted} removed.</span></p>`
          : `<p style="${P0}">${statusBadge("No churn", "green")}</p>`),
        { glowColor: "rgba(232,160,32,0.20)" }
      ),
    };
  },
  opsWeeklyDigest: (c) => {
    const newSquads = Array.isArray(c.newSquads) ? c.newSquads : [];
    const dormancy = Array.isArray(c.dormancy) ? c.dormancy : [];
    const quiet = Array.isArray(c.newAndQuiet) ? c.newAndQuiet : [];
    const churn = (c.disabled || 0) + (c.deleted || 0);
    const wow = (cur, prev) => {
      if (!prev) return cur ? "" : "";
      const pct = Math.round(((cur - prev) / prev) * 100);
      return pct === 0 ? " (flat wk/wk)" : ` (${pct > 0 ? "+" : ""}${pct}% wk/wk)`;
    };
    const dormLabel = (d) =>
      d.days_since == null ? "never active"
        : d.days_since === 0 ? "active today"
        : `${d.days_since}d ago`;
    const darkRow = (left, right, isAlert = false) =>
      `<tr>` +
      `<td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#F2F0EA;padding:8px 12px 8px 0;border-bottom:1px solid #1C1C19;">${left}</td>` +
      `<td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${isAlert ? "#FF4040" : "#6E6E66"};text-align:right;padding:8px 0;border-bottom:1px solid #1C1C19;">${right}</td>` +
      `</tr>`;
    const dormRows = dormancy
      .map((d) => {
        const silent = d.days_since == null || d.days_since >= 14;
        return darkRow(esc(d.name), dormLabel(d) + (silent ? " — silent" : ""), silent);
      })
      .join("");
    return {
      subject: `In or Out weekly — week of ${c.weekLabel}`,
      text:
        `In or Out — week of ${c.weekLabel}.\n` +
        `${c.squadsActive} of ${c.squadsTotal} squads active. ${c.activePlayers} active players${wow(c.activePlayers, c.activePlayersPrev)}. ` +
        `${c.totalEvents} actions${wow(c.totalEvents, c.totalEventsPrev)}.\n` +
        (newSquads.length ? `New squads: ${newSquads.map((s) => s.name).join(", ")}.\n` : "No new squads.\n") +
        (c.newPlayers ? `${c.newPlayers} new players.\n` : "") +
        (quiet.length ? `⚠ New & quiet (needs a nudge): ${quiet.map(quietLabel).join("; ")}.\n` : "") +
        (churn ? `Churn: ${c.disabled} disabled, ${c.deleted} removed.\n` : "No churn.\n") +
        dormancy.map((d) => `${d.name}: ${dormLabel(d)}`).join("; "),
      html: wrap(
        `<p style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:#F2F0EA;margin:0 0 4px 0;">In or Out &mdash; weekly</p>` +
        `<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin:0 0 20px 0;">Week of ${esc(c.weekLabel)}</p>` +
        detailBox([
          { label: "Squads active",  value: `${c.squadsActive} of ${c.squadsTotal}` },
          { label: "Active players", value: String(c.activePlayers) + wow(c.activePlayers, c.activePlayersPrev) },
          { label: "Actions",        value: String(c.totalEvents) + wow(c.totalEvents, c.totalEventsPrev) },
          { label: "New players",    value: String(c.newPlayers || 0) },
        ]) +
        `<p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin:0 0 8px 0;">New this week</p>` +
        `<p style="${P}">` +
        (newSquads.length
          ? `<span style="color:#3DDC6A;">${newSquads.length} new squad${newSquads.length === 1 ? "" : "s"}: ${newSquads.map((s) => esc(s.name)).join(", ")}</span>`
          : `No new squads`) +
        `.</p>` +
        (quiet.length
          ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#FF4040;margin:0 0 6px 0;">${statusBadge("Needs a nudge", "red")} New &amp; quiet</p>` +
            `<p style="${P}"><span style="color:#FF4040;">${quiet.map((q) => esc(quietLabel(q))).join("<br>")}</span></p>`
          : "") +
        (churn
          ? `<p style="${P}">${statusBadge("Churn", "red")} &nbsp;<span style="color:#FF4040;">${c.disabled} disabled, ${c.deleted} removed.</span></p>`
          : `<p style="${P}">${statusBadge("No churn", "green")}</p>`) +
        (dormRows
          ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6E6E66;margin:4px 0 8px 0;">Squads &mdash; last active</p>` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">${dormRows}</table>`
          : ""),
        { glowColor: "rgba(232,160,32,0.20)" }
      ),
    };
  },
  // Phase 11 Club Comms (mig 307) — broadcast from venue to club members.
  // ctx: { firstName, clubName, venueName, title, body }
  club_announcement: (c) => ({
    subject: `[${c.clubName}] ${c.title}`,
    text: `Hi ${c.firstName},\n\n${c.body}\n\n— ${c.venueName}`,
    html: wrap(
      `<h1 style="${H1}">${esc(c.title)}</h1>` +
      `<p style="${P}">Hi <span style="color:#F2F0EA;font-weight:700;">${esc(c.firstName)}</span>,</p>` +
      `<p style="${P}">${esc(c.body).replace(/\n/g, "<br>")}</p>` +
      `<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#4A4A44;margin:16px 0 0 0;">&mdash; ${esc(c.venueName)}</p>`,
      { glowColor: "rgba(232,160,32,0.20)" }
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
