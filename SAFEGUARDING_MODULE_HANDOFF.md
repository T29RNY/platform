# Safeguarding Module — build manifest (Incident Triage Phase 2)

> **Trigger (paste-ready):** `/loop /dev-loop SAFEGUARDING_MODULE_HANDOFF.md`
> Plan gate: batched · Merge mode: per-phase · Scoped by `/scope` 2026-07-01 (8-lens fan-out + judge).
> Builds on the **merged + deployed** Incident Triage Phase 1 (migs 461/462/464/465).
> ⚠️ **This manifest has a HUMAN/LEGAL PREREQUISITE GATE (Phase 0) that must clear
> BEFORE any code PR runs.** `dev-loop` cannot satisfy it. See Phase 0 below.
> Whole epic is **TIER-3 / PROTECTED end-to-end** — every PR is human-gated, no auto-merge.

---

## WHAT IT IS

Phase 1 shipped venue incident *triage* and reserved a `'safeguarding'` category value plus a
**"not for safeguarding — use your safeguarding route"** notice, so the operational queue can
never silently swallow a child-protection disclosure. It deliberately did **not** build the
safeguarding module. **Phase 2 builds it** — as a *routing / hand-off* tool, not a case store.

The job: when front-of-house staff receive a welfare/child-protection concern, they **flag it in
one tap**. Flagging **removes the incident from every ordinary operational view** (venue desktop
queue, mobile OperationsTonight, HQ escalation inbox, all counts/health tiles) and makes it
visible **only to a designated Safeguarding Lead** — mirroring the real-world DSL / Club Welfare
Officer process (CPSU/NSPCC). Non-leads — including venue owners/managers who aren't designated,
the shared demo token, HQ analysts, and the future Gaffer AI — **cannot see flagged incidents at
all**. The Lead reviews them in a private, separately-gated Safeguarding view and closes them.

**v1 is deliberately minimal (scope (a), "flag + route"):** it stores a boolean flag, who flagged
it, and when — **NO free-text disclosure narrative**. The substance of the concern lives with the
human Lead through their own safeguarding procedure; the app routes and restricts, it does not
become the investigation record. This keeps In or Out a *processor of a pointer*, not a controller
of unminimised special-category child data (UK GDPR Art. 9) — the only version defensible without
a full DPIA-gated case-management build.

The win: a scared 19-year-old on a Friday night turns "I'm holding something I can't handle" into
"it's the Lead's problem now, confidentially, and there's proof I acted" — with one tap, no triage
judgement, and no colleague able to read it.

---

## LOCKED DECISIONS (assumptions carried forward — flag if any is wrong)

1. **Scope (a): lightweight flag + route. NO free-text disclosure field in v1.** Store only
   `is_safeguarding_flagged`, `safeguarding_flagged_by` (actor_ident), `safeguarding_flagged_at`.
   Full case-management (case notes, subjects/witnesses, statutory-referral log) is a **separate,
   DPIA-gated future project (Phase 3)** — must NOT arrive by scope-creep. *(Safety lens — the
   domain authority on special-category minimisation; overrides four other lenses that assumed a
   note field.)*
