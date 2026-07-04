// MatchFitnessSection — the player's OWN Apple Watch match-fitness section inside StatsView
// (Match Fitness Stats epic, PR #3 + PR #4). Reads getMyMatchHealth() (authenticated-only,
// all-time sessions) and buckets client-side by the shared month|season|all period selector.
//
//   PR #3: own totals glance — Matches / Distance / Calories / Avg HR.
//   PR #4: a hand-rolled SVG trend graph of per-match avg-HR (toggle → distance) with a dashed
//          rolling baseline (green segment = trending fitter, gold = not), a "fittest match" hero
//          and a "most active month" badge. All client-side from data we already have — no backend.
//
// Self-hides when the player has no sessions in the period (or isn't signed in) — so it is
// dark-by-emptiness in prod until VITE_HEALTH_KIT_ENABLED flips and real attaches land (display
// gates on has-data, not on the flag; per the epic KEY AUDIT FACTS).
//
// SVG colour discipline (mirrors components/MatchRouteHeatmap.jsx): CSS-var colours can't live in
// an SVG stroke/fill ATTRIBUTE, so colour is driven via `currentColor` (a CSS var on the <svg>
// style) or an inline `style={{ stroke/fill: 'var(--…)' }}` — never a raw hex, never a CSS var in
// the attribute itself.

import { useEffect, useState } from "react";
import { Lightning, Trophy, TrendUp, UsersThree } from "@phosphor-icons/react";
import { getMyMatchHealth, getSquadFitnessLeaderboard } from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";
import { formatDistance } from "../lib/formatDistance.js";

// Period cutoff → "YYYY-MM-DD" or null (all-time). Mirrors StatsView's own cutoff logic so the
// fitness section moves in lockstep with the league table's period pill.
function periodCutoff(period) {
  const now = new Date();
  if (period === "month")  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  if (period === "season") return `${now.getFullYear()}-01-01`;
  return null; // "all"
}

// Under this many points a metric shows only a bare sparkline (no baseline / no trend claim);
// single stop-start five-a-sides are noisy, so a trend needs a few games (LOCKED DECISION #5).
const TREND_MIN = 5;

function fmtShortDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  catch { return ""; }
}
function fmtMonthLabel(ym) {
  // ym = "YYYY-MM"; render "Mon YYYY". Parse as UTC-noon to avoid any TZ month slip.
  try { return new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }); }
  catch { return ym; }
}

// Short month tick for the trend x-axis, e.g. "2026-04-14T…" → "Apr".
function fmtMonthTick(iso) {
  if (!iso) return "";
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[Number(iso.slice(5, 7))] || "";
}

function Stat({ label, value }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 64 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--gold)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

