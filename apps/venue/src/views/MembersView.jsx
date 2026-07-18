import React, { useEffect, useState, useMemo } from "react";
import { venueListAllMembers } from "@platform/core/storage/supabase.js";
import { DataTable, TabbedPage } from "./PageKit.jsx";
import { getInitials } from "../lib/format.js";

// Members page (Venue People & Spaces IA). ONE unified, filterable directory of everyone
// connected to the venue — MEMBERS (on a membership plan) UNION PAY-AS-YOU-GO (venue
// customers with class/room bookings but no live membership), read via the single shared
// venue_list_all_members RPC (mig 603). The mobile /hub operator Members tab reads the SAME
// RPC with the SAME facet set, so desktop and app can't drift.
//
// Two tabs: Members (the unified list, filterable by type / status / payment / membership /
// team) and Guardians (derived client-side by inverting member -> guardians). Operational
// membership management (enrol / freeze / cancel) stays on the Memberships screen.

const M_STATUS = {
  active: { label: "Active", cls: "pill-ok" },
  ending: { label: "Ending", cls: "pill-warn" },
  paused: { label: "Frozen", cls: "pill-info" },
  payg:   { label: "Pay-as-you-go", cls: "pill-muted" },
};
const TYPE_LABEL = { member: "Member", payg: "Pay-as-you-go" };

const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(" ").trim();

// pence → "£12" / "£12.50"
const gbp = (pence) => { const n = Number(pence) || 0; return `£${(n / 100).toFixed(n % 100 ? 2 : 0)}`; };

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

// ── Filter bar — single-select dropdown per facet ("all" = no filter). Combined with AND,
// mirrored 1:1 by the mobile MemberFilterSheet so the two surfaces filter identically. ──
const selStyle = {
  height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--line, #2a2f3a)",
  background: "var(--bg-2, #171b22)", color: "var(--ink, #e8eaed)", fontSize: 13,
};
function FilterBar({ f, setF, tiers, teams }) {
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const anyActive = ["type", "status", "pay", "tier", "team"].some((k) => f[k] !== "all");
  const Sel = ({ k, children }) => (<select value={f[k]} onChange={set(k)} style={selStyle}>{children}</select>);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span className="text-mute" style={{ fontSize: 12.5, fontWeight: 600 }}>Filter</span>
      <Sel k="type"><option value="all">All types</option><option value="member">Members</option><option value="payg">Pay-as-you-go</option></Sel>
      <Sel k="status"><option value="all">Any status</option><option value="active">Active</option><option value="paused">Paused</option><option value="ending">Ending</option></Sel>
      <Sel k="pay"><option value="all">Any payment</option><option value="owing">Owing</option><option value="paid">Paid up</option></Sel>
      {tiers.length > 0 && <Sel k="tier"><option value="all">Any membership</option>{tiers.map((t) => <option key={t} value={t}>{t}</option>)}</Sel>}
      {teams.length > 0 && <Sel k="team"><option value="all">Any team</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}</Sel>}
      {anyActive && (
        <button className="chip" onClick={() => setF({ type: "all", status: "all", pay: "all", tier: "all", team: "all" })}>Clear</button>
      )}
    </div>
  );
}

