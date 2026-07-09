// ClubAdminPeople.jsx — Club-admin track, screen 2 ("People"), mounted at /hub for a
// club_admin role, tab "people". The phone twin of the desktop club lens's people
// directories, scoped to the ONE club whose shell venue the caller owns
// (Club Console PR #6b, Decision 10).
//
// Read-only roster for a club admin on their phone: the coaching team (each coach
// with a DBS status chip) and the club's enrolled members. NO writes — approvals,
// DBS edits and enrolment all stay on the desktop console / the Today tab.
//
// AUTH: a club admin passes their shell venue_id as the credential (role.entityId /
// venueToken). resolve_venue_caller Stage-1b authenticates them via auth.uid()
// against venue_admins — the same venue-token path ClubAdminToday, the operator
// track and the desktop console use. clubId (role.clubId) scopes the club-staff read.
// No token, no new RPC.
//
// Reuses existing venue-token wrappers only (no new backend):
//   • venueListClubStaff(venue_id, clubId) → array, ONE ROW PER (coach, team). A
//     coach on two teams appears twice → DEDUPED by member_profile_id below (each
//     coach shown once, their team names joined). Carries the DBS fields the chip needs.
//   • venueListMembers(venue_id)           → members[] — the ENROLLED members
//     (venue_memberships, cancelled excluded). This is the "Members" segment.
//   • venueListCustomersPeople(venue_id)   → customers[] — the people roster, the
//     ONLY source carrying status='pending'. Used here ONLY for a read-only "awaiting
//     approval" count (venue_list_members has no 'pending' state). Approve lives on Today.
//
// MEMBERS CHOICE: "Members" = venueListMembers (enrolled venue_memberships), because
// that is the real membership record with tier + status; venueListCustomersPeople is
// the wider people roster and is used here only to surface the pending-count hint.
//
// COMMITTEE is intentionally OMITTED: clubListCommittee is auth.uid-scoped, not
// venue-token, so a club_admin on the venue-token path cannot call it. It needs a
// future venue-token committee reader before it can appear here.

import { useState, useEffect, useCallback, useMemo } from "react";
import { venueListClubStaff, venueListMembers, venueListCustomersPeople } from "@platform/core";
import MIcon from "../icons.jsx";

// DBS severity — a verbatim port of ClubAdminToday.dbsSeverity (itself a port of the
// desktop SafeguardingBoard.dbsChip): 60-day expiring window; missing/invalid → crit.
// Kept identical so the phone list, the Today glance and the console all agree.
function dbsSeverity(row) {
  if (!row.dbs_id || !row.dbs_status) return { tone: "crit", label: "No DBS" };
  const s = String(row.dbs_status).toLowerCase();
  if (s === "valid" || s === "verified" || s === "clear") {
    if (row.dbs_expiry_date) {
      const days = (new Date(row.dbs_expiry_date + "T00:00:00").getTime() - Date.now()) / 86400000;
      if (Number.isNaN(days)) return { tone: "warn", label: "Check" };
      if (days < 0) return { tone: "crit", label: "Expired" };
      if (days <= 60) return { tone: "warn", label: "Expiring" };
    }
    return { tone: "ok", label: "Valid" };
  }
  return { tone: "crit", label: "Not valid" };
}

const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Unnamed";

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Deterministic HSL tint when a person has no stored brand colour (matches OperatorPeople).
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

// Coach roles (club_team_managers.role) → readable label.
const ROLE_LABEL = {
  head_coach: "Head coach", assistant: "Assistant coach", assistant_coach: "Assistant coach",
  coach: "Coach", manager: "Manager", physio: "Physio", other: "Coach",
};
const roleLabel = (r) => ROLE_LABEL[String(r || "").toLowerCase()] || cap(r) || "Coach";

const TABS = [["coaches", "Coaches"], ["members", "Members"]];

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

// DBS chip — tone in {ok, warn, crit} from dbsSeverity.
function Chip({ tone, text }) {
  const bg = tone === "crit" ? "var(--live-soft)" : tone === "warn" ? "var(--amber-soft)" : "var(--ok-soft)";
  const ink = tone === "crit" ? "var(--live)" : tone === "warn" ? "var(--amber)" : "var(--ok-ink)";
  return (
    <span style={{
      height: 22, fontSize: 11, padding: "0 9px", borderRadius: "var(--r-pill)", display: "inline-flex",
      alignItems: "center", gap: 4, fontWeight: 700, flex: "none", background: bg, color: ink,
    }}><MIcon name="shield" size={12} color={ink} />{text}</span>
  );
}

