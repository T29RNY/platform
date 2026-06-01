import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";

// League teams directory — from the teams map (league_list_teams).
export default function TeamsView({ teams }) {
  const list = useMemo(() => Object.values(teams || {}).sort((a, b) => (a.name || "").localeCompare(b.name || "")), [teams]);
  const [q, setQ] = useState("");
  const filtered = list.filter((t) => !q.trim() || (t.name || "").toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <main className="content mgmt">
      <div className="mgmt-head">
        <div>
          <h2 className="mgmt-title">Teams</h2>
          <p className="mgmt-sub">{list.length} team{list.length === 1 ? "" : "s"} in this league</p>
        </div>
        {list.length > 0 && (
          <input className="mgmt-search" placeholder="Search teams…" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
      </div>

      {list.length === 0 ? (
        <div className="panel mgmt-empty"><p className="muted">No teams registered yet.</p></div>
      ) : (
        <motion.div className="mgmt-grid"
          variants={{ show: { transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="show">
          {filtered.map((t) => (
            <motion.div key={t.id} className="team-card panel"
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}>
              <span className="team-crest" style={{ background: `linear-gradient(135deg, ${t.primary_colour || "#E8A020"}, ${t.secondary_colour || "#1A1B22"})` }}>
                {initials(t.name)}
              </span>
              <div className="team-id">
                <span className="team-name">{t.name}</span>
                <span className="team-meta">League team</span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </main>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
}
