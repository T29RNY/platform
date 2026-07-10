// ClubAdminMore.jsx — Club-admin track, the "More" hub (mounted at /hub, tab "more").
// A short launcher for the club-admin secondary screens that don't sit on the
// bottom tab bar (Schedule · Memberships · Club page · Safeguarding), plus the
// shared Profile & settings row. Every row here is LIVE (its screen is built) —
// unlike the operator More hub, which lists not-yet-built views as "Soon".
// Part of the club_admin /hub track (Club Console PR #6b).

import MIcon from "../icons.jsx";

const ROWS = [
  { id: "schedule",     icon: "calendar", title: "Schedule",     sub: "Training + fixtures" },
  { id: "bookings",     icon: "grid",     title: "Bookings",     sub: "Facility calendar" },
  { id: "memberships",  icon: "card",     title: "Memberships",  sub: "Cohorts + subscriptions" },
  { id: "clubpage",     icon: "globe",    title: "Club page",    sub: "Your public page" },
  { id: "safeguarding", icon: "shield",   title: "Safeguarding", sub: "DBS board + incidents" },
];

export default function ClubAdminMore({
  clubName, onOpenSchedule, onOpenBookings, onOpenMemberships, onOpenClubPage, onOpenSafeguarding, onOpenProfile,
}) {
  const openers = {
    schedule: onOpenSchedule,
    bookings: onOpenBookings,
    memberships: onOpenMemberships,
    clubpage: onOpenClubPage,
    safeguarding: onOpenSafeguarding,
  };

  return (
    <div className="m-view-enter">
      <div className="m-eyebrow" style={{ margin: "6px 2px 9px" }}>{clubName || "Your club"}</div>
      {ROWS.map((r) => (
        <button
          key={r.id}
          onClick={openers[r.id]}
          className="m-card"
          style={{
            width: "100%", textAlign: "left", cursor: "pointer", padding: "13px 14px", marginBottom: 9,
            display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)", color: "inherit",
          }}
        >
          <div style={{
            width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--amber-soft)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <MIcon name={r.icon} size={18} color="var(--amber)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{r.title}</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</div>
          </div>
          <MIcon name="chevron" size={16} color="var(--ink4)" />
        </button>
      ))}

      {/* profile & settings — the shared shell sheet */}
      <button
        onClick={onOpenProfile}
        className="m-card"
        style={{
          width: "100%", textAlign: "left", cursor: "pointer", marginTop: 16, marginBottom: 4,
          padding: "13px 14px", display: "flex", alignItems: "center", gap: 12,
          fontFamily: "var(--m-font)", color: "inherit",
        }}
      >
        <div style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <MIcon name="cog" size={18} color="var(--ink2)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>Profile & settings</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>Appearance, account, sign out</div>
        </div>
        <MIcon name="chevron" size={16} color="var(--ink4)" />
      </button>
    </div>
  );
}
