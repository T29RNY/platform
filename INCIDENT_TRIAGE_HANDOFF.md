# Incident Triage — build manifest

> **Trigger (paste-ready):** `/loop /dev-loop INCIDENT_TRIAGE_HANDOFF.md`
> Plan gate: batched · Merge mode: per-phase · Scoped by `/scope` 2026-07-01 (8-lens fan-out + judge).
> Builds on the EXISTING venue `incidents` system (migs 231 / 437 / 171) — this is an
> additive triage layer, NOT a new system. Supersedes no prior handoff (none existed).

---

## WHAT IT IS

Today a venue incident (flooded changing room, floodlight fault, a fight, an on-pitch
injury) can be **logged** (`venue_log_incident`, mig 231) and **resolved** (`venue_resolve_incident`
231/437 · `hq_resolve_incident` 171) — but nothing in between. The queue is binary
open/resolved: no category, no owner, no priority, no aging, no way to escalate a serious
one up to HQ. Front-of-house staff on the night have to radio around to find who handles
it; the venue manager next day can't audit what happened; HQ can't triage across venues.

**Incident Triage** adds the missing middle. Option D — **one incident record, triaged at
the venue, escalatable to HQ**:

- **Venue operator owns the queue** (apps/venue desktop + apps/inorout mobile
  OperationsTonight): categorise it, assign it to a colleague, set a priority, acknowledge
  it ("I'm on it"), and — if it's beyond them — **escalate to HQ**.
- **HQ gets a cross-venue escalation inbox** (apps/hq): the incidents venues have pushed
  up, region-scoped, resolvable in place.
- **Safeguarding is designed-for but NOT built.** The record reserves a `safeguarding`
  category value and the scope leaves a clean RLS-visibility seam, but Phase 1 ships an
  explicit **"not for safeguarding — use your safeguarding route"** notice so the
  operational queue can never silently swallow a child-protection disclosure.

The win: staff know who owns each incident and how urgent it is; managers get an auditable
trail; HQ sees the serious ones without reading every venue's free-text log.

---

## LOCKED DECISIONS (assumptions carried forward — flag if any is wrong)

1. **Option D** — venue-owned queue, HQ-escalatable, one shared `incidents` row. *(Operator
   confirmed 2026-07-01, chose future-proofing → D.)*
2. **No `status` enum — lifecycle is derived from timestamp columns.** `resolved_at` stays
   the single source of truth for open/closed (unchanged). "Acknowledged" and "escalated"
   are their own nullable timestamps (`acknowledged_at`, `escalated_at`). This avoids a
   dual-source-of-truth between `status` and `resolved_at` (the result-save-invariant
   class of bug) and matches the codebase idiom (lifecycle = timestamps, not enums).
   *Open = `resolved_at IS NULL` — the existing filter is untouched.*
3. **Resolve RPCs are NOT modified.** `venue_resolve_incident` / `hq_resolve_incident`
   keep their exact signatures and still set `resolved_at`. No DROP/recreate, no
   `closed_reason` param (that was lens scope-creep — cut). New columns are additive reads
   only. This keeps the blast radius tiny.
4. **Priority is a 4-value text enum** `('low','normal','high','urgent')` default `'normal'`
   — NOT a 1–10 numeric score. Simpler for the UI; an AI consumer reasons over 4 ordinals
   fine. Priority is orthogonal to `severity` (severity = impact set at log time; priority
   = triage urgency).
5. **Assignment now, no hard FK.** `assigned_to uuid` nullable, validated in the RPC
   against `venue_admins` for the caller's venue — NOT a DB FK to `auth.users` (this
   codebase avoids auth-schema FKs; a hard FK breaks on account delete).
6. **GDPR cleanup is in-scope for the schema PR.** `incidents.reported_by` / `resolved_by`
   already orphan on account deletion (no cascade today); `assigned_to` would add a third.
   The schema PR extends the `delete_my_account*` RPCs to NULL these three refs. *(Safety
   lens ship-gate.)*
7. **Safeguarding NOTICE ships in Phase 1; the safeguarding MODULE does not.** Reserve
   `'safeguarding'` in the category CHECK; do not build `is_safeguarding_flagged`/RLS
   visibility yet. *(Safety lens ship-gate — deferral is only defensible WITH the notice.)*
8. **HQ resolve reuses the existing `hq_resolve_incident`** (unchanged). Escalation adds a
   dedicated cross-venue read RPC; it does not change how HQ closes an incident.
