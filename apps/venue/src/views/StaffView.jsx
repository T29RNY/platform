import React, { useState, useMemo, useEffect } from "react";
import { venueListStaff } from "@platform/core/storage/supabase.js";
import RefForm from "./RefForm.jsx";
import StaffMemberForm from "./StaffMemberForm.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState, StarRating } from "./atoms.jsx";
import { getInitials } from "../lib/format.js";

const ROLE_LABEL = {
  reception: "Reception", manager: "Manager", admin: "Admin",
  groundstaff: "Groundstaff", coach: "Coach", other: "Staff",
};

// Staff — match officials (match_officials) + venue staff (venue_staff, mig 195).
export default function StaffView({ state, venueToken, onRefresh }) {
  const refs = state.refs ?? [];
  const [refForm, setRefForm] = useState({ open: false, row: null });
  const [staffForm, setStaffForm] = useState({ open: false, row: null });
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

  const orderedRefs = useMemo(() => [...refs].sort((a, b) => (b.active !== false) - (a.active !== false)), [refs]);
  const orderedStaff = useMemo(() => (staff ? [...staff].sort((a, b) => (b.active !== false) - (a.active !== false)) : []), [staff]);
  const activeRefs = refs.filter((r) => r.active !== false).length;
  const activeStaff = (staff || []).filter((s) => s.active !== false).length;

  return (
    <div>
      <section style={{ marginBottom: "var(--gap-3)" }}>
        <SectionHead label="Match officials" count={`${activeRefs} active`}>
          <button className="btn btn-sm btn-primary" onClick={() => setRefForm({ open: true, row: null })}>
            <Icon name="plus" size={14} /> Add official
          </button>
        </SectionHead>
        {refs.length === 0 ? (
          <EmptyState title="No officials yet" body="Add a referee to assign them to fixtures." />
        ) : (
          <div className="staff-grid">
            {orderedRefs.map((ref) => (
              <StaffCard
                key={ref.id}
                name={ref.name}
                subtitle={(ref.employment_type || "freelance").replace("_", " ")}
                rating={ref.overall_rating}
                channel={ref.preferred_channel || "push"}
                contacts={[ref.phone, ref.email].filter(Boolean)}
                inactive={ref.active === false}
                onClick={() => setRefForm({ open: true, row: ref })}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHead label="Venue staff" count={staff == null ? "loading…" : `${activeStaff} active`}>
          <button className="btn btn-sm btn-primary" onClick={() => setStaffForm({ open: true, row: null })}>
            <Icon name="plus" size={14} /> Add staff
          </button>
        </SectionHead>
        {staffErr && <EmptyState title="Couldn’t load staff" body={staffErr} />}
        {!staffErr && orderedStaff.length === 0 && staff != null && (
          <EmptyState title="No venue staff yet" body="Add reception, managers, groundstaff and admins here." />
        )}
        {orderedStaff.length > 0 && (
          <div className="staff-grid">
            {orderedStaff.map((m) => (
              <StaffCard
                key={m.id}
                name={m.name}
                subtitle={`${ROLE_LABEL[m.role] || "Staff"}${m.notes ? ` · ${m.notes}` : ""}`}
                channel={m.preferred_channel || "email"}
                contacts={[m.phone, m.email].filter(Boolean)}
                inactive={m.active === false}
                onClick={() => setStaffForm({ open: true, row: m })}
              />
            ))}
          </div>
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
    </div>
  );
}

function StaffCard({ name, subtitle, rating, channel, contacts = [], inactive, onClick }) {
  return (
    <button className={"staff-card" + (inactive ? " inactive" : "")} onClick={onClick} title="Edit" style={{ textAlign: "left", width: "100%" }}>
      <div className="head">
        <span className="avatar">{getInitials(name)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="name">{name}</div>
          <div className="role-line">
            <span style={{ textTransform: "capitalize" }}>{subtitle}</span>
            {rating != null && <span className="rating"><StarRating n={Math.round(Number(rating))} /></span>}
          </div>
        </div>
      </div>
      <div className="contact">
        {channel && <span className="chip-contact preferred">{channel}</span>}
        {contacts.map((c, i) => <span key={i} className="chip-contact">{c}</span>)}
        {inactive && <span className="chip-contact">Inactive</span>}
      </div>
    </button>
  );
}
