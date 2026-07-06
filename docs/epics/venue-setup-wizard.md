# Epic manifest — Venue Setup Wizard (resumable checklist hub)

- Epic: A self-serve (or superadmin-created) venue owner runs first-run setup from BOTH the `apps/venue` web console AND the native `apps/inorout` `/hub` app, seeing the SAME resumable hub (one shared `@platform/core` registry, two skins) with two honest progress numbers, reusing already-built views to set details/branding, add pitches/spaces, set venue opening hours, create adult leagues, invite co-admins, connect Stripe — each step ticking from real venue state, degrading gracefully for a partial superadmin venue, and auto-flipping the venue publicly live (server-checked) with a new-signup alert to the platform. MVP = W1+W2+W3.
- Plan gate: batched
- Merge mode: queue
- Approved: 2026-07-06 (batched plan gate, queue mode — operator)
- Source: VENUE_SETUP_WIZARD_HANDOFF.md · parent SELF_SERVE_MULTI_VERTICAL_HANDOFF.md (PR4 = entry point, MERGED #303)

## Phases   (status: pending | in-progress | done | blocked: <why> | needs-human: <what>)

### P1 (W1) — Shared-core setup registry + progress logic + WEB console hub (+ expose verification_status/origin)
- status: done (PR #306 open, queued) · OWED: mig 485 apply + venue deploy + live Playwright deep-link walk
- deps: none
- tier: tier-1 · CLEAR (web) — but carries migration 485 (read-shape only)
- goal: `packages/core/setup/setupRegistry.js` (opener + steps + go-live, config-driven `{id,label,icon,required,gate,isComplete(state),view,verticals,showIf(features)}`) + two-number progress helpers + dismissal-aware first-incomplete selector + feature-tailoring filter. Web skin: `SetupHub` as `view==='setup'` in `apps/venue` `Dashboard.jsx`, opener → tailored card list, deep-links `onView(step.view)`. Payments + Go-live render as locked tiles. Auto-open when venue pending/near-empty + reminder banner + Rail entry. Migration 485 = expose `verification_status`+`origin` on `venue_get_state`/`venue_whoami` returned venue object + same-commit inline mapper (HR#12).
- tier-3 touch: migration (485 read-shape) → APPLY GATE + venue deploy GATE
- proof: build (core+venue) · hygiene · migration-apply(485) · rpc-columns/security sweep on modified read RPCs · Playwright (deep-link/`?setup=1` lands in hub; add real space → card ticks, progress advances)
- PR:

### P2 (W2) — NATIVE /hub OperatorSetup screen (second skin, same shared core)
- status: pending
- deps: P1
- tier: tier-1 · CLEAR-dark (native, ships via Capacitor bundle to live App-Store users)
- goal: `OperatorSetup` screen in native `/hub` operator nav (`apps/inorout/src/mobile/`), renders SAME W1 shared-core registry. No backend, no migration. Reuses mobile operator auth (venue_id → `venue_get_state` Stage-1b). Cards route to native operator screens; Payments card = status + "finish on a computer" nudge. Native amber `[data-surface="mobile"]` theme — inorout hard rules apply.
- tier-3 touch: none backend — but PROTECTED-dark (native bundle) → casual-regression MANDATORY + Hard-Rule-13 real-iPhone walk GATE
- proof: build(inorout) · hygiene(inorout rules) · casual-regression · lint · Playwright (`/hub`→Setup mirrors web state) · real-iPhone native walk (human)
- PR:

### P3 (W3) — Details/branding + venue opening-hours + dismissal store (wired into BOTH skins)
- status: pending
- deps: P1, P2
- tier: tier-1 · CLEAR(web)+CLEAR-dark(native) — carries migration 486 (3 write setters)
- goal: Migration 486: (a) `venue_update_details(p_venue_token,p_updates jsonb)` SECDEF partial-jsonb write to `venues` + `venueUpdateDetails` wrapper + details form (web+native); (b) `venues.opening_hours jsonb` + `venue_update_hours` setter + weekly-hours editor (venue-level, independent of pitch hours); (c) `venues.setup_dismissed_steps jsonb DEFAULT '[]'` + audited dismiss/undismiss setter. Harden resumability both skins; prove superadmin-venue degrade (verified venue shows complete, no nag).
- tier-3 touch: migration (486, 3 SECDEF setters) → APPLY GATE + venue deploy GATE + real-device walk GATE
- proof: build(core+venue+inorout) · hygiene(both rulesets) · rpc-security-sweep(3 setters) · ephemeral-verify(owner writes own; bystander refused; leak-check 0) · migration-apply(486) · casual-regression · Playwright(web+native persist + verified-venue complete)
- PR:
- note: **MVP done = P1+P2+P3.**

### P4 (W4) — Stripe Connect step (web onboarding + endpoint JWT fix + native nudge)
- status: pending
- deps: P1, P3
- tier: tier-2 · PROTECTED (money-adjacent)
- goal: Payments card drives already-built `/api/stripe-connect` onboard action, reflects `charges_enabled` honestly. Fix 2 wiring gaps: (a) rewrite endpoint auth to forward owner JWT (user-scoped client) so `auth.uid()` resolves Stage-1b for token-less self-serve owner — hard blocker; add inorout origin to CORS if needed; (b) point return_url/refresh_url at `view=setup`, re-mint account links on refresh. Web = real onboarding; native = status + "finish on a computer" nudge. Likely no migration (confirm at audit).
- tier-3 touch: money/auth (endpoint) → stripe-best-practices review + endpoint-auth security review + venue+inorout-api deploy + real-device walk GATE
- proof: build · hygiene · stripe-best-practices review · endpoint-auth security review · (rpc-security+EV only if new owner-row Connect path) · casual-regression · Playwright(web onboard→return→truthful status test-keys; native nudge)
- PR:

### P5 (W5) — Go-live auto-flip + new-signup alert + public-listing enforcement
- status: pending
- deps: P1, P3
- tier: tier-3 · PROTECTED (LAST, riskiest)
- goal: Migration 487: (1) `venue_finalize_setup(p_venue_token)` SECDEF re-checks required set (details present + ≥1 pitch/space) then flips `verification_status pending→verified` (server owns predicate — not self-approval); (2) new-venue-signup alert (reuse `self_serve_create_venue` audit_events row; channel = confirm at audit); (3) enforcement: add `verification_status='verified'` to `search_bookable_venues` (mig 149); keep superadmin `rejected` takedown override (`is_platform_admin()`-gated). Go-live tile turns green on objective pass; WOW = "your public booking page is live" reveal.
- tier-3 touch: migration (487) + RLS/go-live-boundary + outward → APPLY GATE + RLS review GATE + venue+superadmin deploy GATE
- proof: SQL drafted → migration-apply sign-off → rpc-security-sweep → ephemeral-verify(incomplete refused; complete succeeds; bystander refused; pending absent from search until flip; rejected-override platform-admin-only; leak 0) → RLS/go-live-boundary review → build · hygiene
- PR:

## Log
<!-- one line per phase outcome: date · phase · result · PR# -->
- 2026-07-06 · epic drafted · manifest created, batched plan gate approved (queue mode) · —
- 2026-07-06 · P1 (W1) · built + proven + reviewed (QA SHIP / Sec SAFE) · PR #306 · OWED: mig 485 apply, venue deploy, live walk