9. **Merge mode per-phase, human-gated.** Every migration apply and every deploy stops for
   the operator (this codebase pre-authorises nothing here).

**Open product questions (answer at PR-time, non-blocking — sensible defaults chosen):**
- Assignment notification (push/email to the assignee) → **out of Phase 1** (defer to the
  broadcast-composer cycle; assignee sees it on next refresh).
- Auto-escalation on SLA breach → **out** (manual escalate button only; `escalated_at`
  timestamp lays the seam for a later cron).
- Can staff self-assign vs manager-only → **default: any venue admin can assign** (incl.
  self); tighten later if operators ask.

---

## KEY AUDIT FACTS (load-bearing — do not re-derive)

- **Next free migration = `461`.** Highest file on main = `459`; **`460` is reserved** by
  the unbuilt per-game per-week-settle PR (`PER_GAME_PAYMENT_MARKING_HANDOFF.md`). Numbers
  are first-come on main (CLAUDE.md cloud-session discipline) — re-confirm the next free
  number at build time and take it.
- **`incidents` table today** (SCHEMA.md ~L547): `id, venue_id, fixture_id(nullable),
  reported_by(nullable), description, severity(info/warning/critical), resolved_at,
  resolved_by, resolution_note, outcome(fixed/safe/contractor/nofault, mig 437), created_at`.
  RLS enabled; direct client access REVOKED — all access via SECDEF RPCs.
- **Existing RPCs (reuse, mostly untouched):**
  - `venue_log_incident(p_venue_token, description, severity, fixture_id?)` — mig 231, anon+auth, audits `incident_flagged`, `notify_venue_change('incident_flagged')`.
  - `venue_resolve_incident(p_venue_token, incident_id, outcome?, note?)` — mig 231/437. **UNCHANGED.**
  - `hq_resolve_incident(p_company_id, incident_id, note)` — mig 171, auth-only, analyst rejected, region-scoped. **UNCHANGED.**
- **Read RPCs that carry `open_incidents` (need additive fields + HR12 mappers):**
  `venue_get_state` (mig 250 — builds `open_incidents[]`), `hq_get_venue_detail` (mig 171),
  `hq_get_company_state` (mig 171 — counts only, internal filter unchanged since open still
  = `resolved_at IS NULL`).
- **Wrappers** live in `packages/core/storage/supabase.js`: `venueLogIncident`,
  `venueResolveIncident` (~L4380), `hqResolveIncident` (~L2372). New wrappers append here +
  barrel-export from `packages/core/index.js`.
- **UI surfaces to touch:** apps/venue `views/Operations.jsx` + `views/IncidentActions.jsx`
  (desktop); apps/inorout `src/mobile/screens/OperationsTonight.jsx` (native — Hard Rule 13);
  apps/hq `views/VenueDetail.jsx` (+ optional `views/AlertsActions.jsx` badge). UI/UX lens:
  ~130 lines of new components, 11 existing patterns reused, zero breaking changes.
- **Realtime (Hard Rule 10):** add `'incident_triaged'` + `'incident_escalated'` to the
  `notify_venue_change` whitelist; confirm the apps/venue + mobile `venue_live` subscriber
  refetches on them. HQ escalation refetch can piggyback the same venue channel in Phase 1
  (a dedicated `company_live` channel is a future nicety, NOT required now).
- **Audit (Hard Rule 9):** every new write RPC INSERTs `audit_events` — new actions
  `incident_triaged`, `incident_escalated` (actor_type `venue_admin`, team_id = venue_id).
- **Deploys:** apps/venue = **manual** prebuilt-static (not auto); apps/hq = its own deploy;
  apps/inorout = auto on push but **native = real-iPhone walk before merge** (HR13).
- **Ship-safety:** whole epic is **tier-2 / CLEAR** except PR5 (native mobile — App-Store
  awareness, treat as PROTECTED for the on-device gate). No auth/money/RLS-policy changes in
  Phase 1 (the safeguarding RLS policy is explicitly deferred).

---

## ROADMAP — PRs in dependency order

