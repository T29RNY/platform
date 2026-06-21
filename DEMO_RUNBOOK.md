# In or Out — Pilot Demo Runbook

*Prepared session 172 (Jun 21 2026) for a live pilot demo. Plain-English, presenter-facing.*

> **The one-line story:** *One platform runs the whole club — memberships and kids'
> registration, training and class bookings, a league with live-scored fixtures, tournament
> brackets, a referee's match tool, and a live reception-TV — and every person signs in once
> to reach whichever of those they're entitled to.*

---

## 1. HOW A CLUB USES IT (the flow to explain)

Think of it as four joined-up layers:

1. **The club's back office (venue app).** The operator sets up membership plans, takes
   registrations (incl. kids via a guardian), schedules classes/training and PT, runs a
   league (teams → fixtures → standings), and hosts tournaments (group stage → knockout
   bracket). One operator console.

2. **The member/player in their pocket (consumer app).** One person signs in once and sees
   *all* their roles via a context switcher: their casual squad(s), their league team, their
   club membership (pass + bookings + classes), and — if they're a parent — each of their
   kids. They book classes, confirm match availability, and carry a digital membership pass.

3. **The matchday tools.** A **referee** opens a per-match link and runs the game live —
   score, clock, goals, cards, subs — works offline and syncs. A **reception TV** shows live
   scores, the league table, top scorers and a goals ticker, updating in real time as the ref
   taps.

4. **One login across all of it (shipped tonight).** Sign in once and it carries across the
   consumer app, the venue console, and the ref app — so staff who also play, or a club admin
   who's also a parent, never sign in twice.

**Where each piece is in the build:**

| Capability | State | Note for demo |
|---|---|---|
| Memberships (plans, enrol, freeze, pass, QR) | ✅ Solid | Show on venue + member pass |
| **Kids' registration (guardian, CPSU forms, ID upload)** | ✅ Live | See §4 — answers your question |
| Classes / PT / room hire booking | ✅ Solid | Rich demo data seeded |
| League: teams, **fixtures**, standings | ✅ Solid | Seeded competitive league |
| **Live match updates** (ref → app → TV) | ✅ Solid | The "wow" moment |
| Tournament hosting (groups + knockout bracket) | ✅ Solid | Event OS, public bracket page |
| Reception display (live, real data) | ✅ Solid | Real-time from ref taps |
| **"3v3" specifically** | ⚠️ Generic only | Engine is format-agnostic; **no 3v3-branded league is seeded** (see §6) |
| Casual-match ref assignment UI | ⚠️ API only | League/tournament ref works fully; the *casual* squad-ref picker has no button yet |
| Club OS attendance/comms, AI briefings | ❌ Dormant | Don't show |

---

## 2. DEMO ACCOUNTS & ACCESS

Two real sign-in accounts (seeded), plus no-login token links. **Email codes for both accounts
arrive at `tarny@lettrack.co.uk`.**

| Account | Email / Password | What it is | Use it to show |
|---|---|---|---|
| **Alex** (all-roles) | `tarny+demo@lettrack.co.uk` / `DemoBoss1!` | Venue **owner** + squad admin + league player + boxing & martial-arts member + superadmin | The club back office; a power-member's app |
| **Sam** (family) | `tarny+family@lettrack.co.uk` / `DemoFam2!` | **Guardian** of child *Charlie*, venue staff (bookings only), casual player, **paused** boxing member | The parent/guardian experience; a kid's training/matches; staff with limited access |

