import { useEffect, useRef } from "react";
import {
  X, SoccerBall, Users, Baby, SquaresFour, CaretRight,
  FlagCheckered, ClipboardText, Warning, Buildings, Check,
} from "@phosphor-icons/react";
import SharedContextSwitcher from "./SharedContextSwitcher.jsx";
import { resolveRoles, buildSwitcherSections, entityKey } from "../mobile/nav.js";

// Casual (dark-gold) context switcher — shell-unification PR #3. This is now the
// casual SHELL's CONTAINER: it owns the App-root fixed overlay + "SWITCH CONTEXT"
// title + close + focus-trap, and delegates the body to the shared, presentational
// SharedContextSwitcher (which renders --u-* only). Both shells now render from the
// ONE role registry (nav.js resolveRoles/groupEntities) — so a new hat appears in
// casual for free, and the casual/hub switchers can no longer drift apart.
//
// Physics stay casual: every row NAVIGATES (deep-link / cross-app). PR #6 reroutes
// the GUARDIAN row into the in-app /hub guardian track (the legacy /parent-home
// shell is retired) — the same child now resolves to ONE shell from either switcher.
// A casual-ONLY player still sees only "Your games" + "Everything" — identical to today.
//
// Design rule (locked s141): a switcher entry = an identity/role or a top-level
// membership you switch *between*. Sub-surfaces live INSIDE their context.
//
// Props:
//   open           — render gate
//   onClose        — dismiss
//   currentName    — greeting name
//   world          — get_my_world() payload (drives every hat via resolveRoles)
//   squads         — [{ id, name, token?, isAdmin?, type? }]  ('league'|'casual')
//   conflicts      — get_my_world().conflicts [{ message }]
//   currentTeamId  — marks the squad you're already in
//   onSelectSquad  — (squad) => void  (caller decides in-app load vs navigate)

// Cross-app base URLs (Phase 0e). Under shared-cookie SSO these carry the session.
const REF_APP_BASE   = import.meta.env.VITE_REF_APP_URL   || "https://platform-ref.vercel.app";
const VENUE_APP_BASE = import.meta.env.VITE_VENUE_APP_URL || "https://platform-venue.vercel.app";
const CLUB_APP_BASE  = import.meta.env.VITE_CLUB_APP_URL  || VENUE_APP_BASE;

// Casual maps the shared semantic icon names → Phosphor (weight="thin"), so the
// shared switcher stays icon-system-agnostic (the hub maps the same names → MIcon).
// Matches the icons the casual switcher has always used per row type.
const CASUAL_ICON = {
  house: Buildings, shield: Users, flag: ClipboardText, users: Baby,
  whistle: FlagCheckered, figure: SoccerBall, grid: SquaresFour,
  alert: Warning, check: Check, chevron: CaretRight,
};

// Casual keeps its own section labels (a casual-only player must see "Your games" /
// "Everything", never the hub's neutral "Squads"/etc — zero change for them).
const CASUAL_LABELS = {
  venue: "Operator", club: "Your clubs", team: "Coaching & management",
  referee: "Officiating", family: "Family", squad: "Your games", feed: "Everything",
};

