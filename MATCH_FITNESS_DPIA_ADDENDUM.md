# Data Protection Impact Assessment — Match Fitness (Apple Health) Addendum

**Status: DRAFT for legal/DPO review and sign-off.**
Prepared 2026-07-04 as the G-Legal gate for `VITE_HEALTH_KIT_ENABLED`.
This is a structured working draft grounded in the live implementation as audited on
2026-07-04 — it is **not legal advice**. A person with authority (operator and/or DPO /
solicitor) must review, complete the two DECISIONS below, and sign Section 11 before the
feature is switched on for real users.

> **Why this exists:** the Match Fitness feature processes **special-category health data**
> (heart rate, active energy, fitness) and **precise location data** (GPS route / heatmap).
> Either alone puts this in ICO "high-risk" territory; both together make a DPIA a **legal
> precondition** under UK GDPR Art 35 — it must be completed *before* processing begins for
> real users (i.e. before the flag flips), not retrospectively.

---

## 1. Overview

The Match Fitness feature lets an adult player attach a summary of an Apple Health workout
to a casual football match, store it against their account, and — only if they explicitly
opt in — let teammates in the same casual squad see their fitness figures compared with
their own (head-to-head against one teammate, and a squad fitness board).

The whole feature is currently **dark** (shipped but switched off) behind the feature flag
`VITE_HEALTH_KIT_ENABLED`. This DPIA covers the processing that begins the moment that flag
is set to `true`.

---

## 2. Description of the processing (nature, scope, context, purpose)

**Nature — what happens to the data:**
- A player records a match as an ordinary Apple Watch workout (Apple's stock Workout app —
  In or Out builds no tracking of its own).
- When the player *chooses* to attach that workout to a specific game, the iPhone app reads
  a **summary** of it from Apple Health, **read-only**, **only for the one workout the player
  picks**, **only within that game's time window**. No continuous or background access.
- The summary is stored against the player's account in a dedicated, access-controlled table.
- The player can see their own figures. If (and only if) they turn on a default-off sharing
  toggle, consenting teammates in the same casual squad can see their figures in comparisons.

**Scope — data categories:**

| Field | Category | Notes |
|---|---|---|
| Duration | Ordinary | |
| Active energy (kcal) | **Special category (health)** | |
| Distance (outdoor only) | Ordinary / derived from location | Hidden for indoor games |
| Average & maximum heart rate | **Special category (health)** | |
| GPS route → heatmap (outdoor only) | **Precise location** (high-risk) | Stored in a separate table, cascade-deleted |
| `share_match_fitness` consent flag | Ordinary | Default **false** |

We store the **summary only** — never the raw Apple Health stream. No iCloud sync, no
advertising use, no sale, no sharing with any third party.

**Context:**
- **Data subjects:** adult players (18+). Under-18s are **excluded by design** (see §6).
- **Recipients:** the player themselves; and, only where the player has explicitly opted in,
  consenting teammates **within the same casual squad** — never anyone outside the squad,
  never for league/competitive games.
- **Volume:** one summary per player per attached match; sharing is opt-in and default off,
  so most players' data is visible only to themselves unless they act.

**Purposes:**
1. Show the player their own match fitness and trend over time (primary).
2. Where opted in, social comparison **within the squad only** — head-to-head vs one
   teammate, and a squad fitness board — for casual games both players played.

---

## 3. Lawful basis

- **Article 6(1)(a) — consent.** Every attach is a deliberate, per-workout act by the player.
- **Article 9(2)(a) — explicit consent** (the required condition for special-category data).
  The design implements this as layered, explicit, freely-given consent:
  - The player actively chooses to attach each workout (not automatic).
  - Health access is a separate OS-level permission the player grants in Apple Health.
  - Teammate sharing is a **separate opt-in toggle, default OFF**, revocable at any time.
  - Under-18s are blocked entirely.
- **Right to withdraw:** the sharing toggle can be turned off at any moment (the player
  immediately drops out of all comparisons on the next read — no cache); a player can detach
  an individual session; and deleting their account permanently erases all stored summaries.

> **Assessment for legal to confirm:** consent here is specific, informed, unambiguous, and
> as easy to withdraw as to give — meeting the UK GDPR consent standard. Confirm and sign.

---

## 4. ⚠️ DECISION 1 (required) — Controller / processor determination

This is the one substantive judgement the audit could **not** settle, and it must be decided
and recorded here before sign-off.

- The settled architecture note (DECISIONS.md) states: **venue/club = controller, In or Out =
  processor.** This is clean where the app is deployed *through* a club — the club decides the
  purpose and holds the relationship with the players.
- **But** many casual squads are self-organised with **no venue or club** in the loop. In that
  case there is no club to be controller, and **In or Out is the controller** for those users.

**Legal must choose one and record it:**
- ☐ **(a)** In or Out is controller in all cases.
- ☐ **(b)** Venue/club is controller where present; In or Out is controller for
  club-less casual squads (a **split / dual** determination by deployment).
- ☐ **(c)** Other — describe: ­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­