// ── Members tab ──────────────────────────────────────────────────────────────
function MembersTab({ members, error }) {
  const [f, setF] = useState({ type: "all", status: "all", pay: "all", tier: "all", team: "all" });

  const tiers = useMemo(() => Array.from(new Set((members || []).map((m) => m.tier_name).filter(Boolean))).sort(), [members]);
  const teams = useMemo(() => Array.from(new Set((members || []).map((m) => m.team_name).filter(Boolean))).sort(), [members]);

  const filtered = useMemo(() => {
    if (!Array.isArray(members)) return members; // null → DataTable shows loading
    return members
      .filter((m) => f.type === "all" || m.person_type === f.type)
      .filter((m) => f.status === "all" || m.status === f.status)
      .filter((m) => f.pay === "all" || (f.pay === "owing" ? Number(m.balance_pence) > 0 : Number(m.balance_pence) <= 0))
      .filter((m) => f.tier === "all" || (m.tier_name || "") === f.tier)
      .filter((m) => f.team === "all" || (m.team_name || "") === f.team);
  }, [members, f]);

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
    { key: "person_type", label: "Type", sortable: true, sortValue: (m) => m.person_type || "",
      render: (m) => <span className={"pill " + (m.person_type === "payg" ? "pill-muted" : "pill-info")}>{TYPE_LABEL[m.person_type] || "—"}</span> },
    { key: "tier_name", label: "Plan", sortable: true,
      render: (m) => m.person_type === "payg" ? <span className="text-mute">—</span>
        : <span>{m.tier_name || "—"}{m.period && <span className="text-mute"> · {m.period}</span>}</span> },
    { key: "team_name", label: "Team", sortable: true, render: (m) => m.team_name || <span className="text-mute">—</span> },
    { key: "status", label: "Status", sortable: true, render: (m) => {
      const st = M_STATUS[m.status] || { label: m.status || "—", cls: "pill-muted" };
      return <span className={"pill " + st.cls}>{st.label}</span>;
    } },
    { key: "balance", label: "Balance", align: "num", sortable: true, sortValue: (m) => Number(m.balance_pence) || 0,
      render: (m) => { const b = Number(m.balance_pence) || 0;
        return b > 0 ? <span className="pill pill-warn">{gbp(b)}</span>
          : (m.person_type === "payg" ? <span className="text-mute">—</span> : <span className="text-mute">Paid up</span>); } },
    { key: "age", label: "Age", align: "num", sortable: true,
      sortValue: (m) => ageFromDob(m.dob) ?? 999,
      render: (m) => { const a = ageFromDob(m.dob); return a == null ? "—" : a; } },
    { key: "guardians", label: "Guardian", render: (m) => <GuardianChips guardians={m.guardians} /> },
  ];

  return (
    <>
      <FilterBar f={f} setF={setF} tiers={tiers} teams={teams} />
      <DataTable
        columns={columns}
        rows={filtered}
        getRowKey={(m) => (m.person_type || "m") + "-" + (m.membership_id || m.customer_id)}
        searchFn={(m, q) => fullName(m).toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q) || (m.tier_name || "").toLowerCase().includes(q) || (m.team_name || "").toLowerCase().includes(q)}
        searchPlaceholder="Search members…"
        filters={[
          { id: "minors", label: "Under 18", test: (m) => { const a = ageFromDob(m.dob); return a != null && a < 18; } },
          { id: "hasguardian", label: "Has guardian", test: (m) => Array.isArray(m.guardians) && m.guardians.length > 0 },
        ]}
        initialSort={{ key: "name", dir: "asc" }}
        empty={{ title: "No members yet", body: "Members and pay-as-you-go customers appear here as they’re enrolled or added." }}
        noMatch={{ title: "No members match", body: "Try a different search or filter." }}
      />
    </>
  );
}

// ── Guardians tab (derived from members[].guardians) ─────────────────────────
function GuardiansTab({ members, error }) {
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
    venueListAllMembers(venueToken)
      .then((rows) => { if (alive) setMembers(Array.isArray(rows) ? rows : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  const tabs = [
    { id: "members", label: "Members",
      subhead: "Everyone connected to your venue — members on a plan and pay-as-you-go customers. Filter by type, status, payment, membership or team. Enrol, freeze and cancel live on the Memberships screen.",
      render: () => <MembersTab members={members} error={error} /> },
    { id: "guardians", label: "Guardians",
      subhead: "Every parent or guardian linked to an under-18 member, and the members they look after.",
      render: () => <GuardiansTab members={members} error={error} /> },
  ];

  return <TabbedPage tabs={tabs} />;
}
