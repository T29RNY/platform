/loop /dev-loop GAFFER_UI_HANDOFF.md

Plan gate: batched
Merge mode: per-phase

# Gaffer launcher UI — design-handoff build

## WHAT IT IS

`design_handoff_gaffer/` is a Claude-designed, high-fidelity spec for **Gaffer's
on-screen presence**: a floating "pebble" launcher (68×68px frosted-glass orb with
a glowing "?") that sits over the app, can be dragged aside, nudges the user with
banter when it has something to say, and expands into a 64%-height bottom-sheet
chat panel on tap. It is UI/motion only — not the conversational back-end.

Today, `apps/inorout/src/views/Gaffer/index.jsx` is a plain, always-mounted Q&A
panel with **no orb, no open/close state, no drag** — it's rendered inline whenever
`ENABLE_GAFFER && isAdmin` is true (App.jsx:1940). This build **replaces that shell**
with the real launcher-and-sheet UI the design specifies, wired to the **same
existing backend** (`askGafferQuestion` → `/api/gaffer`, admin-token-only). The
conversational content, prompts, and RPCs are untouched — this is a front-end-only
rebuild of the launcher chrome.

The design mock's home screen ("Evening, Sam" / THIS WEEK cards) resembles a
**casual player** home, not AdminView — the design brief itself flags this app
content as "placeholder context ... you do not need to build it." That turned out
to be the right instinct: the operator has confirmed Gaffer is meant to be
player-visible too, not admin-only — see LOCKED DECISIONS #1.

## LOCKED DECISIONS

**1. CONFIRMED — Gaffer widens to admins AND players, one consistent UI for
everyone, each person's answers scoped to their own role and permissions.**
Operator-confirmed. This is the same orb and chat panel for every audience — no
separate "admin Gaffer" vs "player Gaffer" skin — but the *backend* must resolve
each caller's role and only ever answer from data that role is allowed to see
(a player never sees another player's private info or admin-only data; an admin
sees the whole team). The existing backend (`/api/gaffer`,
`apps/inorout/api/gaffer.js:178`) resolves a team **only** via `admin_token`
today — a player token gets a 401 — so this is a real backend rewrite, not a UI
reskin. The Universal Agent Foundation (migration 454, `resolve_agent_caller`)
already composes the 5 existing identity resolvers into one normalized
caller-context and already proves player-token scope = self + team-public only
(EV-tested) — this is the mechanism PR #3 wires `/api/gaffer` onto, it does not
invent new scoping logic.

