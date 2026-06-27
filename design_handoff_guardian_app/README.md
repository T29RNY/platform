# Handoff: In or Out — Guardian (Parent) mobile app + operator additions

## Overview
This package documents the **mobile (phone) experience** for the *In or Out* venue/club platform, focused on the **Guardian (parent) role** plus the **operator-facing features built alongside it** (broadcast messaging, incident resolution, the shared live-match screen, and the tournament screen).

A Guardian is a parent/carer of one or more junior players. Their app is read-mostly: follow their children's matches, league position, membership & fees, club communications, and complete registration documents. Operators (owner / manager / venue staff) get the tools that feed those consumer surfaces (sending broadcasts, resolving venue incidents, running tournaments).

## About the design files
The files in this bundle are **design references created in HTML/React-in-the-browser (Babel)** — prototypes showing intended look and behaviour. **They are not production code to ship.** The task is to **recreate these designs in the target codebase's existing environment** (React Native / Swift / Kotlin / Flutter / web — whatever the real app uses), following its established components, navigation, and data layer. If no environment exists yet, pick the most appropriate mobile framework and implement there.

The prototype is a single phone canvas (390×844, iPhone-style) that scales to fit. All "screens" are either **primary tab views**, **secondary stacked views** (with a back button), or **bottom sheets** (modals). Recreate these with the target platform's native navigation + modal patterns.

## Fidelity
**High-fidelity.** Final colours, typography, spacing, copy, and interactions are all intentional. Recreate pixel-faithfully using the codebase's component library, mapping the design tokens below onto the existing system. Where this prototype hand-rolls a control (toggles, segmented controls, sheets), prefer the platform/native equivalent.

## Scope — what to build vs. leave alone
**In scope (this handoff):**
- The **Guardian (parent)** app in full: Matches, League, Membership, More hub, Team, Schedule, Club notices, Documents, Profile.
- The **shared Live Match** screen (read-only match centre).
- The **Tournament** screen + its "live now" banner.
- **Operator additions** that pair with the above: **Broadcast composer** (+ read receipts), **Resolve incident** sheet.
- Cross-cutting: **light/dark theme**, **Stripe** payment framing, the **one-way broadcast** model.

**Explicitly OUT of scope — do NOT touch or rebuild:**
- The **casual player** view.
- The **internal-league player** view (the "Member" role in the prototype shares consumer code with Guardian, but the player-facing product is owned elsewhere — do not re-implement it from this package).
- The **referee / match-control** view (already built separately; this package only consumes the live data it produces).
- The pre-existing **operator console base** (Operations list, Bookings calendar, Payments ledger, People directory) except where a new sheet is attached (Resolve incident, Broadcast) — treat those base screens as already-existing.

> The prototype contains a role switcher (Owner/Manager/Staff/Guardian/Member) purely so reviewers can preview each persona. **It is a prototype affordance, not a feature** — do not ship a role switcher. The real app derives role from the authenticated account.

---

## Design tokens

**Type:** `DM Sans` (Google Fonts), weights 400/500/600/700/800. Tabular-numeral variant (`font-variant-numeric: tabular-nums`) is used for all scores, times, money, and table figures — keep it. Headings use letter-spacing ≈ `-0.02em`; eyebrow/overline labels are 11.5px / 700 / uppercase / letter-spacing `0.13em`.

**Colour — dark theme (default):**
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#07090F` | page behind device |
| `--app` | `#0A0D14` | app background |
| `--s1` | `#11151F` | base card |
| `--s2` | `#171C28` | elevated surface |
| `--s3` | `#1F2533` | input / hover |
| `--s4` | `#2A3140` | deepest control |
| `--hair` | `rgba(255,255,255,0.07)` | hairline divider |
| `--hair2` | `rgba(255,255,255,0.12)` | stronger border |
| `--ink` | `#F3F5F9` | primary text |
| `--ink2` | `#B6BECC` | secondary text |
| `--ink3` | `#7C8493` | tertiary/labels |
| `--ink4` | `#565E6D` | faint/disabled |
| `--amber` | `#FFC83A` | brand accent (sodium amber) |
| `--amber-deep` | `#E0A91E` | accent gradient end |
| `--amber-soft` | `rgba(255,200,58,0.14)` | accent tint bg |
| `--amber-glow` | `rgba(255,200,58,0.30)` | accent shadow |
| `--live` | `#F5483B` | live / urgent |
| `--live-soft` | `rgba(245,72,59,0.16)` | live tint |
| `--ok` | `#1FC98B` | success/positive |
| `--ok-soft` | `rgba(31,201,139,0.15)` | success tint |
| `--info` | `#4F8CFF` | info |
| `--info-soft` | `rgba(79,140,255,0.15)` | info tint |
| `--ok-ink` | `#46E3AC` | success **text/glyph** on dark |
| `--live-ink` | `#FF7A70` | live **text/glyph** on dark |
| `--info-ink` | `#87B0FF` | info **text/glyph** on dark |

