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

## PILOT MEETING FEEDBACK — multi-team football club (2026-06-22)

First face-to-face feedback from a real multi-age football club pilot
(the Club/Org SKU buyer). They explicitly framed In or Out as a
**replacement for 360Player + MatchDay Admin + Tournify**. A second
meeting (~2026-06-29) demos to the wider management team to get an
agreement in place; the operator asked them to **promote it to other
teams in their league/area** — the network effect is the real prize.

### Prioritised backlog (work through one-by-one)

> **NEXT-SPRINT ITEMS ALL DONE (s180, to the ~2026-06-29 wider-mgmt demo):** #8 ✅ #9 ✅ #4 ✅
> #10 ✅ #11 ✅ + the #1 FA spike ✅ (NO-GO verdict). Backlog #2 ✅ (migs 389–393). **#7 multi-venue
> materially addressed** by the Venue OS nav epic (club_features follow the club to every venue +
> membership scope honored across the club's venues, mig 401). Remaining roadmap: #12 reporting (un-
> touched, biggest gap), #5 pitch priority/reserved times, #6 make team prioritisation *drive*
> something, #3 activate Stripe (live keys), #1 Phase C AI-import (gated on a real FA snippet), #13
> season setup. Next venue epic = venue-operator tournament create (Epic D, now unblocked by the
> shipped `tournaments` flag). Next free mig = 403.

| # | Ask | Status today | Effort | Demo priority |
|---|-----|--------------|--------|---------------|
| 1 | **FA Full-Time fixture sync + change alerts** | **Spike DONE (session 178) → NO-GO on a clean feed** (no API/iCal/feed; only a login-gated display widget; Matchday closed; even Pitchero gets only a once-a-season FA export). **Route = AI-scan the embed into our `club_fixtures`, gated on a real pilot snippet** (Phase C, mig 397+, schema dormant-ready). See FA verdict below. | High → **grey/fragile; best-effort alerts** | 🔴 #1 — partnership endgame; AI-import deferred to snippet |
| 2 | **Org/team structure (youth + adult under one club)** | ✅ **COMPLETE** — epic shipped migs 389–393 (structure, join link/QR, membership-gated join, manager comms, pro-rating) | — | ✅ done |
| 3 | Mass invoicing | Built (Stripe infra migs 329–337, dormant) | Low (activate) | 🟢 demo as-is |
| 4 | Coach invoice-chasing (auto reminders + who-hasn't-paid view) | ✅ **SHIPPED** (mig 398) — reminder cron CONFIRMED already covers membership arrears (`payment_due` kind, no change needed); new `club_manager_team_payments` powers a coach-facing **Subs & payments** roster (green Paid / red Owes £X) under "Message your team" in the consumer club view | Low–Med | ✅ done |
| 5 | Internal vs external pitch booking + reserved/priority times | Pitch system built; priority layer not | Med | 🟠 show |
| 6 | Team prioritisation system (some teams rank above others) | **Partial** — `club_teams.priority_rank` + ⭐ badge ship in the org chart (Phase 1, mig 389) but display-only; doesn't yet *drive* anything (e.g. pitch priority) | Med (to make it drive) | roadmap |
| 7 | Multi-venue (train one site, play another) | **Materially addressed (s180)** — the Venue OS nav epic split features into `venue_features` (per venue) + `club_features` (per club, follow the club to every venue), and Phase 2.5 (mig 401) made membership eligibility resolve across the club's venues (a member enrolled at one site is honored at the club's other sites). Verified by EV; byte-identical on today's single-venue data. **Remaining:** cross-venue fixtures/booking flows if a pilot needs them; cross-CLUB passes deferred (settlement + safeguarding, DECISIONS s180) | Med | 🟢 demo the model |
| 8 | Opposition-coach matchday info link | ✅ **SHIPPED** (migs 394–396) — `/matchday/<code>` public branded link (home team, kickoff, pitch, ref, address/directions, ground rules); live demo `app.in-or-out.com/matchday/demofalcons01` | Low | ✅ done |
| 9 | Embed code (fixtures/results on own website) | ✅ **SHIPPED** (mig 397) — `/embed/league/<code>` iframe widget (our fixtures+results, our design) + FA official snippet stored per league for the club's own site | Low | ✅ done |
| 10 | Simplify Venue OS UI ("too many similar-sounding options") | ✅ **COMPLETE (s180)** — full Venue OS nav epic shipped: Phase 0 IA cleanup (rail 5 groups, Memberships 13→5, Fixtures surfaced), Phase 1 flag foundation + 3-layer gate (mig 399), Phase 2 toggle UI + dependency graph + discipline axis (mig 400), Phase 2.5 membership scope (mig 401), Phase 3 presets (mig 402), Phase 4 rail wiring. Default-all-on (zero ship-day change); a configured club collapses the rail ~18→8 | — | ✅ done |
| 11 | Modularity (clubs pick/pay per module; operator toggles) | ✅ **COMPLETE (s180)** — operator "Features" screen (manage_facility-gated) flips per-venue + per-club features on/off (migs 400) with a server-enforced dependency graph + discipline axis, plus "Quick setup" package presets (mig 402). Two flag tables (venue_features + club_features); default-all-on; commercial tier/pricing decision deliberately deferred (presets are shortcuts, flags are truth) | — | ✅ done |
| 12 | Reporting / data | Not covered | High | roadmap |
| 13 | Season setup once + ad-hoc changes | Partial | Low–Med | mention |
| 14–17 | Pitch assignments / reception view / ref view / live data | Built ✅ — all "loved/amazing" | — | 🟢 feature hard |

