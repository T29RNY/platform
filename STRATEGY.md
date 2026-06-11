# STRATEGY.md — Commercial Strategy & Pilot Plan

*Session 84, 2026-06-11. This document is the corrected, codebase-aware
version of an externally-written strategic brief ("In or Out — Strategic
Direction & Architecture Brief"). Where this doc and that brief disagree,
THIS DOC WINS — the brief was written without sight of the codebase and
roughly a third of it was already built or already decided. Future
sessions should read this, not the raw brief.*

---

## PRODUCT THESIS & THE WEDGE

The platform's long-term shape:

  Person → Team → Competition → Venue → Organisation

Football is the **wedge**, not the ceiling. The core engine (recurring
teams, fixtures, results, attendance, leagues, venue operations) applies
to any recurring competitive community — padel, netball, darts, pool,
quiz leagues. But:

- **Build football first.** No multi-sport functionality now.
- **Sell football.** The market message is:
  *"A better way to manage recurring football groups, leagues and
  attendance."*
- **Never market** (yet): "multi-sport platform", "participation
  intelligence platform", "sports operating system", "HQ analytics".
- The larger platform emerges from successful venue adoption — it is
  not pitched into existence.

The long-term commercial opportunity is **venues and organisations**,
not individual players. Existing systems know bookings, payments,
attendance. This platform's eventual differentiation is knowing
**participation, retention, team behaviour, competition growth, venue
utilisation, community engagement** — answering "how healthy is this
sporting community?" rather than "how many bookings were made?".

---

## MULTI-SPORT POSITION (settled — do not re-litigate)

**The multi-sport foundation is ALREADY BUILT** (session 40, mig 050 —
see DECISIONS.md "MULTI-SPORT POSTURE"):

- Every relevant entity (`companies`, `venues`, `leagues`,
  `league_config`) carries `sport text DEFAULT 'football'`.
- All identifiers from Phase 0 onward are sport-agnostic
  (pitches→`playing_areas`, referees→`match_officials`), enforced as a
  standing naming rule.
- Per-sport game rules live on `league_config` (per-league, sport as
  discriminator — e.g. `card_types` is empty for sports without cards).

**The brief's proposed `sports` lookup table (id, name + FKs) is
REJECTED** — see DECISIONS.md session 84 entry for full reasoning.
Summary: sport values are server-written (no integrity risk), there is
no sport-level metadata to store, `league_config` is the proven home
for per-sport config, and converting text→lookup later is a cheap
mechanical migration. Re-open trigger: **a second sport is actually
onboarding AND needs sport-level metadata `league_config` can't
express.** Until then, onboarding a new sport = create venue/leagues
with `sport='padel'` + build only the genuinely sport-specific product
surfaces (scoring screens, stats), which would need building under any
architecture.

---

## PILOT VENUE PLAN

**Status (2026-06-11):** one pilot candidate — a football venue whose
co-owner also runs a successful city-centre pub and has local business
influence + introduction value. **Interested, not committed.** The pitch
still has to land.

**Open discovery question (ask BEFORE the pitch):** do they currently
run leagues?
- **Yes (WhatsApp/spreadsheets)** → pitch is a *relief sale*: "stop
  doing admin; here's a reception display that makes your venue look
  elite." Fast yes.
- **No** → pitch is a *growth sale*: "leagues create recurring revenue
  and we make them trivially easy to run." Better story, slower close —
  demo must match.
Also ask: how many regular block-booking groups do they have? Each one
is a proto-team to onboard.

**Pitch date: 2026-06-18 (self-imposed, one week).** The operator
controls timing; the date exists to prevent demo-perfection drift.
Demo is built backwards from it.

**Demo script (the money moment):** reception display live on a screen
→ owner scans the QR on the display with his own phone → he's joined a
team in under 30 seconds → show the venue dashboard and ref view as
"this is what your staff and refs see."

**Pilot objective is NOT revenue.** It is: real users, real attendance,
real league activity, operational feedback, a case study, testimonials,
introductions.

**Pilot product surface:**

| Included | Surface |
|---|---|
| ✅ | Player app (in-or-out.com — join, availability, stats) |
| ✅ | Venue dashboard (platform-venue.vercel.app — per-person staff logins, shipped s78 migs 237–240) |
| ✅ | Reception display (platform-display.vercel.app — shipped s83) |
| ✅ | Ref view (platform-ref.vercel.app — functionally complete, cycles 3.1–3.6) |
| ❌ | HQ analytics — not shown, not promised ("don't prioritise HQ for sales") |

**Success metrics: deliberately deferred** until the pilot has run —
we support technically; usage is theirs to generate. The platform
already records attendance/activity automatically (audit_events,
player_match), so case-study numbers will exist whenever needed.

---

## PILOT COMMERCIAL TERMS (structure agreed session 84)

**3 months free — but priced in kind, in writing.** The venue's side of
the deal is enumerated like a price:

1. Fortnightly 20-minute feedback call
2. Case-study + testimonial rights
3. Named-logo permission
4. Reception display physically installed and on
5. Two warm introductions to other venues

If the owner won't agree to these, the pilot was never going to produce
a case study — better to learn at signing.

**Post-pilot price agreed AT SIGNING, not at month 3.** Conversion is
automatic-unless-cancelled. Never re-open the money conversation with
someone anchored at £0 for three months.

**Founder pricing = % off list, locked 12 months (e.g. 50%).** NEVER a
"symbolic" absolute price — a token price anchors the product's value
at near-zero, and venue #2 WILL ask what venue #1 pays. List price
doesn't exist yet; set it later from what the pilot teaches about
willingness to pay — the founder deal scales with it instead of
undercutting it.

**Revenue share: ruled out.** The platform doesn't sit in the
booking/payment money flow; nothing clean to share.

**The first venue is a strategic partner, not a normal customer. The
platform is never permanently free.**

---

## PILOT-PREP WEEK (to 2026-06-18)

1. **QR Onboarding v1** — the only net-new build (see DECISIONS.md
   session 84 "QR ONBOARDING ARCHITECTURE" + FEATURES.md backlog row).
   Scope: generic `invite_links` routing layer + `/q/<code>` route;
   actions: join-team, venue landing page ("what's on here" + join
   options), QR rendered on the reception display rotation. Library:
   `react-qr-code`. Match check-in is v2 (the `action` field already
   accommodates it). Build follows feature-plan → audit → execute →
   verify → commit per CLAUDE.md.
2. **Real-device tests owed:** reception display on a real TV
   (wake-lock, reconnect, PIN) and ref view on a real iPhone
   (Hard Rule #13).
3. **Optional:** ref.in-or-out.com DNS for the ref app.
4. **Print assets:** poster/table-talker with the venue QR for the
   pitch meeting.

---

## POST-PILOT SEQUENCE

1. **Gather usage + attendance data** (automatic — already captured).
2. **Case study** — written with the venue's numbers and a testimonial.
3. **Venue #2** — TWO channels: the owner's contracted introductions
   AND the operator's independent outreach.
4. **CV Life** (real target, real route in) — approached ONLY with the
   case study in hand. Sequencing: champions before executives —
   venue managers → operations managers → sports development →
   participation leads → senior leadership. The pitch is **"enhance
   participation, retention, leagues and venue engagement"** — NEVER
   "replace your booking system" (they've already spent heavily on
   booking/membership systems and will defend that spend; the gap is
   team/league management + participation intelligence).
5. **Marketing rethink** — the bevel-style landing pages in
   `marketing/` (players + venues, built, undeployed) get revisited
   here. A relationship-won pilot needs zero marketing; the case-study
   phase needs somewhere to point people.

---

## EXPLICITLY NOT DOING (parked, not planned)

- `sports` lookup table (rejected — see above)
- Multi-sport rollout / second sport onboarding
- Apple Health / Apple Watch integration (vision only)
- Sports Passport / portable participant identity (vision only)
- AI features as pilot scope (Gaffer continues on its own track —
  GAFFER.md — but is not pitched)
- Enterprise functionality
- App Store work ("App Store perfection" is moot — the product is a
  PWA; native wrapping stays unscoped in FEATURES.md Phase 3)
- Permanent free tier of any kind

Anything on this list that can't affect a decision in the next 6 months
stays out of plans — vision is not a backlog.
