// OperatorPeople.jsx — Operator track, screen 4 ("People"), mounted at /hub for an
// operator role (owner | manager | staff), tab "people".
//
// Honest mobile re-presentation of the laptop venue dashboard's people/teams/staff
// directories (apps/venue CustomersView / TeamsView / StaffView) in the scoped amber
// theme. THREE existing reads, no new RPC:
//   • venueListCustomersPeople(venue_id) → customers[] (the Members tab)
//   • venueGetState(venue_id).teams      → {id:{name, brand colours}} (the Teams tab)
//   • venueListStaff(venue_id)           → staff[] (the Staff tab)
//
// AUTH: a mobile operator passes their venue_id as the credential. resolve_venue_caller
// stage 1b authenticates them via auth.uid() against venue_admins — the same path the
// laptop app uses, the same one Tonight / Bookings / Payments use. No token, no new RPC.
//
// Honest adaptations vs the prototype (settled in audit):
//   • Members rows drop the fabricated shirt-number + GOALS stat (venue_customers has
//     neither). Sub = membership tier or status.
//   • Teams rows drop the fabricated "N competitions" sub (venue_get_state.teams carries
//     no count). Row = brand crest + name only.
//   • Staff types are the SIX real venue_staff roles (manager/reception/admin/
//     groundstaff/coach/other). The prototype's "Officials" type + referee rating chips
//     are dropped (no referee role in venue_staff, no ratings).
//   • Contact-gating: the prototype hides staff contacts behind a `staff_directory` cap.
//     The mobile client receives NO caps (get_my_world / venue_get_state carry none) and
//     the laptop StaffView does not actually enforce the cap either. So this is an honest
//     ROLE PROXY, not the literal cap: owners + managers see contacts; plain staff see
//     the role only + a lock hint.
//   • Row tap = a name/context toast (the prototype's affordance) — there is no mobile
//     person-detail sheet / read RPC, so none is invented.