// Hand-rolled sparkline + rolling baseline. `points` = [{ v, date }] ascending, all v > 0.
// `metric` = "hr" | "distance" (drives which direction counts as "fitter" for the baseline
// segment colour: HR down = fitter, distance up = fitter). `withBaseline` gates the trend overlay.
function TrendGraph({ points, metric, withBaseline }) {
  const W = 100, H = 40, PAD = 4;
  const n = points.length;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  const x = (idx) => PAD + (n === 1 ? 0.5 : idx / (n - 1)) * (W - 2 * PAD);
  const y = (v) => PAD + (1 - (v - min) / range) * (H - 2 * PAD);

  const linePath = points.map((p, k) => `${k === 0 ? "M" : "L"}${x(k).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");

  // Rolling baseline: trailing mean over a small window → smooths the per-match noise.
  let segs = [];
  if (withBaseline && n >= 2) {
    const win = Math.min(4, n);
    const base = points.map((_, k) => {
      const slice = vals.slice(Math.max(0, k - win + 1), k + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
    for (let k = 1; k < n; k++) {
      const fitter = metric === "hr" ? base[k] < base[k - 1] : base[k] > base[k - 1];
      segs.push({ x1: x(k - 1), y1: y(base[k - 1]), x2: x(k), y2: y(base[k]), fitter });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="76"
      preserveAspectRatio="none"
      style={{ display: "block", color: "var(--gold)" }}
      role="img"
      aria-label="Match fitness trend"
    >
      {segs.map((s, k) => (
        <line
          key={k}
          x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.75"
          style={{ stroke: s.fitter ? "var(--green)" : "var(--gold)" }}
        />
      ))}
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" opacity="0.35" />
      {points.map((p, k) => (
        <circle key={k} cx={x(k)} cy={y(p.v)} r="1.4" style={{ fill: "var(--gold)" }} />
      ))}
    </svg>
  );
}

function MetricPill({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px", borderRadius: "var(--r-pill, 999px)", cursor: "pointer",
        fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 500,
        border: `0.5px solid ${active ? "var(--gold)" : "var(--b2)"}`,
        background: active ? "var(--gold2, rgba(232,160,32,0.12))" : "transparent",
        color: active ? "var(--gold)" : "var(--t2)",
      }}
    >
      {label}
    </button>
  );
}

// One squad-board row. Own row is gold-highlighted. Members with no watch data are framed as an
// invitation, never a blank/zero row (LOCKED DECISION #7 — a watch-less regular is still one of us).
// most_improved_pct is HR-trend (positive = fitter); shown only when positive, never as a demotion.
function SquadRow({ row }) {
  const isSelf  = !!row.is_self;
  const hasData = (row.games || 0) > 0;
  const improved = row.most_improved_pct != null && row.most_improved_pct > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: "0.5px solid var(--b2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontFamily: "DM Sans, sans-serif", color: isSelf ? "var(--gold)" : "var(--t1)", fontWeight: isSelf ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {isSelf ? "You" : (row.player_name || "Player")}
        </span>
        {improved && (
          <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10, color: "var(--green)", fontFamily: "DM Sans, sans-serif", flexShrink: 0 }}>
            <TrendUp size={11} weight="thin" />{row.most_improved_pct}% fitter
          </span>
        )}
      </div>
      {hasData ? (
        <span style={{ fontSize: 12, color: "var(--t2)", fontFamily: "DM Sans, sans-serif", flexShrink: 0 }}>
          {formatDistance(row.avg_distance) || "—"} avg{row.avg_hr ? ` · ${row.avg_hr} HR` : ""}
        </span>
      ) : (
        <span style={{ fontSize: 11, color: "var(--t2)", fontStyle: "italic", fontFamily: "DM Sans, sans-serif", flexShrink: 0 }}>
          Add an Apple Watch to join
        </span>
      )}
    </div>
  );
}

export default function MatchFitnessSection({ period = "season", teamId = null }) {
  const [sessions, setSessions] = useState(null); // null = loading; [] = none / unavailable
  const [metric, setMetric]     = useState("hr"); // "hr" | "distance"
  const [squad, setSquad]       = useState(null); // getSquadFitnessLeaderboard result | null

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

  // Squad board (PR #9). Server-period-scoped, so it refetches on period change. Authenticated-only
  // + membership verified server-side; a watch-less member is still authenticated, so they SEE the
  // board even with no data of their own (LOCKED DECISION #7).
  useEffect(() => {
    if (!teamId) return;
    let alive = true;
    (async () => {
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (!session) { if (alive) setSquad(null); return; }
        const res = await getSquadFitnessLeaderboard(teamId, period);
        if (alive) setSquad(res || null);
      } catch (e) {
        console.error("[health] get_squad_fitness_leaderboard failed", e);
        if (alive) setSquad(null);
      }
    })();
    return () => { alive = false; };
  }, [teamId, period]);

  if (sessions === null) return null;      // own fetch still loading

  const cutoff   = periodCutoff(period);
  const inPeriod = sessions.filter(s => s.started_at && (!cutoff || s.started_at.slice(0, 10) >= cutoff));
  const ownHasData = inPeriod.length > 0;

  // The board shows only above the min-N floor (server-enforced; suppressed → rows collapse to the
  // self row, so we require 2+ rows to draw a "board"). Squad total sums the buckets so watch-less
  // members still count toward the collective number.
  const board = (squad?.min_cohort_met && Array.isArray(squad?.rows) && squad.rows.length > 1) ? squad.rows : null;
  const squadTotalM = board ? (squad.buckets || []).reduce((s, b) => s + (b.total_distance_m || 0), 0) : 0;

  if (!ownHasData && !board) return null;  // no own data AND no board → self-hide entirely

  // ── Totals (PR #3) ──────────────────────────────────────────────────────────
  const totalMeters = inPeriod.reduce((sum, s) => sum + (s.distance_meters   || 0), 0);
  const totalKcal   = inPeriod.reduce((sum, s) => sum + (s.active_energy_kcal || 0), 0);
  const hrVals      = inPeriod.map(s => s.avg_hr).filter(v => v > 0);
  const avgHr       = hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : null;

  const distanceText = formatDistance(totalMeters) || "—";
  const kcalText     = totalKcal > 0 ? Math.round(totalKcal).toLocaleString() : "—";
  const hrText       = avgHr ? `${avgHr}` : "—";

  // ── Trend series (PR #4) ────────────────────────────────────────────────────
  const chrono    = [...inPeriod].sort((a, b) => (a.started_at || "").localeCompare(b.started_at || ""));
  const hrPoints  = chrono.filter(s => s.avg_hr > 0).map(s => ({ v: s.avg_hr, date: s.started_at }));
  const distPoints = chrono.filter(s => s.distance_meters > 0).map(s => ({ v: s.distance_meters, date: s.started_at }));

  const available = [];
  if (hrPoints.length   >= 1) available.push("hr");
  if (distPoints.length >= 1) available.push("distance");
  const effMetric   = available.includes(metric) ? metric : available[0];
  const graphPoints = effMetric === "hr" ? hrPoints : distPoints;
  const showGraph   = graphPoints && graphPoints.length > 0;    // show from the very first logged game
  const enoughForTrend = graphPoints.length >= 2;               // baseline needs ≥2 points to draw a segment
  const enoughMatches  = inPeriod.length >= 1;                  // fittest/active shown from the first game

  // Hedged rolling-trend verdict (never a per-match claim) — baseline first vs last.
  let trendLabel = null, trendFitter = false;
  if (enoughForTrend) {
    const first = graphPoints[0].v, last = graphPoints[graphPoints.length - 1].v;
    trendFitter = effMetric === "hr" ? last < first : last > first;
    trendLabel = trendFitter ? "Trending in the right direction" : "Keeping it steady";
  }

  // Fittest match — the biggest single game (distance, else calories). Screenshot-worthy hero.
  // Metric-independent (it's about the match set), so it stays put when toggling HR↔distance.
  let fittest = null;
  if (enoughMatches) {
    const byDistance = inPeriod.filter(s => s.distance_meters > 0).sort((a, b) => b.distance_meters - a.distance_meters)[0];
    const byKcal     = inPeriod.filter(s => s.active_energy_kcal > 0).sort((a, b) => b.active_energy_kcal - a.active_energy_kcal)[0];
    const best = byDistance || byKcal;
    if (best) {
      fittest = {
        date: fmtShortDate(best.started_at),
        value: byDistance ? (formatDistance(best.distance_meters) || "") : `${Math.round(best.active_energy_kcal)} kcal`,
      };
    }
  }

  // Most active month — bucket by started_at UTC "YYYY-MM" (consistent with the cutoff slicing).
  // Metric-independent, so gated on match count (not the viewed metric's series).
  let activeMonth = null;
  if (enoughMatches) {
    const counts = {};
    for (const s of inPeriod) {
      const ym = (s.started_at || "").slice(0, 7);
      if (ym) counts[ym] = (counts[ym] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 1) activeMonth = { label: fmtMonthLabel(top[0]), n: top[1] };
  }

  const metricUnit = effMetric === "hr" ? "avg HR" : "distance";

  // Trend axis titles/scale (Y = metric range, X = month span).
  const gVals  = graphPoints.map(p => p.v);
  const gMax   = gVals.length ? Math.max(...gVals) : 0;
  const gMin   = gVals.length ? Math.min(...gVals) : 0;
  const yTop   = effMetric === "hr" ? String(gMax) : (formatDistance(gMax) || "");
  const yBot   = effMetric === "hr" ? String(gMin) : (formatDistance(gMin) || "");
  const yTitle = effMetric === "hr" ? "Avg HR" : "Distance";
  const xFirst = fmtMonthTick(graphPoints[0]?.date);
  const xLast  = fmtMonthTick(graphPoints[graphPoints.length - 1]?.date);

  return (
    <div style={{ padding: 16, borderRadius: 12, background: "var(--s2)", border: "0.5px solid var(--b2)", marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Lightning size={20} weight="thin" color="var(--gold)" />
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em", color: "var(--t1)" }}>
          MATCH FITNESS
        </div>
      </div>

      {ownHasData && (<>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Stat label="Matches"  value={inPeriod.length} />
        <Stat label="Distance" value={distanceText} />
        <Stat label="Calories" value={kcalText} />
        <Stat label="Avg HR"   value={hrText} />
      </div>

      {/* ── Trend graph (PR #4) ── */}
      {showGraph && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "0.5px solid var(--b2)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.04em", color: "var(--t2)", fontFamily: "DM Sans, sans-serif" }}>
              FITNESS TREND
            </div>
            {available.length === 2 && (
              <div style={{ display: "flex", gap: 6 }}>
                <MetricPill active={effMetric === "hr"}       label="Avg HR"   onClick={() => setMetric("hr")} />
                <MetricPill active={effMetric === "distance"} label="Distance" onClick={() => setMetric("distance")} />
              </div>
            )}
          </div>

          {/* Graph with Y-axis (metric scale) + X-axis (month span) titles */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-end", minWidth: 30, paddingBottom: 16 }}>
              <span style={{ fontSize: 9, color: "var(--t3)", lineHeight: 1 }}>{yTop}</span>
              <span style={{ fontSize: 9, color: "var(--t2)", writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: "0.04em", margin: "2px 0" }}>{yTitle}</span>
              <span style={{ fontSize: 9, color: "var(--t3)", lineHeight: 1 }}>{yBot}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TrendGraph points={graphPoints} metric={effMetric} withBaseline={enoughForTrend} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 9, color: "var(--t3)", fontFamily: "DM Sans, sans-serif" }}>{xFirst}</span>
                {xLast && xLast !== xFirst && (
                  <span style={{ fontSize: 9, color: "var(--t3)", fontFamily: "DM Sans, sans-serif" }}>{xLast}</span>
                )}
              </div>
              <div style={{ textAlign: "center", fontSize: 9, color: "var(--t3)", marginTop: 1, fontFamily: "DM Sans, sans-serif" }}>Per match →</div>
            </div>
          </div>

          {enoughForTrend && trendLabel && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <span style={{ width: 14, height: 0, borderTop: `1.5px dashed ${trendFitter ? "var(--green)" : "var(--gold)"}`, display: "inline-block" }} />
              <span style={{ fontSize: 12, color: "var(--t2)", fontFamily: "DM Sans, sans-serif" }}>{trendLabel}</span>
            </div>
          )}

          {fittest && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "var(--s1)", border: "0.5px solid var(--b2)" }}>
              <Trophy size={16} weight="thin" color="var(--gold)" />
              <span style={{ fontSize: 12, color: "var(--t1)", fontFamily: "DM Sans, sans-serif" }}>
                Fittest match · <span style={{ color: "var(--gold)" }}>{fittest.value}</span>
                {fittest.date && <span style={{ color: "var(--t2)" }}>{` · ${fittest.date}`}</span>}
              </span>
            </div>
          )}

          {activeMonth && (
            <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 8, fontFamily: "DM Sans, sans-serif" }}>
              {`Most active · ${activeMonth.label} (${activeMonth.n} games)`}
            </div>
          )}
        </div>
      )}
      </>)}

      {board && (
        <div style={{ marginTop: ownHasData ? 16 : 4, paddingTop: ownHasData ? 14 : 0, borderTop: ownHasData ? "0.5px solid var(--b2)" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <UsersThree size={16} weight="thin" color="var(--gold)" />
            <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--t2)", fontFamily: "DM Sans, sans-serif" }}>
              SQUAD FITNESS
            </div>
          </div>
          {board.map((r) => <SquadRow key={r.player_id} row={r} />)}
          {squadTotalM > 0 && (
            <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 10, textAlign: "center", fontFamily: "DM Sans, sans-serif" }}>
              Squad total · <span style={{ color: "var(--gold)" }}>{formatDistance(squadTotalM)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
