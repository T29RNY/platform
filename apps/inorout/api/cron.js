// /api/cron.js — runs every 15 minutes via pg_cron → pg_net or Vercel Cron
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, VERCEL_URL

const { createClient } = require("@supabase/supabase-js");
const { sendTemplated } = require("./_mailer");
const { sendTemplated: sendSmsTemplated, pickChannel } = require("./_sms");
const { stripe: stripeClient, isConfigured: stripeConfigured } = require("./_stripe");
const { isGcConfigured, gcClient } = require("./_gocardless");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vercel Functions run in UTC, but operator-entered opens_time / "midnight"
// gates mean UK-local. Intl.DateTimeFormat is DST-aware (BST vs GMT).
function nowInUkParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map(p => [p.type, p.value])
  );
  return {
    dayName: parts.weekday,
    hours:   parseInt(parts.hour, 10),
    minutes: parseInt(parts.minute, 10),
  };
}

// Full UK-local now: calendar date string + minutes-of-day. Used by the league
// reminder crons (availabilityRequestJob / fixtureReminderJob) so timing compares
// UK wall-clock to UK wall-clock — fixtures.scheduled_date + kickoff_time are stored
// as UK wall-clock, so no UTC conversion is needed and the math is DST-safe.
function nowInUkFull() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(
    fmt.formatToParts(new Date()).map(x => [x.type, x.value])
  );
  const hours   = parseInt(p.hour, 10);
  const minutes = parseInt(p.minute, 10);
  return { date: `${p.year}-${p.month}-${p.day}`, hours, minutes, minsOfDay: hours * 60 + minutes };
}

// Pure calendar-date arithmetic on a YYYY-MM-DD string (UTC anchor → DST-immune).
function addDaysIso(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Advance a timestamptz by `days` in UK WALL-CLOCK terms (DST-safe). The naive
// `d.setDate(d.getDate()+7)` preserves the absolute UTC instant, so a kickoff
// shifts ±1h across a DST boundary week (e.g. 20:00 → 21:00 the week after the
// clocks change). This keeps the UK wall-clock (hour/minute/weekday) fixed and
// recomputes the UTC instant using the offset valid on the new date.
function ukAdvanceDays(iso, days) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const read = (d) => {
    const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
    return { y:+p.year, mo:+p.month, da:+p.day, h:+(p.hour === "24" ? "0" : p.hour), mi:+p.minute, s:+p.second };
  };
  const cur = read(new Date(iso));
  const wantMs = Date.UTC(cur.y, cur.mo - 1, cur.da + days, cur.h, cur.mi, cur.s);
  let guess = wantMs; // treat the target UK wall-clock as if UTC, then correct by the UK offset
  for (let i = 0; i < 3; i++) {
    const r = read(new Date(guess));
    const renderedMs = Date.UTC(r.y, r.mo - 1, r.da, r.h, r.mi, r.s);
    const delta = wantMs - renderedMs;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

// Friendly UK date label, e.g. "Thu 4 Jun". Noon anchor avoids any midnight DST edge.
function fmtUkDate(dateStr) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short",
    }).format(new Date(dateStr + "T12:00:00Z"));
  } catch (e) { return dateStr; }
}

module.exports = async function handler(req, res) {
  const secret = req.headers["authorization"]?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = [];
  // Manual one-off trigger for the ops digest (still behind the CRON_SECRET gate above,
  // so it's no new public surface). `?ops_force=1` runs the daily + weekly digest jobs
  // ignoring their 08:00-UK time window — used to test/re-send on demand. notification_log
  // still dedups per window date, so re-triggering the same day is a safe no-op.
  const opsForce = req.query?.ops_force === "1";
  // Hardcoded to the canonical apex-www host. process.env.VERCEL_URL
  // resolves to the per-deployment URL (e.g. inorout-xxx.vercel.app),
  // which is gated by Vercel Deployment Protection and 401s every
  // internal fetch — same family as the pg_cron host-redirect bug
  // fixed in GO_LIVE_ISSUES.md 6.1.
  const base = "https://app.in-or-out.com";

  const callNotify = async (cronType) => {
    try {
      const r = await fetch(`${base}/api/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({ cronType }),
      });
      const ok = r.ok;
      results.push(`${cronType}: ${ok ? "ok" : r.status}`);
    } catch (e) {
      results.push(`${cronType}: error — ${e.message}`);
    }
  };

  // ── Demo auto-reset ───────────────────────────────────────────────────────
  try {
    const { data: session } = await supabase
      .from("demo_sessions")
      .select("last_interaction")
      .eq("id", "main")
      .single();

    if (session) {
      const ms = Date.now() - new Date(session.last_interaction).getTime();
      if (ms > 2 * 60 * 60 * 1000) {
        await resetDemoPlayers();
        results.push("demo_reset: triggered");
      } else {
        results.push("demo_reset: skipped");
      }
    }
  } catch (e) {
    results.push(`demo_reset: error — ${e.message}`);
  }

  // ── Notification triggers ─────────────────────────────────────────────────
  await callNotify("flushQueue");
  await callNotify("gameDay9am");
  await callNotify("oneHrBefore");
  await callNotify("debtReminder");
  await callNotify("bibs24hr");
  await callNotify("bibs45min");

  // ── Lineup lock (at kickoff) ──────────────────────────────────────────────
  try {
    await lineupLockJob(base, results);
  } catch (e) {
    results.push(`lineupLock: error — ${e.message}`);
  }

  // ── Open POTM voting (kickoff + 60 min) ───────────────────────────────────
  try {
    await potmVotingOpenJob(base, results);
  } catch (e) {
    results.push(`potmVotingOpen: error — ${e.message}`);
  }

  // ── Tally POTM votes when window closes ───────────────────────────────────
  try {
    await potmTallyJob(base, results);
  } catch (e) {
    results.push(`potmTally: error — ${e.message}`);
  }

  // ── Auto-open game when opens_day/opens_time reached ──────────────────────
  try {
    await autoOpenGameJob(results);
  } catch (e) {
    results.push(`autoOpenGame: error — ${e.message}`);
  }
  await callNotify("autoOpen");

  // ── Advance game date to next week (midnight daily) ───────────────────────
  try {
    await advanceGameDateJob(results);
  } catch (e) {
    results.push(`advanceGameDate: error — ${e.message}`);
  }

  // ── DBS expiry sweep (08:00 UK daily) ────────────────────────────────────
  try {
    await dbsExpiryJob(results);
  } catch (e) {
    results.push(`dbsExpiry: error — ${e.message}`);
  }

  // ── Booking renewal holds + expiry (09:00 UK daily) ───────────────────────
  try {
    await renewalHoldsJob(base, results);
  } catch (e) {
    results.push(`renewalHolds: error — ${e.message}`);
  }

  // ── Membership/fee renewals (09:00 UK daily) ──────────────────────────────
  try {
    await membershipRenewalsJob(results);
  } catch (e) {
    results.push(`membershipRenewals: error — ${e.message}`);
  }

  // ── Membership reminders (10:00 UK daily — after renewals mint charges) ────
  try {
    await membershipRemindersJob(results);
  } catch (e) {
    results.push(`membershipReminders: error — ${e.message}`);
  }

  // ── Stripe reconciliation (04:00 UK daily — DORMANT until keys exist) ──────
  try {
    await membershipReconciliationJob(results);
  } catch (e) {
    results.push(`membershipReconciliation: error — ${e.message}`);
  }

  // ── GoCardless reconciliation (04:15 UK daily — DORMANT until keys exist) ──
  try {
    await gcMembershipReconciliationJob(results);
  } catch (e) {
    results.push(`gcMembershipReconciliation: error — ${e.message}`);
  }

  // ── Superseded-booking displacement push (every tick) ─────────────────────
  try {
    await supersededPushJob(base, results);
  } catch (e) {
    results.push(`supersededPush: error — ${e.message}`);
  }

  // ── Booking-confirmed push (every tick) ───────────────────────────────────
  try {
    await confirmPushJob(base, results);
  } catch (e) {
    results.push(`confirmPush: error — ${e.message}`);
  }

  // ── Onboarding & ops emails (Phase 9 Cycle 9.1, every tick) ───────────────
  try {
    await onboardingEmailJob(base, results);
  } catch (e) {
    results.push(`onboardingEmail: error — ${e.message}`);
  }

  // ── Booking confirmation to the customer (mig 232, every tick) ────────────
  try {
    await bookingConfirmEmailJob(results);
  } catch (e) {
    results.push(`bookingConfirmEmail: error — ${e.message}`);
  }

  // ── League availability request (48h before a competitive fixture, 9am UK) ─
  try {
    await availabilityRequestJob(base, results);
  } catch (e) {
    results.push(`availabilityRequest: error — ${e.message}`);
  }

  // ── League fixture reminder (~2h before a competitive kickoff) ────────────
  try {
    await fixtureReminderJob(base, results);
  } catch (e) {
    results.push(`fixtureReminder: error — ${e.message}`);
  }

  // ── Club broadcast emails (Phase 11, every tick) ─────────────────────────
  try {
    await clubBroadcastJob(base, results);
  } catch (e) {
    results.push(`clubBroadcast: error — ${e.message}`);
  }

  // ── Class waitlist offer expiry (Phase 4, mig 341) — runs BEFORE the notify
  // drain so any fresh re-offer rows are emailed in the same tick. ────────────
  try {
    await classWaitlistExpiryJob(results);
  } catch (e) {
    results.push(`classWaitlistExpiry: error — ${e.message}`);
  }

  // ── Class booking notifications (confirm/waitlist/cancel drain, every tick) ─
  try {
    await classNotificationsJob(results);
  } catch (e) {
    results.push(`classNotifications: error — ${e.message}`);
  }

  // ── Class reminders (~24h before a booked class) ──────────────────────────
  try {
    await classRemindersJob(results);
  } catch (e) {
    results.push(`classReminders: error — ${e.message}`);
  }

  // ── Room hire notifications (request ack / confirm / cancel drain) ─────────
  try {
    await roomHireNotificationsJob(results);
  } catch (e) {
    results.push(`roomHire: error — ${e.message}`);
  }

  // ── HQ weekly digest (per-company, Monday 08:00 UK) ───────────────────────
  try {
    await weeklyDigestJob(results);
  } catch (e) {
    results.push(`weeklyDigest: error — ${e.message}`);
  }

  // ── Casual-app ops usage digest (operator-only, mig 234) ──────────────────
  // Daily Tue–Sun 08:00 UK (previous day); weekly Monday 08:00 UK (previous week).
  try {
    await opsDailyDigestJob(results, opsForce);
  } catch (e) {
    results.push(`opsDailyDigest: error — ${e.message}`);
  }
  try {
    await opsWeeklyDigestJob(results, opsForce);
  } catch (e) {
    results.push(`opsWeeklyDigest: error — ${e.message}`);
  }

  res.json({ ok: true, ts: new Date().toISOString(), results });
};

// ── Lineup lock ───────────────────────────────────────────────────────────────
async function lineupLockJob(base, results) {
  const now = new Date();
  const { data: schedules, error } = await supabase
    .from("schedule")
    .select("*")
    .eq("game_is_live", true)
    .eq("lineup_locked", false);
  if (error || !schedules?.length) { results.push("lineupLock: no schedules"); return; }

  for (const sched of schedules) {
    if (!sched.game_date_time) { results.push(`lineupLock: ${sched.team_id} no game_date_time`); continue; }
    const kickoff = new Date(sched.game_date_time);
    if (now < kickoff) { results.push(`lineupLock: ${sched.team_id} not yet`); continue; }

    // Get players who are "in" — two-query pattern (players has no team_id column)
    const { data: tpRows } = await supabase
      .from("team_players")
      .select("player_id")
      .eq("team_id", sched.team_id);
    const teamPlayerIds = (tpRows || []).map(r => r.player_id);
    if (!teamPlayerIds.length) { results.push(`lineupLock: ${sched.team_id} no players`); continue; }

    const { data: players } = await supabase
      .from("players")
      .select("id, name, team, is_guest")
      .in("id", teamPlayerIds)
      .eq("status", "in")
      .eq("disabled", false);
    if (!players?.length) { results.push(`lineupLock: ${sched.team_id} no players`); continue; }

    const matchId = sched.active_match_id || ("m_" + Math.random().toString(36).slice(2, 12));

    // Create stub match row if needed
    if (!sched.active_match_id) {
      await supabase.from("matches").upsert({
        id: matchId, team_id: sched.team_id,
        match_date: now.toISOString().split('T')[0],
        voting_open: false,
      }, { onConflict: "id" });
    }

    // Write player_match rows for all in-players
    const rows = players.filter(p => !p.is_guest).map(p => ({
      team_id: sched.team_id, match_id: matchId, player_id: p.id,
      team_assignment: p.team || null, attended: true, late_cancel: false,
      injury_absence: false, was_motm: false, had_bibs: false, goals: 0, is_guest: false,
    }));
    if (rows.length) {
      await supabase.from("player_match").upsert(rows, { onConflict: "match_id,player_id" });
    }

    // Mark schedule as locked
    await supabase.from("schedule").update({
      lineup_locked: true,
      active_match_id: matchId,
    }).eq("id", sched.id);
    await supabase.rpc("notify_team_change", {
      p_team_id: sched.team_id,
      p_reason:  "schedule_updated",
    });

    results.push(`lineupLock: ${sched.team_id} locked (${rows.length} players, match ${matchId})`);
  }
}

// ── Open POTM voting (kickoff + 60 min) ───────────────────────────────────────
async function potmVotingOpenJob(base, results) {
  const now = new Date();
  const { data: schedules, error } = await supabase
    .from("schedule")
    .select("*")
    .eq("game_is_live", true)
    .eq("lineup_locked", true)
    .eq("voting_open", false);
  if (error || !schedules?.length) { results.push("potmVotingOpen: no schedules"); return; }

  for (const sched of schedules) {
    if (!sched.active_match_id) continue;
    if (!sched.game_date_time) { results.push(`potmVotingOpen: ${sched.team_id} no game_date_time`); continue; }
    const kickoff = new Date(sched.game_date_time);
    const votingStartsAt = new Date(kickoff.getTime() + 60 * 60 * 1000);
    if (now < votingStartsAt) { results.push(`potmVotingOpen: ${sched.team_id} not yet`); continue; }

    // Get eligible voters from player_match
    const { data: pm } = await supabase
      .from("player_match")
      .select("player_id")
      .eq("match_id", sched.active_match_id)
      .eq("attended", true)
      .eq("is_guest", false);
    if (!pm?.length || pm.length < 3) {
      results.push(`potmVotingOpen: ${sched.team_id} not enough players (${pm?.length || 0})`);
      continue;
    }

    // Voting window: 2 hours from when it opens (≈ end of game). Session 80 —
    // extended from 1h to 2h at operator request.
    const closesAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    // Update matches table
    await supabase.from("matches").update({
      voting_open: true, voting_closes_at: closesAt, total_voters: pm.length,
    }).eq("id", sched.active_match_id);

    // Denormalize onto schedule for realtime propagation
    await supabase.from("schedule").update({
      voting_open: true, voting_closes_at: closesAt,
    }).eq("id", sched.id);
    await supabase.rpc("notify_team_change", {
      p_team_id: sched.team_id,
      p_reason:  "potm_voting_opened",
    });

    // Send push notification
    const playerIds = pm.map(r => r.player_id);
    try {
      await fetch(`${base}/api/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
        body: JSON.stringify({
          type: "potmVotingOpen", teamId: sched.team_id, playerIds,
          payload: { title: "Vote for POTM 🏆", body: "Who was the best player tonight? You've got 2 hours." },
        }),
      });
    } catch(e) {}

    results.push(`potmVotingOpen: ${sched.team_id} opened (${pm.length} voters)`);
  }
}

