import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { venueListPlayers } from "@platform/core/storage/supabase.js";

// Player management (aggregate) — every player across the venue's teams.
// Search by player or team; filter by status.
export default function PlayersView({ venueToken }) {
  const [players, setPlayers] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | injured | inactive

  useEffect(() => {
    let alive = true;
    venueListPlayers(venueToken)
      .then((res) => { if (alive) setPlayers(Array.isArray(res?.players) ? res.players : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  const filtered = useMemo(() => {
    let list = players || [];
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((p) =>
      (p.name || "").toLowerCase().includes(needle) ||
      (p.nickname || "").toLowerCase().includes(needle) ||
      (p.team_name || "").toLowerCase().includes(needle));
    if (filter === "injured") list = list.filter((p) => p.injured);
    if (filter === "inactive") list = list.filter((p) => p.disabled);
    return list;
  }, [players, q, filter]);

  const totalActive = (players || []).filter((p) => !p.disabled).length;

  return (
    <main className="content mgmt">
      <div className="mgmt-head">
        <div>
          <h2 className="mgmt-title">Players</h2>
          <p className="mgmt-sub">
            {players == null ? "Loading…" : `${totalActive} active player${totalActive === 1 ? "" : "s"} across your teams`}
          </p>
        </div>
        {players && players.length > 0 && (
          <div className="pv-controls">
            <div className="pv-filters">
              {["all", "injured", "inactive"].map((f) => (
                <button key={f} className={"pv-filter" + (filter === f ? " is-active" : "")} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
            <input className="mgmt-search" placeholder="Search players or teams…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>

      {error && <div className="panel mgmt-empty"><p className="error">{error}</p></div>}
      {players && players.length === 0 && !error && (
        <div className="panel mgmt-empty"><p className="muted">No players yet. They appear here once teams build their squads.</p></div>
      )}

      {players && filtered.length > 0 && (
        <motion.div className="panel pv-panel"
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
          <div className="pv-list">
            {filtered.map((p) => (
              <div className={"pv-row" + (p.disabled ? " is-out" : "")} key={`${p.team_id}-${p.id}`}>
                <span className="pv-shirt">{p.shirt_number ?? "–"}</span>
                <div className="pv-id">
                  <span className="pv-name">
                    {p.name}
                    {p.nickname && <span className="pv-nick">“{p.nickname}”</span>}
                    {p.injured && <span className="td-badge td-badge-warn">Injured</span>}
                    {p.disabled && <span className="td-badge td-badge-mute">Inactive</span>}
                  </span>
                  <span className="pv-team"><span className="pv-tick" style={{ background: p.team_colour || "var(--accent)" }} />{p.team_name}</span>
                </div>
                <div className="td-stats">
                  <span className="td-stat" title="Goals"><b>{p.goals ?? 0}</b><i>G</i></span>
                  <span className="td-stat" title="POTM"><b>{p.motm ?? 0}</b><i>P</i></span>
                  <span className="td-stat" title="Appearances"><b>{p.attended ?? 0}</b><i>App</i></span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
      {players && filtered.length === 0 && players.length > 0 && (
        <div className="panel mgmt-empty"><p className="muted">No players match.</p></div>
      )}
    </main>
  );
}
