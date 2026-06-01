import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { venueListActiveTeams } from "@platform/core/storage/supabase.js";
import TeamDetail from "./TeamDetail.jsx";

// Team management — every team active across the venue's competitions.
// Roster/player detail needs a dedicated RPC (not yet built); this is the
// directory + at-a-glance activity, the data-ready half of team management.
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
    <main className="content mgmt">
      <div className="mgmt-head">
        <div>
          <h2 className="mgmt-title">Teams</h2>
          <p className="mgmt-sub">
            {teams == null ? "Loading…" : `${teams.length} team${teams.length === 1 ? "" : "s"} across active competitions`}
          </p>
        </div>
        {teams && teams.length > 0 && (
          <input className="mgmt-search" placeholder="Search teams…" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
      </div>

      {error && <div className="panel mgmt-empty"><p className="error">{error}</p></div>}

      {teams && teams.length === 0 && !error && (
        <div className="panel mgmt-empty">
          <p className="muted">No active teams yet. Teams appear here once they’re approved into a competition.</p>
        </div>
      )}

      {teams && filtered.length > 0 && (
        <motion.div className="mgmt-grid"
          variants={{ show: { transition: { staggerChildren: 0.04 } } }}
          initial="hidden" animate="show">
          {filtered.map((t) => (
            <motion.button key={t.team_id} className="team-card panel" type="button"
              onClick={() => setOpenTeam(t)} title="View roster"
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}>
              <span className="team-crest" style={crestStyle(t)}>{initials(t.name)}</span>
              <div className="team-id">
                <span className="team-name">{t.name}</span>
                <span className="team-meta">
                  {t.competition_count ?? 0} competition{(t.competition_count ?? 0) === 1 ? "" : "s"}
                  {t.last_active_at ? ` · last active ${fmtAgo(t.last_active_at)}` : ""}
                </span>
              </div>
              <span className="team-go" aria-hidden="true">›</span>
            </motion.button>
          ))}
        </motion.div>
      )}

      {openTeam && (
        <TeamDetail
          venueToken={venueToken}
          teamId={openTeam.team_id}
          teamName={openTeam.name}
          onClose={() => setOpenTeam(null)}
        />
      )}
    </main>
  );
}

function crestStyle(t) {
  const a = t.primary_colour || "#E8A020";
  const b = t.secondary_colour || "#1A1B22";
  return { background: `linear-gradient(135deg, ${a}, ${b})` };
}
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
}
function fmtAgo(iso) {
  try {
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.round(days / 7)}w ago`;
    return `${Math.round(days / 30)}mo ago`;
  } catch { return ""; }
}
