# In or Out — Apple App Store listing pack (Stage 4)

**Purpose.** Everything 🤖 can prepare ahead of the build machine, ready for the operator (👤)
to paste straight into **App Store Connect**. Covers checklist items **4.3** (listing copy),
**4.4** (App Privacy labels), **4.6** (reviewer demo-account note), and the **4.1** screenshot spec.

**Scope = APPLE ONLY.** Google Play is parked until after Apple approval (operator decision s160).
Play graphics (4.2), IARC (4.5) and the Data Safety form are deliberately **not** in this doc.

**Reserved App Store name:** `In or Out - Book & Play` (the app itself stays "In or Out").
**Category:** Primary = **Sports**. (No sensible secondary; leave blank or **Lifestyle**.)
**Support URL:** `https://in-or-out.com` · **Support email:** `support@in-or-out.com`
**Marketing URL:** `https://in-or-out.com` · **Privacy Policy URL:** `https://app.in-or-out.com/privacy`
**Age rating target:** 13+ (under-18s only via a supervising parent/guardian — see item 1.3).
**Bundle ID:** `uk.inorout.app` · **Apple Team ID:** `JCC44FW6XR`.

> All copy below sits inside Apple's field limits (counted at authoring). If the operator edits,
> re-check: App Name ≤30, Subtitle ≤30, Promotional Text ≤170, Keywords ≤100, Description ≤4000.

---

## 4.3 — App Store listing copy

### App Name (≤30 chars)
```
In or Out - Book & Play
```
*(23 chars. Exactly the reserved name — do not change without re-reserving.)*

