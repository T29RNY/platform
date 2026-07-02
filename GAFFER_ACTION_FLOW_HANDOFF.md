/loop /dev-loop GAFFER_ACTION_FLOW_HANDOFF.md

Plan gate: batched
Merge mode: per-phase

# Gaffer — collapse-to-notch + do-it-for-me action flow

## WHAT IT IS

Two additions to the live Gaffer orb launcher (`apps/inorout/src/views/Gaffer/GafferLauncher.jsx`,
shipped via `GAFFER_UI_HANDOFF.md` PR#1/PR#2 — orb+drag+chat-sheet, real nudge triggers).
This is its own epic, separate from that launcher-UI roadmap (PR#3, widening Gaffer to
players, is unbuilt/tier-3-gated and untouched by this scope).

**1. Collapse-to-notch.** The 68px orb gains a minimized state — a thin edge-hugging
pill instead of the full circle — so an admin can tuck it out of the way without losing
the "Gaffer has something" signal (a nudge must still be perceivable while collapsed).

**2. Action flow.** When Gaffer has a suggestion — today's three orb nudges (money
owed, no-response, squad shortfall), or a future chat-answer suggestion — it offers
"want me to show you where, or shall I just do it for you?" *"Show me"* navigates to
the relevant screen (zero write, zero risk). *"Do it"* executes a real admin action via
an **existing** SECURITY DEFINER RPC, gated by an explicit confirm step and a
server-side audit trail.

**The single most important audit finding this scope surfaced:** Gaffer is genuinely
answer-only today — `askGafferQuestion` has no write/execute path, and the nudge
banter copy is *deliberately* worded non-action-offering (`GafferLauncher.jsx:30-33`
has a comment explaining exactly why: "a nudge must never imply it can act on a
'yes'"). Checking what write capability actually backs each of the three live nudges
found **only one of the three has a real write path today**:

| Nudge | Existing write action? |
|---|---|
| No-response chase (`noresp:N`) | ✅ `chaseNoResponders()` in `AdminView/index.jsx:484` → `/api/notify` `chaseNoResp`, already rate-limited (120min via `getRecentNotification`) |
| Money owed (`owed:N`) | ❌ None. `PaymentsScreen.jsx` only has ledger bookkeeping (`doMarkPaid`/`doReset`/`startWaive`) — no on-demand chase/reminder RPC |
| Squad shortfall (`shortfall:N/M`) | ❌ None. `getCoverPool` is read-only; no "notify reserves now" RPC exists |

This reshapes the roadmap: "do it" for the no-response nudge is a wiring job onto an
already-safe, already-rate-limited action. "do it" for money-owed and shortfall
requires **new write RPCs**, built through the full RPC CHECKLIST (SQL first,
SECURITY DEFINER, `rpc-security-sweep.md`, `ephemeral-verify.md`) — real, gated,
separately-tiered work, not just UI wiring. This is scoped as two roadmap phases
accordingly (see ROADMAP).

## LOCKED DECISIONS

**1. No LLM tool-calling / open agentic execution.** "Do it" is a **closed action
registry**, not the LLM freely choosing an RPC + params. Nudges are already
pre-classified via `computeNudge()`'s fixed `key` (`owed:40`, `noresp:3`,
`shortfall:11/14`) — the client (or, for chat-suggested actions, the edge function)
only ever selects a `key` from a small, server-owned allow-list; it never constructs
an arbitrary RPC call. This matches GAFFER.md's own explicit deferral of general
tool-use to Phase 3+, matches the current (2026) best-practice consensus surfaced by
the best-practice lens (deterministic pre-action authorization at the tool-call
boundary, not model-alignment-only trust — see MISSED/OPPORTUNITY/FUTURE-PROOF/WOW
for citations), and is the only shape the security lens will pass at
`rpc-security-sweep.md`.

**2. "Do it" always calls an EXISTING admin_* RPC — never a new dynamic dispatcher.**
Reusing `chaseNoResponders`'s existing `/api/notify` mechanism for the no-response
action, and any newly-built chase/notify RPCs, must be reachable by a human admin tap
somewhere in AdminView, per GAFFER.md's own Phase 3 constraint ("no new direct-write
paths for the agent"). Gaffer never becomes the *only* path to a capability.

