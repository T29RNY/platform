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

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  venueListAllMembers, venueGetState, venueListStaff,
  venueGetTeamRoster, venueCreateCustomer, venueAddStaff,
  venueListClubTeams, venueListClubs, clubListCohorts, clubCreateTeam,
  clubListLeads,
} from "@platform/core";
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

// pence → "£12" / "£12.50"
function gbp(pence) {
  const n = Number(pence) || 0;
  return `£${(n / 100).toFixed(n % 100 ? 2 : 0)}`;
}

// Person-type + membership-status labels for the unified members list.
const TYPE_LABEL = { member: "Member", payg: "Pay-as-you-go" };
const STATUS_LABEL = { active: "Active", paused: "Paused", ending: "Ending", payg: "Pay-as-you-go" };

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

const TABS = [["members", "Members"], ["teams", "Teams"], ["staff", "Staff"], ["enquiries", "Enquiries"]];

// child_school_year (mig 588 convention: Reception=0, negative=pre-school) → label.
function schoolYearLabel(y) {
  if (y == null) return null;
  if (y < 0) return "Pre-school";
  if (y === 0) return "Reception";
  return `Year ${y}`;
}
const LEAD_STATUS_LABEL = { new: "New", contacted: "Contacted", converted: "Booked", closed: "Closed" };