// ── Tally POTM votes when window closes ───────────────────────────────────────
async function potmTallyJob(base, results) {
  const now = new Date();
  const { data: matches, error } = await supabase
    .from("matches")
    .select("id, team_id, voting_closes_at, total_voters")
    .eq("voting_open", true)
    .not("voting_closes_at", "is", null);
  if (error || !matches?.length) { results.push("potmTally: no open matches"); return; }

  for (const match of matches) {
    if (new Date(match.voting_closes_at) > now) continue;

    // Tally votes
    const { data: votes } = await supabase
      .from("potm_votes")
      .select("nominee_id")
      .eq("match_id", match.id);
    const voteList = votes || [];
    const counts = {};
    for (const v of voteList) counts[v.nominee_id] = (counts[v.nominee_id] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (!sorted.length) {
      // No votes — fetch eligible players so admin can pick from the full list
      const { data: eligibleRows } = await supabase
        .from("player_match")
        .select("player_id")
        .eq("match_id", match.id)
        .eq("attended", true)
        .eq("is_guest", false);
      const eligibleIds = (eligibleRows || []).map(r => r.player_id);
      await supabase.from("matches").update({
        voting_open: false, admin_decision_pending: true,
        tied_candidates: eligibleIds.length ? eligibleIds : null,
      }).eq("id", match.id);
      await supabase.from("schedule").update({ voting_open: false }).eq("team_id", match.team_id);
      await supabase.rpc("notify_team_change", {
        p_team_id: match.team_id,
        p_reason:  "potm_result_announced",
      });
      results.push(`potmTally: ${match.id} no votes, admin pending (${eligibleIds.length} eligible)`);
      continue;
    }

    const topCount = sorted[0][1];
    const tied = sorted.filter(([, c]) => c === topCount).map(([id]) => id);
    const isTie = tied.length > 1;

    if (isTie) {
      // Admin must decide
      await supabase.from("matches").update({
        voting_open: false, admin_decision_pending: true, tied_candidates: tied,
      }).eq("id", match.id);
      await supabase.from("schedule").update({ voting_open: false }).eq("team_id", match.team_id);
      await supabase.rpc("notify_team_change", {
        p_team_id: match.team_id,
        p_reason:  "potm_result_announced",
      });

      // Notify admin
      const { data: team } = await supabase.from("teams").select("admin_token").eq("id", match.team_id).single();
      if (team) {
        try {
          await fetch(`${base}/api/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
            body: JSON.stringify({
              type: "potmAdminDecide", teamId: match.team_id,
              payload: { title: "POTM — You need to decide", body: "It's a tie. Pick tonight's POTM." },
            }),
          });
        } catch(e) {}
      }
      results.push(`potmTally: ${match.id} tie among ${tied.length}, admin notified`);
    } else {
      const winnerId = tied[0];

      const { data: winnerRow } = await supabase.from("players").select("name, motm").eq("id", winnerId).single();
      const winnerName = winnerRow?.name || "Unknown";

      // Close voting and set winner
      await supabase.from("matches").update({
        voting_open: false, motm: winnerId, was_admin_decided: false,
      }).eq("id", match.id);
      await supabase.from("player_match").update({ was_motm: true })
        .eq("match_id", match.id).eq("player_id", winnerId);

      // Increment motm counter on player record
      await supabase.from("players")
        .update({ motm: (winnerRow?.motm || 0) + 1 })
        .eq("id", winnerId);

      await supabase.from("schedule").update({ voting_open: false }).eq("team_id", match.team_id);
      await supabase.rpc("notify_team_change", {
        p_team_id: match.team_id,
        p_reason:  "potm_result_announced",
      });
      const { data: attended } = await supabase.from("player_match")
        .select("player_id").eq("match_id", match.id).eq("attended", true).eq("is_guest", false);
      const playerIds = (attended || []).map(r => r.player_id);

      try {
        await fetch(`${base}/api/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
          body: JSON.stringify({
            type: "potmResult", teamId: match.team_id, playerIds,
            payload: { title: "🏆 POTM Result", body: `${winnerName} wins POTM tonight!`, winnerId, winnerName },
          }),
        });
      } catch(e) {}
      results.push(`potmTally: ${match.id} winner ${winnerId}`);
    }
  }
}

// ── Auto-open game when opens_day/opens_time reached ─────────────────────────
async function autoOpenGameJob(results) {
  const uk = nowInUkParts();
  const todayName = uk.dayName;
  const nowMins   = uk.hours * 60 + uk.minutes;

  const { data: schedules, error } = await supabase
    .from("schedule")
    .select("id, team_id, opens_day, opens_time, game_date_time")
    .eq("active", true)
    .eq("auto_open_pending", true)
    .eq("is_cancelled", false)
    .not("game_date_time", "is", null);

  if (error || !schedules?.length) { results.push("autoOpenGame: no drafts"); return; }

  for (const sched of schedules) {
    if (!sched.opens_day || !sched.opens_time) continue;
    if (sched.opens_day !== todayName) continue;
    const [oh, om] = sched.opens_time.split(":").map(Number);
    const opensMins = oh * 60 + om;
    if (nowMins < opensMins || nowMins >= opensMins + 15) continue;

    // mig 126: route through admin_go_live_for_team so the matches row
    // and schedule.active_match_id are created atomically with the
    // game_is_live flip. The raw update we used to do here left the
    // schedule in a half-open state (game_is_live=true, active_match_id=null)
    // that blocked admin Make Teams until lineupLockJob backfilled the
    // match 60 minutes before kickoff. RPC also owns the notify broadcast
    // and writes an audit_events row with actor_type='system'.
    const { error: openErr } = await supabase.rpc("admin_go_live_for_team", {
      p_team_id: sched.team_id,
    });
    if (openErr) {
      results.push(`autoOpenGame: ${sched.team_id} error — ${openErr.message}`);
      continue;
    }
    results.push(`autoOpenGame: ${sched.team_id} opened`);
  }
}

// ── Advance game date to next week (midnight daily) ──────────────────────────
async function advanceGameDateJob(results) {
  const now = new Date();
  const uk = nowInUkParts();
  if (uk.hours !== 0 || uk.minutes >= 15) {
    results.push("advanceGameDate: not midnight window");
    return;
  }

  const { data: schedules, error } = await supabase
    .from("schedule")
    .select("id, team_id, game_date_time")
    .eq("active", true)
    .not("game_date_time", "is", null);

  if (error || !schedules?.length) { results.push("advanceGameDate: no schedules"); return; }

  for (const sched of schedules) {
    const kickoff    = new Date(sched.game_date_time);
    const hoursAfter = (now - kickoff) / (60 * 60 * 1000);
    if (hoursAfter < 3) { results.push(`advanceGameDate: ${sched.team_id} kickoff not passed`); continue; }

    // DST-safe: advance the UK wall-clock by 7 days (not the absolute instant),
    // so kickoff stays at e.g. 20:00 UK across a clock-change boundary week.
    const nextDt = ukAdvanceDays(sched.game_date_time, 7);

    await supabase.from("schedule").update({
      game_date_time:    nextDt,
      lineup_locked:     false,
      active_match_id:   null,
      game_is_live:      false,
      is_cancelled:      false,
      cancel_reason:     null,
      voting_open:       false,
      voting_closes_at:  null,
      auto_open_pending: true,
    }).eq("id", sched.id);
    await supabase.rpc("notify_team_change", {
      p_team_id: sched.team_id,
      p_reason:  "schedule_updated",
    });

    results.push(`advanceGameDate: ${sched.team_id} → ${nextDt}`);
  }
}

// ── Push to a team's admins (booking events) ─────────────────────────────────
// Resolves admin player_ids server-side (service-role RPC) so /api/notify targets
// only the admins, then sends via direct mode (deduped by notification_log).
async function pushTeamAdmins(base, teamId, type, payload, gameDate) {
  if (!teamId) return;
  const { data: ids } = await supabase.rpc("get_team_admin_player_ids", { p_team_id: teamId });
  const playerIds = Array.isArray(ids) ? ids : [];
  if (!playerIds.length) return;
  try {
    await fetch(`${base}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ type, teamId, playerIds, gameDate, payload }),
    });
  } catch (e) { /* surfaced by caller's results push */ }
}

// ── Booking renewal holds + expiry (09:00 UK daily) ──────────────────────────
async function renewalHoldsJob(base, results) {
  const uk = nowInUkParts();
  if (uk.hours !== 9 || uk.minutes >= 15) { results.push("renewalHolds: not 9am window"); return; }

  const { data: held, error } = await supabase.rpc("create_renewal_holds");
  if (error) {
    results.push(`renewalHolds: error — ${error.message}`);
  } else {
    for (const h of (held?.holds || [])) {
      await pushTeamAdmins(base, h.team_id, "booking_renewal_held",
        { title: "Keep your pitch slot", body: "Your weekly slot is held — confirm to keep it before it reopens." });
    }
    results.push(`renewalHolds: ${(held?.holds || []).length} held, ${(held?.skipped || []).length} skipped`);
  }

  const { data: exp, error: e2 } = await supabase.rpc("expire_renewal_holds");
  if (e2) {
    results.push(`renewalExpire: error — ${e2.message}`);
  } else {
    for (const x of (exp?.expired || [])) {
      await pushTeamAdmins(base, x.team_id, "booking_renewal_expired",
        { title: "Renewal hold lapsed", body: "Your renewal hold lapsed — the slot has reopened." });
    }
    results.push(`renewalExpire: ${(exp?.expired || []).length} expired`);
  }
}

// ── Membership/fee renewals (Membership Phase 3, mig 271) ────────────────────
// 09:00 UK daily. One server-side pass: reactivates lapsed freezes, flips
// end-of-period cancellations to cancelled, and mints the next venue_charge for
// every due membership + fee subscription (idempotent — charges encode the period
// in source_id, so re-running the same day is a no-op). All logic in the
// service_role-only RPC; this is just the thin scheduler, like renewalHoldsJob.
async function dbsExpiryJob(results) {
  const uk = nowInUkParts();
  if (uk.hours !== 8 || uk.minutes >= 15) { results.push("dbsExpiry: not 8am window"); return; }
  const { data, error } = await supabase.rpc("expire_staff_dbs");
  if (error) {
    results.push(`dbsExpiry: error — ${error.message}`);
  } else {
    results.push(`dbsExpiry: ${data?.expired ?? 0} expired`);
  }
}

async function membershipRenewalsJob(results) {
  const uk = nowInUkParts();
  if (uk.hours !== 9 || uk.minutes >= 15) { results.push("membershipRenewals: not 9am window"); return; }

  const { data, error } = await supabase.rpc("run_membership_renewals");
  if (error) {
    results.push(`membershipRenewals: error — ${error.message}`);
  } else {
    results.push(`membershipRenewals: ${data?.minted ?? 0} charged, ${data?.reactivated ?? 0} reactivated, ${data?.ended ?? 0} ended`);
  }
}

// ── Membership reminders (10:00 UK daily) ────────────────────────────────────
// Member-facing emails: welcome / renewal-due / payment-due / freeze-ending.
// The service_role-only get_membership_reminders_due RPC computes who's due (with
// PII); this job sends via Resend and dedups per (type, entity_key, email) in
// notification_log so a daily run never double-sends within a cycle. EMAIL ONLY —
// no-ops cleanly until RESEND_API_KEY is set.
async function membershipRemindersJob(results) {
  const uk = nowInUkParts();
  if (uk.hours !== 10 || uk.minutes >= 15) { results.push("membershipReminders: not 10am window"); return; }

  const { data, error } = await supabase.rpc("get_membership_reminders_due");
  if (error) { results.push(`membershipReminders: error — ${error.message}`); return; }
  const reminders = data?.reminders || [];
  if (!reminders.length) { results.push("membershipReminders: none due"); return; }

  // De-storm (Stripe Phase 6 #6.2): at most ONE membership reminder email per recipient
  // per tick. Sort by priority so the most actionable kind wins; a lower-priority kind for
  // the same recipient is deferred to a later tick (its notification_log row is NOT written,
  // so it still sends another day). Permanent per-(type,entity_key,recipient) dedup is
  // unchanged on top of this. (Stripe-invoiced charges never reach here — the reminder RPC
  // suppresses them so Stripe owns their dunning.)
  const KIND_PRIORITY = { payment_due: 0, renewal_due: 1, freeze_ending: 2, welcome: 3 };
  reminders.sort((a, b) => (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9));
  const emailedThisTick = new Set();

  let sent = 0, skipped = 0, throttled = 0;
  for (const r of reminders) {
    const type = `membership_${r.kind}`;
    if (await alreadyNotified(type, r.entity_key, r.email, "email")) { skipped++; continue; }
    if (emailedThisTick.has(r.email)) { throttled++; continue; }
    const ctx = {
      firstName: r.first_name || "there",
      venueName: r.venue_name,
      tierName: r.tier_name,
      amountPence: r.amount_pence,
      period: r.period,
      dateLabel: fmtUkDate(r.date_label),
      passUrl: r.pass_token ? `https://app.in-or-out.com/m/${r.pass_token}` : "",
      // #16: a charge's pay link (its Stripe hosted invoice → else the venue's generic
      // payment_link), resolved server-side. Only payment_due carries one; "" = manual nudge.
      payUrl: r.pay_url || "",
    };
    const res = await sendTemplated(type, r.email, ctx);
    if (res?.skipped === "no_api_key") { results.push("membershipReminders: skipped (RESEND_API_KEY unset)"); return; }
    if (res?.id) {
      await supabase.from("notification_log").insert({
        type, entity_id: r.entity_key, recipient: r.email, channel: "email",
      });
      emailedThisTick.add(r.email);
      sent++;
    } else if (res?.error) {
      results.push(`membershipReminders: send failed (${r.email}) — ${res.error}`);
    }
  }
  results.push(`membershipReminders: ${sent} sent, ${skipped} already-sent, ${throttled} throttled`);
}

// ── Club broadcast emails (Phase 11, mig 307) — fire immediately on every tick
// when a club_announcement is queued. No time-window gate: venue admins expect
// near-real-time delivery after hitting send.
async function clubBroadcastJob(base, results) {
  const { data, error } = await supabase.rpc("get_pending_club_broadcasts");
  if (error) { results.push(`clubBroadcast: error — ${error.message}`); return; }
  const broadcasts = data?.broadcasts || [];
  if (!broadcasts.length) { results.push("clubBroadcast: none queued"); return; }

  let totalSent = 0, totalSkipped = 0;
  for (const b of broadcasts) {
    const recipients = b.recipients || [];
    let sent = 0, skipped = 0;
    for (const r of recipients) {
      if (!r.email) continue;
      if (await alreadyNotified("club_announcement", b.announcement_id, r.email, "email")) { skipped++; continue; }
      const ctx = {
        firstName: r.first_name || "there",
        clubName: b.club_name,
        venueName: b.venue_name,
        title: b.title,
        body: b.body,
      };
      const res = await sendTemplated("club_announcement", r.email, ctx);
      if (res?.skipped === "no_api_key") { results.push("clubBroadcast: skipped (RESEND_API_KEY unset)"); return; }
      if (res?.id) {
        await supabase.from("notification_log").insert({
          type: "club_announcement", entity_id: b.announcement_id, recipient: r.email, channel: "email",
        });
        sent++;
      } else if (res?.error) {
        results.push(`clubBroadcast: send failed (${r.email}) — ${res.error}`);
      }
    }
    // Push the same announcement to members who've enabled device notifications
    // (mig 422). One POST per broadcast; covers pitch-bump proposals too (mig 417
    // _notify_bump creates a club_announcement). Best-effort — never blocks email.
    const memberProfileIds = [...new Set(recipients.map(r => r.member_profile_id).filter(Boolean))];
    if (memberProfileIds.length) {
      await callNotifyDirect(base, {
        memberProfileIds,
        announcementId: b.announcement_id,
        payload: { title: b.title, body: b.body, url: "https://app.in-or-out.com/sessions" },
      });
    }

    // Mark announcement sent regardless of per-recipient failures (partial delivery is still delivery)
    await supabase
      .from("club_announcements")
      .update({ status: "sent", email_sent_count: sent, sent_at: new Date().toISOString() })
      .eq("id", b.announcement_id);
    totalSent += sent; totalSkipped += skipped;
  }
  results.push(`clubBroadcast: ${broadcasts.length} broadcast(s) — ${totalSent} sent, ${totalSkipped} already-sent`);
}

// ── Stripe reconciliation (Phase 7) ──────────────────────────────────────────
// Webhooks are for speed; THIS is for truth (plan §resilience). Pulls the real
// subscription status from Stripe for every membership on Stripe and re-applies it
// via the state machine, repairing any drift from a dropped/out-of-order webhook.
// DORMANT (clean no-op) until STRIPE_SECRET_KEY is set.
async function membershipReconciliationJob(results) {
  const uk = nowInUkParts();
  if (uk.hours !== 4 || uk.minutes >= 15) { results.push("membershipReconciliation: not 4am window"); return; }
  if (!stripeConfigured()) { results.push("membershipReconciliation: stripe not configured"); return; }

  const { data: subs, error } = await supabase
    .from("venue_memberships")
    .select("id, stripe_subscription_id, venue_id")
    .not("stripe_subscription_id", "is", null)
    .neq("status", "cancelled");
  if (error) { results.push(`membershipReconciliation: query error — ${error.message}`); return; }
  if (!subs?.length) { results.push("membershipReconciliation: none on stripe"); return; }

  const venueIds = [...new Set(subs.map((s) => s.venue_id))];
  const { data: integrations } = await supabase.from("venue_integrations").select("venue_id, account_id").eq("provider", "stripe").eq("status", "connected").in("venue_id", venueIds);
  const acctByVenue = Object.fromEntries((integrations || []).map((vi) => [vi.venue_id, vi.account_id]));

  let checked = 0, repaired = 0;
  for (const m of subs) {
    const acct = acctByVenue[m.venue_id];
    if (!acct) continue;
    try {
      const sub = await stripeClient.subscriptions.retrieve(m.stripe_subscription_id, { stripeAccount: acct });
      await supabase.rpc("apply_membership_subscription_status", { p_subscription_id: sub.id, p_stripe_status: sub.status });
      checked++;
      // Invoice drift repair: ensure every PAID invoice for this sub has a ledger payment.
      // The invoice.paid webhook does this in real time; this is the net for a dropped one.
      // stripe_record_invoice_payment is idempotent per invoice, so re-runs are no-ops.
      const invs = await stripeClient.invoices.list(
        { subscription: m.stripe_subscription_id, status: "paid", limit: 10 },
        { stripeAccount: acct }
      );
      for (const inv of (invs.data || [])) {
        const r = await supabase.rpc("stripe_record_invoice_payment", {
          p_subscription_id: inv.subscription,
          p_invoice_id:      inv.id,
          p_charge_ref:      inv.charge || null,
          p_amount_pence:    inv.amount_paid ?? null,
          p_paid_at:         inv.status_transitions?.paid_at
                               ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
                               : new Date().toISOString(),
        });
        if (r?.data?.recorded) repaired++;
      }
    } catch (e) {
      results.push(`membershipReconciliation: sub ${m.stripe_subscription_id} — ${e.message}`);
    }
  }
  results.push(`membershipReconciliation: ${checked} reconciled, ${repaired} invoice(s) repaired`);
}

// ── GoCardless reconciliation (Phase 8) ──────────────────────────────────────
// Webhooks are for speed; THIS is for truth. For each active GC mandate, fetches
// the mandate status from the GC API and re-applies it via apply_gc_payment_status,
// repairing any drift from a dropped or out-of-order webhook.
// DORMANT (clean no-op) until GC_CLIENT_ID is set.
async function gcMembershipReconciliationJob(results) {
  const uk = nowInUkParts();
  if (uk.hours !== 4 || uk.minutes < 15 || uk.minutes >= 30) {
    results.push("gcMembershipReconciliation: not 4:15am window");
    return;
  }
  if (!isGcConfigured()) {
    results.push("gcMembershipReconciliation: gc not configured");
    return;
  }

  const { data: mems, error } = await supabase
    .from("venue_memberships")
    .select("id, gc_mandate_id, venue_id")
    .not("gc_mandate_id", "is", null)
    .neq("status", "cancelled");

  if (error) { results.push(`gcMembershipReconciliation: query error — ${error.message}`); return; }
  if (!mems?.length) { results.push("gcMembershipReconciliation: none on gc"); return; }

  const venueIds = [...new Set(mems.map((m) => m.venue_id))];
  const { data: integrations } = await supabase
    .from("venue_integrations")
    .select("venue_id, access_token")
    .eq("provider", "gocardless")
    .eq("status", "connected")
    .in("venue_id", venueIds);

  const tokenByVenue = Object.fromEntries((integrations || []).map((vi) => [vi.venue_id, vi.access_token]));

  let checked = 0;
  for (const m of mems) {
    const token = tokenByVenue[m.venue_id];
    if (!token) continue;
    try {
      const gc       = gcClient(token);
      const mandate  = await gc.get(`/mandates/${m.gc_mandate_id}`);
      const gcStatus = mandate.mandates?.status;

      // Map GC mandate status → our event-type vocabulary
      let syntheticEvent = null;
      if (gcStatus === "active")           syntheticEvent = "payments.confirmed";
      else if (gcStatus === "cancelled")   syntheticEvent = "mandates.cancelled";
      else if (gcStatus === "expired")     syntheticEvent = "mandates.expired";
      else if (gcStatus === "failed")      syntheticEvent = "mandates.failed";

      if (syntheticEvent) {
        await supabase.rpc("apply_gc_payment_status", {
          p_mandate_id:    m.gc_mandate_id,
          p_gc_event_type: syntheticEvent,
        });
        checked++;
      }
    } catch (e) {
      results.push(`gcMembershipReconciliation: mandate ${m.gc_mandate_id} — ${e.message}`);
    }
  }
  results.push(`gcMembershipReconciliation: ${checked} reconciled`);
}

// ── Superseded-booking displacement push (every tick) ────────────────────────
// Polls committed superseded rows (superseded_at set by tg_sync_fixture_occupancy).
// notification_log dedups on (teamId, 'booking_superseded', gameDate); the 20-min
// window comfortably covers the 15-min cadence.
async function supersededPushJob(base, results) {
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("pitch_bookings")
    .select("team_id, booking_date")
    .eq("status", "superseded")
    .gt("superseded_at", since)
    .not("team_id", "is", null);
  if (error) { results.push(`supersededPush: error — ${error.message}`); return; }
  if (!rows?.length) { results.push("supersededPush: none"); return; }

  const seen = new Set();
  for (const r of rows) {
    const key = `${r.team_id}|${r.booking_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await pushTeamAdmins(base, r.team_id, "booking_superseded",
      { title: "Booking bumped", body: `A league fixture took your pitch slot on ${r.booking_date}.` },
      r.booking_date);
  }
  results.push(`supersededPush: ${seen.size} team(s) notified`);
}

// ── Booking-confirmed push (every tick) ──────────────────────────────────────
// Polls audit_events for venue confirmations in the last 20 min (the committed
// "it happened" marker, hard-rule #9), joins back to the booking to get the real
// team, and pushes the team's admins. A block series confirmed as N looped
// venue_confirm_booking calls collapses to ONE push per (team, series). Dedup on
// (team_id, 'booking_confirmed', gameDate=min booking_date) via notification_log;
// the 20-min window comfortably covers the 15-min cadence.
async function confirmPushJob(base, results) {
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: events, error } = await supabase
    .from("audit_events")
    .select("entity_id")
    .eq("action", "booking_confirmed")
    .eq("entity_type", "pitch_booking")
    .gt("created_at", since);
  if (error) { results.push(`confirmPush: error — ${error.message}`); return; }
  const ids = [...new Set((events || []).map(e => e.entity_id).filter(Boolean))];
  if (!ids.length) { results.push("confirmPush: none"); return; }

  const { data: bookings, error: bErr } = await supabase
    .from("pitch_bookings")
    .select("id, team_id, series_id, booking_date")
    .in("id", ids)
    .eq("status", "confirmed")
    .not("team_id", "is", null);
  if (bErr) { results.push(`confirmPush: error — ${bErr.message}`); return; }
  if (!bookings?.length) { results.push("confirmPush: none"); return; }

  // Collapse to one push per (team, series-or-booking); track the earliest date.
  const groups = new Map();
  for (const b of bookings) {
    const key = `${b.team_id}|${b.series_id || b.id}`;
    const g = groups.get(key);
    if (!g || b.booking_date < g.gameDate) {
      groups.set(key, { teamId: b.team_id, gameDate: b.booking_date });
    }
  }

  for (const g of groups.values()) {
    await pushTeamAdmins(base, g.teamId, "booking_confirmed",
      { title: "Pitch booking confirmed", body: "The venue confirmed your pitch slot." },
      g.gameDate);
  }
  results.push(`confirmPush: ${groups.size} booking(s) notified`);
}

// ── Booking confirmation to the CUSTOMER (mig 232, every tick) ────────────────
// confirmPushJob (above) notifies the registered team's admins via web-push. This sends
// the booker's captured contact (email now via Resend; SMS-ready via _sms, no-op without
// TWILIO_*) a confirmation — covering walk-in / new customers who have no team to push.
// Reads pitch_bookings directly (catches both single rows and block series; block audits
// as 'booking_series' so an audit poll would miss it). Collapses a block to ONE message
// per series. Dedup per (type='booking_confirmation', entity_id=series||booking, recipient,
// channel) via notification_log. No-ops cleanly when RESEND_API_KEY is unset.
async function bookingConfirmEmailJob(results) {
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: bookings, error } = await supabase
    .from("pitch_bookings")
    .select("id, series_id, venue_id, playing_area_id, booking_date, kickoff_time, slot_minutes, contact_email, contact_phone")
    .eq("status", "confirmed")
    .not("contact_email", "is", null)
    .gt("created_at", since);
  if (error) { results.push(`bookingConfirmEmail: error — ${error.message}`); return; }
  if (!bookings?.length) { results.push("bookingConfirmEmail: none"); return; }

  // Collapse to one message per (series || single booking): earliest date + week count.
  const groups = new Map();
  for (const b of bookings) {
    const key = b.series_id || b.id;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, entityId: key, weeks: 1, ...b, gameDate: b.booking_date });
    } else {
      g.weeks += 1;
      if (b.booking_date < g.gameDate) { g.gameDate = b.booking_date; }
    }
  }

  // Resolve venue + pitch names once per id.
  const venueNames = {}, pitchNames = {};
  for (const g of groups.values()) {
    if (g.venue_id && venueNames[g.venue_id] === undefined) {
      const { data } = await supabase.from("venues").select("name").eq("id", g.venue_id).single();
      venueNames[g.venue_id] = data?.name || "the venue";
    }
    if (g.playing_area_id && pitchNames[g.playing_area_id] === undefined) {
      const { data } = await supabase.from("playing_areas").select("name").eq("id", g.playing_area_id).single();
      pitchNames[g.playing_area_id] = data?.name || "the pitch";
    }
  }

  let sent = 0;
  for (const g of groups.values()) {
    const ctx = {
      venueName: venueNames[g.venue_id], pitchName: pitchNames[g.playing_area_id],
      dateLabel: fmtUkDate(g.gameDate), timeLabel: String(g.kickoff_time).slice(0, 5),
      slotMinutes: g.slot_minutes || null, weeks: g.weeks,
    };
    // Email (Resend)
    if (!(await alreadyNotified("booking_confirmation", g.entityId, g.contact_email, "email"))) {
      const r = await sendTemplated("booking_confirmation", g.contact_email, ctx);
      if (r?.skipped === "no_api_key") { results.push("bookingConfirmEmail: skipped (RESEND_API_KEY unset)"); break; }
      if (r?.id) {
        await supabase.from("notification_log").insert({
          type: "booking_confirmation", entity_id: g.entityId, recipient: g.contact_email,
          channel: "email", game_date: g.gameDate,
        });
        sent++;
      } else if (r?.error) {
        results.push(`bookingConfirmEmail: send failed (${g.contact_email}) — ${r.error}`);
      }
    }
    // SMS (Twilio) — SMS-ready; no-ops cleanly until TWILIO_* is set.
    if (g.contact_phone && !(await alreadyNotified("booking_confirmation", g.entityId, g.contact_phone, "sms"))) {
      const s = await sendSmsTemplated("booking_confirmation", "sms", g.contact_phone, ctx);
      if (s?.id) {
        await supabase.from("notification_log").insert({
          type: "booking_confirmation", entity_id: g.entityId, recipient: g.contact_phone,
          channel: "sms", game_date: g.gameDate,
        });
      }
    }
  }
  results.push(`bookingConfirmEmail: ${sent} email(s)`);
}

// ── Class waitlist offer expiry (Classes Phase 4, mig 341) ───────────────────
// Drains 'offered' bookings whose claim window lapsed: each rolls to the back of
// its session's waitlist and the next waitlister is re-offered (which queues a
// fresh class_spot_offered notification_log row, drained later this tick by
// classNotificationsJob). All the work happens inside the SECURITY DEFINER RPC so
// it's atomic; this job just ticks it and logs the counts.
async function classWaitlistExpiryJob(results) {
  const { data, error } = await supabase.rpc("expire_class_waitlist_offers");
  if (error) { results.push(`classWaitlistExpiry: error — ${error.message}`); return; }
  const expired = data?.expired || 0;
  const reoffered = data?.reoffered || 0;
  results.push(`classWaitlistExpiry: ${expired} expired, ${reoffered} re-offered`);
}

// ── Class booking notifications (Classes Phase 3, mig 340) ───────────────────
// Two passes, EMAIL-only (members have no push-subscription plumbing yet — same
// posture as membershipRemindersJob). No-ops cleanly until RESEND_API_KEY is set.
//   (A) New bookings created in the last 20 min → class_booking_confirmation
//       (confirmed) or class_waitlist_joined (waitlist), deduped per booking id.
//   (B) Drains queued notification_log rows (channel IS NULL, sent_at IS NULL):
//       class_cancelled / class_instructor_changed (venue-side, mig 339) and
//       class_waitlist_promoted / class_booking_cancelled (member-side, mig 340).
// Session display fields are resolved once per id via small caches.
async function classNotificationsJob(results) {
  // Per-tick lookup caches.
  const sessionCache = {}, venueCache = {}, ctypeCache = {}, spaceCache = {};
  async function sessionInfo(id) {
    if (!id) return null;
    if (sessionCache[id] !== undefined) return sessionCache[id];
    const { data } = await supabase
      .from("venue_class_sessions")
      .select("id, venue_id, class_type_id, space_id, starts_at, price_pence")
      .eq("id", id).single();
    sessionCache[id] = data || null;
    return sessionCache[id];
  }
  async function venueName(id) {
    if (venueCache[id] === undefined) {
      const { data } = await supabase.from("venues").select("name").eq("id", id).single();
      venueCache[id] = data?.name || "the venue";
    }
    return venueCache[id];
  }
  async function className(id) {
    if (ctypeCache[id] === undefined) {
      const { data } = await supabase.from("venue_class_types").select("name").eq("id", id).single();
      ctypeCache[id] = data?.name || "your class";
    }
    return ctypeCache[id];
  }
  async function spaceName(id) {
    if (spaceCache[id] === undefined) {
      const { data } = await supabase.from("venue_spaces").select("name").eq("id", id).single();
      spaceCache[id] = data?.name || "";
    }
    return spaceCache[id];
  }
  async function ctxForSession(sess) {
    if (!sess) return null;
    const when = new Date(sess.starts_at);
    return {
      venueName: await venueName(sess.venue_id),
      className: await className(sess.class_type_id),
      spaceName: await spaceName(sess.space_id),
      dateLabel: fmtUkDate(sess.starts_at),
      timeLabel: when.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }),
    };
  }

  let noApiKey = false, confSent = 0, drainSent = 0;

  // (A) New bookings in the last 20 min.
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: fresh, error: freshErr } = await supabase
    .from("venue_class_bookings")
    .select("id, session_id, member_profile_id, status, booked_at")
    .in("status", ["confirmed", "waitlist"])
    .gt("booked_at", since);
  if (freshErr) { results.push(`classNotifications: bookings error — ${freshErr.message}`); }
  for (const bk of fresh || []) {
    const type = bk.status === "waitlist" ? "class_waitlist_joined" : "class_booking_confirmation";
    const { data: mp } = await supabase.from("member_profiles").select("email, first_name").eq("id", bk.member_profile_id).single();
    if (!mp?.email) continue;
    if (await alreadyNotified(type, bk.id, mp.email, "email")) continue;
    const base = await ctxForSession(await sessionInfo(bk.session_id));
    if (!base) continue;
    const wpos = bk.status === "waitlist"
      ? (await supabase.from("venue_class_bookings").select("waitlist_position").eq("id", bk.id).single()).data?.waitlist_position
      : null;
    const r = await sendTemplated(type, mp.email, { ...base, firstName: mp.first_name || "there", waitlistPosition: wpos });
    if (r?.skipped === "no_api_key") { noApiKey = true; break; }
    if (r?.id) {
      await supabase.from("notification_log").insert({ type, entity_id: bk.id, recipient: mp.email, channel: "email" });
      confSent++;
    } else if (r?.error) {
      results.push(`classNotifications: send failed (${mp.email}) — ${r.error}`);
    }
  }

  // (B) Drain queued class notification rows.
  if (!noApiKey) {
    const DRAIN_TYPES = ["class_cancelled", "class_instructor_changed", "class_waitlist_promoted", "class_booking_cancelled", "class_spot_offered"];
    const { data: queued, error: qErr } = await supabase
      .from("notification_log")
      .select("id, type, entity_id, recipient, queued_payload")
      .in("type", DRAIN_TYPES)
      .is("channel", null)
      .is("sent_at", null)
      .lte("queued_for", new Date().toISOString())
      .limit(200);
    if (qErr) { results.push(`classNotifications: drain error — ${qErr.message}`); }
    for (const row of queued || []) {
      if (!row.recipient) {
        await supabase.from("notification_log").update({ sent_at: new Date().toISOString(), channel: "email" }).eq("id", row.id);
        continue;
      }
      const sessId = row.queued_payload?.session_id || row.entity_id;
      const base = await ctxForSession(await sessionInfo(sessId));
      if (!base) {
        await supabase.from("notification_log").update({ sent_at: new Date().toISOString(), channel: "email" }).eq("id", row.id);
        continue;
      }
      const r = await sendTemplated(row.type, row.recipient, { ...base, reason: row.queued_payload?.reason || "" });
      if (r?.skipped === "no_api_key") { noApiKey = true; break; }
      if (r?.id || r?.skipped === "no_template") {
        await supabase.from("notification_log").update({ sent_at: new Date().toISOString(), channel: "email" }).eq("id", row.id);
        if (r?.id) drainSent++;
      } else if (r?.error) {
        results.push(`classNotifications: drain send failed (${row.recipient}) — ${r.error}`);
      }
    }
  }

  if (noApiKey) { results.push("classNotifications: skipped (RESEND_API_KEY unset)"); return; }
  results.push(`classNotifications: ${confSent} confirm/waitlist, ${drainSent} drained`);
}

// ── Class reminders (~24h before a booked class, Classes Phase 3, mig 340) ───
// Mirrors the league fixture-reminder shape: a 15-min slice of sessions starting
// ~24h out, reminding every confirmed member once (deduped per session+member via
// notification_log). Routed via pickChannel (push→email); members have no push
// contacts yet, so it falls back to email. No-ops cleanly until RESEND_API_KEY set.
async function classRemindersJob(results) {
  const now = Date.now();
  const fromISO = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const toISO   = new Date(now + 24 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString();
  const { data: sessions, error } = await supabase
    .from("venue_class_sessions")
    .select("id, venue_id, class_type_id, space_id, starts_at")
    .eq("status", "scheduled")
    .gte("starts_at", fromISO)
    .lt("starts_at", toISO);
  if (error) { results.push(`classReminders: error — ${error.message}`); return; }
  if (!sessions?.length) { results.push("classReminders: none due"); return; }

  const venueCache = {}, ctypeCache = {}, spaceCache = {};
  let sent = 0;
  for (const sess of sessions) {
    const { data: bookings } = await supabase
      .from("venue_class_bookings")
      .select("member_profile_id")
      .eq("session_id", sess.id)
      .eq("status", "confirmed");
    if (!bookings?.length) continue;

    if (venueCache[sess.venue_id] === undefined) {
      const { data } = await supabase.from("venues").select("name").eq("id", sess.venue_id).single();
      venueCache[sess.venue_id] = data?.name || "the venue";
    }
    if (ctypeCache[sess.class_type_id] === undefined) {
      const { data } = await supabase.from("venue_class_types").select("name").eq("id", sess.class_type_id).single();
      ctypeCache[sess.class_type_id] = data?.name || "your class";
    }
    if (spaceCache[sess.space_id] === undefined) {
      const { data } = await supabase.from("venue_spaces").select("name").eq("id", sess.space_id).single();
      spaceCache[sess.space_id] = data?.name || "";
    }
    const when = new Date(sess.starts_at);
    const ctx = {
      venueName: venueCache[sess.venue_id],
      className: ctypeCache[sess.class_type_id],
      spaceName: spaceCache[sess.space_id],
      dateLabel: fmtUkDate(sess.starts_at),
      timeLabel: when.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }),
    };

    for (const b of bookings) {
      const { data: mp } = await supabase.from("member_profiles").select("email, first_name").eq("id", b.member_profile_id).single();
      if (!mp?.email) continue;
      const dedupKey = `${sess.id}:${b.member_profile_id}`;
      if (await alreadyNotified("class_reminder", dedupKey, mp.email, "email")) continue;
      const channel = pickChannel("push", { email: mp.email });
      if (channel !== "email") continue; // push not wired for members yet
      const r = await sendTemplated("class_reminder", mp.email, { ...ctx, firstName: mp.first_name || "there" });
      if (r?.skipped === "no_api_key") { results.push("classReminders: skipped (RESEND_API_KEY unset)"); return; }
      if (r?.id) {
        await supabase.from("notification_log").insert({ type: "class_reminder", entity_id: dedupKey, recipient: mp.email, channel: "email" });
        sent++;
      } else if (r?.error) {
        results.push(`classReminders: send failed (${mp.email}) — ${r.error}`);
      }
    }
  }
  results.push(`classReminders: ${sent} reminder(s)`);
}

// ── Room hire notifications (Phase 5, mig 342) ───────────────────────────────
// Drains queued room_hire_* rows (channel IS NULL, sent_at IS NULL). Self-contained:
// every display field is carried in queued_payload by the RPCs (members are EMAIL-only;
// non-member enquirers have only booker_email), so no per-row DB lookup is needed.
// No-ops cleanly until RESEND_API_KEY is set.
async function roomHireNotificationsJob(results) {
  const DRAIN_TYPES = ["room_hire_requested", "room_hire_confirmed", "room_hire_cancelled"];
  const { data: queued, error } = await supabase
    .from("notification_log")
    .select("id, type, recipient, queued_payload")
    .in("type", DRAIN_TYPES)
    .is("channel", null)
    .is("sent_at", null)
    .lte("queued_for", new Date().toISOString())
    .limit(200);
  if (error) { results.push(`roomHire: drain error — ${error.message}`); return; }

  let sent = 0;
  for (const row of queued || []) {
    const p = row.queued_payload || {};
    if (!row.recipient || !p.starts_at) {
      await supabase.from("notification_log").update({ sent_at: new Date().toISOString(), channel: "email" }).eq("id", row.id);
      continue;
    }
    const when = new Date(p.starts_at);
    const ctx = {
      venueName: p.venue_name || "the venue",
      spaceName: p.space_name || "the space",
      purpose: p.purpose || "",
      reason: p.reason || "",
      price_pence: p.price_pence || 0,
      deposit_pence: p.deposit_pence || 0,
      dateLabel: fmtUkDate(p.starts_at),
      timeLabel: when.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }),
    };
    const r = await sendTemplated(row.type, row.recipient, ctx);
    if (r?.skipped === "no_api_key") { results.push("roomHire: skipped (RESEND_API_KEY unset)"); return; }
    if (r?.id || r?.skipped === "no_template") {
      await supabase.from("notification_log").update({ sent_at: new Date().toISOString(), channel: "email" }).eq("id", row.id);
      if (r?.id) sent++;
    } else if (r?.error) {
      results.push(`roomHire: send failed (${row.recipient}) — ${r.error}`);
    }
  }
  results.push(`roomHire: ${sent} sent`);
}

// ── Onboarding & ops emails (Phase 9 Cycle 9.1) ──────────────────────────────
// Polls audit_events for four onboarding actions in the last 20 min and emails the
// relevant persona via Resend (_mailer.js). Mirrors confirmPushJob. EMAIL ONLY — the
// web-push chain in notify.js is untouched. Recipients are resolved server-side with
// the service role (auth.users for team/venue admins, match_officials for refs), so no
// player-preference plumbing is needed. Dedup per (type, entity_id, recipient) where
// channel='email' via notification_log; the 20-min window covers the 15-min cadence.
// No-ops cleanly when RESEND_API_KEY is unset.
const ONBOARDING_ACTIONS = [
  "team_registration_submitted", // → venue admin
  "team_approved",               // → team admin
  "team_rejected",               // → team admin
  "fixture_ref_assigned",        // → referee (league, new assignment)
  "fixture_ref_changed",         // → referee (league, re-assignment → notify the new ref)
  "casual_ref_assigned",         // → referee (casual, new assignment)
  "casual_ref_changed",          // → referee (casual, re-assignment → notify the new ref)
  "venue_nudge_requested",       // → team admin (venue Nudge, mig 224)
];

async function authEmailsForUserIds(userIds) {
  const emails = [];
  for (const uid of userIds) {
    if (!uid) continue;
    try {
      const { data, error } = await supabase.auth.admin.getUserById(uid);
      if (!error && data?.user?.email) emails.push(data.user.email);
    } catch (e) { /* skip this admin */ }
  }
  return [...new Set(emails)];
}

async function teamAdminEmails(teamId) {
  if (!teamId) return [];
  const { data: admins } = await supabase
    .from("team_admins").select("user_id")
    .eq("team_id", teamId).is("revoked_at", null);
  const emails = await authEmailsForUserIds((admins || []).map(a => a.user_id));
  const { data: team } = await supabase.from("teams").select("admin_email").eq("id", teamId).single();
  if (team?.admin_email) emails.push(team.admin_email);
  return [...new Set(emails)];
}

async function venueAdminEmails(venueId) {
  if (!venueId) return [];
  const { data: admins } = await supabase
    .from("venue_admins").select("user_id").eq("venue_id", venueId);
  return authEmailsForUserIds((admins || []).map(a => a.user_id));
}

async function competitionName(id) {
  if (!id) return "the competition";
  const { data } = await supabase.from("competitions").select("name").eq("id", id).single();
  return data?.name || "the competition";
}

async function teamNameOf(id) {
  if (!id) return null;
  const { data } = await supabase.from("teams").select("name").eq("id", id).single();
  return data?.name || null;
}

async function refFixtureCtx(fixtureId) {
  const { data: f } = await supabase.from("fixtures")
    .select("home_team_id, away_team_id, scheduled_date, kickoff_time, ref_token, playing_area_id")
    .eq("id", fixtureId).single();
  if (!f) return { matchLabel: "your match" };
  const [h, a] = await Promise.all([teamNameOf(f.home_team_id), teamNameOf(f.away_team_id)]);
  const matchLabel = `${h || "Home"} v ${a || "Away"}`;
  const dateLabel = [f.scheduled_date, f.kickoff_time ? String(f.kickoff_time).slice(0, 5) : null]
    .filter(Boolean).join(" ");
  let venueName = null;
  if (f.playing_area_id) {
    const { data: pa } = await supabase.from("playing_areas")
      .select("venue_id").eq("id", f.playing_area_id).maybeSingle();
    if (pa?.venue_id) {
      const { data: v } = await supabase.from("venues")
        .select("name").eq("id", pa.venue_id).maybeSingle();
      venueName = v?.name || null;
    }
  }
  const link = process.env.REF_APP_URL && f.ref_token
    ? `${process.env.REF_APP_URL}/ref/${f.ref_token}` : null;
  return { matchLabel, dateLabel, venueName, link };
}

// Context for a CASUAL ref assignment (matches.ref_player_id). Casual matches
// have no opponent entity — the assignment is "ref this squad's game" — so the
// label is the squad name. Venue/kickoff come from the linked schedule row.
async function casualRefCtx(matchId) {
  const { data: mt } = await supabase.from("matches")
    .select("team_id, ref_token, match_date").eq("id", matchId).single();
  if (!mt) return { matchLabel: "your casual match" };
  const squad = await teamNameOf(mt.team_id);
  const { data: sc } = await supabase.from("schedule")
    .select("venue, game_date_time").eq("active_match_id", matchId).maybeSingle();
  const dt = sc?.game_date_time || mt.match_date || null;
  let dateLabel = null;
  if (dt) {
    try {
      dateLabel = new Date(dt).toLocaleString("en-GB", {
        timeZone: "Europe/London", weekday: "short", day: "numeric",
        month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch { dateLabel = String(dt).slice(0, 16).replace("T", " "); }
  }
  const link = process.env.REF_APP_URL && mt.ref_token
    ? `${process.env.REF_APP_URL}/ref/${mt.ref_token}` : null;
  return {
    matchLabel: squad ? `${squad} (casual)` : "your casual match",
    dateLabel, venueName: sc?.venue || null, link,
  };
}

async function alreadyEmailed(type, entityId, recipient) {
  return alreadyNotified(type, entityId, recipient, "email");
}

// Channel-agnostic dedup: true if this (type, entity, recipient, channel) already sent.
// Phase 9 SMS/WhatsApp wiring keys ref_assigned by the actual channel so an SMS send and
// an email send for the same fixture+recipient never cross-collide.
async function alreadyNotified(type, entityId, recipient, channel) {
  const { data } = await supabase
    .from("notification_log").select("id")
    .eq("type", type).eq("entity_id", entityId).eq("recipient", recipient)
    .eq("channel", channel).not("sent_at", "is", null).limit(1);
  return !!(data && data.length);
}

// True if this auth user has at least one registered push subscription (mig 422,
// keyed on auth_user_id — the /hub Profile push toggle). Used so a 'push' channel
// is only picked when it can actually land.
async function authUserHasPushSub(uid) {
  if (!uid) return false;
  const { data } = await supabase
    .from("push_subscriptions").select("id").eq("auth_user_id", uid).limit(1);
  return !!(data && data.length);
}

// Deliver a ref-assignment push via /api/notify's auth-user mode. Returns the
// count that landed (0 on any error / no live sub) so the caller can fall back.
async function callNotifyAuthUsers(base, authUserIds, payload) {
  try {
    const r = await fetch(`${base}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ authUserIds, payload }),
    });
    if (!r.ok) return 0;
    const j = await r.json().catch(() => ({}));
    return j.sent || 0;
  } catch (e) { return 0; }
}