Buttons/fills on `--amber` use **`#1A1403`** (near-black) as their foreground.

**Colour — light theme** (applied via `[data-theme="light"]`, warm paper neutrals): `--app #F4F2EC`, `--s1 #FFFFFF`, `--s2 #F7F5EF`, `--s3 #ECE9E0`, `--s4 #E1DDD2`, `--ink #1B1E25`, `--ink2 #454A54`, `--ink3 #767B85`, `--ink4 #A3A8B1`, hairlines `rgba(28,26,22,0.09/0.16)`; accent deepens to `--amber #E8A516`; semantic inks deepen (`--ok-ink #0E9C68`, `--live-ink #D2392C`, `--info-ink #2D5FD0`). The accent stays amber in both themes.

**Radii:** `--r-xl 26px`, `--r-lg 20px` (cards), `--r-md 15px`, `--r-sm 10px`; pills are fully rounded (999px); avatars circular.

**Spacing:** card padding typically 12–16px; screen gutters 18px; inter-card gap 8–11px; section headers `margin: 22px 2px 11px`.

**Shadows:** cards use a layered inset-highlight + drop shadow (`--shadow-card`); sheets `0 -20px 60px rgba(0,0,0,0.6)`; reduce/soften for light theme.

**Motion:** view enter = slide-up 12px over .34s `cubic-bezier(.2,.8,.25,1)`; sheets slide up .42s; score changes "pop"; the live "dot" pings. Respect `prefers-reduced-motion` (the prototype disables animations under it — keep that).

---

## App shell (chrome that wraps every screen)

**Header** (sticky top): left = round avatar (initials; opens Profile) OR a back chevron when on a secondary view; centre = view title + a context sub-line; right = notification bell with a count badge (search icon is shown for operators only, hidden for guardians). For a Guardian, the context sub-line reads "`{Team} · {Division}`" and, when the guardian has 2+ children, a **child-switcher chip row** sits directly beneath the header (one pill per child: small crest + first name; active pill in amber tint).

**Bottom tab bar** (floating, blurred, rounded 26px): role-aware. Guardian tabs = **Matches · League · Membership · More**. Active tab is amber with an animated pill indicator; badges sit top-right of an icon.

**Bottom sheets**: modal, slide up from bottom, rounded top corners, grab handle, optional title row with close (✕), scrollable body, optional pinned footer with a primary action. Used for all detail/compose/confirm flows.

🔌 **Backend wiring (shell):**
- Authenticated session → resolves **role** and identity (name, email, avatar initials). No role switcher in production.
- **Children list** for the guardian (id, name, first name, age group, team, crest colours) → drives the child switcher; the **active child** is app-level state and every consumer screen is keyed to it.
- **Notification badge count** = unread/actionable items for the guardian (due fees + unsigned documents in the prototype) → fetch + realtime update.
- Theme preference persists locally (see Theming).

---

## Screen: Matches (Guardian home)
**Purpose:** the active child's football life at a glance.
**Layout (vertical scroll):**
1. **Live banner** — if the child's team is playing now: a full-width card, red ring, "LIVE" pill, competition + venue eyebrow, both teams (crest 26px + name) with the score (34px/800 tabular) and a **ticking match minute** + a thin live progress bar, and a footer status line ("ahead/level/behind" + last event). Tapping opens the **Live Match** sheet. If no live game: a muted card "No match in play right now — Next: {date} vs {opponent}".
2. **Up next** — upcoming fixtures. Each card: date block (left), opponent crest + name, Home/Away pill + venue, and an **availability control** ("Is {child} available?" → In / Out pills, green/red when chosen).
3. **Recent results** — W/D/L badge (green/grey/red), opponent crest, opponent + (H)/(A), date + the child's contribution, and the score.

