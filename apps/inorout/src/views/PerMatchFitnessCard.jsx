// PerMatchFitnessCard — per-match Apple Watch fitness for one game (Match Workout
// Tracking PR #3). Reads get_match_health_for_match (mig 456): the caller's OWN row
// always, plus teammate rows ONLY for casual games where that player consented
// (share_match_fitness). Self-hides when there is no data (so it ships DARK — invisible
// until the native HealthKit ingestion in PR #6 starts feeding rows).
//
// Indoor vs outdoor is derived from the data, not a flag: an indoor game has no GPS,
// so distance_meters is null/0 and has_route is false → we hide the distance stat and
// show "Indoor — no route" instead of a map. Outdoor with has_route → the player can
// reveal their own route (getMatchRoute is own-session-only).
//
// matchRef = matches.id (text) for casual, fixtures.id (uuid) for league.

import { useEffect, useState } from "react";
import { Lightning, Path } from "@phosphor-icons/react";
import { getMatchHealthForMatch, getMatchRoute } from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";
import MatchRouteHeatmap from "../components/MatchRouteHeatmap.jsx";

function fmtDistance(m) {
  if (!m) return null;                       // indoor / unknown → caller hides the stat
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function fmtMinutes(seconds) {
  if (!seconds) return "—";
  return `${Math.round(seconds / 60)}`;
}

function Stat({ label, value }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 64 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "var(--gold)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function FitnessRow({ row }) {
  const [route, setRoute] = useState(null);   // { track } once loaded
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const distance = fmtDistance(row.distance_meters);
  const indoor = !distance && !row.has_route;
  const canShowRoute = row.is_self && row.has_route; // routes are own-session-only

  const toggleRoute = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (route || loading) return;
    setLoading(true);
    try {
      const res = await getMatchRoute(row.session_id);
      setRoute(res || null);
    } catch (e) {
      console.error("[health] get_match_route failed", e);
    } finally {
      setLoading(false);
    }
  };

  const hasTrack = route?.track && route.track !== null;

  return (
    <div style={{ padding: "10px 0", borderTop: "0.5px solid var(--b2)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: "var(--t1)", fontFamily: "DM Sans, sans-serif" }}>
          {row.is_self ? "You" : (row.player_name || "Player")}
          {indoor && <span style={{ fontSize: 11, color: "var(--t2)", marginLeft: 8 }}>· Indoor</span>}
        </div>
        {canShowRoute && (
          <button
            type="button"
            onClick={toggleRoute}
            style={{
              display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
              color: "var(--gold)", fontSize: 11, fontFamily: "DM Sans, sans-serif", cursor: "pointer", padding: 0,
            }}
          >
            <Path size={14} weight="thin" />
            {open ? "Hide route" : "View route"}
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Stat label="Minutes" value={fmtMinutes(row.duration_seconds)} />
        {distance && <Stat label="Distance" value={distance} />}
        <Stat label="Calories" value={row.active_energy_kcal ? Math.round(row.active_energy_kcal) : "—"} />
        <Stat label="Avg HR" value={row.avg_hr ? `${row.avg_hr}` : "—"} />
        <Stat label="Max HR" value={row.max_hr ? `${row.max_hr}` : "—"} />
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {loading && <div style={{ fontSize: 11, color: "var(--t2)" }}>Loading route…</div>}
          {!loading && hasTrack && <MatchRouteHeatmap track={route.track} />}
          {!loading && !hasTrack && <div style={{ fontSize: 11, color: "var(--t2)" }}>No route recorded.</div>}
        </div>
      )}
    </div>
  );
}

export default function PerMatchFitnessCard({ matchRef }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!matchRef) return;
    let alive = true;
    (async () => {
      try {
        // get_match_health_for_match is authenticated-only; token-only/anon viewers (e.g. the
        // /admin/<token> backdoor) have no session, so skip the fetch + self-hide rather than
        // firing a request that will 403 and log an error on every card expansion.
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (!session) { if (alive) setRows([]); return; }
        const res = await getMatchHealthForMatch(matchRef);
        if (alive) setRows(res?.rows || []);
      } catch (e) {
        console.error("[health] get_match_health_for_match failed", e);
        if (alive) setRows([]);
      }
    })();
    return () => { alive = false; };
  }, [matchRef]);

  if (!rows || rows.length === 0) return null; // ships DARK: invisible until data exists

  return (
    <div style={{ padding: 16, borderRadius: 12, background: "var(--s2)", border: "0.5px solid var(--b2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Lightning size={20} weight="thin" color="var(--gold)" />
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em", color: "var(--t1)" }}>
          MATCH FITNESS
        </div>
      </div>
      {rows.map((row) => <FitnessRow key={row.session_id} row={row} />)}
    </div>
  );
}
