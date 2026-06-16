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

const wrap = (bodyHtml) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#111;line-height:1.55;max-width:520px">` +
  bodyHtml +
  `<hr style="border:none;border-top:1px solid #eee;margin:24px 0">` +
  `<p style="font-size:12px;color:#888">In or Out · league football, sorted</p></div>`;

const TEMPLATES = {
  // ── Classes Booking — Phase 3 member-facing emails (mig 340) ──────────────
  class_booking_confirmation: (c) => ({
    subject: `You're booked — ${c.className} on ${c.dateLabel}`,
    text:
      `Hi ${c.firstName},\n\nYou're booked into ${c.className} at ${c.venueName}` +
      (c.spaceName ? ` (${c.spaceName})` : "") + ` on ${c.dateLabel} at ${c.timeLabel}.` +
      `\n\nSee you there. To cancel, open your membership pass.`,
    html: wrap(
      `<p>Hi <b>${esc(c.firstName)}</b>,</p>` +
      `<p>You're booked into <b>${esc(c.className)}</b> at <b>${esc(c.venueName)}</b>` +
      (c.spaceName ? ` (${esc(c.spaceName)})` : "") +
      ` on <b>${esc(c.dateLabel)}</b> at <b>${esc(c.timeLabel)}</b>.</p>` +
      `<p>See you there. You can cancel from your membership pass if your plans change.</p>`
    ),
  }),
  class_waitlist_joined: (c) => ({
    subject: `You're on the waitlist — ${c.className}`,
    text:
      `Hi ${c.firstName},\n\n${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} is full, ` +
      `so you're on the waitlist` + (c.waitlistPosition ? ` (position ${c.waitlistPosition})` : "") +
      `. We'll let you know if a spot opens up.`,
    html: wrap(
      `<p>Hi <b>${esc(c.firstName)}</b>,</p>` +
      `<p><b>${esc(c.className)}</b> at <b>${esc(c.venueName)}</b> on <b>${esc(c.dateLabel)}</b> at <b>${esc(c.timeLabel)}</b> is full, ` +
      `so you're on the waitlist` + (c.waitlistPosition ? ` (position <b>${esc(c.waitlistPosition)}</b>)` : "") + `.</p>` +
      `<p>We'll email you if a spot opens up.</p>`
    ),
  }),
  class_waitlist_promoted: (c) => ({
    subject: `A spot opened — you're in for ${c.className}`,
    text:
      `Good news — a spot opened in ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel}, ` +
      `and you're now confirmed. See you there.`,
    html: wrap(
      `<p>Good news — a spot opened in <b>${esc(c.className)}</b> at <b>${esc(c.venueName)}</b> ` +
      `on <b>${esc(c.dateLabel)}</b> at <b>${esc(c.timeLabel)}</b>, and you're now <b>confirmed</b>.</p>` +
      `<p>See you there.</p>`
    ),
  }),
  class_booking_cancelled: (c) => ({
    subject: `Booking cancelled — ${c.className}`,
    text:
      `Your booking for ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} has been cancelled. ` +
      `Any prepaid charge has been refunded.`,
    html: wrap(
      `<p>Your booking for <b>${esc(c.className)}</b> at <b>${esc(c.venueName)}</b> ` +
      `on <b>${esc(c.dateLabel)}</b> at <b>${esc(c.timeLabel)}</b> has been cancelled.</p>` +
      `<p>Any prepaid charge has been refunded.</p>`
    ),
  }),
  class_cancelled: (c) => ({
    subject: `Class cancelled — ${c.className} on ${c.dateLabel}`,
    text:
      `Unfortunately ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} has been cancelled` +
      (c.reason ? ` (${c.reason})` : "") + `. Any prepaid charge has been refunded.`,
    html: wrap(
      `<p>Unfortunately <b>${esc(c.className)}</b> at <b>${esc(c.venueName)}</b> ` +
      `on <b>${esc(c.dateLabel)}</b> at <b>${esc(c.timeLabel)}</b> has been cancelled` +
      (c.reason ? ` — ${esc(c.reason)}` : "") + `.</p>` +
      `<p>Any prepaid charge has been refunded. Sorry for the inconvenience.</p>`
    ),
  }),
  class_instructor_changed: (c) => ({
    subject: `Instructor change — ${c.className} on ${c.dateLabel}`,
    text:
      `Heads up: the instructor for ${c.className} at ${c.venueName} on ${c.dateLabel} at ${c.timeLabel} has changed. ` +
      `Your booking is unaffected.`,
    html: wrap(
      `<p>Heads up: the instructor for <b>${esc(c.className)}</b> at <b>${esc(c.venueName)}</b> ` +
      `on <b>${esc(c.dateLabel)}</b> at <b>${esc(c.timeLabel)}</b> has changed.</p>` +
      `<p>Your booking is unaffected — see you there.</p>`
    ),
  }),
  class_reminder: (c) => ({
    subject: `Tomorrow: ${c.className} at ${c.timeLabel}`,
    text:
      `Hi ${c.firstName},\n\nReminder — you're booked into ${c.className} at ${c.venueName}` +
      (c.spaceName ? ` (${c.spaceName})` : "") + ` on ${c.dateLabel} at ${c.timeLabel}.` +
      `\n\nCan't make it? Cancel from your membership pass so someone on the waitlist can take your spot.`,
    html: wrap(
      `<p>Hi <b>${esc(c.firstName)}</b>,</p>` +
      `<p>Reminder — you're booked into <b>${esc(c.className)}</b> at <b>${esc(c.venueName)}</b>` +
      (c.spaceName ? ` (${esc(c.spaceName)})` : "") +
      ` on <b>${esc(c.dateLabel)}</b> at <b>${esc(c.timeLabel)}</b>.</p>` +
      `<p>Can't make it? Cancel from your membership pass so someone on the waitlist can take your spot.</p>`
    ),
  }),
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
      html: wrap(`<p>Hi <b>${esc(c.teamName)}</b>,</p><p>${esc(msg)}</p>`),
    };
  },
  // Venue booking confirmation (mig 232) — sent to the booker's captured contact email
  // when a venue creates a booking. Covers single + block (weeks > 1).
  booking_confirmation: (c) => {
    const whenLine = c.weeks > 1
      ? `${c.weeks} weeks from ${c.dateLabel} at ${c.timeLabel}`
      : `${c.dateLabel} at ${c.timeLabel}`;
    const dur = c.slotMinutes ? ` (${c.slotMinutes} min)` : "";
    return {
      subject: `Booking confirmed — ${c.venueName}`,
      text:
        `Your booking at ${c.venueName} is confirmed.\n` +
        `${c.pitchName} — ${whenLine}${dur}.`,
      html: wrap(
        `<p>Your booking at <b>${esc(c.venueName)}</b> is confirmed.</p>` +
        `<p><b>${esc(c.pitchName)}</b> — ${esc(whenLine)}${esc(dur)}.</p>`
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
      `<p>Hi <b>${esc(c.firstName)}</b>,</p>` +
      `<p>Welcome to <b>${esc(c.venueName)}</b>! Your <b>${esc(c.tierName)}</b> membership is now active.</p>` +
      (c.passUrl ? `<p><a href="${esc(c.passUrl)}">Open your membership pass →</a> — show it at reception to check in.</p>` : "")
    ),
  }),
  membership_renewal_due: (c) => ({
    subject: `Your ${c.venueName} membership renews on ${c.dateLabel}`,
    text:
      `Hi ${c.firstName},\n\nYour ${c.tierName} membership at ${c.venueName} renews on ${c.dateLabel} ` +
      `(${gbp(c.amountPence)}/${c.period}).` + (c.passUrl ? ` Your pass: ${c.passUrl}` : ""),
    html: wrap(
      `<p>Hi <b>${esc(c.firstName)}</b>,</p>` +
      `<p>Your <b>${esc(c.tierName)}</b> membership at <b>${esc(c.venueName)}</b> renews on <b>${esc(c.dateLabel)}</b> ` +
      `(${gbp(c.amountPence)}/${esc(c.period)}).</p>` +
      (c.passUrl ? `<p><a href="${esc(c.passUrl)}">View your membership →</a></p>` : "")
    ),
  }),
  membership_payment_due: (c) => ({
    subject: `Payment due — ${c.venueName} membership`,
    text:
      `Hi ${c.firstName},\n\nA membership payment of ${gbp(c.amountPence)} is due${c.dateLabel ? ` (due ${c.dateLabel})` : ""} ` +
      `at ${c.venueName}. Please settle it at reception to keep your membership active.`,
    html: wrap(
      `<p>Hi <b>${esc(c.firstName)}</b>,</p>` +
      `<p>A membership payment of <b>${gbp(c.amountPence)}</b> is due${c.dateLabel ? ` (due <b>${esc(c.dateLabel)}</b>)` : ""} at <b>${esc(c.venueName)}</b>.</p>` +
      `<p>Please settle it at reception to keep your membership active.</p>`
    ),
  }),
  membership_freeze_ending: (c) => ({
    subject: `Your ${c.venueName} membership unfreezes on ${c.dateLabel}`,
    text:
      `Hi ${c.firstName},\n\nYour ${c.tierName} membership at ${c.venueName} comes out of freeze on ${c.dateLabel} ` +
      `and billing resumes (${gbp(c.amountPence)}/${c.period}).`,
    html: wrap(
      `<p>Hi <b>${esc(c.firstName)}</b>,</p>` +
      `<p>Your <b>${esc(c.tierName)}</b> membership at <b>${esc(c.venueName)}</b> comes out of freeze on <b>${esc(c.dateLabel)}</b> ` +
      `and billing resumes (${gbp(c.amountPence)}/${esc(c.period)}).</p>` +
      (c.passUrl ? `<p><a href="${esc(c.passUrl)}">View your membership →</a></p>` : "")
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
      `<p>League fixture vs <b>${esc(c.opponent)}</b> on <b>${esc(c.dateLabel)}</b>.</p>` +
      `<p>Are you in?` + (c.link ? ` <a href="${esc(c.link)}">Mark in or out →</a>` : "") + `</p>`
    ),
  }),
  leagueFixtureReminder2h: (c) => ({
    subject: `Last call — kickoff vs ${c.opponent} in 2h`,
    text:
      `Kickoff vs ${c.opponent} in about 2 hours — are you in?` +
      (c.link ? ` Mark in or out now: ${c.link}` : ""),
    html: wrap(
      `<p>Kickoff vs <b>${esc(c.opponent)}</b> in about 2 hours — are you in?</p>` +
      (c.link ? `<p><a href="${esc(c.link)}">Mark in or out now →</a></p>` : "")
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
    const venueRows = venues
      .map((v) =>
        `<tr><td style="padding:4px 12px 4px 0">${esc(v.venue)}</td>` +
        `<td style="padding:4px 0;text-align:right;color:#555">${v.completionPct == null ? "—" : v.completionPct + "% complete"}</td></tr>`)
      .join("");
    const scorerLine = c.topScorer && c.topScorer.player
      ? `Top scorer this week: <b>${esc(c.topScorer.player)}</b> with ${c.topScorer.goals} goal${c.topScorer.goals === 1 ? "" : "s"}.`
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
        `<p style="margin:0 0 4px"><b style="font-size:17px">${esc(c.companyName)}</b></p>` +
        `<p style="margin:0 0 18px;color:#888;font-size:13px">Week of ${esc(c.weekLabel)}</p>` +
        `<p style="margin:0 0 14px">Across <b>${c.venues}</b> venue${c.venues === 1 ? "" : "s"}: ` +
        `<b>${c.fixturesCompleted}</b> fixture${c.fixturesCompleted === 1 ? "" : "s"} completed, ` +
        `<b>${c.fixturesRemaining}</b> still to play, <b>${c.totalGoals}</b> goal${c.totalGoals === 1 ? "" : "s"} scored. ` +
        scorerLine + `</p>` +
        `<p style="margin:0 0 6px"><b>Revenue</b></p>` +
        `<p style="margin:0 0 14px;color:#333">` +
        `${money(r.collectedPence)} collected of ${money(r.owedPence)} owed` +
        `${r.rate == null ? "" : ` — <b>${r.rate}%</b> collection rate`}. ` +
        `<span style="color:#a00">${money(r.outstandingPence)} outstanding.</span></p>` +
        (incTotal > 0
          ? `<p style="margin:0 0 14px"><b>Open incidents:</b> ${incTotal} ` +
            `(${inc.critical || 0} critical, ${inc.warning || 0} warning, ${inc.info || 0} info)</p>`
          : `<p style="margin:0 0 14px;color:#2a2">No open incidents — all clear.</p>`) +
        (venueRows
          ? `<p style="margin:0 0 6px"><b>Venues</b></p><table style="border-collapse:collapse;margin:0 0 14px">${venueRows}</table>`
          : "") +
        (c.link ? `<p><a href="${esc(c.link)}">Open your HQ dashboard →</a></p>` : "")
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
        `<p style="margin:0 0 4px"><b style="font-size:17px">In or Out</b></p>` +
        `<p style="margin:0 0 18px;color:#888;font-size:13px">${esc(c.dateLabel)}</p>` +
        `<p style="margin:0 0 14px"><b>${c.squadsActive}</b> of <b>${c.squadsTotal}</b> squads active yesterday — ` +
        `<b>${c.activePlayers}</b> player${c.activePlayers === 1 ? "" : "s"} opened the app, ` +
        `<b>${c.totalEvents}</b> action${c.totalEvents === 1 ? "" : "s"} ` +
        `(<b>${c.availabilityMarks}</b> in/out mark${c.availabilityMarks === 1 ? "" : "s"}).</p>` +
        (newSquads.length
          ? `<p style="margin:0 0 6px"><b>New squads</b></p>` +
            `<p style="margin:0 0 14px;color:#2a7a2a">${newSquads.map((s) => esc(s.name)).join(", ")}</p>`
          : "") +
        (c.newPlayers
          ? `<p style="margin:0 0 14px"><b>${c.newPlayers}</b> new player${c.newPlayers === 1 ? "" : "s"} joined.</p>`
          : "") +
        (quiet.length
          ? `<p style="margin:0 0 6px;color:#a00"><b>⚠ New &amp; quiet — needs a nudge</b></p>` +
            `<p style="margin:0 0 14px;color:#a00">${quiet.map((q) => esc(quietLabel(q))).join("<br>")}</p>`
          : "") +
        (churn
          ? `<p style="margin:0 0 14px;color:#a00"><b>Churn:</b> ${c.disabled} disabled, ${c.deleted} removed.</p>`
          : `<p style="margin:0 0 14px;color:#2a7a2a">No churn.</p>`)
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
    const dormRows = dormancy
      .map((d) => {
        const silent = d.days_since == null || d.days_since >= 14;
        return (
          `<tr><td style="padding:4px 12px 4px 0">${esc(d.name)}</td>` +
          `<td style="padding:4px 0;text-align:right;color:${silent ? "#a00" : "#555"}">` +
          `${dormLabel(d)}${silent ? " — silent" : ""}</td></tr>`
        );
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
        `<p style="margin:0 0 4px"><b style="font-size:17px">In or Out — weekly</b></p>` +
        `<p style="margin:0 0 18px;color:#888;font-size:13px">Week of ${esc(c.weekLabel)}</p>` +
        `<p style="margin:0 0 14px"><b>${c.squadsActive}</b> of <b>${c.squadsTotal}</b> squads active this week. ` +
        `<b>${c.activePlayers}</b> active player${c.activePlayers === 1 ? "" : "s"}${wow(c.activePlayers, c.activePlayersPrev)}, ` +
        `<b>${c.totalEvents}</b> action${c.totalEvents === 1 ? "" : "s"}${wow(c.totalEvents, c.totalEventsPrev)}.</p>` +
        `<p style="margin:0 0 6px"><b>New this week</b></p>` +
        `<p style="margin:0 0 14px;color:#333">` +
        (newSquads.length
          ? `<span style="color:#2a7a2a">${newSquads.length} new squad${newSquads.length === 1 ? "" : "s"}: ${newSquads.map((s) => esc(s.name)).join(", ")}</span>`
          : `No new squads`) +
        `. <b>${c.newPlayers || 0}</b> new player${(c.newPlayers || 0) === 1 ? "" : "s"}.</p>` +
        (quiet.length
          ? `<p style="margin:0 0 6px;color:#a00"><b>⚠ New &amp; quiet — needs a nudge</b></p>` +
            `<p style="margin:0 0 14px;color:#a00">${quiet.map((q) => esc(quietLabel(q))).join("<br>")}</p>`
          : "") +
        (churn
          ? `<p style="margin:0 0 14px;color:#a00"><b>Churn:</b> ${c.disabled} disabled, ${c.deleted} removed.</p>`
          : `<p style="margin:0 0 14px;color:#2a7a2a">No churn.</p>`) +
        (dormRows
          ? `<p style="margin:0 0 6px"><b>Squads — last active</b></p>` +
            `<table style="border-collapse:collapse;margin:0 0 14px">${dormRows}</table>`
          : "")
      ),
    };
  },
  // Phase 11 Club Comms (mig 307) — broadcast from venue to club members.
  // ctx: { firstName, clubName, venueName, title, body }
  club_announcement: (c) => ({
    subject: `[${c.clubName}] ${c.title}`,
    text: `Hi ${c.firstName},\n\n${c.body}\n\n— ${c.venueName}`,
    html: wrap(
      `<p>Hi <b>${esc(c.firstName)}</b>,</p>` +
      `<p><b>${esc(c.title)}</b></p>` +
      `<p>${esc(c.body).replace(/\n/g, "<br>")}</p>` +
      `<p style="color:#888;font-size:13px">— ${esc(c.venueName)}</p>`
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