### Competitor pricing intel (gathered 2026-06-22)

- **360Player** (primary replace target): Core £99/mo, Power £349/mo,
  All-in-One £499/mo + à-la-carte add-ons (Scheduling £79, Dev/Stats
  £109, Training Library £119, Video £189, SSO £199) + £299 onboarding.
  A serious club = **£4k–£6k/yr**.
- **Tournify**: ≤8 teams free; €40 (≤60 teams) / €120 (unlimited) per
  event; or **€300/yr** for up to 30 tournaments (each unlimited-team).
- **MatchDay Admin**: low £/mo, no clean public figure pulled yet.
- **Combined competitor stack ≈ £500+/mo (£6k+/yr)** — this is the
  anchor: "one platform replaces all three."
- **Pricing play for the meeting** (consistent with PILOT COMMERCIAL
  TERMS above — founder = % off list, never a symbolic absolute):
  state a **list price (~£299/mo all-modules, undercutting 360Player)**,
  then apply the locked founder % discount bought with the in-kind terms
  (feedback call, case study, **referrals**). Have a **per-module price
  table** ready (mirrors 360Player's add-on model) since they asked for
  modularity. Confirms the Pitchero-model direction above: £/mo SKU +
  transaction clip on money through our payments module.

### FA Full-Time — feasibility verdict (researched 2026-06-22)

The "bring tons of teams onboard" lever. Two routes:

1. **Official embed code** (Media → Code Snippets in Full-Time admin):
   legit, easy, satisfies the "embed on our website" ask (#9) — but it's
   the FA's locked widget styling, display-only, not restyleable, not
   alert-able. Club-level feed is single-league only.
2. **Ingest the data with the club's admin authorisation**: pull all the
   club's teams (one feed per league they play in), render in **our**
   design, and **alert teams when a fixture changes** — the
   differentiator. **Honest caveats:** technically doable, but a **legal
   grey area** (the club signed the FA's terms, which discourage
   automated extraction; the FA locked feeds behind admin login *because*
   sites were pulling data) and **fragile** (undocumented internal feed;
   FA can change/block it). Native iCal/RSS is moving to the FA's newer
   "Matchday" product, not Full-Time. **Scales club-by-club** (each must
   authorise their own login) — NOT "switch on once, whole league
   appears."

**Meeting framing (do not over-claim):** *"We pull your league data in
with your authorisation and present it in our design today; the fully
FA-official version is a partnership conversation as we grow."* The
sanctioned route is an FA data-partner agreement — worth pursuing
separately for certainty.

### SPIKE VERDICT — deepened (2026-06-22, session 178)

A focused second spike (incl. the Matchday product + how Pitchero actually
does it) hardened the verdict to **NO-GO on a clean automated feed; the only
import path is AI-reading the official display widget; the endgame is an FA/
Pitchero-style partnership earned as we grow.**

- **No machine-readable feed or API exists.** The FA exposes no iCal/RSS/XML/
  JSON feed and no public API — only a login-gated, per-division JavaScript
  **display widget** ("Code Snippets"), deliberately walled against scraping.
  The calendar-feed request was marked "Not Taken" for Full-Time and "Deferred"
  for an API on the FA's own forums.
- **Matchday is NOT an integration door.** It's the FA's own free consumer app
  (team sheets / scores / club comms) that syncs *internally* with Full-Time/
  Whole Game. No export, no API, no calendar feed out. It's effectively a free,
  FA-backed **competitor** to parts of our product, not a data tap. Worth noting
  as a competitive flag, not a route.
- **Even Pitchero doesn't get a live FA feed.** Their one true live API is
  **cricket's ECB** (which offers a real API). For the FA they get only a
  **one-time, per-division export at the start of the season** — and even that
  runs on a **selective ~15-year partnership**, not an open door. So "get the
  same integration as Pitchero" = *become an FA-recognised partner*, a
  commercial/relationship play, not a technical switch. Useful reframe: even the
  market leader only refreshes FA data **once a season** — our AI-scan could be
  *fresher* (daily), and the partnership is the proven endgame.
- **What we BUILT this sprint (the honest, shippable layers):**
  (1) **#8/#9 — our own fixtures store** (`club_leagues`/`club_fixtures`, migs
  394–397): operator holds home/away games vs free-text opponents, assigns
  pitch/ref/ground-rules, gets a public opposition-coach matchday link
  (`/matchday/<code>`) **and** an embeddable fixtures/results widget for the
  club's own site (`/embed/league/<code>`). Zero FA dependency, zero risk.
  (2) **FA snippet on file** — the operator can store their official FA "Table"
  Code Snippet against a league and paste it on their own site for the official
  division table (we don't render the FA script ourselves).
- **The deferred AI-import layer (Phase C, gated):** AI reads the rendered FA
  widget → structured rows → one-time FA-name→our-team mapping → upsert into
  `club_fixtures` (`source='fa_import'`, `fa_fixture_key` for diffing) → daily
  poll → diff → change-alert via the existing broadcast/email plumbing. **Grey,
  fragile (no stable fixture id → change-alerts are best-effort, never
  guaranteed), and gated on a real pilot snippet** to check for a hidden data
  URL before building. The `club_fixtures` schema already carries the dormant
  columns, so Phase C is behavioural-only. Do **not** over-claim change-alerts
  in the demo.

**Trigger to build Phase C:** a real FA Full-Time code snippet from the pilot
club admin (to confirm whether any usable/stable id or data URL hides behind the
widget). Until then: ship the embed-display + our-own-fixtures story.

### Sources
- 360Player GBP pricing: https://www.360player.com/prices/club-gbp
- Tournify pricing: https://tournifyapp.com/en/pricing
- FA Full-Time feeds: https://grassrootstechnology.thefa.com/support/solutions/articles/48001158072-embedding-league-tables-fixtures-tables-full-time-feeds-
- FA — calendar files "Not Taken" / API "Deferred": https://grassrootstechnology.thefa.com/support/discussions/topics/48000563653 · https://grassrootstechnology.thefa.com/support/discussions/topics/48000563596
- FA Matchday (closed consumer app): https://www.englandfootball.com/participate/leagues-and-clubs/helpful-apps-and-websites/matchday
- Pitchero — FA = one-time seasonal export, ECB = live API: https://help.pitchero.com/knowledge/3rd-party-powered-competitions · https://join.pitchero.com/non-league-football

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
