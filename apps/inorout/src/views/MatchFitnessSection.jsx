// MatchFitnessSection — the player's OWN Apple Watch match-fitness glance inside StatsView
// (Match Fitness Stats epic, PR #3). Reads getMyMatchHealth() (authenticated-only, all-time
// sessions) and buckets client-side by the shared month|season|all period selector, showing
// own totals: Matches / Distance / Calories / Avg HR.
//
// Self-hides when the player has no sessions in the period (or isn't signed in) — so it is
// dark-by-emptiness in prod until VITE_HEALTH_KIT_ENABLED flips and real attaches land (display
// gates on has-data, not on the flag; per the epic KEY AUDIT FACTS). PR #4 adds the trend graph
// + baseline + fittest-match hero inside this same section.

import { useEffect, useState } from "react";
import { Lightning } from "@phosphor-icons/react";
import { getMyMatchHealth } from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";
import { formatDistance } from "../lib/formatDistance.js";

// Period cutoff → "YYYY-MM-DD" or null (all-time). Mirrors StatsView's own cutoff logic so the
// fitness glance moves in lockstep with the league table's period pill.
function periodCutoff(period) {
  const now = new Date();
  if (period === "month")  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  if (period === "season") return `${now.getFullYear()}-01-01`;
  return null; // "all"
}

function Stat({ label, value }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 64 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--gold)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function MatchFitnessSection({ period = "season" }) {
  const [sessions, setSessions] = useState(null); // null = loading; [] = none / unavailable

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // get_my_match_health is authenticated-only — token/anon viewers skip the call and
        // self-hide rather than firing a request that 403s.
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (!session) { if (alive) setSessions([]); return; }
        const res = await getMyMatchHealth();
        if (alive) setSessions(Array.isArray(res?.sessions) ? res.sessions : []);
      } catch (e) {
        console.error("[health] get_my_match_health failed", e);
        if (alive) setSessions([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (sessions === null) return null;      // loading
  if (sessions.length === 0) return null;  // not signed in / no data / unavailable

  const cutoff   = periodCutoff(period);
  const inPeriod = sessions.filter(s => s.started_at && (!cutoff || s.started_at.slice(0, 10) >= cutoff));
  if (inPeriod.length === 0) return null;  // nothing this period → self-hide

  const totalMeters = inPeriod.reduce((sum, s) => sum + (s.distance_meters   || 0), 0);
  const totalKcal   = inPeriod.reduce((sum, s) => sum + (s.active_energy_kcal || 0), 0);
  const hrVals      = inPeriod.map(s => s.avg_hr).filter(v => v > 0);
  const avgHr       = hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : null;

  const distanceText = formatDistance(totalMeters) || "—";
  const kcalText     = totalKcal > 0 ? Math.round(totalKcal).toLocaleString() : "—";
  const hrText       = avgHr ? `${avgHr}` : "—";

  return (
    <div style={{ padding: 16, borderRadius: 12, background: "var(--s2)", border: "0.5px solid var(--b2)", marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Lightning size={20} weight="thin" color="var(--gold)" />
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em", color: "var(--t1)" }}>
          MATCH FITNESS
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Stat label="Matches"  value={inPeriod.length} />
        <Stat label="Distance" value={distanceText} />
        <Stat label="Calories" value={kcalText} />
        <Stat label="Avg HR"   value={hrText} />
      </div>
    </div>
  );
}
