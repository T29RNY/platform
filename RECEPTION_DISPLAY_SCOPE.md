# Reception Display — Broadcast Redesign + Full Wiring

## Context

`design_handoff_reception_display/` ships a new, far richer "broadcast TV"
design for the wall-mounted venue reception screen (hero featured match, side
mini live tiles, rotating live league table, Golden Boot leader card,
Coming-Up-Tonight, rotating tall promo, IoO header banner, goals ticker, full
goal-celebration overlay). The handoff is written as if greenfield, but it is
**not** — the platform already has the entire backend and a working (simpler)
`apps/display` React app.

This build is therefore a **visual redesign of `apps/display` to the new
design, plus targeted data-layer and operator-control extensions** so every new
panel is fully wired and operator-controlled, with data pushing/pulling across:

- **Ref view** → live scores + match events (already pushed via `match_events`
  + `notify_venue_change` broadcast; **no ref changes needed**).
- **Casual / booking flow** → casual pitch bookings surfaced in "Coming Up
  Tonight" (display **pulls**; needs `get_display_state` enrichment).
- **Vendor management (venue app)** → operator controls config, sponsor
  creative + image, and featured-match pin (venue app **pushes** via
  `venue_update_display_config`; needs RPC + UI extension).

### What already exists (reuse, do not rebuild)
- `apps/display` — React + Vite + framer-motion, deployed. Reads display token
  from `/display/<token>` or `?token=`, calls `get_display_state`, subscribes to
  `venue_live:<live_channel_key>`, 60s fallback poll, wake-lock, server-time
  drift correction.
- `apps/display/src/components/PinGate.jsx` — full 3-strike / 30-min localStorage
  lockout matching §7. **Reuse as-is.**
- `apps/display/src/components/Crest.jsx` — SVG shield crest. Reuse / restyle to
  the shield clip-path spec.
- RPCs: `get_display_state` (mig 165), `check_display_pin` (mig 166),
  `venue_update_display_config` (mig 167). All `SECURITY DEFINER`, granted anon.
- `apps/venue/src/views/DisplaySettings.jsx` — operator modal controlling
  zones/mode/interval_secs/custom_message/PIN, shows display URL. Extend it.
- Live data: standings (confirmed + live) and top_scorers already computed inside
  `get_display_state`; ref writes already broadcast on `venue_live:<key>`.

