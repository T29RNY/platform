# Club Page — Composition Spec (reconciled to migrations 444/445 + live code)

Locks the homepage model the renderer and setup wizard share. Built on the **real `get_club_public`
payload**. `✅ real` = in payload/shipped · `⚠ gap` = field exists but not surfaced · `❌ net-new` = no
data/table/route yet. Football is the reference discipline; discipline deltas at the end.

---

## Decisions LOCKED (operator, this round)

1. **Reliability = season-scoped.** Overrides the old "always all-time" rule — the public leaderboard
   shows **this-season** reliability. Backend: add a season-scoped reliability calc + expose it in a new
   `people` payload slice. Designs relabelled to "this season".
2. **Build the league table.** `matchHub` gets the real **FA table embed** (no longer "drop it") — the
   "meaning" line (position vs promotion + next fixture) is in scope. Table tab tagged "FA table · synced".
3. **Setup wizard committed** to these exact section keys, every field self-explaining (see the Setup
   Wizard design file).

## 0. Model (confirmed)

- **One scrolling page** of blocks, mobile-first — **not** a dashboard with sub-routes. Each block is
  independently `enabled` and ordered via `club_pages.sections` = `[{key, enabled, order}]` (jsonb,
  **no DB enum** — this doc defines the key vocabulary and becomes the contract).
- Only **News** is *teaser-on-homepage + its own detail route*. Everything else is a homepage block.
- Renderer must tolerate any block being **present / absent / reordered** and still look complete.

## 1. Section-key vocabulary (PROPOSED — lock this)

| `key` | block | fed by (real payload key) | status |
|---|---|---|---|
| `hero` | Hero (state-driven) | `branding.hero_url`, `branding.crest_url`, derived from `leagues[].fixtures[]` | ✅ (live state ❌) |
| `identity` | Name / tagline / socials | `club.name`, `branding.tagline`, `branding.socials` | ✅ |
| `matchHub` | Fixtures & results (+ FA table) | `leagues[].fixtures[]` | ✅ fixtures · ❌ table |
| `teams` | Teams / squads | `teams[]` (cohorts→teams→members) | ✅ (safeguarded) |
| `people` | Stats / leaderboard | — | ❌ net-new RPC |
| `news` | Latest posts (teaser) | `news[]` | ✅ (+ ❌ detail route) |
| `sponsors` | Sponsor wall | `sponsors[]` | ✅ |
| `events` | Tournaments | `tournaments[]` → links `/a/<slug>` | ✅ |
| `about` | About blurb | `branding.about` | ✅ |
| `contact` | Contact (footer) | `clubs.contact_name/email` | ⚠ not in payload yet |
| `join` | Join / get-involved CTA + links | — | ❌ net-new (invite/membership flow) |
| `documents` | Documents & forms | — | ❌ net-new (no field/table) |
| `footer` | Powered-by + socials | `branding.socials` | ✅ |

**Default homepage order (football):** `hero · matchHub · news · teams · people · sponsors · events ·
about · join · footer`. (`identity` folds into `hero`; `contact` folds into `footer`.)

## 2. Hero — honest 3-state (live gated)

No hero-state field; **derive client-side** from `leagues[].fixtures[]`:
- **pre-match** → nearest upcoming `status:scheduled` (countdown + opponent + venue). ← default
- **post-match** → most recent `status:completed` with score (result + link to report).
- **idle** → none upcoming (crest + tagline + Join).
- **live** → **design it, but it never fires for grassroots** (`club_fixtures.status` has no
  `in_progress`). Only real on refereed `fixtures` / `get_tournament_public`, or the planned P4 30s-poll
  strip. **The page must not depend on it.** Our Baller homepages lead with live as an *aspirational*
  state — flag that, and ship pre-match as the real default.

## 3. The two over-claims to correct in the designs

- **League table / "meaning line"** — not derivable from `club_fixtures` (free-text opponents,
  our-games-only) and **not in the payload by design**. The real table is a **P4 `fa_embed` iframe**.
  → `matchHub` ships **fixtures + results** (real); the table tab is an **FA embed placeholder (P4)**,
  not structured data. The "3rd, 2pts off promotion" line is net-new and depends on that embed.
- **Stats / reliability leaderboard (`people`)** — not in payload; needs a **new RPC slice**.
  Reliability is **all-time by hard rule** (`round(allTimePlayed / totalTeamGames * 100)`, null < 3
  games) — so **"most reliable *this season*" is invalid**; relabel **all-time**. Leading-scorer /
  POTM-of-month have real underlying data but **no club-public RPC** yet. → Operator decisions:
  (a) add a `people` slice to the payload; (b) season-scope vs the all-time rule.

## 4. Safeguarding (✅ already shipped — update earlier flag)

Applied **server-side before the page sees it**: minors / null-DOB → `first_name` + surname initial,
`is_minor:true`, `photo_url:null`; whole rosters suppressed if `hide_public_rosters`. Driven by
`clubs.safeguarding_config` (`min_public_age` 18, `hide_public_rosters` false). → "Jack M." + avatar
placeholder is the **correct, backed default**. (This was previously on our net-new list; it's real.)

## 5. Discipline deltas — ⚠ payload gap

`get_club_public` is **football-shaped** (`teams`/`leagues`/`fixtures`). The gym/boxing blocks we
designed — **class timetable, fight record, grading/belts, PT** — pull from `venue_class_*`,
`member_bouts`, `venue_grading_*`, which are **not in this payload**. → Each needs a **net-new payload
slice**, gated by the real `disciplineLabels.js` flags (`hasGrading` martial-only, `hasFightRecord`
boxing-only, `hasPT`). Section keys to add: `timetable`, `fightRecord` (hasFightRecord), `grading`
(hasGrading), `pt` (hasPT). See `CLUB_PAGE_VOCAB_PROPOSAL.md` for the per-discipline default-section map.

## 6. Assets (5 MB max · MIME enforced · public bucket `club-media/<club_id>/`)

Allowed: png, jpeg, webp, gif, **svg** (✅ crests/logos). Dimensions/compression/OG = **spec these**
(resize-on-upload is P3 net-new; no OG generator exists):

| asset | aspect | target | note |
|---|---|---|---|
| Crest | 1:1 | 512² | PNG/SVG transparent |
| Hero | 16:9 | 1920×1080 (≤2400w) | JPEG/WebP + mobile crop |
| Sponsor logo | bounded box | ~400×200 fit | PNG/SVG transparent |
| Post image | 16:9 | 1200×675 | JPEG/WebP |
| OG / share card | 1.91:1 | 1200×630 | ❌ net-new generator |

## 7. Net-new backlog (design done / build outstanding)

1. `matchHub` **FA table embed** (P4) + the derived "meaning" line.
2. `people` **stats/reliability RPC slice** + **season-scoping decision** (vs all-time rule).
3. **News post-detail route** (`/c/<slug>/news/<post.slug>`).
4. **Documents** store (field + table + route) — if wanted.
5. **`contact_*` into the payload** (currently footer-only, not surfaced).
6. **Join / membership** flow (gated, per earlier `Destinations` design).
7. **Discipline payload slices** (timetable / fightRecord / grading / pt).
8. **OG share-card generator** + image resize/compress (P3).
9. **Live strip** (P4 30s poll) — until then live hero is aspirational.
