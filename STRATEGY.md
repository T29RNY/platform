# STRATEGY.md — Commercial Strategy & Pilot Plan

*Session 84, 2026-06-11. This document is the corrected, codebase-aware
version of an externally-written strategic brief ("In or Out — Strategic
Direction & Architecture Brief"). Where this doc and that brief disagree,
THIS DOC WINS — the brief was written without sight of the codebase and
roughly a third of it was already built or already decided. Future
sessions should read this, not the raw brief.*

*UPDATE (session 91, 2026-06-13): the product has grown from "an app to
manage in-and-outs" into a full modular system (casual + league play,
venue ops, league/tournament management, ref view, reception display,
cross-venue membership, QR onboarding, payments) — driven by two real
pilots who asked for these surfaces. Modules are superadmin-toggled per
customer. The commercial model below is rewritten accordingly: a free
casual wedge + two paid SKUs (Venue, Club/Org), both pilots now PAID
(founder-discounted), and the revenue-share/payment-rail question
re-opened because the payments+membership module puts the platform in
the money flow for the first time. Price points remain undetermined —
the operator is weighing options; this doc fixes the STRUCTURE, not the
numbers.*

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

## MODULAR SYSTEM & PACKAGING (session 91 — settled structure)

The platform is now a modular system. Superadmin toggles each module on
or off per customer. **The module toggles are the price fence** — every
module is a line item, and the test for "should I build this for a
pilot" is *"is this a future SKU line?"* (yes) vs *"is this a one-off
favour?"* (build with care). Future-proofing is legitimate; un-priceable
bespoke work is not.

**The Spond defence (do not forget this).** Spond is free forever and
Heja is free + cheap; both are well funded. We **cannot out-free them on
the casual in-and-out app** and must not try. So:

- The **casual In or Out app is the wedge and the free tier**, not the
  product. It does the acquisition job (players + squads into the system
  at zero friction) exactly as Spond's free app does. We give it away.
- We **monetise the operational layer our competitors deliberately don't
  run**: reception display, venue dashboard + staff logins, ref view,
  league/tournament management, cross-venue membership, QR onboarding,
  payments. **None of Spond / Heja / TeamSnap run a venue.** Pitchero is
  the only one close, and it's a club-*website* tool, not a live-ops
  system. That whitespace is the product.

**Two SKUs — defined by the two pilots, not invented:**

| SKU | Buyer (pilot) | Modules on |
|---|---|---|
| **Free / Casual** | a single squad doing in-and-outs | player app only. £0. Acquisition; never our revenue. |
| **Venue** | Pilot 1 (small pitch venue, casual + leagues) | player app + venue dashboard + reception display + ref view + league management + payments. Membership OFF. |
| **Club / Org** | Pilot 2 (multi-age club, leagues, tournaments, cross-venue) | everything in Venue **plus** full membership, multi-age/multi-team, tournaments, cross-venue. |

Modules above a SKU's base (extra reception screens, advanced
membership, tournament engine) are **add-ons** — the upsell lever the
toggle architecture already supports.

**The Club/Org wedge is attendance, not admin.** A club's sharpest daily
pain is "who's actually turning up to training / the match?" — today a
WhatsApp-group mess of half-answers and untrusted headcounts. Our core
**In or Out availability primitive already solves this** for casual and
league play; extending it to club training sessions and fixtures (where a
**parent declares their child in or out**) is the WhatsApp-killer that
makes the Club/Org SKU sticky — membership/admin is the system of record,
but attendance is what they open the app for every week. This is the
centrepiece the Membership V2 epic builds toward (see
`MEMBERSHIP_V2_HANDOFF.md`, Phase 10).

**Positioning rule unchanged: sell the OUTCOME, not the system.** We do
not pitch "a sports operating system" just because we built one (the
thesis above still holds: the platform emerges from adoption, it is not
pitched into existence). Modules are *how we deliver and price*, not the
story. To Pilot 1: *"Run your venue and your leagues, and look elite
doing it."* To Pilot 2: *"Run your whole club — every age group, league
and membership — in one place."* Same engine, two outcomes, two buyers.