function PersonRow({ name, sub, trailing, onClick }) {
  return (
    <button className="m-card" onClick={onClick} style={{
      width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer",
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 13, marginBottom: 9,
    }}>
      <Avatar name={name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        {sub != null && (
          <div style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
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

export default function ClubAdminPeople({ venueToken, clubId, clubName, toast }) {
  const [tab, setTab] = useState("coaches");
  const [q, setQ] = useState("");
  const [state, setState] = useState({ loading: true, error: false, staff: [], members: [], pending: 0 });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setState({ loading: false, error: false, staff: [], members: [], pending: 0 }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [staff, members, customers] = await Promise.all([
        venueListClubStaff(venueToken, clubId),
        venueListMembers(venueToken).catch(() => []),
        venueListCustomersPeople(venueToken).catch(() => []),
      ]);
      const pending = (Array.isArray(customers) ? customers : []).filter((c) => c.status === "pending").length;
      setState({
        loading: false, error: false,
        staff: Array.isArray(staff) ? staff : [],
        members: Array.isArray(members) ? members : [],
        pending,
      });
    } catch {
      setState({ loading: false, error: true, staff: [], members: [], pending: 0 });
    }
  }, [venueToken, clubId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, staff, members, pending } = state;
  const needle = q.trim().toLowerCase();

  // Coaches — venue_list_club_staff returns one row per (coach, team), so DEDUPE by
  // member_profile_id: each coach shown once, their team names joined, active if
  // active on any team. DBS is per (member_profile_id, club) so identical across rows.
  const coachRows = useMemo(() => {
    const byPerson = new Map();
    for (const r of staff) {
      const key = r.member_profile_id || `${r.first_name || ""}|${r.last_name || ""}`;
      const existing = byPerson.get(key);
      if (existing) {
        if (r.team_name && !existing._teams.includes(r.team_name)) existing._teams.push(r.team_name);
        existing._active = existing._active || r.is_active !== false;
      } else {
        byPerson.set(key, { ...r, _teams: r.team_name ? [r.team_name] : [], _active: r.is_active !== false });
      }
    }
    return [...byPerson.values()]
      .map((r) => ({ ...r, _name: fullName(r), _sev: dbsSeverity(r) }))
      .filter((r) => !needle || r._name.toLowerCase().includes(needle) || r._teams.join(" ").toLowerCase().includes(needle))
      // crit first, then warn, then ok — worst DBS surfaces at the top.
      .sort((a, b) => {
        const rank = { crit: 0, warn: 1, ok: 2 };
        return (rank[a._sev.tone] - rank[b._sev.tone]) || a._name.localeCompare(b._name);
      });
  }, [staff, needle]);

  const memberRows = useMemo(() => {
    return (members || [])
      .map((m) => ({ ...m, _name: fullName(m) }))
      .filter((m) => !needle
        || m._name.toLowerCase().includes(needle)
        || String(m.email || "").toLowerCase().includes(needle)
        || String(m.tier_name || "").toLowerCase().includes(needle))
      .sort((a, b) => a._name.localeCompare(b._name));
  }, [members, needle]);

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">People</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading people for {clubName || "your club"}…</p>
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

  const tapCoach = (c) => toast?.({ icon: "shield", text: c._name, sub: [roleLabel(c.role), c._teams.join(" · ")].filter(Boolean).join(" · ") || c._sev.label });
  const tapMember = (m) => toast?.({ icon: "users", text: m._name, sub: m.tier_name || cap(m.status) || "Member" });

  return (
    <div>
      {/* ── segmented control ── */}
      <div style={{ display: "flex", gap: 4, padding: 5, background: "var(--s2)", borderRadius: 14, marginTop: 6, border: "1px solid var(--hair)" }}>
        {TABS.map(([id, label]) => {
          const on = tab === id;
          const count = id === "coaches" ? coachRows.length : memberRows.length;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              flex: 1, height: 36, borderRadius: 10, border: "none", cursor: "pointer",
              fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 13.5, transition: "color .2s, background .2s",
              background: on ? "var(--s4)" : "transparent", color: on ? "var(--ink)" : "var(--ink3)",
            }}>{label}{needle ? "" : ` · ${count}`}</button>
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

      {/* ── lists ── */}
      <div style={{ marginTop: 14 }}>
        {tab === "coaches" && (
          coachRows.length === 0
            ? <EmptyCard icon="shield" text={needle ? "No coaches match that search" : "No coaches yet"} />
            : coachRows.map((c) => (
                <PersonRow key={c.member_profile_id || c._name}
                  name={c._name}
                  sub={[roleLabel(c.role), c._teams.join(" · "), c._active ? null : "Inactive"].filter(Boolean).join(" · ")}
                  trailing={<Chip tone={c._sev.tone} text={c._sev.label} />}
                  onClick={() => tapCoach(c)} />
              ))
        )}

        {tab === "members" && (
          <>
            {pending > 0 && (
              <div className="m-card" style={{
                display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", marginBottom: 10,
                background: "var(--amber-soft)", border: "1px solid var(--amber-glow)",
              }}>
                <MIcon name="users" size={18} color="var(--amber)" />
                <div style={{ fontSize: 12.5, color: "var(--amber)", fontWeight: 700 }}>
                  {pending} awaiting approval · review on Today or the desktop console
                </div>
              </div>
            )}
            {memberRows.length === 0
              ? <EmptyCard icon="users" text={needle ? "No members match that search" : "No members yet"} />
              : memberRows.map((m) => (
                  <PersonRow key={m.membership_id || m._name}
                    name={m._name}
                    sub={[m.tier_name || "Member", m.status && m.status !== "active" ? cap(m.status) : null].filter(Boolean).join(" · ")}
                    onClick={() => tapMember(m)} />
                ))}
          </>
        )}
      </div>
    </div>
  );
}
