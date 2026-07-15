# GO LIVE ISSUES — Pre-Onboarding Checklist

*Every production issue we've hit in beta, with the fix and the concrete
device-level check to re-run before opening the app to a new squad.*

---

## HOW TO USE

**When:** before handing the join link to any new squad / admin.

**Why:** beta hit ~40 issues in the first three weeks. Most were
silent — the UI looked fine but a tap did nothing, a notification
never arrived, a player got stranded on the landing page. None of
them surfaced in code review, type-checks, or hygiene scripts. They
were all caught only by a real human on a real device. This log
exists so you re-run those same checks on the new squad's data
before the squad runs them for you.

**How:** walk every domain below in order. For each entry, run the
**Pre-flight check** against the new squad (use a fresh iPhone or a
just-logged-out account where the check calls for it). If anything
behaves differently from the expected outcome, stop and escalate
back to dev before sending the squad the link.

**Maintenance rule:** any new production issue must be added here
in the same commit as the fix that resolves it. The fix isn't
"done" until the pre-flight check exists. This extends CLAUDE.md
hard rule #8 (BUGS.md / FEATURES.md / DECISIONS.md updates) to
this file.

**Companion docs:**
- `BUGS.md` — developer triage, full narrative per session
- `BETA_LAUNCH_CHECKLIST.md` — forward-looking infra + comms pre-flight
- `CONTEXT.md` — session diaries with deeper background

---

## 📥 CAPTURED — triage inbox (unbuilt)
*Raw, unranked production / pre-flight items filed by `/backlog-capture`. `/backlog` reads
from here. Not a resolved issue with a pre-flight check yet — promote into a numbered section
below only once it has a fix + a device-level check.*

