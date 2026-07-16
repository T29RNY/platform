// ClubAdminPeople.jsx — Club-admin track, screen 2 ("People"), mounted at /hub for a
// club_admin role, tab "people". The phone twin of the desktop club lens's people
// directories, scoped to the ONE club whose shell venue the caller owns
// (Club Console PR #6b, Decision 10).
//
// Roster for a club admin on their phone: the coaching team (each coach with a DBS
// status chip) and the club's enrolled members. ONE write path lives here — adding
// or removing a TEAM-LESS session coach (club_coaches, mig 582) via the existing
// venue-token venueUpsertClubCoach / venueRemoveClubCoach (both manage_memberships-
// gated + audited; the same cap this club admin already uses for cohorts/comms).
// Everything else — approvals, DBS edits, enrolment, team-manager assignment — stays
// on the desktop console / the Today tab. Session coaches are PICKED from existing
// member_profiles (the club's members); minting a brand-new non-member coach needs a
// venue-token member_profiles-create RPC (does not exist yet) and is a tier-3 follow-up.
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
// COMMITTEE (mig 521): the club's "who's who" — chair/secretary/treasurer/welfare
// officer etc. Read via venueListClubCommittee, the venue-token twin of the
// coach-auth clubListCommittee, so a club_admin can now see it on the phone.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { venueListClubStaff, venueListClubCoaches, venueListMembers, venueListCustomersPeople, venueListClubCommittee, venueUpsertClubCoach, venueRemoveClubCoach } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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

// pence → £ (verbatim port of the money screens' gbp) + billing-cadence label, so
// the member detail sheet shows Price + period exactly as the desktop member card does.
function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
const PERIOD_SHORT = {
  monthly: "month", month: "month", annual: "year", yearly: "year", year: "year",
  weekly: "week", week: "week", quarterly: "quarter", termly: "term", one_off: "one-off", one_time: "one-off",
};
const periodLabel = (p) => PERIOD_SHORT[String(p || "").toLowerCase()] || (p ? String(p) : null);

// Coach roles (club_team_managers.role) → readable label.
const ROLE_LABEL = {
  head_coach: "Head coach", assistant: "Assistant coach", assistant_coach: "Assistant coach",
  coach: "Coach", manager: "Manager", physio: "Physio", session_lead: "Session lead", other: "Coach",
};
const roleLabel = (r) => ROLE_LABEL[String(r || "").toLowerCase()] || cap(r) || "Coach";

// The four team-less session-coach roles (club_coaches.role CHECK, mig 582), in
// picker order. Kept in lockstep with the RPC's allowed set — any drift throws
// invalid_role server-side.
const COACH_ROLE_OPTIONS = [
  ["coach", "Coach"],
  ["assistant_coach", "Assistant coach"],
  ["session_lead", "Session lead"],
  ["other", "Other"],
];

