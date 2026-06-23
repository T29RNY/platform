import React, { useEffect, useState } from "react";
import { venueGetTeamRoster } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import { DataTable } from "./PageKit.jsx";

// Team detail — roster (TABLE form) + competitions for a team in this venue's
// competitions. Redesigned for the Phase-2 Teams page: the roster is now a
// sortable/filterable DataTable rather than a stat-stack, surfacing more per
// player at a glance.
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

  const columns = [
    { key: "shirt_number", label: "#", align: "num", width: 48, sortable: true,
      sortValue: (p) => p.shirt_number ?? 999,
      render: (p) => p.shirt_number ?? "–" },
    { key: "name", label: "Player", sortable: true, render: (p) => (
      <span className={p.disabled ? "text-mute" : undefined}>
        {p.name}
        {p.nickname && <span className="text-mute"> “{p.nickname}”</span>}
      </span>
    ) },
    { key: "status", label: "Status", render: (p) => (
      <span className="td-badges">
        {p.is_vice_captain && <span className="dt-pill">VC</span>}
        {p.type === "reserve" && <span className="dt-pill">Reserve</span>}
        {p.injured && <span className="dt-pill" style={{ color: "var(--amber)" }}>Injured</span>}
        {p.disabled && <span className="dt-pill">Inactive</span>}
        {!p.is_vice_captain && p.type !== "reserve" && !p.injured && !p.disabled && <span className="text-mute">—</span>}
      </span>
    ) },
    { key: "goals", label: "Goals", align: "num", sortable: true, render: (p) => p.goals ?? 0 },
    { key: "motm", label: "POTM", align: "num", sortable: true, render: (p) => p.motm ?? 0 },
    { key: "attended", label: "Played", align: "num", sortable: true, render: (p) => p.attended ?? 0 },
    { key: "wdl", label: "W–D–L", align: "center",
      render: (p) => `${p.w ?? 0}-${p.d ?? 0}-${p.l ?? 0}` },
  ];

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

          <div style={{ marginTop: 16 }}>
            <DataTable
              columns={columns}
              rows={players}
              getRowKey={(p) => p.id}
              searchFields={["name", "nickname"]}
              searchPlaceholder="Search roster…"
              filters={[
                { id: "active", label: "Active", test: (p) => !p.disabled },
                { id: "injured", label: "Injured", test: (p) => p.injured },
                { id: "inactive", label: "Inactive", test: (p) => p.disabled },
              ]}
              initialSort={{ key: "shirt_number", dir: "asc" }}
              empty={{ title: "No players on this roster yet", body: "Players appear here once the team builds its squad." }}
              noMatch={{ title: "No players match", body: "Try a different search or filter." }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}

function crestStyle(team) {
  // Team brand colours from the DB; fall back to neutral tokens (no hardcoded hex).
  const a = team?.primary_colour || "var(--accent)";
  const b = team?.secondary_colour || "var(--bg-3)";
  return { background: `linear-gradient(135deg, ${a}, ${b})` };
}
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
}
