// TeamManagerMore.jsx — Team-manager track, the "More" hub (mounted at /hub, tab "more").
// Replaces the old dead route (More just opened the profile sheet). A real launcher for
// the coach's secondary surfaces, mirroring ClubAdminMore.jsx / OperatorMore.jsx.
//
// LIVE rows have their screen built; "Soon" rows are the not-yet-built build-out phases
// (OperatorMore idiom) so the menu reads as a roadmap, not a dead end. Profile & settings
// routes to the shared shell sheet. Part of the Manager /hub build-out epic (P1).

import MIcon from "../icons.jsx";

// { id, icon, title, sub, live } — live rows are tappable; others show a "Soon" chip.
const ROWS = [
  { id: "comms",    icon: "bell",     title: "Comms",    sub: "Message your players & parents", live: true },
  { id: "training", icon: "calendar", title: "Training", sub: "Add & manage sessions",          live: true },
  { id: "payments", icon: "pound",    title: "Payments", sub: "Who's paid, who owes",           live: true },
];

function SoonChip() {
  return (
    <span style={{
      height: 20, padding: "0 8px", borderRadius: "var(--r-pill)", flex: "none",
      display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 700,
      background: "var(--s3)", color: "var(--ink4)", letterSpacing: "0.03em", textTransform: "uppercase",
    }}>Soon</span>
  );
}

export default function TeamManagerMore({ teamName, onOpenComms, onOpenTraining, onOpenPayments, onOpenProfile }) {
  const openers = { comms: onOpenComms, training: onOpenTraining, payments: onOpenPayments };

  return (
    <div className="m-view-enter">
      <div className="m-eyebrow" style={{ margin: "6px 2px 9px" }}>{teamName || "Your team"}</div>
      {ROWS.map((r) => (
        <button
          key={r.id}
          onClick={r.live ? openers[r.id] : undefined}
          className="m-card"
          style={{
            width: "100%", textAlign: "left", cursor: r.live ? "pointer" : "default",
            padding: "13px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
            fontFamily: "var(--m-font)", color: "inherit", opacity: r.live ? 1 : 0.72,
          }}
        >
          <div style={{
            width: 38, height: 38, borderRadius: 11, flex: "none",
            background: r.live ? "var(--amber-soft)" : "var(--s4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <MIcon name={r.icon} size={18} color={r.live ? "var(--amber)" : "var(--ink3)"} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{r.title}</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</div>
          </div>
          {r.live ? <MIcon name="chevron" size={16} color="var(--ink4)" /> : <SoonChip />}
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