// club_teams.gender → label (matches club_create_team's allowed set).
const GENDER_LABEL = { mixed: "Mixed", boys: "Boys", girls: "Girls" };

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
  const [filterOpen, setFilterOpen] = useState(false);          // staff type sheet
  const [mFilterOpen, setMFilterOpen] = useState(false);         // members filter sheet
  const [mFilters, setMFilters] = useState({ type: "all", status: "all", pay: "all", tier: "all", team: "all" });
  const [state, setState] = useState({ loading: true, error: false, members: null, teams: [], clubTeams: [], staff: [], leads: [] });
  const [detail, setDetail] = useState(null);   // { kind: "member"|"team"|"clubteam"|"staff", row } — detail sheet
  const [addOpen, setAddOpen] = useState(null);  // "member" | "staff" | "team" — create sheet

  // Honest role proxy for the prototype's staff_directory cap (no caps reach the client).
  const canSeeContacts = roleSub === "owner" || roleSub === "manager";

  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, members: [], teams: [], clubTeams: [], staff: [], leads: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // Club teams + trial enquiries are secondary reads — a failure there must not blank
      // the whole People screen (venue teams + members + staff are the primary content).
      const [members, vstate, staff, clubTeamsRes, leads] = await Promise.all([
        venueListAllMembers(venueId),
        venueGetState(venueId),
        venueListStaff(venueId),
        venueListClubTeams(venueId).catch(() => null),
        clubListLeads(venueId).catch(() => []),
      ]);
      const teamsDict = vstate?.teams || {};
      const teams = Object.values(teamsDict).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      const clubTeams = Array.isArray(clubTeamsRes?.teams) ? clubTeamsRes.teams : [];
      setState({ loading: false, error: false, members: members || [], teams, clubTeams, staff: staff?.staff || [], leads: Array.isArray(leads) ? leads : [] });
    } catch {
      setState((s) => ({ ...s, loading: false, error: true }));
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, members, teams, clubTeams, staff, leads } = state;
  const needle = q.trim().toLowerCase();

  const memberRows = useMemo(() => {
    if (!members) return [];
    return members
      .map((m) => ({ ...m, _name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || "Unnamed" }))
      .filter((m) => !needle
        || m._name.toLowerCase().includes(needle)
        || String(m.email || "").toLowerCase().includes(needle)
        || String(m.phone || "").toLowerCase().includes(needle))
      .filter((m) => mFilters.type === "all" || m.person_type === mFilters.type)
      .filter((m) => mFilters.status === "all" || m.status === mFilters.status)
      .filter((m) => mFilters.pay === "all"
        || (mFilters.pay === "owing" ? Number(m.balance_pence) > 0 : Number(m.balance_pence) <= 0))
      .filter((m) => mFilters.tier === "all" || (m.tier_name || "") === mFilters.tier)
      .filter((m) => mFilters.team === "all" || (m.team_name || "") === mFilters.team);
  }, [members, needle, mFilters]);

  // Distinct tiers/teams present (filter-sheet options) + active non-"all" filter count.
  const memberTiers = useMemo(() => Array.from(new Set((members || []).map((m) => m.tier_name).filter(Boolean))).sort(), [members]);
  const memberTeams = useMemo(() => Array.from(new Set((members || []).map((m) => m.team_name).filter(Boolean))).sort(), [members]);
  const mActiveFilters = ["type", "status", "pay", "tier", "team"].filter((k) => mFilters[k] !== "all").length;

  const teamRows = useMemo(() => {
    return (teams || []).filter((t) => !needle || String(t.name || "").toLowerCase().includes(needle));
  }, [teams, needle]);

  const clubTeamRows = useMemo(() => {
    return (clubTeams || []).filter((t) => !needle
      || String(t.name || "").toLowerCase().includes(needle)
      || String(t.club_name || "").toLowerCase().includes(needle)
      || String(t.cohort_name || "").toLowerCase().includes(needle));
  }, [clubTeams, needle]);

  const staffRows = useMemo(() => {
    return (staff || []).filter((s) => {
      const role = STAFF_ROLES.some(([id]) => id === s.role) ? s.role : "other";
      return staffTypes.has(role) && (!needle || String(s.name || "").toLowerCase().includes(needle));
    });
  }, [staff, needle, staffTypes]);

  const staffHidden = STAFF_ROLES.length - staffTypes.size;

  const leadRows = useMemo(() => {
    return (leads || []).filter((l) => !needle
      || String(l.parent_name || "").toLowerCase().includes(needle)
      || String(l.parent_email || "").toLowerCase().includes(needle)
      || String(l.parent_phone || "").toLowerCase().includes(needle)
      || String(l.child_first_name || "").toLowerCase().includes(needle));
  }, [leads, needle]);

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

  return (
    <div>
      {/* ── segmented control ── */}
      <div style={{ display: "flex", gap: 4, padding: 5, background: "var(--s2)", borderRadius: 14, marginTop: 6, border: "1px solid var(--hair)" }}>
        {/* Enquiries hold family PII → owner/manager only (server also enforces manage_memberships). */}
        {TABS.filter(([id]) => id !== "enquiries" || canSeeContacts).map(([id, label]) => {
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

      {/* ── search + (members) Add on ONE row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <div className="m-card" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, padding: "0 14px", height: 44, background: "var(--s2)" }}>
          <MIcon name="search" size={18} color="var(--ink3)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}…`}
            style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15 }} />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear search" style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}>
              <MIcon name="x" size={16} color="var(--ink3)" />
            </button>
          )}
        </div>
        {/* Members: filter (all roles) + Add (owner/manager only, venue_create_customer cap) */}
        {tab === "members" && (
          <button onClick={() => setMFilterOpen(true)} style={{
            height: 44, padding: "0 14px", borderRadius: "var(--r-pill)", cursor: "pointer", flex: "none",
            display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13,
            background: mActiveFilters > 0 ? "var(--amber-soft)" : "var(--s2)", color: mActiveFilters > 0 ? "var(--amber)" : "var(--ink2)",
            border: "1px solid", borderColor: mActiveFilters > 0 ? "var(--amber)" : "var(--hair)",
          }}>
            <MIcon name="list" size={15} />{mActiveFilters > 0 ? String(mActiveFilters) : "Filter"}
          </button>
        )}
        {tab === "members" && canSeeContacts && (
          <AddPill label="Add" onClick={() => setAddOpen("member")} />
        )}
        {/* Add team — creates a CLUB team (club_create_team); owner/manager only */}
        {tab === "teams" && canSeeContacts && (
          <AddPill label="Add" onClick={() => setAddOpen("team")} />
        )}
      </div>

      {/* ── staff type filter row + add staff ── */}
      {tab === "staff" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <span style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 600 }}>
            {staffTypes.size === STAFF_ROLES.length ? "All staff" : `${staffTypes.size} ${staffTypes.size === 1 ? "type" : "types"}`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <AddPill label="Add" onClick={() => setAddOpen("staff")} />
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
        </div>
      )}

      {/* ── lists ── */}
      <div style={{ marginTop: 14 }}>
        {tab === "members" && (
          memberRows.length === 0
            ? <EmptyCard icon="users" text={needle || mActiveFilters ? "No members match those filters" : "No members yet"} />
            : memberRows.map((m) => {
                const owing = Number(m.balance_pence) > 0;
                const sub = m.person_type === "payg"
                  ? "Pay-as-you-go"
                  : [m.tier_name, m.team_name, m.status === "active" ? null : STATUS_LABEL[m.status] || cap(m.status)].filter(Boolean).join(" · ") || "Member";
                return (
                  <PersonRow key={(m.person_type || "m") + "-" + (m.membership_id || m.customer_id || m._name)}
                    left={<Avatar name={m._name} />} name={m._name} sub={sub}
                    trailing={owing ? (
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--live-ink, #d1453b)", background: "var(--live-soft, rgba(209,69,59,0.12))",
                        borderRadius: "var(--r-pill)", padding: "3px 9px", flex: "none" }}>{gbp(m.balance_pence)}</span>
                    ) : undefined}
                    onClick={() => setDetail({ kind: "member", row: m })} />
                );
              })
        )}

        {tab === "teams" && (
          teamRows.length === 0 && clubTeamRows.length === 0
            ? <EmptyCard icon="shield" text={needle ? "No teams match that search" : "No teams yet"} />
            : (
              <>
                {/* Venue teams (casual / league teams — venue_get_state.teams) */}
                {teamRows.length > 0 && <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>Venue teams</div>}
                {teamRows.map((t) => (
                  <PersonRow key={t.id} accent={t.primary_colour || undefined}
                    left={<Crest team={t} name={t.name} />} name={t.name || "Team"} sub={null} onClick={() => setDetail({ kind: "team", row: t })} />
                ))}

                {/* Club teams (grassroots club_teams under cohorts — venue_list_club_teams) */}
                {clubTeamRows.length > 0 && <div className="m-eyebrow" style={{ margin: `${teamRows.length ? 18 : 0}px 2px 9px` }}>Club teams</div>}
                {clubTeamRows.map((t) => (
                  <PersonRow key={t.team_id}
                    left={<Crest name={t.name} />} name={t.name || "Team"}
                    sub={[t.club_name, t.cohort_name, GENDER_LABEL[t.gender]].filter(Boolean).join(" · ") || null}
                    trailing={<span style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 700, flex: "none" }}>{Number(t.member_count) || 0}</span>}
                    onClick={() => setDetail({ kind: "clubteam", row: t })} />
                ))}
              </>
            )
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
                    onClick={() => setDetail({ kind: "staff", row: s })} />
                );
              })
        )}

        {tab === "enquiries" && (
          leadRows.length === 0
            ? <EmptyCard icon="mail" text={needle ? "No enquiries match that search" : "No trial enquiries yet"} />
            : leadRows.map((l) => {
                const childLine = [l.child_first_name, schoolYearLabel(l.child_school_year)].filter(Boolean).join(" · ");
                const date = l.created_at ? new Date(l.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
                const statusLabel = LEAD_STATUS_LABEL[l.status] || cap(l.status || "new");
                return (
                  <div key={l.id} className="m-card" style={{ padding: "13px 14px", marginBottom: 9 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={l.parent_name} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.parent_name || "Enquiry"}</div>
                        {childLine && <div style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 500, marginTop: 2 }}>{childLine}</div>}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink2)", background: "var(--s3)", borderRadius: "var(--r-pill)", padding: "3px 9px", flex: "none" }}>{statusLabel}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", marginTop: 10 }}>
                      {l.parent_email && (
                        <a href={`mailto:${encodeURIComponent(l.parent_email)}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--amber)", fontWeight: 600, textDecoration: "none", minWidth: 0 }}>
                          <MIcon name="mail" size={14} color="var(--amber)" /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.parent_email}</span>
                        </a>
                      )}
                      {l.parent_phone && (
                        <a href={`tel:${encodeURIComponent(l.parent_phone)}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--amber)", fontWeight: 600, textDecoration: "none" }}>
                          <MIcon name="phone" size={14} color="var(--amber)" />{l.parent_phone}
                        </a>
                      )}
                      {date && <span style={{ fontSize: 12, color: "var(--ink4)", fontWeight: 500, marginLeft: "auto" }}>{date}</span>}
                    </div>
                  </div>
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

      {mFilterOpen && (
        <MemberFilterSheet
          filters={mFilters} setFilters={setMFilters}
          tiers={memberTiers} teams={memberTeams}
          onClose={() => setMFilterOpen(false)}
        />
      )}

      {detail && (
        <PersonDetailSheet detail={detail} canSeeContacts={canSeeContacts} venueId={venueId} onClose={() => setDetail(null)} />
      )}
      {addOpen === "member" && (
        <AddMemberSheet venueId={venueId} toast={toast} onClose={() => setAddOpen(null)} onDone={() => { setAddOpen(null); load(); }} />
      )}
      {addOpen === "staff" && (
        <AddStaffSheet venueId={venueId} toast={toast} onClose={() => setAddOpen(null)} onDone={() => { setAddOpen(null); load(); }} />
      )}
      {addOpen === "team" && (
        <AddTeamSheet venueId={venueId} toast={toast} onClose={() => setAddOpen(null)} onDone={() => { setAddOpen(null); load(); }} />
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

// ── Members filter sheet — Type / Status / Payment / Membership / Team, all single-select
// (value "all" = no filter). Client-side over the unified venue_list_all_members rows so a
// new facet never needs an RPC change. Mirrored 1:1 by the desktop MembersView filters. ──
function MemberFilterSheet({ filters, setFilters, tiers, teams, onClose }) {
  const anyActive = ["type", "status", "pay", "tier", "team"].some((k) => filters[k] !== "all");
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const Group = ({ label, k, options }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink3)", margin: "0 2px 8px" }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[["all", "All"], ...options].map(([v, lbl]) => {
          const on = filters[k] === v;
          return (
            <button key={v} onClick={() => set(k, v)} style={{
              padding: "8px 13px", borderRadius: "var(--r-pill)", cursor: "pointer",
              fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
              background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--amber)" : "var(--ink3)",
              border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)",
            }}>{lbl}</button>
          );
        })}
      </div>
    </div>
  );
  return (
    <MobileSheet title="Filter members" onClose={onClose} footer={
      <button onClick={onClose} style={{
        width: "100%", height: 48, borderRadius: 14, border: "none", cursor: "pointer",
        fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, background: "var(--amber)", color: "var(--amber-ink)",
      }}>Show results</button>
    }>
      {anyActive && (
        <button onClick={() => setFilters({ type: "all", status: "all", pay: "all", tier: "all", team: "all" })} style={{
          width: "100%", height: 40, marginBottom: 14, borderRadius: 12, cursor: "pointer",
          background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--amber)",
          fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 14,
        }}>Clear all filters</button>
      )}
      <Group label="Type" k="type" options={[["member", "Members"], ["payg", "Pay-as-you-go"]]} />
      <Group label="Membership status" k="status" options={[["active", "Active"], ["paused", "Paused"], ["ending", "Ending"]]} />
      <Group label="Payment" k="pay" options={[["owing", "Owing"], ["paid", "Paid up"]]} />
      {tiers.length > 0 && <Group label="Membership" k="tier" options={tiers.map((t) => [t, t])} />}
      {teams.length > 0 && <Group label="Team" k="team" options={teams.map((t) => [t, t])} />}
    </MobileSheet>
  );
}