**Separate, larger, explicitly OUT of this handoff's scope:** the operator's
longer-term vision is "Gaffer as composer" — one consistent front-end talking to
multiple specialised AI agents/domains behind the scenes (casual football today,
venue/club/finance later per `GAFFER.md`'s phased domain expansion). That's a real
direction and is recorded here so it isn't lost, but building an actual
multi-agent composer backend is a much bigger epic than "add players to the
existing single Q&A agent." PR #3 below widens today's one agent to more
audiences; it does not build the composer. The composer is future work, tracked
in `GAFFER.md`, and deserves its own `/scope` pass when the operator is ready to
build it.

**2. Design tokens are a scoped "island," not global.** The spec's literal values
(`#f5a623` amber, `#c9851e`, `#1a201d`, Hanken Grotesk, Space Mono, its own
`--scr1/--t1/--t2/--t3` scale) do **not** match the live app's real tokens.css
(`--gold:#E8A020`, Bebas Neue + DM Sans, `--bg/--s1/--s2/--s3`, `--t1/--t2`).
Per the user's instruction the visual design must stay pixel-true to the mock —
so this does **not** get remapped onto the app's gold/Bebas system. Instead it
follows the precedent already set by `GuardianMatches.jsx`/mobile-shell islands:
a dedicated `apps/inorout/src/views/Gaffer/gaffer-tokens.css` defines the mock's
literal values **once**, as its own `--gaffer-*` custom properties, scoped under
a wrapper class (e.g. `.gaffer-root`) so they never leak into the rest of the app.
Component code references `var(--gaffer-accent)` etc., never literal hex in JSX —
`check-hygiene.sh`'s hardcoded-hex scan only runs against `.js/.jsx/.ts/.tsx`
(CLAUDE.md), so putting the literals in a genuine `.css` file sidesteps the hook
entirely without needing a hygiene-script exemption. **Low-risk, recommend as-is.**

**3. Fonts: extend the existing single Google Fonts link.** Add Hanken Grotesk
(400/500/600/700/800) and Space Mono (700) to the existing `FONT_LINK` constant in
App.jsx:60 alongside Bebas Neue + DM Sans, rather than a second dynamic `<link>` —
one extra request, matches the current one-link pattern. **Recommend as-is.**

**4. Light mode: build dark-only for v1, log the light variant as explicitly
dropped.** `CASUAL_PLAYER_DESIGN_HANDOFF.md` states "dark theme only" for the
casual surface, and nothing in the live app (outside the separate mobile-shell
theme toggle, which doesn't touch PlayerView/AdminView) supports a light theme.
The mock ships a full light-mode variant (dedicated fills/shadows). **This is the
one place "stay true to the design" and "don't introduce scope the app doesn't
support" genuinely conflict — flagged as an open question below, not silently
decided.** Default recommendation if no answer comes back: dark-only now, keep
the light-mode CSS values in `gaffer-tokens.css` unused/commented so a future
light-mode pass is a token flip, not a rebuild.

**5. Global mount point; gate widens in step with the roadmap.** Mount
`<GafferLauncher>` as a sibling in App.jsx's root div (same location as today's
`<Gaffer>`, ~line 1940). PR #1/#2 keep today's gate, `ENABLE_GAFFER && isAdmin`,
unchanged — the launcher is admin-only until the backend can safely answer for
other roles. PR #3 is what actually flips the gate to `ENABLE_GAFFER` (any
resolved caller, admin or player) once the per-role scoping it builds is proven —
see PR #3. No route/view-specific mounting needed either way; the same component
mounts once and shows for whichever roles the current gate allows.

**6. z-index 130.** Sits above the push-opt-in modal (120, PlayerView.jsx:760) and
POTM banner (90), below ContextSwitcher (1000) and AuthGateModal (9999) — the orb
should never block a real modal, and a real modal should never be hidden behind it.

## KEY AUDIT FACTS

- Current shell to replace: `apps/inorout/src/views/Gaffer/index.jsx` (Q&A body —
  **keep this component's message-rendering/composer logic**, it's correct; only
  the outer chrome — panel-always-visible, no orb, no scrim, no open/close — is
  being replaced).
- Separate, untouched: `GafferCard.jsx` (inline admin-home summary card) — not in
  scope, no conflict.
- Backend call: `askGafferQuestion(adminToken, q)` from `@platform/core` — unchanged
  signature, unchanged RPC (`gaffer_qa`), unchanged edge function.
- Flag: `ENABLE_GAFFER = import.meta.env.VITE_GAFFER_ENABLED === 'true'` (App.jsx:71)
  — reused as-is, currently off in production.
- Mount/gate site: App.jsx:1940 `{ENABLE_GAFFER && isAdmin && <Gaffer .../>}`.
- Existing z-index precedent: push modal 120 (PlayerView.jsx:760), POTM banner 90
  (PlayerView.jsx:874), sticky header 50 (PlayerView.jsx:888), ContextSwitcher 1000,
  AuthGateModal 9999 (global).
- Design-system precedent for "island" builds: `apps/inorout/src/mobile/screens/GuardianMatches.jsx`
  — scoped wrapper, dedicated tokens, no literal hex/font leakage into the app.
- **No migration needed.** This is a pure front-end rebuild against an existing
  backend; next free migration (470 per MEMORY, reconfirm against `rls_migrations/`
  before use) is not consumed by this epic.
- `prefers-reduced-motion` must be respected (README §Interactions) — disable
  ambient float/spin/twirl/breathing glow, keep a static orb + instant/short panel
  transition. Native-app-only (Hard Rule 13) — no PWA path, so treat this as a
  Capacitor webview concern (localStorage persistence for `gafferCorePos` works
  fine in the webview; no native-plugin dependency).

