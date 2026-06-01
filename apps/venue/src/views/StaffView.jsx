import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import RefForm from "./RefForm.jsx";

// Staff / match officials management. Reads `refs` from venue state and
// reuses the existing RefForm + venueAddRef / venueUpdateRef RPCs.
export default function StaffView({ state, venueToken, onRefresh }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const refs = state.refs ?? [];

  const { active, retired } = useMemo(() => {
    const a = [], r = [];
    for (const ref of refs) (ref.active === false ? r : a).push(ref);
    return { active: a, retired: r };
  }, [refs]);

  function openAdd() { setEditing(null); setFormOpen(true); }
  function openEdit(ref) { setEditing(ref); setFormOpen(true); }

  return (
    <main className="content mgmt">
      <div className="mgmt-head">
        <div>
          <h2 className="mgmt-title">Match Officials</h2>
          <p className="mgmt-sub">{active.length} active{retired.length ? ` · ${retired.length} retired` : ""}</p>
        </div>
        <button className="btn-accent" onClick={openAdd}>+ Add official</button>
      </div>

      {refs.length === 0 ? (
        <div className="panel mgmt-empty">
          <p className="muted">No officials yet. Add your first referee to assign them to fixtures.</p>
        </div>
      ) : (
        <motion.div className="mgmt-grid"
          variants={{ show: { transition: { staggerChildren: 0.05 } } }}
          initial="hidden" animate="show">
          {[...active, ...retired].map((ref) => (
            <motion.button key={ref.id} className={"staff-card panel" + (ref.active === false ? " is-retired" : "")}
              onClick={() => openEdit(ref)}
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
              title="Edit official">
              <div className="staff-card-top">
                <span className="staff-avatar">{initials(ref.name)}</span>
                <div className="staff-id">
                  <span className="staff-name">{ref.name}</span>
                  <span className="staff-emp">{(ref.employment_type || "freelance").replace("_", " ")}</span>
                </div>
                {ref.overall_rating != null && (
                  <span className="staff-rating">{Number(ref.overall_rating).toFixed(1)}<i>★</i></span>
                )}
              </div>
              <div className="staff-card-meta">
                <span className="staff-chip">{ref.preferred_channel || "push"}</span>
                {ref.phone && <span className="staff-contact">{ref.phone}</span>}
                {ref.email && <span className="staff-contact">{ref.email}</span>}
                {ref.active === false && <span className="staff-chip staff-chip-retired">Retired</span>}
              </div>
            </motion.button>
          ))}
        </motion.div>
      )}

      {formOpen && (
        <RefForm
          venueToken={venueToken}
          refRow={editing}
          onClose={() => setFormOpen(false)}
          onDone={onRefresh}
        />
      )}
    </main>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
}
