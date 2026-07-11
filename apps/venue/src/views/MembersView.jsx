import React, { useEffect, useState, useMemo } from "react";
import { venueListMembers } from "@platform/core/storage/supabase.js";
import { DataTable, TabbedPage } from "./PageKit.jsx";
import { getInitials } from "../lib/format.js";

// Members page (Venue People & Spaces IA, Phase 3). A read-only directory: one
// page, two tabs — Members (every member, their plan/status and who their
// guardian is) and Guardians (each parent/guardian and the members they look
// after). Both render through the shared DataTable primitive. Operational
// membership management (enrol / freeze / cancel / grading) stays on the
// Memberships screen until the Phase 5 consistency sweep.
//
// Backend: the single venue_list_members reader (extended in mig 410 to embed a
// `guardians` array + `dob` per member). The Guardians view is derived client-side
// by inverting the member -> guardians mapping, so there's one source of truth.

const M_STATUS = {
  active: { label: "Active", cls: "pill-ok" },
  ending: { label: "Ending", cls: "pill-warn" },
  paused: { label: "Frozen", cls: "pill-info" },
};

const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(" ").trim();

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

function GuardianChips({ guardians }) {
  const list = Array.isArray(guardians) ? guardians : [];
  if (list.length === 0) return <span className="text-mute">—</span>;
  const primary = list.find((g) => g.is_primary) || list[0];
  const extra = list.length - 1;
  return (
    <span>
      {primary.name || "—"}
      {primary.relationship && <span className="text-mute"> · {primary.relationship}</span>}
      {extra > 0 && <span className="dt-pill" style={{ marginLeft: 8 }}>+{extra}</span>}
    </span>
  );
}

// ── Members tab ──────────────────────────────────────────────────────────────
function MembersTab({ members, error }) {
  if (error) return <div className="dt-empty"><div className="dt-empty-title">Couldn’t load members</div><div className="text-mute">{error}</div></div>;

  const columns = [
    { key: "name", label: "Member", sortable: true,
      sortValue: (m) => fullName(m).toLowerCase(),
      render: (m) => {
        const age = ageFromDob(m.dob);
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span className="cu-crest" style={{ width: 30, height: 30, background: "var(--bg-3)", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, fontSize: 11, color: "var(--ink-2)" }}>{getInitials(fullName(m))}</span>
            <span>{fullName(m) || "—"}{age != null && age < 18 && <span className="dt-pill" style={{ marginLeft: 8 }}>U18</span>}</span>
          </span>
        );
      } },
    { key: "age", label: "Age", align: "num", sortable: true,
      sortValue: (m) => ageFromDob(m.dob) ?? 999,
      render: (m) => { const a = ageFromDob(m.dob); return a == null ? "—" : a; } },
    { key: "discipline", label: "Discipline", sortable: true,
      render: (m) => { if (!m.discipline) return "—"; const d = m.discipline.replace(/_/g, " "); return d[0].toUpperCase() + d.slice(1); } },
    { key: "tier_name", label: "Plan", sortable: true,
      render: (m) => <span>{m.tier_name || "—"}{m.period && <span className="text-mute"> · {m.period}</span>}</span> },
    { key: "guardians", label: "Guardian", render: (m) => <GuardianChips guardians={m.guardians} /> },
    { key: "status", label: "Status", sortable: true, render: (m) => {
      const st = M_STATUS[m.status] || { label: m.status || "—", cls: "pill-muted" };
      return <span className={"pill " + st.cls}>{st.label}</span>;
    } },
  ];

  return (
    <DataTable
      columns={columns}
      rows={members}
      getRowKey={(m) => m.membership_id}
      searchFn={(m, q) => fullName(m).toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q) || (m.tier_name || "").toLowerCase().includes(q)}
      searchPlaceholder="Search members…"
      filters={[
        { id: "minors", label: "Under 18", test: (m) => { const a = ageFromDob(m.dob); return a != null && a < 18; } },
        { id: "hasguardian", label: "Has guardian", test: (m) => Array.isArray(m.guardians) && m.guardians.length > 0 },
        { id: "active", label: "Active", test: (m) => m.status === "active" },
      ]}
      initialSort={{ key: "name", dir: "asc" }}
      empty={{ title: "No members yet", body: "Members appear here once someone is enrolled onto a plan in Memberships." }}
      noMatch={{ title: "No members match", body: "Try a different search or filter." }}
    />
  );
}

