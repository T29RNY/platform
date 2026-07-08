# Club Manager — DPIA & Safeguarding Compliance Pack

**Status: DRAFT for operator / DPO sign-off.** Prepared 2026-07-08 to satisfy the four
`GO_LIVE_ISSUES.md` "Safeguarding Module Legal Prerequisites" items, extended to cover the
**broader children's-data processing** the Club Manager app (`apps/clubmanager` + the `/hub`
companion) newly surfaces beyond the venue-side incident flag.

> ⚠️ **This governs real children's special-category data.** It is drafted to be specific and
> usable, not generic — but it is not legal advice. Recommend a qualified data-protection
> practitioner (or the pilot club's own DPO/DSL) reads Parts A–D before they become operative.
> Sign-off = the operator dates and initials each Part's sign-off line and the outcome is
> recorded in `DECISIONS.md` + the four `GO_LIVE_ISSUES.md` checkboxes ticked.

**The four instruments (the go-live gate):**
- **Part A — Data Protection Impact Assessment (DPIA)**
- **Part B — Controller / Processor Decision Record**
- **Part C — Appropriate Policy Document (APD)** — DPA 2018 Sch 1 conditions
- **Part D — Retention Schedule**

---

## PART A — DATA PROTECTION IMPACT ASSESSMENT (DPIA)

### A1. Why a DPIA is required (screening)
Mandatory under UK GDPR Art. 35 — this processing hits multiple ICO "likely high risk" triggers:
**children's data at scale**, **special-category data** (health/medical + safeguarding),
**vulnerable data subjects**, and **systematic processing** across a mobile + web platform. A DPIA
is required and this document is it.

### A2. Description of the processing
The Club Manager app lets a grassroots football club run itself end-to-end. It **surfaces existing
Club OS data** (built migs 286–469) through a desktop admin console and the native `/hub`
companion. The personal data of **children (under-18 players)** processed:

| Data category | Fields (from `member_profiles` / related tables) | Special category? |
|---|---|---|
| Identity | first/last name, DOB (`member_profiles.dob`), gender, address | No (DOB = age → child status) |
| Health / medical | `medical_conditions`, `allergies`, `medications`, `gp_details`, `send_notes` (SEND), `dietary_notes` | **Yes — Art 9 health** |
| Care consents | `consent_emergency_treatment`, `consent_administer_medication`, `may_leave_unaccompanied`, `authorised_collectors` | Adjacent to health |
| Emergency contacts | `ec1_*`, `ec2_*` (parent/guardian contact) | No (but sensitive) |
| Guardian relationship | `member_guardians` (guardian↔child, `invite_state`) | No (family/child data) |
| Image consent | `photo_consent {website, social, press, marketing}` | No (governs image use) |
| Availability / attendance | `club_fixture_availability`, `club_session_attendance` | No |
| Safeguarding concern | `incidents.is_safeguarding_flagged` + who/when (flag only, **no narrative**) | **Yes — Art 9 / child protection** |
| Adult staff vetting | `club_staff_dbs` (check type, status, `certificate_number`, expiry) | Criminal-offence-adjacent (Art 10) |

**New exposure this app introduces (the reason for re-assessment):** child DOB, medical fields,
availability and guardian data — previously visible only to a venue operator in the venue console —
become visible to **club admins, team managers/coaches, and guardians on a mobile device**. This
**widens the audience** for children's data, which is the core new risk this DPIA addresses.

### A3. Necessity & proportionality
- **Lawful basis (Art 6):** (b) performance of the membership contract for enrolment/subs; (f)
  legitimate interests of the club for team operations, availability, and communications
  (balancing test A6 below). Consent (a) is **not** the Art 6 basis for core operations (to avoid a
  withdrawable-consent gap), but **is** the basis for optional image use.
- **Special-category condition (Art 9) — see Part C (APD):** health/medical = **Art 9(2)(a)
  explicit consent** (given by the guardian at registration) **backstopped by Art 9(2)(c) vital
  interests** in a medical emergency; safeguarding flag = **Art 9(2)(g) substantial public
  interest → DPA 2018 Sch 1 §18 (safeguarding of children)**; DBS = **Art 10 / DPA 2018 Sch 1 §18**.
- **Data minimisation (built-in, verifiable in code):**
  - The safeguarding flag stores **a boolean + actor + timestamp only — no free-text disclosure**
    (SAFEGUARDING_MODULE_HANDOFF LD#1). The app is a *router*, not a case-management record.
  - Public surfaces run a **server-side minor transform** (`get_club_public`, mig 445): a minor or
    unknown-DOB member is rendered **first-name + surname-initial only, photo suppressed**;
    `hide_public_rosters` blanks the roster entirely. No child surname or photo is ever exposed on
    an unauthenticated surface.
  - `photo_url` is hard-NULL on every public read until a photo feature is separately DPIA-assessed.
  - Audit logs store **flags, never content** (`is_minor`, `has_medical` — not the values).

### A4. Consultation
Data subjects/guardians are consulted through the **registration consent flow** (guardian accepts
consents per child before data is processed). The club's **Designated Safeguarding Lead / Welfare
Officer** is the human owner of any safeguarding concern (CPSU/NSPCC practice).

### A5. Risks and mitigations

| # | Risk | Likelihood / Severity | Mitigation (mostly already in code) | Residual |
|---|---|---|---|---|
| 1 | A coach/parent sees a child's medical/special-category data they shouldn't | Med / High | Special-category fields sit behind **admin-only reads**; team-manager/guardian reads are scoped to their own team/child via `club_team_managers` / `member_guardians` server-side gates; access audited | Low |
| 2 | A non-guardian sets a child's availability or joins them to a team | Low / High | Server enforces `member_guardians.invite_state='accepted'` on `guardian_set_fixture_availability` + `member_join_club_team`; client mirrors | Low |
| 3 | Child PII/photo leaks to a public web surface | Low / High | `get_club_public` minor transform (name-initial, photo NULL, roster-hide); `photo_url` hard-NULL pending separate DPIA | Low |
| 4 | Safeguarding concern visible to a non-Lead (owner/manager/analyst/AI) | Low / High | Grant-only Lead gate that does **not** inherit owner/manager default-pass; four ops/HQ reads exclude flagged rows; `check-incident-safeguarding.sh` enforces the exclusion; `safeguarding` never a grantable AI domain | Low |
| 5 | Coach/volunteer around children without a valid DBS | Med / Med | DBS status surfaced prominently on the welfare board; **assignment hard-block is a product/legal decision** (Part A6 recommends soft-block + warning for v1, hard-block before scale) | Med → resolve at go-live |
| 6 | Child special-category data over-retained | Med / Med | Part D retention schedule; delete-cascade scrubs member PII; **safeguarding flag deliberately survives** (Art 17(3)(b)) | Low |
| 7 | Guardian self-deletion doesn't reach the child's record; DBS cert survives a scrubbed account | Med / Med | **Documented as intended** (Part B/D): the child is a separate data subject the club still holds; cert retention is a vetting obligation. Guardian erasure request → routed to the club (controller) for the child | Low (policy-documented) |
| 8 | Data breach exposes children's data | Low / High | RLS-on all tables, SECURITY DEFINER RPCs only, no direct client writes, `auth.uid` scoping, TLS, Supabase managed infra; breach process in Part B | Low |

### A6. Outstanding decisions this DPIA locks
- **DBS-to-assignment (Risk 5):** v1 = **soft-block + prominent warning** when assigning a coach
  with non-`valid` DBS to a youth cohort; **hard-block before onboarding beyond the pilot.**
  *(Operator confirm.)*
- **Legitimate-interests balancing (Art 6(1)(f)):** club operational use of child availability/
  contact data is necessary, expected by guardians who enrolled, low-impact, and does not override
  the child's interests → **LIA passes.** *(Recorded here as the LIA.)*

**Part A sign-off (operator/DPO):** DPIA reviewed and approved. Name: ____________  Date: ________

---

## PART B — CONTROLLER / PROCESSOR DECISION RECORD

### B1. Roles
- **The CLUB is the data controller** of all member/child/safeguarding/medical/DBS data. The club
  holds the **Designated Safeguarding Lead / Welfare Officer** (`club_committee.is_welfare` /
  the `safeguarding_lead` capability) and determines the purposes and means of processing children's
  data. Safeguarding concerns are **the club's to own, investigate, and refer** (LADO / children's
  social care / police — all **outside** the app).
- **In or Out is the data PROCESSOR** for that data — it provides the platform that stores and
  routes it on the club's documented instructions. In or Out must **not** become an independent
  controller of safeguarding content: it stores a **routing pointer (flag)**, never the disclosure
  narrative, and never makes safeguarding decisions.
- **Limited independent-controller carve-out:** In or Out is an **independent controller** only for
  the minimum account/authentication/billing metadata it needs to run the service (login identity,
  Stripe customer/subscription references) — standard SaaS posture, not children's welfare data.

### B2. Processor obligations (UK GDPR Art. 28) — to be reflected in the club agreement
In or Out, as processor, will: (a) process only on the club's documented instructions; (b) ensure
confidentiality of personnel with access; (c) apply the Art. 32 security measures in A5#8; (d) use
sub-processors (Supabase/database, Vercel/hosting, Resend/email, Stripe/payments) only under
equivalent terms and with the club informed; (e) assist the club with data-subject requests, DPIAs,
and breach notification; (f) delete or return data at end of contract (subject to the Part D
safeguarding retention override); (g) make available the information needed to demonstrate
compliance.

### B3. Breach process
A suspected personal-data breach affecting children's data is escalated to the operator within
**24 hours** of detection; the **club (controller) is notified without undue delay** so the club can
assess ICO notification (72-hour Art. 33 clock) and inform guardians where required. In or Out
assists with containment and forensics.

### B4. Safeguarding hand-off boundary (the line that keeps In or Out a processor)
The app **routes and restricts**; the human Lead **investigates and refers**. The app never stores
the substance of a concern, never advises on a referral, and `safeguarding` is never exposed to the
Gaffer AI or any analytics surface. This boundary is the reason the minimal "flag + route" build is
defensible.

**Part B sign-off (operator):** Controller/processor split confirmed; Art. 28 terms to be added to
the club agreement. Name: ____________  Date: ________

---

## PART C — APPROPRIATE POLICY DOCUMENT (APD)

*Required by DPA 2018 Sch 1 Part 4 §5 when relying on a Sch 1 condition (incl. §18 safeguarding and
the substantial-public-interest / consent conditions) to process special-category or criminal-offence
data. Retain throughout processing and for 6 months after it ends; make available to the ICO on
request.*

### C1. Conditions for processing relied upon
- **Health/medical data of members (incl. children):** UK GDPR **Art 9(2)(a) explicit consent**
  (guardian, at registration), backstopped by **Art 9(2)(c) vital interests** in a medical
  emergency.
- **Safeguarding concern (flag):** UK GDPR **Art 9(2)(g)** + **DPA 2018 Sch 1 §18** (safeguarding of
  children and of individuals at risk).
- **DBS / criminal-offence data of staff:** UK GDPR **Art 10** + **DPA 2018 Sch 1 §18** (and the
  relevant safeguarding/employment conditions).

### C2. Procedures for compliance with the Art. 5 principles
- **Lawfulness/fairness/transparency:** processing is on the bases in A3; guardians receive a privacy
  notice at registration; the minor transform prevents unfair public exposure.
- **Purpose limitation:** children's data is used only to run the club (teams, availability,
  communications, safeguarding, membership). It is **not** used for advertising, profiling, or AI
  training; `safeguarding` is walled off from the Gaffer AI.