// Route a ref-assignment notification through the referee's preferred channel
// (push→email→SMS/WhatsApp) honouring preferred_channel. Refs now have accounts
// (auto-linked, PR #133) and a /hub push toggle (mig 422), so 'push' is a live
// channel keyed on the ref's auth user_id: app-user refs get an in-app push that
// deep-links into /hub Fixtures, everyone else falls back to the existing
// email/SMS/WhatsApp contact path. SMS/WhatsApp via _sms.js (Twilio, no-op
// without TWILIO_* env); email via _mailer.js (Resend). One channel per ref — the
// picked one. notification_log is keyed per-channel so an outage on one channel
// retries next tick without blocking another. `ref` carries
// { user_id, email, phone, whatsapp_number, preferred_channel } — same shape for
// league (match_officials) and casual (players) refs. Returns false only to stop
// the whole job (email no-key).
async function dispatchRefAssigned(base, entityId, ref, ctx, results) {
  const contacts = {
    whatsapp_number: ref.whatsapp_number || null,
    phone: ref.phone || null,
    email: ref.email || null,
    push: await authUserHasPushSub(ref.user_id),
  };
  let channel = pickChannel(ref.preferred_channel || "push", contacts);
  if (!channel) { results.push("onboardingEmail: ref_assigned no contact channel"); return true; }

  // Push — the in-app channel. Deep-links into /hub Fixtures.
  if (channel === "push") {
    if (await alreadyNotified("ref_assigned", entityId, ref.user_id, "push")) return true;
    const body = `${ctx.matchLabel}`
      + (ctx.dateLabel ? ` — ${ctx.dateLabel}` : "")
      + (ctx.venueName ? ` at ${ctx.venueName}` : "")
      + ". Tap to open.";
    const sent = await callNotifyAuthUsers(base, [ref.user_id], {
      title: "You're on to referee ⚽",
      body,
      url: `${base}/hub/fixtures`,
      icon: "/icons/icon-192.png",
    });
    if (sent > 0) {
      await supabase.from("notification_log").insert({
        type: "ref_assigned", entity_id: entityId, recipient: ref.user_id, channel: "push",
      });
      results.push("onboardingEmail: ref_assigned → 1 push");
      return true;
    }
    // Sub vanished between the capability check and the send — fall back to a
    // contact channel (skip push so we don't loop).
    contacts.push = false;
    channel = pickChannel(
      ref.preferred_channel === "push" ? "email" : (ref.preferred_channel || "email"),
      contacts
    );
    if (!channel) { results.push("onboardingEmail: ref_assigned push no live sub, no fallback"); return true; }
  }

  const to = channel === "whatsapp" ? contacts.whatsapp_number
           : channel === "sms"      ? contacts.phone
           : contacts.email;
  if (!to) return true;
  if (await alreadyNotified("ref_assigned", entityId, to, channel)) return true;

  if (channel === "email") {
    return dispatchEmail("ref_assigned", entityId, [to], ctx, null, results);
  }

  // whatsapp / sms via Twilio
  const r = await sendSmsTemplated("ref_assigned", channel, to, ctx);
  if (r?.skipped === "no_credentials" || r?.skipped === "no_from") {
    results.push(`onboardingEmail: ref_assigned ${channel} skipped (${r.skipped})`);
    return true;
  }
  if (r?.id) {
    await supabase.from("notification_log").insert({
      type: "ref_assigned", entity_id: entityId, recipient: to, channel,
    });
    results.push(`onboardingEmail: ref_assigned → 1 ${channel}`);
  } else if (r?.error) {
    results.push(`onboardingEmail: ref_assigned ${channel} send failed (${to}) — ${r.error}`);
  }
  return true;
}

