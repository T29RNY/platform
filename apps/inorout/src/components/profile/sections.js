// sections.js — the shared profile section REGISTRY for shell unification (PR #4).
//
// ONE declarative source of truth for WHICH profile sections exist and WHEN each is
// visible. Both shells consume it in their NATIVE chrome (casual = full-screen page
// PlayerProfile · hub = bottom-sheet ProfileSheet): each shell supplies its own
// Body map (id -> React node) and its own ORDER, and iterates the registry. This is
// D4 — a declarative, role-gated section registry, NOT a `surface`-prop mega
// component (whose isAdminView boolean forked dozens of conditionals — the
// cautionary tale). A new section, or a new visibility rule, is add-only here and
// propagates to both shells.
//
// ADD-ONLY / UNCONSUMED for now: PR #4a+b ships this registry + the usePlayerTeams
// hook with NOTHING consuming them, so it is a pure no-op (the PR #2 pattern). The
// hub swap (PR #4c) and the casual swap (PR #4d) wire each shell onto it, deleting
// their inline section lists. Until then, zero pixels change.
//
// DECISION D6 — visibility keys off `ctx` (held roles/data + runtime state), NEVER
// off which shell. `ctx` is assembled by each shell's adapter (see the contract
// below). This is why a guardian never sees a casual "Leave squad", a casual-only
// player never sees an empty guardian section, and an anon /p/<token> viewer never
// sees the Switch row or the account Sign-out row (it can still leave its own squad —
// that works on the token alone) — empty-state suppression is the rule.
//
// ORDER stays PER-SHELL so a casual-only player sees ZERO change: casual renders in
// CASUAL_ORDER (its exact current order), hub in HUB_ORDER (the locked unified
// order). The registry is order-agnostic; each shell passes its order to
// visibleSections().
//
// ── The `ctx` contract (each shell's adapter builds this) ──────────────────────
// @typedef {Object} ProfileCtx
// @property {'authed'|'anon'|'loading'} authState  authed session · anon /p/<token>
//   viewer (a token, no session) · still resolving. Gates account/switch/create.
// @property {'loaded'|'loading'|'partial'|'anon'} worldLoadState  get_my_world state
//   (hub); casual has no world → 'anon'. Lets a section suppress on partial failure.
// @property {boolean} isAdminView  casual admin drill-down (AdminView renders the
//   profile in read-only + admin-actions mode). Never set on hub.
// @property {Object|null} me       the casual squad member (present only in the
//   casual page context). Its presence gates the casual player/stats sections.
// @property {boolean} isGuardian   hub guardian hat active.
// @property {string|null} childId  hub active child (guardian).
// @property {number} childrenCount hub guardian children count.
// @property {boolean} canSwitch    a switch target exists (casual: onSwitchContext
//   passed + authed · hub: >1 switchable context). Gates the Switch section.
// @property {boolean} canAppearance  a theme control exists for this context. TRUE
//   on hub; FALSE on casual (the gold world is dark-only — casual Appearance is
//   DEFERRED, so the section simply doesn't appear, keeping casual unchanged).

// Section definitions, keyed by id. label is a default heading hint; each shell's
// Body renders the real heading in its own grammar. visible(ctx) is the D6 gate.
export const SECTIONS = {
  identity:        { id: "identity",        label: null,                 visible: () => true },
  "switch-context":{ id: "switch-context",  label: "Switch context",     visible: (c) => !c.isAdminView && c.authState === "authed" && c.canSwitch },
  children:        { id: "children",         label: "Your children",      visible: (c) => c.isGuardian && c.childrenCount > 0 },
  membership:      { id: "membership",       label: "Membership",         visible: (c) => c.isGuardian && !!c.childId },
  stats:           { id: "stats",            label: "Stats",              visible: (c) => !!c.me },
  "payment-history":{ id: "payment-history", label: "Payment history",    visible: (c) => !!c.me },
  injuries:        { id: "injuries",         label: "Injuries",           visible: (c) => !!c.me },
  "match-fitness": { id: "match-fitness",    label: "Match fitness",      visible: (c) => !!c.me && !c.isAdminView && c.authState === "authed" },
  "admin-actions": { id: "admin-actions",    label: "Admin",              visible: (c) => c.isAdminView },
  "create-squad":  { id: "create-squad",     label: "Create a new squad", visible: (c) => !!c.me && !c.isAdminView && c.authState === "authed" },
  appearance:      { id: "appearance",       label: "Appearance",         visible: (c) => c.canAppearance },
  // Notifications + Account are NOT whole-section auth-gated on casual: they show for
  // an anon /p/<token> viewer too (contact prefs / leave-squad work on the token
  // alone). Gate is "not the admin drill-down, and either authed or holding a squad
  // token". Hub (authed, no me, not admin) still matches. The Body auth-gates the
  // sign-out ROW; the delete Body branches token-path vs authed-path on ctx.me?.token.
  notifications:   { id: "notifications",    label: "Notifications",      visible: (c) => !c.isAdminView && (c.authState === "authed" || !!c.me?.token) },
  help:            { id: "help",             label: "Help & support",     visible: () => true },
  // account = sign out (+ casual: leave squad, delete-account token path · hub:
  // delete-account authed path). The delete Body branches on ctx.me?.token, NOT on
  // shell (token path -> /api/delete-account; authed path -> delete_my_account_auth).
  account:         { id: "account",          label: "Account",            visible: (c) => !c.isAdminView && (c.authState === "authed" || !!c.me?.token) },
};

// Casual page — EXACT current order of PlayerProfile, so a casual-only player sees
// ZERO change. (Identity, Stats, Payment, Injuries, Notifications, Match-fitness,
// Admin, Help, Switch, Create, Account.)
export const CASUAL_ORDER = [
  "identity", "stats", "payment-history", "injuries", "notifications",
  "match-fitness", "admin-actions", "help", "switch-context", "create-squad", "account",
];

// Hub sheet — the locked unified order (Identity -> Switch -> role sections ->
// Appearance -> Notifications -> Help -> Account).
export const HUB_ORDER = [
  "identity", "switch-context", "children", "membership",
  "appearance", "notifications", "help", "account",
];

// Resolve the ordered, visible sections for a shell. `order` is that shell's id
// list; unknown ids are skipped (defensive). Returns the section defs to render.
export function visibleSections(order, ctx) {
  return (order || [])
    .map((id) => SECTIONS[id])
    .filter((s) => s && s.visible(ctx));
}
