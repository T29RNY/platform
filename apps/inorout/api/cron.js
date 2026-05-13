// /api/cron.js — runs every 15 minutes via pg_cron → pg_net or Vercel Cron
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, VERCEL_URL

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  const secret = req.headers["authorization"]?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = [];
  const base    = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

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
    const kickoff = new Date(sched.game_date_time);
    if (now < kickoff) { results.push(`lineupLock: ${sched.team_id} not yet`); continue; }

    // Get players who are "in"
    const { data: players } = await supabase
      .from("players")
      .select("id, name, team, is_guest")
      .eq("team_id", sched.team_id)
      .eq("status", "in")
      .eq("disabled", false);
    if (!players?.length) { results.push(`lineupLock: ${sched.team_id} no players`); continue; }

    const matchId = sched.active_match_id || ("m_" + Math.random().toString(36).slice(2, 12));

    // Create stub match row if needed
    if (!sched.active_match_id) {
      await supabase.from("matches").upsert({
        id: matchId, team_id: sched.team_id,
        date: now.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }),
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
    const kickoff = new Date(sched.game_date_time);
    const votingStartsAt = new Date(kickoff.getTime() + 60 * 60 * 1000);
    if (now < votingStartsAt) { results.push(`potmVotingOpen: ${sched.team_id} not yet`); continue; }

    // Get eligible voters from player_match
    const { data: pm } = await supabase
      .from("player_match")
      .select("player_id, players(id, name, token)")
      .eq("match_id", sched.active_match_id)
      .eq("attended", true)
      .eq("is_guest", false);
    if (!pm?.length || pm.length < 3) {
      results.push(`potmVotingOpen: ${sched.team_id} not enough players (${pm?.length || 0})`);
      continue;
    }

    const closesAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

    // Update matches table
    await supabase.from("matches").update({
      voting_open: true, voting_closes_at: closesAt, total_voters: pm.length,
    }).eq("id", sched.active_match_id);

    // Denormalize onto schedule for realtime propagation
    await supabase.from("schedule").update({
      voting_open: true, voting_closes_at: closesAt,
    }).eq("id", sched.id);

    // Send push notification
    const playerIds = pm.map(r => r.player_id);
    try {
      await fetch(`${base}/api/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
        body: JSON.stringify({
          type: "potmVotingOpen", teamId: sched.team_id, playerIds,
          payload: { title: "Vote for POTM 🏆", body: "Who was the best player tonight? You've got 60 minutes." },
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
      // No votes — mark pending for admin
      await supabase.from("matches").update({
        voting_open: false, admin_decision_pending: true,
      }).eq("id", match.id);
      await supabase.from("schedule").update({ voting_open: false }).eq("team_id", match.team_id);
      results.push(`potmTally: ${match.id} no votes, admin pending`);
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
      // Close voting and set winner
      await supabase.from("matches").update({
        voting_open: false, motm: winnerId, was_admin_decided: false,
      }).eq("id", match.id);
      await supabase.from("player_match").update({ was_motm: true })
        .eq("match_id", match.id).eq("player_id", winnerId);
      await supabase.from("players").update({ motm: supabase.rpc ? undefined : undefined })
        .eq("id", winnerId);
      // Increment motm on players using raw SQL increment
      await supabase.rpc("increment_player_motm", { p_id: winnerId }).catch(() => {
        supabase.from("players").select("motm").eq("id", winnerId).single()
          .then(({ data }) => {
            if (data) supabase.from("players").update({ motm: (data.motm || 0) + 1 }).eq("id", winnerId);
          });
      });

      await supabase.from("schedule").update({ voting_open: false }).eq("team_id", match.team_id);

      // Get winner name + all attended player_ids for push
      const { data: winnerRow } = await supabase.from("players").select("name").eq("id", winnerId).single();
      const winnerName = winnerRow?.name || "Unknown";
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
      results.push(`potmTally: ${match.id} winner ${winnerName}`);
    }
  }
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
      status: "none", paid: false, self_paid: false, owes: p.owes,
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