---

## PILOT PLAN (two pilots)

**Status (2026-06-13):** two pilots, both intending to PAY (each
founder-discounted — see Commercial Terms).

- **Pilot 1 — small pitch venue.** Runs casual + league games only. Maps
  to the **Venue** SKU. Football venue whose co-owner also runs a
  successful city-centre pub (local business influence + introduction
  value). *Likely* paid, founder-discounted.
- **Pilot 2 — multi-age club.** Hosts training sessions across age
  groups, multiple leagues and tournaments; membership is club- and
  cross-venue-based (a full membership system). Maps to the **Club / Org**
  SKU. **Paid**, founder-discounted. A club of this size with membership
  revenue flowing through the platform is a different animal from a small
  venue — it justifies a paid deal from day one and gives a natural
  transaction-fee hook (see payment-rail note below) even during a
  founder-priced period.

The Pilot 1 discovery / pitch / demo detail below was written for the
single-venue case and still applies to Pilot 1 specifically.

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

## PILOT COMMERCIAL TERMS (revised session 91 — both pilots paid)

**Both pilots are paid, founder-discounted.** The session-84 "3 months
free" structure is superseded: a paid pilot (even at a deep founder
discount) is a stronger signal of real intent than a free one, anchors
the product's value above zero from day one, and avoids the "re-open the
money conversation at month 3" problem entirely.

**Founder pricing = % off list, locked 12 months (e.g. 50%).** NEVER a
"symbolic" absolute price — a token price anchors value at near-zero, and
customer #2 WILL ask what customer #1 pays. The founder deal scales with
the list price instead of undercutting it.

**List price is undetermined — by design.** The operator is weighing
options. There are now TWO list prices to discover, one per SKU (Venue,
Club/Org), set from what the pilots teach about willingness to pay.
Rough external anchors for the discovery (not targets): Pitchero
multi-team £30/mo, Pitchero "Ultimate" £80/mo (and it does far less live
ops than the Venue SKU); TeamSnap-ONE is sales-led/custom precisely
because the club/org bracket is worth more. The Venue SKU sits around /
above Pitchero Ultimate; the Club/Org SKU sits in the TeamSnap-ONE
bracket and scales with members/teams.

**Priced ALSO in kind, in writing — still required even though paid.**
The founder discount is *bought* with these; enumerate them like a price:

1. Fortnightly 20-minute feedback call
2. Case-study + testimonial rights
3. Named-logo permission
4. Reception display physically installed and on (Pilot 1)
5. Two warm introductions to other venues/clubs

If a pilot won't agree to these, the founder discount has no
justification and the pilot was never going to produce a case study —
better to learn at signing.

**Payment-rail revenue: RE-OPENED (session 91).** Session 84 ruled out
revenue share because *"the platform doesn't sit in the booking/payment
money flow."* The **payments + membership module changes that** — match
fees, membership fees and tournament entries now flow *through* the app,
putting the platform exactly where Spond and Pitchero make their money:
a small clip on transactions. This is the best-feeling revenue available
— it scales with the customer's success, it's how the grassroots market
already expects to pay (Spond trained them), and it doesn't read as a
price rise. **Direction under consideration:** SaaS subscription for the
operational software **+** a transaction fee on money flowing through the
membership/payments module (the proven Pitchero model: £/mo tiers *and*
a Stripe-rate clip). Rate undetermined. Booking-flow revenue share
remains ruled out — the platform still doesn't sit in the booking money
flow; this is specifically about fees/subs collected via our own module.

**The first customers are strategic partners, not normal customers. The
platform is never permanently free above the casual wedge tier.**

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
- Permanent free tier *of the paid SKUs* (Venue / Club/Org are never
  free). NOTE (s91): the casual In-or-Out app IS a permanent free wedge
  tier — that is deliberate Spond-defence, not a contradiction. "Never
  permanently free" applies to the operational/paid layer only.

Anything on this list that can't affect a decision in the next 6 months
stays out of plans — vision is not a backlog.