**🔑 Demo hack (thanks to tonight's single-login):** the consumer app is normally email-code
only — fiddly on stage. Instead, **sign in on `venue.in-or-out.com` with the password**, then
open `app.in-or-out.com` — it's **already signed in** (no code). Proven working tonight.

**No-login token links (open directly):**

| Link | Shows |
|---|---|
| `display.in-or-out.com` + PIN `1234` | Live reception TV (token `demo_venue_display_token`) |
| `ref.in-or-out.com` + a fixture ref token | Referee match tool, ready for a game |
| `/p/p_demo_alex_token` | A player's public stats / head-to-head |
| `/m/<pass_token>` (from member pass) | A membership pass (QR, tier, perks) |

> Venue operator backdoor (no email) exists for emergencies: `venue.in-or-out.com?token=demo_venue_token_DO_NOT_USE_IN_PROD`.

---

## 3. THE DEMO FLOW (ordered script)

**Setup before they arrive:** open these tabs — (1) `venue.in-or-out.com` signed in as Alex,
(2) `app.in-or-out.com` (will be signed in via SSO), (3) `display.in-or-out.com` (PIN 1234) on
the big screen, (4) `ref.in-or-out.com` ready with a fixture ref token.

**Act 1 — "This is the club's back office" (venue app, Alex).**
Operations dashboard → tonight's fixtures, issues, outstanding payments. Then **Memberships**
(plans, members, grading/belts), **Classes** (timetable + rosters), **Trainers** (PT bookings).
Message: *one place to run the whole club.*

**Act 2 — "One login, every role" (consumer app).**
Open `app.in-or-out.com` — already signed in. Tap the avatar/**context switcher**: show squads,
league team, club memberships, (and as Sam) the kids. Message: *the messy reality — a parent who
also plays, a coach who's also a member — is one tidy login.*

**Act 3 — "A parent signs their kid up" (registration).**
Walk the guardian registration (§4): child details → emergency contacts → medical → consents →
(optional) ID upload. Message: *safeguarding-ready onboarding, not a paper form.*

**Act 4 — "Matchday, live" (the wow).**
On the **ref** tab, start a match and tap a goal/card. On the **reception TV**, watch the score,
table and goals-ticker update in **real time**. Message: *the ref's taps drive the whole room.*

**Act 5 — "Hosting a tournament" (Event OS).**
Show a tournament's public bracket page (group standings → knockout tree). Message: *run a
sports day or cup, with a live public bracket.*

**Close:** memberships + registration + league + live scores + tournaments + one login — for the
whole club, on phones they already own.

---

## 4. GUARDIAN / CHILD REGISTRATION — YOUR QUESTION, ANSWERED

**Do the forms exist?** **Yes.** Live flow: a club's public landing page (`VenueLanding.jsx`) →
`MembershipSignup.jsx`, a multi-step wizard. Backed by real RPCs (`member_register_child`,
`member_update_child`, `member_accept_consent`, `member_enrol_membership`).

**Are they complete / official?** **Substantially — pilot-ready, CPSU-aligned.** Captured:
- Child: name, DOB, relationship to guardian.
- **Two emergency contacts** (name/relationship/phone).
- **Medical** (conditions, allergies, medications, GP) — and consent is *forced* if any medical
  field is filled.
- SEND / disability notes, dietary notes, authorised collectors, "may leave unaccompanied".
- **Granular photo consent** (website / social / press / marketing).
- **E-signed, versioned policy documents** — typed signature + **IP + timestamp + user-agent**
  stored per signer (auditable); guardian signs on the child's behalf.
- **GDPR right-to-erasure** implemented (scrubs PII + consents).

**Do we support uploads?** **Yes — ID documents.** Passport / birth certificate / PASS card,
uploaded to a **private** storage bucket, with **operator approve/reject** and an audit trail.
(Only shown if the club switches on the ID requirement.)

**Honest gaps to be ready for if they ask:**
- **No child *photo* upload** (a face photo) — only photo *consent* checkboxes. If they want
  member photos, that's a small build.
- **Email isn't verified** at signup (no confirmation code).
- **Address is free-text** (no postcode lookup).
- Only the **ID-document** upload slot exists — no general "upload a medical letter" slot yet.
- Second-guardian invite is schema-only (one guardian captured at signup).

*Good line for tomorrow:* "Registration is safeguarding-ready for the pilot — emergency
contacts, medical, e-signed consents with an audit trail, and ID-document upload with approval.
If you need member photos or extra document types, that's a quick add — tell me what's mandatory
for you."

---

## 5. WHAT'S SOLID vs WHAT TO AVOID ON STAGE

**Lean on (proven, seeded, real-time):** venue back office, memberships + pass + grading/belts,
classes/PT booking, the league fixtures + standings, **ref → reception-TV live updates**,
tournament bracket page, and the **one-login switch**.

**Avoid or pre-test (known rough edges — see §6):**
- The **"My Squads" multi-squad list can show empty** when sign-ups for the week aren't open
  (real bug) — risky during the multi-role moment. **Test with your demo account first**, or let
  me fix it tonight.
- A **paused** membership pass shows *"Frozen until 1 Jan 1970"* (cosmetic) — Sam's boxing pass.
- Landing on **Classes** with no club picked shows a confusing "no venue linked" message.
- **Casual-match ref assignment** has no button yet — use a **league/tournament** fixture's ref
  token for the ref demo (those work fully).
- Don't pitch **3v3** as a built feature — the league engine is format-agnostic but no 3v3
  league is seeded (see §6).

---

## 6. PRE-DEMO CHECKLIST (decide tonight)

- [ ] **3v3 branding:** if you want the reception TV to literally say "3v3 League", I can seed a
      3v3-labelled league + a few live fixtures (~30 min). Otherwise we show the seeded
      competitive league as "live league data".
- [ ] **Fix the My Squads empty-list bug** (recommended — it sits on your centrepiece multi-role
      moment). Small, targeted fix.
- [ ] **Fix the two cosmetics** (1970 freeze date, Classes message) — optional, quick.
- [ ] **Dry-run** Acts 2–4 once with the real accounts so nothing surprises you live.
- [ ] Confirm OTP inbox access (`tarny@lettrack.co.uk`) in case SSO sign-in needs a fallback.

---

*Owed from the SSO work: real-iPhone cross-app walk + consumer-app unified-login re-test. The
demo itself is browser-based, so neither blocks tomorrow.*
