import {
  X, SoccerBall, Users, Baby, SquaresFour, CaretRight,
  FlagCheckered, ClipboardText, Warning, Buildings,
} from "@phosphor-icons/react";

// Unified context switcher (multi-context nav). Opened from the header avatar on
// every context when the team's multi_context_nav flag is on. Driven by the
// get_my_world() resolver (mig 372): it lists EVERY hat the signed-in person
// holds — squads (casual + league), club/gym memberships, each child (guardian),
// referee assignments, and club-team coaching/management — plus a link to the
// /feed hub and an overlap warning when the person is down to play and to
// referee within two hours of each other. Themed with tokens.css only.
//
// Design rule (locked s141): a switcher entry = an identity/role or a top-level
// membership you switch *between*. Sub-surfaces (tournament bracket, league
// table, classes, PT, grading/belts, fight record, pitch/equipment hire) live
// INSIDE their context, never as switcher peers.
//
// Props:
//   open           — render gate
//   onClose        — dismiss
//   currentName    — greeting name
//   squads         — [{ id, name, token?, isAdmin?, type? }]  ('league'|'casual')
//   clubs          — [{ club_id, club_name, cohort_id?, cohort_name? }]
//   guardianChildren — guardian_of [{ child_profile_id, first_name, last_name }]
//   refAssignments — get_my_world().ref_assignments [{ ref_token, ... }]
//   coaching       — get_my_world().coaching [{ club_team_id, club_id, team_name, role }]
//   adminRoles     — get_my_world().admin_roles [{ type, entity_id, name, role }]
//   conflicts      — get_my_world().conflicts [{ kind, message, ... }]
//   currentTeamId  — marks the squad you're already in
//   onSelectSquad  — (squad) => void  (caller decides in-app load vs navigate)

// Cross-app base URLs (Phase 0e). Operator sets these to the *.in-or-out.com
// subdomains in each Vercel project once the domains are attached; until then they
// fall back to the live *.vercel.app deployments so deep-links never break. With
// the shared-cookie SSO on (VITE_AUTH_COOKIE_DOMAIN set), navigating to any of
// these carries the signed-in session — one sign-in, every hat. Off, the target
// app simply shows its own (now auth-parity) sign-in.
const REF_APP_BASE   = import.meta.env.VITE_REF_APP_URL   || "https://platform-ref.vercel.app";
const VENUE_APP_BASE = import.meta.env.VITE_VENUE_APP_URL || "https://platform-venue.vercel.app";
// Club OS (coach / club-admin) currently lives inside the venue console.
const CLUB_APP_BASE  = import.meta.env.VITE_CLUB_APP_URL  || VENUE_APP_BASE;

