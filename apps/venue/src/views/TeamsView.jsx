import React, { useEffect, useState } from "react";
import { venueListActiveTeams } from "@platform/core/storage/supabase.js";
import TeamDetail from "./TeamDetail.jsx";
import Icon from "./Icon.jsx";
import { TeamCrest, SectionHead, EmptyState } from "./atoms.jsx";
import { relativeFrom } from "../lib/format.js";

// Team directory — every team active across the venue's competitions.
export default function TeamsView({ venueToken }) {
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [openTeam, setOpenTeam] = useState(null);

  useEffect(() => {
    let alive = true;
    venueListActiveTeams(venueToken)
      .then((rows) => { if (alive) setTeams(Array.isArray(rows) ? rows : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  const filtered = (teams || []).filter((t) =>
    !q.trim() || (t.name || "").toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <SectionHead
        label="Teams"
        count={teams == null ? "Loading…" : `${teams.length} across active competitions`}
      >
        {teams && teams.length > 0 && (
          <span className="search">
            <span className="ico"><Icon name="search" size={15} /></span>
            <input placeholder="Search teams…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
        )}
      </SectionHead>

      {error && <EmptyState title="Couldn’t load teams" body={error} />}

      {teams && teams.length === 0 && !error && (
        <EmptyState title="No active teams yet" body="Teams appear here once they’re approved into a competition." />
      )}

      {teams && teams.length > 0 && filtered.length === 0 && (
        <EmptyState title="No teams match" body={`Nothing matches “${q}”.`} />
      )}

      {filtered.length > 0 && (
        <div className="teams-grid">
          {filtered.map((t) => (
            <button key={t.team_id} className="team-card" type="button" onClick={() => setOpenTeam(t)} title="View roster">
              <TeamCrest team={{ name: t.name, primary_colour: t.primary_colour, secondary_colour: t.secondary_colour }} size={52} big />
              <div>
                <div className="name">{t.name}</div>
                <div className="meta">
                  {t.competition_count ?? 0} competition{(t.competition_count ?? 0) === 1 ? "" : "s"}
                  {t.last_active_at ? ` · ${relativeFrom(t.last_active_at)}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {openTeam && (
        <TeamDetail
          venueToken={venueToken}
          teamId={openTeam.team_id}
          teamName={openTeam.name}
          onClose={() => setOpenTeam(null)}
        />
      )}
    </div>
  );
}