- **Data minimisation:** flag-not-narrative; name-initial public transform; photo hard-NULL; audit
  logs store flags not values.
- **Accuracy:** guardians maintain their child's profile; the club corrects on request.
- **Storage limitation:** Part D.
- **Integrity/confidentiality:** A5#8 (RLS, SECDEF RPCs, TLS, scoped reads, access-auditing —
  including read-auditing of every Lead access to a safeguarding record).

### C3. Retention & erasure policy for special-category data
Per **Part D**. Note the deliberate **Art 17(3)(b) override**: a safeguarding-flagged record survives
a subject's or reporter's self-deletion, because erasure is overridden by the safeguarding legal
obligation; retention of flagged records is governed by the club as controller.

**Part C sign-off (operator/DPO):** APD in place. Name: ____________  Date: ________  Review due: +12 months

---

## PART D — RETENTION SCHEDULE

| Data | Retention | Trigger / basis |
|---|---|---|
| Active member/child profile (identity, availability, membership) | While a member + **3 years** after leaving (dispute/subs window) | Contract + legitimate interest; then scrub |
| Child **medical/health** data | While a member + **up to 3 years** (or sooner on guardian request where no safeguarding hold) | Art 9(2)(a) consent; minimise once inactive |
| **Emergency contacts** | With the child profile; deleted on profile scrub | Vital interests |
| **Photo consent** flags | With the profile; reset to `{}` on account deletion | Consent record |
| **Safeguarding-flagged record** (flag + who/when) | **Retained per the club's safeguarding retention policy — SURVIVES account deletion** (min. aligned to FA/CPSU guidance, typically to age 25 or per statutory guidance) | **Art 17(3)(b) override — controller-governed** |
| **DBS record** (`club_staff_dbs`, incl. certificate number) | Retained for the vetting cycle; per FA/DBS guidance a cert number/date is kept only as long as necessary and **survives an account scrub** as a vetting obligation | Safeguarding/employment obligation |
| Account/auth + billing metadata (In or Out as controller) | Life of account + statutory financial retention (**6 years**, tax) for billing | Legal obligation |
| Audit events (flags, not content) | **6 years** (accountability + safeguarding access trail) | Art. 5(2) accountability |

**Erasure requests:** a guardian's erasure request is honoured for data In or Out controls, and
**routed to the club (controller)** for the child's club-held record; a safeguarding or DBS hold is
applied where the override/obligation applies, and the requester is told (Art. 17(3) exemption).

**Part D sign-off (operator):** Retention schedule agreed; drives the `delete_my_account*`
carve-out already in code. Name: ____________  Date: ________

---

## SIGN-OFF SUMMARY → go-live gate

When Parts A–D are initialled, do these two things and the safeguarding go-live gate (G3) is cleared:
1. Tick the four boxes in `GO_LIVE_ISSUES.md` → "Safeguarding Module Legal Prerequisites".
2. Record the decision + this file's path in `DECISIONS.md`.

Until then, the Club Manager app's safeguarding/DBS/child-special-category surfaces stay **dark /
demo-only** (the loop builds them but does not expose them to a real club — manifest gate G3).