function Row({ Icon, title, subtitle, badges = [], onClick, muted = false }) {
  const clickable = typeof onClick === "function";
  return (
    <button
      onClick={onClick || undefined}
      disabled={!clickable}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14,
        padding: "14px 16px", marginBottom: 10,
        cursor: clickable ? "pointer" : "default",
        background: "var(--s2)", border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r)", textAlign: "left",
        opacity: muted ? 0.72 : 1,
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
      {badges.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {badges.map((b) => (
            <span key={b} style={{
              fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--gold)", border: "1px solid var(--border-subtle)",
              borderRadius: "var(--r-pill)", padding: "3px 8px",
            }}>{b}</span>
          ))}
        </div>
      ) : clickable ? (
        <CaretRight size={16} weight="thin" color="var(--t2)" />
      ) : null}
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
  squads = [], clubs = [], guardianChildren = [],
  refAssignments = [], coaching = [], adminRoles = [], conflicts = [],
  currentTeamId = null, onSelectSquad,
}) {
  // Operator hats from get_my_world().admin_roles. team_admin is already shown as
  // a "Manager" badge on the squad row, so only venue_admin (the venue/club
  // operator console) is surfaced here as a distinct cross-app context.
  const venueRoles = (adminRoles || []).filter((r) => r.type === "venue_admin");
  if (!open) return null;

  const go = (href) => { window.location.href = href; };

  // The next assignment is already ordered (in-progress > soonest kickoff) by
  // get_my_assignments, so refAssignments[0] is the one to open in the ref app.
  const nextRefToken = refAssignments?.[0]?.ref_token || null;
  const openRefApp = () => {
    go(nextRefToken ? `${REF_APP_BASE}/?token=${nextRefToken}` : REF_APP_BASE);
  };

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

        {/* Overlap warning — playing one game while assigned to referee another
            within a 2-hour window (get_my_world().conflicts). */}
        {conflicts.length > 0 && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            marginTop: 16, padding: "12px 14px",
            background: "var(--red2)", border: "1px solid var(--redb)",
            borderRadius: "var(--r)",
          }}>
            <Warning size={20} weight="thin" color="var(--red)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--t1)", lineHeight: 1.4 }}>
              <strong style={{ color: "var(--red)" }}>
                {conflicts.length === 1 ? "Schedule clash" : `${conflicts.length} schedule clashes`}
              </strong>
              {": "}
              {conflicts[0]?.message || "You are down to play and to referee close together."}
            </div>
          </div>
        )}

        {squads.length > 0 && (
          <>
            <SectionLabel>Your games</SectionLabel>
            {squads.map((s) => {
              const badges = [];
              if (s.id === currentTeamId) badges.push("Current");
              if (s.type === "league") badges.push("League");
              else if (s.type === "casual") badges.push("Casual");
              if (s.isAdmin) badges.push("Manager");
              return (
                <Row
                  key={s.id}
                  Icon={SoccerBall}
                  title={s.name}
                  badges={badges}
                  onClick={() => { onSelectSquad?.(s); onClose?.(); }}
                />
              );
            })}
          </>
        )}

        {clubs.length > 0 && (
          <>
            <SectionLabel>Your clubs</SectionLabel>
            {clubs.map((c) => {
              // A paused (frozen) membership is SHOWN but access-restricted: it is
              // badged "Paused" and muted. Booking is blocked server-side and the
              // member pass hides the QR until it's reactivated. It still opens the
              // club view so the member can see it / renew.
              const paused = c.status === "paused";
              return (
                <Row
                  key={`${c.club_id}:${c.cohort_id ?? ""}`}
                  Icon={Users}
                  title={c.club_name}
                  subtitle={paused ? "Frozen — renew to reactivate" : (c.cohort_name || null)}
                  badges={paused ? ["Paused"] : []}
                  muted={paused}
                  onClick={() => go(`/sessions?club=${c.club_id}`)}
                />
              );
            })}
          </>
        )}

        {guardianChildren.length > 0 && (
          <>
            <SectionLabel>Family</SectionLabel>
            {guardianChildren.map((ch) => {
              const name = [ch.first_name, ch.last_name].filter(Boolean).join(" ") || "Your child";
              return (
                <Row
                  key={ch.child_profile_id}
                  Icon={Baby}
                  title={name}
                  onClick={() => go(`/parent-home?child=${ch.child_profile_id}`)}
                />
              );
            })}
          </>
        )}

        {refAssignments.length > 0 && (
          <>
            <SectionLabel>Officiating</SectionLabel>
            <Row
              Icon={FlagCheckered}
              title="Referee"
              subtitle="Open the referee app"
              badges={[String(refAssignments.length)]}
              onClick={openRefApp}
            />
          </>
        )}

        {coaching.length > 0 && (
          <>
            <SectionLabel>Coaching &amp; management</SectionLabel>
            {coaching.map((t) => (
              // Cross-app (club OS, in the venue console). Phase 0e: now a real
              // deep-link — the shared-cookie session carries across when SSO is
              // on; otherwise the target app shows its own sign-in.
              <Row
                key={t.club_team_id}
                Icon={ClipboardText}
                title={t.team_name || "Team"}
                subtitle={`${t.role ? t.role[0].toUpperCase() + t.role.slice(1) : "Manager"} · open the club app`}
                onClick={() => go(`${CLUB_APP_BASE}/?club=${t.club_id}`)}
              />
            ))}
          </>
        )}

        {venueRoles.length > 0 && (
          <>
            <SectionLabel>Operator</SectionLabel>
            {venueRoles.map((r) => (
              // Cross-app (venue console). Deep-links carrying the session under
              // Phase 0e shared-cookie SSO.
              <Row
                key={r.entity_id}
                Icon={Buildings}
                title={r.name || "Your venue"}
                subtitle="Open the venue console"
                onClick={() => go(VENUE_APP_BASE)}
              />
            ))}
          </>
        )}

        <SectionLabel>Everything</SectionLabel>
        <Row Icon={SquaresFour} title="Feed" subtitle="All your contexts in one place" onClick={() => go("/feed")} />
      </div>
    </div>
  );
}