// ── Guardians tab (derived from members[].guardians) ─────────────────────────
function GuardiansTab({ members, error }) {
  // Invert the member -> guardians mapping into one row per guardian, collecting
  // the (de-duplicated) members each one looks after.
  const guardians = useMemo(() => {
    if (!Array.isArray(members)) return null;
    const byId = new Map();
    for (const m of members) {
      const childKey = m.member_profile_id || m.membership_id;
      for (const g of (m.guardians || [])) {
        if (!g.profile_id) continue;
        let row = byId.get(g.profile_id);
        if (!row) {
          row = { profile_id: g.profile_id, name: g.name, email: g.email, phone: g.phone,
                  relationship: g.relationship, is_primary: !!g.is_primary, can_collect: !!g.can_collect,
                  invite_state: g.invite_state, _children: new Map() };
          byId.set(g.profile_id, row);
        }
        row.is_primary = row.is_primary || !!g.is_primary;
        row.can_collect = row.can_collect || !!g.can_collect;
        if (!row._children.has(childKey)) row._children.set(childKey, fullName(m) || "—");
      }
    }
    return Array.from(byId.values()).map((r) => ({ ...r, children: Array.from(r._children.values()) }));
  }, [members]);

  if (error) return <div className="dt-empty"><div className="dt-empty-title">Couldn’t load guardians</div><div className="text-mute">{error}</div></div>;

  const columns = [
    { key: "name", label: "Guardian", sortable: true,
      sortValue: (g) => (g.name || "").toLowerCase(),
      render: (g) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span className="cu-crest" style={{ width: 30, height: 30, background: "var(--bg-3)", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, fontSize: 11, color: "var(--ink-2)" }}>{getInitials(g.name)}</span>
          <span>{g.name || "—"}{g.is_primary && <span className="dt-pill" style={{ marginLeft: 8 }}>Primary</span>}</span>
        </span>
      ) },
    { key: "relationship", label: "Relationship", render: (g) => g.relationship || "—" },
    { key: "children", label: "Guardian of", sortable: true,
      sortValue: (g) => g.children.length,
      render: (g) => (
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
          {g.children.map((name, i) => <span key={i} className="dt-pill">{name}</span>)}
        </span>
      ) },
    { key: "contact", label: "Contact", render: (g) => {
      const bits = [g.email, g.phone].filter(Boolean);
      return bits.length ? <span className="text-mute" style={{ fontSize: 13 }}>{bits.join(" · ")}</span> : <span className="text-mute">—</span>;
    } },
    { key: "can_collect", label: "Can collect", align: "center",
      render: (g) => g.can_collect ? <span className="pill pill-ok">Yes</span> : <span className="text-mute">—</span> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={guardians}
      getRowKey={(g) => g.profile_id}
      searchFn={(g, q) => (g.name || "").toLowerCase().includes(q) || (g.children || []).some((c) => c.toLowerCase().includes(q))}
      searchPlaceholder="Search guardians or members…"
      initialSort={{ key: "name", dir: "asc" }}
      empty={{ title: "No guardians yet", body: "Guardians appear here once an under-18 member has a parent or guardian linked to their profile." }}
      noMatch={{ title: "No guardians match", body: "Try a different search." }}
    />
  );
}

export default function MembersPage({ venueToken }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    venueListMembers(venueToken)
      .then((rows) => { if (alive) setMembers(Array.isArray(rows) ? rows : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  const tabs = [
    { id: "members", label: "Members",
      subhead: "Everyone on a membership — their plan, status and who their guardian is. Browse-only; enrol, freeze and cancel live on the Memberships screen.",
      render: () => <MembersTab members={members} error={error} /> },
    { id: "guardians", label: "Guardians",
      subhead: "Every parent or guardian linked to an under-18 member, and the members they look after.",
      render: () => <GuardiansTab members={members} error={error} /> },
  ];

  return <TabbedPage tabs={tabs} />;
}