// Returns false if the whole job should stop (no API key); true otherwise.
async function dispatchEmail(type, entityId, recipients, ctx, teamId, results) {
  let sent = 0;
  for (const to of recipients) {
    if (!to) continue;
    if (await alreadyEmailed(type, entityId, to)) continue;
    const r = await sendTemplated(type, to, ctx);
    if (r?.skipped === "no_api_key") { results.push("onboardingEmail: skipped (RESEND_API_KEY unset)"); return false; }
    if (r?.id) {
      await supabase.from("notification_log").insert({
        type, entity_id: entityId, recipient: to, channel: "email", team_id: teamId || null,
      });
      sent++;
    } else if (r?.error) {
      results.push(`onboardingEmail: ${type} send failed (${to}) — ${r.error}`);
    }
  }
  if (sent) results.push(`onboardingEmail: ${type} → ${sent} email(s)`);
  return true;
}

async function onboardingEmailJob(base, results) {
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: events, error } = await supabase
    .from("audit_events")
    .select("action, entity_id, metadata, created_at")
    .in("action", ONBOARDING_ACTIONS)
    .gt("created_at", since);
  if (error) { results.push(`onboardingEmail: error — ${error.message}`); return; }
  if (!events?.length) { results.push("onboardingEmail: none"); return; }

  for (const ev of events) {
    const m = ev.metadata || {};
    if (ev.action === "team_registration_submitted") {
      const venueId = m.venue_id;
      const recipients = await venueAdminEmails(venueId);
      const { data: venue } = venueId
        ? await supabase.from("venues").select("venue_admin_token").eq("id", venueId).single()
        : { data: null };
      const link = process.env.VENUE_APP_URL && venue?.venue_admin_token
        ? `${process.env.VENUE_APP_URL}/venue/${venue.venue_admin_token}` : null;
      const ok = await dispatchEmail("team_registration_pending", ev.entity_id, recipients,
        { teamName: m.team_name || "A team", competitionName: await competitionName(m.competition_id), link },
        null, results);
      if (!ok) return;
    } else if (ev.action === "team_approved" || ev.action === "team_rejected") {
      const teamId = m.team_id;
      const recipients = await teamAdminEmails(teamId);
      const ok = await dispatchEmail(ev.action, ev.entity_id, recipients,
        { teamName: await teamNameOf(teamId) || "Your team",
          competitionName: await competitionName(m.competition_id),
          reason: m.reason || null },
        teamId, results);
      if (!ok) return;
    } else if (ev.action === "fixture_ref_assigned" || ev.action === "fixture_ref_changed") {
      // League ref. metadata.official_id is the NEWLY assigned official (the one to
      // notify). On a re-assignment (fixture_ref_changed) the new ref is told; the
      // outgoing ref is not (clears emit fixture_ref_cleared, which we don't dispatch).
      const officialId = m.official_id;
      if (!officialId) continue;
      const { data: off } = await supabase.from("match_officials")
        .select("email, phone, whatsapp_number, preferred_channel, user_id").eq("id", officialId).single();
      if (!off) continue;
      const ok = await dispatchRefAssigned(base, ev.entity_id, off, await refFixtureCtx(ev.entity_id), results);
      if (!ok) return;
    } else if (ev.action === "casual_ref_assigned" || ev.action === "casual_ref_changed") {
      // Casual ref — a squad player assigned to officiate a casual match
      // (matches.ref_player_id, mig 369). Players carry no email; reach is push
      // (their /hub auth user_id) with SMS fallback if a phone is captured.
      const refPlayerId = m.ref_player_id;
      if (!refPlayerId) continue;
      const { data: pl } = await supabase.from("players")
        .select("user_id, phone, notification_channel").eq("id", refPlayerId).single();
      if (!pl) continue;
      const ref = {
        user_id: pl.user_id || null,
        email: null,
        phone: pl.phone || null,
        whatsapp_number: pl.phone || null,
        preferred_channel: pl.notification_channel || "push",
      };
      const ok = await dispatchRefAssigned(base, ev.entity_id, ref, await casualRefCtx(ev.entity_id), results);
      if (!ok) return;
    } else if (ev.action === "venue_nudge_requested") {
      // Venue Nudge (mig 224). The RPC recorded the request; resolve the team's
      // admin emails server-side here (the venue never saw them) and send.
      const teamId = m.team_id;
      const recipients = await teamAdminEmails(teamId);
      const ok = await dispatchEmail("venue_nudge", ev.entity_id, recipients,
        { teamName: await teamNameOf(teamId) || "your team",
          venueName: m.venue_name || "the venue",
          template: m.template || "check_in" },
        teamId, results);
      if (!ok) return;
    }
  }
}

