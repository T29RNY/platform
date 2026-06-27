# In or Out — Public Club Page · Design Handover Package

Everything required to build the public club page (Epic B) + the manager wizard/dashboard.
Reconciled to the **locked backend contract** (see the build doc). Mobile-first, parent-first,
safeguarding-dominant, auto-built from engine data, re-skinned per club from 3 colours + crest.

## Start here
- **`docs/CLUB_PAGE_BUILD_HANDOVER.md`** — the single, authoritative build doc (read first).
  Real `get_club_public` payload, the 11 section keys + empty/degrade behaviour, hero rule,
  write ops, wizard rules, asset specs, scope summary. Supersedes the other docs on conflict.

## Folder contents
- **`designs/`** — 9 hi-fi design files + original wireframes (`.dc.html`). Open in a browser
  (canvas mode: pan / zoom / scroll). Keep `support.js` alongside them. Interactive: Football
  Baller (tabs + discipline switch), Gym Boxing (tabs), Destinations (match-day + join), Setup
  Wizard (clickable rail + section toggles).
- **`screenshots/`** — a zoomed-out overview PNG of each design canvas (numbered to match).
- **`docs/`** — build handover (authoritative) + composition spec, vocab proposal, design index,
  and the original brief.

## Design files ↔ coverage
1. **Football Baller** — football homepage; hero = next-fixture/result (no live ticker); fixtures
   (form-guide + FA-table-when-fed); stats (opt-in, no minors named) + discipline switcher
2. **Gym Boxing** — boxing homepage (timetable, reliability board, fighters, fight record)
3. **Hero States** — pre/post/idle/empty + two-palette theming proof + **thin-club full page**
4. **Team View** — single-team mini-view (per-team tables live here) + player profile
5. **Destinations** — match-day centre + Join CTA (deep-links the existing membership flow)
6. **Club Pages** — menu, About, Contacts (+ Welfare Officer), Documents, Events, News, Sponsors
7. **Share Artefacts** — result card, match-day poster, OG unfurl + loading/draft/404
8. **Setup Wizard** — 11-step canonical flow, 11 section keys, tightening-only safeguarding
9. **Manage Dashboard** — dashboard + news/sponsors/teams editors + draft⇄published

## Locked-scope notes (what changed to match the backend)
- **No live club-match ticker** — hero defaults to next-fixture / latest-result (the ~30s poll
  only swaps in a result). Live scores exist only on the tournament hub.
- **No computed league table** — fixtures ships a form guide always; the FA "Full-Time" table is
  ingested + styled, per league, and degrades to the form guide when no feed.
- **Stats are opt-in per team and positive-only; minors are never named** on public boards.
- **Safeguarding is tightening-only** (raise age / hiding ON only; loosening is venue-controlled).
- **Sponsors** are tiered, degrading to a flat row; **photo_url is always null** (avatar placeholders).
- **Club colours skin accents/headers only** — platform keeps Bebas Neue / DM Sans / Phosphor-thin
  (emoji in the files are placeholders for Phosphor icons).
- **Thin/empty club is the primary state** — every absent module is an invitation, never a hole.