🔌 **Wiring:** live fixture state + **realtime score/clock/events** for the child's team; upcoming fixtures; **availability RSVP** is a write (`POST availability {fixtureId, childId, status}`) that the team manager sees; recent results (read). The minute clock is derived from kickoff timestamp — compute client-side from a server kickoff time, don't poll for the minute.

## Screen: Live Match (shared sheet — read-only)
**Purpose:** match centre for any in-progress game. Opened from the Matches live banner, the operator's live cards, and any live tournament match — **one shared component**.
**Layout (tall sheet):** scoreboard hero (comp eyebrow, LIVE pill, two crests 50px, score 40px, ticking minute pill, live progress bar); a **follow toggle** ("Goal alerts — push when the score changes or at full time"; consumer) OR operator quick-actions ("To display", "Referee"); a **Timeline** card (newest first: "Match in progress" with current minute, then goals `Goal · {scorer}` with team crest + home/away tag, cards, … down to "Kick-off"); a **Details** card (Competition, Venue, Referee).
**Behaviour:** minute ticks live; timeline events are bounded to elapsed time.

🔌 **Wiring:** this is the **read model of the referee match-control feed** (already built elsewhere). Subscribe to the match's realtime event stream: score, clock state (running/HT/FT), and ordered events `{minute, type: goal|yellow|red|sub|ht|ft, side, player}`. Render-only. The **follow toggle** writes a per-user follow/alert subscription (`POST follow {matchId}` → enables push). "To display" (operator) pushes the match to the venue's reception display.

## Screen: League
**Purpose:** the child's division.
**Layout:** title "{League} · {Division} · {Round}", then a **segmented control: Table / Fixtures / Results**.
- **Table:** ranked rows (#, colour dot + team, W, L, GD coloured ±, Pts bold). The child's team row is highlighted amber with a "YOU" tag.
- **Fixtures:** next round's division fixtures (time, home crest+name v away crest+name; the child's team in amber).
- **Results:** last round's scores (winner bolded).

🔌 **Wiring:** standings table (server-computed from results), division fixtures + results by round. All read. Highlight is client-side using the active child's team id.

## Screen: Membership
**Purpose:** the active child's membership + money.
**Layout:**
1. **Membership card** — a coloured "club card" (team-gradient) with club name, plan, status pill, child name, renew date, and a deterministic faux-QR (member id).
2. **Plan details** — grouped key/value rows: Plan, Started, Renews, Status (Active pill).
3. **Fees & payments** — header shows "£X outstanding" (amber). If anything's due, an amber "**Settle outstanding fees**" summary button (opens the Pay sheet for all due). Then one row per fee: icon, label, sub + when, amount (tabular), and a "Pay now" (amber) or "Paid" (green) pill. Due rows are tappable → **Pay sheet**.
4. **Extra classes** — bookable programmes: icon, name, schedule sub, spaces-left (green), price, "Book" pill → **Book class** sheet.

**Pay sheet (Stripe):** lists the fee(s), a Total, and a **"Secure card checkout — Powered by Stripe · card details never stored"** row. Primary action "Pay £X · Card". **No stored card / card-on-file UI anywhere.**
**Book class sheet:** programme header, details (For {child} · {age}, Price, Availability), primary "Book · £X", note "Paid by card via Stripe secure checkout. Cancel free up to 48h before the first session."

🔌 **Wiring:** membership record + plan dates per child; fee ledger per child (each: id, label, amount, status paid/due, timestamps); programmes catalogue (id, name, schedule, price, capacity/spaces). **Payments go through Stripe** — the "Pay" / "Book" actions should create a Stripe Checkout/PaymentIntent (server-side) and confirm via Stripe's SDK; **never collect or persist raw card data**. On success, refresh the fee ledger / booking. Outstanding total and the header notification count derive from the ledger.

## Screen: More (Guardian hub)
A simple launcher sheet/list: **Team**, **Schedule**, **Club notices**, **Documents & consent**, plus a **Profile & settings** row. Each opens the matching screen.