### PR #1 — Schema + GDPR cleanup (mig 461)  ·  TIER-2 · CLEAR · effort S
Additive columns on `incidents`, all nullable / defaulted → existing rows byte-identical:
`category text CHECK (category IS NULL OR category IN ('facility','equipment','safety','medical','conduct','security','weather','safeguarding','other'))`,
`priority text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'))`,
`assigned_to uuid`, `acknowledged_at timestamptz`, `escalated_at timestamptz`,
`escalated_by text`, `escalation_reason text`. Partial indexes for the queue
(`(venue_id, priority, created_at) WHERE resolved_at IS NULL`) and escalation inbox
(`(escalated_at) WHERE escalated_at IS NOT NULL AND resolved_at IS NULL`). **GDPR:** extend
`delete_my_account` + `delete_my_account_auth` to `SET reported_by/resolved_by/assigned_to =
NULL` for the deleted user — sketch (verify live bodies before CREATE OR REPLACE; both are
SECDEF, `delete_my_account(p_token)` + `delete_my_account_auth()`):
```sql
-- inside each delete RPC, alongside the existing player/team ref cleanup, before the auth delete:
UPDATE public.incidents SET reported_by = NULL WHERE reported_by = v_user_id;
UPDATE public.incidents SET resolved_by = NULL WHERE resolved_by = v_user_id;
UPDATE public.incidents SET assigned_to = NULL WHERE assigned_to = v_user_id;
```
Write `461_incident_triage.sql` + `461_incident_triage_down.sql` (down = drop columns/indexes; the delete-RPC UPDATEs are harmless to leave, but revert them for cleanliness).
- Gates:  🚦 migration apply (human) · schema-sync.md · build clean.
- **Done:** columns exist (check-db-schema incidents); down-migration drops cleanly; existing incidents unchanged; delete-account NULLs verified.

### PR #2 — Venue triage write RPCs (mig 461 cont.)  ·  TIER-2 · CLEAR · effort M
`venue_triage_incident(p_venue_token, p_incident_id, p_category?, p_priority?, p_assigned_to?, p_acknowledge?)`
— sets any provided triage field + `acknowledged_at` when `p_acknowledge`; scoped
`WHERE venue_id = <resolved> AND resolved_at IS NULL`; validates `assigned_to` ∈ this
venue's `venue_admins`; audits `incident_triaged`; `notify_venue_change('incident_triaged')`.
`venue_escalate_incident(p_venue_token, p_incident_id, p_reason?)` — sets `escalated_at=now()`,
`escalated_by`, `escalation_reason`; idempotent (raise if already escalated); audits
`incident_escalated`; notify. Both SECDEF, `search_path` locked, REVOKE PUBLIC + GRANT
anon+authenticated (parity with mig 231 — explicit grants, VC-sweep skips them). Wrappers +
barrel export. Add both new actions to the `notify_venue_change` whitelist.
- Gates:  🚦 ephemeral-verify (seeds `_e2e_` incident, triages + escalates, asserts fields + audit, rollback, leak-check 0) · 🚦 rpc-security-sweep · build clean.
- **Done:** EV green + 0 leak; each raw RPC name in exactly ONE `supabase.rpc()`; sweep PASS (SECDEF, search_path, grants, audit, cross-venue write blocked).

### PR #3 — Read-shape additions + HQ escalation inbox RPC (mig 461 cont.)  ·  TIER-2 · CLEAR · effort M
Extend `open_incidents[]` in `venue_get_state` **and** `hq_get_venue_detail` with the new
fields + `assigned_to_name` (HR12 — update the inline mappers in `supabase.js` the SAME
commit; grep the field names to confirm they land in BOTH the RPC body AND the mapper). New
read RPC `hq_list_escalated_incidents(p_company_id, p_date_from?, p_date_to?)` → escalated,
still-open incidents across the company's venues (`venue_name`, category, priority,
`escalated_at`, `escalation_reason`, `assigned_to_name`), region-scoped, **analyst allowed
(read-only)**. Record HR14 consumers in RPCS.md Notes now: *Venue Ops (live), HQ escalation
(live), Gaffer AI (future — incident-risk context), HQ analytics (future), reception display
(future).*
- Gates:  🚦 rpc-security-sweep (new read RPC) · check-rpc-consumers advisory · build clean.
- **Done:** new fields visible via wrappers; `hq_list_escalated_incidents` region + analyst-read behaviour proven; RPCS.md consumer row present; no consumer of the old shape breaks.

### PR #4 — Venue desktop triage UI (apps/venue)  ·  TIER-2 · CLEAR · effort M
`Operations.jsx` incident list → triage queue: category + priority + assignee + aging
badges; inline **Assign / Escalate** actions; filter chips (severity/priority). Reuse
`.issues-row`, `.pill-*`, `.sev-*`, `.btn-xs`. `IncidentActions.jsx` gains the assign +
escalate calls. **Add the "not for safeguarding — use your safeguarding route" notice** on
the report + resolve flow (safety ship-gate). Optimistic UI + revert on error.
- Gates:  build venue clean · hygiene 7/7 · Playwright smoke (demo) · ⛔ **venue manual deploy** (human).
- **Done:** triage a demo incident (assign, set priority, escalate) end-to-end; safeguarding notice visible; 0 console errors; deployed + eyeballed.

