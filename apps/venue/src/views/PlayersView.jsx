import React, { useEffect, useMemo, useState } from "react";
import { venueListPlayers } from "@platform/core/storage/supabase.js";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";

// Aggregate player directory across all the venue's teams.
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
    <div>
      <SectionHead label="Players" count={players == null ? "Loading…" : `${totalActive} active across your teams`}>
        {players && players.length > 0 && (
          <>
            <span className="chips">
              {["all", "injured", "inactive"].map((f) => (
                <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ textTransform: "capitalize" }}>{f}</button>
              ))}
            </span>
            <span className="search">
              <span className="ico"><Icon name="search" size={15} /></span>
              <input placeholder="Search players or teams…" value={q} onChange={(e) => setQ(e.target.value)} />
            </span>
          </>
        )}
      </SectionHead>

      {error && <EmptyState title="Couldn’t load players" body={error} />}
      {players && players.length === 0 && !error && (
        <EmptyState title="No players yet" body="They appear here once teams build their squads." />
      )}
      {players && players.length > 0 && filtered.length === 0 && (
        <EmptyState title="No players match" body="Try a different search or filter." />
      )}

      {filtered.length > 0 && (
        <div className="dt-card">
          <table className="dt">
            <thead>
              <tr>
                <th style={{ width: 56 }}>#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="num">G</th>
                <th className="num">P</th>
                <th className="num">App</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={`${p.team_id}-${p.id}`} className={p.disabled ? "player-row inactive" : "player-row"}>
                  <td className="num">{p.shirt_number ?? "–"}</td>
                  <td>
                    {p.name}
                    {p.nickname && <span className="text-mute"> “{p.nickname}”</span>}
                    <span className="player-badges">
                      {p.injured && <span className="pb pb-inj">INJ</span>}
                      {p.disabled && <span className="pb pb-off">OUT</span>}
                    </span>
                  </td>
                  <td>
                    <span className="team-color-bar" style={{ "--c": p.team_colour || "var(--accent)" }} />
                    {p.team_name}
                  </td>
                  <td className="num">{p.goals ?? 0}</td>
                  <td className="num">{p.motm ?? 0}</td>
                  <td className="num">{p.attended ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
