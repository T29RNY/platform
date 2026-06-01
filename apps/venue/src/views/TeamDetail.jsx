import React, { useEffect, useState } from "react";
import { venueGetTeamRoster } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

// Team detail — roster + competitions for a team in this venue's competitions.
export default function TeamDetail({ venueToken, teamId, teamName, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    venueGetTeamRoster(venueToken, teamId)
      .then((res) => { if (alive) setData(res); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken, teamId]);

  const team = data?.team;
  const players = data?.players ?? [];
  const comps = data?.competitions ?? [];
  const active = players.filter((p) => !p.disabled);

  return (
    <Modal open wide onClose={onClose} title={team?.name || teamName || "Team"}
      footer={<button onClick={onClose}>Close</button>}>
      {error && <p className="error">{error}</p>}
      {!error && !data && <p className="muted">Loading roster…</p>}

      {data && (
        <>
          <div className="td-head">
            <span className="td-crest" style={crestStyle(team)}>{initials(team?.name || teamName)}</span>
            <div className="td-head-id">
              <div className="td-comps">
                {comps.length === 0
                  ? <span className="muted">No active competitions</span>
                  : comps.map((c, i) => <span key={i} className={"comp-chip comp-" + (c.status === "active" ? "active" : "")}>{c.name}</span>)}
              </div>
              <div className="td-count">{active.length} player{active.length === 1 ? "" : "s"}{players.length !== active.length ? ` · ${players.length - active.length} inactive` : ""}</div>
            </div>
          </div>

          {players.length === 0 ? (
            <p className="muted" style={{ marginTop: 16 }}>No players on this roster yet.</p>
          ) : (
            <div className="td-roster">
              {players.map((p) => (
                <div className={"td-player" + (p.disabled ? " is-out" : "")} key={p.id}>
                  <span className="td-shirt">{p.shirt_number ?? "–"}</span>
                  <div className="td-player-id">
                    <span className="td-player-name">
                      {p.name}
                      {p.nickname && <span className="td-nick">“{p.nickname}”</span>}
                    </span>
                    <div className="td-badges">
                      {p.is_vice_captain && <span className="td-badge td-badge-vc">VC</span>}
                      {p.type === "reserve" && <span className="td-badge">Reserve</span>}
                      {p.injured && <span className="td-badge td-badge-warn">Injured</span>}
                      {p.disabled && <span className="td-badge td-badge-mute">Inactive</span>}
                    </div>
                  </div>
                  <div className="td-stats">
                    <span className="td-stat" title="Goals"><b>{p.goals ?? 0}</b><i>G</i></span>
                    <span className="td-stat" title="POTM"><b>{p.motm ?? 0}</b><i>P</i></span>
                    <span className="td-stat" title="Played"><b>{p.attended ?? 0}</b><i>App</i></span>
                    <span className="td-stat td-wdl" title="Win–Draw–Loss">{p.w ?? 0}-{p.d ?? 0}-{p.l ?? 0}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function crestStyle(team) {
  const a = team?.primary_colour || "#E8A020";
  const b = team?.secondary_colour || "#1A1B22";
  return { background: `linear-gradient(135deg, ${a}, ${b})` };
}
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
}