## ROADMAP

### PR #1 — Orb launcher + drag/snap + chat-sheet chrome
**Tier:** 2. **Ship-safety:** CLEAR (same flag, same admin-only audience for THIS
PR, same backend as what's live today — purely replacing UI behind the existing
gate; the launcher itself is built audience-agnostic per Locked Decision #1 so
PR #3 doesn't have to touch it again, it just flips who the gate admits).

New `GafferLauncher` component: 68px orb (idle/nudge*/listening/dragging states
per README §1–4), drag-to-reposition clamped to screen bounds, edge-snap on
release with `localStorage['gafferCorePos']` persistence, tap-vs-drag threshold
(>6px movement = drag), and the bottom-sheet chat panel (scrim, 64%-height sheet,
grab handle, header with mini-orb, close ✕) wrapping the **existing**
`Gaffer/index.jsx` message/composer logic. `gaffer-tokens.css` island per Locked
Decision #2. Dark-mode only per Locked Decision #4. Reduced-motion respected.
*Nudge in this PR is chrome-only (state + animation), not wired to a real trigger
— see PR #2.

Gates: `check-build.sh` · `check-hygiene.sh` on all new/changed
`.js/.jsx` (confirms no literal hex leaked into JSX) · `check-references.sh
"Gaffer"` (confirm the old always-mounted panel is fully replaced, no orphaned
import) · manual: `VITE_GAFFER_ENABLED=true` + admin session shows the orb (not
the old inline panel); drag persists across reload; tap opens sheet; a real Q&A
round-trip still returns a response via `askGafferQuestion`; flag off → zero DOM
footprint.

**Done:** orb + sheet render pixel-true to the amber dark-mode mock, wired to the
live admin Q&A backend, flag-gated exactly as today.

### PR #2 — Real nudge triggers (replace the demo timer)
**Tier:** 2. **Ship-safety:** CLEAR if scoped to data already loaded into admin
state (pending confirmations, unread counts, etc. already fetched by AdminView);
**escalate to PROTECTED** if it turns out a new read RPC is needed — decide during
this PR's audit step, not here.

Replace the mock's 8.5s demo timer with real event hooks scoped to the admin
audience only (squad shortfall, unread team chat, subs due) — the banter-bubble
copy, notification dot, and twirl animation are already built in PR #1; this PR
only wires the trigger condition.

Gates: `check-build.sh` · `check-hygiene.sh` · manual: nudge fires only on a
real qualifying event in a **real (non-demo) team**, not a fake timer (per
CLAUDE.md's demo-environment caveat); dismisses correctly; no console errors when
triggering data is absent.

**Done:** nudge reflects real admin-relevant state, no timer left in the shipped
code.

### PR #3 — 🚦 Widen Gaffer to players, scoped by role (CONFIRMED, still human-gated)
**Tier:** 3. **Ship-safety:** PROTECTED — touches auth/caller-identity resolution
and cross-role data exposure, so it still goes through the full security gate
even though the audience decision itself is now confirmed.

Rewire `/api/gaffer` + the `gaffer_qa` RPC to resolve the caller via
`resolve_agent_caller` (migration 454) instead of `admin_token`-only, so a player
token, guardian token, etc. can call Gaffer too. Define — per role — exactly what
`gaffer_get_context_*` fields that role's context RPCs are allowed to return (an
admin's context stays team-wide; a player's context is self + team-public only,
matching the already-EV-proven scope in `resolve_agent_caller`). Mount the same
`<GafferLauncher>` from PR #1 for non-admin views — **no new UI**, the launcher
and chat sheet are audience-agnostic by design (Locked Decision #1); only the
gate at App.jsx changes from `ENABLE_GAFFER && isAdmin` to `ENABLE_GAFFER` (any
resolved caller). This PR widens the *existing single* Q&A agent's audience — it
does **not** build the multi-agent "composer" architecture (see Locked Decision
#1's "out of scope" note); that stays a separate future epic.

Gates: full `rpc-security-sweep.md` + `ephemeral-verify.md` (new/changed RPC
caller-resolution path) · `casual-regression.md` (touches `apps/inorout/src/`) ·
manual: a player-token session gets real answers scoped to their own data only —
verified by attempting to ask about another player's private info and confirming
it's refused/absent from context, not just verbally declined by the LLM.

**Done:** a player can open the same Gaffer orb an admin sees, ask a question,
and get an answer grounded only in data that player is allowed to see; an admin's
Gaffer is unchanged.

## 🚦 GATES the loop must stop at

- PR #1/#2: no auth/RLS/money/native surface touched — no gate beyond the normal
  PROOF GATE + human PR review dev-loop already runs.
- PR #3: `rpc-security-sweep.md` + `ephemeral-verify.md` are mandatory before
  merge (new caller-resolution path on a live RPC) — human sign-off on the
  security review even though the audience decision itself is already confirmed.

## DONE =

**PR #1/#2:** Gaffer's launcher and chat-sheet render exactly as specified in
`design_handoff_gaffer/README.md` (amber dark-mode, all listed motion/timing),
replace the old always-visible flat panel, stay admin-only and flag-gated (same
as today), introduce zero literal-hex/global-token leakage into the rest of the
app, and are proven live (real Q&A round-trip + drag persistence) on a real
(non-demo) team, with real nudge triggers instead of the demo timer.

**PR #3:** the same launcher and chat sheet work identically for a player,
answers are provably scoped to that player's own permitted data, and the gate
that used to say "admins only" now says "anyone Gaffer knows how to resolve."

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

**Missed:** the design's own first-run hint pill ("Tap Gaffer to chat · hold to
drag aside") and the accessibility requirements (aria-label on the orb, the
notification dot's accessible "has updates" state, 44px+ hit target) are named in
the spec's Interactions section but weren't independently checked by any lens —
both are in scope for PR #1 as written but call them out explicitly in review so
they aren't dropped as "just chrome." Also unaddressed: what happens to the orb
during the native-app's App Store review freeze window (Hard Rule 13 auth/native
tier-3 protection) — since this is UI-only and doesn't touch auth/native
capability code, it should be exempt, but confirm during PR #1's audit rather
than assuming.

**Opportunity:** the `gaffer-tokens.css` island pattern this build establishes is
directly reusable the moment the operator's confirmed "Gaffer as composer"
direction gets its own build — venue/club/finance domains (already flagged as
deferred future context sources in GAFFER.md) can adopt the same consistent
front-end without a repeat design-system fight, since the orb/chat UI is already
built audience-agnostic (Locked Decision #1).

**Future-proof:** keeping the light-mode CSS values in `gaffer-tokens.css`
unused-but-present (Locked Decision #4's fallback) is the single highest-leverage
low-cost move here — it means a future decision to ship light mode is a token
flip, not a rebuild from the mock's spec, without carrying any light-mode runtime
cost or complexity today.

**Wow factor(s):** for the admin, the wow moment is the nudge banter bubble
landing at exactly the right time (PR #2) — a launcher that silently sits there
is just chrome, one that says "Subs are due Friday — want me to sort it?" at the
right moment is the actual product. For the confirmed player audience (PR #3),
the cheapest added wow is a first-nudge moment tied to something only Gaffer
would pre-emptively know about *that specific player* (e.g. "you're the only one
who hasn't said Friday yet") — worth carrying into PR #3's detailed scoping,
since it's the moment that makes a player's Gaffer feel personal rather than a
smaller copy of the admin one.

## Related

- `GAFFER.md` — full AI-agent-layer spec (backend, phases, prompts) — unchanged
  by this build.
- `design_handoff_gaffer/README.md` — the source design spec (read in full before
  PR #1's audit step).
- MEMORY `project_universal_ai_agent.md` — Pillar D foundation (`resolve_agent_caller`)
  that PR #3 builds on to widen Gaffer to players.