### Subtitle (≤30 chars)
```
Who's in for the match?
```
*(23 chars. Leads on the core in/out availability primitive — the product's wedge.)*

Backup subtitle options (if the operator prefers):
- `Sort your squad, fast` (21)
- `Football squads, sorted` (23)
- `Run your team & your venue` (26)

### Promotional Text (≤170 chars — editable any time without re-review)
```
The fastest way to find out who's actually playing. Tap in or out, see your squad fill, get a
match-day nudge. Free for players and organisers.
```
*(150 chars.)*

### Keywords (≤100 chars — comma-separated, NO spaces, singular forms, no repeating the app name)
```
football,squad,5aside,6aside,availability,organiser,attendance,team,league,kickabout,booking,gym
```
*(96 chars. Notes: Apple ignores the app name + category in keyword matching, so they're omitted
to save space; comma-without-space is the documented way to maximise the field.)*

### Description (≤4000 chars)
```
In or Out is the fastest way to find out who's actually turning up.

No more scrolling a group chat full of "maybe", "lemme check" and "out this week sorry lads". One
tap — in or out — and your whole squad sees who's playing, who's not, and whether you've got
enough for a game.

WHY PLAYERS LOVE IT
• One tap to say you're in or out — that's the whole thing
• See the squad fill up in real time
• Get a match-day reminder so you never forget to respond
• Reserve list fills your spot automatically when someone drops out
• Your stats, appearances and Player of the Match votes, all in one place
• Free, forever, for players and organisers

WHY ORGANISERS LOVE IT
• Stop chasing people for answers — the app does it for you
• Know your numbers days before kick-off, not an hour before
• Track who's paid and who owes, without the awkward reminders
• Run casual games, leagues and cup competitions from one place
• Add guests, manage the squad, and pick Player of the Match

BUILT FOR MORE THAN ONE MATCH
In or Out grows with you — from a Tuesday-night kickabout to a whole club:
• Venues run their bookings, leagues and a live reception display
• Clubs and gyms run memberships, classes, gradings and fight records
• Referees run the match clock, score and cards from the touchline
Turn on only what you need. The player app is always free.

NATIVE, NOT JUST A WEBSITE
• Push notifications when availability is needed or a game is on
• Open a team link straight into the app — no copy-pasting URLs
• Works offline: a clean fallback screen when you lose signal
• Sign in with Apple, or with email — your choice

In or Out is for anyone who organises recurring football: 5-a-side regulars, 11-a-side clubs,
work teams, lunchtime leagues. If you've ever sent "anyone for Tuesday??" into a group chat,
this is for you.

Download free. Get your squad in.

—
Questions? support@in-or-out.com
Privacy: https://app.in-or-out.com/privacy · Terms: https://app.in-or-out.com/terms
```
*(~1,750 chars — comfortably under 4000. Note the "NATIVE, NOT JUST A WEBSITE" block: it does
double duty as the public pitch AND the on-listing evidence for the Guideline 4.2 defence.)*

### What's New (version notes — for the first release)
```
First release of In or Out on the App Store. One tap to say you're in or out, real-time squad
lists, match-day reminders, and Sign in with Apple. Free for players and organisers.
```

### Marketing / support URLs recap (paste targets)
| Field | Value |
|---|---|
| Support URL | `https://in-or-out.com` |
| Marketing URL | `https://in-or-out.com` |
| Privacy Policy URL | `https://app.in-or-out.com/privacy` |
| Primary category | Sports |
| Secondary category | (leave blank, or Lifestyle) |

---

## Guideline 4.2 defence (read alongside 4.3 + 4.6)

A remote-URL Capacitor wrap of a web app is the single most likely rejection reason
("minimum functionality / this is just a website"). The defence — three things a plain Safari
bookmark **cannot** do, all already built:

1. **Native push notifications** — APNs device tokens captured in the wrapped build and delivered
   server-side (`api/notify.js` APNs path; schema mig 368 `push_subscriptions.platform`; key
   `9KPP827P4U` live in Vercel). Availability nudges + match-on alerts arrive as real iOS push.
2. **Universal / deep links** — `apple-app-site-association` live + accepted by Apple's CDN; a
   `/p/<token>`, `/admin/<token>` or `/m/<token>` link opens **inside the app** and routes to the
   right screen (`native-shell.js` `appUrlOpen` handler).
3. **Offline shell** — a branded, zero-network fallback screen (`offline.html`) served by the
   service worker and wired as the Capacitor `errorPath`, so the app degrades gracefully with no
   signal instead of showing a dead webview.

Plus **Sign in with Apple** (native system-browser OAuth, `uk.inorout.app://auth/callback` deep-link
return) — included precisely because the app offers third-party sign-in (Google), which Apple
requires be matched by Sign in with Apple.

The reviewer note (4.6) states this explicitly. Keep that paragraph if the build is challenged.

---

## 4.4 — App Privacy labels (Apple "App Privacy" questionnaire)

Source of truth = the data audit banked in `APP_STORE_CHECKLIST.md` item **1.4** + the in-app
Privacy Policy (`Legal.jsx`). Convert as follows in App Store Connect → App Privacy.

**Tracking — global answer: "Data Not Used to Track You."**
No ad SDKs, no data brokers, no cross-app/cross-site linking. PostHog is EU-hosted
(`eu.i.posthog.com`), `person_profiles: identified_only`, `respect_dnt: true`, no ads, no sale of
data. Therefore **no data type is "Used to Track You"** — answer "No" to the tracking question for
every type below.

### Data types to declare as COLLECTED

| Apple data type | Sub-type | Linked to user? | Tracking? | Purpose(s) |
|---|---|---|---|---|
| **Contact Info** | Email Address | Linked | No | App Functionality (sign-in / account) |
| **Contact Info** | Name | Linked | No | App Functionality (squad identity) |
| **Contact Info** | Phone Number | Linked | No | App Functionality (club/gym membership signup) |
| **Contact Info** | Physical Address | Linked | No | App Functionality (club/gym membership signup) |
| **Contact Info** | Other User Contact Info | Linked | No | App Functionality (emergency contact name/relationship) |
| **Identifiers** | User ID | Linked | No | App Functionality; Analytics |
| **Identifiers** | Device ID | Linked | No | App Functionality (push token); Analytics |
| **Usage Data** | Product Interaction | Linked | No | Analytics |
| **Purchases** | Purchase History | Linked | No | App Functionality (fees owed/paid, booking status) |
| **User Content** | Other User Content | Linked | No | App Functionality (availability responses + notes) |
| **Other Data** | Other Data Types | Linked | No | App Functionality (date of birth + gender, membership signup) |

> **Why the membership fields are here:** the consumer app's club/gym **membership signup**
> (`MembershipSignup.jsx`) + member profile (`MemberProfile.jsx`) collect **phone, date of birth,
> physical address, gender and an emergency contact**. These surfaces only appear when a club/gym
> the user joins runs membership — but the data CAN be collected by the app binary, so Apple
> requires them declared. (Verified in source s161 — corrects the earlier "phone probably not
> collected" note.)

### Data types to declare as NOT COLLECTED (by this app)

- **Financial Info / Payment Info** → **Not collected by the app.** Card and bank details are
  entered with, and held by, **Stripe** and **GoCardless** via their own hosted flows under their
  own privacy policies; the app only receives a paid/unpaid *status* (declared above as Purchases →
  Purchase History). Do **not** tick Payment Info as collected.
- **Location** (precise or coarse) → not collected.
- **Health & Fitness** → not collected (sports appearance/POTM stats are not Apple "Health" data).
- **Contacts** (address book) → not accessed.
- **Browsing History / Search History** → not collected.
- **Sensitive Info** → not collected.
- **Diagnostics** (Crash / Performance / Other) → **leave unticked** unless the operator
  knowingly enables PostHog crash/performance autocapture in the native build; the banked 1.4
  audit lists only "App activity / app interactions" + "Device or other IDs", so the conservative,
  accurate answer is not-collected. (👤 confirm if that changes.)

### ⚠️ Operator note before submitting

- **Membership data is declared (resolved s161).** Source check found the consumer app DOES collect
  phone, DOB, physical address, gender and an emergency contact via the club/gym membership signup —
  all now in the COLLECTED table above. The earlier "phone probably not collected" recommendation is
  withdrawn. No further confirmation needed unless a surface is removed.
- **Sensitive Info stays UNticked.** DOB + gender are declared under "Other Data", not Apple's
  "Sensitive Info" bucket (which is racial/ethnic origin, sexual orientation, health, religious/
  political belief, biometrics, etc. — none collected). Keep Sensitive Info = not collected.

### Per-type questionnaire answers (the exact clicks)

For **each** collected type above, App Store Connect asks three things — answer identically:
1. *"Is this data used to track you?"* → **No** (for all).
2. *"Is this data linked to the user's identity?"* → **Yes** (for all of the collected types listed).
3. *"What is it used for?"* → tick the purpose(s) in the table:
   - Email, Name, User ID, Device ID, Purchase History, User Content → **App Functionality**.
   - Product Interaction, User ID, Device ID → also **Analytics**.
   (Apple lets a single type carry multiple purposes — tick both where the table lists both.)

Do **not** tick: Third-Party Advertising, Developer's Advertising/Marketing, Product
Personalisation (none apply).

---

## 4.6 — App Review demo-account note (App Store Connect → App Review Information)

Paste this into the **Notes** field. A demo account is provided so the reviewer can see every
gated surface without a real squad. (Sign-in fields: see the table — the consumer app is
OTP/Google only, so put the OTP email in the notes, not the username/password boxes.)

```
DEMO ACCESS — In or Out

This app is one consumer entry point onto a wider platform. The same app serves casual football
players, squad organisers, venue operators, club/gym members and referees; which surfaces a person
sees depends on the link they open or the account they sign into. Most everyday use needs no
password at all — players join and return via a personal team link (a "token link"), which is why
the app supports deep links and is not just a website (see Guideline 4.2 below).

EASIEST PATH — open a player link (no sign-in):
1. Tap this link on the device: https://app.in-or-out.com/p/p_demo_alex_token
   It opens the app as a real squad player: tap In/Out, view the squad, stats and Player of
   the Match. A second player link: https://app.in-or-out.com/p/p_demo_sam_token
2. Organiser/admin view (manage the squad, see who's paid, run the game):
   https://app.in-or-out.com/admin/admin_demo
3. Club/gym member pass (membership, classes, fight record / belts):
   open the app, then a /m/<token> member pass — the demo member passes are on the Alex account
   below (boxing + martial-arts).

FULL SIGN-IN DEMO ACCOUNT (covers every role):
- Email: tarny+demo@lettrack.co.uk
- This account is a venue owner, squad admin, casual + competitive player, and a member of two
  combat clubs (fight records + belt gradings).
- The consumer app signs in by EMAIL CODE (one-time passcode) or Sign in with Apple — there is no
  password on the consumer app. To sign in: choose "email code", enter the address above, and we
  will read back the code on request (it is delivered to our inbox). If a code is preferred in
  advance for review, contact support@in-or-out.com and we will coordinate timing.
- A second account, tarny+family@lettrack.co.uk, demonstrates the guardian-of-a-junior and
  venue-staff roles.

PAYMENTS ARE EXEMPT FROM IN-APP PURCHASE:
Any fees, memberships, class or pitch bookings in the app are payments for real-world services
(physical pitch time, in-person classes, gym membership, personal training) — Guideline
3.1.3(e)/3.1.5(a). They are processed by Stripe / GoCardless via a hosted checkout that opens in
the system browser and returns to the app; the app never takes a payment in-app. These flows are
also dormant in the demo and are not required to evaluate core functionality.

GUIDELINE 4.2 — WHY THIS IS A NATIVE APP, NOT A WEBSITE:
- Native push notifications (APNs) for match-day availability nudges and game-on alerts.
- Universal/deep links: a team link (/p, /admin, /m) opens directly in the app and routes to the
  correct screen, rather than bouncing through a browser.
- Offline fallback: a branded offline screen when the device loses connection.
- Sign in with Apple, implemented because the app also offers Google sign-in.

Contact for anything during review: support@in-or-out.com
```

### Demo-account quick reference (from DEMO_USERS.md — for the operator, not for the Notes field)

| Use | Value |
|---|---|
| Player token link (Alex) | `https://app.in-or-out.com/p/p_demo_alex_token` |
| Player token link (Sam) | `https://app.in-or-out.com/p/p_demo_sam_token` |
| Organiser/admin link | `https://app.in-or-out.com/admin/admin_demo` |
| Full sign-in (all roles) | `tarny+demo@lettrack.co.uk` — consumer app = **email OTP** (code lands in `tarny@lettrack.co.uk`) |
| Guardian + staff roles | `tarny+family@lettrack.co.uk` — email OTP |

⚠️ OTP delivery depends on Supabase Auth SMTP/rate limits; the request returns 200 even if the
email is slow. If Apple's reviewer can't receive the code, the **token links above need no sign-in**
and demonstrate the core loop on their own — lead the reviewer to those.

---

## 4.1 — Apple screenshot spec (assets shot on the wrapped build at Stage 5.2)

Screenshots are **captured during the real-device walk (5.2)** on the signed build, not now — but
the spec is fixed here so the shoot is a checklist, not a decision.

### Required sizes (App Store Connect, 2026)
- **6.7" / 6.9" iPhone — REQUIRED.** Portrait **1290 × 2796 px** (iPhone 15/16 Pro Max class).
  This single size satisfies Apple's current minimum; ASC down-scales it to smaller iPhones.
- **iPad** — only if the app is offered on iPad. The wrap is iPhone-first; **skip iPad** unless the
  operator opts in (then 13" iPad, 2064 × 2752 px).
- 2–10 screenshots per size. **Recommend 5–6.** First **2–3** are the ones that show in search —
  make them count.

### ⚠️ Blocker before the shoot
Item **1.5** (off-brand welcome screen) **must be fixed first** — it lives on the marketing
cinematic branch, not this track. Do not shoot the entry/welcome screen until that lands.
Also replace the upscaled `assets/icon.png` with a crisp 1024 export (item 2.2) before the App
Store icon is generated.

### Shot list (in search-priority order)
1. **The in/out moment** — a squad list mid-fill with the big In / Out control. The whole pitch in
   one frame. (Caption: "One tap. Who's actually in.")
2. **Squad filled / match on** — real-time squad with numbers, reserves, "game on". (Caption:
   "See your squad fill in real time.")
3. **Match-day push** — the lock screen or in-app reminder. Doubles as 4.2 native evidence.
   (Caption: "Match-day reminders so nobody forgets.")
4. **Organiser view** — manage squad, paid/owed, Player of the Match. (Caption: "Run the game,
   not the group chat.")
5. **Beyond one match** — venue reception display or club membership/classes surface. (Caption:
   "From a kickabout to a whole club.")
6. *(optional)* **Stats / Player of the Match** — appearances, POTM votes. (Caption: "Your stats,
   in one place.")

### Caption / framing rules
- Brand: IN = green, OR = neutral, OUT = red lockup; Bebas Neue headings, DM Sans body
  (matches the app + marketing).
- No device frame required by Apple, but keep status bars clean (full battery/signal, sensible
  clock). Capacitor status bar is dark-style (light icons) on `#0A0A08`.
- No pricing claims beyond "free"; no "best/№1" superlatives (avoids metadata rejection).
- Localisation: English (UK) only for v1.

---

## Status / ownership recap

| Item | Owner | State |
|---|---|---|
| 4.3 listing copy | 🤖 | ✅ DONE (this doc) — operator pastes into ASC |
| 4.4 App Privacy labels | 🤖 supplies / 👤 enters | ✅ answers DONE (this doc); 👤 to click through + confirm Phone |
| 4.6 reviewer note | 🤖 | ✅ DONE (this doc) — operator pastes into App Review Information |
| 4.1 screenshots | 🤖 spec / shot at 5.2 | ✅ spec DONE; assets owed at Stage 5.2 (after 1.5 fix) |
| 4.2 Play graphics | — | ⏸️ PARKED (Play deferred until after Apple approval) |
| 4.5 IARC age rating | — | ⏸️ PARKED (Google); Apple age rating questionnaire = item 4.5/1.3, 13+ |

**Doc-only cycle — no migration, no build change.** Next free migration still = **369**.
```