// ── Add pill (Members / Staff tabs) ──
function AddPill({ label, onClick }) {
  return (
    <button onClick={onClick} style={{
      height: 34, padding: "0 13px", borderRadius: "var(--r-pill)", cursor: "pointer",
      display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13,
      background: "var(--amber-soft)", color: "var(--amber)", border: "1px solid var(--amber-glow)",
    }}>
      <MIcon name="plus" size={15} color="var(--amber)" /> {label}
    </button>
  );
}

// ── Detail sheet (member / staff / team) — built from row data already fetched;
// team lazily loads its roster via the existing venue_get_team_roster reader. ──
function fmtDate(d) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return null; }
}

function DetailRow({ icon, k, v }) {
  if (v == null || v === "") return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 0", borderBottom: "1px solid var(--hair)" }}>
      <MIcon name={icon} size={16} color="var(--ink3)" />
      <span style={{ flex: 1, fontSize: 13, color: "var(--ink3)", fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", maxWidth: "60%", textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

function SheetHeader({ left, title, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 6 }}>
      {left}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function LockNote() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--ink4)", fontSize: 12.5 }}>
      <MIcon name="key" size={13} color="var(--ink4)" /> Contact details are visible to managers &amp; owners.
    </div>
  );
}

function PersonDetailSheet({ detail, canSeeContacts, venueId, onClose }) {
  const { kind, row } = detail;
  const [roster, setRoster] = useState(null);
  useEffect(() => {
    if (kind !== "team") return;
    let alive = true;
    venueGetTeamRoster(venueId, row.id)
      .then((r) => { if (alive) setRoster(r?.ok ? r : { players: [], competitions: [] }); })
      .catch(() => { if (alive) setRoster({ players: [], competitions: [] }); });
    return () => { alive = false; };
  }, [kind, venueId, row.id]);

  if (kind === "member") {
    const name = `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Member";
    const isPayg = row.person_type === "payg";
    const owing = Number(row.balance_pence) > 0;
    const guardians = Array.isArray(row.guardians) ? row.guardians : [];
    return (
      <MobileSheet title={isPayg ? "Pay-as-you-go" : "Member"} onClose={onClose}>
        <SheetHeader left={<Avatar name={name} size={52} />} title={name}
          sub={isPayg ? "Pay-as-you-go" : [row.tier_name, STATUS_LABEL[row.status] || cap(row.status)].filter(Boolean).join(" · ") || "Member"} />
        {!isPayg && <DetailRow icon="trophy" k="Membership" v={row.tier_name} />}
        {!isPayg && <DetailRow icon="shield" k="Team" v={row.team_name} />}
        {!isPayg && <DetailRow icon="users" k="Cohort" v={row.cohort_name} />}
        {!isPayg && <DetailRow icon="clock" k="Status" v={[STATUS_LABEL[row.status] || cap(row.status), row.period].filter(Boolean).join(" · ") || null} />}
        {!isPayg && <DetailRow icon="info" k="Balance" v={owing ? `${gbp(row.balance_pence)} owed` : "Paid up"} />}
        {canSeeContacts && <DetailRow icon="mail" k="Email" v={row.email} />}
        {canSeeContacts && <DetailRow icon="phone" k="Phone" v={row.phone} />}
        <DetailRow icon="calendar" k="Date of birth" v={fmtDate(row.dob)} />
        {canSeeContacts && guardians.length > 0 && (
          <>
            <div className="m-eyebrow" style={{ margin: "14px 2px 6px" }}>Guardians</div>
            {guardians.map((g, i) => (
              <DetailRow key={i}
                icon="users"
                k={[g.relationship, g.is_primary ? "primary" : null].filter(Boolean).join(" · ") || "Guardian"}
                v={[g.name, g.phone || g.email].filter(Boolean).join(" · ") || null} />
            ))}
          </>
        )}
        {!isPayg && <DetailRow icon="clock" k="Joined" v={fmtDate(row.started_at)} />}
        {!canSeeContacts && <LockNote />}
      </MobileSheet>
    );
  }
  if (kind === "staff") {
    return (
      <MobileSheet title="Staff" onClose={onClose}>
        <SheetHeader left={<RoleTile icon={ROLE_META[row.role] || "users"} size={52} />} title={row.name || "Staff"}
          sub={cap(row.role) + (row.active === false ? " · inactive" : "")} />
        {canSeeContacts ? (
          <>
            <DetailRow icon="mail" k="Email" v={row.email} />
            <DetailRow icon="phone" k="Phone" v={row.phone} />
            <DetailRow icon="whatsapp" k="WhatsApp" v={row.whatsapp_number} />
            <DetailRow icon="bell" k="Prefers" v={row.preferred_channel ? cap(row.preferred_channel) : null} />
            <DetailRow icon="list" k="Notes" v={row.notes} />
          </>
        ) : <LockNote />}
        <DetailRow icon="clock" k="Added" v={fmtDate(row.created_at)} />
      </MobileSheet>
    );
  }
  if (kind === "clubteam") {
    // Grassroots club team (club_teams). All fields come from venue_list_club_teams
    // — no extra roster read (the venue_get_team_roster reader is league-team only).
    return (
      <MobileSheet title="Club team" onClose={onClose}>
        <SheetHeader left={<Crest name={row.name} size={52} />} title={row.name || "Team"} sub={row.club_name || "Club team"} />
        <DetailRow icon="shield" k="Club" v={row.club_name} />
        <DetailRow icon="users" k="Cohort" v={row.cohort_name} />
        <DetailRow icon="flag" k="Type" v={GENDER_LABEL[row.gender] || null} />
        <DetailRow icon="figure" k="Members" v={String(Number(row.member_count) || 0)} />
      </MobileSheet>
    );
  }

  // team
  const players = roster?.players || [];
  const comps = roster?.competitions || [];
  return (
    <MobileSheet title="Team" onClose={onClose}>
      <SheetHeader left={<Crest team={row} name={row.name} size={52} />} title={row.name || "Team"} sub="Team" />
      {comps.length > 0 && <DetailRow icon="trophy" k="Competitions" v={comps.map((c) => c.name).join(", ")} />}
      <div className="m-eyebrow" style={{ margin: "14px 2px 8px" }}>{roster == null ? "Squad" : `Squad · ${players.length}`}</div>
      {roster == null
        ? <p style={{ color: "var(--ink3)", fontSize: 13 }}>Loading roster…</p>
        : players.length === 0
          ? <p style={{ color: "var(--ink3)", fontSize: 13 }}>No players in this squad yet.</p>
          : players.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: "1px solid var(--hair)" }}>
                <Avatar name={p.name} size={34} r={10} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.nickname || p.name || "Player"}</span>
                {p.shirt_number != null && <span style={{ fontSize: 13, color: "var(--ink3)", fontWeight: 700 }}>#{p.shirt_number}</span>}
              </div>
            ))}
    </MobileSheet>
  );
}

// ── Add forms (reuse the existing venue_add_staff / venue_create_customer RPCs) ──
function FieldLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink3)", margin: "12px 2px 6px" }}>{children}</div>;
}
function TextField({ value, onChange, placeholder, type = "text", autoFocus }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} autoFocus={autoFocus}
      style={{ width: "100%", height: 44, padding: "0 13px", borderRadius: 12, boxSizing: "border-box",
        background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15, outline: "none" }} />
  );
}
// Styled <select> — options are [value, label] pairs.
function SelectField({ value, onChange, placeholder, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", height: 44, padding: "0 11px", borderRadius: 12, boxSizing: "border-box",
        background: "var(--s2)", border: "1px solid var(--hair)", color: value ? "var(--ink)" : "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 15, outline: "none" }}>
      <option value="">{placeholder}</option>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}
function TextArea({ value, onChange, placeholder }) {
  return (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2}
      style={{ width: "100%", padding: "10px 13px", borderRadius: 12, boxSizing: "border-box", resize: "vertical", minHeight: 64,
        background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15, lineHeight: 1.4, outline: "none" }} />
  );
}
// Pill picker — options are [value, label] pairs; single-select.
function PillPicker({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map(([id, label]) => {
        const on = value === id;
        return (
          <button key={id} onClick={() => onChange(id)} style={{
            padding: "8px 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
            fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
            background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--amber)" : "var(--ink3)",
            border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)",
          }}>{label}</button>
        );
      })}
    </div>
  );
}
function ConsentRow({ on, onToggle, label }) {
  return (
    <button onClick={onToggle} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", marginBottom: 8, borderRadius: 12, cursor: "pointer",
      textAlign: "left", background: "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)", color: "inherit",
    }}>
      <span style={{ width: 24, height: 24, borderRadius: 7, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
        background: on ? "var(--amber)" : "var(--s3)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair2)" }}>
        {on && <MIcon name="check" size={14} color="var(--amber-ink)" />}
      </span>
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
    </button>
  );
}
function FooterBtn({ label, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", height: 48, borderRadius: 14, border: "none", cursor: disabled ? "default" : "pointer",
      fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, background: "var(--amber)", color: "var(--amber-ink)", opacity: disabled ? 0.6 : 1,
    }}>{label}</button>
  );
}

// Preferred-channel options — mirrors the desktop StaffMemberForm CHANNELS +
// the venue_staff.preferred_channel CHECK (whatsapp|sms|email|push).
const STAFF_CHANNELS = [["email", "Email"], ["whatsapp", "WhatsApp"], ["sms", "SMS"], ["push", "Push"]];

function AddStaffSheet({ venueId, toast, onClose, onDone }) {
  // Fields + payload MIRROR the desktop StaffMemberForm (apps/venue) exactly —
  // name / role / phone / whatsapp_number / email / preferred_channel / notes,
  // same venue_add_staff RPC — so a staff member added here is identical to one
  // added on the desktop console (no duplicate/divergent field set).
  const [f, setF] = useState({ name: "", role: "reception", phone: "", whatsapp: "", email: "", channel: "email", notes: "" });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    if (savingRef.current) return;
    if (!f.name.trim()) { toast?.({ icon: "alert", text: "Name required" }); return; }
    savingRef.current = true; setSaving(true);
    try {
      await venueAddStaff(venueId, {
        name: f.name.trim(),
        role: f.role,
        phone: f.phone.trim() || null,
        whatsapp_number: f.whatsapp.trim() || null,
        email: f.email.trim() || null,
        preferred_channel: f.channel,
        notes: f.notes.trim() || null,
      });
      toast?.({ icon: "check", text: "Staff added", sub: f.name.trim() });
      onDone();
    } catch (e) {
      console.error("[people] add staff failed", e);
      toast?.({ icon: "alert", text: "Couldn't add staff", sub: "Try again" });
      savingRef.current = false; setSaving(false);
    }
  };
  return (
    <MobileSheet title="Add staff" onClose={onClose} footer={<FooterBtn label={saving ? "Adding…" : "Add staff"} disabled={saving} onClick={submit} />}>
      <FieldLabel>Name</FieldLabel>
      <TextField value={f.name} onChange={set("name")} placeholder="Full name" autoFocus />
      <FieldLabel>Role</FieldLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {STAFF_ROLES.map(([id, , icon]) => {
          const on = f.role === id;
          return (
            <button key={id} onClick={() => set("role")(id)} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: "var(--r-pill)", cursor: "pointer",
              fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
              background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--amber)" : "var(--ink3)",
              border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)",
            }}>
              <MIcon name={icon} size={14} color={on ? "var(--amber)" : "var(--ink3)"} /> {cap(id)}
            </button>
          );
        })}
      </div>
      <FieldLabel>Phone</FieldLabel>
      <TextField value={f.phone} onChange={set("phone")} placeholder="+44…" type="tel" />
      <FieldLabel>WhatsApp</FieldLabel>
      <TextField value={f.whatsapp} onChange={set("whatsapp")} placeholder="+44…" type="tel" />
      <FieldLabel>Email</FieldLabel>
      <TextField value={f.email} onChange={set("email")} placeholder="name@venue.com" type="email" />
      <FieldLabel>Preferred channel</FieldLabel>
      <PillPicker value={f.channel} onChange={set("channel")} options={STAFF_CHANNELS} />
      <FieldLabel>Notes</FieldLabel>
      <TextArea value={f.notes} onChange={set("notes")} placeholder="Shifts, responsibilities, anything useful" />
    </MobileSheet>
  );
}

function AddMemberSheet({ venueId, toast, onClose, onDone }) {
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", dob: "", guardianName: "", guardianPhone: "" });
  const [consentData, setConsentData] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    if (savingRef.current) return;
    if (!f.firstName.trim()) { toast?.({ icon: "alert", text: "First name required" }); return; }
    if (!consentData || !consentTerms) { toast?.({ icon: "alert", text: "Both consents are required", sub: "Data processing + terms" }); return; }
    savingRef.current = true; setSaving(true);
    try {
      await venueCreateCustomer(venueId, {
        firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email.trim(), phone: f.phone.trim(),
        dob: f.dob || null, guardianName: f.guardianName.trim(), guardianPhone: f.guardianPhone.trim(),
        consentDataProcessing: true, consentTerms: true,
      });
      toast?.({ icon: "check", text: "Member added", sub: f.firstName.trim() });
      onDone();
    } catch (e) {
      console.error("[people] add member failed", e);
      const msg = String(e?.message || "");
      const map = {
        customer_exists: "Already in your directory",
        consent_required: "Both consents are required",
        guardian_required: "Under-18 needs a guardian name + phone",
        medical_consent_required: "Medical consent is required",
        insufficient_role: "Only managers & owners can add members",
      };
      const hitKey = Object.keys(map).find((k) => msg.includes(k));
      toast?.({ icon: "alert", text: hitKey ? map[hitKey] : "Couldn't add member", sub: hitKey ? undefined : "Try again" });
      savingRef.current = false; setSaving(false);
    }
  };
  return (
    <MobileSheet title="Add member" onClose={onClose} footer={<FooterBtn label={saving ? "Adding…" : "Add member"} disabled={saving} onClick={submit} />}>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><FieldLabel>First name</FieldLabel><TextField value={f.firstName} onChange={set("firstName")} placeholder="First" autoFocus /></div>
        <div style={{ flex: 1 }}><FieldLabel>Last name</FieldLabel><TextField value={f.lastName} onChange={set("lastName")} placeholder="Last" /></div>
      </div>
      <FieldLabel>Email</FieldLabel>
      <TextField value={f.email} onChange={set("email")} placeholder="name@email.com" type="email" />
      <FieldLabel>Phone</FieldLabel>
      <TextField value={f.phone} onChange={set("phone")} placeholder="Phone" type="tel" />
      <FieldLabel>Date of birth</FieldLabel>
      <TextField value={f.dob} onChange={set("dob")} placeholder="YYYY-MM-DD" type="date" />
      <div className="m-eyebrow" style={{ margin: "16px 2px 6px" }}>If under 18 — guardian</div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><FieldLabel>Guardian name</FieldLabel><TextField value={f.guardianName} onChange={set("guardianName")} placeholder="Name" /></div>
        <div style={{ flex: 1 }}><FieldLabel>Guardian phone</FieldLabel><TextField value={f.guardianPhone} onChange={set("guardianPhone")} placeholder="Phone" type="tel" /></div>
      </div>
      <div className="m-eyebrow" style={{ margin: "16px 2px 8px" }}>Consent — required</div>
      <ConsentRow on={consentData} onToggle={() => setConsentData((v) => !v)} label="Consents to storing & processing their data" />
      <ConsentRow on={consentTerms} onToggle={() => setConsentTerms((v) => !v)} label="Agrees to the membership terms" />
    </MobileSheet>
  );
}

// ── Add a CLUB team (reuses club_create_team, mig 389) ──
// The Teams tab shows venue teams (read-only here — no create RPC) AND club teams;
// this creates a club team, the only creatable kind. Requires a club + a cohort in
// it. Server gates on the manage_memberships cap and validates club∈venue, cohort∈club.
// Gender / stream — matches the desktop TeamModal GENDER_OPTS (girls/boys/mixed);
// "Any" is the mobile affordance for the desktop's null default.
const GENDER_CHOICES = [["", "Any"], ["girls", "Girls"], ["boys", "Boys"], ["mixed", "Mixed"]];
function AddTeamSheet({ venueId, toast, onClose, onDone }) {
  const [clubs, setClubs] = useState(null);     // null = loading, [] = none
  const [clubId, setClubId] = useState("");
  const [cohorts, setCohorts] = useState(null); // null = loading/unset, [] = none
  const [cohortId, setCohortId] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");     // "" | girls | boys | mixed  (mirrors desktop gender)
  const [rank, setRank] = useState("");         // priority_rank — "" = null; 1 = top side (mirrors desktop)
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Clubs linked to this venue (the club picker options).
  useEffect(() => {
    let alive = true;
    venueListClubs(venueId)
      .then((c) => { if (alive) setClubs(Array.isArray(c) ? c : []); })
      .catch(() => { if (alive) setClubs([]); });
    return () => { alive = false; };
  }, [venueId]);

  // Cohorts reload whenever the chosen club changes; the cohort choice resets.
  useEffect(() => {
    if (!clubId) { setCohorts(null); setCohortId(""); return; }
    let alive = true;
    setCohorts(null); setCohortId("");
    clubListCohorts(venueId, clubId, false)
      .then((c) => { if (alive) setCohorts(Array.isArray(c) ? c : []); })
      .catch(() => { if (alive) setCohorts([]); });
    return () => { alive = false; };
  }, [venueId, clubId]);

  const noClubs = Array.isArray(clubs) && clubs.length === 0;

  const submit = async () => {
    if (savingRef.current) return;
    if (!clubId) { toast?.({ icon: "alert", text: "Pick a club" }); return; }
    if (!cohortId) { toast?.({ icon: "alert", text: "Pick a cohort" }); return; }
    if (!name.trim()) { toast?.({ icon: "alert", text: "Team name required" }); return; }
    savingRef.current = true; setSaving(true);
    try {
      await clubCreateTeam(venueId, clubId, { cohortId, name: name.trim(), gender: gender || null, priorityRank: rank === "" ? null : Number(rank) });
      toast?.({ icon: "check", text: "Team created", sub: name.trim() });
      onDone();
    } catch (e) {
      console.error("[people] add club team failed", e);
      const msg = String(e?.message || "");
      const map = {
        insufficient_role: "Only managers & owners can add teams",
        name_required: "Team name required",
        invalid_gender: "Pick a valid team type",
        club_not_found: "That club isn't linked to this venue",
        cohort_not_found: "Pick a cohort in the chosen club",
      };
      const hit = Object.keys(map).find((k) => msg.includes(k));
      toast?.({ icon: "alert", text: hit ? map[hit] : "Couldn't create team", sub: hit ? undefined : "Try again" });
      savingRef.current = false; setSaving(false);
    }
  };

  return (
    <MobileSheet title="Add team" onClose={onClose}
      footer={<FooterBtn label={saving ? "Creating…" : "Create team"} disabled={saving || noClubs} onClick={submit} />}>
      {clubs === null ? (
        <p style={{ color: "var(--ink3)", fontSize: 14, padding: "8px 2px" }}>Loading clubs…</p>
      ) : noClubs ? (
        <div className="m-card" style={{ padding: "20px 16px", textAlign: "center", color: "var(--ink3)" }}>
          <MIcon name="shield" size={22} color="var(--ink4)" />
          <div style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.45 }}>No clubs are linked to this venue yet. Create one on the desktop console, then add its teams here.</div>
        </div>
      ) : (
        <>
          {/* Only club teams are form-created (same as the desktop console). League
              teams register into a competition; casual teams appear from bookings —
              so there's no casual/league "add" here on either surface. */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 2px 12px", fontSize: 12.5, color: "var(--ink3)", lineHeight: 1.4 }}>
            <MIcon name="info" size={14} color="var(--ink4)" style={{ flex: "none", marginTop: 1 }} />
            <span>Creates a <strong style={{ color: "var(--ink2)" }}>club team</strong>. League teams register into a competition; casual teams appear from pitch bookings.</span>
          </div>
          <FieldLabel>Club</FieldLabel>
          <SelectField value={clubId} onChange={setClubId} placeholder="Pick a club…" options={clubs.map((c) => [c.id, c.name])} />
          <FieldLabel>Cohort</FieldLabel>
          {!clubId ? (
            <p style={{ color: "var(--ink4)", fontSize: 12.5, padding: "2px 2px 0" }}>Pick a club first.</p>
          ) : cohorts === null ? (
            <p style={{ color: "var(--ink3)", fontSize: 12.5, padding: "2px 2px 0" }}>Loading cohorts…</p>
          ) : cohorts.length === 0 ? (
            <p style={{ color: "var(--ink4)", fontSize: 12.5, padding: "2px 2px 0", lineHeight: 1.4 }}>No cohorts (age groups) in this club yet — add one on the desktop console first.</p>
          ) : (
            <SelectField value={cohortId} onChange={setCohortId} placeholder="Pick a cohort…" options={cohorts.map((c) => [c.cohort_id, c.name])} />
          )}
          <FieldLabel>Team name</FieldLabel>
          <TextField value={name} onChange={setName} placeholder="e.g. U7 Lions" />
          <FieldLabel>Gender / stream</FieldLabel>
          <PillPicker value={gender} onChange={setGender} options={GENDER_CHOICES} />
          <FieldLabel>Priority (optional)</FieldLabel>
          <TextField value={rank} onChange={setRank} placeholder="e.g. 1 — top side" type="number" />
        </>
      )}
    </MobileSheet>
  );
}
