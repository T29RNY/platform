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

  res.json({ ok: true, ts: new Date().toISOString(), results });
};

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
  { id:"p_demo_13", goals:3,  motm:1,  attended:14, w:9,  l:4, d:1, bib_count:2, pay_count:13, late_dropouts:2, owes:0,  injured:true  },
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
  { id:"p_demo_24", goals:5,  motm:1,  attended:15, w:9,  l:4, d:2, bib_count:2, pay_count:13, late_dropouts:4, owes:0,  injured:false },
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
