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