- 🔒 **`venue_list_customers_people` returns full member PII (incl. Article-9 medical + minors' guardian/emergency) to ANY venue_admin, incl. plain `staff`** — the read RPC (mig 282) only authenticates the caller as *a* venue_admin via `resolve_venue_caller`; it has NO role/cap gate, so it returns `medical_conditions/allergies/medications/gp_details/guardian_*/emergency_*/address/dob` for every member to whoever calls it. The mobile operator People screen (+ its new detail sheet, PR for H) hide these fields from plain staff *client-side only* (`canSeeContacts`), so the special-category + minors' PII is still delivered over the wire to a reception/groundstaff device and is readable in the network payload/JS heap. Contrast `venue_erase_customer` right below it, which DOES gate on `manage_memberships`. GDPR data-minimisation concern; surfaced by the security review of the mobile People detail sheet. **Fix (tier-3, needs a migration): role-gate the sensitive columns server-side in `venue_list_customers_people` (return medical/guardian/emergency/address only for owner/manager), or add a manager-only detail reader + a minimal projection for plain staff.** Pre-existing (predates the mobile detail sheet — the People list already fetched full rows). Pre-flight: as a plain-`staff` venue operator, open People and inspect the `venue_list_customers_people` network response — it must NOT contain medical/guardian for other members. · captured 2026-07-09 · **RESOLVED 2026-07-10 (mig 524)** — role-gate applied live: `venue_list_customers_people` now NULLs `email/phone/address_*/emergency_*/medical_conditions/allergies/medications/gp_details/guardian_*` for callers lacking the `manage_memberships` cap (plain `staff`); owner/manager unchanged. Non-gated (all callers): name, dob, gender, status, household_id, consent flags, tier, timestamps — enough for the roster + pending count + name search. Same-signature `CREATE OR REPLACE` (no shape change → no consumer break, Hard Rule 7). EV-proven on live DB (owner sees all PII; plain staff gated; staff+explicit-grant sees it; leak 0; live fn untouched pre-apply), rpc-security PASS (single overload, SECDEF, search_path pinned, anon/authenticated grants), PostgREST cache flushed. Consumers (apps/inorout OperatorPeople + ClubAdminToday/People + OperatorBookings picker; apps/venue MembershipsView + ContactPicker) are null-safe. Reversible via `524_*_down.sql`. _resolved_
- 🔒 **`venue_list_members` returns child `dob` + guardian name/email/phone to ANY venue_admin, incl. plain `staff`** — the SIBLING of the leak directly above. The member-list read RPC (mig 410) resolves the caller via `resolve_venue_caller` but had NO role/cap gate, so it returned `email` + `dob` + `guardians[name,email,phone]` for every enrolled member (the member list is child-heavy) to whoever called it — incl. a reception/groundstaff device, readable in the network payload/JS heap even though the UIs hide those fields. GDPR data-minimisation; surfaced by the DF Sports Phase 0 audit. · **RESOLVED + LIVE 2026-07-15 (PR #549, mig 577)** — cap-gate applied live: `email`/`dob` return NULL and `guardians` returns `[]` for callers lacking the `manage_memberships` cap (plain `staff`); owner/manager output byte-identical to mig 410. Guardians gate written FAIL-CLOSED + self-contained (positive `v_pii AND has-profile` path only — does not rely on `_venue_has_cap` never returning NULL). Same-signature `CREATE OR REPLACE` (no shape change → no consumer break, Hard Rule 7; wrapper `venueListMembers` unchanged). EV-proven on live DB (owner full PII; plain staff `email`/`dob` NULL + `guardians` `[]`; non-gated fields — name/status/membership_id/tier — identical to owner; leak-check 0), rpc-security PASS (single overload, SECDEF, search_path pinned, anon/authenticated grants). Reversible via `577_*_down.sql`. Pre-flight: as a plain-`staff` venue operator, open the members list and inspect the `venue_list_members` network response — `email` and `dob` must be null and `guardians` must be `[]` for every member; then repeat as owner/manager and confirm those fields are populated. _resolved_
- ✅ **Nightly scripted QA cannot run to completion on a cloud/Linux session — partially resolved** — full detail in BUGS.md's captured inbox (2026-07-02 + 2026-07-03). Of the original two tooling bugs: `Skills/` vs `skills/` casing breaks every check-*.sh script on case-sensitive filesystems — **RESOLVED, PR #244 (2026-07-03)**; `.claude/hooks/session-start.sh` hardcodes `/Users/tarny/platform` — still open. The Supabase-access question turned out to be TWO stacked issues, both still open: (1) apps run in dev mode with zero effective `VITE_SUPABASE_*` env, so the client never gets real creds; (2) independently, `e2e/lib/auth.mjs`'s own hardcoded demo-Supabase-project connection is blocked by this cloud sandbox's network egress policy (`403 Host not in allowlist: ktvpzpnqbwhooiaqrigm.supabase.co`) — confirmed 2026-07-03, all 9 `qa-suite.sh` projects environment-blocked, zero e2e signal produced. Also newly found 2026-07-03: a clean `npm install` on this same sandbox hard-fails outright (not just the e2e leg) unless run with `--ignore-scripts`, because `sharp` (a transitive dev-dependency of the iOS/Android icon-generation tool `@capacitor/assets`) tries to download a binary from a GitHub release URL the egress policy blocks with 403 — meaning even the syntax/hygiene/build legs of `/qa-loop scripted` cannot bootstrap on a truly fresh cloud clone without knowing this workaround. Net effect: the deterministic build+hygiene legs now run clean on a cloud session (once `--ignore-scripts` is used), but the e2e leg still has zero valid signal on this environment — CLAUDE.md's "Cloud sessions are encouraged" claim remains partially degraded outside the operator's own Mac until the network egress allowlist and env-provisioning gaps are closed · source: qa-loop 2026-07-02 + 2026-07-03 (nightly scripted) · captured 2026-07-02 · updated 2026-07-03 · **updated 2026-07-04:** reproduced again, unchanged (network egress + npm-install-scripts workaround both still required); additionally this cloud session's pre-installed Playwright browser cache (revision 1194) has now drifted behind the repo's pinned `@playwright/test@^1.61.0` (needs revision 1228), so the two unauthenticated e2e projects (`display-token`, `ref-token`) now fail at browser launch itself, one step earlier than the blank-page/env-var failure previously reported — a second stacked environment gap on the same lane · _open (e2e + npm-install-scripts legs + browser-cache-drift); resolved (Skills casing)_ · **📥 UPDATE 2026-07-06**: the "resolved" Skills-casing fix has **recurred** — new scripts (`check-advisors.sh`, `check-deploy-freshness.sh`, `check-drift.sh`, `check-plugin-proxy.sh`, `state/advisors-baseline.json`) were added under the capitalized `Skills/` path again since PR #244, and it's live-broken right now (`skills/scripts/check-hygiene.sh:232` calls a `check-plugin-proxy.sh` that only exists under `Skills/`). A consolidating fix is open as **PR #294** (`fix/skills-dir-case-mismatch`) but needs a rebase before it can merge — see BUGS.md for full detail. The e2e network-egress block also re-confirmed identical tonight, third nightly run running · _open_
- 📥 **No error tracker wired up — silent RLS/RPC failures have no production visibility** — `BETA_LAUNCH_CHECKLIST.md` still lists "Sentry or equivalent error tracking" as DECISION NEEDED, and no app has an ErrorBoundary or a global `window.onerror`/`unhandledrejection` handler (confirmed by grep across `apps/` and `packages/`). Today the only signal is a weekly manual Supabase-log review plus the WhatsApp crash-report path — a silent RLS-denial or SECURITY DEFINER RPC failure in production could go unnoticed indefinitely. Independent of the new `/error-triage` skill (`ERROR_INCIDENT_TRIAGE_HANDOFF.md`, PR #232) — that skill triages an error once you have one; this item is about not having any automated way to know one occurred · source: input:2026-07-02 (ERROR_INCIDENT_TRIAGE_HANDOFF.md audit) · captured 2026-07-02 · _open_
- 📥 **PR4 venue self-serve owes a real-iPhone (Hard Rule 13) native walk** — feature/go-live · effort S · venue self-serve shipped live in PR #303 (2026-07-06) AHEAD of its device walk. On-device: sign in → `/create` → tap **Venue** → create a venue → tap **Open venue console** and confirm the external `<a href>` deep-link to the `apps/venue` web console behaves acceptably on native — lands the owner in a usable session (same account resolves via the `venue_admins` owner row), and check whether it opens in the in-app WKWebView vs Safari (QA-reviewer-flagged). Also confirm the chooser→venue step + validation render correctly on a real device. No code change unless the walk finds a defect · source: input:2026-07-06 (PR #303 merge, prod-verify 303) · captured 2026-07-06 · _open_
- 📥 **App Store privacy-label + age-rating review before Club Manager go-live** — compliance 📋 · effort ~S · the native /hub companion now surfaces children's special-category / safeguarding data (DBS, youth rosters, matchday). Before onboarding a real youth club to prod: review/update the App Store "App Privacy" data-collection details + the app age rating; and note any NEW native binary submitted at launch re-triggers Apple review + the auth/native freeze (Hard Rule 13). Web-bundle /hub screens themselves ship without review. Operator action, no code · source: Club Manager epic go-live G5 / PR #11 · captured 2026-07-08 · _open_
- 📥 **Club Manager console not on the in-or-out.com domain — move to club.in-or-out.com + shared-cookie SSO** — project/go-live · effort ~S · the admin console deploys to platform-club-admin.vercel.app with localStorage auth (VITE_AUTH_COOKIE_DOMAIN unset) → it is NOT on in-or-out.com and does NOT share the *.in-or-out.com SSO cookie with the main app / native /hub (sign-in works, just not seamless cross-app SSO). Before real-club go-live: add a club.in-or-out.com (or admin/manage) subdomain pointing at the platform-club-admin Vercel project, set VITE_AUTH_COOKIE_DOMAIN=.in-or-out.com, rebuild + redeploy (prebuilt-static = manual). Web-only → no Apple involvement; DNS + Vercel domain + env = operator action · source: operator go-live question 2026-07-08 · captured 2026-07-08 · _open_
- ✅ **Player + guardian onboarding go-live check — 3 fixes applied live (migs 570–572)** — security/correctness · **RESOLVED 2026-07-13.** (1) `member_update_self` was **100% broken** (INSERTed into non-existent audit_events columns → every member/guardian "save my own profile" incl. medical/emergency/photo-consent rolled back; undetected — the member self-serve path had zero real usage, all demo data migration-seeded) → **mig 570** fixes it + the two orphaned twins `member_create_profile`/`member_claim_profile`. (2) **mig 571** — `member_accept_consent` on-behalf `invite_state='accepted'` gate + `REVOKE ALL` on people/member_id_documents. (3) **mig 572** — the private `member-id-docs` bucket SELECT policy let **any authenticated user read any passport/birth-cert** → scoped to owner + venue_admin via SECDEF helper `_can_read_member_id_object`. EV-proven (member_update_self found=true+audit; storage own=t/other=f/admin=t/stranger=f), rpc-security PASS ×5, leak-0. Pre-flight: authed member edits `/profile` → Save (address/medical) persists; a plain member cannot fetch another member's `member-id-docs` object; operator still verifies ID docs. · source: go-live-check player+guardian onboarding 2026-07-13 · _resolved_
- 🔒 **Cross-venue ID-doc read (mig 572 residual)** — security 🔒 · **RESOLVED 2026-07-13 (mig 574, applied live).** mig 572's admin arm let ANY `venue_admin` read ANY member's ID document (cross-venue). **mig 574 venue-SCOPES the admin arm inside the existing SECDEF helper `_can_read_member_id_object`**: an operator may read a doc only if they hold an active, non-revoked `venue_admins` grant over a venue linked (`club_venues`) to the exact club the document was submitted to (object name = `member_id_documents.storage_path` → `club_id` → `club_venues.venue_id` → `venue_admins.user_id = auth.uid()`). Mirrors how `get_my_world` resolves an operator's clubs. **Chose SQL-scoping over the originally-scoped service-role minter** because the object name already carries the storage_path (so the club resolves in-policy), so it needs no new deploy surface / no service-role secret AND — critically — it works with the CURRENTLY-DEPLOYED `apps/venue` bundle's client `createSignedUrl`, which a drop-to-owner-only policy would have broken until a manual venue redeploy (not performable this session). **LIVE-DATA SAFE:** 34/34 live docs belong to a club with a `club_venues` link + ≥1 reachable active admin → no legitimate operator read regressed; only the cross-venue read removed. EV-proven (owner=t, same-club-op=t, **cross-venue-op=f**, stranger=f, anon=f; rolled back, leak-0). Helper security unchanged (SECDEF, search_path pinned, single overload, `authenticated`-only). Storage `member_id_docs_select` policy untouched (already delegates to the helper). `.sql`+`_down.sql` same commit (HR#11). · source: go-live-check 2026-07-13 · captured 2026-07-13 · _resolved_
- 📥 **(Optional future hardening) server-side ID-doc signed-URL minter — owner-only policy + gated endpoint** — security 🔒 (defense-in-depth) · effort ~M · with mig 574 the cross-venue hole is CLOSED, so this is no longer a go-live blocker — it is a stronger posture, not a fix. The client (`authenticated` role) can still call `storage.createSignedUrl` on the `member-id-docs` bucket and the SECDEF policy decides; a maximal-least-privilege design would drop the storage SELECT policy to **owner-only** and route ALL operator reads through a service-role minter (Supabase Edge Function) gated by `_can_read_member_id_object`-equivalent logic, so the client never holds storage-read on special-category minor data at all. **Blocked on a coordinated `apps/venue` manual redeploy** (repoint `getMemberIdDocUrl` → the minter) BEFORE the policy is tightened, else the live venue bundle's doc-viewing breaks. Sequence: deploy edge fn → repoint venue source → deploy apps/venue → then flip policy owner-only. · source: go-live-check 2026-07-13 (Phase 3 design divergence) · captured 2026-07-13 · _open_
- 📥 **(Defense-in-depth) `UNIQUE(storage_path)` on `member_id_documents`** — security 🔒 · effort XS · mig 574's admin arm resolves a doc's club by `d.storage_path = <object name>`; with no unique constraint on `storage_path`, a (today practically-impossible: random-uuid paths, 0 live collisions) two-clubs-one-path row would let an operator of EITHER club read it. A `UNIQUE(storage_path)` index makes the per-document club resolution provably 1:1 and forecloses the theoretical over-grant. Its own small migration (verify 0 dups first — confirmed 0 on 2026-07-13). Flagged by the mig-574 security review. · source: go-live-check 2026-07-13 · captured 2026-07-13 · _open_
- 📥 **`get_my_world` guardian arm — add `invite_state='accepted'` filter** — hardening · effort XS · mig 571 added the filter to `member_accept_consent`; the app-wide role resolver `get_my_world()` guardian arm still lacks it (held back deliberately — it's load-bearing for every role, and the change is a no-op on today's all-accepted data). Apply when a `pending` guardian state is ever introduced. · source: go-live-check 2026-07-13 · captured 2026-07-13 · **RESOLVED 2026-07-13 (mig 573, applied live).** Added `AND mg.invite_state = 'accepted'` to the guardian LATERAL arm; every other arm reproduced byte-identical to the live body. No-op on today's data (0 non-accepted of 21 rows). Security unchanged (SECDEF, search_path pinned, single overload, `authenticated`-only). EV against the applied fn: accepted ⇒ resolves 1 child, pending ⇒ excluded (0); rolled back, leak-0. `.sql` + `_down.sql` same commit (HR#11); PostgREST cache flushed. · _resolved_
- 📥 **`/parent-home` → `/hub` nav gap — child ID-doc upload unreachable for a pure guardian** — UX/native 📱 · effort S · a guardian with a child but no casual squad lands on `/parent-home` (Home/Sessions/Profile), which has **no link to `/hub`**. Child consent + medical/EC + add-child are reachable via `/profile` (MemberProfile signs child consents on-behalf), but **child ID-document upload lives only in `/hub` GuardianDocs**. Add a "Documents & consent" entry on `/parent-home` that opens `/hub` (guardian is `hubEligible`). **NATIVE-APP-AFFECTING (Hard Rule 13 — real-iPhone tap-test before commit).** · source: go-live-check 2026-07-13 · captured 2026-07-13 · **RESOLVED 2026-07-13** — added an unconditional "Documents & consent →" row to `ParentHomeScreen` (`IdentificationCard`/`CaretRight`, `go("/hub")`), rendered outside the children/session blocks so it shows with 0 children or 0 sessions. Confirmed a pure guardian IS `hubEligible` (`resolveRoles` emits a `guardian` hat from `guardian_of[]`) so `/hub` renders — GuardianDocs (child ID-doc upload) sits under the guardian's **More** tab. Client-only, no routing-logic change, `check-live-config` CLEAR, casual-regression PASS by scope, QA+security review CLEAN. ⛔ real-iPhone tap-test owed (batched with the go-live walk). · _resolved_
- 🔴 **Stripe webhook endpoint NOT subscribed to `charge.refunded` — operator refunds move money in Stripe but NEVER reconcile to the ledger** — money/config 💳 · effort XS (config, no code) · Found in the 2026-07-14 Stripe go-live walk (Test 3, live sandbox on demo_venue's connected account `acct_1TsshHImDQXNp8aQ`). A full refund via `POST /api/stripe-refund` succeeded in Stripe (`re_3Tt1g1…`, £25) but produced **NO `venue_payments` refund row** — the `venue_charges` row still shows `paid`. Root cause: the Connect webhook endpoint's enabled-events list contains only `account.updated, checkout.session.completed, customer.subscription.created, customer.subscription.updated, invoice.paid` — verified `billing_events` has **0 `charge.*` events ever** and **0 refund rows ever**. The webhook CODE handles `charge.refunded` correctly (→ idempotent `stripe_record_refund`, mig 403) but Stripe never DELIVERS the event because it's not enabled on the endpoint. There is **no cron backstop for refunds** (the 04:00 `membershipReconciliationJob` reconciles subscription status + invoice payments only), so a refunded membership charge stays visibly `paid` in the ledger / `get_my_money` **indefinitely**. Same gap almost certainly hides `invoice.payment_failed` (also handled in code, also unsubscribed) → a failed renewal wouldn't flip the sub via webhook (the cron still repairs status, so lower impact). **Fix (operator/config, tier-3 — Stripe change, no deploy): add `charge.refunded` (and `invoice.payment_failed`) to the webhook endpoint's enabled events** — Stripe Dashboard → Developers → Webhooks → the Connect endpoint → "Select events", or API `POST /v1/webhook_endpoints/{id}` with the extended `enabled_events`. Pre-flight (re-run Test 3): refund a test membership charge on the connected account → within seconds a `venue_payments kind='refund'` row appears and the charge flips to `refunded`/`partially_refunded`. · source: prod-verify 520 / Stripe go-live Test 3 (2026-07-14) · captured 2026-07-14 · **📥 UPDATE 2026-07-15 (code hardening — PR `feat/stripe-connect-disconnected-refund-guard`):** the refund path is now hardened in code — both the `charge.refunded` webhook handler AND the 04:00 `membershipReconciliationJob` refund backstop (which **does** now exist, added since this entry was filed) only mirror refunds where `rf.status==='succeeded'`, so a pending/failed/canceled refund can't be recorded as a ledger refund (a still-pending refund is picked up on a later cron tick once it settles). A new webhook handler for `account.application.deauthorized` (mig 579 — makes `set_venue_connect_state` accept a real `'disconnected'` state: stamps `disconnected_at` + a `venue_stripe_disconnected` audit row) marks a venue's integration disconnected and drops it out of reconciliation when they revoke Connect access. **Operator config action GROWS: the endpoint's enabled events now also need `account.application.deauthorized`** (alongside `charge.refunded` + `invoice.payment_failed`). ⚠️ **All Stripe endpoint + key config must now be done on the in-or-out.com Stripe account** (switched from the old lettrack.co.uk login 2026-07-15) — its webhook endpoints, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, and connected-account IDs all differ from the old platform (the `acct_1Tssh…` above belongs to the OLD account). · captured 2026-07-14 · _open_
- 🟡 **Stripe payments — LIVE go-live: config DONE + code PROVEN, ONE live proof owed** — money/go-live 💳 · The webhook-robustness work (PR #552) + the 2026-07-15 live-account setup wired the LIVE Stripe account (`acct_1TihcaIAelF0ohDl` — **separate** from sandbox `acct_1Tihcl…`, Stripe's isolated-sandbox model): live Connect webhook endpoint created (Connected-accounts scope, 9 events, `app.in-or-out.com/api/stripe-webhook`), live `sk_live_`+`whsec_` set in Vercel `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, platform-clubmanager redeployed, Connect+Accounts settings copied sandbox→live, account appears activated. `/go-live-check` (2026-07-16) verified the code side **CLEAN** — RLS on all 8 payment tables; all 11 Stripe write RPCs SECDEF + service_role-only (no anon/authenticated); mig source 403–408+579 applied, no drift; audit coverage; **ALL Stripe API routes live in apps/inorout** (so apps/venue MANUAL-deploy is NOT a blocker — it's only a UI caller of `VITE_INOROUT_API_URL/api/*`); no client feature-flag (money path went live on the redeploy). Sandbox proven end-to-end (a real CLI-triggered `charge.refunded` on the demo connected account → delivered → `status='processed'` → ledger, ~1.4s). **NO T1/T2 defects.** REMAINING (operator-owned T3, un-verifiable from here — the Stripe MCP is scoped to the SANDBOX account, and no real-money test was run): (1) final live-account **activation** confirm (Settings → no pending 'verify/complete'); (2) **ONE live end-to-end connect + small-real-payment + refund proof** → then READY TO LAUNCH (no flag to flip; path already live). Also confirm apps/venue has `VITE_INOROUT_API_URL`→app.in-or-out.com (worked in sandbox). Satisfies the DECISIONS.md money-flow gate ("operator sign-off + live keys") bar the live proof. · source: go-live-check Stripe payments 2026-07-16 · captured 2026-07-16 · _open (live proof owed)_

---

## 🔒 HARD GO-LIVE GATE — SAFEGUARDING MODULE LEGAL PREREQUISITES (owed retrospectively)
*Filed 2026-07-01. The Safeguarding Module (Incident Triage Phase 2, `SAFEGUARDING_MODULE_HANDOFF.md`,
mig 466 — SCOPED, may be BUILT before this clears because the platform has no real users yet) stores
a safeguarding flag = **processing special-category child-protection data**. The build is allowed to
proceed dark; **this gate BLOCKS exposing the module to ANY real venue / real user** until every item
is signed off. Do NOT hand a real venue a build with the safeguarding flag live until all four are done.*

**Pre-flight (before any real venue/user touches the safeguarding module):**
1. **DPIA** (Data Protection Impact Assessment) completed + signed off — mandatory for children's /
   special-category processing. ✅ **APPROVED 2026-07-08 (operator Tarnbir Athwal)** — recorded in DECISIONS.md; pack `CLUB_MANAGER_DPIA_AND_SAFEGUARDING_PACK.md`.
2. **Controller/processor decision documented** — venue/club = controller (holds the Designated
   Safeguarding Lead); In or Out = processor of a routing pointer only. Must NOT let the platform become
   an independent controller of safeguarding content. ✅ **APPROVED 2026-07-08 (operator)** — per DPIA pack Part B.
3. **Appropriate Policy Document (APD)** in place for the DPA 2018 Sch 1 §18 ("safeguarding of children
   / individuals at risk") Art 9 condition; **processor terms** in the venue/club agreement updated. ✅ **APPROVED 2026-07-08 (operator)** — per DPIA pack Part C.
4. **Retention rule agreed** for a flagged record (drives the `delete_my_account*` carve-out already in
   the build: flagged records SURVIVE subject/reporter self-deletion, Art 17(3)(b)). ✅ **APPROVED 2026-07-08 (operator)** — per DPIA pack Part D.
- **Expected outcome:** all four ticked + recorded in DECISIONS.md before the flag action is enabled for
  a real venue. **✅ ALL FOUR APPROVED 2026-07-08 (operator Tarnbir Athwal, in-session sign-off) — G3 CLEARED.**
  Physical initialling of pack Parts A–D remains a document-housekeeping action for the audit trail; the
  approval-to-proceed is recorded here + in DECISIONS.md. Real-child data exposure (#11 board) is now unblocked.
- **⬜ HARDENING (defense-in-depth, non-blocking) — count-only safeguarding-concerns reader.** The Club
  Manager safeguarding board (PR #11) shows only a COUNT of open concerns to the Designated Lead, but the
  underlying reader `venue_list_safeguarding_incidents` returns the full incident bodies (description/
  category/severity) to the Lead's device — the "count-only on a dashboard" boundary is currently held by
  client render discipline alone, with no server backstop against a future careless edit mapping the bodies
  into the panel. The Lead is an authorised reader so this is defensible, but before broad go-live consider a
  dedicated `venue_count_safeguarding_incidents` (count-only) RPC for the dashboard so narratives never
  transit the wire for a summary view. Filed from the PR #11 security review (2026-07-08).

---

## 🔒 HARD GO-LIVE GATE — MATCH FITNESS (APPLE HEALTH) — `VITE_HEALTH_KIT_ENABLED`
*Filed 2026-07-04 (go-live-check). The Match Fitness feature (`MATCH_FITNESS_STATS_HANDOFF.md`,
migs 456/457/475/476) stores **special-category health data** (heart rate, fitness) —
originally also **precise location** (GPS route/heatmap), **DROPPED 2026-07-04 (see UPDATE below)** —
an ICO high-risk processing. The code + database are
launch-grade (RLS on, RPC-only, anon-revoked, consent + under-18 + casual-only + audit + erasure
all verified live 2026-07-04). The whole feature is **dark behind the flag**; this gate BLOCKS
flipping `VITE_HEALTH_KIT_ENABLED=true` for real users until every item below is done.*

**Pre-flight (before flipping the flag for real users):**
1. **DPIA completed + signed off** — mandatory for special-category + location processing before
   it begins. **✅ SIGNED 2026-07-07** (operator Tarnbir Athwal) in `MATCH_FITNESS_DPIA_ADDENDUM.md`
   §11; DECISION 1 + DECISION 2 both recorded. ✅
2. **Controller/processor decision recorded** (DPIA DECISION 1) — venue/club = controller where
   present, but **In or Out is controller for club-less casual squads**. **✅ RESOLVED option (b)**
   (operator, 2026-07-04); live privacy notice (`Legal.jsx`) already names In or Out as controller. ✅
3. **G5 real-device walk PASSED** — grant/deny Health, Outdoor + Indoor Apple Soccer, match-to-game
   link, multi-workout picker, sync-delay retry, under-18 block, consent on/off. (Heatmap step
   dropped 2026-07-04 — see UPDATE below.) Tick-box script: `MATCH_FITNESS_G5_DEVICE_WALK.md`.
   Human-on-device — can't be automated. ⬜
4. **THEN flip** `VITE_HEALTH_KIT_ENABLED=true` in the `apps/inorout` Vercel env (Production).
   No new build — the feature is dark-behind-flag already shipped; displays light up on has-data. ⬜
5. **Post-flip cleanup — remove the test-bed allowlist.** `apps/inorout/src/native/native-health.js`
   hardcodes `HEALTH_TESTBED_UIDS` (one operator auth-ID) for the account-scoped dark launch. Its
   own comment says remove it when the flag flips. **⚠️ MUST stay until AFTER the flip — while the
   flag is off it is the ONLY thing enabling the G5 walk on-device; removing it early locks the
   operator out of their own test.** Once the flag is true it is redundant + leaves a personal ID
   in the shipped bundle → run `/dev-loop` to delete the set + the `userId` param plumbing. ⬜
- **UPDATE 2026-07-04 — heatmap/route DROPPED (PR pending).** Apple does not persist a retrievable
  GPS route for football workouts (operator's 3 live test attaches: distance present, 0 route
  points), so the heatmap never populated. Route path removed (web-bundle-only, no migration) →
  **no location data collected** → DPIA simplified to health-data-only (see §7a of
  `MATCH_FITNESS_DPIA_ADDENDUM.md`). `match_health_routes` left dormant (0 rows). Native binary
  still requests route read-permission — remove at the next App Store build.
- **G5 progress (operator device walk 2026-07-04):** grant/deny ✅ · outdoor stats populate ✅ ·
  18+ age-gate popup appeared ✅ · multi-workout picker + sync-delay untested (operator-accepted) ·
  under-18 block untestable without an under-18 account (server + client guards verified in code) ·
  teammate consent/comparison still owed (needs a 2nd consenting player).
- **✅ RESOLVED 2026-07-07 — RE-FLIPPED ON.** History: flipped live 2026-07-04 (dpl `qx716ghsj` +
  allowlist removed), then the Vercel env var was accidentally recreated **empty ~2026-07-05**,
  silently reverting Match Fitness OFF (masked because displays gate on has-data, not the flag, so
  demo data kept rendering — the code + docs wrongly asserted "live" for ~2–3 days). Verified OFF
  against live Vercel on 2026-07-07. **Re-enabled 2026-07-07 (operator decision, after DPIA sign-off):**
  `VITE_HEALTH_KIT_ENABLED=true` set on **platform-clubmanager** Production (non-sensitive/Encrypted,
  value re-pull-verified `"true"`) + prod redeployed from `main` (dpl `ca2qk7dhr` → aliased
  `app.in-or-out.com`, HTTP 200, Match Fitness feature strings confirmed in the served bundle).
  **Lesson:** the env var is now non-sensitive so its value can be re-pulled and drift re-detected;
  displays gating on has-data means a silent flag revert is invisible in-app — re-verify the live
  Vercel value directly, don't trust the UI.
- **⚠️ Allowlist already removed — flag is the sole gate.** `HEALTH_TESTBED_UIDS` was deleted from
  `native-health.js` during the 2026-07-04 flip, so there is no private-preview path; the flag is
  all-or-nothing to every native user (now ON).
- **Re-enable checklist (2026-07-07):** DPIA ✅ signed · core G5 (grant/deny, outdoor stats, 18+ gate)
  ✅ walked on-device 2026-07-04 · flag ✅ ON + redeployed 2026-07-07 · **edge-case G5** (multi-workout
  picker, sync-delay retry, under-18, teammate consent) ⬜ **still operator-accepted-untested — owed a
  real-device walk now that it's live.**
- **Expected outcome:** items 1–3 done + recorded in DECISIONS.md, flag flipped (4), allowlist
  removed (5). Until items 1–3 clear, the feature stays dark. **Rollback:** flag back to `false`
  stops new attaches but does NOT erase data already collected (displays gate on has-data, not the
  flag) — withdrawal = per-session detach + delete-account erasure (both verified live), per DPIA
  DECISION 2.

---

## 0. EMAIL / TRANSACTIONAL (Resend) — Phase 9 Cycle 9.1

**Issue class:** transactional email silently doesn't send. Phase 9.1 added a Resend-backed
sender (`apps/inorout/api/_mailer.js`) driven by `onboardingEmailJob` in `api/cron.js`. The
code **no-ops by design** when `RESEND_API_KEY` is unset — so a missing/incorrect env var or
unverified domain means zero emails with no error surfaced to the user.

**Required env vars (inorout Vercel project, Production + Preview):**
- `RESEND_API_KEY` — sending-scoped key from the In or Out Resend account.
- `EMAIL_FROM` — e.g. `In or Out <notifications@in-or-out.com>` (must be on the **verified** domain).
- `REF_APP_URL` / `VENUE_APP_URL` *(optional)* — base URLs so ref/venue links appear in emails;
  omitted gracefully if unset.

**Pre-flight checks (before relying on any email):**
1. Resend dashboard → `in-or-out.com` shows **Verified** (SPF + DKIM green). DNS is at **GoDaddy**
   (`domaincontrol.com` nameservers) — records added under Manage DNS for in-or-out.com.
2. Env vars set in Vercel **and a redeploy has happened** (serverless functions read env at deploy).
3. Live send: approve a real (non-demo) team registration → the team admin receives the
   "You're in" email within ~15 min (cron cadence); confirm a `notification_log` row with
   `channel='email'`, `recipient=<that email>`, `sent_at` set.
4. **Demo caveat:** `team_registration_pending` won't email on the demo venue — `demo_venue`
   has no `venue_admins` row, so there's no recipient. Use a real venue created via
   `superadmin_create_venue` to exercise the venue-admin path.
5. Free-tier limit is **shared across the Resend account** (3k/mo, 100/day). Watch volume if the
   account hosts other projects.

**Status:** code shipped (mig 163, commit `6d73345`); env/DNS set + **live-verified 2026-05-29**
(team_approved → Resend → inbox; `notification_log` channel='email'; dedup confirmed). The
pre-flight checks above remain the re-run procedure for each new venue/squad and for the
still-unexercised `team_registration_pending` (real-venue) path.

---

## 0b. SMS / WHATSAPP (Twilio) — Phase 9 (transport core, UNWIRED) — session 59

**Issue class:** none active yet — `apps/inorout/api/_sms.js` (Twilio) is the transport core
and is **imported nowhere**. It no-ops (`skipped:'no_credentials'`) until `TWILIO_*` env is set,
exactly like `_mailer.js` without `RESEND_API_KEY`. Nothing sends SMS/WhatsApp in production.

**When it gets wired (later 9.x cycle), required env (inorout Vercel, Prod + Preview):**
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — from the In or Out Twilio account.
- `TWILIO_SMS_FROM` — an SMS-capable E.164 number (e.g. `+447700900123`).
- `TWILIO_WHATSAPP_FROM` — a WhatsApp-enabled sender number.

**Pre-flight (before relying on SMS/WhatsApp):** WhatsApp business-initiated messages outside
the 24h customer window require **pre-approved templates** — a real Twilio/Meta onboarding step,
not just env vars. SMS is simpler but needs a verified sender and (for UK) sender-ID rules.
Refs (`match_officials.phone`/`whatsapp_number`/`preferred_channel`) are the first deliverable
recipients; players can't receive SMS until a contact-capture UI populates `players.phone`.

---

## 0c. HQ DASHBOARD (apps/hq) — Phase 6.1 — session 60

**Issue class:** new authenticated app at `/hq`; nothing renders past a blank/sign-in screen
without its Supabase env, and the dashboard is empty without a company + company_admins row.

**Required env vars (new `apps/hq` Vercel project, Production + Preview):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — same values as the other apps (the Supabase
  client throws `supabaseUrl is required` and the app is blank without them). Locally: an
  `apps/hq/.env.local` (gitignored) holding both.

**Pre-flight (operator-owed, real device/account):**
1. Deploy `apps/hq` as its own Vercel project (SPA rewrite is in `apps/hq/vercel.json`); set the
   two env vars above; the OAuth redirect URL (Supabase Auth → URL config) must include the
   deployed origin.
2. Sign in at `/hq` with **tarnysingh@gmail.com** (seeded as `company_demo` super_admin via mig
   170). Expect: company picker hidden (one company), header "Demo Sports Group · super_admin",
   Venue Health Grid showing **demo_venue 🔴** (critical incident) + **Demo Arena South 🟢**.
3. Tap demo_venue → drill-down shows 2 open incidents + its fixtures/leagues. Tap **Resolve** on
   one (add a note) → it disappears, grid incident count drops, an `incident_resolved`
   `audit_events` row lands, and the venue app (`/venue/<token>`) refreshes its open-issues panel
   (the `notify_venue_change('incident_resolved')` broadcast).
4. **Role checks** (need a 2nd Google account added to `company_admins`): an `analyst` sees the
   dashboard but Resolve is hidden / `read_only_role`; a `regional_admin` with `region='South'`
   sees only Demo Arena South.
5. **Demo caveat:** the seed is namespaced (`company_demo` / `venue_demo_south`) and fully
   removable via `170_demo_company_seed_down.sql` — pull it before onboarding a real company.
6. **Preview link (6.5):** as super_admin, tap **Share preview** → copy the `/hq/preview/<token>`
   link → open it in a private window (no login) → confirm the watermarked read-only snapshot
   renders and `hq_preview_tokens.accessed_at` stamps. The deployed origin must serve the SPA
   fallback for `/preview/*` (vercel.json rewrite handles this). Links expire after 7 days.
   "Notify on open" is not wired — `accessed_at` is the only signal for now.

---

## 6.x LEAGUE AVAILABILITY / FIXTURE-REMINDER PUSH — Phase 9 (session 59)

**Issue class:** the two new competitive crons (`availabilityRequestJob` 48h-out;
`fixtureReminderJob` ~2h-before) push via the existing web-push chain. Same silent-failure class
as §6.2 — if no device is subscribed on a competitive squad, nothing delivers and no error
surfaces. **Logic dry-run-verified against the live DB (session 59)** but **real-device delivery
is unverified** (hard-rule #13).

**Operator pre-flight (real-device, owed):**
1. On a real phone, open a competitive squad's `/p/<token>` (e.g. a Competitive FC player),
   install to home screen, and tap **Enable notifications** — confirm a `push_subscriptions`
   row appears (today `dc_subs=0`, so nothing can deliver until this is done).
2. Ensure a competitive `fixtures` row is **48h out** (for the 9am availability push) and/or
   **~2h out** (for the kickoff reminder). The seeded democomp fixtures roll; temporarily set
   `scheduled_date`/`kickoff_time` on a `dc…` fixture if testing off-cycle (revert after).
3. At the UK 9am tick on (fixture_date − 2), confirm the device receives "Are you in?" and a
   `notification_log` row lands with `type='leagueAvailability48h'`, `team_id`, the fixture date.
4. ~2h before kickoff, with the player still `status='none'`, confirm the "Last call" push and a
   `type='leagueFixtureReminder2h'` log row. Marking in/out beforehand should suppress it.
5. Dedup: a second 15-min tick in the same window must NOT re-push (guarded by `alreadyLogged`).

---

## 6.y CASUAL PUSH OPT-IN BANNER — re-nag on already-subscribed players (Jul 8 2026)

**Issue class (FIXED — mig 514):** the "TURN ON NOTIFICATIONS?" opt-in banner was gated purely on
a client-side `localStorage["notif_<playerId>"]` flag. If that flag was lost (app update / cache
clear) or an in-app registration round-trip was interrupted, the banner re-appeared on every "in"
tap even though the player already had a valid `push_subscriptions` row server-side — and because
"Allow" never counted toward the 3-ask cap (only "Not now" did), a failing Allow nagged forever.
Reported live for player Rocky (`p_cQ-NpVz55ng`). Fix: read-only RPC `player_has_push_subscription`
lets the client trust the server truth on mount and suppress the banner; failing Allows now count
toward the cap. See BUGS.md (Jul 8 2026).

**Operator pre-flight (real-device, owed — Hard Rule 13, push is native-only):**
1. On a real iPhone in the native app, as a player who ALREADY has a `push_subscriptions` row,
   tap into a squad — the banner must NOT appear (server-truth suppression).
2. As a fresh player, tap **Allow**; confirm the OS prompt, a `push_subscriptions` row lands, and
   the "YOU'RE ALL SET" confirmation shows then auto-dismisses. Re-open — banner stays gone.
3. Simulate a failing Allow (e.g. decline at OS level after tapping Allow, or airplane-mode the
   token save): confirm the banner stops re-appearing after 3 total asks rather than nagging forever.

---

## 6.z VICE-CAPTAIN +1 APPROVE/DECLINE — dead for VCs ("admin link out of date") (Jul 10 2026)

**Issue class (FIXED — mig 530, APPLIED-live):** a Vice Captain opening the admin panel via their
`/p/<player_token>` route has that PLAYER token passed as `adminToken` to every admin RPC. The two
plus-one RPCs `admin_approve_guest` / `admin_decline_guest` (mig 346) hand-rolled a plain
`admin_token = p_admin_token` lookup with **no VC dual-lookup**, so a VC's token never resolved and
the RPC raised `invalid_admin_token` → the panel showed "Couldn't update — your admin link may be
out of date. Pull to refresh." on Approve/Decline of a pending +1. Team owners were unaffected
(their `admin_token` matched), which hid it. Reported live on Footy Tuesdays. Fix: both RPCs adopt
the documented dual-lookup (admin_token OR VC player_token, target-team-scoped; ref mig 116). Swept
the other 33 `admin_*` RPCs — all already VC-safe via `resolve_admin_caller`. See BUGS.md (Jul 10 2026).

**Operator pre-flight (real-device, owed — Hard Rule 13, admin surface is un-prod-verifiable):**
1. On a real iPhone, signed in as a **Vice Captain** (not the team owner), open the team → **Admin**
   tab. With a pending +1 in the Plus-One Approvals card, tap **Approve** — the guest must move to
   IN (or Reserve if the squad is full) with no error toast.
2. Repeat with **Decline** on another pending +1 — it must drop from the card cleanly.
3. Sanity: as the team **owner** on `/admin/<token>`, Approve/Decline still works (no regression).

---

## 1. SIGN-IN / AUTH

### 1.1 PWA storage partition — JWT never reaches the home-screen app
**Symptom:** signed-in user opens the installed PWA from the home
screen and any feature that needs auth silently no-ops (My Squads
shows the placeholder, admin can't tap own in/out, link/delete
account does nothing).
**Root cause:** iOS deliberately partitions Safari localStorage from
installed-PWA localStorage. The OAuth callback lands in Safari, the
JWT is written there, the home-screen launch reads from a separate
storage scope that has never seen the sign-in. `refreshSession()`
has nothing to refresh.
**Fix:** in-PWA email-OTP modal (`AuthGateModal.jsx` +
`useRequireAuth` hook). Modal pops on the 4 actions that need auth:
join new team, delete account, link account, admin/VC tapping own
status. Commits `cdba41d`, `b1935e5`, `ba7bc8d`. Migrations 061,
072.
**Pre-flight check:** on a real iPhone, sign out of the app
entirely. Open the app in Safari → install to home screen →
force-quit Safari → tap the home-screen icon. Tap the admin/VC's
own status. The email-OTP modal must pop. Enter email, then the
8-digit code. Page reloads. Tap status again — it commits to the
right row. Modal does not re-appear on next reopen.

### 1.2 OAuth loop on `/join/CODE` (authReady race)
**Symptom:** new user taps Google on the join page, completes
OAuth, comes back to the same "Continue with Google" screen.
**Root cause:** JoinTeam rendered the sign-in CTA before App.jsx
had resolved the initial Supabase session, so `authUser=null` was
truthy on first paint.
**Fix:** JoinTeam self-checks via `supabase.auth.getSession()` on
mount + App.jsx exposes an `authReady` flag that holds every route
until the top-level session probe resolves. Commits `2cd33c9`,
`5c2cae2`.
**Pre-flight check:** in a fresh browser profile (no cookies), open
`/join/<new_squad_code>`. Tap "Continue with Google", complete
OAuth. You must land on the team join screen, not the sign-in CTA
again.

### 1.3 "User not found" OAuth loop after a previous delete-account
**Symptom:** a user who previously deleted their account tries to
sign back in with the same Google account and loops silently
("User not found" in Supabase logs).
**Root cause:** the old `delete_my_account` RPC anonymised the
player row and *revoked* (not deleted) `team_admins` rows, never
touched `user_profiles`. Postgres refused to delete `auth.users`
because those FKs still pointed at it. `auth.admin.deleteUser`
returned `authDeleted:false` silently; the stale `auth.identities`
row blocked the email forever.
**Fix:** migration 047 — DELETE (not revoke) `team_admins` rows,
NULL granted_by / revoked_by references, DELETE `user_profiles`
row. `/api/delete-account` now returns `authDeleted:true`. Commit
`155f0ee` (edge function notes), migration 047.
**Pre-flight check:** if onboarding a squad where the admin or any
player has ever deleted an account before (rare but possible),
verify their email no longer appears in `auth.users` /
`auth.identities` / `user_profiles` via the Supabase dashboard
before they try to sign in.

### 1.4 Admin-route player self-writes silently no-op'd
**Symptom:** team_admin on `/admin/<token>` taps own "out" on My
View. UI flips optimistically; DB never updates; other players see
status as `none`.
**Root cause:** `get_team_state_by_admin_token` stripped credentials
from squad rows. App.jsx admin resolver couldn't find `me.token`
because it wasn't in the payload, so every player-self write
short-circuited at `if (me?.token)`.
**Fix:** migration 061 exposes the admin's own token in the squad
payload (gated by `auth.uid()` match). App.jsx resolver rewired.
Now combined with §1.1's in-PWA auth modal because mig 061 needs
`auth.uid()` to fire. Commit `77b4bb5`.
**Pre-flight check:** as the new squad's admin, signed in, on
`/admin/<token>`: tap your own status row (IN/OUT/MAYBE). Wait
for realtime to propagate. Open on a second device as a different
player and confirm the admin's status changed.

---

### 1.5 Native app — Sign in with Apple spins forever then logs out (refresh-token storm)
**Symptom:** in the native iOS app (and especially on iPad), Sign in
with Apple succeeds, then the app loads indefinitely and logs the user
straight back out. App Store rejection 2.1(a), twice (builds 1.0(3) and
1.0(4)).
**Root cause:** the native shell loads the live site via `server.url`,
and the shared-subdomain SSO adapter stores the session in a **cookie**
whenever it thinks it is on the web. Native detection
(`Capacitor.isNativePlatform()` / the `__CAP_NATIVE__` flag) can return
**false** inside a remote-`server.url` WKWebView — confirmed on the
reviewer's iPad. Cookie mode then engages, but WKWebView returns
stale/partial cookie reads within the session, so supabase-js rotates
its refresh token in a tight loop (the reviewer's account: 47 rotations
in 44s) until the auth server 429s it and the session dies. The
localStorage mirror did not rescue it — `getItem` only fell back to the
mirror when the cookie was fully *absent*, never when it read back
*wrong*.
**Fix (round 2, session 212):** `cookieAuthStorage.js` now SELF-HEALS
independently of native detection — every cookie write is read straight
back, and the first time the read-back ≠ what was written it latches to
localStorage-only for the session (mirror written first, so the live
session is never lost; in-memory only, so healthy web SSO is unaffected
and never permanently disabled). Ships in the live bundle, so it also
fixes the binary already submitted. Recommended follow-up: an
`appendUserAgent` marker in `capacitor.config.ts` so native detection
can never silently fail (a fresh build).
**Pre-flight check:** on a real **iPhone AND a real iPad**, install the
native build, Sign in with Apple with a *fresh* Apple ID (use Hide My
Email to mimic App Review). Confirm you land on the app — not a spinner,
not a bounce back to the sign-in screen. Force-quit and reopen: you stay
signed in. (Web-only smoke and the simulator will NOT reproduce this —
it only shows on a real device's WKWebView.)

### 1.6 Multi-hat user lands on the retired `/feed` feed, not `/hub`
**Symptom:** a signed-in user with multiple contexts (e.g. a guardian
who also plays, or a club admin who also plays) opens the app and lands
on the old "IN OR OUT / What's coming up" `UnifiedFeedScreen` (bottom
tabs Feed/Sessions/Profile) instead of their `/hub` role home. The feed
doesn't scroll and is stale. Looked like retired code "reappearing".
**Cause:** the `/feed` landing redirect (`App.jsx`, `homeScreenType ===
"multi"`) predates the `/hub` role hub and was never re-pointed — the
old code was never removed, so every "multi" user was routed to it. A
stored last-visited breadcrumb then re-opened `/feed` on every launch.
**Fix (`fix/hub-landing-retire-feed`):** any signed-in user holding ≥1
`/hub` hat (`resolveRoles(get_my_world())` non-empty) is routed to
`/hub` from the landing, the `/feed` route itself, and the multi-team
player switcher; a `myWorldReady` flag (with a 4s safety-valve) gates
the decision so hats resolve first without a flash or an infinite
spinner. A pure casual/multi-team player with no hub hat still gets the
legacy `/feed`. (Follow-up: delete `UnifiedFeedScreen` + the dead
`/feed` plumbing; retire `/parent-home` + `/sessions` onto `/hub` too
is a separate decision — other hub-hat classes aren't rerouted yet.)
**Pre-flight check:** on a real iPhone, sign in as a multi-hat account
(a guardian who also plays, or a club admin who also plays). On app
open — and again after force-quit + reopen — confirm you land on the
`/hub` role home (role tabs), NOT the "What's coming up" feed. Then
confirm a pure single-squad casual player still lands straight in their
squad (unchanged).

---

## 2. MULTI-TEAM MEMBERSHIP

### 2.1 Second team-membership unreachable for returning users
**Symptom:** a user who already has one team joins a second team
via a join link. Every app-open lands in the first team; no URL or
My Squads click can reach the second. My Squads accordion collapses
both squads into one.
**Root cause:** `player_join_team` (044) and
`join_team_as_returning_player` (015) reused a single `players` row
across multiple memberships for the same auth user. One
`player.token` → two `team_players` rows. The deterministic
`ORDER BY tp.created_at ASC LIMIT 1` resolver always picked the
earliest team.
**Fix:** migrations 065–069 — fresh `players` row + token per
team-membership. 067 relaxes `link_player_to_user` (one user can
own multiple players). 068 makes `delete_my_account` iterate every
owned player row. Commit `1e7da1f`.
**Pre-flight check:** if the new squad's admin already has a team
on the platform, have them join the new squad's link from the same
signed-in account. My Squads must show both squads as distinct,
clickable rows. Tap into the new squad — the URL must resolve to
the new team's state, not the old one.

### 2.2 "Copy personal link" emitted `/p/<player_id>` not `/p/<token>`
**Symptom:** admin opens Squad screen, taps "copy link" for any
player, pastes — URL doesn't resolve. URL contains the player id
(`p_30834a6b`) not the token (`p_XFGglFrN5xVSo2FJx8I`).
**Root cause:** `SquadScreen.jsx` falls back to `p.id` when
`p.token` is null. Migration 061 stripped `p.token` from non-admin
squad rows in `get_team_state_by_admin_token` and the same in
`get_team_state_by_player_token` (VC route). The fallback silently
shipped player_ids.
**Fix:** migrations 070 + 071 expose `p.token` on every squad row
to privileged callers (admin via admin_token, VC via player_token);
adds `is_self` boolean for the admin's own row. App.jsx admin
resolver switched to `find(p => p.is_self)`. Commits `010b5d4`,
`34cfd23`. Mapper fix in `dbToPlayer` (commit `cdba41d`) — rule #12
in CLAUDE.md.
**Pre-flight check:** as admin, open Squad screen for the new
squad. Tap "copy link" on three different players. Paste each into
a fresh browser tab. All three must resolve to a valid PlayerView,
not 404 or the landing page.

---

## 3. JOIN FLOW

### 3.1 `player_join_team` never generated a player token
**Symptom:** first-time joiner completes OAuth, lands on the
landing page with no apparent team membership. `JoinSuccess.jsx`
silently falls back to `/`.
**Root cause:** the new-player INSERT branch in `player_join_team`
omitted the `token` column, so first-time joiners landed with
`player.token=NULL`.
**Fix:** migration 044 — token generated via the same helper
`create_team` uses. Commit `cec9975`.
**Pre-flight check:** in a completely fresh browser profile,
complete the join flow for the new squad. You must land on
JoinSuccess, then on `/p/<token>?just_joined=1` — confirm the URL
has a real token, not an empty string or `/`.

### 3.2 Player invite link showed team_id instead of join_code
**Symptom:** admin shares the "player invite link" — recipients
land on a broken or wrong-team join page.
**Root cause:** `SquadScreen.jsx` rendered
`in-or-out.com/join/${teamId}` instead of using `team.join_code`.
Masked because `get_team_by_join_code` has a team_id fallback, but
the wrong identifier was being shared.
**Fix:** SquadScreen now fetches the team via `getTeamByAdminToken`
on mount and uses `team.join_code`. Commit `a8b803e`.
**Pre-flight check:** as the new squad's admin, open Squad screen
and copy the player invite link. The URL path segment after `/join/`
must look like a short alphanumeric code, not a `team_` prefixed
ID.

### 3.3 `player_join_team` left no audit trail and no realtime broadcast
**Symptom (latent — surfaced via audit, not user report):** new
player completes join, lands successfully, but other browsers
already viewing the team don't see them appear in realtime — only
on the next unrelated broadcast does the squad re-fetch. And if
the join ever goes wrong silently, there's zero server-side trail
in `audit_events` to debug it (which has bitten us in sessions
42/43 join-flow bugs).
**Root cause:** five rewrites of `player_join_team` over time, none
added the audit + broadcast pattern that other player-self writes
adopted in migs 060/063. Violated HARD RULE 9 and HARD RULE 10.
**Fix (mig 128):** body preserved byte-for-byte; added
`INSERT INTO audit_events` (`action='player_joined_team_self'`)
and `PERFORM notify_team_change(p_team_id, 'player_added')`.
Reuses existing whitelisted broadcast reason.
**Pre-flight check:** during onboarding, have a brand-new player
click the join link and sign in. (a) On a second device already
viewing the team as admin, the new joiner must appear in the squad
within ~2 seconds with no manual refresh. (b) In Supabase SQL
editor, run `SELECT * FROM audit_events WHERE
action='player_joined_team_self' AND team_id='<new_team>'` — must
return one row with the new player's id in `entity_id` and the
joiner's name in `metadata->>'name'`. If (a) fails the broadcast
regressed; if (b) is empty the audit hook regressed.

---

## 4. PWA INSTALL

### 4.1 Installed PWA opened to "Paste your link" instead of admin/player view
**Symptom:** admin/player completes onboarding, installs the PWA to
home screen, opens from the icon — lands on the "Paste your link"
welcome screen with no context.
**Root cause:** iOS reads the web manifest at HTML parse time and
ignores any later JS mutations. The default manifest's `start_url`
is `/`. localStorage breadcrumbs don't survive the Safari →
installed-PWA storage boundary on iOS.
**Fix:** per-install dynamic manifest. `/api/manifest?admin=<token>`
and `/api/manifest?player=<token>` emit a manifest whose
`start_url` is `/admin/<token>` or `/p/<token>`. An inline
`<script>` in `index.html` injects the right
`<link rel="manifest">` at HTML parse time. Post-create and
post-join flows hard-redirect to `/admin/<token>?just_created=1`
and `/p/<token>?just_joined=1` so the URL path matches what the
inline script needs. Commits `11614ee`, `2d12db3`, `b7236ca`,
`f62cc7c`, `90bba41`.
**Pre-flight check:** on a real iPhone (not desktop emulator), as
the new admin: complete the create flow → tap "Add to Home Screen"
from the SquadReady page → force-quit Safari → tap the icon. The
app must open directly on the admin panel, not the welcome screen.
Repeat for a player: complete join → install → force-quit → tap
icon → must land on PlayerView.

### 4.2 Admin rendered as another player on PWA cold-start
**Symptom:** team admin opens their installed PWA from the home
screen and sees a different player's PlayerView (name, stats,
in/out status all belong to someone else). Only the admin route
(/admin/<token>) is affected — /p/<token> player and VC routes
render correctly.
**Root cause:** iOS PWA cold-start can race auth-session
attachment. `supabase.auth.refreshSession()` fires in App.jsx but
the team-state RPC can run before `auth.uid()` is populated.
Server-side, that meant `is_self=false` on every squad row.
Pre-mig-125, the client fell back to `squad[0]?.id` to pick the
admin's identity, and the squad agg had no `ORDER BY` — so the
"first" player was whoever postgres returned that millisecond.
Pre-mig-125 the dice could land on any squad member.
**Fix:** mig 125 added deterministic `ORDER BY tp.created_at, p.id`
to `get_team_state_by_admin_token` and
`get_team_state_by_player_token`, so `squad[0]` is now always the
team creator. The non-impersonation JS guard sits on branch
`fix/admin-impersonation-guard` (kills the squad[0] fallback +
adds an "ADMIN VIEW ONLY" placeholder); held until iPhone PWA test.
Commit `a1c13d0`.
**Pre-flight check:** on a real iPhone in fresh Safari (private
mode), open the new admin's link → DO NOT sign in → Add to Home
Screen → force-quit → tap icon. The name shown in PlayerView must
be the team creator's name. If any other player's name shows: stop
and escalate (auth-attachment race + identity fallback regressed).

---

## 5. ADMIN WRITES

### 5.1 `admin_save_teams` cross-team write surface
**Symptom:** none user-visible (defense-in-depth fix). A malicious
admin could pass foreign player_ids from team Y in
`p_team_a` / `p_team_b` arrays and flip their team column.
**Root cause:** the CLEAR statement (mig 043) correctly scoped via
`team_players` join, but the SET statements trusted client-supplied
arrays against the global `players.id` namespace.
**Fix:** migration 048 — same `team_players` scope on both SET
statements. Foreign IDs now silently update 0 rows. Commit
`156dc84`.
**Pre-flight check:** no functional check required for a new
squad — fix is already deployed and isolates each team from every
other. Just confirm you're on a deploy ≥ commit `156dc84`.

### 5.2 PlayerView Live Board team sheet empty after Confirm Teams
**Symptom:** admin builds Smart Teams, confirms, then opens
PlayerView — Live Board team sheet section is empty.
**Root cause:** `admin_save_teams` only wrote `matches.team_a/team_b`
(persistent), never `players.team` (the denormalised column
PlayerView's Live Board reads).
**Fix:** migration 043 extends the RPC to clear + set `p.team` on
every confirm, scoped by team_players join. Commit `a14590b`.
**Pre-flight check:** as admin for the new squad, open Teams
screen, run BUILD TEAMS, then CONFIRM. Open `/p/<any_token>` for
that team in a second tab. Live Board must show both team A and
team B with the correct players listed.

### 5.3 Group Balancer fails for anon-admin / VC callers
**Symptom:** admin or VC opens Make Teams and taps a player then a
group panel. The chip reverts to "Needs Group" and a red error
"Failed to save group — try again" appears. Every other admin
action on the same squad works.
**Root cause:** `admin_set_player_group` and `admin_clear_all_groups`
were the only admin_* RPCs granted to `authenticated` only (mig
031). The session-45 VC parity sweep (mig 075) rewrote function
bodies but didn't touch grants. Anon admins (token-only, no JWT)
and VCs (always anon, authenticate via player_token) were blocked
at the PostgREST permission gate before the body ran.
**Fix:** migration 078 — grants anon execute on both RPCs.
**Pre-flight check:** as a brand-new squad admin who is NOT signed
into Supabase Auth, open `/admin/<your_token>` directly in a
private/incognito window. Make Teams → tap any player in Needs
Group → tap group 1. Chip must land in group 1 and stay there. No
error toast. Then repeat as a VC (with their player_token route).
Both must succeed and produce audit_events rows with the correct
actor_type (`team_admin` vs `vice_captain`).

### 5.4 Brand-new squad first go-live leaves Make Teams broken
**Symptom:** rockybram (new squad "Footy Tuesdays", first-ever match
on 2026-05-26) flipped the live toggle. Players saw the game as
live, but Admin → Make Teams showed "No active match — go live
first before picking teams". POTM voting / payment confirmation /
save-teams all silently broken for the same reason.
**Root cause:** `admin_upsert_schedule` sets `game_is_live=true` but
never creates a `matches` row or sets `schedule.active_match_id`.
Only `admin_reopen_week` (mig 032) did that, and only on the
cancel→relive path. Brand-new squads going Create → Live (without
ever cancelling) ended up with `active_match_id=NULL` forever.
Latent since mig 032; demo + cancel-cycled teams masked it.
**Fix:** migration 077 — new `admin_go_live` RPC (sibling of
`admin_reopen_week` minus the cancel-clear). Inserts the initial
`matches` row and sets `active_match_id`. Idempotent on re-tap.
Client routes: `AdminView/index.jsx openNextWeek` non-cancelled
branch + `ScheduleScreen.jsx` save path both call `goLive` on the
live flip.
**Pre-flight check:** sign up a fresh-Gmail brand-new squad with
no prior matches. Flip the live toggle from ScheduleScreen
(both routes: the toggle row AND the "Save" with gameIsLive flipped
on). Open Admin → Make Teams immediately. The team-builder UI
must render (groups / squad list / SMART + BUILD TEAMS buttons),
NOT the "No active match" empty state. Verify in DB:
`SELECT active_match_id FROM schedule WHERE team_id=<id> AND active`
returns a non-null token starting `m_`.

### 5.5 TeamsScreen CONFIRM button reverted on return
**Symptom:** admin confirms teams, navigates away, returns to Teams
screen — button has reverted to "CONFIRM", state lost.
**Root cause:** race between matchId hydration effect (which set
`teamsConfirmed=true`) and the auto-Smart effect (which read empty
`assignments` from stale closure, decided "nothing assigned", ran
algorithm, called `setTeamsConfirmed(false)`).
**Fix:** hydration now sets `hasAutoFiredRef.current=true` when
already-confirmed, so auto-Smart bails. Commit `a14590b`.
**Pre-flight check:** as admin, confirm teams. Navigate to Squad,
back to Teams. Button must still read "✓ CONFIRMED" / equivalent
locked state.

### 5.6 admin_delete_player rejects Vice Captains (silent failure)
**Symptom:** a VC opens AdminView via their /p/<token> route, taps
"Remove" on a player (orphan-guest banner or SquadScreen) — nothing
visible happens. Banner stays on screen. No toast. Postgres logs
show `invalid_admin_token` errors against `/rpc/admin_delete_player`.
**Root cause (two layers):** (1) per commit `767b499` the AdminView
receives the VC's 21-char player token as `adminToken`, but
`admin_delete_player`'s first guard looks up `teams.admin_token`
(28 chars) — never matches; (2) `removeGuest` in AdminView/index.jsx
swallowed errors with a bare `console.error`, so no UI feedback.
**Fix:** migration 116 — `admin_delete_player` now resolves the
token as `teams.admin_token` first, then falls back to
`players.token WHERE is_vice_captain = true` on the same team as
the target; audit row records `actor_type='vice_captain'`.
AdminView/index.jsx surfaces a red error message under the banner
on RPC failure. Migration 115 (cancelled-ledger guard) shipped in
the same window as a secondary latent fix. Commits `af7dcf0`,
`d5c4763`.
**Pre-flight check:** sign in as a VC on a real team (NOT demo —
demo's lack of team_admins row breaks the VC path). Open AdminView
via the /p/<vc_token> route. Add then remove a temporary guest from
the Squad screen. Removal must commit to the DB (refresh confirms
guest is gone) AND no error message appears in the banner. Second
check: cancel a match for that team first, then try removing any
squad member — the cancelled ledger row must NOT block deletion.
**Class follow-up:** any other `admin_*` RPC with the same
admin_token-only lookup pattern will fail for VCs identically.
Sweep before next release (see BUGS.md session-49 follow-up).

### 5.3 Cron-driven auto-open leaves schedule with no active match
**Symptom:** admin taps Make Teams from /admin/. TeamsScreen
renders "No active match — go live first before picking teams"
even though players have been marking in/out all day. Schedule's
`game_is_live=true` but `active_match_id` is null and no
non-cancelled matches row exists for the team.
**Root cause:** `autoOpenGameJob` in `api/cron.js` flipped
`game_is_live=true` via a raw `supabase.from("schedule").update(...)`
at opens_day/opens_time, but did NOT create a matches row or set
`active_match_id`. Mig 077 had added `admin_go_live(p_admin_token)`
for the admin UI path; the cron has team_id, not an admin token,
so it bypassed the RPC entirely and left a half-open state from
opens_time until lineupLockJob backfilled the match 60 min before
kickoff.
**Fix:** mig 126 added `admin_go_live_for_team(p_team_id)` — a
team_id-keyed sibling of admin_go_live with the same idempotence
and matches-row ownership, plus `auto_open_pending=false`
(cron-specific). Service-role-only grant. Audit row uses
`actor_type='system'` / `actor_identifier='cron:auto_open_game'`.
cron.js change: replace the raw update + notify with a single
`supabase.rpc('admin_go_live_for_team', { p_team_id })` call.
Commit `c29b20d`.
**Pre-flight check:** the morning after the new team's first
`opens_day/opens_time` window passes, query the schedule. SELECT
`active_match_id, game_is_live` FROM schedule WHERE team_id=...
`active_match_id` MUST be non-null and point to a row in `matches`
with `cancelled=false`. SELECT FROM audit_events WHERE team_id=...
AND action='week_opened' must include a row with
`actor_type='system'` AND
`actor_identifier='cron:auto_open_game'`. If either fails: cron
either didn't fire (check Vercel cron logs) or skipped the new
RPC (check mig 126 applied) — stop and escalate.
**Class follow-up:** every cron job in `api/cron.js` that mutates
schedule/matches/player state shared with an admin UI flow MUST
route through the same RPC the admin UI uses (or a service-role
sibling). Sweep `api/cron.js` before next release for any other
raw `supabase.from(...).update(...)` calls — they are now banned
by DECISIONS.md session-51 rule.

---

## 6. PUSH NOTIFICATIONS

### 6.1 All push notifications silently dead post-deploy
**Symptom:** zero push deliveries despite players having subscribed.
73.7% error rate on Vercel dashboard.
**Root cause:** three layers, all needed fixing:
(1) All four VAPID env vars on Vercel production were stored as
empty strings (set 13 days prior with no value; dashboard masked
this as "Encrypted"). (2) All six `pg_cron` notification jobs
called `https://in-or-out.com` (apex) which 307-redirects to `www`.
`pg_net` strips the `Authorization` header on cross-host redirect →
401 → never delivered. (3) `pg_cron` job 5 (`notif-bibs-24hr`) had
stray password text mid-body causing hourly syntax errors.
**Fix:** fresh VAPID keypair set via `vercel env add --value`,
redeployed. All six cron jobs rewritten via `cron.alter_job` to
use canonical `www` URL. Job 5 body cleaned. Verified live at the
19:45 UTC tick — 4× HTTP 200 vs 4× HTTP 401 baseline.
**Pre-flight check:** before the new squad's first match week,
trigger the test push from admin. On a real iPhone with the PWA
installed and notifications enabled, you must receive the push
within a few seconds. Also confirm in Supabase dashboard that
`notification_log` has a row for the delivery. If zero rows, the
cron is broken — escalate before the squad's first match.

### 6.2 Weekly auto-rollover never fired — `/api/cron` was orphaned
**Symptom:** Tuesday night match plays. Wednesday morning the next
week's match did not auto-open, `auto_open_pending` stays true forever,
no PWA push ever fires. Affected every team — silent because the
endpoint that does the rollover was never wired to any scheduler.
**Root cause:** `apps/inorout/api/cron.js` contains `autoOpenGameJob`
and `advanceGameDateJob`. The file's header comment says it runs
every 15 min via pg_cron or Vercel Cron, but neither was ever
configured. `vercel.json` has no `crons` block; pg_cron held 6 jobs,
all targeting `/api/notify`. Code shipped, scheduler never installed.
**Fix:** migration 117 — `cron.schedule('inorout-cron-main', '*/15 * * * *', ...)`
pointing pg_net at `https://www.in-or-out.com/api/cron`. Migration 118
unsticks the two teams whose schedule rows were frozen on the
2026-05-26 kickoff. Same commit also corrects Footy Tuesdays'
`opens_day/opens_time` from `Monday 20:00` to the intended
`Wednesday 10:00`.
**Pre-flight check:** before any new squad's first match week, in
Supabase SQL editor run
`SELECT jobname, schedule, active FROM cron.job WHERE jobname='inorout-cron-main'`
— must return one row, `active=true`, schedule `*/15 * * * *`. After
the first Tuesday kickoff, on Wednesday at the configured `opens_time`,
confirm the team's `schedule.game_is_live` flips to true and a push
notification arrives on a real iPhone with the PWA installed. If
either fails, escalate — the cron is broken again.

### 6.3 Service worker never registered — every push silently dead
**Symptom:** zero `push_subscriptions` rows globally despite players
being on the PWA with iOS notifications enabled. Tapping the in-app
"Enable" button does nothing — no error, no API call, no state change.
**Root cause:** `apps/inorout/index.html` contained a body-tag script
that called `serviceWorker.getRegistrations().then(r => r.unregister())`
on every page load (commit `4515460`, May 10 — intended as a one-time
cleanup for an old buggy SW that caused iOS blank screens). The
matching `register('/sw.js')` was never added. For 17 days every
visitor's SW was actively destroyed and never replaced. `handleSubscribe`
awaited `navigator.serviceWorker.ready` which hangs forever when no
SW is registered → silent stall.
**Fix:** deleted the destructive block. Added
`navigator.serviceWorker.register('/sw.js')` on `window.load` in
`apps/inorout/src/main.jsx`. Safe because the current sw.js has no
fetch handler — cannot recreate the May-10 bug.
**Pre-flight check:** on a real iPhone with the PWA installed (or in
desktop Chrome): `navigator.serviceWorker.controller` must be truthy
after one refresh. Then tap "Enable" inside the app (visible only
when game is live AND status is set). In Supabase SQL editor confirm
`SELECT count(*) FROM push_subscriptions WHERE player_id='<that
player>'` returns 1. If 0, the registration is broken — escalate.

### 6.4 `register_push_subscription` masked three schema drifts
**Symptom:** Enable tap returned 400 with
`{code: 'P0001', message: 'internal_error'}`. No subscription row
written.
**Root cause:** the RPC body had drifted from the live
`push_subscriptions` schema: (1) inserted text `'sub_' || ...` into
a uuid `id` column; (2) inserted into a `player_token` column that
doesn't exist; (3) used `ON CONFLICT (player_id)` without a UNIQUE
constraint on that column. All three errors were rewritten to a
generic `internal_error` by the function's `WHEN OTHERS THEN` catch.
**Fix (mig 122):** added `UNIQUE (player_id)` to push_subscriptions
and rewrote the RPC to let `DEFAULT gen_random_uuid()` fill `id` and
drop the phantom `player_token` insert. Audit insert preserved.
**Pre-flight check:** with a fresh signed-in player and the SW
registered (§6.3), tap "Enable". The network tab should show
`POST /rest/v1/rpc/register_push_subscription` returning 200, and
`SELECT count(*) FROM push_subscriptions` should increment by 1. If
it returns 400, an underlying constraint or column is again out of
sync — the RPC's catch-all hides which, so check
`pg_get_functiondef(oid)` of the RPC against the actual table
columns.

### 6.5 `notification_log` schema drift caused duplicate-push storm
**Symptom:** push notifications arrived correctly but **every 15
minutes** for as long as the game was live. Surfaced live as 4×
duplicate notifications to one player over an hour.
**Root cause:** `notify.js` inserted into `notification_log` with
`id: 'notif_<ts>_<rand>'` (text, but the column is uuid) and into
`queued_for` / `queued_payload` columns that didn't exist. Every
INSERT silently failed. `alreadySent()` always returned `false`
because no rows ever landed → every cron tick re-fired the autoOpen
path.
**Fix (mig 123 + notify.js patch):** added
`queued_for timestamptz` and `queued_payload jsonb` to
`notification_log`. Dropped the text `id` from both INSERTs in
`notify.js` (let `gen_random_uuid()` fire). Removed the now-dead
`makeId()` helper. Surface non-410 webpush errors via
`console.error` so future failures don't silently swallow.
**Pre-flight check:** after the first autoOpen fires for a new
squad, `SELECT count(*) FROM notification_log WHERE
team_id='<team>' AND type='autoOpen' AND game_date='<date>'` must
return exactly 1. The next cron tick (15 min later) must NOT
re-fire — same query still returns 1, and the player must not
receive a second push within the hour.

### 6.6 `notify_team_change` unknown-reason warnings
**Symptom:** every account deletion logs
`notify_team_change: unknown reason "player_account_deleted"` —
broadcast still works, but log noise pollutes triage.
**Root cause:** migration 047 added the new reason but didn't
extend the function's hard whitelist.
**Fix:** migration 049 adds the reason. Commit `5a1a0e3`.
**Pre-flight check:** no per-squad check; verify deploy is ≥ commit
`5a1a0e3` if log review is part of go-live monitoring.

### 6.8 Player-self note never persisted (silently dropped)
**Symptom:** any player marking themselves "out" with a note (e.g.
"away this week — wedding") sees the note appear in UI, then
vanish within seconds-to-minutes once a realtime broadcast or
reload reconciled with the database. Latent since feature shipped;
visibility forced by session 50's realtime broadcast fixes.
**Root cause:** `saveNote()` in PlayerView was a pure React state
setter with no RPC call. There was no `set_player_note` RPC at
all — only the admin variant. Player-self path to the `note`
column did not exist.
**Fix:** migration 124 adds `set_player_note(p_token, p_note)`.
Wrapper added to supabase.js; `saveNote()` now calls it. Audit via
`player_note_updated_self`. Broadcast reason already whitelisted
(mig 049).
**Pre-flight check:** before onboarding a new squad, on a real
device, mark a test player out with a note, force-quit the PWA,
reopen — note must persist. Also confirm in Supabase
`audit_events WHERE action='player_note_updated_self'` has a row.
If empty after a known-good test write, the RPC isn't grant-ed
or the wrapper isn't reaching it.

### 6.7 cron.js read UTC for `opens_time` / midnight, not UK time
**Symptom:** auto-open fired one hour late during BST. Operator set
"12:30" in admin UI; game went live at 13:30 BST on 2026-05-27.
Same drift on `advanceGameDateJob`'s midnight gate (rolled over at
01:00 BST instead of 00:00 BST).
**Root cause:** Vercel Functions run in UTC. `autoOpenGameJob` and
`advanceGameDateJob` used `new Date().getDay() / getHours() /
getMinutes()` and compared those UTC values against admin-entered
wall-clock strings (`opens_day`, `opens_time`) saved naively. GMT
half of the year masked the bug.
**Fix:** added `nowInUkParts()` helper in cron.js using
`Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ... })`.
Both jobs now evaluate "what day / what time" in UK-local. pg_cron
schedule unchanged — JS gates filter the right tick. DST-safe.
**Pre-flight check:** set a team's `opens_time` to "now + 20
minutes" UK-local via admin UI. Within the next 15-min cron window
**after** that UK-local minute, confirm `schedule.game_is_live`
flips to true. Do this during BST specifically — GMT will mask
regressions. If the flip happens an hour late, the fix has
regressed or `Intl` is being mis-evaluated.

---

## 7. REALTIME

### 7.1 Live view dead for anonymous clients
**Symptom:** player on `/p/<token>` doesn't see other players'
status changes without manual reload.
**Root cause:** two issues. `notify_team_change` published to
`team_live:<channel_key>` via `realtime.send` with `private=true`.
RLS on `realtime.messages` is enabled with zero policies → default
deny for anon. AND App.jsx never subscribed to that broadcast
channel at all — only to `postgres_changes` on players/schedule/
matches, themselves RLS-gated on `auth.uid()`. Anon failed both
gates.
**Fix:** migration 062 flips the 4th arg of `realtime.send` to
`false` (public broadcast — channel UUID is the secret). App.jsx
subscribes to `team_live:<key>` via useEffect keyed on
`[teamId, liveChannelKey, route]`. Old `postgres_changes` pipe
retained as fallback for authed sessions. Commit `4061a88`.
**Pre-flight check:** two devices — one as the new squad's admin
on `/admin/<token>`, one as a player on `/p/<token>` in a private
browser window (no auth). Admin marks a player as INJURED. Player
device must update within ~2s without reload.

### 7.2 Live updates stale after the PWA returns from the background (session 69)
**Symptom:** installed PWA shows stale data after being backgrounded
on iOS — the user had to fully close and relaunch the app to see the
latest in/out counts. Live updates worked fine while the app stayed
open and foregrounded.
**Root cause:** iOS suspends the PWA and tears down the realtime
WebSocket when backgrounded. The only `visibilitychange` handler
refreshed the auth token and nothing else — it never reconnected the
socket or re-fetched state. Broadcast / postgres_changes events that
fired while suspended are ephemeral and lost forever, so the app sat
on whatever it had before suspension until a full relaunch re-ran the
initial load.
**Fix:** commit `5edd64f`. (1) `packages/core/storage/supabase.js`
gives the realtime client a short capped `reconnectAfterMs` backoff.
(2) App.jsx adds a shared `refreshTeamData()` catch-up (reused by the
team_live broadcast handler) and a resume handler on
`visibilitychange`/`pageshow`/`focus` that, on foreground: refreshes
auth (still throttled 5 min), calls `supabase.realtime.connect()` if
disconnected, and runs an **unthrottled** full re-fetch every time.
**Pre-flight check:** on a real iPhone home-screen install, open the
app, then background it (don't kill it) for a solid 60+ seconds. From
a second device/admin, change a player's in/out status. Tap back into
the app from the app-switcher (do NOT relaunch). The new count must
appear immediately on its own — no pull-to-refresh, no relaunch. Then,
still foregrounded, make another change from the other device: it must
stream in live. Verified on Footy Tuesdays, 90-second suspension,
session 69.

---

## 8. READS UNDER RLS

### 8.1 H2H modal showed "haven't played in the same game yet"
**Symptom:** Head-to-Head modal opens but renders empty even for
players who have shared many matches.
**Root cause:** `getHeadToHead` did three direct `.from()` reads on
`matches` + `player_match`. Under post-session-24 RLS these return
zero rows for anon callers.
**Fix:** migration 041 — `get_head_to_head_raw_by_admin_token`
SECURITY DEFINER. JS branches on adminToken availability. Commit
`a95e074`.
**Pre-flight check:** on `/admin/<new_squad_token>`, open
PlayerView for any player who has at least 3 match appearances.
Tap into the H2H section against another player who shares matches.
The modal must show a real head-to-head record, not the empty
placeholder.

### 8.2 StatsView form chips + reliability column blank
**Symptom:** Stats screen's per-player form chips and reliability
column show blank for everyone.
**Root cause:** `getPlayerLeagueTable` did direct `.from()` reads,
RLS-blocked on anon. Local tableData hard-coded `reliability:null`
+ `form:[]` because the props (`matchHistory + squad`) couldn't
derive either (need ordered `player_match` rows + all-time attended
counts).
**Fix:** migration 042 —
`get_player_league_table_raw_by_admin_token`. StatsView augments
local tableData with form + reliability from the RPC. Commit
`ed92e2f`.
**Pre-flight check:** on `/admin/<new_squad_token>`, open Stats
screen. For any player with ≥3 matches played, the form chips must
be populated and reliability % must be a real number.

### 8.4 H2H + Stats comparison empty on the PLAYER route (8.1/8.2 only fixed admin)
**Symptom:** Head-to-Head shows "you haven't played in the same
game yet" for EVERY player — but only when the app is opened via a
player link `/p/<token>` (the normal installed-PWA experience),
including for admins who use their own player link day-to-day. The
`/admin/<token>` route worked fine, which is why it went unnoticed
for ~5 months (8.1/8.2 were only ever tested on /admin).
**Root cause:** migrations 041/042 added SECURITY DEFINER RPCs for
the ADMIN token only. `getHeadToHead`/`getPlayerLeagueTable` fell
back to direct `.from()` reads on every non-admin path. On a player
route `isAdmin` is false → `adminToken` is null → the dead direct
path ran; `player_match` has RLS on with no anon/authenticated
select policy → 0 rows → empty H2H. The Stats league table itself
still rendered because it's derived client-side from match history,
which masked the gap.
**Fix:** migration 348 — `get_head_to_head_raw_by_player_token` +
`get_player_league_table_raw_by_player_token` (resolve team from
`players.token`→`team_players`). `playerToken` threaded through.
NOTE: the first commit only patched the standalone `view==="stats"`
StatsView; the Stats screen users actually reach is the Stats TAB
inside PlayerView (`PlayerView.jsx`), which needed the same prop —
fixed in commit `28821af`. Lesson: grep `<StatsView` and patch
every render site.
**Pre-flight check:** on a real iPhone, open the app via a PLAYER
link `/p/<token>` (not /admin), go to Stats, tap a player you've
shared ≥1 match with. The H2H must show a real record (against-only
matchups appear under "When you play against each other", with the
"play together" section at zero). Re-test as both an ordinary
player and as an admin using their player link.

### 8.3 BibsScreen standalone bib assignment broken (known workaround)
**Symptom:** admin tries to assign bibs from the standalone
BibsScreen — write silently fails (RLS-blocked).
**Root cause:** BibsScreen lacks `matchId` + `adminToken` in scope;
direct `insertBib` write is blocked.
**Status:** LOW priority — workaround exists. Bibs can be set via
ScoreScreen result save (which has both). Not yet fixed.
**Pre-flight check:** tell the new squad's admin to set bibs only
via the ScoreScreen result save flow, not the standalone Bibs
section. Re-test if BibsScreen has been overhauled.

---

## 9. DISPLAY-LAYER ARITHMETIC

### 9.1 MyView double-counted ledger debt + this-week's price
**Symptom:** player's My View header shows "£5 + £5 = £10" while
Payments correctly shows £5.
**Root cause:** `PlayerView.jsx` rendered the sum whenever an
unpaid ledger entry existed AND status='in'. The display assumed
`effectiveDebt` = past carry-over and `price` = fresh this-week
fee. Breaks when the ledger entry IS this week's fee (with
`match_id=NULL` because lineup-lock hasn't assigned a match_id
yet).
**Fix:** trust ledger as single source of truth. Commit `a8dd46d`.
**Pre-flight check:** for the new squad's first week with any
unpaid balance, confirm a player's My View header shows the
correct single amount (either "£N owed" or "£N this week", not
both summed).

### 9.2 Smart Teams stuck on "Even game" with empty side
**Symptom:** admin builds teams with all players on one side — UI
still shows "Even game" prediction.
**Root cause:** `computePrediction`'s `mean([]) ?? 0.5` defaulted
both averages to 0.5, producing a draw verdict regardless.
**Fix:** returns `winner=null` when either side has 0 players;
render guard hides the chip; saves NULL to `predicted_winner`.
Commit `d7cfa2f`.
**Pre-flight check:** as admin, deliberately empty team B before
confirming. The "Even game" / prediction chip must hide, not
display "Even game".

### 9.3 Stale prediction after manual swap
**Symptom:** admin generates Smart Teams, manually swaps players,
confirms — saved prediction still reflects the original
algorithmic split.
**Fix:** prediction recomputed on every manual move; saved value
reflects the actual confirmed lineup. Commit `b31af19`.
**Pre-flight check:** as admin, generate teams, then drag/swap at
least one player between sides, then confirm. Re-open the
confirmed match — the prediction must reflect the swapped lineup.

### 9.4 Status confirmation banners persisted on page refresh
**Symptom:** "🔒 Locked in", "👍 No worries we'll find cover" etc.
render on every page load, not just after a tap.
**Fix:** `hideConfirmation` initial value flipped from `false` to
`true`. Banners only render in the 5s window after an actual
`setStatus` call. Commit `19abed9`.
**Pre-flight check:** set a status (IN/OUT), see the banner, wait
5s, refresh the page. No banner on reload.

### 9.5 Wrong-day prompt — "Are you in this Tuesday?" on a Wednesday match
**Symptom:** player tile says the wrong day of week for the match.
**Root cause:** `gameDay` derived from `schedule.gameDateTime`
first (which had drifted in the demo schedule), falling back to
`schedule.dayOfWeek`.
**Fix:** admin-configured `dayOfWeek` wins; timestamp weekday is
fallback only. Commit `c436992`.
**Pre-flight check:** confirm the new squad's `dayOfWeek` is set
correctly in admin's Match Settings; verify PlayerView prompt
matches.

### 9.6 Game-is-live toggle blocked after Cancel This Week
**Symptom:** admin cancels the week, then tries to re-enable —
toggle leaves state conflicted (`is_cancelled=true` AND
`game_is_live=true`), screen still renders cancelled.
**Fix:** new `admin_reopen_week` RPC (migration 032) owns the full
reopen transaction: clears cancelled state, inserts fresh `matches`
row, points `active_match_id` at it, writes `week_reopened` audit
event. Commits `5061508`, `e2f67ea`.
**Pre-flight check:** as admin, Cancel This Week, then re-enable
game. PlayerView for any player must render the active match view,
not the cancelled state.

### 9.7 Cancel This Week left admin-locked players unable to self-toggle next week
**Symptom:** After a cancel, any player who had been admin-locked
to 'in' (`players.admin_locked_in=true`) stayed locked. Their next
self-tap on IN/OUT failed silently — `set_player_status` (mig 038)
raises `admin_locked_in` from inside SECDEF and the client surfaces
nothing useful. Caught on the 2026-05-26 Footy Tuesdays cancel:
17 of 18 players reset cleanly; Ranza (admin-locked at cancel time)
was stranded.
**Fix:** migration 082 adds `admin_locked_in = false` to the bulk
Step 5 reset inside `admin_cancel_match`. Also codifies the live
RPC body (which had drifted to use `resolve_admin_caller`) per
rule 11. New DECISIONS.md rule: any bulk-reset of `players.status`
MUST also clear `admin_locked_in`. Commit `a722354`.
**Pre-flight check:** as admin, lock a test player to IN via the
admin status toggle (sets `admin_locked_in=true`). Cancel the week.
Then have that player self-toggle (via their `/p/<token>` route).
The toggle must succeed and the new status must persist on reload.
DB check: `SELECT COUNT(*) FROM players WHERE admin_locked_in=true`
should be 0 after cancel for the team.
**Still open:** weekly rollover (`open_next_week` /
`advance_game_date`) doesn't clear `admin_locked_in` either. With
9.7 in place a cancelled-then-reopened week is safe, but a non-
cancelled rollover with stale locks is a latent concern. Flagged
for a follow-up audit.

---

## 10. OBSERVABILITY

### 10.1 Silent fire-and-forget RPC failures
**Symptom:** player taps "OUT", UI flips, DB never updates, no
server-side trace.
**Root cause:** player self-write RPCs wrote no `audit_events`
rows. `console.error` on the client was the only failure surface.
**Fix:** migrations 060 (status, paid) + 063 (the other 7 — injured,
add_guest, remove_guest, register_push, unregister_push,
submit_potm_vote, link_player_to_user). Pattern encoded as CLAUDE.md
rule #9 — every new player-self write RPC must INSERT into
audit_events. Commits `77b4bb5`, `284a44e`.
**Pre-flight check:** no per-squad check. Use audit_events as the
go-to triage table whenever the new squad reports "tap did
nothing" — there should always be a row, even on failure.

### 10.3 Parity / smoke tests against production rows (session 45 incident)
**Symptom:** a real player's row shows state the player never set
(locked-in status, placeholder nickname, silently-revoked VC flag).
**Root cause:** an admin_* RPC verification sweep was executed
against live production rows (team_KPaoX8oJYMQ / Footy Tuesdays),
using two real players as guinea pigs. Two issues leaked:
- Bally was left at `status='in', admin_locked_in=true,
  nickname='TempNick'` because the toggle sequence missed the
  matching revert steps.
- Bidz had been legitimately promoted to VC an hour earlier; the
  parity test ended its toggle at `is_vice_captain=false`
  regardless of the starting state, silently undoing the
  promotion.
**Fix (this incident):** direct cleanup via MCP, then a no-op
pass through `admin_update_player_name` / `admin_set_player_status`
so audit_events recorded the fix under `actor_type='team_admin'`.
**Forward fix (open):** see BUGS.md "LOW #0 — No ephemeral fixture
for admin_* RPC parity smoke tests" + DECISIONS.md "ADMIN_* RPC
PARITY / SMOKE TESTS NEVER RUN AGAINST PRODUCTION ROWS". Until
that fixture exists, parity work runs against `team_demo` or a
freshly created throwaway team only.
**Pre-flight check:** before onboarding a new squad, confirm no
admin_* RPC verification has been run against their team's rows.
Query `audit_events` for timestamp clusters (≥3 rows sharing
exact `created_at`) on `team_id=<new_squad>`. Any such cluster
is a sweep, not human activity — investigate before go-live.

### 10.2 App-boot telemetry — PWA opens previously invisible
**Symptom:** can't tell from data whether auto-refresh mitigations
are helping anyone.
**Fix:** migration 064 — `log_app_boot` RPC. App.jsx fires on
every boot capturing route_type, display_mode (standalone vs
browser), session_present_client. Comparison with server-side
`actor_user_id` surfaces "client thinks authed but JWT not
attached" mismatches. Commit `f9788ca`.
**Pre-flight check:** after the new squad's first day, query
`audit_events` filtered to `event_type='app_boot'` for that
team_id. If `display_mode='standalone'` rows are zero but you know
players installed the PWA, the inline-manifest path is broken.

---

## 11. PITCH BOOKING (casual ↔ venue)

*Not yet exercised by a live squad. These checks come from the session-53
pre-Stage-7 audit + the bugs it fixed (`202d16a`). Run them the first time a real
team books a real opted-in venue.*

### 11.1 Casual bookings list didn't update live on venue action
**Symptom:** a team admin requests a pitch, the venue confirms/declines/cancels,
but the admin's Match Settings bookings list stays on the old status (e.g.
"Requested") until they leave and re-open the Schedule screen.
**Root cause:** `App.jsx`'s `team_live` subscriber refreshes team state but not
the bookings list; `ScheduleScreen` only loaded bookings on mount. The five
`booking_*` broadcast reasons had no casual subscriber that re-fetched bookings.
**Fix (`202d16a`):** `ScheduleScreen` subscribes to `team_live:<key>` and calls
`loadBookings()` on any broadcast; `liveChannelKey` threaded App → AdminView →
ScheduleScreen.
**Pre-flight check:** two devices. Device A = team admin on `/admin/<token>` signed
in, Match Settings open with a pending booking visible. Device B = venue dashboard
(`apps/venue`) confirms that request from the inbox. Within ~2s Device A's booking
must flip Requested → Confirmed with no manual refresh. Repeat for venue cancel →
the row must update to Cancelled live.

### 11.2 Booking date off-by-one in the BST midnight hour
**Symptom:** a weekly block created late at night (00:00–00:59 BST) is sent to the
venue starting one day early; the start weekday can mismatch the chosen slot.
**Root cause:** `BookPitchModal` / venue `bookingUtil` built `YYYY-MM-DD` via
`new Date(...).toISOString().slice(0,10)` — UTC, so the UK midnight hour rolls
back a day. Same class as §6.7 (cron UK time) and §9.5.
**Fix (`202d16a`):** local-components date formatter (`isoLocal` / `bookingUtil.isoDate`)
everywhere a date string is derived. **Rule:** never use `toISOString()` to derive a
calendar date — always build from `getFullYear/getMonth/getDate` (venue-local).
**Pre-flight check:** during BST, just after local midnight, create a one-off and a
weekly block. The booking date(s) written (check `pitch_bookings.booking_date`) must
match the date picked in the UI, not the day before.

### 11.3 Venue had no way to cancel a confirmed booking
**Symptom:** venue staff can approve/decline pending requests but can't cancel a
*confirmed* booking from the calendar.
**Fix (`202d16a`):** tap any booking block → `BookingDetailModal` with Cancel /
Cancel-whole-series (confirmed) or Confirm/Decline (pending), via the venue-token
wrappers. Frees the slot through the occupancy guard + broadcasts live.
**Pre-flight check:** on the venue dashboard, create a walk-in (tap an empty slot),
then tap that block → Cancel this booking. The block must disappear from the grid
live, and the slot must become tappable/bookable again.

### 11.4 Walk-in / phone booking (venue-created, pre-confirmed)
**Pre-flight check:** on the venue dashboard, tap an empty calendar cell → pick a
registered team OR enter a walk-in name → Confirm. The block appears immediately as
confirmed (no request step). Confirm it lands on the occupancy guard: try to create
an overlapping booking on the same pitch+time — it must be refused (`slot_unavailable`),
never double-book.

### 11.5 Bookings toggle / discovery gating
**Pre-flight check:** in venue Settings, turn bookings OFF. The casual "Book a Pitch"
venue search must no longer return that venue. Turn ON → it reappears. The off-state
must show the venue dashboard's read-only banner with the enable toggle, not a blank
screen.

### 11.6 Renewal right-of-first-refusal (Stage 7, cron at 09:00 UK)
**What:** a weekly block within 21 days of its last week auto-holds the next block for the
team (`create_renewal_holds`); the team taps "Keep slot" (`confirm_renewal` → holds become
`requested`, venue re-approves via the inbox); unconfirmed holds auto-release after a 7-day
grace (`expire_renewal_holds`). Both run inside `renewalHoldsJob` in `api/cron.js`, gated to
the 09:00 UK window via `nowInUkParts()` (DST-safe; same class as §6.7).
**Pre-flight check:** seed a confirmed block whose `ends_on` is ≤21 days away. After the next
09:00-UK cron tick: (a) the team's ScheduleScreen shows a "Renewal held · keep by <date>" row
with a **Keep slot** button, and a push arrives on the admin's device; (b) `SELECT status FROM
booking_series` shows the origin `ending` + a child renewal `active` with `hold` bookings +
active priority-2 occupancy. Tap **Keep slot** → the row flips to **Requested** and the venue
inbox shows the pending series to confirm. Separately, let a hold pass its `hold_expires_at`
→ next 09:00 tick must flip it to `expired`, free the occupancy, and push "renewal lapsed".
If the cron didn't fire, check `cron.job` (§6.2) and that the 09:00 gate matched UK time.

### 11.7 Superseded displacement push (Stage 7, every cron tick)
**What:** when a league fixture bumps an un-confirmed booking, `tg_sync_fixture_occupancy`
stamps `pitch_bookings.superseded_at`; `supersededPushJob` (every 15-min tick) pushes the
displaced team's admins. Dedup via `notification_log (team,'booking_superseded',gameDate)`.
**Pre-flight check:** schedule a fixture onto a pitch+time that overlaps a `requested` casual
booking. Within the next tick, the displaced team's admin gets a "Booking bumped" push, and
`notification_log` has exactly one `booking_superseded` row for that team+date (no duplicate
on the following tick). The booking shows `superseded` in the team's list (live, in-app).

### 11.8 Booking-confirmed push (session 54, every cron tick)
**What:** when a venue confirms a casual request (`venue_confirm_booking`), `confirmPushJob`
(every 15-min tick in `api/cron.js`) pushes the team's admins "Pitch booking confirmed". It
polls `audit_events` (`action='booking_confirmed'`, last 20 min) — the committed marker, so
no schema change — joins back to `pitch_bookings` (`team_id IS NOT NULL`), and **collapses a
block series to one push per (team, series)** so a multi-week confirm isn't N notifications.
Dedup via `notification_log (team,'booking_confirmed',gameDate=min booking_date)`; in-app the
team already flips Requested→Confirmed live via the `team_live` subscriber.
**Pre-verified (session 54, no real device):** the audit-poll join + grouping proven against
the live DB with an ephemeral insert+rollback (3-week block → 1 group, one-off → 1 group;
0 rows persisted); `get_team_admin_player_ids` returns admins only (demo: 38-player roster →
`[]`); 0 duplicate `notification_log` send-groups exist; venue Bookings surface smoke-loaded
on demo_venue (inbox, calendar, confirmed block paints, tap-block detail/cancel modal).
**Operator-owed (auth + device, demo not valid):** sign in a real test-squad admin, confirm
a real request from the venue inbox, and verify the "Pitch booking confirmed" push actually
lands on the iPhone (the cron proves it *fires and targets correctly*, not that iOS shows the
banner). Confirm `notification_log` has exactly one `booking_confirmed` row per confirm and no
duplicate on the following tick.

---

## 12. CASUAL POST-GAME PIPELINE (week rollover · payments · bibs · stats) — session 68

**Issue class:** a real game completed and the next week's board, the payments
totals, the admin Bib tracker, the Stats table, and Share Results were all wrong.
Two deep root causes (migs 204–206) plus display id/name regressions. None surfaced
in build/type/hygiene — only a real squad playing a real week exposed them.

**12a. New week opens but the board is "locked" (can't say in/out).**
Cause: opening a week never reset player `status`; last week's whole squad stayed
`status='in'`, so the squad read as full and `set_player_status` threw `squad_full`.
Fixed mig 204 (go-live resets status/team/admin_locked_in; payments carry over).
- **Pre-flight:** after the auto-open (or manual "Open Next Week"), confirm every
  player shows **no-response** (not carried "in"), the IN count is 0, and a player on
  `/p/<token>` can tap In and Out freely. Verify against a REAL team (not demo — demo
  has its own reset cron). SQL spot-check: `SELECT count(*) FILTER (WHERE status='in')
  FROM players p JOIN team_players tp ON tp.player_id=p.id WHERE tp.team_id=<team>` = 0
  right after open.

**12b. Outstanding shows £0 / nobody charged after a played game; empty payment history.**
Cause: `admin_save_match_result` keyed "fresh save" on player_match row count, but the
kickoff lineup-lock pre-creates those rows → every save ran as a re-save and skipped the
charge/stats/history cascade. Fixed migs 205/206 (freshness via `matches.winner`; adds
payment_ledger charge rows). **Never let any new code set `matches.winner` before the
admin's first result save** — it would re-break this.
- **Pre-flight (do once per squad after their first real result):** save a result with a
  known set of non-payers, then check Admin → Outstanding reflects `£(price × non-payers)`,
  the Payments screen lists them as owing, and each owing player's payment history shows a
  `game_fee`/unpaid row for that match. Audit check: the `match_result_saved` audit_event
  for that match has `is_fresh_save: true`. A `false` on a first save means the freshness
  signal is defeated — STOP.

**12c. Admin Bib tracker empty.**
Cause: result-save wrote the bib holder onto the match but never into `bib_history` (the
table the tracker reads). Fixed mig 205 (bib_history cascade).
- **Pre-flight:** after a result with a bib holder set, Admin → Bibs shows that player as
  current holder; `SELECT count(*) FROM bib_history WHERE team_id=<team> AND returned=false`
  ≥ 1.

**12d. Stats showed only the POTM; Share Results / Bib-duty / POTM-avatar wrong.**
Cause: matches store player **IDs** (team_a/team_b/scorers/motm/bib_holder) but several JS
consumers resolved by name only. Fixed in StatsView (id-first resolver + bib counting),
HistoryView share text, Avatar (POTM trophy badge), AdminView (orphaned-guest Remove → 'none').
- **Pre-flight (on a real phone after deploy):** Stats tab lists the whole squad (not just
  POTM); Results → Share Results shows names in Team A/B + scorers; last POTM's avatar carries
  the 🏆 (bottom-right); Bib Duty lists holders; the host-dropped-out "Remove" un-enters the
  guest (keeps them in the squad).

**12e. Player who had a +1 last week can't bring a guest the next week.**
Cause: `add_guest_player` creates a per-week `players` row (`is_guest=true`) but the go-live
reset only zeroed `status` — it never deleted the row. The stale guest persisted, and the next
week `PlayerView` found it and showed "your +1 — [name]" instead of the Plus One button, blocking
the host. Fixed mig 207 (both go-live RPCs now delete guest rows on new-match creation).
- **Pre-flight:** after a week opens, SQL spot-check: `SELECT count(*) FROM players WHERE
  is_guest=true AND guest_of IN (SELECT player_id FROM team_players WHERE team_id=<team>)` = 0.
  Then as a player who had a +1 last week, open `/p/<token>` — should see the Plus One button,
  not a stale guest card.

**Status:** all fixed + live-backfilled for Footy Tuesdays (£45 across 9 players) session 68.
Migs 204/205/206/207 + JS commits on `main`. End-of-session audit confirmed the freshness signal
is unbreakable and no other real team carries latent debt. The checks above are the re-run
procedure for each new squad's first full week + first result.

---

## 11. PLAYER SELF-EDIT

### 11.1 Players couldn't save their own nickname (mig 233, session 77)
**Symptom:** a player taps the pencil next to their name on My View,
types a nickname, hits Save → "Failed to save". Nickname never
persists (`players.nickname` stays NULL). Affected every plain
player, not one squad. Surfaced by `rockybram` (`p_cQ-NpVz55ng`).
**Root cause:** the RLS rewrite (commit `7bd7ef2`) repointed the
`setPlayerNickname` wrapper at the **admin-only** RPC
`admin_update_player_name(adminToken, playerId, nickname)`. The two
admin call sites were updated; the player-self call site on My View
was missed and kept calling `setPlayerNickname(myId, teamId, nick)`
— handing the player's own id over as the admin token, which
`resolve_admin_caller` rejected (`invalid_admin_token`). No
player-token nickname path had ever existed. Classic Hard-Rule-#7
signature-drift miss — invisible to build, type-check, hygiene.
**Fix:** mig 233 — token-authenticated `set_my_nickname(p_token,
p_nickname)` (audited self-write, Hard Rule #9; same-team
`nickname_taken` clash check restored). New `setMyNickname` wrapper;
My View now calls `setMyNickname(me.token, nick)`. Commit `8b054bf`.
**Confirmed on device** (session 77 — Rocky + operator both saved OK).
**Pre-flight check:** on a real iPhone, open `/p/<token>` for a
plain (non-admin) player, tap the pencil by their name, save a
nickname, force-quit and reopen — the nickname should persist and
show on every screen the player appears (squad board, bibs, league
table, head-to-head, results). Confirm a clash: a second teammate
trying the same nickname should get "Already taken on this squad."
**Note (by design, not a bug):** nicknames are **squad-local** —
each squad gives a player a separate `players` row, so a nickname
set on one squad does NOT follow them onto a new squad (same as
their name). Don't report that as a regression.

### 11.2 Drawn lineup stayed mutable after kick-off (mig 268, session 88)
**Symptom:** a player who is in a drawn team self-toggles injured
(or in/out) **after the game has kicked off** and silently disappears
from the saved team — at result-save their per-match stats go missing.
Footy Tuesdays, 2026-06-09: Matty toggled injured on/off at 20:23
(kick-off 20:00) and the result saved a 6-man team B with him gone.
**Root cause:** three stacked gaps — un-injure never restored a drawn
player to `'in'`, there was no kick-off lock, and result-save never
reconciled the dropped player's `player_match` row. See BUGS.md
SESSION 80.
**Fix:** mig 268 — `is_lineup_locked()` (lock point =
`schedule.game_date_time`) rejects post-kickoff self-service lineup
writes for drawn players; un-injure restores `status='in'`;
`admin_save_match_result` reconciles orphan rows. EV'd, leak-clean.
**Pre-flight check:** on a real iPhone, with teams already drawn and
the kick-off time in the past (game still live, result not yet saved),
open a drawn player's `/p/<token>` and try to toggle injured or change
status → it should be refused (no silent change); the player stays in
their team. A **non-drawn** reserve/maybe should still be able to
change their own status. Then save the result and confirm every drawn
player has a W/L/D record (none missing), and the team counts match
what was drawn (e.g. 7v7 stays 7v7).

---

## 13. SUPERADMIN DASHBOARD — blank screen (missing build-time env)

**Symptom:** `https://platform-superadmin-nu.vercel.app` rendered a
**blank black screen** — had done since first deploy, so the dashboard
was never usable.

**Root cause:** `apps/superadmin` is deployed **manual prebuilt-static**
(remote build fails on the monorepo `npm install`, same as `apps/venue`).
Unlike the remote-built apps, a local prebuilt deploy does NOT get
Vercel's env injected at build time — and `apps/superadmin` had **no
`.env.local` of its own**, so `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
baked in as `undefined`. `createClient(undefined, …)` throws on load →
React never mounts → blank screen. (Confirmed by grepping the deployed
bundle: no `*.supabase.co` URL, only the lib's "supabaseUrl is required"
string.)

**Fix (session — ops digest work):** created
`apps/superadmin/.env.local` (gitignored; the URL + **anon** key are
public client values, copied from `apps/inorout/.env.local`), rebuilt,
and redeployed prebuilt to production. Verified the live bundle now
contains `https://ktvpzpnqbwhooiaqrigm.supabase.co`.

**Pre-flight check (any manual-prebuilt app — superadmin, venue):**
before deploying, confirm the app has its own `.env.local` with the
needed `VITE_*` vars, OR the deployed bundle will be env-less. Quick
proof after deploy: `curl` the live `/assets/index-*.js` and grep for
`supabase.co` — present = env baked in, absent = blank-screen bug.
**Deploy recipe** (from `apps/superadmin`, linked to
`platform-superadmin`): `npm run build` → stage `.vercel/output/static`
+ a `config.json` SPA-rewrite → `vercel deploy --prebuilt --prod`.

**Durable risk:** `.env.local` is gitignored, so a fresh checkout on
another machine reintroduces the bug on the next manual deploy. Two
real fixes for later: (a) document/script the env step into the deploy,
or (b) fix `platform-superadmin`'s Vercel remote build so it auto-deploys
with injected env like the casual app.

---

## 14. LEAGUE — REF LIVE MATCH

### 14.1 Ref live clock stuck/zeroed — actual_kickoff_at dropped from RPC (mig 160 → mig 265)

**Issue.** The deployed ref app's live match clock derives from
`fixture.actual_kickoff_at`, but mig 160 (Cycle 5.6) silently dropped that
field from `get_fixture_state_by_ref_token`'s return — so the clock read
`undefined` and showed 00:00 / stuck for every live match since. Fixed data-side
in mig 265 (Ref V2), which restores the field; **the deployed ref app must be
redeployed** (lands with the Ref V2 re-skin) before the fix is visible.

**Pre-flight check.** On a real phone, open a ref link for an `in_progress`
fixture and confirm the clock is counting up (MM:SS), not frozen at 00:00.
Re-run after the Ref V2 redeploy. See BUGS.md session 87.

**Update (session 89): Ref V2 redeployed.** `apps/ref` rebuilt + deployed
prebuilt to `platform-ref.vercel.app`; verified live bundle carries the
Supabase URL + the new RPC names (`ref_set_clock` / `ref_record_sin_bin` /
`ref_set_added_time`), and migs 261–265 confirmed applied to prod. So the
clock fix + the full Ref V2 broadcast-dark redesign are now LIVE. **Still
owed:** the real-phone clock + Ref V2 walk above.

### 14.2 Manual-prebuilt deploy: `platform-ref` had a Root Directory set (path doubling)

**Issue (session 89, first redeploy).** `vercel deploy --prebuilt --prod`
from `apps/ref` failed with `path "…/apps/ref/apps/ref" does not exist`. The
`platform-ref` Vercel project had its **Root Directory** set to `apps/ref`, so
the CLI appended it to the cwd (already `apps/ref`) → doubled path. `platform-venue`
had no Root Directory set, which is why venue deployed clean from `apps/venue`.

**Fix.** Cleared `platform-ref`'s Root Directory to null (PATCH
`/v9/projects/{id}` `{"rootDirectory":null}`) so it matches the venue pattern —
deploy from the app dir with cwd treated as root. Redeploy then succeeded.

**Pre-flight (any manual-prebuilt app).** Before the first deploy from a fresh
machine/project, confirm the Vercel project's Root Directory is **empty** if you
deploy from inside the app dir — otherwise the prebuilt path doubles. Deploy
recipe (from the app dir, e.g. `apps/ref` / `apps/venue`): `npm run build` →
sync `dist/` into `.vercel/output/static` (config.json = SPA rewrite already
present) → `vercel deploy --prebuilt --prod` → verify the live bundle greps a
`*.supabase.co` URL (env baked in, per #13).

---

## 15. SESSION 139 — PLUS-ONE APPROVALS, MATCH NOTE, POTM MODAL TRAP, DRAW COLOURS

**15a. POTM tiebreak modal trapped admins (PRODUCTION — two admins hit it, incl. Rocky).**
The admin-side `POTMTiebreakModal` ("POTM TIE — YOUR CALL", AdminView, zIndex 200) had NO
escape — no ✕, no backdrop tap, no scroll, no height cap. The only exit was to lock in a
winner, so any admin caught by a vote tie was stuck behind it and couldn't reach the admin
panel. Fixed: capped to `calc(100dvh - 40px)` flex column (header + footer pinned, candidate
list scrolls), always-visible ✕, tap-backdrop-to-close, "Decide later" — all wired to a new
`onClose`. Dismiss is client-only (sets `tiebreakDismissed`); the tie re-surfaces next admin-
screen mount until someone picks a winner (the only resolver: `admin_close_potm_voting`).
*(NB there are TWO POTM modals — the player `POTMVotingModal` got the same robust treatment
+ a fix so it reappears each open until the player votes, then never again.)*
**Device check:** on a real iPhone home-screen install, with a team whose last game ended in
a POTM tie, open the admin panel → confirm the "POTM TIE" modal shows a ✕, scrolls if the
candidate list is long, closes on ✕ / tap-outside / "Decide later", and that locking in a
winner makes it never return.

**15b. Plus-one approvals (mig 346).** A player's +1 now enters PENDING (no squad spot) until
an admin approves via the top-of-AdminView "🙋 PLUS-ONE APPROVALS" banner (approve → in, or
reserve if full; decline → dormant). Admin-added guests auto-approve. Host sees "waiting for
approval" + can cancel. Push to admins plumbed but DORMANT until admins enable notifications.
**Device check:** on a real install, player adds a +1 → confirm it does NOT take a spot and
shows "waiting"; admin sees the banner live, approve/decline/reserve each work; admin-added
guest skips approval.

**15c. Match result note (mig 347).** Optional free-text note on a saved result (e.g.
"abandoned early due to injury, declared a draw"), shown on the HistoryView result card to
everyone. **Device check:** save a result with a note → confirm it shows on the card; edit the
result later → confirm the note pre-fills and isn't wiped.

**15d. Results draw rendering + colours.** A draw (`winner='D'`) was mis-rendered in the
expanded result drill-down ("Won by ?", "Team D won"); and an UNPLAYED match (winner NULL) was
classed as a draw, so this week's not-yet-played fixture showed as an amber 0–0 draw. Fixed:
draws render correctly across all 3 score types; "pending" split from "draw" (unplayed shows
neutral grey "NOT PLAYED YET"); real draws use a dedicated teal `--draw` token (distinct from
amber). **Device check:** open Results → this week's unplayed game reads grey "NOT PLAYED YET",
a real draw reads teal "D", and the expanded view of a draw shows no "Team D won".

---

## SCOPE OUT

These known issues exist but are LOW priority with documented
workarounds — they do not block onboarding a new squad:

- **BibsScreen standalone write** — workaround via ScoreScreen
  (covered in §8.3)
- **`player_career` table mostly empty** — schema ready (mig 053),
  backfill deferred to Phase 2; affects long-term stats only
- **`scoring.js` filename mismatch** — cosmetic
- **Cross-browser PWA install** — mostly resolved by per-install
  manifest + PWAWelcome polymorphic paste box as escape hatch

See `BUGS.md` "LOW — Known workarounds exist" for full notes.

---

## 16. SESSION 141 — MULTI-CONTEXT NAV PHASE 1 (migs 349–351)

**Issue class:** the new context-aware nav reshapes the most-used app
(PlayerView / NavBar / App.jsx routing) during an active pilot. It ships
**dark** behind `teams.multi_context_nav` (default `false`), so with the flag
OFF the footballer's app must be byte-identical to today. The club/guardian nav
is additive (those users were previously stranded). These checks cannot be seen
by build/hygiene/grep — they are real-device behaviour (Hard Rule #13).

**Pre-flight checks — run on a real iPhone, installed from the Home Screen:**

1. **Flag OFF — casual squad unchanged.** Open a normal `/p/<token>` on a casual
   team (flag off). Expected: nav = My View · Stats · Results · My IO; tapping the
   header avatar opens the **Player Profile** (NOT the switcher); In/Out, Stats,
   Results, My IO all behave exactly as before. No new layout, no console errors.
2. **Flag OFF — admin unchanged.** Open `/admin/<token>`. Expected: identical
   admin dashboard + nav as today.
3. **Flag ON (enable on a test team: `UPDATE teams SET multi_context_nav=true
   WHERE id='<test team>'`).** Reopen `/p/<token>`: header avatar now opens the
   **ContextSwitcher** sheet listing Your games / Your clubs / (Family) / Feed.
   Tap another squad → lands on `/p/<that token>` (admins get the Admin tab).
4. **Flag ON — multi-team admin.** An admin with >1 team who used to hit the
   multi-team landing block now lands on **`/feed`**. Confirm no dead end.
5. **Club member.** Sign in as a club member, open `/sessions`: a bottom nav
   (Sessions · Pass · Profile) is present; **Pass** opens the membership card at
   `/m/<pass_token>`; **Profile** opens `/profile` (which also has the nav).
   Content is not hidden behind the bar (bottom padding correct).
6. **Multi-club member.** Tap a specific club (switcher / `/sessions?club=<id>`):
   it shows **that** club's sessions, not always the first.
7. **Guardian.** Open `/parent-home`: each child lists upcoming training + matches
   across all their clubs; In / Maybe / Out per fixture saves (member_rsvp_session
   on behalf of the child); child filter chips appear when >1 child; "Follow live"
   link present.
8. **Install target.** From `/feed` (or a club/guardian route), Add to Home
   Screen → reopen from the icon → it launches `/feed`, not `/`.

**Expected outcome:** with the flag off, zero observable change for the
footballer. With the flag on, the switcher + club/guardian nav work and no
casual surface regresses. If any tap does nothing or content hides behind the
nav bar, STOP and escalate before enabling the flag on the pilot team.

## 17. SESSION 143 — RECURRING-SESSION TIMES STORED IN UTC NOT UK LOCAL (mig 353)

**Issue class:** recurring-session generators stored the operator's entered time
as UTC, so during **British Summer Time** every recurring class / club-training
session displayed and triggered **one hour late**. Affected
`venue_create_class_series`, `club_create_session_series`,
`club_manager_create_session_series`. Fixed by interpreting the wall-clock
`AT TIME ZONE 'Europe/London'` (mig 353). One-off sessions were never affected.
No historical rows needed correcting (0 future series rows existed at fix time).

**Device check — run before onboarding any venue that uses classes or club training
(do this DURING BST to catch the bug; in winter the symptom is invisible):**

1. In the venue dashboard (Classes → Schedule), create a **recurring** class at a
   known time, e.g. **18:00**, for a future weekday. Confirm every generated session
   in the timetable reads **18:00**, not 19:00.
2. Open the member app timetable for that class — confirm it also reads **18:00**.
3. Repeat for a **club training series** (club manager / venue club session series):
   create at 18:00, confirm sessions read 18:00 on both the manager and member views.
4. Spot-check a **one-off** class at 18:00 still reads 18:00 (regression guard — the
   one-off path was always correct and must stay correct).

**Expected outcome:** entered time === displayed time for recurring sessions, in
both summer and winter. If a recurring session shows an hour late, the
`AT TIME ZONE 'Europe/London'` fix has regressed — STOP.

---

## 18. SESSION 171 — UNIFIED LOGIN: STALE SAFARI BREADCRUMB LOOPS BACK TO AN OLD PAGE AFTER SIGN-IN (migs 376–377)

**Issue class:** after signing in, the page refreshes several times and dumps the
user back at the login screen (a "login loop"). Seen on a real iPhone after Google
sign-in. NOT a code regression — root cause is a **stale Safari "resume"
breadcrumb**: an earlier `/p/<token>` (or other deep) link opened in the same Safari
session writes `ioo_redirect_to` / `ioo_last_visited`, and after sign-in the App.jsx
redirect bridge bounces to that stale page. **Deleting the home-screen PWA does NOT
clear Safari's localStorage** — only clearing Safari → "History and Website Data"
does. Hardened in code (AuthCallback now clears the resume breadcrumbs on a generic
sign-in so a fresh sign-in always lands on the account landing), but a pre-existing
stale breadcrumb on a real device can still surface it until cleared.

**Device check — run when signing in on iOS Safari:**

1. After signing in on iOS Safari, confirm you land on **your team / account
   screen** — not a resumed stale page (e.g. an old demo `/p/` link).
2. If a test device gets stuck looping back to an old page after sign-in, clear
   Safari → **History and Website Data** (deleting the home-screen icon is NOT
   enough), then sign in again.

**Expected outcome:** a fresh sign-in lands on your team/account landing. Admins land
straight in the admin view; multi-team people see the "YOUR TEAMS" chooser; nobody is
looped back to a stale page or logged out.

---

## 19. SESSION 185 — STRIPE WEBHOOK: 100% SIGNATURE FAILURE (two independent causes)

**Issue class:** every Stripe webhook delivery to `/api/stripe-webhook` failed, so NO
membership, schedule, invoice-paid, or subscription-status event ever reconciled —
silent money-flow breakage. The endpoint looked "Active" in Stripe; the failure was
only visible in the delivery list (400) + Vercel logs. Surfaced during the Phase 4
test-mode walk; two separate bugs stacked, each of which alone causes total failure:

1. **Raw-body consumed by Vercel's lazy `req.body` getter (code bug — fix `6f4ac8b`).**
   On the bare `@vercel/node` runtime (this is a Vite app, NOT Next.js), `req.body` is
   a lazy getter that *parses the JSON and drains the request stream on first access*.
   `readRawBody` accessed `req.body` in a guard, so by the time it read the stream the
   raw bytes were gone → Stripe signature verified against an empty body → always
   `400 bad_signature`. The Next.js `config.api.bodyParser=false` export is IGNORED by
   `@vercel/node`. **Fix:** never touch `req.body`; read the stream directly.
2. **`STRIPE_WEBHOOK_SECRET` mismatch (config bug).** Vercel held `whsec_hT…` while the
   live destination signed with `whsec_zP…` (the destination's secret had diverged from
   the env var). Even with the raw body correct, verification failed. **Fix:** copy the
   destination's signing secret (Stripe → Webhooks → destination → Overview → reveal
   Signing secret) into Vercel `STRIPE_WEBHOOK_SECRET` (Production + Preview), redeploy.

**Diagnosis tip:** the `400 bad_signature` body is generic — both causes look identical.
The real Stripe error ("No signatures found matching the expected signature for payload")
is in the Vercel function log. To tell raw-body-vs-secret apart, log `rawBody.length` +
`rawHead` + `secretHead` (first 8 chars of the env secret) — a populated raw body with a
mismatched `secretHead` pinpoints the secret.

**Pre-flight check — run before go-live AND every time keys/destination change:**

1. In Stripe, reveal the destination's **Signing secret** and confirm it matches
   `STRIPE_WEBHOOK_SECRET` in Vercel (first 8 chars are enough): `whsec_…`.
2. Resend (or trigger) one real `checkout.session.completed` and confirm the delivery
   shows **200 / Recovered**, not 400.
3. Confirm the resulting `venue_memberships` row carries `stripe_subscription_id` (and,
   for a season tier, `stripe_schedule_id` + `phase_end_at` + `billing_starts_at`).

**⚠️ GO-LIVE TRAP:** the LIVE webhook destination has its OWN `whsec_…`, different from
this sandbox one. When switching to live keys (Phase 7), the secret MUST be re-copied or
this exact 100%-failure returns on day one.

**Expected outcome:** webhook delivery returns 200; the membership + schedule + ledger
rows all appear.

---

## 20. SESSION 204 — UNIFIED HOME ("Feed") RPC THREW 42703 ON EVERY CALL (mig 425)

**Issue class:** the multi-context home screen (`/feed`, `UnifiedFeedScreen`) silently
showed "Nothing coming up in the next two weeks" for **every** user with a squad and a
club, since it shipped. It looked like an empty-state, not a failure. The cause:
`get_unified_home_feed` referenced `players.team_id` and `players.player_token`, but the
`players` table has `team` and `token`. PostgreSQL resolves columns at execution, so the
bad refs made the **whole** function throw `42703 column p.team_id does not exist`, and
the client (`UnifiedFeedScreen` / `supabase.js`) caught the error and rendered the empty
state — masking a hard 400. A second, latent bug sat behind it: even with the columns
fixed, the squad block keyed membership off `players.team` (NULL for linked players)
instead of `team_players`, so squad games would never appear. **Fix (mig 425):** correct
the columns AND re-resolve squad membership through `team_players` (mirroring the working
`get_user_relationships`), plus `s.active=true` and an `> now()` lower bound to match the
other blocks' upcoming-only semantics.

**Why nothing caught it:** build, hygiene, and ephemeral-verify cannot see a swallowed
400 — only a real browser smoke of the signed-in screen did. (Reinforces the
"run the app in a browser before done" rule.)

**Pre-flight check — run before go-live:**

1. Sign in (real account or a demo account via the Supabase password grant) as a user
   who has BOTH a casual squad and a club membership.
2. Open `/feed` and check the browser console / network tab: `get_unified_home_feed`
   must return **200**, not 400. There must be **no** `42703` / "column does not exist".
3. With a non-live upcoming squad game OR an upcoming club session in the next 14 days,
   confirm it actually renders as a card (not the empty state).

**Expected outcome:** the RPC returns `{events:[…]}` with the user's upcoming squad games,
club sessions, fixtures and children's sessions — never a silently-swallowed error.

---

## 21. SESSION 232 — ADMIN "KEEP IN" ON A DROPPED-OUT HOST'S GUEST DIDN'T PERSIST (mig 458)

**Symptom (reported live):** A guest's host (the permanent player who brought
them) drops out. The admin panel shows a banner: *"X's host dropped out — Keep
IN / Move to reserve / Remove X."* Tapping **Keep IN** kept the guest in the
match but the banner **came straight back on every reload** — the admin was
nagged about the same already-decided guest forever.

**Root cause:** The banner is computed live from `host.status != 'in'`. "Keep
IN" only mutated an in-memory React Set (`dismissedOrphans`) — nothing was
written to the DB, so the host stayed out, the condition stayed true, and the
banner re-appeared on the next data load. "Move to reserve" had the same bug
(the filter ignored the guest's own status). Only "Remove" persisted (it sets
status `none` → dormant → excluded).

**Fix (mig 458):** A per-week `players.host_dropout_ack` flag. "Keep IN" now
calls `admin_ack_orphan_guest` (persists the flag + writes audit_events);
`get_team_state_by_admin_token` exposes the flag so the filter can read it; the
weekly rollover (`admin_go_live` / `admin_go_live_for_team`) resets it so the
ack is "for this one game". The orphan filter gained a `status === "in"` guard
which also fixes the Move-to-reserve reappearance. Guest stays linked to its
host → returning-guest picker unchanged.

**Why nothing caught it earlier:** build/hygiene/ephemeral-verify cannot see
"the banner reappears after a reload" — only using the live admin screen does.
Reinforces the run-the-app rule.

**Pre-flight check — run before go-live:**

1. As an admin, with a guest whose host has dropped out (host status not "in"),
   open the admin panel — the "host dropped out" banner shows for that guest.
2. Tap **Keep IN**. The banner disappears and the guest stays IN the match.
3. Pull-to-refresh / fully close and reopen the app. The banner must **NOT**
   reappear for that guest.
4. Repeat with **Move to reserve** on a second such guest → after reload, no
   reappearance, and the guest is on the reserve list.
5. Open next week's game (rollover). If that same host drops out again, the
   banner is allowed to re-appear (the ack is per-game by design).

**Expected outcome:** a "Keep IN" / "Move to reserve" decision sticks across
reloads within the same game; the admin is asked again only in a new game.

---

## 22. SESSION 233 — ADMIN SCREENS RENDERED UNDER THE iPHONE NOTCH (back button untappable) (PR #188)

**Symptom (reported live, on-device):** On a real iPhone in the native app,
every admin sub-screen (Matchday Settings, Manage Squad, Teams, Score,
Payments, Reminders, Bibs, Teamsheet) rendered its header — title + back
button — **partially under the device notch / status bar**. The back button
was clipped and **untappable**; content started too high.

**Root cause:** The admin screens rendered their own top headers with a fixed
top padding and **no `env(safe-area-inset-top)` compensation**, even though
the viewport is correctly set to `viewport-fit=cover`. The player-facing
screens (PageHeader, PlayerView, StatsView, MyIOView, PlayerProfile) all use
the `calc(Npx + env(safe-area-inset-top))` pattern — the admin screens were
simply missing it. There is no shared admin header component, so each screen
had drifted independently.

**Fix (PR #188, no migration — UI only):** Added
`env(safe-area-inset-top)` to the top padding of every admin screen's
outer/header container, matching the established player-screen pattern. Covers
the main AdminView sticky hero + TeamsScreen (both empty-state and main
returns), ScoreScreen, BibsScreen, SquadScreen, ScheduleScreen,
RemindersScreen, PaymentsScreen, TeamsheetScreen. (AnnounceModal /
BookPitchModal are bottom-sheets → not affected.)

**Why nothing caught it earlier:** build / hygiene / type checks cannot see
"the back button is under the notch and won't tap" — it only surfaces on a
real notched device in the native app. Reinforces hard rule #13.

**Pre-flight check — run before go-live (real iPhone, native app):**

1. As an admin, open each admin screen in turn: Matchday Settings, Manage
   Squad, Teams, Score, Payments, Reminders, Bibs, Teamsheet.
2. For each, confirm the header title is **fully below the notch** and the
   back / "← Back" control is **completely clear of the status bar and taps
   reliably** to return.

**Expected outcome:** no admin screen's chrome is clipped by the notch; every
back button is tappable on a notched device.

---

## 23. SESSION 234 — CASUAL STATUS TAP DEAD (orphaned setter ReferenceError in setStatus) (PlayerView)

**Symptom (reported live, native app):** casual players tap In / Out / Maybe /
Reserve and **nothing happens** — status never changes, no flash, no save.
**Every other control worked** — add guest, injured toggle, "I've paid" — only
the status buttons were dead. Systematic across players.

**Root cause:** PR #203 (`4e4e732`, per-game payment rework) deleted the
`clearDebtExpanded` React state along with the old Clear-Debt panel, but left an
orphaned `setClearDebtExpanded(false)` call at the top of `setStatus` in
`apps/inorout/src/views/PlayerView.jsx`. Every status tap threw
`ReferenceError: setClearDebtExpanded is not defined` on that line — **before**
the optimistic `setSquad` and the `set_player_status` RPC — so the handler
aborted and the tap was a no-op. No other handler referenced the dead setter,
which is exactly why "all other buttons work, just status."

**Fix (no migration — one-line delete):** removed the orphaned
`setClearDebtExpanded(false)` line. The RPC, grants and team data were verified
healthy on the live DB the whole time (rolled-back probe returned `status=in`);
this was purely a client-side crash in the tap handler.

**Why nothing caught it earlier:** a `ReferenceError` on an undefined identifier
is a **runtime** error — Vite build, `node --check` and the 7 hygiene checks are
all clean (the name is syntactically valid, never declared). Only exercising the
tap surfaces it. Reinforces hard rule #13. (Follow-up tech debt: an ESLint
`no-undef` gate in the commit/build path would have caught this at commit time.)

**Pre-flight check — run before go-live (real iPhone, native app):**

1. As a casual player on `/p/<token>` with the game live, tap **In** — confirm
   the row flashes green and the button shows active.
2. Tap **Out**, **Maybe**, **Reserve** in turn — each must switch immediately.
3. Reload — the last-tapped status persists (proves the RPC ran, not just
   optimistic UI).

**Expected outcome:** every status button responds on the first tap and the
change survives a reload.

---

## 24. SESSION (2026-07-07) — APPLE HEALTH DEAD IN SHIPPED BINARY: NATIVE PLUGIN NEVER REGISTERED (build 1.1.0(10) → fix in (11))

**Symptom:** tapping **Add Apple Watch workout** shows *"Couldn't add workout —
"HealthKit" plugin is not implemented on ios."* for **every App Store user**
(confirmed on two devices, incl. the operator's after a clean App-Store
reinstall). A full app relaunch does NOT fix it. The rest of the app works
(stats sync, `App.getInfo()` footer resolves) — only Apple Health is dead.

**Root cause:** build **1.1.0(10)** was submitted **2026-07-02**, *before* the
plugin-registration wiring existed (added 2026-07-04). In **Capacitor 8 the
`CAP_PLUGIN` macro alone does NOT register an app-embedded plugin** — the bridge
only auto-registers npm-package plugins from `capacitor.config.json`. Registration
requires an explicit `bridge?.registerPluginInstance(HealthKitPlugin())` in a
custom `MainViewController.capacitorDidLoad()` (wired via the storyboard
`customClass`). That file lives in the **gitignored `ios/` folder** and was never
in build 10. The error is the Capacitor **plugin-level** `UNIMPLEMENTED` (thrown
by `@capacitor/core` when `PluginHeaders` has no `HealthKit` entry) — distinct
from the JS `.then()` thenable-hang (PR #278), which was a separate, OTA-fixed bug.

**Why it hid so long:** the fix is **native → cannot ship over-the-air**. The web
bundle updates OTA (so everyone got the *button* and later JS fixes #277/#278), but
the plugin list is published by the *binary*. "Works for me" during dev was an
Xcode build that had the wiring; the App Store binary never did. See the corrected
build recipe in `apps/inorout/ios-plugins/HealthKit/README.md` (new step 5).

**Fix:** rebuild from current source (all wiring present locally), bump
`CURRENT_PROJECT_VERSION` 10 → 11, archive, resubmit to Apple. Also improved the
JS error copy (PR #330) to say "fully close and reopen the app" instead of the
dead-end "check Health settings" — cosmetic only; does NOT cure this.

**Pre-flight check — run before claiming Apple Health live (real iPhone, the actual
App Store / TestFlight binary — NOT an Xcode dev build):**

1. On the shipped binary, open a game card and tap **Add Apple Watch workout**.
2. The **Apple Health permission sheet must appear** (not the "not implemented" error).
3. In the device console on launch, confirm the line
   `[MainViewController] capacitorDidLoad — registering HealthKit plugin instance`.

**Expected outcome:** the permission sheet presents and the registration log line
is present. Absence of that log line = the plugin is not registered = Apple Health
is dead for all users, regardless of what the web bundle ships.