export default function ContextSwitcher({
  open, onClose, currentName,
  world = null, squads = [], conflicts = [],
  currentTeamId = null, onSelectSquad,
}) {
  // Focus trap + Escape (a11y — folded in for PR #3). The overlay is the dialog;
  // the shared body is its content.
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const el = panelRef.current;
    el?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { onClose?.(); return; }
      if (e.key !== "Tab" || !el) return;
      const f = el.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);

  if (!open) return null;

  const go = (href) => { window.location.href = href; };

  // Every hat comes from the ONE registry. When the world hasn't resolved (anon /
  // still-loading / partial-failure), resolveRoles returns [] and the switcher
  // gracefully degrades to just squads + Everything — never a broken half-state.
  const roles = resolveRoles(world);

  // Casual expands guardian → one row PER child and coaching → one row PER team,
  // preserving the old per-child / per-team deep-links (the hub keeps them collapsed
  // because it has a child-strip; casual has none). The rest of the registry stays
  // collapsed via buildSwitcherSections.
  const guardianRole = roles.find((r) => r.key === "guardian");
  const coachRole = roles.find((r) => r.key === "team_manager");
  const rolesForSections = roles.filter((r) => r.key !== "guardian" && r.key !== "team_manager");
  // PR #6: each child row deep-links into the /hub guardian track (byte-matching the
  // canonical path MobileShell itself writes — ctx=entityKey(guardian)="family",
  // hat=guardian, child=<id>), so PR #1's hub hydration selects the guardian hat +
  // that exact child on arrival. Replaces the retired /parent-home legacy shell.
  const childItems = (guardianRole?.children || []).map((ch, i) => ({
    key: "child:" + (ch.child_profile_id ?? i) + ":" + i, type: "family", iconName: "users",
    title: [ch.first_name, ch.last_name].filter(Boolean).join(" ") || "Your child",
    onSelect: () => go(`/hub/matches?ctx=${entityKey(guardianRole)}&hat=guardian&child=${ch.child_profile_id ?? ""}`),
  }));
  const teamItems = (coachRole?.teams || []).map((t, i) => ({
    key: "team:" + (t.club_team_id ?? i) + ":" + i, type: "team", iconName: "flag",
    title: t.team_name || "Team",
    sub: `${t.role ? t.role[0].toUpperCase() + t.role.slice(1) : "Manager"} · open the club app`,
    onSelect: () => go(`${CLUB_APP_BASE}/?club=${t.club_id ?? ""}`),
  }));

  // Squad rows keep casual's badges + deep-link (onSelectSquad decides load-vs-nav).
  // The index-suffixed key fixes the duplicate-React-key warning on split squads.
  const squadItems = squads.map((s, i) => {
    const badges = [];
    if (s.id === currentTeamId) badges.push("Current");
    if (s.type === "league") badges.push("League");
    else if (s.type === "casual") badges.push("Casual");
    if (s.isAdmin) badges.push("Manager");
    return {
      key: "squad:" + s.id + ":" + i, type: "squad", iconName: "figure",
      title: s.name, badges,
      onSelect: () => { onSelectSquad?.(s); onClose?.(); },
    };
  });

  // Casual navigate strategy per entity (deep-link). NB the guardian branch below is
  // DEAD for casual (guardian is filtered out of rolesForSections above and rendered
  // via childItems instead); it's kept + PR#6-rerouted for defensive consistency so
  // no path here points at the retired /parent-home shell. Operator/club/referee rows
  // still deep-link to their consoles (PR #6b later brings those in-app too).
  const onPickEntity = (ent) => {
    // A club the person is a MEMBER of (even if ALSO an admin) opens their IN-APP
    // player/member view — never the external admin console, which needs its own
    // login the native app can't carry. Restores the pre-PR#3 member behaviour for
    // an admin+player club (e.g. a coach who also plays at their own club). Keys off
    // the member role, not the highest-rank role. Admin-ONLY clubs + operator venues
    // still open the console below (PR #6 will bring those in-app too).
    const member = ent.roles.find((x) => x.role.key === "member")?.role;
    if (member) {
      const cid = member.clubId ?? member.clubs?.[0]?.club_id ?? "";
      return () => go(`/sessions?club=${cid}`);
    }
    const r = ent.roles[0].role;
    switch (r.key) {
      case "operator":     return () => go(VENUE_APP_BASE);
      case "club_admin":   return () => go(CLUB_APP_BASE);
      case "team_manager": return () => go(`${CLUB_APP_BASE}/?club=${r.teams?.[0]?.club_id ?? ""}`);
      case "member":       return () => go(`/sessions?club=${r.clubId ?? r.clubs?.[0]?.club_id ?? ""}`);
      case "guardian":     return () => go(`/hub/matches?ctx=${entityKey(r)}&hat=guardian&child=${r.children?.[0]?.child_profile_id ?? ""}`);
      case "referee": {
        const tok = r.assignments?.[0]?.ref_token || null;
        return () => go(tok ? `${REF_APP_BASE}/?token=${tok}` : REF_APP_BASE);
      }
      default: return () => go("/feed");
    }
  };

  const feedItem = {
    key: "feed", type: "feed", iconName: "grid",
    title: "Feed", sub: "All your contexts in one place",
    onSelect: () => go("/feed"),
  };

  const sections = buildSwitcherSections({
    roles: rolesForSections, onPickEntity, squadItems,
    extraItems: [...childItems, ...teamItems, feedItem], labels: CASUAL_LABELS,
  });

  const renderIcon = (name, o) => {
    const Cmp = CASUAL_ICON[name] || SquaresFour;
    return <Cmp size={o.size} weight="thin" color={o.color} />;
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "var(--u-scrim)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Switch context"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 430, maxHeight: "85dvh", overflowY: "auto",
          background: "var(--u-surface-sheet)", borderTopLeftRadius: 20, borderTopRightRadius: 20,
          borderTop: "1px solid var(--u-hairline)",
          padding: "18px 18px calc(26px + env(safe-area-inset-bottom,0))",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--u-font-display)", fontSize: 24, letterSpacing: "0.06em", color: "var(--u-text-1)" }}>
              SWITCH CONTEXT
            </div>
            {currentName && (
              <div style={{ fontFamily: "var(--u-font-body)", fontSize: 13, color: "var(--u-text-3)", marginTop: 2 }}>
                {currentName}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "var(--u-surface-control)", border: "1px solid var(--u-hairline)",
              borderRadius: "var(--u-radius-pill)", width: 44, height: 44, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              WebkitTapHighlightColor: "transparent", flexShrink: 0,
            }}
          >
            <X size={18} weight="thin" color="var(--u-text-1)" />
          </button>
        </div>

        <SharedContextSwitcher
          variant="casual"
          sections={sections}
          conflicts={conflicts}
          renderIcon={renderIcon}
        />
      </div>
    </div>
  );
}
