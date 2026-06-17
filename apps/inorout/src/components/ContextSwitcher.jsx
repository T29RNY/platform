import { X, SoccerBall, Users, Baby, SquaresFour, CaretRight } from "@phosphor-icons/react";

// Unified context switcher (multi-context nav, Phase 1). Opened from the header
// avatar on every context when the team's multi_context_nav flag is on. Lists
// the person's squads, club memberships and a guardian entry, plus a link to the
// /feed hub. Themed with tokens.css only.
//
// Props:
//   open          — render gate
//   onClose       — dismiss
//   currentName   — greeting name
//   squads        — [{ id, name, token? }]  the person's football squads
//   clubs         — active_clubs entries [{ club_id, club_name, cohort_name }]
//   hasGuardian   — show the Family entry
//   currentTeamId — marks the squad you're already in
//   onSelectSquad — (squad) => void  (caller decides in-app load vs navigate)

function Row({ Icon, title, subtitle, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14,
        padding: "14px 16px", marginBottom: 10, cursor: "pointer",
        background: "var(--s2)", border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r)", textAlign: "left",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <Icon size={24} weight="thin" color="var(--gold)" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "0.04em",
          color: "var(--t1)", lineHeight: 1.1, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {badge
        ? <span style={{
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 600,
            letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--gold)", border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-pill)", padding: "3px 8px",
          }}>{badge}</span>
        : <CaretRight size={16} weight="thin" color="var(--t2)" />}
    </button>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.12em", textTransform: "uppercase",
      color: "var(--t2)", margin: "18px 2px 12px",
    }}>
      {children}
    </div>
  );
}

export default function ContextSwitcher({
  open, onClose, currentName,
  squads = [], clubs = [], hasGuardian = false,
  currentTeamId = null, onSelectSquad,
}) {
  if (!open) return null;

  const go = (href) => { window.location.href = href; };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 430, maxHeight: "85dvh", overflowY: "auto",
          background: "var(--s1)", borderTopLeftRadius: 20, borderTopRightRadius: 20,
          borderTop: "1px solid var(--border-subtle)",
          padding: "18px 18px calc(26px + env(safe-area-inset-bottom,0))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 24, letterSpacing: "0.06em", color: "var(--t1)" }}>
              SWITCH CONTEXT
            </div>
            {currentName && (
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--t2)", marginTop: 2 }}>
                {currentName}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "var(--s2)", border: "1px solid var(--border-subtle)",
              borderRadius: "var(--r-pill)", width: 36, height: 36, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <X size={18} weight="thin" color="var(--t1)" />
          </button>
        </div>

        {squads.length > 0 && (
          <>
            <SectionLabel>Your games</SectionLabel>
            {squads.map((s) => (
              <Row
                key={s.id}
                Icon={SoccerBall}
                title={s.name}
                badge={s.id === currentTeamId ? "Current" : null}
                onClick={() => { onSelectSquad?.(s); onClose?.(); }}
              />
            ))}
          </>
        )}

        {clubs.length > 0 && (
          <>
            <SectionLabel>Your clubs</SectionLabel>
            {clubs.map((c) => (
              <Row
                key={`${c.club_id}:${c.cohort_id ?? ""}`}
                Icon={Users}
                title={c.club_name}
                subtitle={c.cohort_name || null}
                onClick={() => go(`/sessions?club=${c.club_id}`)}
              />
            ))}
          </>
        )}

        {hasGuardian && (
          <>
            <SectionLabel>Family</SectionLabel>
            <Row Icon={Baby} title="Your children" onClick={() => go("/parent-home")} />
          </>
        )}

        <SectionLabel>Everything</SectionLabel>
        <Row Icon={SquaresFour} title="Feed" subtitle="All your contexts in one place" onClick={() => go("/feed")} />
      </div>
    </div>
  );
}
