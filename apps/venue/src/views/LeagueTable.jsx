import React, { useEffect, useMemo, useState } from "react";
import { venueGetStandings } from "@platform/core/storage/supabase.js";
import { SectionHead, EmptyState } from "./atoms.jsx";

// League Table — live standings for round-robin competitions (venue_get_standings).
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
    return <EmptyState title="No league table yet" body="No round-robin competition set up. Create a season under the Internal League tab." />;
  }

  return (
    <div>
      <SectionHead label="League Table" count="updates as results come in">
        {comps.length > 1 && (
          <select className="input" style={{ width: "auto" }} value={compId} onChange={(e) => setCompId(e.target.value)}>
            {comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </SectionHead>

      {error && <EmptyState title="Couldn’t load standings" body={error} />}

      {!error && rows.length === 0 && (
        <EmptyState title={loading ? "Loading…" : "No teams yet"} body={loading ? "" : "No teams in this competition yet."} />
      )}

      {!error && rows.length > 0 && (
        <div className="dt-card">
          <table className="dt standings">
            <thead>
              <tr>
                <th style={{ width: 56 }}>#</th>
                <th>Team</th>
                <th className="num">P</th><th className="num">W</th><th className="num">D</th><th className="num">L</th>
                <th className="num">GF</th><th className="num">GA</th>
                <th className="num">GD</th><th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.team_id} className={r.rank <= 3 ? "top3" : ""}>
                  <td className="rank-cell"><span className="rank-badge">{r.rank}</span></td>
                  <td>
                    <span className="team-color-bar" style={{ "--c": r.primary_colour || "var(--accent)" }} />
                    {r.team_name}
                  </td>
                  <td className="num">{r.played}</td><td className="num">{r.w}</td><td className="num">{r.d}</td><td className="num">{r.l}</td>
                  <td className="num">{r.gf}</td><td className="num">{r.ga}</td>
                  <td className={"num " + (r.gd > 0 ? "gd-pos" : r.gd < 0 ? "gd-neg" : "gd-zero")}>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                  <td className="num pts">{r.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
