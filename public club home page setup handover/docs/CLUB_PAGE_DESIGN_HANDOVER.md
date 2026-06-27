# Club Page — Design Handover Index

Master index of the In or Out public club page design set. Read alongside:
- `CLUB_PAGE_COMPOSITION_SPEC.md` — homepage model, real payload mapping, locked decisions.
- `CLUB_PAGE_VOCAB_PROPOSAL.md` — discipline vocabulary + default-section map (for approval).

**Legend:** ✅ real data/shipped · ⚠ payload gap (field exists, not surfaced) · ❌ net-new (no data/route/service).
All design files are `.dc.html` — open directly in a browser; canvas mode (pan/zoom). Theme: dark "Baller"
shell, Bebas Neue display + DM Sans body, per-club colour as a prop (claret = the football reference club).

---

## Design files (open these)

| File | Contains | Interactive |
|---|---|---|
| `Club Page Hi-fi - Football Baller.dc.html` | Football homepage (mobile + desktop): hero, match hub, news, players, join, sponsors · **discipline switcher** + vocabulary map | tabs, discipline switch |
| `Club Page Hi-fi - Gym Boxing.dc.html` | Boxing homepage (mobile + desktop): timetable, reliability leaderboard, fighters, **fight record**, news | dashboard tabs |
| `Club Page Hi-fi - Hero States.dc.html` | All hero states (pre/live/post/idle/**empty zero-config**) + **two-palette theming proof** | — |
| `Club Page Hi-fi - Team View.dc.html` | **Single-team mini-view** (mobile + desktop) + player profile | — |
| `Club Page Hi-fi - Destinations.dc.html` | Match-day centre (refereed live + grassroots) + **Join flow** (gated, interactive) | match tabs, join machine |
| `Club Page Hi-fi - Club Pages.dc.html` | Menu/site-map · About · Contacts · Documents · Events · News index · Sponsors page | — |
| `Club Page Hi-fi - Share Artefacts.dc.html` | Result card · match-day poster (QR) · social unfurl · **edge states** (loading/draft/404) · article detail | — |
| `Club Page Hi-fi - Setup Wizard.dc.html` | 12-step wizard, locked section keys, every field self-explaining | rail nav, section toggles |
| `Club Page Hi-fi - Manage Dashboard.dc.html` | Dashboard (dark) + news/sponsors/teams editors · draft⇄published | — |
| `Club Page Hi-fi.dc.html` | (earlier light-theme home + wizard + dashboard — superseded by the Baller set; kept for reference) | tabs, recolour |
| `Club Page Wireframes.dc.html` | Original lo-fi wireframes (all three surfaces) | — |

---

## Every view / page (status)

**Public homepage (single scrolling page of blocks)**
- Hero — pre-match ✅ · post-match ✅ · idle ✅ · empty/zero-config ✅ · live ⚠ (refereed/P4 only)
- `matchHub` — fixtures + results ✅ · FA league table ❌ (P4 embed, approved build) · "meaning" line ❌
- `teams` ✅ (safeguarded server-side) · `news` ✅ teaser · `sponsors` ✅ · `events` ✅ (tournaments) ·
  `about` ✅ · `people`/stats ❌ (new RPC, season-scoped — approved) · `join` ❌ · `contact` ⚠ (footer, not in payload)

**Destination pages**
- Single-team mini-view ✅ · Player profile ✅ (adults; minors restricted) · News article detail ✅ data / ❌ route ·
  Match-day (refereed live ✅) · Match-day (grassroots — no live feed ❌) · Join/register (gated ❌ build)

**Floor / utility pages**
- About ✅ · Club contacts ⚠/❌ (committee + welfare officer = net-new) · Documents ❌ (no store) ·
  Events ✅ (tournaments) + ❌ (social events) · News index ✅ · Sponsors page ✅

**Discipline variants** — boxing/gym built; data ❌ (get_club_public is football-shaped — needs timetable/
fightRecord/grading/pt payload slices). Wording per `disciplineLabels.js` flags (`hasGrading` martial-only,
`hasFightRecord` boxing-only, `hasPT`).

**Admin**
- Setup wizard — 12 steps: identity, crest, colours, hero, **sections**, teams, **people/stats**, sponsors,
  news, get-involved, **safeguarding**, publish (all ✅ design; people/stats + join data ❌)
- Manage dashboard ✅ · News editor ✅ · Sponsors manager ✅ · Teams editor ✅ · Draft⇄publish ✅

**Share / states**
- Result card ❌ generator · Match-day poster ❌ generator · Social/OG unfurl ❌ generator ·
  Loading ✅ · Draft/unpublished ✅ · 404/not-found ✅

---

## Net-new build backlog (design complete, engineering outstanding)

1. `people` **stats/reliability RPC** slice — **season-scoped** (operator decision; overrides all-time rule).
2. `matchHub` **FA league table embed** (P4) + derived "meaning" line — **approved to build**.
3. **News post-detail route** `/c/<slug>/news/<post-slug>`.
4. **Documents** store (field + table + route) — optional.
5. **`contact_*` into `get_club_public`** (currently footer-only, not surfaced) + committee/welfare-officer model.
6. **Join / membership** flow (gated — see Destinations) + a **supporter/"follow"** concept (no role today).
7. **Discipline payload slices** (timetable / fightRecord / grading / pt) so non-football clubs aren't football-shaped.
8. **OG / share-card generator** + result card + poster; image **resize/compress on upload** (P3).
9. **Live strip** (P4 30s poll) — until then the live hero is aspirational for grassroots.
10. **Section-key vocabulary** (this set defines it) — lock as the renderer↔wizard contract.

## Confirmed real (don't rebuild)
Safeguarding (server-side: surname-initial + photo suppression under `min_public_age`, roster hiding) ·
`get_club_public` payload (club/branding/teams/leagues+fixtures/sponsors/news/tournaments) · asset limits
(5 MB, png/jpeg/webp/gif/svg, public `club-media/<club_id>/`) · 3-state grassroots hero · per-club 3-colour theming.

## Open product decisions
None blocking — the three from this round are locked (season reliability · build the table · wizard committed).
Remaining operator approvals: the **proposed discipline vocabulary** and **default-section map** in
`CLUB_PAGE_VOCAB_PROPOSAL.md`.