Whichever is chosen drives: the privacy-notice wording (already live in `Legal.jsx` — confirm
it names the right controller), whether **processor terms** are needed in the venue/club
agreement, and who fields data-subject requests.

---

## 5. Necessity & proportionality

- **Data minimisation:** summary only, never the raw stream; route (the most sensitive field)
  lives in a separate table with an independent lifecycle so it can be aged out separately, and
  is captured for outdoor games only.
- **Purpose limitation:** comparisons are squad-only and casual-only, enforced **server-side**,
  never used to rank a player against anyone outside their squad.
- **Proportionate:** the feature delivers its purpose (personal fitness + optional in-squad
  social comparison) without collecting anything beyond the workout the player chooses to share.

---

## 6. Risks to individuals, and mitigations

Each mitigation below was **verified live in the database / code on 2026-07-04**.

| # | Risk to the individual | Mitigation (verified live) | Residual |
|---|---|---|---|
| R1 | Special-category health data exposed to the wrong people | Tables are RLS-enabled with **no direct-access policies** — all access is through locked-down (SECURITY DEFINER) functions; **anonymous access revoked**, signed-in only | Low |
| R2 | A teammate's data shown without their consent | Every cross-player read joins the consent flag and **re-checks it on every read** (turning it off drops the player out immediately) | Low |
| R3 | A child's health data collected | **Three layers:** server blocks under-18s on save; every reader re-excludes under-18s; the app shows an 18+ age gate before the first attach | Low |
| R4 | Precise location (route) misused or over-retained | Route stored in a separate table, outdoor-only, cascade-deleted with the session and on account deletion | Low |
| R5 | Comparison causes distress / singling-out / social pressure | Squad-only + casual-only + **minimum-cohort floor** (a board needs enough opted-in players so no one is singled out); all opt-in, default off; easy to leave | Low–Med — see note |
| R6 | Data can't be erased on request | Both account-deletion paths **purge** the health summaries (verified live); per-session detach also available | Low |
| R7 | Silent failure with no trace | Save and delete write to the audit log (Hard Rule 9, verified) | Low |
| R8 | "Off" is mistaken for "erased" | See DECISION 2 below | Med until decided |

> **R5 note for legal:** the design mitigates the social-comparison harm well, but whether the
> residual is acceptable for your user base (including any vulnerable adults) is a judgement to
> record at sign-off.

---

## 7. ⚠️ DECISION 2 (required) — the flag is not a data kill-switch

Because the display screens gate on *whether data exists*, not on the flag, setting
`VITE_HEALTH_KIT_ENABLED` back to `false` **stops new attaches but does not hide or delete data
already collected while it was on.** That is deliberate (you don't want to silently destroy
users' data), and users retain per-session detach + full account-deletion erasure.

Legal/operator must acknowledge this and confirm the erasure routes (detach + delete account)
are the accepted mechanism for withdrawal, **not** the flag:
- ☐ Acknowledged. Withdrawal = detach / delete-account (both verified live); the flag is an
  availability switch, not an erasure switch.

---

## 8. Consultation

- **Data subjects:** the privacy policy (`Legal.jsx`, live) discloses the collection, the
  teammate-sharing/comparison purpose, the 18+ restriction, and the deletion route.
- **DPO / legal:** this document is the consultation record — complete DECISIONS 1 & 2 and sign.

---

## 9. Retention

Stored until the player deletes their account (user-triggered erasure), or detaches an
individual session. No fixed maximum retention is set today.
- ☐ **Optional decision:** agree a maximum retention / auto-age-out for routes or summaries, or
  record that account-lifetime retention is accepted. (The separate route table was designed to
  make an independent age-out cheap if you want one.)

---

## 10. Measures already in place (summary for the sign-off)

Verified live 2026-07-04: RLS on both tables (no direct-access policies); all 9 data functions
are SECURITY DEFINER, search-path pinned, single-version, **anonymous-revoked / signed-in-only**;
consent re-checked every read; casual-only + squad-only enforced server-side; under-18 blocked on
save, on every read, and at the client age gate; audit logging on writes; erasure wired into both
account-deletion paths; privacy policy live. Feature currently dark behind the flag.

---

## 11. Outcome & sign-off

- [ ] DECISION 1 (controller/processor) recorded above
- [ ] DECISION 2 (flag ≠ kill-switch) acknowledged above
- [ ] Privacy notice confirmed to name the correct controller
- [ ] Processor terms updated in the venue/club agreement **if** DECISION 1 requires it
- [ ] Residual risk (esp. R5) assessed and accepted

**Approved to enable for real users:**

| Role | Name | Signature | Date |
|---|---|---|---|
| Operator | | | |
| DPO / legal (if applicable) | | | |

**Review date:** _______ (recommend 12 months, or on any material change to the feature.)

> On sign-off: record the outcome + DECISION 1 & 2 in `DECISIONS.md`, tick the DPIA line in
> `GO_LIVE_ISSUES.md`, and this addendum becomes the retained DPIA record.
