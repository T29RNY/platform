# CLUB_PAGE_DESIGN_BRIEF.md — In or Out, Public Club Page ("Pitchero destroyer")

**Hand this file to Claude Design.** It returns `CLUB_PAGE_DESIGN_HANDOFF.md` (format at the foot).
This design track runs IN PARALLEL with the backend build — the data foundation, public-read RPC,
and admin-write RPCs (Phases 1–3) are wireframe-independent and ship first; **these wireframes drive
Phases 4–5**. Decisions: DECISIONS.md s213 ("Modular Platform Epic B"). Plan of record:
`MODULAR_PLATFORM_HANDOFF.md` (Epic B). Tracker: FEATURES.md. You do **not** need codebase access —
this brief is self-contained.

---

## Product

In or Out is a grassroots/amateur football platform: clubs run teams, players mark availability,
matches auto-create, results and stats flow from a live engine. **Epic B is the club's public face** —
a branded, shareable home page at **`/c/<slug>`** (e.g. `/c/finbars`) that anyone can visit without an
account. It is the shop window. Two artefacts to design:

1. **The public club page** (`ClubPublicScreen`) — what the world sees.
2. **The setup wizard + edit dashboard** (`ClubSettingsScreen`) — how a club manager builds and
   maintains the page, ideally in two minutes flat.

The competitor is **Pitchero / 360Player** — club-website builders. We are not trying to out-CMS them.
We win on a different axis, explained next. Read the North Star before designing anything.

---

## THE NORTH STAR — floor vs ceiling (read this first)

We studied two real sites at opposite ends of the market. They define the floor we must clear and the
ceiling we aim at — **and they run on the same kind of data.** The gap between them is pure
presentation and production value, not budget or technology.

### The floor — santosafc.co.uk (built on 360Player)
A real, well-run Oldham club: ~20 teams, U7s to seniors, 28 sponsors. And yet:
- **The hero is an unconfigured template placeholder** — stock photos and the literal text
  "Slide title". They never filled it in. *This is the norm, not laziness.*
- **It's a dead noticeboard** — identical on a Saturday kickoff as on a wet Tuesday. Fixtures are
  buried behind a "Match Centre" link.
- **No news, no people, no stats** on the homepage. All structure, zero story.
- **28 sponsor logos in a grey graveyard** — worth nothing to the sponsor.

**The lesson: these tools make a good page *possible* but not *automatic*, so clubs end up with a
half-built brochure that decays.** Design must assume the club configures almost nothing.

### The ceiling — ballerleague.uk (entertainment-first 6-a-side league)
- **A live data dashboard IS the homepage** — Table / Fixtures & Results / Player stats / Team stats,
  tabbed, front and centre. You return because it updates.
- **People sell it** — teams fronted by personalities; you follow the human, then the team.
- **Stats as a leaderboard, as entertainment** — "leads goals (22)", "leads shots (83)" — a thing to
  climb, not a grid to scroll.
- **A novel metric makes a story** — their invented "EP / Pressure Point" system manufactures
  narrative on top of normal football.
- **Sponsors as partnership, not a dump** — a curated few, integrated, premium.
- **Motion is event-driven, not decorative** — confetti only on celebratory moments; otherwise clean.

### The mandate
> **Floor (Santos): great tools, dead result. Ceiling (Baller): great result, big production team.
> Us: Baller-level result with ZERO production effort — auto-built from the engine's data.**

A Sunday-league side must get a slice of Baller-League production value — a live table, a leaderboard,
a POTM card, confetti on a win — **generated from their data without them lifting a finger.** Design
the *output* to look like Baller League for a club that does *nothing* like Santos. That single
constraint is the whole competitive edge; neither incumbent does it.

---

## Who actually visits — design for THIS person

From the Santos study, the real grassroots club is:
- **A federation of ~20 teams, not one team.** No visitor cares about the whole club — a parent cares
  about *one* team, "U9 Tigers". The page must present the club **and** let someone drill straight to a
  single team's mini-view (next fixture, training time, who's playing) and bookmark it.
- **Parent-facing, not player-facing.** Most teams are children. So: (a) **safeguarding is the dominant
  render path, not an edge case** — minors' surnames and photos are hidden server-side before the page
  ever sees them; design assuming "Jack T." and an avatar placeholder are normal, not exceptional;
  (b) the "Join" funnel is really **"a parent registers their child"**.
- **Volunteer-run and broke.** Clubs run on fringe revenue (shop, lottery, sponsors) and are desperate
  for volunteers (coaches, refs). The page needs a flexible **call-to-action / links block** so a club
  can bolt on "Buy lottery tickets" / "Volunteer to coach" / "Shop" without us building each.
