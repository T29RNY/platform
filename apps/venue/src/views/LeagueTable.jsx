import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { venueGetStandings } from "@platform/core/storage/supabase.js";

// League Table — live standings for round-robin competitions, computed from
// completed fixtures by venue_get_standings (mig 197). Group-stage cup tables
// live under the Cups tab.
export default function LeagueTable({ state, venueToken }) {
  const comps = useMemo(
    () => (state.competitions ?? []).filter((c) => (c.format === "round_robin") || (c.type === "league")),
    [state.competitions]
  );
  const [compId, setCompId] = useState(comps[0]?.id || "");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!compId && comps[0]) setCompId(comps[0].id); }, [comps, compId]);

  useEffect(() => {
    if (!compId) return;
    let alive = true;
    setLoading(true); setError(null);
    venueGetStandings(venueToken, compId)
      .then((res) => { if (alive) setData(res); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [venueToken, compId]);

  const rows = data?.standings ?? [];

  if (comps.length === 0) {
    return (
      <main className="content mgmt">
        <div className="mgmt-head"><div><h2 className="mgmt-title">League Table</h2></div></div>
        <div className="panel mgmt-empty"><p className="muted">No round-robin league set up yet. Create a season under the League tab.</p></div>
      </main>
    );
  }

  return (
    <main className="content mgmt">
      <div className="mgmt-head">
        <div>
          <h2 className="mgmt-title">League Table</h2>
          <p className="mgmt-sub">Live standings · updates as results come in</p>
        </div>
        {comps.length > 1 && (
          <select className="lt-select" value={compId} onChange={(e) => setCompId(e.target.value)}>
            {comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="panel mgmt-empty"><p className="error">{error}</p></div>}

      {!error && (
        <motion.div className="panel lt-panel"
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
          <div className="lt-scroll">
            <table className="lt-table">
              <thead>
                <tr>
                  <th className="lt-pos">#</th>
                  <th className="lt-team">Team</th>
                  <th>P</th><th>W</th><th>D</th><th>L</th>
                  <th className="lt-hide-sm">GF</th><th className="lt-hide-sm">GA</th>
                  <th>GD</th><th className="lt-pts">Pts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.team_id} className={r.rank <= 3 ? "is-top" : ""}>
                    <td className="lt-pos"><span className="lt-rank">{r.rank}</span></td>
                    <td className="lt-team">
                      <span className="lt-tick" style={{ background: r.primary_colour || "var(--accent)" }} />
                      <span className="lt-name">{r.team_name}</span>
                    </td>
                    <td>{r.played}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td>
                    <td className="lt-hide-sm">{r.gf}</td><td className="lt-hide-sm">{r.ga}</td>
                    <td className={"lt-gd" + (r.gd > 0 ? " is-pos" : r.gd < 0 ? " is-neg" : "")}>
                      {r.gd > 0 ? `+${r.gd}` : r.gd}
                    </td>
                    <td className="lt-pts"><b>{r.pts}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loading && rows.length === 0 && <p className="muted" style={{ padding: "16px 18px" }}>Loading…</p>}
          {!loading && rows.length === 0 && <p className="muted" style={{ padding: "16px 18px" }}>No teams in this competition yet.</p>}
        </motion.div>
      )}
    </main>
  );
}