**3. Money-STATE mutation is out of scope for "do it," permanently, not just for v1.**
`admin_settle_player` / `admin_confirm_claims` / `admin_confirm_payment` (which mark a
balance as paid/settled) are **excluded from the action registry** even after this
epic ships further phases. The safety lens's reasoning: nudges are computed from
client-side state that can be stale (a realtime race, a second tab); a stale-state
"do it" on a *notification* (chase a player) is embarrassing but reversible, a
stale-state "do it" on a *ledger mutation* is a real money-record-corruption risk.
"Do it" stays scoped to **comms/notification actions** (chase, notify, confirm-teams,
post-draft) — never a balance/paid-status write. If a future cycle wants Gaffer to
mark payments settled, that's a new, separately-scoped, higher-bar decision — not an
extension of this registry.

**4. Confirmation is risk-tiered, and every registry row carries its tier explicitly**
(`riskTier: 'nav' | 'write-low'`). v1 only populates `'nav'` (show-me) and `'write-low'`
(comms actions, single inline confirm-with-preview — see PR-C). No `'write-money'`
tier is built in this epic per Locked Decision #3, but the field exists so a future,
separately-gated cycle can add one without restructuring the confirm state machine
(this is the SWEEP future-proof lever — see below).

**5. Phase-gate reuses `ai_agent_access`/`resolve_agent_caller` (migration 454),
not a new flag.** `resolve_agent_caller`'s `agent.phase` field is currently a
hardcoded literal (`"phase": 1`) specifically designed as a data-level safety
boundary for exactly this moment ("the edge fn will hard-block tool calls until phase
3" — GAFFER.md). This epic makes that field real: PR-C adds an `act_enabled boolean
DEFAULT false` column (simpler and more legible than an ordinal "phase 3" for a
binary act/no-act gate — see KEY AUDIT FACTS) to `ai_agent_access`, checked
server-side on every execute call, checked again before the client even *renders*
"do it" copy (so the UI never implies a capability the team hasn't been canaried
into). No new `VITE_*` env flag — this reuses the existing per-team opt-in table,
consistent with the canary discipline already established for Gaffer's text
generation.

**6. Audit: reuse `audit_events`, tag with a `gaffer_action_id`, do not invent a
parallel audit system.** A new lightweight table `gaffer_actions` (migration 470)
records intent (what Gaffer proposed) and links forward to the real `audit_events`
row the target RPC writes (what actually happened) — see KEY AUDIT FACTS for the
exact shape. `audit_events` itself gets no new column; it already accepts arbitrary
metadata via its existing jsonb column, and each targeted RPC gets one new optional
trailing param (`p_gaffer_action_id uuid DEFAULT NULL`) threaded through to its
existing metadata build.

**7. Collapsed state: orthogonal boolean, not a new `mode` value.** `mode: 'idle' |
'nudge' | 'dragging'` stays exactly as-is; a new `collapsed: boolean` layers on top
(`showOrb = !open && !collapsed`, `showNotch = !open && collapsed`). Nudge/drag both
still function while collapsed (a nudge must still pulse the notch; dragging the
notch un-collapses it immediately). See ROADMAP PR-A for the full motion/interaction
spec.

**8. Collapse and action-flow are independent tracks, touching at exactly one seam.**
The only place they interact: a pending "do it" confirmation should force the orb out
of a collapsed notch so the confirm step is visible (PR-E, small, depends on both A
and C). Everything else ships independently — no reason to sequence collapse-to-notch
behind or ahead of action-flow.

## KEY AUDIT FACTS

- **Gaffer today = read-only Q&A.** `askGafferQuestion(adminToken, q)` →
  `apps/inorout/api/gaffer.js` → `gaffer_qa` RPC → Claude, text-only response, no
  `tools` param, no function-calling loop. Confirmed by reading the edge function in
  full.
- **`GafferLauncher.jsx` mode state machine:** `mode: 'idle' | 'nudge' | 'dragging'`,
  `open: boolean` orthogonal. `computeNudge(squad, schedule)` is pure client-side
  (no RPC), returns `{key, banter}` in priority order (owed → noresp → shortfall).
  Position persisted to `localStorage['gafferCorePos'] = {px, py}`.
- **Navigation is NOT a router.** `AdminView/index.jsx` uses a plain `screen` state
  string + `setScreen("payments")` etc (lines 516–523) — no react-router, no URL.
  "Show me" means threading an `onNavigate`/`setScreen` callback down into
  `GafferLauncher` (new plumbing — it currently receives no navigation prop).
  App.jsx's own page-level nav is `window.location.href`/`.replace()` — also not a
  router — so "show me" for a genuinely different top-level view may need that
  mechanism instead, resolve which at PR-B's audit step per the actual target
  screen.
- **The one existing write action:** `chaseNoResponders()`
  (`AdminView/index.jsx:484`) → `fetch("/api/notify", {type:"chaseNoResp",...})` →
  real push notification, rate-limited via `getRecentNotification(teamId,
  "chaseNoResp", gameDate, 120)` (120-min cooldown). This is the PR-C v1 "do it"
  target — no new RPC needed for it.
- **Confirmed no-existing-RPC gaps:** no "chase payment now" action anywhere in
  `PaymentsScreen.jsx` or `packages/core/storage/supabase.js`; no "notify reserves
  now" action — `getCoverPool` is a plain read (`.from("cover_pool").select("*")`,
  not even an RPC). Both are net-new RPC work (PR-D).
- **`audit_events` insert pattern** (sampled from migrations 461/463, backing
  `admin_settle_player`/`admin_confirm_claims`): `actor_type`, `actor_user_id`
  (`auth.uid()`), `actor_identifier` (`'admin_token:' || md5(p_admin_token)`),
  `action`, `entity_type`, `entity_id`, `metadata jsonb`. New Gaffer-initiated writes
  add `metadata->>'gaffer_action_id'` — no schema change to `audit_events` itself
  (jsonb already supports it). Confirm `audit_events.actor_type` has no CHECK
  constraint blocking a new value before adding one (`check-schema-column.sh
  audit_events actor_type`) — flagged as a PR-C audit-step check, not assumed.
- **`ai_agent_access` (migration 454)** — opt-in canary table, `no row = OFF`,
  `domains text[]`, `daily_cap_pence`. `resolve_agent_caller`'s `agent.phase` is
  currently a hardcoded `1` in the RPC body (migration 454, ~line 268) — PR-C makes
  gating real (Locked Decision #5).
- **Chip visual gap:** `Gaffer/index.jsx`'s current `chipStyle` is only the
  secondary/translucent variant. README §5 specifies a primary solid-accent-fill
  variant that was never actually built in PR#1 — action-flow depends on that primary
  chip existing to visually distinguish "Show me" (secondary) from "Do it for you"
  (primary). Small gap, closed in PR-B.
- **Collision check (notch positioning) — confirmed low risk, one real adjacency
  found:** the mobile-shell tab bar (`mobile/theme/mobile-tokens.css:191-203`,
  bottom-anchored, no explicit z-index) sits in the same bottom band the orb's
  existing clamp already allows it to reach — pre-existing risk, not notch-specific,
  but worth a one-time real-device check alongside PR-A since the notch's edge-flush
  (0-inset) positioning is new. All other fixed/sticky UI in the app (POTM banner,
  push modal, toasts, `AuthGateModal`, `ContextSwitcher`) is either full-screen-scrim,
  a higher z-index than Gaffer's 130, or vertically clear of the orb's clamp range.
- **Next free migration: 470.** Confirmed via `ls rls_migrations/` — highest existing
  prefix is 469 (`469_safeguarding_lead_grantable.sql`). Matches MEMORY's index.
- **No U18/PII/GDPR surface.** This epic touches no new personal data, no
  `member_profiles.dob`-gated flow, and no delete-cascade path — `gaffer_actions`
  stores action intent (player IDs, amounts, message copy already visible elsewhere
  in the app), not new personal data categories, and is admin-only-readable per its
  RLS policy. Stated explicitly here so the gap isn't silently assumed.
- **Native/App-Store-freeze: exempt, confirmed.** Neither addition touches Hard
  Rule #13's files-in-scope list (App.jsx auth/routing, PlayerView, MySquads,
  AuthGateModal, useRequireAuth, supabase.js client config, capacitor.config.ts).
  Collapse is pure CSS/pointer-events (same mechanism the live drag/snap already
  uses in the WKWebView). "Show me" is a same-origin `window.location`/state-setter
  nav (identical pattern to 30+ existing call sites). "Do it" is a plain
  network/Supabase-JS call from the existing webview (identical mechanism to
  `askGafferQuestion`, already proven live). No App Store review implication either
  way.

## ROADMAP

### PR #1 — Collapse-to-notch UI (PR-A)
**Tier:** 2. **Ship-safety:** CLEAR (pure frontend, same `ENABLE_GAFFER && isAdmin`
gate, no backend touch, no write).

New `collapsed: boolean` state in `GafferLauncher.jsx`, orthogonal to `mode` (Locked
Decision #7). Full design spec (dimensions, motion, entry/exit, persistence):

- **Notch element:** 28×64px pill, `border-radius: 20px 0 0 20px` (mirrored when
  snapped left), flush to the screen edge (0 inset — a deliberate, documented
  exception to the orb's usual 14px `MARGIN`), vertical position = current `py`
  (same clamp range as the orb). Reuses the orb's frosted-glass body cropped to the
  inner half, a sliver (~40%) of the "?" glyph, the rim shadow. Ambient
  motion (float/caustic-spin/specular) is dropped while collapsed — static except for
  the nudge-pulse below. Hit target padded to 44px+ even though the visual is 28px.
- **Entry:** a small chevron affixed to the orb's inner edge (Phosphor
  `CaretRight`/`CaretLeft`, `weight="thin"`, 20×20px visual / 44px effective hit
  area), visible only when `mode === 'idle' && !open` (hidden mid-nudge so a user
  can't tuck away an unseen nudge, hidden mid-drag).
- **Exit:** tap the notch → `collapsed:false` + `open:true` in one motion (matches
  "tap Gaffer to chat"); OR drag the notch outward past `DRAG_THRESHOLD` →
  `collapsed:false` immediately, continues as a normal drag.
- **Nudge while collapsed** (the "out of the way without disappearing" requirement):
  the notch shows the existing `gafferDot` notification dot (repositioned to the
  notch's outer corner) + a half-ellipse ripple pulse (`clip-path` constrained to
  the visible edge) + the "?" sliver does the existing twirl animation. **No banter
  bubble text while collapsed** — the 188px bubble doesn't fit a "tucked away" state;
  full context is deferred to the chat sheet, which opens straight from a notch tap.
- **Motion:** 340ms `cubic-bezier(.22,1,.36,1)` both directions (reuses the existing
  edge-snap spring curve — new token `--gaffer-collapse-duration`), opacity-crossfade
  the glyph crop rather than a hard swap. `prefers-reduced-motion` → hard-cut, no
  animated width/radius.
- **Typography:** all new UI text (chevron tooltip if any, confirm-step copy, chip
  labels) inherits the existing `--gaffer-font-body` (Hanken Grotesk) island token —
  no new font, no Bebas Neue/DM Sans leakage in either direction (Gaffer's scoped
  token island per `GAFFER_UI_HANDOFF.md` Locked Decision #2 stays untouched by this
  epic).
- **Persistence:** extend `gafferCorePos` from `{px,py}` to `{px,py,collapsed}`
  (additive, backward-compatible with the existing `typeof saved.px === 'number'`
  guard).

Gates: `check-build.sh` · `check-hygiene.sh` on changed files (confirms no literal
hex leaked, `--gaffer-*` vars only) · manual: collapse/expand via chevron and via
drag both work; collapsed state persists across reload; a nudge fires and is
perceivable (dot+pulse) while collapsed; real-device check of the notch against the
mobile-shell tab bar adjacency (KEY AUDIT FACTS).

**Done:** the orb has a working, pixel-considered collapsed notch state matching this
spec, motion respects reduced-motion, persists across reload, and nudges remain
perceivable while tucked away.

### PR #2 — Action registry scaffold (PR-B) + "show me" (navigate-only, all 3 nudges + chat)
**Tier:** 2. **Ship-safety:** CLEAR — zero writes, zero new RPCs, pure client-side
registry + navigation wiring.

New `apps/inorout/src/views/Gaffer/gafferActions.js`: a small static registry,
domain-namespaced from day one (`casual.chase_no_response`, `casual.chase_payment`,
`casual.notify_reserves` — namespacing costs nothing now and avoids a rename when
future domains land per GAFFER.md's "composer" direction), each entry shaped
`{ actionKey, label, riskTier, route, rpcWrapper: null (until PR-C/D), confirmCopy:
null (until PR-C/D), allowedRoles: ['admin'] }`. For this PR only `route` and
`riskTier:'nav'` are populated for all three nudge keys.

- Add the missing primary-chip visual variant to `Gaffer/index.jsx`'s chip styling
  (KEY AUDIT FACTS gap) — solid `var(--gaffer-accent)` fill, dark text, per README §5.
- Wire "Show me"/"Do it for you" chips onto the nudge-opened chat sheet's first
  message (banter context) and onto any individual chat-answer message the
  registry recognises (`{role:'assistant', content, actionChips:[...]}` — a real
  `messages` array shape addition, per the UI/UX lens).
- Thread an `onNavigate(route)` callback prop from `App.jsx` into `GafferLauncher` →
  `Gaffer/index.jsx`; "Show me" tap closes the sheet and calls it (maps to
  `setScreen(...)` for AdminView-internal targets, `window.location` for anything
  outside AdminView's screen switch — resolve per-target at audit time per KEY AUDIT
  FACTS).
- No confirmation step for "show me" (inherently reversible, zero mutation).

Gates: `check-build.sh` · `check-hygiene.sh` · `check-references.sh "chipStyle"`
(confirm both chip variants coexist correctly) · manual: tapping "show me" on each
of the 3 nudges lands on the correct screen; flag-off → zero footprint, matching PR#1
precedent.

**Done:** every nudge and any chat-suggested action can be shown (not yet done) via a
real navigation, backed by a reusable registry, with zero new backend surface.

### PR #3 — 🚦 "Do it" execute path: no-response chase (PR-C) (the one existing safe action)
**Tier:** 3. **Ship-safety:** PROTECTED — first time Gaffer performs a real write on
a human's behalf. Full `rpc-security-sweep.md` + `ephemeral-verify.md` even though
the underlying `/api/notify` mechanism already exists and is already safe when
human-tapped — the NEW surface being reviewed is the agent-initiated path + audit
tagging + phase-gate, not the notification send itself.

- **Migration 470** (`gaffer_actions` table): records intent before delegating.
  ```sql
  CREATE TABLE public.gaffer_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id text NOT NULL REFERENCES teams(id),
    nudge_key text NULL,              -- e.g. 'noresp:3'; NULL if chat-originated
    source text NOT NULL CHECK (source IN ('nudge','chat')),
    action_key text NOT NULL,         -- e.g. 'casual.chase_no_response'
    proposed_args jsonb NOT NULL DEFAULT '{}'::jsonb,
    confirmed_args jsonb NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined','failed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz NULL
  );
  ```
  RLS: `team_admins`-of-`team_id` SELECT only (mirrors `audit_events` policy shape);
  no client INSERT/UPDATE policy — all writes happen inside the SECURITY DEFINER
  dispatcher below; explicit `REVOKE ALL FROM anon` + `REVOKE INSERT/UPDATE/DELETE
  FROM authenticated` (the `ALTER DEFAULT PRIVILEGES` auto-grant gotcha, called out
  in migration 454's own comments — do not skip).
- **Same migration:** `ai_agent_access` gains `act_enabled boolean NOT NULL DEFAULT
  false`; `resolve_agent_caller` reads it into `agent.enabled_actions`/similar
  instead of the current hardcoded `"phase": 1` literal (Locked Decision #5).
- **New RPC `gaffer_confirm_action(p_admin_token, p_gaffer_action_id, p_action_key,
  p_confirmed_args)`** — SECURITY DEFINER, `search_path` pinned. Validates the token
  owns the `gaffer_actions.team_id` row, checks `ai_agent_access.act_enabled` for
  this team, then dispatches via a **hardcoded `CASE p_action_key WHEN
  'casual.chase_no_response' THEN ...`** (never dynamic SQL, never an LLM-supplied
  RPC name — Locked Decision #1/security-lens precondition #2) to the existing
  `/api/notify` `chaseNoResp` mechanism (or a thin SQL-side equivalent if the
  existing rate-limit check needs to move server-side for this path — resolve at
  audit time), re-validating params server-side against current squad state (never
  trusting the client's/LLM's cached numbers — security-lens precondition #3).
  Updates `gaffer_actions.status/confirmed_args/resolved_at`. Idempotency: reject a
  second confirm on an already-`confirmed` row.
- **Confirm UX** (per the UI/UX lens's action-flow spec): tapping "Do it for you"
  replaces that message's chips with a confirm pair ("Yes, do it" / "Never mind") +
  a one-line preview naming the concrete target ("Send a nudge to Jordan, Sam, Alex
  — they haven't replied yet"). On confirm: inline "Sending…" status → success/failure
  message in the sheet, matching existing `sending`-state styling.
- **Client never calls `chaseNoResponders()` directly for a Gaffer-initiated action**
  — it calls `gaffer_confirm_action`, so the audit/phase-gate/idempotency checks are
  never bypassable by a client that skips the dispatcher.

Gates: `rpc-security-sweep.md` · `ephemeral-verify.md` (new RPC, new table) ·
`check-schema-column.sh audit_events actor_type` (confirm no blocking CHECK before
any new actor-type value is introduced downstream) · `check-build.sh` ·
`check-hygiene.sh` · manual: "do it" on the no-response nudge sends a real
notification on a **non-demo** team (CLAUDE.md demo-environment caveat), confirm step
shows accurate preview, `gaffer_actions` + downstream trace both land, repeated
confirm-tap is a no-op (idempotency), a team with `act_enabled=false` never sees the
"do it" chip at all (server-echoed capability, not client-assumed).

**Done:** an admin can tap "do it" on the no-response nudge, see exactly who gets
pinged, confirm once, and the existing safe notification path fires — fully audited,
fully phase-gated, zero new capability the human UI didn't already have.

### PR #4 — 🚦 New write RPCs (PR-D): chase-payment-now, notify-reserves-now
**Tier:** 3. **Ship-safety:** PROTECTED — genuinely new write RPCs (full RPC
CHECKLIST: SQL first in Supabase editor, SECURITY DEFINER, `search_path` pinned,
REVOKE/GRANT per role, `audit_events` insert, wrapper in `supabase.js`, barrel
export, `rpc-security-sweep.md`, `ephemeral-verify.md`).

Builds the two write paths KEY AUDIT FACTS found genuinely don't exist yet — a
one-off "send payment chase now" notification (money-*adjacent*, not money-*mutating*
— stays within Locked Decision #3's "comms only" boundary) and "notify reserves now"
(push to cover pool). Both modelled directly on the proven `chaseNoResp` pattern
(rate-limited via `getRecentNotification`-equivalent, real push, no ledger write).
Once built, both slot into the `gafferActions.js` registry (PR-B) and
`gaffer_confirm_action`'s dispatch `CASE` (PR-C) as two more entries — no new
dispatcher infrastructure, this is additive registry rows + additive RPCs.

Gates: full RPC CHECKLIST · `rpc-security-sweep.md` · `ephemeral-verify.md` ·
`check-build.sh` · `check-hygiene.sh` · manual: both new "do it" actions fire
correctly on a non-demo team, rate-limited identically to the existing chase pattern.

**Done:** all three original orb nudges have a real, safe, audited "do it" path —
the epic's original three-nudge scope is now fully wired, not just the one that
happened to already have an RPC.

### PR #5 — Collapse ↔ action-flow reconciliation (PR-E)
**Tier:** 2. **Ship-safety:** CLEAR (pure frontend state coordination, no new
backend surface).

The one seam between the two tracks (Locked Decision #8): if a "do it" confirm step
is pending (from a nudge-triggered chip tap) and the user collapses the orb mid-flow,
force `collapsed:false` so the confirm step stays visible — a pending write
confirmation should never be silently tucked out of sight.

Gates: `check-build.sh` · `check-hygiene.sh` · manual: attempt to collapse while a
confirm step is showing, confirm it's blocked/auto-expands.

**Done:** collapse and action-flow behave coherently together; no confirm step can
be hidden by a collapse.

## 🚦 GATES the loop must stop at

- **PR-A, PR-B, PR-E:** no auth/RLS/money/native surface touched — normal PROOF GATE
  + human PR review only.
- **PR-C:** `rpc-security-sweep.md` + `ephemeral-verify.md` mandatory (new RPC, new
  table, first agent-initiated write) — human sign-off required even though the
  underlying notification mechanism it wraps is already live and safe.
- **PR-D:** full RPC CHECKLIST + `rpc-security-sweep.md` + `ephemeral-verify.md`
  mandatory (genuinely new write RPCs, not wrapping an existing mechanism).

## DONE =

Both epics ship independently-provable: the orb has a working collapsed notch state
(PR-A) that never loses a nudge signal; every nudge and chat-suggested action can be
shown via real navigation with zero write risk (PR-B); the one nudge that already had
a safe existing write path can be executed by Gaffer with a real confirm-preview and
full audit trail, gated by a real per-team capability flag (PR-C); the two nudges
that didn't have a write path get one, built to the same standard as every other
write RPC in the codebase (PR-D); and collapse/action-flow don't silently conflict
(PR-E). No RPC exists that only Gaffer can call. No money-state mutation is ever a
"do it" candidate.

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

**Missed:** every lens implicitly assumed "do it" only applies to the three
orb-nudge scenarios named in the brief — but the brief also explicitly says "or a
suggested action from chat," and the UI/UX lens's action-flow spec (chat-message
`actionChips`) makes that a real, separate trust boundary: a *deterministic*
pre-classified nudge key is materially safer than an *LLM interpreting free text
into* a registry key (the security lens's Open Question #4 raises exactly this and
it was never independently resolved by another lens). This scope treats both as
using the same closed registry (Locked Decision #1), which is the right mechanism,
but the chat-triggered path still needs its own audit-step confirmation during PR-B
that Claude's system prompt is constrained to *only* emit a known `action_key` (never
free text interpreted as an action client-side) — call this out explicitly at PR-B's
audit, don't let it fall out implicitly. Also missed independently by every lens: what
happens to a `gaffer_actions` row left in `status='pending'` forever (declined or
just abandoned) — the data lens flagged this as a likely non-issue (low-volume audit
table, no cleanup job needed) but no lens actually decided it; resolve at PR-C's
audit rather than carrying an unresolved data-hygiene question into the RPC review.

**Opportunity:** this scope's `gafferActions.js` registry is the concrete, buildable
first slice of GAFFER.md's own explicitly-deferred "Act" pillar (Phase 3) — meaning
this epic isn't a side-quest bolted onto the launcher, it's the actual overdue
Phase-3 build, scoped down to a size that ships safely. That reframes the roadmap
priority: PR-C/PR-D aren't "extra polish on the orb," they're the platform's first
production agentic-write surface, and the `act_enabled` flag this epic adds to
`ai_agent_access` becomes the natural on-ramp for every future Gaffer write
capability (venue/club/finance domains per the "composer" direction) without a second
foundation-laying epic later.

**Future-proof:** the single highest-leverage choice here is the domain-namespaced,
data-driven action registry (`casual.chase_no_response` style keys, `riskTier` field
including an unpopulated `'write-money'` slot) rather than hardcoding three if/else
branches into `GafferLauncher.jsx`. Every subsequent action — new nudge types, a
future player-facing action once PR#3 lands, an eventual venue-Gaffer action — is a
new registry row plus (if genuinely new) an RPC, never a rewrite of the confirm
state machine, the audit-tagging mechanism, or the phase-gate check. This is what
keeps PR-D from needing its own bespoke UI work despite being a real backend build.

**Wow factor(s):** for the admin, the wow isn't "Gaffer can act" in the abstract —
it's the no-response chase (PR-C) landing as *the exact same trusted action* they'd
tap themselves, just proposed at the right moment with the right names already
filled in, with a preview they can trust because it's not guessing. The genuinely
new wow this scope unlocks over the read-only orb: an admin can go from "Gaffer
noticed something" to "handled" in two taps total (open sheet from nudge → confirm)
instead of open sheet → close it → navigate → find the button → tap it — for the
one action that's fully wired in PR-C, this collapses a 4-5-tap manual flow into 2.
The collapse-to-notch wow is smaller but real: on a cramped screen (SquadScreen mid-
edit), being able to flick Gaffer to a sliver without losing the "it still has
something" signal is the difference between an admin trusting the orb enough to keep
it visible at all versus dragging it somewhere annoying and ignoring it.

## Related

- `GAFFER.md` — full AI-agent-layer spec; Phase 3 "Confirmed actions" is what PR-C/D
  build a first slice of. `agent.phase`/`ai_agent_access` (migration 454) is the
  reused phase-gate mechanism.
- `GAFFER_UI_HANDOFF.md` — the launcher-UI epic this scope extends (PR#1/#2 shipped,
  PR#3 unbuilt/tier-3-gated, untouched by this scope). Locked Decisions #2 (token
  island) and #6 (z-index 130) carry forward unchanged.
- `design_handoff_gaffer/README.md` — source material/motion language the notch spec
  (PR-A) extends; no new global tokens introduced.
- MEMORY `project_universal_ai_agent.md` — Pillar D foundation (`resolve_agent_caller`)
  this epic's phase-gate (PR-C) makes load-bearing for the first time.