### Approved decisions
- **Rebuild the React app** (keep React+Vite+framer-motion, reuse all wiring).
- **Golden Boot:** compute what exists (goals, apps, shirt#) + generated photo
  placeholder; MoM/G-90/position render only when a signal exists, else hidden.
- **Sponsor image:** build a Supabase Storage upload in the venue app.
- **Featured pin:** include the operator pin control now.

---

## Part A — Data layer (SQL migrations, applied in Supabase first)

Next free migration number: **241**. Each migration lands with its `_down.sql`
in the same commit (Hard Rule #11). All are read/edit of existing RPCs — run
`skills/rpc-security-sweep.md` before commit; `venue_update_display_config` is a
write RPC so `skills/ephemeral-verify.md` is mandatory.

### A1. `get_display_state` enrichment — mig 241
Edit the RPC body in `rls_migrations/165_get_display_state.sql` (pull live body
first per `feedback_verify_before_commit`). Add to the returned payload:

1. **`upcoming_fixtures[]`** — add `round_name`, `official_id`, `official_name`
   (join `match_officials`), `pitch_name` (already present), `competition_type`.
   Drives Coming-Up ref chip ("Needs ref" when `official_id` null) + round line.
2. **`bookings[]`** (new top-level array) — today's casual pitch bookings on this
   venue's `playing_areas`. Source: `pitch_occupancy` rows where
   `source_kind='booking'` joined to `pitch_bookings` (today, Europe/London,
   status confirmed/active). Map to `{ kickoff_time, pitch_name, booked_name
   (team_name or booked_by_name), source_kind:'booking' }`. Display merges these
   into Coming-Up as blue-bordered single-team casual rows.
3. **`competitions[].top_scorers[]`** — add `apps` (count of `fixture_lineups`
   rows for the player in that competition's completed fixtures), `shirt_number`
   (`players.shirt_number`), and `position` only if a non-null source exists
   (else omit). Leave `mom`/`g_per_90` out of SQL — display computes G/90 from
   goals÷apps when apps>0 and hides MoM (no league MoM signal exists).
4. **Featured-pin passthrough** — `display_config` is already returned whole, so
   `featured_fixture_id` / `featured_pin_expires_at` / `featured_pin_story_tag`
   flow through once the venue RPC persists them (A2). No extra work here beyond
   confirming they survive.

Return-shape addition ⇒ same-commit consumer update in the display app (Hard
Rule #12). Update `RPCS.md` Notes (Hard Rule #14): consumers are this display +
future Gaffer.

### A2. `venue_update_display_config` enrichment — mig 242
Edit `rls_migrations/167_venue_update_display_config.sql`. Extend validation +
persistence (currently only zones/mode/interval_secs/custom_message) to also
accept and validate:
- `sponsor_image_url` (text/url), `sponsor_label`, `sponsor_title`,
  `sponsor_body`, `sponsor_url` (text)
- `sponsor_ratio` (number, clamp 0..1)
- `featured_fixture_id` (uuid or null — verify it belongs to this venue's
  competitions before persisting; else raise `fixture_not_in_venue`)
- `featured_pin_expires_at` (timestamptz or null), `featured_pin_story_tag` (text)
Keep PIN handling unchanged. Continue to persist the whole `p_config` and fire
`notify_venue_change('venue_updated')` so live screens re-pull. Ephemeral-verify
with a throwaway `_e2e_` venue + fixture per `skills/ephemeral-verify.md`.

### A3. Sponsor image storage — mig 243 (+ Supabase Storage bucket)
- Create a public Storage bucket `venue-media` (or reuse an existing public
  bucket if one is found during execute) with read = public, write = service/
  authenticated venue-scoped.
- No new RPC required if upload uses the Supabase JS storage client from the
  venue app with the venue's authenticated session; the resulting public URL is
  saved through `venue_update_display_config.sponsor_image_url` (A2). Migration
  only records bucket creation/policy for source-sync.

---

## Part B — `apps/display` rebuild (React, new design)

Build at exactly **1920×1080**, `transform: scale()` letterbox (HANDOVER §3).
Keep `main.jsx`, the Supabase client, token read, realtime subscribe + 60s poll,
wake-lock, server-time drift, and `PinGate.jsx`. Replace the zone components and
layout. Port CSS tokens, keyframes, and renderer structure verbatim from
`design_handoff_reception_display/Reception Display.html` (the file wins on any
conflict, per README).

### B1. Shell & tokens
- `src/styles.css`: replace with the design's `:root` tokens (colour, type,
  spacing, radius, shadow), `.stage/.canvas/.header/.main/.ticker` layout grid,
  and all `@keyframes`. Add Google Fonts: Barlow Condensed, Inter, JetBrains
  Mono (HANDOVER §2/§4). Wire `--venue`/`--venue-2` from
  `venue.primary_colour`/`secondary_colour`; per-team `--c/--c2` on team els.
- `src/App.jsx`: keep all data/realtime plumbing; swap the render tree to the new
  region layout (header / live-row / lower / ticker). Add an error boundary
  around each panel render (§13) so one malformed panel can't blank the screen.

### B2. New / rebuilt components (`src/components/`)
- `DisplayHeader.jsx` (rebuild) — venue brand (shield + name + sub), centre IoO
  promo banner (static v1), right status cluster (live count pill, rotated comp
  pill, mono clock off `server_time`+drift, date line).
- `Hero.jsx` (new) — featured match: bar (comp badge, round·pitch·ref, story tag,
  live minute), body (two shield crests + 140px white score + last-action pill),
  footer (last-10' momentum bar from `recent_events` counts + last-4 event strip).
  `crossfadeHero()` on featured swap.
- `MiniTile.jsx` (new) — compressed scoreboard for the (≤2) non-featured live
  fixtures + 3 recent event chips.
- `LiveTable.jsx` (rebuild StandingsZone) — rotating standings across the venue's
  active competitions; pill tabs with gold progress bar; rotation governed by
  `display_config.mode` (smart/cycle/fixed) + `interval_secs`; `formIn` cascade +
  `flashRank` on rank change.
- `GoldenBoot.jsx` (rebuild TopScorersZone) — leader card (placeholder photo,
  shirt badge, name, team, Apps / G·90 / [MoM only if present]) + top-10 list,
  synced to the table's current league.
- `ComingUp.jsx` (rebuild UpcomingRecentZone) — tonight's league
  `upcoming_fixtures` (sorted first) + casual `bookings[]` (blue border); imminent
  (≤60m) gold; ref chip red "Needs ref" when `official_id` null; pitch chip / TBC.
- `TallPromo.jsx` (rebuild SponsorBug) — rotates venue creative ↔ IoO creative
  every 8s by `display_config.sponsor_ratio` (default 0.7; 100% IoO when no
  sponsor image). Renders `sponsor_image_url` + sponsor_label/title/body/url.
- `GoalsTicker.jsx` (restyle) — gold chevron + 90s scroll of `goals_ticker`
  (doubled list) + "synced Ns ago" indicator.
- `Crest.jsx` (restyle) — shield clip-path, primary fill + diagonal secondary
  stripe + white TLA.
- `GoalCelebration.jsx` (new) — full-hero overlay (§10); triggered by the diff
  layer; throttle 1 per 5s, queue extras.
- Keep `PinGate.jsx`, `PoweredBy.jsx`, `FormPips.jsx`, `Score.jsx` (restyle as
  needed).

### B3. Logic libs (`src/lib/`)
- `featured.js` (new) — featured-match selection algorithm verbatim from
  HANDOVER §8 (pinned → top-of-table → goal-just-in (60s sticky latch) →
  nail-biter → action → recency → no-live). Honours `featured_fixture_id` +
  `featured_pin_expires_at` + `featured_pin_story_tag`.
- `diff.js` (new) — `diffAndAnimate(prev, next)` (§9): new-goal celebration,
  `scorePunch` on score change, `flashRank` on rank change.
- `format.js` (extend) — `getMatchMinute(fixture, serverTime)` with drift +
  HT hold on `period_change`/half_time (§11).

### B4. Cup support
Reuse existing `get_cup_bracket` / `get_group_standings` self-fetch (current
`BracketZone.jsx`) for `type='cup'` competitions inside the LiveTable rotation.

---

## Part C — Venue operator control (`apps/venue`)

Extend `apps/venue/src/views/DisplaySettings.jsx` (modal already wired to
`venueUpdateDisplayConfig`):
- **Sponsor section** — text inputs for label/title/body/url; `sponsor_ratio`
  slider (0–100%); **image upload** (new) → Supabase Storage `venue-media`
  bucket, preview, store returned public URL into `sponsor_image_url`.
- **Featured match pin** — picker listing the venue's current/today fixtures;
  optional expiry; optional story-tag text; clears `featured_fixture_id` on
  "unpin". Persists via the extended `venue_update_display_config`.
- Add the new keys to the config object built at `DisplaySettings.jsx:70`.
- New wrapper(s) in `packages/core/storage/supabase.js` if image upload needs a
  helper; otherwise reuse the storage client directly. Re-export via
  `packages/core/index.js`.

No changes to `apps/ref` (live push already flows) or the casual app write side
(bookings already created); the casual link is the new **read** path in A1.

---

## Files touched (representative)
- SQL: `rls_migrations/241_*`, `242_*`, `243_*` (+ each `_down.sql`)
- Display: `apps/display/src/{App.jsx,styles.css}`,
  `apps/display/src/components/*`, `apps/display/src/lib/{featured,diff,format}.js`
- Venue: `apps/venue/src/views/DisplaySettings.jsx`,
  `packages/core/storage/supabase.js`, `packages/core/index.js`
- Docs: `RPCS.md`, `SCHEMA.md` (bucket), `FEATURES.md`, `DECISIONS.md`

## Suggested execute sequencing (one logical unit per part)
1. A1 mig 241 (display-state enrichment) → ephemeral/security sweep → commit.
2. A2 mig 242 + A3 mig 243 (config RPC + storage bucket) → ephemeral-verify → commit.
3. B1 shell + tokens (static render against live data) → build → commit.
4. B2/B3 panels + featured + diff layer, panel by panel → build per part → commit.
5. C venue control (sponsor + image upload + featured pin) → build → commit.

---

## Verification (end-to-end)

- **Build gate:** `cd apps/display && npm run build` and
  `cd apps/venue && npm run build` clean after each execute (hook enforces on commit).
- **RPC proof:** `bash skills/scripts/check-rpc-security.sh get_display_state`
  and `... venue_update_display_config`; `check-rpc-columns.sh` for stale refs.
  Ephemeral-verify `venue_update_display_config` with a throwaway `_e2e_` venue +
  fixture (auto-rollback, then `_e2e_%` leak-check = 0).
- **Data wiring (live, real venue — not demo, Hard Rule #6):**
  - Ref records a goal in `apps/ref` → display hero score punches + goal
    celebration fires within the broadcast/60s window.
  - Create a casual booking on a venue pitch for today → it appears as a blue
    casual row in Coming-Up after next state pull.
  - Operator edits sponsor copy + uploads an image + pins a featured match in the
    venue app → screen re-pulls (venue_updated broadcast), tall promo shows the
    sponsor creative, and the pinned match becomes the hero with its story tag.
- **Visual:** load `/display/<token>` at 1920×1080; confirm letterbox scaling,
  Barlow Condensed loaded, tabular-nums on all scores/tables, ticker scroll,
  table rotation honouring mode/interval, PIN gate + 3-strike lockout.
- **Smart-TV pass (§13):** wake-lock, offline last-payload fallback toast,
  per-panel error boundary, `prefers-reduced-motion` slows (not kills) ticker +
  celebration.
- **Real-device:** display app is PWA-adjacent but the venue app touches
  auth/upload — sanity-check the venue upload flow on a real device.

---

## STATUS — SHIPPED (session 83, Jun 10 2026)

All parts landed on `main` in four commits:

| Part | Commit | Notes |
|---|---|---|
| A1 — `get_display_state` enrichment | `ce9d289` | **Migration renumbered 244** (doc said 241; 241–243 were taken by sessions 80–82). `pitch_bookings.status` has no `active` value → filter is `confirmed` + active occupancy. `apps` = lineup-array membership (0 until lineups used). No `position` column → key omitted. |
| A2+A3 — config RPC + bucket | `bf843e5` | **Migrations 245 + 246.** Mig 245 based on the LIVE body (167 + mig-239 capability guard). EV 11/11 PASS, leak-check 0. `venue-media` bucket live (public, 5 MB, images; venue-scoped authenticated write). |
| B — display rebuild | `9abb08f` | Full broadcast wall, verified live on both demo venues at 1920×1080 + letterboxed. Found/fixed: grid `place-items:center` can't centre an oversized canvas — letterbox uses absolute-centre + translate scale. |
| C — venue controls | `a217637` | Sponsor copy/ratio/upload + featured pin (expiry presets + story tag). End-to-end save verified; `venue_updated` broadcast received. TallPromo gates venue creative strictly on an uploaded image per §6.7. |

**Still owed (tracked in FEATURES.md):** display Vercel deploy + `VITE_DISPLAY_APP_URL`; real-TV device pass (§13) and a real-device venue sponsor-upload test; goal-celebration live-fire against a real ref-recorded goal.