- **Set-and-forget.** The "Slide title" placeholder proves it: clubs configure once and never return.
  **Anything that needs weekly manual updating will rot.** Freshness must come from auto-data, not
  effort.

We are not really competing with 360Player — **we're competing with the club's Facebook page.** "What's
happening" lives on social *because the website is dead*. An alive page that produces shareable cards
reclaims that job and feeds their social instead of losing to it.

---

## The seven page-level "wow" moves (the design targets)

Ranked by demo impact. The first four lean on live data (our unfair advantage — a static builder
physically cannot do them); the last three are pure page craft.

1. **A hero that changes through the match-day week.** Pre-match: countdown + opponent + "11 confirmed,
   3 needed". Live: the score. Post-match: result + report + photos. Same page, four states across a
   week. Design **all four hero states**.
2. **Live league position *with meaning*** — not a bare table: "3rd, 2 points off promotion, next up vs
   2nd place". One line of context beats a 20-row grid.
3. **Stats as identity** — top scorer, POTM, appearances shown as **player cards** (FIFA-card energy),
   a player-of-the-month, a leading-scorer board. Make our own novel metric — **reliability** ("most
   reliable player this season") — a badge people chase, the way Baller leans on EP.
4. **Result cards worth sharing** — an auto-generated "We won 3–1" graphic a manager would paste into
   the team WhatsApp, plus a proper social-share unfurl (Open Graph preview) and a match-day poster
   with QR.
5. **It looks like a real club** — full-bleed hero, the club's three colours done *properly*, real
   typography, restrained event-driven motion. The reaction: "that doesn't look like an amateur club."
6. **The "Play for us" funnel on the page** — a live Join / trial CTA with QR and "we train Tuesdays
   7pm" front and centre, not buried three clicks deep.
7. **Sponsors worth selling** — clickable, "this match sponsored by X", a curated strip that makes a
   local plumber's logo feel valuable, not a 28-logo graveyard.

---

## Screens to design

### A. Public club page — `ClubPublicScreen` (`/c/<slug>`)
Mobile-first (most traffic is a parent on a phone), but must hold up on desktop. Modular: each section
can be toggled on/off and reordered by the club (`sections` config), so design each section as an
independent block that survives being present, absent, or reordered.

1. **Hero — design all four states:** pre-match (countdown, opponent crest, venue, "N confirmed / M
   needed"), **live** (score, clock, period), post-match (result + link to report), and **idle/off-week**
   (crest, tagline, next fixture date, Join CTA). Plus the **empty/un-set-up** state — and this one must
   *still look good* with only crest + colours, because that's the Santos club. **The hero must impress
   with zero manual configuration.**
2. **Identity band** — crest, club name, tagline, discipline, primary social links.
3. **Match hub (Baller-style, tabbed)** — Fixtures & Results, Table (with the "meaning" line), and a
   stats/leaderboard tab. This is the heart of the page; lead with it.
4. **Teams** — the federation. A grid/list of all teams (Senior / Youth / Foundation grouping), each
   linking to a **single-team mini-view** (next fixture, training slot, squad with safeguarding
   applied). Stress-test at **20+ teams**.
5. **People / stats** — leading scorer, POTM / player-of-the-month, reliability leaderboard, as cards.
6. **News** — published posts (title, hero image, date, author), a latest-first feed, plus a single
   **post detail** view.
7. **Sponsors** — the curated, premium treatment (not a graveyard).
8. **Join / Get involved** — recruitment CTA (register a child, trial, training times) + the flexible
   **links block** (volunteer, shop, lottery, donate — club-supplied label + URL).
9. **Footer** — contact, full social row, "powered by" lockup.
10. **Share artefacts** — the result card and match-day poster (designed as standalone shareable
    graphics, not just on-page elements).

States for every section: **loading / empty / populated**, plus **unpublished/preview** (the manager
viewing their own draft) and **section-disabled** (it simply isn't there).

### B. Setup wizard + edit dashboard — `ClubSettingsScreen`
The antidote to "Slide title". A manager must reach a publishable, good-looking page in ~2 minutes.

- **Wizard (first run), stepped:** identity → crest upload → colours (with a **contrast guard** and
  **auto-suggest palette from the crest**) → hero image → choose & order sections → confirm teams →
  sponsors → first news post → safeguarding confirmation → **live preview → publish**. Every step
  pre-filled from data the club already has; every step skippable with a sensible default so the page
  is never empty.
- **Edit dashboard (always-on after setup):** the same controls as an always-available manage surface —
  edit identity/branding, toggle & reorder sections (drag), manage sponsors (add/reorder/remove),
  manage posts (draft/publish/delete), and a persistent **"view live page" / publish-state** indicator.
- **Image uploads:** crest, hero, sponsor logos, post images — design the upload control with
  in-progress, success, and replace states. (Engineering handles resize/compress + orphan cleanup.)

States: empty (nothing set up), partially complete (resume the wizard), published, unpublished/draft,
upload-in-progress, validation error (e.g. colour contrast too low, slug taken).

---

## Brand / constraints

- **Per-club theming is the whole point** — the page is re-skinned from the club's **three colours**
  (`primary_colour`, `secondary_colour`, `accent_colour`) scoped to the page container (no global theme
  mutation). Design with colour as a **prop**, so one layout renders as any club's brand. Show your
  components under at least two contrasting club palettes.
- House platform tone elsewhere is **Bebas Neue / condensed** for headings & numbers, **DM Sans** body,
  **Phosphor-thin** icons — but you have a **free hand** here; the public page may have its own
  character. Keep it prop-driven and presentational so it can be re-skinned to house tokens on the way
  in.
- **Motion: event-driven only** (confetti on a win/MVP reveal, a subtle live pulse) — never decorative.
- Mobile-first; the hero and match hub must be flawless on a phone.

---

## Data contract appendix (use these field names; lay out real data, not lorem ipsum)

The page is fed by a single read; the manager surface by the page record plus lists. Field names below
are the live backend shapes (Phase 1 schema + existing engine data).

**`club_pages`** (1:1 with a club — the page record):
`slug` (text, the `/c/<slug>` address) · `published` (bool) · `primary_colour` `secondary_colour`
`accent_colour` (hex strings, any may be null) · `crest_url` `hero_url` (urls, may be null) ·
`tagline` (text) · `about` (text) · `socials` (object: `{facebook, instagram, x, youtube, tiktok,
website}`, any may be empty) · `sections` (array of `{key, enabled, order}` — controls which blocks
render and in what order).

**`clubs`** (identity/structure, already exists): `name` · `short_name` · `discipline` (e.g.
"football") · `contact_name` · `contact_email`.

**Teams** (the federation): grouped by **cohort** `{category}` (one of `youth` / `adult` / `mixed`),
each cohort holding **teams** `{name, gender, priority_rank}` (e.g. cohort "Foundation" → "U9 Tigers"
(youth, mixed), "U9 Lions"…). Expect 15–25 teams.

**Fixtures / results / table** (from the league engine, per team or club): a fixture is `{date,
home_team, away_team, venue, kickoff, status}`; a result adds `{home_score, away_score}`; a table row is
`{position, team, played, won, drawn, lost, goal_difference, points}`. The "meaning" line is derived
(position vs promotion/relegation + next fixture).

**Stats / people:** leading scorer `{player_name, goals}` · POTM / player-of-month `{player_name,
votes}` · **reliability** `{player_name, reliability_pct}` (our novel metric) · appearances. **All
player names pass through safeguarding** — for minors the surname is already truncated ("Jack T.") and
photos suppressed before the page receives them. Design for that as the default.

**`club_sponsors`** (list): `name` · `logo_url` · `website_url` · `display_order` · `active`.

**`club_posts`** (news list + detail): `slug` · `title` · `body` · `hero_url` · `author_name` ·
`status` (`draft`/`published`) · `published_at`.

**Join / links block:** the recruitment CTA plus a club-supplied array of `{label, url}` (volunteer,
shop, lottery, donate…). A tournament-hub link `/tournament/<slug>` may also be present.

---

## The handoff contract — what to deliver back (`CLUB_PAGE_DESIGN_HANDOFF.md`)

1. **Presentational UI only.** Vite + React + plain CSS (CSS custom properties — no Tailwind, no
   component library). `.jsx` components + CSS; semantic HTML/CSS prototypes also fine (they'll be
   ported).
2. **No data, no backend.** Every component takes data as **props** matching the field names above.
   Assume data arrives ready-made. Colours arrive as props (per-club theming).
3. **Design every state** listed per screen — especially empty, unpublished/draft, and the
   **zero-config hero** (the Santos club). The empty states are where we beat the competition.
4. **Cover all four hero states + 20+-team teams block + the share artefacts.**
5. **Realistic content** from the data contract — long team names, a 22-row table, a club with 28
   sponsors, a youth team where every surname is truncated, a club that has set *nothing* but crest +
   colours.
6. **Floor-vs-ceiling is the brief.** Make a do-nothing club's page look like it had a production team.
</content>
</invoke>
