// GuardianMore.jsx — Guardian track, the "More" launcher hub (mounted at /hub, tab "more").
//
// Mirrors design_handoff_guardian_app README "More" — a simple launcher: Team, Schedule,
// Club notices, Documents & consent, plus Profile & settings. Only Documents is built so far
// (screen 4); the rest are shown as "Soon" rows so the shape matches the design without
// faking unbuilt screens. Profile & settings opens the existing shell profile sheet.

import MIcon from "../icons.jsx";

const ROWS = [
  { id: "team", icon: "shield", title: "Team", sub: "Squad, coaches & contacts", soon: true },
  { id: "schedule", icon: "calendar", title: "Schedule", sub: "Training & fixtures", soon: true },
  { id: "notices", icon: "bell", title: "Club notices", sub: "Announcements from the club", soon: true },
  { id: "documents", icon: "flag", title: "Documents & consent", sub: "Registration & medical forms", soon: false },
];

export default function GuardianMore({ childFirst, dueCount, onOpenDocuments, onOpenProfile }) {
  return (
    <div className="m-view-enter">
      <div className="m-eyebrow" style={{ margin: "8px 2px 12px" }}>
        {childFirst ? `${childFirst}'s club` : "Your club"}
      </div>

      {ROWS.map((r) => {
        const disabled = r.soon;
        const showDue = r.id === "documents" && dueCount > 0;
        return (
          <button
            key={r.id}
            onClick={() => { if (r.id === "documents") onOpenDocuments?.(); }}
            disabled={disabled}
            className="m-card"
            style={{
              width: "100%", textAlign: "left", cursor: disabled ? "default" : "pointer",
              padding: "13px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
              fontFamily: "var(--m-font)", color: "inherit", opacity: disabled ? 0.55 : 1,
            }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
              background: showDue ? "var(--amber-soft)" : "var(--s4)",
            }}>
              <MIcon name={r.icon} size={18} color={showDue ? "var(--amber)" : "var(--ink2)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{r.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{r.sub}</div>
            </div>
            {r.soon ? (
              <span style={{ flex: "none", fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--s3)", color: "var(--ink3)" }}>Soon</span>
            ) : showDue ? (
              <span style={{ flex: "none", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)" }}>{dueCount}</span>
            ) : (
              <MIcon name="chevron" size={16} color="var(--ink4)" />
            )}
          </button>
        );
      })}

      <button
        onClick={onOpenProfile}
        className="m-card"
        style={{
          width: "100%", textAlign: "left", cursor: "pointer", marginTop: 6,
          padding: "13px 14px", display: "flex", alignItems: "center", gap: 12,
          fontFamily: "var(--m-font)", color: "inherit",
        }}>
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