const TABS = [["coaches", "Coaches"], ["members", "Members"], ["committee", "Committee"]];

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
  const [detail, setDetail] = useState(null); // { kind: "coach"|"member"|"committee", row }
  const [adding, setAdding] = useState(false); // "Add session coach" sheet open
  const [state, setState] = useState({ loading: true, error: false, staff: [], coaches: [], members: [], pending: 0, committee: [] });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setState({ loading: false, error: false, staff: [], coaches: [], members: [], pending: 0, committee: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [staff, coaches, members, customers, committee] = await Promise.all([
        venueListClubStaff(venueToken, clubId),
        // Team-less session coaches (mig 582) — merged into the Coaches tab below; soft-caught.
        venueListClubCoaches(venueToken, clubId).catch(() => []),
        venueListMembers(venueToken).catch(() => []),
        venueListCustomersPeople(venueToken).catch(() => []),
        venueListClubCommittee(venueToken, clubId).catch(() => []),
      ]);
      const pending = (Array.isArray(customers) ? customers : []).filter((c) => c.status === "pending").length;
      setState({
        loading: false, error: false,
        staff: Array.isArray(staff) ? staff : [],
        coaches: Array.isArray(coaches) ? coaches : [],
        members: Array.isArray(members) ? members : [],
        pending,
        committee: Array.isArray(committee) ? committee : [],
      });
    } catch {
      setState({ loading: false, error: true, staff: [], coaches: [], members: [], pending: 0, committee: [] });
    }
  }, [venueToken, clubId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, staff, coaches, members, pending, committee } = state;
  const needle = q.trim().toLowerCase();

  // Coaches — venue_list_club_staff returns one row per (coach, team), so DEDUPE by
  // member_profile_id: each coach shown once, their team names joined, active if
  // active on any team. DBS is per (member_profile_id, club) so identical across rows.
  const coachRows = useMemo(() => {
    const byPerson = new Map();
    // Team-scoped managers (venue_list_club_staff) AND team-less session coaches
    // (venue_list_club_coaches, mig 582) share the Coaches tab; a person who is both
    // dedupes by member_profile_id, keeping every team name + active-if-active-anywhere.
    for (const r of [...staff, ...coaches]) {
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
  }, [staff, coaches, needle]);

  // Active team-less session coaches, keyed by member_profile_id. venue_list_club_coaches
  // returns is_active=true rows only, so this IS the removable set. Computed from `coaches`
  // directly (not coachRows) so it's robust to the staff-first dedupe order: a person who
  // is BOTH a team manager and a session coach is still recognised as removable here.
  const sessionCoachIds = useMemo(
    () => new Set((coaches || []).map((c) => c.member_profile_id).filter(Boolean)),
    [coaches],
  );

  const memberRows = useMemo(() => {
    return (members || [])
      .map((m) => ({ ...m, _name: fullName(m) }))
      .filter((m) => !needle
        || m._name.toLowerCase().includes(needle)
        || String(m.email || "").toLowerCase().includes(needle)
        || String(m.tier_name || "").toLowerCase().includes(needle))
      .sort((a, b) => a._name.localeCompare(b._name));
  }, [members, needle]);

  const committeeRows = useMemo(() => {
    return (committee || [])
      .map((c) => ({ ...c, _name: String(c.name || "").trim() || "Unnamed" }))
      .filter((c) => !needle
        || c._name.toLowerCase().includes(needle)
        || String(c.role || "").toLowerCase().includes(needle)
        || String(c.email || "").toLowerCase().includes(needle))
      .sort((a, b) => (a.display_order - b.display_order) || a._name.localeCompare(b._name));
  }, [committee, needle]);

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

  const tapCoach = (c) => setDetail({ kind: "coach", row: c });
  const tapMember = (m) => setDetail({ kind: "member", row: m });

  return (
    <div>
      {/* ── segmented control ── */}
      <div style={{ display: "flex", gap: 4, padding: 5, background: "var(--s2)", borderRadius: 14, marginTop: 6, border: "1px solid var(--hair)" }}>
        {TABS.map(([id, label]) => {
          const on = tab === id;
          const count = id === "coaches" ? coachRows.length : id === "members" ? memberRows.length : committeeRows.length;
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
          <>
            {!needle && (
              <button onClick={() => setAdding(true)} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "12px 14px", marginBottom: 11, borderRadius: "var(--r-md)", cursor: "pointer",
                background: "var(--amber-soft)", border: "1px dashed var(--amber-glow)", color: "var(--amber)",
                fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 14,
              }}>
                <MIcon name="plus" size={16} color="var(--amber)" /> Add session coach
              </button>
            )}
            {coachRows.length === 0
              ? <EmptyCard icon="shield" text={needle ? "No coaches match that search" : "No coaches yet"} />
              : coachRows.map((c) => (
                  <PersonRow key={c.member_profile_id || c._name}
                    name={c._name}
                    sub={[roleLabel(c.role), c._teams.join(" · "), c._active ? null : "Inactive"].filter(Boolean).join(" · ")}
                    trailing={<Chip tone={c._sev.tone} text={c._sev.label} />}
                    onClick={() => tapCoach(c)} />
                ))}
          </>
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

        {tab === "committee" && (
          committeeRows.length === 0
            ? <EmptyCard icon="users" text={needle ? "No committee match that search" : "No committee added yet · add on the desktop console"} />
            : committeeRows.map((c) => (
                <PersonRow key={c.committee_id || c._name}
                  name={c._name}
                  sub={[cap(c.role), c.email].filter(Boolean).join(" · ")}
                  trailing={c.is_welfare
                    ? <span style={{ height: 22, fontSize: 11, padding: "0 9px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, flex: "none", background: "var(--amber-soft)", color: "var(--amber)" }}><MIcon name="shield" size={12} color="var(--amber)" />Welfare</span>
                    : undefined}
                  onClick={() => setDetail({ kind: "committee", row: c })} />
              ))
        )}
      </div>

      {detail && (
        <PersonDetailSheet
          detail={detail}
          onClose={() => setDetail(null)}
          venueToken={venueToken}
          clubId={clubId}
          toast={toast}
          canRemove={detail.kind === "coach" && !!detail.row.member_profile_id && sessionCoachIds.has(detail.row.member_profile_id)}
          onRemoved={() => { setDetail(null); load(); }}
        />
      )}

      {adding && (
        <AddSessionCoachSheet
          venueToken={venueToken}
          clubId={clubId}
          toast={toast}
          members={members}
          sessionCoachIds={sessionCoachIds}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Detail sheet (coach / member / committee) — built from row data already
// fetched; no extra read. Club admins are owner/manager rank, so member contact
// (email/dob/guardians from venue_list_members) is theirs to see. No special-
// category medical PII is fetched by this screen. ──
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

function PersonDetailSheet({ detail, onClose, venueToken, clubId, toast, canRemove, onRemoved }) {
  const { kind, row } = detail;
  const [confirming, setConfirming] = useState(false); // first tap arms, second removes
  const [busy, setBusy] = useState(false);
  const removingRef = useRef(false);

  const remove = async () => {
    if (removingRef.current) return;
    if (!confirming) { setConfirming(true); return; }
    removingRef.current = true; setBusy(true);
    try {
      await venueRemoveClubCoach(venueToken, row.member_profile_id, clubId);
      toast?.({ icon: "check", text: "Session coach removed" });
      onRemoved?.();
    } catch (err) {
      console.error("[club-people] remove session coach failed", err);
      toast?.({ icon: "alert", text: "Couldn't remove — try again" });
      removingRef.current = false; setBusy(false); setConfirming(false);
    }
  };

  if (kind === "coach") {
    return (
      <MobileSheet title="Coach" onClose={onClose}>
        <SheetHeader left={<Avatar name={row._name} size={52} />} title={row._name} sub={roleLabel(row.role)} />
        <DetailRow icon="shield" k="DBS" v={row._sev.label} />
        {row.dbs_expiry_date && <DetailRow icon="calendar" k="DBS expiry" v={fmtDate(row.dbs_expiry_date)} />}
        <DetailRow icon="flag" k="Teams" v={row._teams.join(", ") || null} />
        <DetailRow icon="pulse" k="Status" v={row._active ? "Active" : "Inactive"} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 0", color: "var(--ink4)", fontSize: 12.5 }}>
          <MIcon name="key" size={13} color="var(--ink4)" /> DBS edits are on the desktop console.
        </div>
        {canRemove && (
          <>
            <button onClick={remove} disabled={busy} style={{
              width: "100%", marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "12px", borderRadius: "var(--r-sm)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
              background: "var(--live-soft)", border: "1px solid var(--live)", color: "var(--live)",
              fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 14,
            }}>
              <MIcon name="trash" size={15} color="var(--live)" />
              {busy ? "Removing…" : confirming ? "Tap again to remove" : "Remove session coach"}
            </button>
            <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 8, lineHeight: 1.4 }}>
              Removes them from the club’s session-coach roster only. A team coaching role, if any, is unaffected and stays on the desktop console.
            </div>
          </>
        )}
      </MobileSheet>
    );
  }

  if (kind === "member") {
    const guardians = Array.isArray(row.guardians) ? row.guardians : [];
    return (
      <MobileSheet title="Member" onClose={onClose}>
        <SheetHeader left={<Avatar name={row._name} size={52} />} title={row._name} sub={row.tier_name || cap(row.status) || "Member"} />
        <DetailRow icon="card" k="Tier" v={row.tier_name} />
        {row.amount_pence != null && (
          <DetailRow icon="pound" k="Price"
            v={`${gbp(row.amount_pence)}${periodLabel(row.period) ? ` / ${periodLabel(row.period)}` : ""}`} />
        )}
        <DetailRow icon="pulse" k="Status" v={cap(row.status)} />
        <DetailRow icon="mail" k="Email" v={row.email} />
        <DetailRow icon="calendar" k="Date of birth" v={fmtDate(row.dob)} />
        <DetailRow icon="clock" k="Member since" v={fmtDate(row.started_at)} />
        {String(row.status || "").toLowerCase() !== "active" && row.frozen_until
          ? <DetailRow icon="clock" k="Frozen until" v={fmtDate(row.frozen_until)} />
          : row.renews_at ? <DetailRow icon="refresh" k="Renews" v={fmtDate(row.renews_at)} /> : null}
        {guardians.length > 0 && (
          <>
            <div className="m-eyebrow" style={{ margin: "14px 2px 8px" }}>Guardians · {guardians.length}</div>
            {guardians.map((g, i) => (
              <DetailRow key={g.profile_id || i} icon="users"
                k={[g.relationship ? cap(g.relationship) : "Guardian", g.is_primary ? "primary" : null].filter(Boolean).join(" · ")}
                v={[g.name, g.phone].filter(Boolean).join(" · ") || null} />
            ))}
          </>
        )}
      </MobileSheet>
    );
  }

  // committee
  return (
    <MobileSheet title="Committee" onClose={onClose}>
      <SheetHeader left={<Avatar name={row._name} size={52} />} title={row._name} sub={cap(row.role) || "Committee"} />
      <DetailRow icon="users" k="Role" v={cap(row.role)} />
      <DetailRow icon="mail" k="Email" v={row.email} />
      {row.is_welfare && <DetailRow icon="shield" k="Welfare officer" v="Yes" />}
    </MobileSheet>
  );
}

// ── Add-session-coach sheet — PICK an existing club member_profile and add them to the
// team-less session-coach roster (club_coaches, mig 582) with a role. Writes via the
// existing venue-token venueUpsertClubCoach (manage_memberships-gated + audited); no new
// backend. The pool = the club's members that carry a member_profile_id and aren't
// already an active session coach. Minting a brand-new NON-member coach needs a
// venue-token member_profiles-create RPC that doesn't exist yet (tier-3 follow-up). ──
function AddSessionCoachSheet({ venueToken, clubId, toast, members, sessionCoachIds, onClose, onSaved }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);   // chosen member_profile_id
  const [role, setRole] = useState("coach");
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  // Eligible = members carrying a member_profile_id, deduped, minus current session coaches.
  const pool = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const m of (members || [])) {
      const id = m.member_profile_id;
      if (!id || seen.has(id) || sessionCoachIds.has(id)) continue;
      seen.add(id);
      out.push({ id, name: fullName(m), sub: m.tier_name || "Member" });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [members, sessionCoachIds]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? pool.filter((p) => p.name.toLowerCase().includes(needle)) : pool;

  const save = async () => {
    if (savingRef.current) return;
    if (!sel) { toast?.({ icon: "alert", text: "Pick a person first" }); return; }
    savingRef.current = true; setBusy(true);
    try {
      await venueUpsertClubCoach(venueToken, sel, clubId, role);
      toast?.({ icon: "check", text: "Session coach added" });
      onSaved();
    } catch (err) {
      console.error("[club-people] add session coach failed", err);
      toast?.({ icon: "alert", text: "Couldn't add — try again" });
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <MobileSheet
      title="Add session coach"
      onClose={onClose}
      footer={pool.length === 0 ? null : (
        <button onClick={save} disabled={busy || !sel} style={{
          width: "100%", padding: "13px", borderRadius: "var(--r-sm)", background: "var(--amber)", color: "var(--amber-ink)",
          border: "none", fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 15,
          cursor: (busy || !sel) ? "default" : "pointer", opacity: (busy || !sel) ? 0.5 : 1,
        }}>{busy ? "Adding…" : "Add as session coach"}</button>
      )}
    >
      {pool.length === 0 ? (
        <EmptyCard icon="users" text="No eligible people to add. Session coaches are picked from the club's members — add the person as a member on the desktop console first." />
      ) : (
        <>
          {/* role */}
          <div style={{ fontSize: 12, color: "var(--ink3)" }}>Role</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            {COACH_ROLE_OPTIONS.map(([k, label]) => {
              const on = role === k;
              return (
                <button key={k} onClick={() => setRole(k)} style={{
                  flex: "1 1 40%", padding: "9px 8px", borderRadius: "var(--r-pill)", cursor: "pointer",
                  fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
                  border: on ? "1px solid var(--amber)" : "1px solid var(--hair)",
                  background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--ink)" : "var(--ink3)",
                }}>{label}</button>
              );
            })}
          </div>

          {/* search */}
          <div style={{ fontSize: 12, color: "var(--ink3)", margin: "18px 0 6px" }}>Who?</div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 12px", height: 42, borderRadius: "var(--r-sm)", border: "1px solid var(--hair)", background: "var(--s3)" }}>
            <MIcon name="search" size={17} color="var(--ink3)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15 }} />
          </div>

          {/* pickable list */}
          <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
            {shown.length === 0 ? (
              <div style={{ padding: "18px 4px", textAlign: "center", color: "var(--ink3)", fontSize: 13.5 }}>No members match that search.</div>
            ) : shown.map((p) => {
              const on = sel === p.id;
              return (
                <button key={p.id} onClick={() => setSel(on ? null : p.id)} style={{
                  width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer",
                  padding: "10px 12px", display: "flex", alignItems: "center", gap: 12, marginBottom: 8,
                  borderRadius: "var(--r-md)", background: on ? "var(--amber-soft)" : "var(--s2)",
                  border: on ? "1px solid var(--amber)" : "1px solid var(--hair)",
                }}>
                  <Avatar name={p.name} size={38} r={12} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 500 }}>{p.sub}</div>
                  </div>
                  {on && <MIcon name="check" size={18} color="var(--amber)" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </MobileSheet>
  );
}
