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
| 4 | Team name in header ("Arjan · Earlsdon Lions U7"), multi-team aware (reuse `guardian_list_child_team`) | 2 | — | pending | merge |
| 5 | Membership Pay-now: desktop `existingUrl` fast-path (open `charge.pay_url`) + wire Stripe checkout path ready for go-live | 1 | — | pending | merge |
| 6 | Guardian EDIT medical/emergency (backend `member_update_child` exists; swap read-only review for edit form) | 2 | — | pending | **sign-off** (special-category data) + merge |
| 7 | League detail rich fields: `CREATE OR REPLACE guardian_list_child_leagues` add venue_name/ref_name (fixtures) + kickoff/pitch/venue (results) — joins proven in mig 426 | 3 | 3 | pending | **apply** + merge |
| 8 | Session/fixture detail ADDRESS: surface away-venue street address on fixtures (`guardian_list_child_fixtures` field-add); sessions already carry `location`/`opponent_address` | 3 | 2 | pending | **apply** + merge |
| 9 | **Holiday Camps feature** (big, multi-sub-phase): schema (reuse venue_class infra or new camp type) · desktop create (apps/venue) · app owner/admin create (/hub) · all-or-cohort targeting · guardian book+pay (reuse `guardian_book_class_session` pattern) · surface in Sessions tab | 3 | 2 | pending | **apply(×N)** + merge(×N) |
| 10 | Coach/admin/owner per-player **doc-status** reader (LEFT JOIN consent_acceptances + member_id_documents + member_record_reviews per club member) + desktop venue-club-lens surface + coach /hub surface | 3 | — | pending | **apply** + merge |
| 11 | Payment **reminders** cadence: `get_membership_reminders_due` filter → due−7/−1/0, offset-aware dedup key, email templates + **push** channel, cron | 3 | — | pending | **apply** + merge |
| 12 | Stripe Phase 7 **go-live** (live keys + Connect + webhook) — OPS/human; draft+verify only, I can't set live credentials | 3 | 5 | pending | **human ops** |

## Log
- 2026-07-10 P1 DONE — #435 merged live. GuardianSchedule dep stabilised + ErrorBoundary. On-device authed guardian walk owed (auth-gated).
- 2026-07-10 P2 DONE — Sessions tab: rename, blend Matches/Training/Camps, month dates, tappable detail sheet (MobileSheet), "See all fixtures/training →" deep-link to filtered Schedule. Reused readers only, selfMode kept fixtures-only. QA PASS. On-device walk owed.
- 2026-07-10 P3 DONE — League Fixtures/Results: tiles → month-grouped compact rows (JULY 2026 headers), each tappable → MobileSheet detail (opponent/H-A/date/kickoff/pitch/score). Client-only, mig-428 fields only (venue/ref = P7). QA PASS vs RPC SQL. On-device walk owed.
