import React, { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { venueListStaff } from "@platform/core/storage/supabase.js";
import RefForm from "./RefForm.jsx";
import StaffMemberForm from "./StaffMemberForm.jsx";

const ROLE_LABEL = {
  reception: "Reception", manager: "Manager", admin: "Admin",
  groundstaff: "Groundstaff", coach: "Coach", other: "Staff",
};

// Staff management — everyone who runs the venue. Two sources:
//   • Match Officials  → match_officials (refs), via RefForm
//   • Venue Staff      → venue_staff (reception/managers/admins/…), via
//                        StaffMemberForm + the venue_*_staff RPCs (mig 195)
export default function StaffView({ state, venueToken, onRefresh }) {
  const refs = state.refs ?? [];

  // Officials form
  const [refForm, setRefForm] = useState({ open: false, row: null });
  // Venue staff form
  const [staffForm, setStaffForm] = useState({ open: false, row: null });

  // Venue staff list (separate RPC, not in venue state)
  const [staff, setStaff] = useState(null);
  const [staffErr, setStaffErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    venueListStaff(venueToken)
      .then((res) => { if (alive) setStaff(Array.isArray(res?.staff) ? res.staff : []); })
      .catch((e) => { if (alive) setStaffErr(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken, reloadKey]);

  const reloadStaff = () => setReloadKey((k) => k + 1);

  const { activeRefs, retiredRefs } = useMemo(() => {
    const a = [], r = [];
    for (const ref of refs) (ref.active === false ? r : a).push(ref);
    return { activeRefs: a, retiredRefs: r };
  }, [refs]);

  const orderedStaff = useMemo(() => {
    if (!staff) return [];
    return [...staff].sort((x, y) => (y.active === false ? 0 : 1) - (x.active === false ? 0 : 1));
  }, [staff]);

  return (
    <main className="content mgmt">
      <div className="mgmt-head">
        <div>
          <h2 className="mgmt-title">Staff</h2>
          <p className="mgmt-sub">
            {activeRefs.length} official{activeRefs.length === 1 ? "" : "s"}
            {" · "}
            {staff == null ? "loading staff…" : `${staff.filter((s) => s.active !== false).length} venue staff`}
          </p>
        </div>
      </div>

      {/* ── Match Officials ── */}
      <section className="staff-section">
        <div className="staff-section-head">
          <h3 className="staff-section-h">Match Officials</h3>
          <button className="btn-accent" onClick={() => setRefForm({ open: true, row: null })}>+ Add official</button>
        </div>
        {refs.length === 0 ? (
          <div className="panel mgmt-empty"><p className="muted">No officials yet. Add a referee to assign them to fixtures.</p></div>
        ) : (
          <motion.div className="mgmt-grid"
            variants={{ show: { transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="show">
            {[...activeRefs, ...retiredRefs].map((ref) => (
              <StaffCard key={ref.id} name={ref.name} roleLabel="Official"
                sub={(ref.employment_type || "freelance").replace("_", " ")}
                rating={ref.overall_rating} channel={ref.preferred_channel || "push"}
                contacts={[ref.phone, ref.email].filter(Boolean)} retired={ref.active === false}
                onClick={() => setRefForm({ open: true, row: ref })} />
            ))}
          </motion.div>
        )}
      </section>

      {/* ── Venue Staff ── */}
      <section className="staff-section">
        <div className="staff-section-head">
          <h3 className="staff-section-h">Venue Staff</h3>
          <button className="btn-accent" onClick={() => setStaffForm({ open: true, row: null })}>+ Add staff</button>
        </div>
        {staffErr && <div className="panel mgmt-empty"><p className="error">{staffErr}</p></div>}
        {!staffErr && orderedStaff.length === 0 && (
          <div className="panel mgmt-empty">
            <p className="muted">No venue staff yet. Add reception, managers, groundstaff and admins here.</p>
          </div>
        )}
        {orderedStaff.length > 0 && (
          <motion.div className="mgmt-grid"
            variants={{ show: { transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="show">
            {orderedStaff.map((m) => (
              <StaffCard key={m.id} name={m.name} roleLabel={ROLE_LABEL[m.role] || "Staff"}
                sub={m.notes || ""} channel={m.preferred_channel || "email"}
                contacts={[m.phone, m.email].filter(Boolean)} retired={m.active === false}
                onClick={() => setStaffForm({ open: true, row: m })} />
            ))}
          </motion.div>
        )}
      </section>

      {refForm.open && (
        <RefForm venueToken={venueToken} refRow={refForm.row}
          onClose={() => setRefForm({ open: false, row: null })} onDone={onRefresh} />
      )}
      {staffForm.open && (
        <StaffMemberForm venueToken={venueToken} member={staffForm.row}
          onClose={() => setStaffForm({ open: false, row: null })} onDone={reloadStaff} />
      )}
    </main>
  );
}

function StaffCard({ name, roleLabel, sub, rating, channel, contacts = [], retired, onClick }) {
  return (
    <motion.button className={"staff-card panel" + (retired ? " is-retired" : "")} onClick={onClick}
      variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }} title="Edit">
      <div className="staff-card-top">
        <span className="staff-avatar">{initials(name)}</span>
        <div className="staff-id">
          <span className="staff-name">{name}</span>
          <span className="staff-emp">{roleLabel}{sub ? ` · ${sub}` : ""}</span>
        </div>
        {rating != null && <span className="staff-rating">{Number(rating).toFixed(1)}<i>★</i></span>}
      </div>
      <div className="staff-card-meta">
        <span className="staff-chip">{channel}</span>
        {contacts.map((c, i) => <span key={i} className="staff-contact">{c}</span>)}
        {retired && <span className="staff-chip staff-chip-retired">Inactive</span>}
      </div>
    </motion.button>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
}
