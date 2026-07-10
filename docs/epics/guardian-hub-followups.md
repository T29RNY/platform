# Epic: Guardian /hub follow-ups (on-device walk findings, 2026-07-10)

Source: operator on-device authed guardian walk after the Team privacy fix (#434).
Reference tenant: PA Sports. Guardian = child-proxy (`child_profile_id`), multi-child aware.
Run via `/dev-loop` per phase. **Plan gate: batched. FULL AUTONOMY GRANTED (operator,
2026-07-10): "proceed through its build apply and merges, overriding the hard rule, you
have full autonomy… to plow through the remaining PRs."** → I self-apply migrations + merge
PRs; the human tier-3 sign-off gate is waived by explicit operator grant. I STILL run every
automated quality/safety proof (build, lint, hygiene, rpc-security, ephemeral-verify+rollback,
QA+security reviews, casual-regression, leak-check) and keep every migration additive +
reversible + non-destructive. Two hard external blockers remain (NOT overridable by me):
Stripe live keys/Connect (P12 — credentials I don't have; wire+hand off) and on-device authed
walks (app behind login). Reuse over new systems; keep desktop⇄mobile in sync.

Universal lessons (apply every phase): nav must clear the docked nav / new modals use the
shared `MobileSheet` ([[reference_hub_sheet_nav_ios_stacking]]); reuse the guardian_* / desktop
data contract ([[feedback_mobile_reuses_desktop_data_contract]]); tappable tiles / row-tap detail;
STRICT aggregate-only privacy for other children.

Next free migration = **532** (re-confirm off main before taking a number).

## Product decisions (operator, 2026-07-10)
1. Holiday camps = a **real feature**, built on the **existing classes engine** (reuse
   create→target→book→pay→guardian-surface; add a "camp" flavour) — NOT a new subsystem.
   Owners/admins create on desktop AND app (club-admin `/hub`) → make available to **all or a
   cohort** → guardians **book + pay**. Multi-child aware. Camp needs a **VENUE** — either a
   pre-registered location OR a **brand-new location** (create inline). Camp fields: date, time,
   information, **dietary**, **pick-up & drop-off** (time/location), + any other relevant.
2. Detail = **street address (text), not a map**.
3. Pay-now: add the fast-path now **and** wire ready for Stripe go-live (yes to Stripe Phase 7).
4. Coach/admin per-player doc-status: **both** surfaces (desktop venue lens + coach /hub); reuse
   desktop if it exists (audit: it does NOT — new reader needed).
5. Reminders: **email + push**; yes to Stripe.

## Phases

| # | Phase | Tier | Deps | Status | Stops for human |
|---|-------|------|------|--------|-----------------|
| 1 | Schedule crash (infinite render loop) + app-wide error boundary | 1 | — | **DONE** (#435 merged) | merge (done) |
| 2 | Sessions tab rebuild: rename Matches→Sessions, blend training, month in date, tappable session/fixture detail sheet (name+location/address text already returned), "See all fixtures/training →" | 1 | — | **DONE** | merge |
| 3 | League: tiles → month-grouped tappable rows + detail sheet (fields already returned) | 1 | — | **DONE** | merge |
| 4 | Team name in header ("Arjan · Earlsdon Lions U7"), multi-team aware (reuse `guardian_list_child_team`) | 2 | — | **DONE** | merge |
| 5 | Membership Pay-now: desktop `existingUrl` fast-path (open `charge.pay_url`) + wire Stripe checkout path ready for go-live | 1 | — | **DONE** | merge |
| 6 | Guardian EDIT medical/emergency (backend `member_update_child` exists; swap read-only review for edit form) | 2 | — | **DONE** | merge |
| 6b | Audit-flag fidelity: `member_update_child` should flag `medical_updated` when dietary_notes/send_notes/consent_administer_medication change (special-category). SQL-only. | 3 | — | **DONE (mig 532 APPLIED)** | merge |
| 7 | League detail rich fields: `guardian_list_child_leagues` +venue_name/venue_address/ref_name (fixtures) + kickoff/pitch/venue/address/ref (results) | 3 | 3 | **DONE (mig 533 APPLIED)** | merge |
| 8 | Fixture detail address: `guardian_list_child_fixtures` +venue_address (HOME venue). ⚠️ AWAY has no data (opponent ground not stored — free-text opponent only); documented limitation | 3 | 2 | **DONE (mig 533 APPLIED)** | merge |
| 9 | **Holiday Camps feature** (big, multi-sub-phase): schema (reuse venue_class infra or new camp type) · desktop create (apps/venue) · app owner/admin create (/hub) · all-or-cohort targeting · guardian book+pay (reuse `guardian_book_class_session` pattern) · surface in Sessions tab | 3 | 2 | pending | **apply(×N)** + merge(×N) |
| 10 | Coach/admin/owner per-player **doc-status** reader (LEFT JOIN consent_acceptances + member_id_documents + member_record_reviews per club member) + desktop venue-club-lens surface + coach /hub surface | 3 | — | pending | **apply** + merge |
| 11 | Payment **reminders** cadence: `get_membership_reminders_due` filter → due−7/−1/0, offset-aware dedup key, email templates + **push** channel, cron | 3 | — | pending | **apply** + merge |
| 12 | Stripe Phase 7 **go-live** (live keys + Connect + webhook) — OPS/human; draft+verify only, I can't set live credentials | 3 | 5 | pending | **human ops** |

## Log
- 2026-07-10 P1 DONE — #435 merged live. GuardianSchedule dep stabilised + ErrorBoundary. On-device authed guardian walk owed (auth-gated).
- 2026-07-10 P2 DONE — Sessions tab: rename, blend Matches/Training/Camps, month dates, tappable detail sheet (MobileSheet), "See all fixtures/training →" deep-link to filtered Schedule. Reused readers only, selfMode kept fixtures-only. QA PASS. On-device walk owed.
- 2026-07-10 P3 DONE — League Fixtures/Results: tiles → month-grouped compact rows (JULY 2026 headers), each tappable → MobileSheet detail (opponent/H-A/date/kickoff/pitch/score). Client-only, mig-428 fields only (venue/ref = P7). QA PASS vs RPC SQL. On-device walk owed.
- 2026-07-10 P4 DONE (#438) — header subline shows the active child's team (multi-team "Team +N"), reuse guardian_list_child_team, role-guarded, no stale flash. QA PASS.
- 2026-07-10 P5 DONE — Pay-now fast-path: open `charge.pay_url` (server-provided, ^https-validated, caller-scoped) before the dormant Stripe endpoint, mirroring desktop MemberProfile. Works now for manual/bank links; card checkout still awaits Stripe Phase 7 (P12). QA+Security PASS. FOLLOW-UP (backlog): add a `^https?:` scheme allowlist to the shared `native/open-external.js` (defense-in-depth; sources already trusted).
- 2026-07-10 P7+P8 DONE — mig 533 APPLIED-live: guardian_list_child_leagues fixtures/results +venue_name/venue_address/ref_name (+kickoff/pitch on results); guardian_list_child_fixtures +venue_address. HOME-venue only (club_fixtures stores home playing_area→venue; AWAY opponent is free-text w/ NO stored ground → venue_* NULL, honest). Additive, EV-proven (venue+address+ref populate) + leak-0. Client: League detail + Matches detail show Venue/Address/Referee. On-device walk owed.
- 2026-07-10 P6 DONE — guardian medical/emergency review sheet now EDITABLE (was read-only): ec1/ec2 contacts + dietary_notes + send_notes + 2 consents, saved via existing `member_update_child` (whitelist update → detailed medical fields preserved, no data loss) + `guardian_confirm_record_review`. Backend reused, no migration. QA+Security PASS (guardian-gated, no IDOR/injection, audited). NOTES: (a) old read-only `KV` helper now dead code (tiny cleanup owed); (b) detailed medical fields (conditions/allergies/medications/gp) not surfaced — parity follow-up needs the mig-431 snapshot enriched; (c) → P6b audit-flag fidelity. On-device walk owed.