## Screen: Team
**Layout:** team header card (crest, name, league·division, position pill + W-D-L record); **Coach** info row (name + "Team coach · sends your team's updates" — read-only, NOT a chat target); **Squad** list (number, name, position pill; the child's row highlighted with "Your child"); **Team broadcasts** — a read-only feed of messages from the coach/club (sender, time, body) with the note "Broadcasts are one-way — only your coach and club admins can post here."

🔌 **Wiring:** team profile + record (read); squad roster (read); **team broadcasts** = the messages this team has received (read; see Broadcast model). There is **no reply/chat** — do not wire a message-send for guardians.

## Screen: Schedule
**Layout:** "This week" agenda grouped by day; each item = time, icon (training/match/class), title, sub (venue / type). Matches are amber-accented.

🔌 **Wiring:** aggregate the child's training sessions + fixtures + booked classes into a date-sorted agenda (read). "Add to calendar" is a future hook.

## Screen: Club notices
**Layout:** list of broadcast cards received by this guardian: tone-coloured icon, title, timestamp, body, and a **sender line** (e.g. "Greenway Park", "Coach Marcus"). Read-only.

🔌 **Wiring:** the guardian's **received broadcasts** inbox (read + realtime for new ones; mark-as-read feeds the notification badge). Produced by the operator Broadcast composer (below).

## Screen: Documents & consent
**Purpose:** complete registration/consent forms for the child.
**Layout:** header "{N} need action"; list of document rows: status icon (green check = done, amber flag/box = action needed), title, sub, and a trailing pill — "Sign" / "Upload" / "Review" when due, or the completion date when done. Every row opens the **Document sheet**.
**Document sheet** — adapts to `kind`:
- **sign**: shows the consent text, an "I agree…" checkbox, a typed-name **e-signature** field, dated; primary "Sign & submit".
- **upload**: a dropzone ("Take photo or choose file", JPG/PDF) that shows the chosen filename; primary "Submit upload".
- **review** (form): read-only key/values (emergency contact, allergies, medical notes, GP) to confirm; primary "Confirm details".
- Completed docs reopen read-only ("a copy has been emailed to you").
Completing a doc flips its row to done with a fresh timestamp.

🔌 **Wiring:** per-child document requirements (id, title, kind, status, body/text, completion meta). **Sign** → store consent + signature + timestamp (legally binding e-sign record). **Upload** → file upload (image/PDF), virus-scan/verify, then mark complete; the proof-of-age copy note ("used once then deleted") implies a retention policy. **Review** → fetch the current medical/contact record + write confirmation. "Need action" count and the notification badge derive from due docs.

## Screen: Profile
**Layout:** identity header (avatar, name, email, role pill + team context); **Your children** (one row per child — crest, name, team·age; tap to make active; active row outlined "Active"); **Membership card** for the active child + (consumer) the Stripe "Payments" row; **Appearance** (Light / Dark / Auto segmented); **Notifications** (toggle rows); **Account** (Settings, Security via Google SSO, Help, Sign out). *(The "Viewing as / Club type" prototype panels at the very bottom are reviewer tools — omit in production.)*

🔌 **Wiring:** children list (drives switcher); notification preferences (read/write); appearance pref (local); auth/SSO + sign-out; account/settings deep-links.

---

## Screen: Tournament  (the headline feature)
**Purpose:** a dedicated, full screen for a live multi-day tournament. **Only surfaces while a tournament is live** — otherwise nothing shows. A **"LIVE {tournament}" banner** appears at the top of Operations (operators) and Matches (guardians) — "Day X of Y · N live now · tap" — and opens this screen. Operators can also reach it via More → Cups.
**Layout (vertical):**
1. **Hero** — trophy icon, name, "{age} · {cup} · {dates}", LIVE pill; chips: "Day X of Y", "Group stage", "{N} teams".
2. **Following** — matches involving teams the user follows (guardians auto-follow their child's team); same row style as live, amber-tinted.
3. **Live now** — in-progress matches (compact rows with ticking score) → tap opens the shared **Live Match** sheet.
4. **Filter** — horizontally scrolling team chips (crest + name) to filter all match lists; tap to toggle.
5. **Group stage** — A/B group segmented control → live-computed **group table** (#, crest+team, P, W, GD, Pts, and a **follow star** per team; top-two highlighted green to advance), then that group's **match list** (FT / live / upcoming rows).
6. **Knockout** — semi-finals → final **bracket** with seeds ("A1 v B2", "W·SF1 v W·SF2") and times; fills as groups finish.
7. **Footer** — **Public results page** card ("{url}", copy/QR action) + note "Referees update scores pitch-side — tables and brackets recalculate live."

**Match row component (shared across the tournament lists):** left team (name + crest, right-aligned), centre (score 16px or KO time + minute/FT/pitch), right team. **Live** rows are tappable (→ Live Match sheet) and tint amber if they involve a followed team.

🔌 **Wiring (tournament — this is the big one):**
- **Tournament lifecycle/state**: only render when an event is `live` (or within its window). Spans multiple days.
- **Structure**: groups → fixtures → group tables (server-computed standings, recalculated on each result) → knockout bracket that **auto-populates** as groups mathematically finish (seed resolution A1/B2 → actual teams; SF winners → final).
- **Realtime**: scores, clocks, and results stream in from the **referee match-control feed** (already built). Tables/bracket recompute live.
- **Follow**: per-user followed teams (`POST follow {teamId, tournamentId}`) → drives the "Following" section + push alerts (goals/results). Guardians default to following their child's team.
- **Public page**: a **no-login public results page** at a shareable URL (the in-app card copies/QRs it). Same live data, read-only, web-accessible. This is a deliverable in its own right.
- **Filters** are client-side over the loaded match set.

---

## Operator feature: Broadcast composer (+ read receipts)
**Purpose:** one-way messaging from admins/managers to teams/members. Reached from operator More → Broadcasts or the "Send broadcast" tile.
**Compose sheet:** note "One-way broadcast — recipients can't reply"; **audience** picker (role-aware — managers: My team / Guardians only / Players only; owners/staff: All members / A team / Age group / Guardians / Staff — each with a live recipient count; "A team"/"Age group" reveal a secondary picker); **message** textarea (600-char counter); **Mark important** toggle (pinned + alert push); **Delivery** = Send now / Schedule (reveals day + time chips); a delivery summary; a **Scheduled** queue; and a **Recently sent** list (each tappable → read receipts) with a read-% bar.
**Read receipts sheet:** the message, a "{seen} / {total} seen" progress header, a **Seen** roster (avatar, name, "✓ {time}") and a **Not seen yet** group, and a footer "**Remind {N} who haven't seen it**".

🔌 **Wiring:** audience resolution → recipient sets + counts (teams, age groups, guardians, players, staff). **Send** = create a broadcast (audience, body, importance) → fan out to recipients' notices feeds + push; **scheduled** sends enqueue for the chosen time. **Read receipts** = per-recipient delivered/seen state (realtime), and a "remind unseen" re-push action. Recipients see these in **Club notices** (guardian) / **Team broadcasts** (team) — strictly read-only, no replies.

## Operator feature: Resolve incident (sheet)
**Purpose:** complete + close a venue incident (attached to the existing Operations "Needs you" incident rows; tapping "Resolve" opens this sheet instead of clearing silently).
**Layout:** incident header (severity dot + text + sub + Critical/Warning pill); **Outcome** picker (Fixed / Made safe / Contractor booked / No fault found); optional **Resolution note** textarea; **Notify affected teams** toggle (defaults on for critical); primary "Mark resolved".

🔌 **Wiring:** resolve action = `POST incident/{id}/resolve {outcome, note, notify}` → closes the incident, logs the outcome, and (if notify) emits a broadcast to impacted teams/bookings.

---

## Interactions & behaviour (global)
- **Navigation:** tab views are top-level; detail/compose use bottom sheets; "More" items push secondary views with a back chevron. Switching the active child re-keys (remounts) the consumer views so per-screen state resets.
- **Toasts:** transient confirmation toasts (icon + text + sub) appear top-center after writes (pay, sign, send, follow, resolve…). ~2.7s auto-dismiss.
- **Availability / follow / toggles:** optimistic UI with a confirming toast.
- **Forms:** primary action disabled until valid (e.g. sign needs agree + name; pay needs an amount; broadcast needs a message).
- **Live data:** scores/clocks/timelines/tables update in realtime; minute clocks are derived from kickoff timestamps, not polled.

## State management
- **App-level:** authenticated role; **active child id** (guardian); theme; open sheet; toasts.
- **Per consumer screen:** keyed to the active child; local UI state (segmented tab, filters, RSVP selections, follow set, form fields) resets on child switch.
- **Server/realtime data:** fixtures, results, standings, live match feed, fee ledger, programmes, documents, broadcasts (sent + received), tournament structure/results, incidents.

## Assets
- **Font:** DM Sans (Google Fonts).
- **Icons:** a small inline line-icon set (stroke 1.7) defined in `m-data.jsx` (`Icon` registry: pulse, calendar, pound, users, card, shield, whistle, grid, trophy, list, cup, qr, bell, star, etc.). Map these to the codebase's icon library.
- **Team crests:** generated CSS gradients + initials from a team's two brand colours (`p`/`s`) — no image assets. Replace with real crest images where available.
- **Faux QR / membership card:** decorative in the prototype; replace with a real member-pass/QR if used for check-in.
- No raster images or brand artwork are required to recreate these screens.

## Files in this bundle (design reference — runnable prototype)
Open `Mobile Venue Dashboard.html` to run the prototype. Source is split by area:
- `Mobile Venue Dashboard.html` — entry; loads the scripts below.
- `m-styles.css` — all styling + design tokens + light/dark themes.
- `m-data.jsx` — data model, roles & nav model (`ROLES`, `NAV`, `tabsFor`), theme module, `PROFILE` (incl. guardian children + per-child membership/fees), team registry, icon registry, helpers.
- `m-app.jsx` — app shell: header, child-switcher, tab bar, sheet host, router.
- `m-guardian.jsx` — Matches, League, Membership, Pay/Book sheets, consumer "world" data.
- `m-guardian-more.jsx` — Team, Schedule, Club notices, Documents + Document sheet.
- `m-livematch.jsx` — shared Live Match sheet + match-object builders.
- `m-tournament.jsx` — Tournament screen, live banner, shared match row.
- `m-broadcast.jsx` — Broadcast composer + read-receipts sheet.
- `m-ops.jsx` — operator Operations (existing) + **Resolve incident** sheet + live-card primitives.
- `m-more.jsx` — More launcher (operator + consumer), Profile, Standings, Search.
- `m-views.jsx`, `m-booking.jsx` — operator Bookings/Payments/People + booking/payment sheets (existing base; reference only).

> Reminder: implement the **Guardian** experience + the operator additions + tournament/live-match per this README. Do **not** rebuild the casual-player, internal-league-player (Member), or referee views from this package.

## Screenshots
Annotated captures of the prototype are in `screens/`. Dark theme; phone canvas.

**Operator-side (`screens/NN-op.png`):**
- `01-op` — Operations home with the live **tournament banner** at the top.
- `02-op` — **Tournament** screen (hero, Live now, Filter, Group A table).
- `03-op` — **Live Match** sheet (opened from a live tournament match) — score, clock, follow/quick-actions, timeline.
- `04-op` — Operator **More** ("All views" launcher).
- `05-op` — **Broadcast composer** (audience, message, delivery, scheduled queue, recently sent).
- `06-op` — **Read receipts** sheet (seen/not-seen roster, remind action).
- `07-op` — Operations scrolled to the **"Needs you"** incidents.
- `08-op` — **Resolve incident** sheet (outcome picker, note, notify toggle).

**Guardian-side (`screens/NN-guardian.png`):**
- `01-guardian` / `02-guardian` — **Profile** sheet (the `02` capture shows it after selecting the Guardian persona; in production this is just the signed-in guardian's profile — children list, membership card, Stripe payments row, appearance, notifications).
- `03-guardian` — **Matches** (live banner, Up next with availability, recent results) + the child-switcher chip row under the header.
- `04-guardian` — **League** (table with the child's team highlighted).
- `05-guardian` — **Membership** (card, plan, fees with outstanding, extra classes).
- `06-guardian` — **Pay fee** sheet (Stripe secure checkout, no stored card).
- `07-guardian` — Guardian **More** hub.
- `08-guardian` — **Documents & consent** list (sign / upload / review states).
- `09-guardian` — **Document sheet** (sign consent: text, agree, e-signature).
- `10-guardian` — Guardian **Profile** (children, active child, appearance, notifications).

> Captures show the top of each scrollable screen. Run `Mobile Venue Dashboard.html` for the full, live, interactive reference (scroll, switch child, toggle light/dark, open sheets).
