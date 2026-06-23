# Stripe Full Build — Handoff & Plan

> **STATUS (2026-06-23):** 🏁 **PHASE 1 + PHASE 2 SHIPPED + MERGED** (Phase 1: mig 403, PR #69, s181;
> Phase 2: mig 404, PR #71, s182). Full Stripe build — no demo/post-demo split, one track. 21 scope
> items (see coverage map). Built end-to-end against the **test keys already in place** (Stripe test
> mode); **live keys go in last** (Phase 7), so go-live is a config change, not a code change.
> **Next free migration = 405.** **NEXT = Phase 3** (mass invoicing — the headline operator action).
> Re-confirm the next mig off `main` before any SQL (cloud-session discipline — migration numbers are
> first-come). Kickoff prompt at the bottom.

---

## GOAL

Make In or Out a full payments platform a multi-age football club can run on:
recurring subs, season plans that end themselves, one-off bulk invoicing, pro-rating,
refunds, and a single coherent money view for the person paying — all on the venue's own
Stripe Connect account, with our platform fee clipped.

**The persona test ("Dave"):** one human who (a) pays his daughter's U12 subs as guardian,
(b) pays his own adult membership, and (c) drops in for one-off casual football — must save
his card **once**, see **everything he owes/paid in one place**, and never be double-charged
or chased for money already paid.

---

## WHAT ALREADY EXISTS (dormant — built migs 329–337, verify don't rebuild)

- `venue_integrations` table + Connect onboarding (`/api/stripe-connect.js`,
  `set_venue_connect_state`) — operator connects their bank.
- Per-member self-serve checkout (`/api/stripe-member-checkout.js`) — subscription for
  monthly/quarterly/annual, one-off payment for season.
- Webhook (`/api/stripe-webhook.js`) — checkout.session.completed, subscription lifecycle,
  invoice.paid/failed, account.updated; persist-then-process (`record_stripe_event`),
  04:00 reconciliation cron.
- `stripe_complete_member_enrolment`, `apply_membership_subscription_status`,
  `get_venue_signup_tiers` (stripe_connected flag), `venue_get_billing_status`.
- `_prorated_first_charge` (mig 393) — season first-charge pro-rating (joining fee +
  remaining season slice), Option A "round up in member's favour". Already in checkout.
- `get_my_payment_history` (mig 039) — **casual-only** payment history (token-scoped).
- `venue_charges` / `venue_payments` ledger; `run_membership_renewals` + reminder cron;
  #4 chase engine (paid/unpaid pills + auto-reminders, mig 398).

**The dormant switch is purely the absent live env vars.** Everything below is built/tested
in test mode; live keys flip it on.

---

## PHASE 1 — Foundations & safety  ✅ SHIPPED (mig 403, PR #69, session 181)

**Delivered:** renewal-cron guard (`run_membership_renewals` skips live `stripe_subscription_id`);
`stripe_customers` table + `get_or_link_stripe_customer` (one customer per payer+connected account,
reused in checkout); `stripe_record_invoice_payment` + `stripe_record_refund` (invoice.*/refund.* →
`venue_charges`/`venue_payments` ledger, idempotent; `venue_payments.method` += `'stripe'`);
reconciliation cron invoice drift-repair; `stripe_complete_member_enrolment` += `p_payer_profile_id`
(8→9 arg, old DROPped) now writing `venue_memberships.payer_profile_id`. All 5 RPCs service_role-only
(⚠️ Supabase default-grants anon+authenticated on NEW fns AND on DROP+recreate — explicitly REVOKED).
Gates: rpc-security PASS, EV 15/15 + leak 0, build PASS, hygiene clean, casual-regression N/A
(api/ + migration only). Phase 2 inputs now live: the payer→customer map and `payer_profile_id`.

<details><summary>Original Phase 1 spec (for reference)</summary>

### PHASE 1 — Foundations & safety (no new user features; makes Stripe-live safe)

**Why first:** the moment live keys go on, the current code double-bills and fragments
customers. Fix that before layering anything on.

**Build:**
- **mig 403** — `run_membership_renewals` Stripe-sub guard: skip any membership with a live
  `stripe_subscription_id` (Stripe re-bills those itself). ⚠️ Without this, monthly Stripe
  members get a phantom "unpaid" ledger charge → #4 chases money already paid.
- **One Stripe customer per human** (scope #3): enhance `/api/stripe-member-checkout.js` to
  look up / reuse a single Stripe customer keyed on the payer's auth identity (email/uid)
  on the connected account, instead of creating a fresh customer each checkout. Store the
  customer id against the human, not per-membership. New RPC `get_or_link_stripe_customer`
  (or extend enrolment) to persist the mapping.
- **Webhook + reconciliation coverage** (scope #15): extend `/api/stripe-webhook.js` +
  reconciliation cron to handle `invoice.*` (incl. Invoicing product) and `refund.*` /
  `charge.refunded` events. Confirm every event we now emit is reconciled.

**Use cases:** no member double-billed when Stripe goes live; Dave's three relationships
share one Stripe customer + one saved card; no payment ever silently lost.

**Gates:** rpc-security-sweep (mig 403), ephemeral-verify (renewal guard + customer-reuse),
build + hygiene, casual-regression (checkout touches `api/`, not `src/` — confirm).

</details>

---

## PHASE 2 — Unified money view for the member (scope #4, #5)  ✅ SHIPPED (mig 404, PR #71, session 182)

**Delivered:** `get_my_money()` — one authenticated READ resolver aggregating the signed-in human's
whole money picture across streams: casual match fees (`get_my_payment_history` folded in UNCHANGED,
whole-pounds, **separate array**), own memberships, and memberships paid as guardian (own ∪
`payer_profile_id` ∪ `member_guardians`, deduped, non-cancelled). Membership charges matched from
`venue_charges` via `split_part(source_id,':',1)`; `paid_pence` from non-voided `venue_payments`.
**Pence (membership) vs whole-pounds (casual) kept in separate arrays — never summed.** Identity
model mirrors `get_my_world` (person spine). SECDEF STABLE, search_path pinned, single overload,
anon REVOKED + authenticated grant (mig-175 gotcha), **read-only → no audit**. UI = additive "My
money" section in `MemberProfile.jsx`; casual surfaces byte-unchanged. Gates: rpc-security PASS, EV
8/8 + leak 0, build + hygiene 7/7, casual-regression PASS (additive +20/-0), Playwright authed walk
PASS (guardian demo user → child membership renders, who_for tagged). ⛔ real-iPhone PWA walk owed
(none of Hard Rule #13's enumerated files touched). **DECISION: season one-off (mode=payment) Stripe
payments deferred to Phase 3** (Phase 1 recorded `invoice.*` only); `get_my_money` is complete for
everything Phase 1 records.

<details><summary>Original Phase 2 spec (for reference)</summary>

### PHASE 2 — Unified money view for the member (scope #4, #5)

**Build:**
- **mig 404** — `get_my_money` (or extend): one authenticated RPC aggregating the signed-in
  human's full picture across streams — casual fees (fold in `get_my_payment_history`), his
  own memberships, and memberships he pays for as guardian (his children). Returns paid
  history + upcoming/owed, each tagged by stream + who-it's-for.
- **UI** (`apps/inorout/src`): a "Payments" / "My money" view — one screen: "Daughter's subs,
  my membership, last Sunday's match fee" with paid & upcoming. Casual logic untouched;
  just surfaced alongside.

**Use cases:** Dave opens one place and sees everything he's paid and everything coming up,
across all three hats.

**Gates:** rpc-security-sweep, ephemeral-verify, build + hygiene, **casual-regression
(touches `apps/inorout/src`)**, Playwright authed walk, ⛔ **real-iPhone PWA walk** (Hard #13).

</details>

---

## PHASE 3 — Mass invoicing (the headline operator action: scope #6, #7, #8, #18)  ← NEXT

**Build:**
- **mig 405** — bulk one-off charge engine:
  - `venue_bulk_charge_preview(token, cohort, amount, due_date, ...)` → returns every
    member with status (will-invoice / auto-skip + reason: already-paid|paused|left).
  - `venue_bulk_charge_commit(token, run spec, excluded_ids[])` → creates one `venue_charges`
    row per included member; idempotent per run key; writes a **billing_run** record.
  - `venue_void_billing_run(token, run_id)` → soft-void the whole run (mirrors `venue_payments`
    void pattern).
  - New table `venue_billing_runs` (who/what/when/totals/status) + run_id on charges.
  - Pro-rated mass invoicing (#18): reuse `_prorated_first_charge` for late joiners in a
    season-fee run.
- **Stripe Invoices for online-payable charges** (#7): when "let them pay online" is on,
  `venue_bulk_charge_commit` (or a follow-on `/api/stripe-create-invoices.js`) creates a
  Stripe **Invoice** per member on the connected account (using the Phase-1 reused customer),
  finalizes it, Stripe emails the hosted pay page; `invoice.paid` webhook → marks the ledger
  charge paid. Use Stripe `idempotency_key` per (run, member).
- **UI** (`apps/venue` Payments + consumer coach "Subs & payments" roster): 4-step wizard —
  (1) cohort (team / tier / whole club, live count), (2) charge (label, amount, due date,
  pay-online toggle), (3) **interactive preview** — tick/untick individuals, auto-skips
  locked with reason, running total recomputes, (4) type-to-confirm total → Send. Plus a
  billing-run list with Void-run.

**Use cases:** "Bill the U12 squad £15 tournament fee, skip the two who paid cash" →
parents tap a pay link → ledger goes green on its own. "Sent wrong amount" → void run.

**Gates:** rpc-security-sweep (3 new write RPCs), **ephemeral-verify** (own `_e2e_` cohort,
preview→commit→void→leak-check 0), build + hygiene (venue app = hand-check hex),
casual-regression if consumer roster touches `src`, Playwright wizard smoke + Stripe test-mode
invoice paid→reconciled.

---

## PHASE 4 — Fixed-term & dated billing (scope #9, #10, #19)

**Build:**
- **mig 406** — store schedule/anchor metadata on `venue_memberships`
  (`stripe_schedule_id`, phase end, `billing_starts_at`); cron must leave scheduled subs alone.
- **Subscription Schedules** (#9): for season-length recurring plans, `/api/stripe-member-checkout.js`
  creates a Stripe Subscription Schedule (phases Sept→June, `end_behavior: cancel`) instead of
  an open-ended sub.
- **Future start-date anchoring** (#10): `billing_cycle_anchor` / `trial_end` so billing
  begins on the season start date, not signup day.
- **Mid-cycle proration on recurring subs** (#19): set `proration_behavior` so a mid-month
  joiner's first charge is the part-period (Stripe-side; must agree with mig-393 Option A
  convention — round in member's favour).

**Use cases:** U12s pay monthly Sept→June then auto-stop (no summer billing); sign up in July,
first charge 1 Sept; join mid-month → pay the part-month.

**Gates:** rpc-security-sweep (mig 406), ephemeral-verify (schedule metadata + cron-leaves-
alone), build + hygiene, casual-regression (api only — confirm), Stripe test-mode schedule
walk (advance test clock to prove auto-stop).

---

## PHASE 5 — Lifecycle management (scope #11, #12, #13, #20, #21)

**Build:**
- **Stripe Billing Portal** (#11, hosted/light): `/api/stripe-billing-portal.js` → returns a
  portal session URL for the signed-in member (their reused customer) to update card / cancel /
  pause. Webhook already handles the resulting subscription.updated/deleted.
- **mig 407** — bulk price change (#12, +pro-rated #20): `venue_bulk_price_change(token,
  cohort, new_price, effective_date)` — for Stripe-sub members, push the new price to their
  Stripe subscription with proration; for non-Stripe members, update the ledger amount.
- **Refunds via Stripe** (#13, +pro-rated #21): `venue_refund_charge(token, charge_id,
  amount|full)` → Stripe refund on a Stripe-collected charge (today only manual void exists);
  pro-rated "unused portion" refund reuses the mig-393 maths; reconcile back to the ledger.

**Use cases:** Dave manages his own card/cancel without the coach; "subs up £2 Sept" applied
to every junior (Stripe + cash); member quits mid-term → refund the unused months.

**Gates:** rpc-security-sweep (migs 407 + refund RPC), **ephemeral-verify** (price-change +
refund against own fixture, no live rows touched), build + hygiene, casual-regression,
Stripe test-mode refund + price-change walk, ⛔ real-iPhone walk for the portal entry point.

---

## PHASE 6 — Collection, chasing & reporting (scope #16, #6.2, #6.3)

**Build:**
- **Pay-now links in chase reminders** (#16): the #4 reminder email/pill carries the Stripe
  hosted-invoice / portal pay link for online-enabled charges.
- **Notification de-storm** (#6.2): a bulk run + the reminder cron dedupe via `notification_log`
  so a member isn't double-emailed; throttle a large blast.
- **Operator reconciliation view** (#6.3): per-run + per-period raised/paid/overdue, collection
  rate, Stripe-vs-manual split (extend `venue_get_billing_status` / PaymentsView).

**Use cases:** overdue reminder has a Pay-now button; invoice 200 people without 200 double-
emails; "how much of this season's subs are actually in, and who's outstanding?"

**Gates:** rpc-security-sweep (any RPC change), build + hygiene, casual-regression, Playwright
smoke, dedupe proven against the reminder cron.

---

## PHASE 7 — Go-live (scope #1, #1.1, #1.2, #1.3) — LAST

**Build / actions (config + verification only, no new features):**
- **Live keys** (#1.1): operator sets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Connect
  return/refresh URLs; register the live webhook endpoint in the Stripe dashboard.
- **Connect onboarding verify** (#1.2): operator completes Express onboarding for real; status
  pill shows connected/restricted; surfaced in venue Payments.
- **Real-device payment walk** (#1.3): a parent genuinely pays on a real iPhone PWA install,
  end-to-end (Hard Rule #13) — across all of Dave's three streams.

**Gate:** nothing in Phases 1–6 may assume live keys; this phase is the single switch.

---

## SCOPE COVERAGE MAP (all 21 items placed)

| # | Item | Phase |
|---|------|-------|
| 1 / 1.1 / 1.2 / 1.3 | Live keys, Connect onboarding, real-device walk | 7 |
| 2 | Per-member checkout (enhance) | 1 |
| 3 | One Stripe customer per human | 1 |
| 4 | Unified member payment history | 2 |
| 5 | Casual history (fold in, no change) | 2 |
| 6 | Mass invoicing wizard + remove individuals | 3 |
| 7 | Stripe Invoices for online one-offs | 3 |
| 8 | Billing-run record + void | 3 |
| 9 | Subscription Schedules (fixed-term seasons) | 4 |
| 10 | Future start-date anchoring | 4 |
| 11 | Stripe Billing Portal (self-service) | 5 |
| 12 | Bulk price change → push to Stripe | 5 |
| 13 | Refunds via Stripe | 5 |
| 14 | Renewal cron double-bill guard | 1 |
| 15 | Webhook + reconciliation coverage | 1 |
| 16 | Pay-now links in #4 chase engine | 6 |
| 17 | Season first-charge pro-rating (no change) | — (live) |
| 18 | Pro-rated mass invoicing | 3 |
| 19 | Mid-cycle proration on recurring subs | 4 |
| 20 | Pro-rated price change | 5 |
| 21 | Pro-rated refund on leaving | 5 |

---

## CROSS-CUTTING (every phase)

- **Idempotency:** ledger `ON CONFLICT (source_type, source_id)`; unique billing-run keys;
  Stripe `idempotency_key` on every API write.
- **Audit:** every write RPC INSERTs `audit_events` (Hard Rule #9).
- **Guardian routing:** a child's charge/invoice routes to the guardian's customer + email.
- **Permissions:** bulk invoicing / price change / refund gated on `manage_memberships`
  (venue token = anon backdoor, auth enforced inside — grant anon, per venue_* RPC gotcha).
- **Pro-rating convention:** one engine, two surfaces — `_prorated_first_charge` for our
  ledger, Stripe `proration_behavior` for live subs; both honour mig-393 Option A
  (round up, member's favour) so a member never sees two different numbers.
- **Migration source in same commit as live apply** (Hard #11). Confirm next free mig off
  `main` each phase. Update SCHEMA/RPCS/DECISIONS/FEATURES/BUGS per phase.

---

## NEXT-SESSION KICKOFF PROMPT (paste-ready) — PHASE 3

```
Read STRIPE_FULL_BUILD_HANDOFF.md in full (Phases 1 + 2 are SHIPPED+MERGED — Phase 1 mig 403
PR #69, Phase 2 mig 404 PR #71 — read their delivered lists), then RPCS.md + SCHEMA.md
(venue_charges incl source_type CHECK + UNIQUE(source_type,source_id,COALESCE(team_id,'')),
venue_payments incl kind/method/external_ref/voided_at, venue_memberships, venue_membership_tiers
+ venue_tier_prices, member_profiles/member_guardians, stripe_customers, _prorated_first_charge
mig 393), then BUGS.md head. We are building the full Stripe payments platform phase-by-phase,
one phase shipped + merged before the next (cloud-session discipline). Built/tested on the TEST
keys already in place; LIVE keys are Phase 7 only — NO code path may assume live keys.

START PHASE 3 (mass invoicing — the headline operator action, scope #6 + #7 + #8 + #18). First
CONFIRM next free mig off main (should be 405; local main may be stale — check origin/main).
Then run a full AUDIT -> EXECUTE -> VERIFY -> COMMIT cycle (skills/audit.md FIRST, report before
editing). AUDIT how venue_charges/venue_payments are created + voided today (reuse venue_record_payment
/ venue_void_payment / _recompute_charge_status patterns, mig 181) and how _prorated_first_charge
works BEFORE designing anything.

- mig 405 — bulk one-off charge engine + a new venue_billing_runs table (who/what/when/totals/
  status) with a run_id on the charges it creates:
  - venue_bulk_charge_preview(token, cohort, amount, due_date, ...) -> every member in the cohort
    (team / tier / whole club) with status: will-invoice OR auto-skip + reason (already-paid|paused|
    left). READ-only preview.
  - venue_bulk_charge_commit(token, run spec, excluded_ids[]) -> one venue_charges row per INCLUDED
    member; idempotent per run key; writes the billing_run record. (WRITE -> EV required.)
  - venue_void_billing_run(token, run_id) -> soft-void the whole run, mirroring the venue_payments
    void pattern. (WRITE -> EV required.)
  - Pro-rated mass invoicing (#18): reuse _prorated_first_charge (mig 393, Option A round-up) for
    late joiners in a season-fee run — ONE pro-rating engine, do not reinvent.
  - All write RPCs: SECDEF, search_path pinned, gated on manage_memberships, audited (Hard Rule #9),
    venue-token path = grant anon + authenticated (auth enforced inside via resolve_venue_caller —
    the venue_* RPC gotcha; mig-175 authenticated-only applies ONLY to auth.uid()-only RPCs).
  - Stripe Invoices for online-payable charges (#7): when "let them pay online" is on, create a
    Stripe INVOICE per member on the connected account using the Phase-1 reused customer
    (get_or_link_stripe_customer), finalize it, Stripe emails the hosted pay page; the invoice.paid
    webhook (already wired Phase 1 via stripe_record_invoice_payment) marks the ledger charge paid.
    Use a Stripe idempotency_key per (run, member). TEST keys only.
- UI: apps/venue Payments (+ consumer coach "Subs & payments" roster IF it touches src) — a 4-step
  wizard: (1) cohort w/ live count, (2) charge label+amount+due date+pay-online toggle, (3)
  INTERACTIVE preview (tick/untick individuals, auto-skips locked w/ reason, running total), (4)
  type-to-confirm total -> Send. Plus a billing-run list with Void-run.

GATES: rpc-security-sweep (3 new write RPCs); ephemeral-verify (own _e2e_ cohort:
preview -> commit -> void -> leak-check 0; assert auto-skip reasons + idempotency + pro-rated
late-joiner amount); build + hygiene (apps/venue = hand-check hex, no token vars); casual-regression
ONLY IF the consumer roster touches apps/inorout/src; Playwright wizard smoke + Stripe test-mode
invoice paid -> reconciled walk. Update RPCS/SCHEMA/DECISIONS/BUGS/FEATURES same commit; then
PR -> merge to main before Phase 4.

NOTE: Phase 2 deferred season one-off (mode=payment) Stripe payments to here — once Phase 3's
Stripe Invoice path + reconciliation lands, confirm those one-offs reconcile into the ledger too.
```