// ── League availability + fixture reminders (Phase 9, competitive only) ──────
// Close the loop Phase 5 left open: competitive availability reuses the casual IN/OUT
// board (players.status, Cycle 5.5) but nothing pushed the squad to respond. These two
// crons loop the `fixtures` table (not `schedule` — league fixtures have no schedule
// row) and push both squads. PUSH ONLY this cycle (the existing channel); SMS/WhatsApp
// transport (_sms.js) is built but unwired, and players have no phone captured yet.
//
// Delivery goes through /api/notify DIRECT mode (same bridge potmVotingOpenJob uses),
// which inherits the quiet-hours queue/flush backstop (league teams have
// reminders_config={}, so the default 22:00–08:00 window applies). Both crons fire in
// daytime windows (9am UK / ~2h before an evening kickoff) so quiet-hours is N/A in
// practice. Direct mode does NOT dedup, so each job guards on notification_log first
// (alreadyLogged) exactly like notify.js's cron triggers.

// notification_log dedup guard — true if this (team, type, gameDate) push already sent.
async function alreadyLogged(teamId, type, gameDate) {
  const { data } = await supabase
    .from("notification_log").select("id")
    .eq("team_id", teamId).eq("type", type).eq("game_date", gameDate)
    .not("sent_at", "is", null).limit(1);
  return !!(data && data.length);
}