import { useState, useEffect, useCallback, useMemo } from "react";
import { venueListCustomersPeople, venueGetState, venueListStaff } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Deterministic HSL tint when a person/team has no stored brand colour.
function hueFor(name) {
  let h = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function cap(s) {
  const t = String(s || "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

// Brand-colour crest for a team; the colour is DB-sourced (not a hardcoded literal).
function Crest({ team, name, size = 46, r = 14 }) {
  const label = team?.name || name || "—";
  const c1 = team?.primary_colour || null;
  const c2 = team?.secondary_colour || team?.primary_colour || null;
  const hue = hueFor(label);
  const bg = c1
    ? `linear-gradient(135deg, ${c1} 0 55%, ${c2} 100%)`
    : `linear-gradient(135deg, hsl(${hue} 46% 42%) 0 52%, hsl(${hue} 46% 30%) 100%)`;
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: bg, color: "white", fontSize: size * 0.32, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(label)}</div>
  );
}

// Neutral initials avatar (Members tab — venue_customers carry no brand colour).
function Avatar({ name, size = 46, r = 14 }) {
  const hue = hueFor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, hsl(${hue} 30% 36%) 0 55%, hsl(${hue} 30% 26%) 100%)`,
      color: "white", fontSize: size * 0.32, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(name)}</div>
  );
}

// Role icon tile (Staff tab).
function RoleTile({ icon, size = 46, r = 14 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s3)",
    }}><MIcon name={icon} size={size * 0.46} color="var(--ink2)" /></div>
  );
}

// The six real venue_staff roles → [id, plural label, icon].
const STAFF_ROLES = [
  ["manager", "Managers", "cog"],
  ["reception", "Reception", "phone"],
  ["admin", "Admin", "key"],
  ["groundstaff", "Groundstaff", "flag"],
  ["coach", "Coaches", "whistle"],
  ["other", "Other", "users"],
];
const ROLE_META = Object.fromEntries(STAFF_ROLES.map(([id, , icon]) => [id, icon]));

const TABS = [["members", "Members"], ["teams", "Teams"], ["staff", "Staff"]];

function PersonRow({ left, name, sub, locked, trailing, accent, onClick }) {
  return (
    <button className="m-card" onClick={onClick} style={{
      width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer",
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 13, marginBottom: 9,
      position: "relative", overflow: "hidden",
    }}>
      {accent && <span style={{ position: "absolute", left: 0, top: 9, bottom: 9, width: 3, borderRadius: "0 3px 3px 0", background: accent }} />}
      {left}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        {sub != null && (
          <div style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 500, marginTop: 2, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {locked && <MIcon name="key" size={11} color="var(--ink4)" />}{sub}
          </div>
        )}
      </div>
      {trailing || <MIcon name="chevron" size={16} color="var(--ink4)" />}
    </button>
  );
}

function EmptyCard({ icon, text }) {
  return (
    <div className="m-card" style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink3)" }}>
      <MIcon name={icon} size={24} color="var(--ink4)" />
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "var(--ink2)" }}>{text}</div>
    </div>
  );
}

export default function OperatorPeople({ venueId, venueName, roleSub, toast }) {
  const [tab, setTab] = useState("members");
  const [q, setQ] = useState("");
  const [staffTypes, setStaffTypes] = useState(() => new Set(STAFF_ROLES.map(([id]) => id)));
  const [filterOpen, setFilterOpen] = useState(false);
  const [state, setState] = useState({ loading: true, error: false, members: null, teams: [], staff: [] });

  // Honest role proxy for the prototype's staff_directory cap (no caps reach the client).
  const canSeeContacts = roleSub === "owner" || roleSub === "manager";

  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, members: [], teams: [], staff: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [members, vstate, staff] = await Promise.all([
        venueListCustomersPeople(venueId),
        venueGetState(venueId),
        venueListStaff(venueId),
      ]);
      const teamsDict = vstate?.teams || {};
      const teams = Object.values(teamsDict).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      setState({ loading: false, error: false, members: members || [], teams, staff: staff?.staff || [] });
    } catch {
      setState((s) => ({ ...s, loading: false, error: true }));
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, members, teams, staff } = state;
  const needle = q.trim().toLowerCase();

  const memberRows = useMemo(() => {
    if (!members) return [];
    return members
      .map((m) => ({ ...m, _name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || "Unnamed" }))
      .filter((m) => !needle
        || m._name.toLowerCase().includes(needle)
        || String(m.email || "").toLowerCase().includes(needle)
        || String(m.phone || "").toLowerCase().includes(needle));
  }, [members, needle]);

  const teamRows = useMemo(() => {
    return (teams || []).filter((t) => !needle || String(t.name || "").toLowerCase().includes(needle));
  }, [teams, needle]);

  const staffRows = useMemo(() => {
    return (staff || []).filter((s) => {
      const role = STAFF_ROLES.some(([id]) => id === s.role) ? s.role : "other";
      return staffTypes.has(role) && (!needle || String(s.name || "").toLowerCase().includes(needle));
    });
  }, [staff, needle, staffTypes]);

  const staffHidden = STAFF_ROLES.length - staffTypes.size;

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">People</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading people for {venueName || "your venue"}…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">People</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load people right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  const tapMember = (m) => toast?.({ icon: "users", text: m._name, sub: m.requested_tier_name || cap(m.status) || "Member" });
  const tapTeam = (t) => toast?.({ icon: "shield", text: t.name || "Team", sub: "Team" });
  const tapStaff = (s) => {
    const roleLabel = cap(s.role);
    toast?.({ icon: ROLE_META[s.role] || "users", text: s.name || "Staff", sub: canSeeContacts ? [roleLabel, s.email || s.phone].filter(Boolean).join(" · ") : roleLabel });
  };

  return (
    <div>
      {/* ── segmented control ── */}
      <div style={{ display: "flex", gap: 4, padding: 5, background: "var(--s2)", borderRadius: 14, marginTop: 6, border: "1px solid var(--hair)" }}>
        {TABS.map(([id, label]) => {
          const on = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              flex: 1, height: 36, borderRadius: 10, border: "none", cursor: "pointer",
              fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13.5, transition: "color .2s, background .2s",
              background: on ? "var(--s4)" : "transparent", color: on ? "var(--ink)" : "var(--ink3)",
            }}>{label}</button>
          );
        })}
      </div>

      {/* ── search ── */}
      <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 14px", height: 44, marginTop: 12, background: "var(--s2)" }}>
        <MIcon name="search" size={18} color="var(--ink3)" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}…`}
          style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15 }} />
        {q && (
          <button onClick={() => setQ("")} aria-label="Clear search" style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}>
            <MIcon name="x" size={16} color="var(--ink3)" />
          </button>
        )}
      </div>

      {/* ── staff type filter row ── */}
      {tab === "staff" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <span style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 600 }}>
            {staffTypes.size === STAFF_ROLES.length ? "All staff" : `${staffTypes.size} ${staffTypes.size === 1 ? "type" : "types"}`}
          </span>
          <button onClick={() => setFilterOpen(true)} style={{
            height: 34, padding: "0 13px", borderRadius: "var(--r-pill)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13,
            background: staffHidden > 0 ? "var(--amber-soft)" : "var(--s2)", color: staffHidden > 0 ? "var(--amber)" : "var(--ink2)",
            border: "1px solid", borderColor: staffHidden > 0 ? "var(--amber)" : "var(--hair)",
          }}>
            <MIcon name="list" size={15} />
            {staffHidden > 0 ? `${staffHidden} hidden` : "Type"}
          </button>
        </div>
      )}

      {/* ── lists ── */}
      <div style={{ marginTop: 14 }}>
        {tab === "members" && (
          memberRows.length === 0
            ? <EmptyCard icon="users" text={needle ? "No members match that search" : "No members yet"} />
            : memberRows.map((m) => (
                <PersonRow key={m.id} left={<Avatar name={m._name} />} name={m._name}
                  sub={m.requested_tier_name || cap(m.status) || "Member"} onClick={() => tapMember(m)} />
              ))
        )}

        {tab === "teams" && (
          teamRows.length === 0
            ? <EmptyCard icon="shield" text={needle ? "No teams match that search" : "No teams yet"} />
            : teamRows.map((t) => (
                <PersonRow key={t.id} accent={t.primary_colour || undefined}
                  left={<Crest team={t} name={t.name} />} name={t.name || "Team"} sub={null} onClick={() => tapTeam(t)} />
              ))
        )}

        {tab === "staff" && (
          staffRows.length === 0
            ? <EmptyCard icon="users" text={needle || staffHidden > 0 ? "No staff match those filters" : "No staff yet"} />
            : staffRows.map((s) => {
                const roleLabel = cap(s.role);
                const contact = s.email || s.phone || s.whatsapp_number || null;
                const subParts = [roleLabel];
                if (canSeeContacts && contact) subParts.push(contact);
                if (!s.active) subParts.push("inactive");
                return (
                  <PersonRow key={s.id} left={<RoleTile icon={ROLE_META[s.role] || "users"} />}
                    name={s.name || "Staff"} sub={subParts.join(" · ")}
                    locked={!canSeeContacts && !!contact}
                    onClick={() => tapStaff(s)} />
                );
              })
        )}
      </div>

      {filterOpen && (
        <StaffTypeSheet
          selected={staffTypes}
          onToggle={(id) => setStaffTypes((prev) => {
            const next = new Set(prev);
            if (next.has(id)) { if (next.size > 1) next.delete(id); } else next.add(id);
            return next;
          })}
          onAll={() => setStaffTypes(new Set(STAFF_ROLES.map(([id]) => id)))}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}

function StaffTypeSheet({ selected, onToggle, onAll, onClose }) {
  const allOn = selected.size === STAFF_ROLES.length;
  return (
    <MobileSheet title="Staff type" onClose={onClose} footer={
      <button onClick={onClose} style={{
        width: "100%", height: 48, borderRadius: 14, border: "none", cursor: "pointer",
        fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, background: "var(--amber)", color: "var(--amber-ink)",
      }}>Done</button>
    }>
      <button onClick={onAll} disabled={allOn} style={{
        width: "100%", height: 42, marginBottom: 12, borderRadius: 12, cursor: allOn ? "default" : "pointer",
        background: "var(--s2)", border: "1px solid var(--hair)", color: allOn ? "var(--ink3)" : "var(--amber)",
        fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 14, opacity: allOn ? 0.6 : 1,
      }}>Show all</button>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {STAFF_ROLES.map(([id, label, icon]) => {
          const on = selected.has(id);
          return (
            <button key={id} onClick={() => onToggle(id)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 13, cursor: "pointer", textAlign: "left",
              background: "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)", color: "inherit",
            }}>
              <span style={{
                width: 38, height: 38, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                background: on ? "var(--amber)" : "var(--s3)",
              }}><MIcon name={icon} size={18} color={on ? "var(--amber-ink)" : "var(--ink2)"} /></span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{label}</span>
              {on && <MIcon name="check" size={18} color="var(--amber)" />}
            </button>
          );
        })}
      </div>
    </MobileSheet>
  );
}