### PR #5 — Mobile triage UI (apps/inorout OperationsTonight)  ·  TIER-2 · PROTECTED (native) · effort M
Fast front-of-house triage on the night: 3 orthogonal one-tap actions per incident
(**Acknowledge / Assign / Escalate**) above the existing resolve bottom-sheet; assignee
picker from cached venue staff; big tap targets, minimal typing. Reuse `MobileSheet`,
`m-card`, `m-icon-btn`. Same safeguarding notice. Reuses PR#2 RPCs — no new backend. *(App-Store privacy metadata:
N/A — no new data collection; triage state is operator-entered venue data, no new tracking.)*
- Gates:  🚦 casual-regression (prove the casual/non-operator flow is untouched — new columns are additive-NULL there) · 🚦 **real-iPhone walk (Hard Rule 13)** — acknowledge/assign/escalate/resolve all persist across reload, no tap-does-nothing · build inorout clean.
- **Done:** on-device walk passes all four actions with reload-verify; casual-regression PASS; 0 console errors.

### PR #6 — HQ escalation inbox UI (apps/hq)  ·  TIER-2 · CLEAR · effort M
`VenueDetail.jsx` open-incidents panel → split "Open" / "Escalated" (Escalated reads
`hq_list_escalated_incidents`, shows reason + assignee + escalated-age); resolve reuses
existing `hq_resolve_incident`. Optional: an escalation count badge in `AlertsActions.jsx`.
Reuse HQ's own `.list-row` / `.badge.*` system.
- Gates:  build hq clean · hygiene · Playwright smoke (empty + populated) · ⛔ **HQ deploy** (human).
- **Done:** escalated tab renders company-scoped incidents; HQ resolve closes one; empty-state clean; deployed + eyeballed.

---

## 🚦 GATES the loop must stop at (human sign-off)

1. **PR #1** — migration 461 apply (schema + delete-account change).
2. **PR #2** — ephemeral-verify + rpc-security-sweep on the two new write RPCs.
3. **PR #3** — rpc-security-sweep on the new HQ read RPC.
4. **PR #4** — venue manual deploy.
5. **PR #5** — real-iPhone on-device walk (Hard Rule 13) + casual-regression.
6. **PR #6** — HQ deploy.

**Expected stops: 6 of 6 PRs pause for the operator** — 1 migration apply, 2 proof gates
(EV/rpc-sec), 3 deploy/device gates. None auto-merge; none apply a migration without you.

---

## DONE =

Venue staff can, on desktop and on the phone, take an open incident and **categorise it,
assign it to a colleague, prioritise it, acknowledge it, and escalate it to HQ**; HQ sees a
region-scoped **escalation inbox** and can resolve from it; every triage/escalate action is
audited server-side; existing log/resolve paths and the casual flow are provably unchanged;
the **safeguarding notice** is live on both report surfaces; and account-deletion no longer
orphans incident references. Safeguarding module, auto-escalation, and assignee
notifications are explicitly deferred with clean seams in place.

---

## BUILD LOG
- **PR #1 — Schema + GDPR (mig 461)** — ✅ **DONE / APPLIED LIVE 2026-07-01.** Columns + 2 indexes live; `delete_my_account`/`delete_my_account_auth` extended to NULL incident refs (reproduced verbatim from live + 3 UPDATEs). Proof: RPC-security PASS, QA+Security review CLEAN (byte-for-byte live diff), build PASS, **ephemeral-verify PASSED** (`ROLLBACK_TESTS_PASSED`, leak-check 0). Source committed same-commit as apply (HR11). PR: <pending>.
- PR #2–#6 — pending (deps: #2 needs #1 done ✅).

## Related
Builds on the venue `incidents` lifecycle (migs 231 / 437 / 171) and the apps/hq Phase-6
layer. Future consumers seamed per Hard Rule 14: Gaffer AI (`GAFFER.md` — an
`gaffer_get_incident_risk_context` read), HQ analytics, reception display. Safeguarding
follow-up → BUGS.md / GO_LIVE_ISSUES.md (RLS-visibility gate recorded by the security lens).