// Active (not injured / not disabled) squad rows for a team — two-query pattern
// (players has no team_id column). Returns rows incl. status so callers can filter.
async function squadPlayers(teamId) {
  const { data: tps } = await supabase
    .from("team_players").select("player_id").eq("team_id", teamId);
  const ids = (tps || []).map(t => t.player_id);
  if (!ids.length) return [];
  const { data: players } = await supabase
    .from("players")
    .select("id, status, injured, disabled, phone, notification_channel, user_id, token")
    .in("id", ids);
  return (players || []).filter(p => !p.injured && !p.disabled);
}

// POST /api/notify in direct mode (handles quiet-hours queueing + injured filter + push).
async function callNotifyDirect(base, body) {
  try {
    await fetch(`${base}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify(body),
    });
  } catch (e) { /* best-effort; the job's results line records the attempt count */ }
}

// Which of these players have a push subscription on this team.
async function pushSubPlayerIds(teamId, playerIds) {
  if (!playerIds.length) return new Set();
  const { data } = await supabase
    .from("push_subscriptions").select("player_id")
    .eq("team_id", teamId).in("player_id", playerIds);
  return new Set((data || []).map(r => r.player_id));
}

async function emailForUser(userId) {
  if (!userId) return null;
  const arr = await authEmailsForUserIds([userId]);
  return arr[0] || null;
}

// Phase 9 finish — route a competitive reminder across each player's preferred channel
// (push→email→SMS fallback via pickChannel). Push players go through /api/notify (which
// owns quiet-hours + per-player logging); email via _mailer, sms/whatsapp via _sms, each
// logged to notification_log with its channel. The caller's side-level alreadyLogged guard
// means this runs once per (team,type,date), so no per-player dedup is needed. Players with
// no reachable channel are silently skipped (same as the old push-only path). Returns the
// per-channel counts for the results line.
async function dispatchReminder(base, teamId, type, players, ctx, payload, gameDate) {
  const ids = players.map(p => p.id);
  const subbed = await pushSubPlayerIds(teamId, ids);
  const pushIds = [];
  const counts = { push: 0, email: 0, sms: 0, whatsapp: 0, none: 0 };
  for (const p of players) {
    const pref = p.notification_channel || "push";
    const contacts = { whatsapp_number: p.phone, phone: p.phone, email: null, push: subbed.has(p.id) };
    if (pref === "email" || !contacts.push) contacts.email = await emailForUser(p.user_id);
    const ch = pickChannel(pref, contacts);
    if (ch === "push") { pushIds.push(p.id); counts.push++; continue; }
    if (!ch) { counts.none++; continue; }
    const link = p.token ? `https://app.in-or-out.com/p/${p.token}` : "";
    const tctx = { ...ctx, link };
    let r;
    if (ch === "email") r = await sendTemplated(type, contacts.email, tctx);
    else r = await sendSmsTemplated(type, ch, p.phone, tctx);
    if (r?.id) {
      counts[ch]++;
      await supabase.from("notification_log").insert({
        team_id: teamId, player_id: p.id, type, game_date: gameDate,
        channel: ch, recipient: ch === "email" ? contacts.email : p.phone,
        sent_at: new Date().toISOString(),
      });
    }
  }
  if (pushIds.length) {
    await callNotifyDirect(base, { type, teamId, playerIds: pushIds, gameDate, payload });
  }
  return counts;
}

const FIXTURE_REMINDER_STATES = ["scheduled", "allocated"];

// availabilityRequestJob — 48h out, 9am UK window. Asks the full active squad of both
// teams to mark availability (players.status) for the upcoming league fixture.
async function availabilityRequestJob(base, results) {
  const uk = nowInUkFull();
  if (uk.hours !== 9 || uk.minutes >= 15) { results.push("availabilityRequest: not 9am window"); return; }
  const targetDate = addDaysIso(uk.date, 2);

  const { data: fixtures, error } = await supabase
    .from("fixtures")
    .select("id, home_team_id, away_team_id, scheduled_date")
    .in("status", FIXTURE_REMINDER_STATES)
    .eq("scheduled_date", targetDate);
  if (error) { results.push(`availabilityRequest: error — ${error.message}`); return; }
  if (!fixtures?.length) { results.push(`availabilityRequest: no fixtures on ${targetDate}`); return; }

  let pushed = 0;
  for (const fx of fixtures) {
    const sides = [
      { teamId: fx.home_team_id, oppId: fx.away_team_id },
      { teamId: fx.away_team_id, oppId: fx.home_team_id },
    ];
    for (const side of sides) {
      if (!side.teamId) continue; // bye (away_team_id NULL)
      if (await alreadyLogged(side.teamId, "leagueAvailability48h", fx.scheduled_date)) continue;
      const players = await squadPlayers(side.teamId);
      if (!players.length) continue;
      const opponent = (await teamNameOf(side.oppId)) || "your opponent";
      const dateLabel = fmtUkDate(fx.scheduled_date);
      await dispatchReminder(base, side.teamId, "leagueAvailability48h", players,
        { opponent, dateLabel },
        {
          title: "Are you in? ⚽",
          body: `League fixture vs ${opponent} on ${dateLabel} — mark in or out.`,
          icon: "/icons/icon-192.png",
        },
        fx.scheduled_date);
      pushed++;
    }
  }
  results.push(`availabilityRequest: ${pushed} squad(s) pushed (${targetDate})`);
}

// fixtureReminderJob — ~2h before kickoff. Nudges only still-unmarked players
// (status='none') on each team of a competitive fixture playing today.
async function fixtureReminderJob(base, results) {
  const uk = nowInUkFull();
  const { data: fixtures, error } = await supabase
    .from("fixtures")
    .select("id, home_team_id, away_team_id, scheduled_date, kickoff_time")
    .in("status", FIXTURE_REMINDER_STATES)
    .eq("scheduled_date", uk.date)
    .not("kickoff_time", "is", null);
  if (error) { results.push(`fixtureReminder: error — ${error.message}`); return; }
  if (!fixtures?.length) { results.push("fixtureReminder: no fixtures today"); return; }

  let pushed = 0;
  for (const fx of fixtures) {
    const [kh, km] = String(fx.kickoff_time).split(":").map(Number);
    const minsToKick = (kh * 60 + km) - uk.minsOfDay;
    if (minsToKick <= 105 || minsToKick > 135) continue; // ~2h ± the 15-min cadence

    const sides = [
      { teamId: fx.home_team_id, oppId: fx.away_team_id },
      { teamId: fx.away_team_id, oppId: fx.home_team_id },
    ];
    for (const side of sides) {
      if (!side.teamId) continue;
      if (await alreadyLogged(side.teamId, "leagueFixtureReminder2h", fx.scheduled_date)) continue;
      const unmarked = (await squadPlayers(side.teamId)).filter(p => p.status === "none");
      if (!unmarked.length) continue;
      const opponent = (await teamNameOf(side.oppId)) || "your opponent";
      const dateLabel = fmtUkDate(fx.scheduled_date);
      await dispatchReminder(base, side.teamId, "leagueFixtureReminder2h", unmarked,
        { opponent, dateLabel },
        {
          title: "Last call ⚽",
          body: `Kickoff vs ${opponent} in 2 hours — are you in? Mark in or out now.`,
          icon: "/icons/icon-192.png",
        },
        fx.scheduled_date);
      pushed++;
    }
  }
  results.push(`fixtureReminder: ${pushed} squad(s) reminded`);
}

// ── HQ weekly digest (Phase 9 finish — rides Phase 6) ────────────────────────
// A per-company "state of the group" email for super_admins, covering the previous
// complete week (Mon–Sun). Template-first (the AI narration of this same dataset rides
// Phase 7). Data comes from the service-role hq_get_analytics_for_company RPC (mig 190);
// the auth-gated hq_get_analytics can't be called from a JWT-less cron. EMAIL ONLY.
// Cadence: fires once on Monday 08:00 UK (one 15-min window); notification_log keyed by
// company_id:weekStart dedups within the window and resets next week. No-op safe without
// RESEND_API_KEY (dispatchEmail short-circuits).
const DIGEST_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function digestDayParts(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return { day: d.getUTCDate(), mon: DIGEST_MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() };
}
function digestWeekLabel(fromIso, toIso) {
  const a = digestDayParts(fromIso), b = digestDayParts(toIso);
  if (a.mon === b.mon && a.year === b.year) return `${a.day}–${b.day} ${b.mon} ${b.year}`;
  if (a.year === b.year) return `${a.day} ${a.mon} – ${b.day} ${b.mon} ${b.year}`;
  return `${a.day} ${a.mon} ${a.year} – ${b.day} ${b.mon} ${b.year}`;
}

async function weeklyDigestJob(results) {
  const uk = nowInUkParts();
  if (uk.dayName !== "Monday" || uk.hours !== 8 || uk.minutes >= 15) {
    results.push("weeklyDigest: not in window");
    return;
  }
  const today = nowInUkFull().date;          // Monday (UK)
  const weekStart = addDaysIso(today, -7);   // previous Monday
  const weekEnd = addDaysIso(today, -1);     // previous Sunday
  const weekLabel = digestWeekLabel(weekStart, weekEnd);

  const { data: companies, error } = await supabase
    .from("companies").select("id, name").eq("active", true);
  if (error) { results.push(`weeklyDigest: error — ${error.message}`); return; }
  if (!companies?.length) { results.push("weeklyDigest: no active companies"); return; }

  let sentCompanies = 0;
  for (const co of companies) {
    const { data: admins } = await supabase
      .from("company_admins").select("user_id")
      .eq("company_id", co.id).eq("role", "super_admin");
    const recipients = await authEmailsForUserIds((admins || []).map(a => a.user_id));
    if (!recipients.length) continue;

    const { data: a, error: rpcErr } = await supabase.rpc("hq_get_analytics_for_company", {
      p_company_id: co.id, p_date_from: weekStart, p_date_to: weekEnd,
    });
    if (rpcErr) { results.push(`weeklyDigest: ${co.id} rpc error — ${rpcErr.message}`); continue; }

    const ov = a?.overview || {};
    const rev = a?.revenue || {};
    const venueComp = Array.isArray(a?.venue_comparison) ? a.venue_comparison : [];
    const scorers = Array.isArray(a?.top_scorers) ? a.top_scorers : [];
    const ctx = {
      companyName: co.name,
      weekLabel,
      venues: ov.venues || 0,
      fixturesCompleted: ov.fixtures_completed || 0,
      fixturesRemaining: ov.fixtures_remaining || 0,
      totalGoals: ov.total_goals || 0,
      revenue: {
        collectedPence: rev.collected_pence || 0,
        owedPence: rev.owed_pence || 0,
        outstandingPence: rev.outstanding_pence || 0,
        rate: rev.collection_rate ?? null,
      },
      incidents: a?.incidents || {},
      topVenues: venueComp.slice(0, 8).map(v => ({ venue: v.venue, completionPct: v.completion_pct ?? null })),
      topScorer: scorers.length ? { player: scorers[0].player, goals: scorers[0].goals } : null,
      link: process.env.HQ_APP_URL || null,
    };

    const entityId = `${co.id}:${weekStart}`;
    const ok = await dispatchEmail("hqWeeklyDigest", entityId, recipients, ctx, null, results);
    if (!ok) return; // RESEND_API_KEY unset — stop the whole job
    sentCompanies++;
  }
  results.push(`weeklyDigest: processed ${sentCompanies} company digest(s)`);
}

// ── Casual-app ops usage digest (mig 234) ────────────────────────────────────
// Operator-only "is the app being used?" email — real squads only (demo + dc seeds are
// stripped inside get_ops_usage_digest). Two cadences share one morning slot so the
// operator gets exactly one email a day: daily fires Tue–Sun, weekly fires Monday.
// Recipient: OPS_DIGEST_EMAIL (falls back to the operator's address). notification_log
// keyed by the window date dedups within the 08:00 window and resets next window. EMAIL
// ONLY; no-op safe without RESEND_API_KEY (dispatchEmail short-circuits).
const OPS_DIGEST_TO = process.env.OPS_DIGEST_EMAIL || "tarnysingh@gmail.com";

async function fetchOpsDigest(from, to, prevFrom, prevTo) {
  const { data, error } = await supabase.rpc("get_ops_usage_digest", {
    p_from: from, p_to: to, p_prev_from: prevFrom, p_prev_to: prevTo,
  });
  if (error) { return { _error: error.message }; }
  return data;
}

// Shared ctx (daily + weekly) from the get_ops_usage_digest jsonb shape.
function opsCtxBase(d, dateLabel) {
  const sq = d.squads || {}, pl = d.players || {}, ac = d.activity || {};
  return {
    dateLabel,
    squadsActive: sq.active || 0,
    squadsTotal: sq.total || 0,
    newSquads: Array.isArray(sq.new) ? sq.new : [],
    newPlayers: pl.new || 0,
    disabled: pl.disabled_in_window || 0,
    deleted: pl.deleted_in_window || 0,
    activePlayers: ac.active_players || 0,
    totalEvents: ac.total_events || 0,
    availabilityMarks: ac.availability_marks || 0,
    newAndQuiet: Array.isArray(d.new_and_quiet) ? d.new_and_quiet : [],
  };
}

async function opsDailyDigestJob(results, force = false) {
  const uk = nowInUkParts();
  // Monday morning belongs to the weekly roll-up; the daily covers Tue–Sun.
  if (!force && (uk.hours !== 8 || uk.minutes >= 15 || uk.dayName === "Monday")) {
    results.push("opsDailyDigest: not in window");
    return;
  }
  const today = nowInUkFull().date;
  const day = addDaysIso(today, -1); // yesterday (UK)
  const d = await fetchOpsDigest(day, day, null, null);
  if (!d || d._error) { results.push(`opsDailyDigest: rpc error — ${d?._error || "no data"}`); return; }
  const ctx = opsCtxBase(d, fmtUkDate(day));
  const ok = await dispatchEmail("opsDailyDigest", `ops_daily:${day}`, [OPS_DIGEST_TO], ctx, null, results);
  results.push(ok ? "opsDailyDigest: processed" : "opsDailyDigest: skipped (RESEND_API_KEY unset)");
}

async function opsWeeklyDigestJob(results, force = false) {
  const uk = nowInUkParts();
  if (!force && (uk.dayName !== "Monday" || uk.hours !== 8 || uk.minutes >= 15)) {
    results.push("opsWeeklyDigest: not in window");
    return;
  }
  const today = nowInUkFull().date;          // Monday (UK)
  const weekStart = addDaysIso(today, -7);   // previous Monday
  const weekEnd = addDaysIso(today, -1);     // previous Sunday
  const prevStart = addDaysIso(today, -14);  // the Monday before that
  const prevEnd = addDaysIso(today, -8);     // the Sunday before that
  const weekLabel = digestWeekLabel(weekStart, weekEnd);
  const d = await fetchOpsDigest(weekStart, weekEnd, prevStart, prevEnd);
  if (!d || d._error) { results.push(`opsWeeklyDigest: rpc error — ${d?._error || "no data"}`); return; }
  const ctx = {
    ...opsCtxBase(d, weekLabel),
    weekLabel,
    activePlayersPrev: d.prev?.active_players || 0,
    totalEventsPrev: d.prev?.total_events || 0,
    dormancy: Array.isArray(d.dormancy) ? d.dormancy : [],
  };
  const ok = await dispatchEmail("opsWeeklyDigest", `ops_weekly:${weekStart}`, [OPS_DIGEST_TO], ctx, null, results);
  results.push(ok ? "opsWeeklyDigest: processed" : "opsWeeklyDigest: skipped (RESEND_API_KEY unset)");
}

// ── Demo player reset ─────────────────────────────────────────────────────────
const DEMO_BASELINE = [
  { id:"p_demo_01", goals:18, motm:6,  attended:20, w:13, l:5, d:2, bib_count:2, pay_count:20, late_dropouts:1, owes:0,  injured:false },
  { id:"p_demo_02", goals:8,  motm:9,  attended:19, w:12, l:5, d:2, bib_count:3, pay_count:18, late_dropouts:2, owes:0,  injured:false },
  { id:"p_demo_03", goals:6,  motm:3,  attended:18, w:11, l:5, d:2, bib_count:8, pay_count:16, late_dropouts:3, owes:0,  injured:false },
  { id:"p_demo_04", goals:4,  motm:2,  attended:22, w:14, l:6, d:2, bib_count:1, pay_count:22, late_dropouts:0, owes:0,  injured:false },
  { id:"p_demo_05", goals:3,  motm:1,  attended:12, w:7,  l:3, d:2, bib_count:1, pay_count:10, late_dropouts:5, owes:0,  injured:false },
  { id:"p_demo_06", goals:5,  motm:1,  attended:16, w:10, l:4, d:2, bib_count:2, pay_count:12, late_dropouts:7, owes:0,  injured:false },
  { id:"p_demo_07", goals:3,  motm:2,  attended:20, w:13, l:5, d:2, bib_count:3, pay_count:19, late_dropouts:1, owes:0,  injured:false },
  { id:"p_demo_08", goals:4,  motm:1,  attended:17, w:10, l:5, d:2, bib_count:2, pay_count:10, late_dropouts:3, owes:15, injured:false },
  { id:"p_demo_09", goals:7,  motm:3,  attended:15, w:8,  l:5, d:2, bib_count:2, pay_count:14, late_dropouts:2, owes:0,  injured:false },
  { id:"p_demo_10", goals:0,  motm:0,  attended:22, w:14, l:6, d:2, bib_count:4, pay_count:22, late_dropouts:0, owes:0,  injured:false },
  { id:"p_demo_11", goals:2,  motm:0,  attended:10, w:6,  l:3, d:1, bib_count:1, pay_count:10, late_dropouts:1, owes:0,  injured:false },
  { id:"p_demo_12", goals:4,  motm:1,  attended:8,  w:5,  l:2, d:1, bib_count:1, pay_count:8,  late_dropouts:0, owes:0,  injured:false },
  { id:"p_demo_13", goals:3,  motm:1,  attended:14, w:9,  l:4, d:1, bib_count:2, pay_count:13, late_dropouts:2, owes:0,  injured:false },
  { id:"p_demo_14", goals:1,  motm:0,  attended:8,  w:5,  l:2, d:1, bib_count:0, pay_count:6,  late_dropouts:1, owes:0,  injured:false },
  { id:"p_demo_15", goals:11, motm:4,  attended:18, w:11, l:5, d:2, bib_count:2, pay_count:17, late_dropouts:1, owes:0,  injured:false },
  { id:"p_demo_16", goals:6,  motm:2,  attended:20, w:13, l:5, d:2, bib_count:1, pay_count:20, late_dropouts:0, owes:0,  injured:false },
  { id:"p_demo_17", goals:5,  motm:2,  attended:14, w:8,  l:4, d:2, bib_count:2, pay_count:12, late_dropouts:3, owes:0,  injured:false },
  { id:"p_demo_18", goals:3,  motm:1,  attended:13, w:8,  l:3, d:2, bib_count:1, pay_count:10, late_dropouts:5, owes:0,  injured:false },
  { id:"p_demo_19", goals:14, motm:3,  attended:16, w:10, l:4, d:2, bib_count:1, pay_count:15, late_dropouts:1, owes:0,  injured:false },
  { id:"p_demo_20", goals:7,  motm:2,  attended:18, w:12, l:4, d:2, bib_count:2, pay_count:17, late_dropouts:1, owes:0,  injured:false },
  { id:"p_demo_21", goals:5,  motm:2,  attended:17, w:10, l:5, d:2, bib_count:3, pay_count:16, late_dropouts:2, owes:0,  injured:false },
  { id:"p_demo_22", goals:4,  motm:1,  attended:16, w:11, l:3, d:2, bib_count:2, pay_count:15, late_dropouts:1, owes:0,  injured:false },
  { id:"p_demo_23", goals:3,  motm:1,  attended:19, w:12, l:5, d:2, bib_count:1, pay_count:19, late_dropouts:0, owes:0,  injured:false },
  { id:"p_demo_24", goals:4,  motm:1,  attended:11, w:7,  l:3, d:1, bib_count:1, pay_count:10, late_dropouts:2, owes:0,  injured:false },
  { id:"p_demo_25", goals:6,  motm:2,  attended:18, w:11, l:5, d:2, bib_count:1, pay_count:18, late_dropouts:1, owes:0,  injured:false },
];

async function resetDemoPlayers() {
  const injuredSince = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  for (const p of DEMO_BASELINE) {
    await supabase.from("players").update({
      status: "none", paid: false, self_paid: false, paid_by: null, owes: p.owes,
      goals: p.goals, motm: p.motm, attended: p.attended,
      w: p.w, l: p.l, d: p.d, bib_count: p.bib_count,
      pay_count: p.pay_count, late_dropouts: p.late_dropouts,
      injured: p.injured, injured_since: p.injured ? injuredSince : null,
    }).eq("id", p.id);
  }
  await supabase.from("demo_sessions")
    .update({ last_reset: new Date().toISOString() })
    .eq("id", "main");
}