2. **The flag is the SOLE source of truth for visibility; orthogonal to `category`.** Keep the
   reserved `'safeguarding'` category value as a soft descriptive hint only. Visibility keys on the
   boolean flag — never on a category enum (a rename/typo would silently un-restrict). *(No
   dual-source-of-truth — the same discipline as `resolved_at` vs a status enum, Phase-1 LD#2.)*
3. **Any operator can FLAG; only Leads can SEE / ACTION.** Flagging is the low-friction one-way
   door *into* safeguarding (front-of-house must be able to route a disclosure they can't handle).
   Viewing, un-flagging, and resolving a flagged incident are **Lead-only**. *(Security +
   target-user consensus; the effort lens's "lead-only flag" is rejected — it defeats the JTBD.)*
4. **Lead designation reuses `venue_admins.caps_grant` — but with a grant-only gate that does NOT
   inherit the owner/manager default-pass.** Add `'safeguarding_lead'` to the `venue_admins_caps_known`
   CHECK. A **new** helper `_venue_is_safeguarding_lead(actor_ident, venue_id)` checks
   `'safeguarding_lead' = ANY(caps_grant) AND NOT ANY(caps_deny)` — **role-independent**. It must
   NOT route through `_venue_has_cap` (which short-circuits `owner ⇒ true, manager ⇒ true` BEFORE
   grants — a naive cap would auto-expose every owner+manager). Designation is done through the
   **existing `update_venue_admin` staff screen** → **no new lead-designation RPCs**. *(Technical +
   security reconciled.)* **Consequence, by design:** the legacy shared `venue_admin_token` (Stage 1,
   resolves as owner with empty caps, no user identity) is **structurally never a Lead** → blind to
   safeguarding. Correct posture; note it weakens self-test on the demo backdoor.
5. **Filter placement — Option (c): ops/HQ reads UNCONDITIONALLY exclude flagged rows; Leads served
   by a separate dedicated RPC.** The four existing reads get a one-line `AND i.is_safeguarding_flagged
   IS NOT TRUE` and nothing else (no lead branch, no shape change → **zero HR12 mapper churn**, since
   `open_incidents[]` is pass-through JSON with no mapper). A new `venue_list_safeguarding_incidents`
   (Lead-only) returns flagged rows. Flagged incident bodies **never transit a non-lead client**, even
   hidden. *(Technical lens.)*
6. **Flagging atomically evicts the incident from the ops queue** — clears `assigned_to`,
   `acknowledged_at`, `escalated_at`, `escalated_by`, `escalation_reason`; prior state preserved in
   `audit_events` metadata (structural facts only, never content). To every ops/HQ surface it looks
   exactly as if the incident vanished. **⚠️ SEE OPEN QUESTION #1** (the ops-safety-response tension —
   this is the one genuinely unresolved design fork).
7. **Read-access is audited, not just writes.** Every Lead *read* of the safeguarding list writes an
   `audit_events` row (who looked, which venue, when) — stronger than Hard Rule 9. Child-protection
   records need "who accessed this". *(Safety lens.)*
8. **`delete_my_account*` CARVE-OUT — flagged records SURVIVE subject/reporter self-deletion.** UK
   GDPR Art. 17(3)(b): the erasure right is overridden by the safeguarding legal obligation. Do NOT
   NULL `safeguarding_flagged_by` or destroy a flagged incident on account deletion; retention is
   controller-governed. *This is the OPPOSITE of the Phase-1 GDPR NULL-cascade for ordinary incident
   refs.* *(Safety lens — overrides the data-model lens's "add to the cascade".)*
9. **Realtime uses a neutral, non-naming reason.** The shared `venue_live` broadcast reaches every
   connected client incl. non-leads; a `reason:'safeguarding_*'` string is itself a leak. Fire a
   generic refetch reason so ops queues refresh and the row correctly disappears without naming why.
   Payload is `{type,reason,at}` only — no content on the wire. *(Security + technical.)*
10. **HQ safeguarding oversight is OUT of Phase 2.** Flagged incidents are simply excluded from ALL
    HQ reads (detail, escalation inbox, `hq_get_company_state` counts + health tiles). A company/
    regional Safeguarding Lead is a documented seam for Phase 2b — `resolve_company_caller` has no
    slot for it today and building it speculatively is a cross-venue child-data liability.
11. **Desktop-first.** The venue-desktop flag action + Lead view ship first. The mobile *flag action*
    ships (front-of-house need) but the mobile *Lead-review view* is a fast-follow, to shrink the
    native/App-Store surface. *(UI + safety.)*
12. **Gaffer AI: `safeguarding` is NEVER a grantable agent domain**, enforced at the `ai_agent_access`
    layer AND the future `gaffer_get_incident_risk_context` RPC hard-codes `viewer_is_lead = false`
    (the agent has no lead branch — flagged content would land durably in `ai_briefings`). Recorded
    now as an HR14 invariant. *(Future-proofing lens.)*

**Open product questions — answer BEFORE / AT build-time:**
- **#1 (design fork, needs a call before P2):** Does flagging **evict the whole incident** (LD#6 —
  simplest, but a fight that ALSO needs first aid loses its operational task from the ops queue), or
  does the operational safety task **stay open + actionable** (non-sensitive fields visible to ops)
  while only the safeguarding concern goes Lead-only? Safety lens favours preserving the ops task;
  security/technical favour clean eviction. **Recommend for v1:** evict (LD#6) + the flag-confirm UI
  prompts *"does this also need an operational response? log it separately"* — but this is the
  operator's call and it changes P2's write RPC.
- **#2 (safety-critical, needs a call before P1):** No-Lead fallback. If a venue has **zero**
  designated Leads, a flag routes to nobody — a black hole worse than Phase 1. **Recommend:** route
  to the venue **owner** (exists by definition) + a loud "designate a Lead" nag; never a dead end.
  Alternative: block flagging until ≥1 Lead exists. Operator/legal call.
- **#3:** Owner auto-Lead? **Recommend NO** — explicit designation only (even the owner must be
  designated). Confirm.
- **#4:** Lead-designation storage — reuse `caps_grant` (LD#4, recommended, no new table) vs a
  dedicated `venue_safeguarding_leads` table (richer grant/revoke audit + clean multi-venue). Confirm
  caps reuse is acceptable, or accept the extra table.

---

## KEY AUDIT FACTS (load-bearing — do not re-derive)

- **Next free migration = `466`** (highest on main = `465`; verified via Glob). First-come on main
  (CLAUDE.md cloud-session discipline) — re-confirm at build time and take it. Phase-1 numbers
  461/462/463 clashed across two same-day sessions (harmless; applied by timestamp) — 464/465 clean.
- **`incidents` table today** (post mig 461, SCHEMA.md L547): `category` CHECK **already includes
  `'safeguarding'`** (reserved, never offered in a picker), `priority`, `assigned_to uuid`,
  `acknowledged_at`, `escalated_at`, `escalated_by`, `escalation_reason`, `resolved_at`, `severity`,
  `outcome`. Open = `resolved_at IS NULL`, no status enum. RLS on; all client access REVOKED; SECDEF
  RPCs only. Partial indexes `idx_incidents_queue` + `idx_incidents_escalation_inbox`.
- **The FOUR incident read paths that leak** (all must exclude flagged rows — the third is easy to
  miss): `venue_get_state.open_incidents[]` (mig 464), `hq_get_venue_detail.open_incidents[]` (464),
  `hq_list_escalated_incidents` (464, **analyst read-allowed**), and **`hq_get_company_state` (mig 171)
  — which has FOUR incident aggregates**: `open_incidents` count, `critical_incidents` count, and the
  two incident clauses in the red/amber `health` CASE. A flagged critical incident bumping a venue's
  health tile to red for a non-lead HQ viewer is a count-channel/existence-oracle leak.
- **Caller resolution:** `resolve_venue_caller(p_token)` returns `(venue_id, actor_type, actor_ident,
  role, caps_grant, caps_deny)`. **It returns NO clean `user_id`** — `actor_ident` is a tagged string
  (`'user_id:<uuid>'` for logged-in staff; `'venue_admin_token:<md5>'` for the shared backdoor, role
  owner, **empty caps, no identity**). The Lead helper must join on the `'user_id:'||uuid` form.
  `_venue_has_cap` (mig 237 L67-73): `owner ⇒ true; deny ⇒ false; grant ⇒ true; manager ⇒ true; else
  false` — **the owner/manager default-pass is the trap** LD#4 sidesteps.
- **Designation reuse:** `update_venue_admin` (mig 238) already writes `caps_grant`/`caps_deny` gated
  on `manage_logins`; adding `'safeguarding_lead'` to the caps whitelist CHECK lets an owner grant it
  through the existing staff screen. **The CHECK change is an `ALTER … DROP/ADD CONSTRAINT` on a live
  table** — grep every hard-coded 5-cap array (mig 238, any UI cap picker) and update same-commit.
- **No mapper to sync (HR12):** `open_incidents[]` is consumed as raw JSON — there is **no
  `dbToIncident`**. Phase-1 PR#3 confirmed "wrappers pass-through." Option (c) reads only *shrink* →
  no consumer reads a new field → no mapper churn. (Only the new Lead-list RPC surfaces new fields.)
- **Wrappers** live in `packages/core/storage/supabase.js` (incident block ~L4452) + barrel in
  `packages/core/index.js`. **Realtime** subscriber confirmed at `apps/venue/src/App.jsx` L171-179
  (refetches `venue_get_state` on any non-booking `venue_live` reason) — a generic refetch correctly
  makes a flagged row vanish from the ops queue with no special handling.
- **Audit (HR9 + LD#7):** new actions `incident_safeguarding_flagged`, `incident_safeguarding_unflagged`,
  `safeguarding_incident_viewed` (read-audit), `safeguarding_lead_designated`/`_removed` (via the
  existing staff screen). `actor_type` from the caller, `team_id = venue_id`. **Never** put a concern's
  detail in audit metadata (audit_events has broad read paths — superadmin/HQ).
- **UI surfaces:** apps/venue `views/IncidentActions.jsx` + `views/Operations.jsx` (the Phase-1
  SafeguardingNotice evolves into the actionable flag control); apps/inorout
  `src/mobile/screens/OperationsTonight.jsx` (NATIVE — Hard Rule 13). Design-system: a violet
  sensitivity accent is available via the **existing `--train: #8B5CF6` token** (venue styles.css) —
  **no new hardcoded hex**; pair with the existing `shield` Phosphor glyph. Reuse `Modal`/`MobileSheet`/
  `toast`/`EmptyState`/`.badge.*`.
- **Ship-safety:** **whole epic TIER-3 / PROTECTED** — changes RLS-equivalent visibility, adds a role
  axis, handles child special-category data, and reopens the Phase-1 "UNCHANGED" resolve RPCs. Prove
  the RLS cut against a **real team/club with a real Lead grant — NEVER `team_demo`** (RLS checklist).
- **Best-practice grounding (WebSearch, safety lens):** CPSU/NSPCC — concerns route to a named DSL /
  Club Welfare Officer on strict need-to-know; the app is a triage/hand-off tool, not the investigation
  record; referral routes (LADO / children's social care / police) are OUT of the app; special-category
  processing needs a DPIA + an Art 9 condition (DPA 2018 Sch 1 §18) + an Appropriate Policy Document.
  Sources (for Phase-0 DPO audit): CPSU *Lead safeguarding officer role*
  https://thecpsu.org.uk/resource-library/forms/role-description-lead-safeguarding-officer/ · CPSU
  *Putting safeguards in place* https://thecpsu.org.uk/help-advice/putting-safeguards-in-place/ ·
  NSPCC/CPSU *Deal with a concern* https://sport.nspcc.org.uk/help-advice/deal-with-a-concern/ · CPSU
  *Referral to statutory agencies / LADO* https://sport.nspcc.org.uk/case-management-tool/referral-to-statutory-agencies/
  · CPSU *LADO guide for sport* https://thecpsu.org.uk/help-advice/introduction-to-safeguarding/lado-guide-for-sport-and-physical-activity/
  · NCVO *Making a safeguarding referral* https://www.ncvo.org.uk/help-and-guidance/safeguarding/certain-roles/designated-leads/responding-concerns/referral/

---

## Phase 0 — LEGAL / COMPLIANCE PREREQUISITE 🚦 (operator/DPO — being done RETROSPECTIVELY)
**Operator decision 2026-07-01:** the platform has **no real users yet**, so the build may proceed
now; the legal work is done **retrospectively** and becomes a **HARD GO-LIVE GATE — the safeguarding
module must NOT be exposed to any real venue/user until all of the below are signed off** (logged in
GO_LIVE_ISSUES.md so it can't be forgotten). Building a module that *stores* a safeguarding flag makes
In or Out a **processor of special-category child-protection data**. Owed before real-user go-live:
1. **(a) vs (b) confirmed** = lightweight flag+route (LD#1). *(Provisionally locked (a) for the build.)*
2. **DPIA** completed + signed off (mandatory for children's / special-category processing).
3. **Controller/processor decision documented** — venue/club = controller (holds the DSL), platform =
   processor of a pointer — with **processor terms + an Appropriate Policy Document** in place.
4. **Retention rule agreed** for a flagged record (drives the LD#8 delete-cascade carve-out).
- **Build gate:** none (retrospective — nobody live). **GO-LIVE gate / VETO:** the module stays dark to
  real venues until 1–4 are signed off. Tracked in GO_LIVE_ISSUES.md.
- **Design answers locked for the build (working defaults — override at the plan gate if wrong):**
  **OQ#1 → EVICT** the incident on flag (LD#6) + the flag-confirm prompts "does this also need an
  operational response? log it separately". **OQ#2 → route a flag at a zero-Lead venue to the venue
  OWNER + a loud "designate a Lead" nag** (never a dead end).

---

## ROADMAP — PRs in dependency order

### PR #1 — Schema: flag columns + caps CHECK + index + GDPR carve-out (mig 466) · TIER-3 · PROTECTED · effort S
Additive/defaulted → every existing row byte-identical. `incidents`:
`is_safeguarding_flagged boolean NOT NULL DEFAULT false`, `safeguarding_flagged_at timestamptz`,
`safeguarding_flagged_by text`. Extend `venue_admins_caps_known` CHECK with `'safeguarding_lead'`
(DROP/ADD CONSTRAINT — additive-safe, all existing caps stay valid; grep + update every hard-coded
5-cap array same-commit). Partial index `idx_incidents_safeguarding (venue_id, created_at) WHERE
is_safeguarding_flagged AND resolved_at IS NULL`. Replace `idx_incidents_queue` /
`idx_incidents_escalation_inbox` to add `AND is_safeguarding_flagged IS NOT TRUE`. **GDPR carve-out
(LD#8):** do NOT add `safeguarding_flagged_by` to the `delete_my_account*` NULL-cascade — flagged
records survive user deletion; add a code comment stating the Art 17(3)(b) override. Write
`466_safeguarding_module.sql` + `466_safeguarding_module_down.sql` (down restores the mig-461 index
definitions verbatim, drops columns, reverts the CHECK).
- Gates: 🚦 migration apply (human) · schema-sync.md · check-db-schema incidents · build clean.
- **Done:** columns + caps value exist; existing rows unflagged + byte-identical; down drops cleanly;
  the CHECK change breaks no existing admin row; delete-account leaves flagged rows intact.

### PR #2 — Lead gate + flag/unflag write RPCs + read-audit + neutral notify (mig 466 cont.) · TIER-3 · PROTECTED · effort M
`_venue_is_safeguarding_lead(actor_ident, venue_id)` (grant-only, role-independent — LD#4).
`venue_flag_safeguarding(p_venue_token, p_incident_id)` — any venue caller; sets the flag +
flagged_by/at; **clears assigned_to/acknowledged_at/escalated_* per LD#6** (⚠️ gated on OQ#1);
idempotent (raise `already_flagged`); audits; neutral notify (LD#9). `venue_unflag_safeguarding(...)`
— **Lead-only**; re-enters ops queue with ops fields blank; audits. Gate the Phase-1 write/resolve
RPCs (`venue_triage_incident`, `venue_escalate_incident`, `venue_resolve_incident`, `hq_resolve_incident`)
so a non-lead cannot triage/escalate/resolve a flagged row (add the flag guard to each WHERE → 0-row
UPDATE → the *same* not-found error, never a distinct "is safeguarding" error = existence-oracle-safe).
All SECDEF, `search_path` locked, REVOKE PUBLIC + explicit grants ([[feedback_default_privileges_revoke]]
— named-role default grants defeat REVOKE-from-PUBLIC-only). Wrappers + barrel. Add the neutral reason
to the `notify_venue_change` whitelist.
- Gates: 🚦 ephemeral-verify (seed `_e2e_` incident; flag as non-lead ✓, flag clears ops fields, unflag
  as lead ✓ / as non-lead ✗, non-lead triage/escalate/resolve of a flagged row all blocked with the
  generic error, audit rows present, leak-check 0) · 🚦 rpc-security-sweep (every new + reopened RPC) ·
  build clean.
- **Done:** EV green + 0 leak; each raw RPC name in exactly ONE `supabase.rpc()`; sweep PASS; no
  distinct safeguarding error leaks existence to a non-lead.

### PR #3 — Read-filter sweep + Lead-only list RPC + enforcement gate (mig 466 cont.) · TIER-3 · PROTECTED · effort L
**The load-bearing security PR.** Reproduce each of the FOUR read bodies **verbatim from live**, then
add `AND i.is_safeguarding_flagged IS NOT TRUE`: `venue_get_state`, `hq_get_venue_detail`,
`hq_list_escalated_incidents`, and **all four aggregates in `hq_get_company_state`** (open count,
critical count, both `health`-CASE clauses). New `venue_list_safeguarding_incidents(p_venue_token)` —
raises `not_a_safeguarding_lead` for non-leads, returns flagged open rows for a Lead, and **writes a
`safeguarding_incident_viewed` audit row (LD#7)**. Wrapper + barrel. **Enforcement invariant
(future-proofing):** add `skills/scripts/check-incident-safeguarding.sh` (Skills/ tracked casing) that
FAILs any migration/RPC body containing `FROM incidents`/`JOIN incidents` without the exclusion
predicate unless on a named allow-list (the Lead-list RPC) — wire it into the dev-loop proof gate.
Record HR14 consumer rows in RPCS.md: the flag RPC, the Lead-list RPC, and the exclusion invariant,
naming the future consumers that MUST honour it (Gaffer `gaffer_get_incident_risk_context`, HQ
analytics, reception display) and that `safeguarding` is never a grantable agent domain (LD#12).
- Gates: 🚦 ephemeral-verify (**prove the NEGATIVE**: a flagged incident is ABSENT from all four
  ops/HQ reads for a non-lead, an HQ analyst, and the shared token; PRESENT via the Lead list for a
  designated Lead; **count parity** — non-lead counts don't reveal the hidden row) · 🚦 rpc-security-sweep ·
  check-rpc-consumers · new check-incident-safeguarding.sh PASS · build clean.
- **Done:** flagged incident invisible to every non-lead/analyst/shared-token caller across all four
  reads AND counts/health; visible to a Lead; the enforcement script blocks an un-filtered `FROM
  incidents`; RPCS.md consumer + invariant rows present; no old-shape consumer breaks.

### PR #4 — Venue desktop UI: flag action + Lead-only Safeguarding view (apps/venue) · TIER-3 · PROTECTED · effort M
`IncidentActions.jsx`: the Phase-1 SafeguardingNotice becomes the entry point for a **"Flag as
safeguarding"** control (violet `--train` accent + `shield` glyph, deliberately not a `.btn-xs` peer)
→ a `Modal` confirm naming the recipient Lead(s) + the plain-English "removes it from the normal
queue, routes it privately, you can't reopen it here" consequence + a legally-careful "does not
replace your safeguarding procedure". After success: a `toast` naming the Lead + a content-free
"1 routed to safeguarding" breadcrumb (no openable content). A **Lead-only** Safeguarding panel/rail
item (rendered only when `resolve_venue_caller` marks the caller a Lead — server withholds the rows,
not CSS) reading `venue_list_safeguarding_incidents`, violet-accented + count badge, resolve-in-place.
**No-Lead handling (OQ#2):** owner nag banner + the flag-confirm warning when the venue has zero Leads.
Designation UI = a `safeguarding_lead` checkbox in the existing staff/cap screen. Optimistic + revert.
- Gates: build venue clean · hygiene 7/7 · Playwright smoke (demo — walk BOTH a Lead and a non-lead
  viewer: non-lead sees no flag action + no flagged rows) · 🚦 **venue manual deploy** (human, prebuilt-static).
- **Done:** non-lead never sees the flag action or flagged rows; a Lead can flag + view + resolve;
  no-Lead nag shows; 0 console errors; deployed + eyeballed against a real (non-demo) venue Lead grant.

### PR #5 — Mobile native flag action (apps/inorout OperationsTonight) · TIER-3 · PROTECTED (native) · effort M
One-tap "Flag safeguarding" on each incident card (card-level `shield` icon-button → `MobileSheet`
confirm, never a direct write) + the content-free toast. Same neutral copy. **Mobile Lead-review view
deferred to a fast-follow** (LD#11 — shrink the App-Store surface); the flag action reuses PR#2/#3
RPCs, no new backend. *(App-Store privacy: boolean + routing = operator-entered venue data, no new
tracking — but re-check the declaration; NO free-text on the native surface, ever.)*
- Gates: 🚦 casual-regression · 🚦 **real-iPhone on-device walk (Hard Rule 13)** — flag persists across
  reload, the flagged card disappears on a **non-lead** device, no tap-does-nothing · build clean ·
  respect the App-Store freeze if a submission is in review (do NOT stack on the still-owed PR#212 walk).
- **Done:** on-device walk passes; a non-lead device provably cannot see a flagged incident; casual-regression PASS.

**Phase 2b (explicitly deferred, seams recorded):** HQ/company-scoped Safeguarding Lead + cross-venue
oversight (`resolve_company_caller` extension); mobile Lead-review view; case-notes / referral-tracking
(the DPIA-gated (b) project); assignee/Lead push-email notifications (broadcast-composer cycle — must
carry NO content + Lead-only recipients); auto-escalation SLA cron (must `WHERE is_safeguarding_flagged
= false`). All documented as guards in RPCS.md / DECISIONS.md so a future builder can't miss them.

---

## 🚦 GATES the loop must stop at (human sign-off)

0. **Phase 0** — legal/compliance (DPIA + controller/processor + APD + retention). **Retrospective — does NOT block the build; it is a HARD GO-LIVE gate before any real venue sees the module** (GO_LIVE_ISSUES.md).
1. **PR #1** — migration 466 apply (columns + caps CHECK change + index + GDPR carve-out).
2. **PR #2** — ephemeral-verify + rpc-security-sweep (flag/unflag + reopened Phase-1 write/resolve RPCs).
3. **PR #3** — ephemeral-verify (**the negative-visibility proof + count parity** — the single most
   important gate in the epic) + rpc-security-sweep + the new enforcement script.
4. **PR #4** — venue manual deploy + real-(non-demo)-venue Lead eyeball.
5. **PR #5** — real-iPhone on-device walk (Hard Rule 13) + casual-regression.

**Expected stops: 5 of 5 PRs pause for the operator** — 1 migration apply, 2 proof gates (EV/rpc-sec
×2, incl. the negative-visibility proof), 2 deploy/device gates. None auto-merge; none apply a
migration without you. **The legal Phase 0 is a separate GO-LIVE gate (retrospective) — it does not
block the build, but the module stays dark to real venues until it clears.**

---

## DONE =

Front-of-house staff can flag a welfare concern in **one tap**; flagging **removes the incident from
every ordinary operational and HQ view** (queues, escalation inbox, all counts + health tiles) and
routes it privately to designated **Safeguarding Leads**, who review and close it in a separate,
audited, Lead-only view; **no non-lead — owner, manager, HQ analyst, shared demo token, or the future
Gaffer AI — can see a flagged incident anywhere**, proven by ephemeral-verify against a real venue;
every flag, un-flag, resolve, **and Lead read** is audited server-side; flagged records **survive
account deletion** (Art 17(3)(b)); v1 stores **no free-text disclosure**; existing log/triage/escalate/
resolve paths and the casual flow are provably unchanged; and the DPIA/controller/APD prerequisites
were signed off **before** a line of code shipped. HQ Leads, case management, notifications, and
auto-escalation are deferred with recorded guards.

---

## Related
Phase 2 of the Incident Triage epic (`INCIDENT_TRIAGE_HANDOFF.md`; migs 231/437/171/461/462/464/465).
Reuses the `venue_admins` capability model (mig 237/238) and `club_committee.is_welfare` welfare-officer
precedent (mig 449). Future consumers seamed per Hard Rule 14: Gaffer AI (`gaffer_get_incident_risk_context`
— safeguarding never a grantable domain), HQ analytics, reception display, the assignee-notification +
SLA-escalation crons — all MUST honour the `is_safeguarding_flagged` exclusion. Grounded in CPSU/NSPCC
UK safeguarding practice + UK-GDPR Art. 9 / DPA 2018 Sch 1 §18.
