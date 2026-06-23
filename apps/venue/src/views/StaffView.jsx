import React, { useState, useMemo, useEffect } from "react";
import { venueListStaff } from "@platform/core/storage/supabase.js";
import RefForm from "./RefForm.jsx";
import StaffMemberForm from "./StaffMemberForm.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, StarRating } from "./atoms.jsx";
import { TabbedPage, DataTable } from "./PageKit.jsx";
import { StaffTab as ClubCoachesTab } from "./MembershipsView.jsx";

const ROLE_LABEL = {
  reception: "Reception", manager: "Manager", admin: "Admin",
  groundstaff: "Groundstaff", coach: "Coach", other: "Staff",
};

// Staff — the People-group page, on the shared IA pattern (Venue People & Spaces
// epic, Phase 5 consistency sweep): TabbedPage + DataTable + a plain-English
// ViewSubhead, replacing the old chip switcher + .staff-grid cards.
//  • "Venue staff & officials" — match officials (match_officials) + venue staff
//    (venue_staff, mig 195), each a sortable/searchable table.
//  • "Coaches & DBS" — per-club team managers/coaches + DBS/safeguarding records
//    (the Memberships StaffTab; reused unchanged).
export default function StaffView({ state, venueToken, onRefresh }) {
  const tabs = [
    {
      id: "venue",
      label: "Venue staff & officials",
      subhead: "Your match officials and venue team — reception, managers, groundstaff and admins. Open anyone to edit their details.",
      render: () => <VenueStaffPanel state={state} venueToken={venueToken} onRefresh={onRefresh} />,
    },
    {
      id: "coaches",
      label: "Coaches & DBS",
      subhead: "Coaches assigned to each club team, with their DBS / safeguarding records.",
      render: () => <ClubCoachesTab venueToken={venueToken} />,
    },
  ];
  return <TabbedPage tabs={tabs} />;
}

// Shared cell renderers for the two staff tables.
const STATUS_FILTERS = [
  { id: "active", label: "Active", test: (r) => r.active !== false },
  { id: "inactive", label: "Inactive", test: (r) => r.active === false },
];

function ContactCell({ row }) {
  const contacts = [row.phone, row.email].filter(Boolean);
  if (contacts.length === 0) return <span className="text-mute">—</span>;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {contacts.map((c, i) => <span key={i} className="chip-contact">{c}</span>)}
    </span>
  );
}

function StatusCell({ row }) {
  return row.active === false
    ? <span className="text-mute">Inactive</span>
    : <span>Active</span>;
}

function VenueStaffPanel({ state, venueToken, onRefresh }) {
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

  const activeRefs = refs.filter((r) => r.active !== false).length;
  const activeStaff = (staff || []).filter((s) => s.active !== false).length;

  const officialCols = useMemo(() => [
    { key: "name", label: "Official", sortable: true,
      render: (r) => <strong>{r.name}</strong> },
    { key: "type", label: "Type",
      render: (r) => <span style={{ textTransform: "capitalize" }}>{(r.employment_type || "freelance").replace("_", " ")}</span> },
    { key: "rating", label: "Rating",
      sortValue: (r) => Number(r.overall_rating) || 0,
      render: (r) => (r.overall_rating != null ? <StarRating n={Math.round(Number(r.overall_rating))} /> : <span className="text-mute">—</span>) },
    { key: "channel", label: "Preferred",
      render: (r) => <span className="chip-contact preferred">{r.preferred_channel || "push"}</span> },
    { key: "contact", label: "Contact", render: (r) => <ContactCell row={r} /> },
    { key: "status", label: "Status", render: (r) => <StatusCell row={r} /> },
  ], []);

  const staffCols = useMemo(() => [
    { key: "name", label: "Name", sortable: true,
      render: (r) => <strong>{r.name}</strong> },
    { key: "role", label: "Role",
      render: (r) => `${ROLE_LABEL[r.role] || "Staff"}${r.notes ? ` · ${r.notes}` : ""}` },
    { key: "channel", label: "Preferred",
      render: (r) => <span className="chip-contact preferred">{r.preferred_channel || "email"}</span> },
    { key: "contact", label: "Contact", render: (r) => <ContactCell row={r} /> },
    { key: "status", label: "Status", render: (r) => <StatusCell row={r} /> },
  ], []);

  return (
    <div>
      <section style={{ marginBottom: "var(--gap-3)" }}>
        <SectionHead label="Match officials" count={`${activeRefs} active`}>
          <button className="btn btn-sm btn-primary" onClick={() => setRefForm({ open: true, row: null })}>
            <Icon name="plus" size={14} /> Add official
          </button>
        </SectionHead>
        <DataTable
          columns={officialCols}
          rows={refs}
          getRowKey={(r) => r.id}
          searchFields={["name", "phone", "email"]}
          searchPlaceholder="Search officials…"
          filters={STATUS_FILTERS}
          initialSort={{ key: "name", dir: "asc" }}
          onRowClick={(r) => setRefForm({ open: true, row: r })}
          empty={{ title: "No officials yet", body: "Add a referee to assign them to fixtures." }}
        />
      </section>

      <section>
        <SectionHead label="Venue staff" count={staff == null ? "loading…" : `${activeStaff} active`}>
          <button className="btn btn-sm btn-primary" onClick={() => setStaffForm({ open: true, row: null })}>
            <Icon name="plus" size={14} /> Add staff
          </button>
        </SectionHead>
        {staffErr ? (
          <div className="dt-empty"><div className="dt-empty-title">Couldn’t load staff</div><div className="text-mute">{staffErr}</div></div>
        ) : (
          <DataTable
            columns={staffCols}
            rows={staff}
            getRowKey={(r) => r.id}
            searchFields={["name", "phone", "email"]}
            searchPlaceholder="Search staff…"
            filters={STATUS_FILTERS}
            initialSort={{ key: "name", dir: "asc" }}
            onRowClick={(r) => setStaffForm({ open: true, row: r })}
            empty={{ title: "No venue staff yet", body: "Add reception, managers, groundstaff and admins here." }}
          />
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
