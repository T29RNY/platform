# Modular Platform — Packaging, FA Fixtures, Public Web, Ref-as-Module

*Scoped 2026-06-22 (session 174). Strategy thread off the GNP Sports FC target + Pitchero/MyClubPro
competitor review. NOT YET BUILT — this is the plan of record. Read STRATEGY.md competitor section
alongside this.*

---

## WHY

Two Pitchero-incumbent targets (the pilot club + GNP Sports FC) keep surfacing the same picture:
the incumbents (Pitchero, MyClubPro £12–29/mo) own **club website + FA Full-Time fixture feed +
registration/payments** — the commodity layer. Neither does **match-day operations** (availability,
squad selection, POTM, reliability), casual, or proper tournaments. That gap is our moat.

Decision: **don't out-Pitchero Pitchero on the website.** Make the platform **modular** — a Basic
match-day core that's always on, plus features a club can switch on/off — and use the FA fixture
feed not as a noticeboard but as a **trigger into our match-day engine** (auto-create match →
auto-open availability), which no incumbent can do because they have no engine to feed.

---

## EPIC A — Modular feature system (`club_features`) — FOUNDATION, BUILD FIRST

**Goal:** per-club on/off features gated consistently at THREE layers (nav + route + RPC), with a
dependency graph and a package layer on top.

**Why three layers:** today (audited s174) hiding a nav item does NOT disable a feature — the
routes (`/sessions`, `/classes`, `/book`, `/tournament/<slug>`) and their RPCs stay reachable by
deep-link, gated only by data/RLS. A real toggle must gate nav (UI) + route (client) + RPC (server).
The "hidden-but-still-reachable" trap is the #1 risk this epic exists to fix.

**What exists today (don't rebuild):**
- `clubs.discipline` pick-list (football/gym/boxing/martial_arts/yoga/dance/fitness/other) →
  `getDisciplineLabels()` (apps/inorout/src/lib/disciplineLabels.js) cleanly gates Classes/PT/
  grading/fight-record. Coherent vertical gating — but it's a BUNDLE (can't have gym without PT).
- **Equipment hire = the gold-standard pattern.** Zero-footprint: no hireable spaces → nothing
  renders, no nav, no dead route. Copy this shape.
- **Feature-flag precedent already shipped:** `teams.multi_context_nav` boolean +
  `get_team_feature_flags()` RPC + `getTeamFeatureFlags()` wrapper (mig 351), read in App.jsx.
  Extend THIS pattern — don't invent a new one.

**Scope:**
- `club_features` fine-grained per-club flags (memberships, payments, tournaments, equipment_hire,
  public_web, coaching, league_fixtures, ref…). Flags are the source of truth.
- **Dependency graph** — enabling a feature auto-enables prerequisites and BLOCKS unsafe disables.
  Edges: Memberships→Payments; Coaching→Memberships(→Payments); paid Tournaments→Payments.
- **Package layer** = named presets (Basic + add-ons) that expand to a flag set. Packages are
  shortcuts; flags are truth. So tiers-vs-pick-and-mix is just a presentation layer — DEFER that
  commercial decision; it changes nothing in the data model. **Avoid the trap:** do NOT model
  tiers as a single `tier` enum column with hardcoded behaviour — that breaks the first time a club
  wants "Pro minus tournaments."
- **Two orthogonal axes:** discipline (what sport) × packages (what they bought). Keep separate.
  Discipline decides which features are *relevant*; packages decide which are *purchased*.
- Operator UI in the venue console to flip features/packages per club.
- **DEFAULT EVERY FLAG ON for existing clubs** → purely additive, zero regression on ship day.
  Turning off is opt-in per club.

**Recommendation:** pick-and-mix flags underneath, named tiers as presets on top. Don't lock a tier
structure before the pilot tells you what clubs actually bundle.

**Sizing:** ~3–4 build sessions (schema + flag plumbing through core, retrofit 3-layer gate onto
memberships + tournaments, operator UI).

---

## EPIC B — Public Web module + league fixtures (provider model)

**Goal:** lightweight public club page (the "front door to the engine") + FA fixtures/results/table.

**Key strategy distinction (from the thread):**
- Live FA results **as a website** = commodity, table stakes, two cheaper rivals already own it.
  LOW strategic value. Build only the cheap 80% (branded page + fixtures/results/table + teams);
  do NOT chase the expensive 20% (news CMS, media galleries, per-club theming) — that's *becoming*
  Pitchero. Build CMS slices only when a pilot club demands them.
- Live FA fixtures **as a trigger** into auto-create-match → auto-open-availability = HIGH value,
  unique to us. Same data, opposite strategic outcome. This is the real prize.

**FA Full-Time access — settled facts (don't relitigate):**
- There is **NO self-serve, priced FA API.** The official partner integration (what Pitchero has)
  has sat "Deferred" on the FA's own forum 4+ years — gated, no published price/process. Do NOT
  build a strategy on getting it.
- **Route we use = club-admin Full-Time Feeds/Code Snippets (FREE).** A club/league admin generates
  it (Full-Time → Media → Code Snippets). Two forms:
  - **Iframe/embed (display-only)** — their styled box, can't reshape, can't reuse the data.
  - **Season ID + Group ID feed (structured)** — pull raw fixtures/results ourselves, render in our
    own layout AND feed the match-day engine. THIS is option 2, the one we want.
- ⚠️ VERIFY before relying: confirm the target club's league exposes the Season/Group ID feed form
  (not just the locked iframe) — that's what makes "it's just layout" true vs reskinning their box.

**How we stack up on FA sync once option 2 ships:** parity on the *visible output* (all three read
from Full-Time); slightly behind on *plumbing* (theirs is official/zero-touch, ours is DIY with a
maintenance tail — we own the pipe if the FA changes format). But we LEAPFROG the moment the fixture
*does something* — auto-creates the match and opens availability. Pitch it as "your fixtures flow
into your match day," NOT "we have FA sync too."

**Scope:**
- Branded public club page: badge/colours, teams, sponsors, fixtures/results/table.
- **`league_fixtures` capability as a PLUGGABLE PROVIDER** — FA Full-Time = adapter #1; cricket
  (ECB Play-Cricket), hockey, rugby follow later without rework. Don't hardcode "FA"; use a
  `provider` field.
- Structured ingest (not iframe) → fixtures become rows in our DB (Epic C depends on this).
- Gated behind the `public_web` flag from Epic A.

**Public page content scope (operator-decided s174):**
- **Ships as "just layout" (data already held):** club identity (crest/colours/founded/venue/contact
  — ⚠️ confirm a club-level branding/badge field exists; `set_branding` is tournament-level today,
  may need a small `clubs.branding`) · teams/age-groups (org chart, migs 389–390) · fixtures/
  results/table (internal + FA feed) · link to existing tournament hub · Join/register CTAs (invite
  links + QR, mig 390).
- **Front-door differentiators (live + actionable, NOT a static noticeboard):** live score / "Follow
  live" when a team's playing (realtime) · next-fixture + availability teaser tapping into the
  engine · prominent Join CTA. This is how we beat a static Pitchero page — same data, shows it
  *happening*.
- **Sponsors → TWO levels.** (a) TOURNAMENT sponsors = ALREADY BUILT (`tournament_sponsors`, mig
  327; banner on the public hub) — no action. (b) CLUB-LEVEL sponsors = NEW, do in B: mirror the
  `tournament_sponsors` shape into `club_sponsors` (+ a few RPCs); reuse venue-media bucket +
  `uploadVenueMedia` (reuse, don't reinvent). MANY sponsors, ONE logo each = a bounded wall, NOT a
  gallery (so it does NOT conflict with the one-image-per-post / no-galleries rules); resize/compress
  each logo. Commercial hook = "your sponsor's logo on the live club page + tournament hub" is a club
  retention/renewal lever — prioritise within B. ⚠️ STORAGE-RLS CAVEAT (from tournament-sponsor
  experience): venue-media upload works cleanly only when the club admin is ALSO venue staff for that
  `venue_id` — proper fix = a dedicated media bucket, not borrowing venue-media.
- **News + blog → IN (operator-decided s174, upgraded from defer).** Real CMS: `club_posts`
  (title, body, author, status draft/published, published_at, slug) + dashboard editor + public
  render + "latest news" on homepage. The one piece with an ongoing content/support tail — accepted.
- **Club theming → IN.** Per-club branding via **CSS custom properties** (NOT hardcoded hex — keep
  off the venue-hex tech-debt in BUGS.md s174). Crest, colours, hero.
- **Images: ONE per post + ONE club hero banner (operator-decided s174).** Via existing
  `uploadVenueMedia`→venue-media bucket. Multi-photo/video GALLERIES still DEFERRED (out). Cost
  controls (the real driver is file SIZE not count): **resize+compress on upload** (~1600px cap,
  max-KB target) client-side; **orphan cleanup** — delete the image when its post is deleted so
  storage doesn't grow with churned drafts.
- **Discipline-aware composition:** page reads `clubs.discipline` — football gets fixtures/table;
  gym/boxing gets class timetable/grading; news/blog/theming/sponsors apply to all.
- **⚠️ SAFEGUARDING from day one (junior clubs like GNP):** minors' surnames/photos default
  HIDDEN/opt-in — applies to squad lists AND news posts + post hero images. Hooks exist
  (`clubs.safeguarding_config`, `id_mandate`). Non-negotiable; a dealbreaker if missed.

**Depends on:** Epic A (the flag). Ingest can be prototyped in parallel.

**Risk:** the DIY feed maintenance tail (we own the pipe); + news/blog adds an ongoing content surface.

**Sizing:** ~5–7 sessions (was 3–5; +news/blog CMS + club theming + club_sponsors).

---

## EPIC B — AUDIT FINDINGS, DECISIONS & PHASED BUILD PLAN (session 213, 2026-06-27)

Three-agent read-only audit run before build. **B is the NEXT epic to build.** A wireframe brief for
the public page + setup wizard + edit dashboard has been handed to Claude Design (function/features
only; Design owns layout).

**Already exists — do NOT rebuild:**
- **`public_web` flag is fully wired** (mig 399): `club_features.public_web` column (DEFAULT true),
  the `_club_feature_enabled(club_id,'public_web')` guard, and `get_venue_feature_flags`/
  `venue_get_feature_settings` all carry it. New write RPCs just drop in the one-line guard. **Epic A's
  flag dependency for B is done.**
- **`clubs` already has** `discipline` (mig 355 pick-list), `safeguarding_config` jsonb, `id_mandate`,
  name/short_name, contact_name/contact_email → discipline-awareness + safeguarding hooks exist.
- **Teams section renderable today:** `club_cohorts` (category youth/adult/mixed) + `club_teams`
  (gender, priority_rank, archived_at).
- **Patterns to clone exactly:** anon reads `get_tournament_public` / `get_club_league_public` (keyed
  on slug/code, SECDEF, GRANT anon); `tournament_sponsors` + its 5 admin RPCs (mig 327); the
  `clubAdminSetBranding` tournament branding form (SessionsScreen ~L1930); `uploadVenueMedia`;
  per-instance CSS-var theming via `--th-accent` scoped to the page container (TournamentScreen L768,
  NO global `:root` mutation). Public route = one-liner in `App.jsx` `getRoute()` + render block.

**Net-new (nothing on `clubs` for these):** branding/3-colours, crest, hero, tagline/about, public
slug, published flag, social links; `club_sponsors` table (mirror `tournament_sponsors`); `club_posts`
news/blog table (`club_announcements` is internal-only, NOT suitable); resize/compress-on-upload +
orphan-cleanup (current `uploadVenueMedia` does neither); the `venue-media` bucket has the
"admin-must-be-venue-staff" RLS caveat.

**DECISIONS LOCKED (operator-approved s213):**
1. **`club_pages` table (1:1 with clubs)** holds all page concerns — slug, published flag, 3 colours,
   crest_url, hero_url, tagline, about, socials, section on/off + order config. Keeps the public-page
   concern OFF the org `clubs` table; naturally holds draft-vs-published.
2. **New `club-media` storage bucket** (not reuse `venue-media`) — sidesteps the venue-staff RLS
   caveat; club-scoped paths. The handoff itself flagged a dedicated bucket as the proper fix.
3. **URL scheme `/c/<slug>`** (short, shareable).
4. **Club managers edit the page** via the existing club-admin auth chain (`auth.uid →
   member_profiles → club_team_managers`, is_active). Venue-operator parity DEFERRED.

**PHASED BUILD — each its own PR, sequenced (cloud-session one-at-a-time rule). Phases 1–3 are
wireframe-independent and can start immediately; 4–5 wait for Claude Design.**
- **Phase 1 — Data foundation (mig 444):** ✅ SHIPPED (s214). `club_pages`, `club_sponsors`,
  `club_posts` tables + RLS (REVOKE all, RPC-only, 0 policies) + new public `club-media` bucket &
  3 club-scoped storage write policies. No UI. Build PASS. Design brief handed to Claude Design
  (`CLUB_PAGE_DESIGN_BRIEF.md`, project "In or Out — Public Club Page (Epic B)").
- **Phase 2 — Public read RPC (mig 445):** ✅ SHIPPED (s215). `get_club_public(p_slug)` — anon SECDEF,
  returns `{found:true, club, branding, teams[cohort→team→safeguarded members], leagues[+fixtures],
  sponsors, news, tournaments}` or `{found:false}` (missing/unpublished). Wrapper `getClubPublic` +
  barrel; `/c/<slug>` route + `ClubPublicScreen.jsx` JSON-dump STUB (real UI = P4). **Safeguarding
  server-side** off `clubs.safeguarding_config` (`min_public_age` def 18, `hide_public_rosters` def
  false): minors/unknown-DOB → first name + surname initial, no photo; adults full. **No standings
  table** (external club_fixtures can't yield one — live FA table = P4 fa_embed iframe; flagged for P4).
  **No member photo column exists yet** → `photo_url` always null, gate documented for when one lands.
  Gates: build PASS, rpc-security (single overload/SECDEF/search_path/anon+auth ✅), EV 8/8 + leak-0.
  Build pointers below preserved for reference.
  **BUILD POINTERS (audited s214):** clone `get_tournament_public(text)` exactly — original def
  `rls_migrations/321_phase6_public_page.sql`, JS wrapper `getTournamentPublic(slug)` at
  `packages/core/storage/supabase.js:6273`. Pattern: `LANGUAGE plpgsql SECURITY DEFINER SET search_path
  = public, pg_temp`; `REVOKE ALL FROM public` then `GRANT EXECUTE ... TO anon, authenticated`; key on
  `club_pages.slug`; `IF NOT published THEN RETURN jsonb_build_object('found', false)`. Read branding
  off `club_pages` (3 colours/crest/hero/tagline/about/socials/sections), identity off `clubs`
  (name/short_name/discipline), teams off `club_cohorts`+`club_teams`, sponsors off `club_sponsors`
  (active=true, ORDER BY display_order), news off `club_posts` (status='published', ORDER BY
  published_at DESC). Safeguarding: read `clubs.safeguarding_config`; truncate minor surnames + drop
  photos in the player/squad arrays SERVER-SIDE. Add wrapper `getClubPublic(slug)` to supabase.js +
  barrel export. NO write → ephemeral-verify not triggered; EV (read-shape assertion) + rpc-security-
  sweep still run. Then add the `/c/<slug>` anon route one-liner in `App.jsx getRoute()` (defer the
  ClubPublicScreen render to P4; a stub/JSON dump is fine to prove the route + read end-to-end).
- **Phase 3 — Admin write RPCs (mig 446): ✅ SHIPPED s220.** 12 RPCs (the 11 planned +
  `club_set_safeguarding`), all club-manager auth + `_club_feature_enabled('public_web')` + audit,
  authenticated-only, single overload, search_path pinned. Decisions: contrast = advisory/client-side
  (server validates hex FORMAT only, `^#[0-9a-fA-F]{6}$`); safeguarding write = `club_set_safeguarding`
  TIGHTENING-ONLY (strengthen-only — age may only ↑, hide only false→true; loosening stays venue-token).
  Gates PASS: build, rpc-security 12/12, EV 14/14 + leak-0. RPCS.md/DECISIONS.md updated. **NEXT = P4
  public page UI, then P5 wizard — both need Claude Design wireframes.** Original plan retained below:
- **Phase 3 — Admin write RPCs (mig 446):** `club_set_page` (branding/sections — upsert club_pages),
  `club_publish_page`, `club_add/update/remove/list_sponsor`, `club_create/update/delete/list_post`
  (+ `club_publish_post`). All gated on `_club_feature_enabled(club_id,'public_web')` + club-manager
  auth + audit_events (Hard Rule #9). Gates: rpc-security-sweep, EV, ephemeral-verify (FIRST write phase
  of Epic B → ephemeral-verify is MANDATORY).
  **BUILD POINTERS (audited s215):**
  - **CANONICAL CLONE = `club_admin_set_branding` (mig 388).** Its exact preamble IS the P3 auth +
    feature-gate pattern: `v_uid := auth.uid()` (raise `not_authenticated` if null) → `SELECT id INTO
    v_profile_id FROM member_profiles WHERE auth_user_id = v_uid` (raise `not_authorised` if null) →
    `IF NOT EXISTS (SELECT 1 FROM club_team_managers ctm JOIN club_teams ct ON ct.id=ctm.team_id WHERE
    ctm.member_profile_id=v_profile_id AND ct.club_id=<club> AND ctm.is_active=true) THEN raise
    not_authorised` → `IF NOT public._club_feature_enabled(<club>, 'public_web') THEN raise
    feature_disabled` → UPDATE → `INSERT INTO audit_events(team_id,actor_user_id,actor_type,action,
    entity_type,entity_id,metadata) VALUES('_system', v_uid, 'club_admin', '<action>', '<entity>', …)`.
    Page/sponsor/post RPCs take `p_club_id text` directly and run that same club-scoped manager check.
  - **`_club_feature_enabled(club_id, feature)` DEFAULTS TRUE** when the club has no `club_features` row
    (COALESCE …, true) — fine, but means the gate only bites once a row exists; don't rely on it as the
    sole guard, the manager-auth check is the real gate.
  - **Sponsor RPCs:** clone the 5 `tournament_sponsors` admin RPCs (mig 327) — add/update/remove/reorder/
    list (admin list returns INACTIVE too, unlike the public read). Same shape, FK swapped to `club_id`.
  - **Hex validation:** strict server-side regex `^#[0-9a-fA-F]{6}$` on the 3 colours (reject otherwise);
    store via `jsonb`-style NULLIF(btrim(...),'') like set_branding. **Contrast: DECISION NEEDED in
    audit** — hard-reject low-contrast pairs server-side (compute WCAG relative-luminance ratio, net-new
    helper) vs. advisory-only with the contrast guard living client-side in the P5 wizard. Lean
    advisory/client (matches design brief's "contrast guard + auto-suggest-from-crest" = P5 UX); confirm.
  - **`club_set_page` upserts `club_pages`** (`INSERT … ON CONFLICT (club_id) DO UPDATE`); slug
    uniqueness + lowercase/hyphen CHECK already enforced by the table (mig 444) — surface the constraint
    violation as a clean `slug_taken`/`slug_invalid` error.
  - **Safeguarding write path — DECISION NEEDED in audit:** P2 honors `clubs.safeguarding_config` keys
    `min_public_age`(int) + `hide_public_rosters`(bool), but that column is currently written ONLY by
    `venue_update_club_settings` (venue-token). The P5 wizard's safeguarding step needs a club-manager
    write — either extend a P3 RPC or add `club_set_safeguarding(p_club_id, …)`. Flag the venue-vs-club
    ownership tension; don't silently let club managers overwrite a venue-set policy.
  - Wrappers camelCase in supabase.js + barrel; each raw RPC name in exactly ONE `supabase.rpc()`.
    RPCS.md: record P4/P5 consumers (Hard Rule #14). Migration .sql + _down.sql same commit (HR#11).
- **Phase 4 — Public page UI (`/c/<slug>` → `ClubPublicScreen`): ✅ SHIPPED s221.** Built from the
  authoritative `public club home page setup handover/docs/CLUB_PAGE_BUILD_HANDOVER.md` + 9 hi-fi
  designs. Pure-frontend cycle against the EXISTING mig-445 payload — NO RPC change.
  - New files (all isolated under `apps/inorout/src/views/ClubPublic/`, App.jsx UNCHANGED — route was
    already wired in P2): `clubPublicVocab.js` (discipline-aware public wording, kept SEPARATE from
    `lib/disciplineLabels.js` so casual surfaces stay byte-identical), `clubPublicHelpers.js` (hero-state
    derivation, form guide, luminance-based on-accent text, themeVars), `clubPublicSections.jsx` (TopBar
    + 4 hero states + all 11 section blocks each with a designed empty/degrade state + safeguard note +
    footer + not-found), `clubPublic.css` (scoped under `.club-public`; tokens + data-injected club CSS
    vars + `color-mix` tints → ZERO hex literals). `ClubPublicScreen.jsx` replaced the P2 JSON stub.
  - Hero = next-fixture / latest-result derived client-side (pre/post/idle/empty), ~30s **swap-only**
    poll, **NO live in-play score** (handover §5). Per-club theme = 3 colours as CSS vars, accents only;
    type/icons stay Bebas/DM Sans/Phosphor-thin. Join/QR CTA deep-links `socials.website` (the existing
    membership flow link is reused as-is; a real per-club join code arrives with the P5 read-extension).
  - **DECISION (s221): the read-extension is DEFERRED to P5.** The conditional modules (`stats / contacts
    / documents / events / getInvolved` + sponsor `tier`) have no data source until the P5 write side
    exists, so P4 renders them defensively (read optional payload keys → empty/absent). When P5 adds
    **mig 448** (read-extension + write side) the components light up with ZERO P4 rework.
  - **Demo seed = mig 447** (data-only, no schema/RPC): publishes `/c/finbars-fc` (rich: club_demo) +
    `/c/demo-boxing` (thin: club_demo_box) so the page is LIVE for the device-walk + Playwright smoke.
  - Gates PASS: build, hygiene 7/7 (all 5 files), casual-regression (isolated route — no casual surface
    or shared file touched; casual player view smoke clean), Playwright visual smoke of BOTH the rich +
    thin clubs vs the prototype. ⛔ STILL OWED: real-device walk (Hard Rule #13).
- **Phase 4 (original plan, retained):** from Claude Design wireframes — modular sections, per-club
  CSS-var theme, live/next-fixture strip (30s poll), Join/QR CTA, social-share preview.
- **Phase 5 — Setup wizard + edit dashboard** (`ClubSettingsScreen`): wizard (identity → crest →
  colours w/ contrast guard + auto-suggest-from-crest → hero → sections → teams → sponsors → first
  post → safeguarding → preview/publish) + always-available edit surface; client-side resize/compress
  on upload + orphan cleanup. Gates: casual-regression, Playwright, real-device walk.

**P4/P5 SCOPE LOCKED (session 220, operator-approved) — the public-page modules + their data reality.**
Design handover = `public club home page setup handover`. The thin/empty club is the PRIMARY design
state (a brand-new 1-team club with no stats/sponsors/FA-feed must still look alive). Mobile/parent-
first; safeguarding-dominant. Section keys (modular, toggleable, reorderable): `about, teams, fixtures,
news, sponsors, tournaments, stats, contacts, documents, events, get-involved`. Per-module calls:
  - **Fixtures/results — BUILD (two layers).** Form guide (W/D/L from our own completed `club_fixtures`)
    is the GUARANTEED always-filled panel. FA table = we INGEST the FA Full-Time feed (table+fixtures+
    results) off `club_leagues.fa_source_url` and render OUR OWN styled version (NOT a raw embed),
    PER-LEAGUE (a club's age groups = separate tables). Leagues with no usable feed degrade to the form
    guide — never a blank/fabricated table. ⚠️ **The FA ingest is a SEPARATE, heavier, brittle build**
    (server-side scraper/feed-reader; load-bearing unknown = does the pilot league expose a parseable
    feed; maintenance risk when FA changes pages) — this is the Epic-C "structured FA ingest" dependency.
    Ship the page form-guide-first; layer the FA ingest after. Plan B reuses `club_manager_update_home_
    fixture` (manual entry, mig 414).
  - **Player stats — BUILD all three, OPT-IN per team (present-when-data).** Reliability ("most reliable"
    board) computable from `club_fixture_availability` + `club_session_attendance`; POSITIVE-ONLY, honour
    minor/hide-roster safeguarding (never name a minor publicly), may be members-only for some clubs.
    Top scorer = from ref-app `match_events` goals → only populates for teams that ref through us
    (needs ref-player→member_profile identity link). POTM = manager-PICKED (name + month, clone
    `club_admin_set_player_of_tournament`), NOT voting.
  - **Sponsor tiers — BUILD.** Add `tier` (headline/match/supporter) to `club_sponsors`; tiered wall,
    degrades to flat row.
  - **Contacts — BUILD both.** Surface existing `clubs.contact_name/email` + a small roles table
    (committee + a prominent dedicated WELFARE/SAFEGUARDING OFFICER — FA-required, on-brand).
  - **Documents — BUILD.** New store: upload to `club-media` + public list/route (constitution, codes
    of conduct, privacy, safeguarding policy, fixture PDFs).
  - **Events — BUILD lightweight (NOT a calendar).** Competitive = `tournaments[]`→hub; social = a simple
    club-adds-one-off-items list (Awards Night / Fundraiser / Xmas Party: title, date, blurb).
  - **Get-involved — BUILD.** `links` jsonb `[{label,url}]` on `club_pages` (volunteer/shop/lottery/
    donate/PDF). Join CTA deep-links the EXISTING gated join/membership flow (reuse, not rebuilt).
  - **Live state — CANNOT.** `club_fixtures` has no in-play/minute data; hero = next-fixture/latest-
    result; 30s poll swaps next→result + pulls new posts/events; NO live club-match score (live exists
    only on the tournament hub).
  - **Backend plumbing:** every new field extends `get_club_public` (P2 read) — roll the page-data
    additions into ONE migration (447); the FA ingest is its own separate piece. New tables: club roles/
    contacts, club documents, social events, (+ sponsor `tier` column, `club_pages.links`, POTM field).
  - **Deferred (not P4/P5):** custom domains — see DECISIONS s220. Vercel charges ~£0 per domain
    (bundled), so subdomain (`<slug>.in-or-out.com`) is a near-free freebie and own-domain is a natural
    premium/Pitchero-switch tier. Wizard's share step shows the canonical URL (not hard-coded `/c/<slug>`)
    + a coming-soon "custom domain" slot — design for it, don't build it.

**Build-order note:** B and D are independent of each other (D only needs the Event OS engine +
venue-token RPCs). C is the only epic that truly depends on B (it needs B's structured FA ingest).

---

## EPIC C — FA-fixture → ref-assignment loop (+ RefSix-parity ref tools)

**Goal:** ingested FA fixtures can carry a referee, surfaced in the ref view + watch as the ref's
companion.

**Mechanism:** ingested fixtures (Epic B) attach to the existing **official arm**
(`match_officials`, `ref_link_self_to_official` self-claim + `venue_link_official_to_user`
operator-bind, mig 369). Ref opens app/watch → assigned games already there
(`get_my_next_assignment`). Companion tools on the working copy.

**HONEST BOUNDARY:** the FA feed is read-only; there is no documented write-back. FA league refs are
appointed by county FAs and official results go to Full-Time, NOT us. So we are the ref's **working
tool + the club's record**, exactly like RefSix — NOT the official result channel. Don't promise
write-back. (If the partner API ever lands, we could push results — future bonus only.)

**Ref is a STANDALONE module (audited s174):** a referee can use `apps/ref`
(platform-ref.vercel.app, fully independent deployment) with ZERO squad/club/membership. The
LEAGUE/OFFICIAL arm works standalone — `match_officials` references only a venue, no team/club FK;
ref enters by token (`get_fixture_state_by_ref_token`, no account) or self-claims an identity. The
CASUAL arm requires being a squad player (reuses `players.user_id`) — but a standalone external ref
wouldn't use that path. **Nuance:** standalone *usage* ≠ self-serve onboarding from zero — a
venue/league must still create the `match_officials` card (refs are appointed, not self-spawned;
this is correct, and mirrors RefSix importing appointments). → **"Ref" can be sold/enabled fully
independently of the club features.**

**RefSix-parity decisions (operator-locked 2026-06-22 — also in [[project_watchos_companion]]):**
- Competitor RefSix: freemium (free + PRO sub), watch-first, multi-watch, mature analytics. Pulls
  ref *appointments* in from association software; no confirmed result push-back to FA.
- **(1) GPS heatmap + distance + sprint %/speed → MATCH IT.** On-watch GPS+motion capture (same
  recipe as fitness apps; their "more accurate" = smoothing, no special hw). Bolts onto the Phase-4
  Outdoor-Football/HR workout already planned. ⚠️ test 90-min continuous-GPS battery drain on Apple
  Watch; store the track; heatmap UI.
- **(2) Video analysis → DO IT (build).** USER uploads own footage; we sync to our timestamped event
  log (jump-to-moment). We don't capture video. Cost = storage/bandwidth + sync/review UI.
- **(3) Multi-watch (Garmin Connect IQ / Samsung / WearOS) → DEFER (not killed).** Each = a separate
  native codebase. Stay ONE Apple-Watch-only target by design. Pitch INTEGRATION, not watch-breadth.
- Cheap wins to add to ref view: **sin-bins w/ return alerts + auto match reports** (cards→player+
  reason→report). RefSix has them; refs expect them.

**Depends on:** Epic B (fixtures must be rows before a ref attaches).

**Risk:** ref-arm detail is from mig-369 memory — short audit to confirm `match_officials` /
`get_my_next_assignment` shape against live code before build.

**Sizing:** ~2–4 sessions.

---

## COMPETITION MODEL — INTERNAL vs EXTERNAL (the defining axis)

The cleanest dividing line in the whole competition model. It decides whether In or Out is the
**system of record (write)** or a **mirror (read)**:

| | Source of truth | Our role | Maps to |
|---|---|---|---|
| **Internal league** | In or Out | Full write/manage | League Mode (native) |
| **Internal tournament/cup/sports day** | In or Out | Full write/manage | **Event OS** |
| **External (FA) league** | FA Full-Time | Read-only mirror + match-day trigger | `league_fixtures` provider = FA |
| **External tournament** | — | n/a (FA Full-Time is leagues, not tournaments) | — |

Consequences:
- **Tournaments are almost always internal** → Event OS has NO external dependency → our strongest,
  cleanest surface. The tournaments story never touches the FA-feed problem.
- **External leagues are display + trigger, NEVER edit.** ⚠️ FOOTGUN: an operator must never be able
  to edit an FA fixture/result in our UI — we can't write it back. External competitions must look +
  behave read-only. ⚠️ TWO-SOURCES RISK: a venue running an internal league AND with teams in an FA
  league has standings from two sources (ours computed, FA's read-only) — the UI must keep them
  visually distinct so operators know which is authoritative. Never blend them.
- A club can be any mix: internal-only, external-only, or both. Flags handle the combination; the
  internal/external axis handles whether each surface is editable or a mirror.

## EVENT OS — the internal-competition engine (BUILT; needs venue surfacing)

Event OS (migs 314–328, ALL phases complete, Tournify-killer — Tournify charges €40–120 PER
tournament for less) is NOT just brackets. Full surface, verified against live code s174:

**Formats:** round-robin / mini-league · group-stage→knockout · single-elimination · double-
elimination · **sports day / multi-discipline performance scoring** (athletics: heats, qualifiers,
attempts, configurable points table → team totals — not football at all).

**Lifecycle capabilities:** time-boxed event (multi-day) w/ multiple competitions inside · team
registration (host direct + external self-serve invite codes + approve/reject/waitlist) · auto-
schedule (circle-method, pitch allocation, kickoff times, ref assignment) · live scoring via ref
app (token-based) · standings w/ H2H tiebreakers · auto-advancement (single + double elim) · cards +
auto-suspension · sponsors + branding (colours/logo/hero/tagline) · Player of the Tournament ·
equipment hire · public hub (`/tournament/<slug>`: live fixtures/scores/standings/brackets/perf
results, 30s poll, shareable poster + QR, self-serve registration).

**Overlap with League Mode:** both share `competitions`/`fixtures`/`competition_teams`. Event OS =
time-boxed EVENT wrapper (`tournament_events`); League Mode = ongoing SEASON wrapper. Together they
are the ENTIRE "internal" competition surface.

**Where it lives today:** create/manage is CLUB-ADMIN gated, in the CONSUMER app (SessionsScreen
"Tournaments" tab). Venue dashboard has only venue-token ref/manage RPCs.

### EPIC D — venue-operator tournament create (surface Event OS in the venue dashboard)
**Goal:** operators create/build/manage tournaments from the venue console (today only club admins
can, in the consumer app). The ENGINE is built — this is auth + UI, not new tournament logic.
**Scope:** clone the `club_admin_*` create/build/schedule RPCs onto venue-token auth
(`resolve_venue_caller` + a manage cap); surface in the venue rail under the Competition umbrella;
make Cups-tab reachable when empty. Two creation paths into ONE engine: club-admin (consumer, as
today) + venue-operator (dashboard, new). Gated by the `tournaments` flag (Epic A).
**Sizing:** ~3–5 sessions (RPC auth clones + EV + venue UI).

## VENUE OS NAV SIMPLIFICATION (a deliverable OF Epic A + a small IA pass)

Two separate jobs — flags solve the first, not the second:
- **Modulation (flags + discipline) = WHICH items appear.** Nav is one of Epic A's 3 gate layers.
  Today the venue rail (Dashboard.jsx `TABS`) is 18 items / 5 groups, only 2 conditional (Access by
  role, Cups by data). Map each item to a gate: always-on core (Operations, Bookings, People,
  Payments, Facility, Staff, Settings) · flag-gated (Memberships, Sessions/Classes/Trainers/Room
  hire, Equipment, Competition) · discipline-gated (football never sees Classes/Trainers; gym never
  sees Leagues/Cups — discipline = relevance, flag = purchased, BOTH gate nav) · data-gated (the
  Cups zero-footprint pattern). A football club drops 18→~8; a gym sees a different ~8.
- **IA cleanup = HOW the survivors are grouped (design, NOT flags).** Overlaps flags won't fix:
  Sessions(Directory) vs Classes(Facilities) duplicate; Leagues+Table+Cups = one "Competition"
  split three ways; Equipment+Room hire+Spaces scattered; Customers+Teams+Players = one people-tree.
- **Target shape:** ~7 always-on core + modular sections each with internal tabs — Memberships
  (Members/Sessions/Trainers), **Competition (internal: Leagues + Event OS tournaments/cups/sports
  days · external: FA-fed read-only)**, Equipment & Hire, Public page. Competition umbrella is where
  Cups stops being a stray item and Event OS venue-create (Epic D) lands.
- Sequencing: nav-presence ships WITH Epic A; the IA merge is a small dedicated venue-UI cycle (can
  run before/alongside A — pure UI, no flag dependency).

## VENUE OS NAV — FULL PHASED PLAN + FEATURE-OWNERSHIP MODEL (locked 2026-06-22, session 178)

Operator decision: do the WHOLE thing **phase-by-phase, not half-IA**. The nav simplification done
fully = the IA cleanup (Phase 0) + Epic A's flag engine (Phases 1–4). Confirmed: **default-all-on**
(non-negotiable, zero regression), **tiers deferred** (pick-and-mix flags underneath, named presets
on top), **build phase-by-phase** (each shipped + merged before the next, cloud-session discipline).
This single track closes backlog **#10 (nav)** AND **#11 (modularity toggles)** and lays Epic A — the
foundation B/C/D all depend on.

### Feature ownership splits in TWO  (resolves "a club can have multiple venues")
Features are not all the same kind of thing:
- **Facility features (venue-owned) → `venue_features` (per venue):** Bookings, Spaces, Room hire,
  Equipment, pitch/booking ops. About the physical facility.
- **Org features (club-owned) → `club_features` (per club):** Memberships, Competition (League Mode +
  Event OS), Coaching/Classes/Trainers, Public web, Tournaments. These **follow the club to every
  venue it operates from.**
- **Venue rail = (this venue's facility features) ∪ (features of every club operating at this venue).**
  A multi-venue club's org features appear at each of its venues automatically; a venue hosting two
  clubs shows the union; a single-club venue behaves exactly as the simple model. → **Epic A is TWO
  flag tables, not one.** Discipline (relevance) still multiplies in on the club axis.

### Cross-venue / cross-club membership  (resolves "a membership could cross venues and clubs")
Today `venue_memberships.venue_id` pins a membership to ONE venue — wrong for a multi-venue club.
**SCOPE LOCKED s180 (option 1) — full scoping audit in DECISIONS s180; this is Phase 2.5, mig 401.**
- **Build now (Phase 2.5): club-scoped memberships honored across the club's venues — via `club_id`,
  NO new column.** The live audit found `venue_memberships` already carries `club_id` (all 23 live rows
  set, 0 club-less), so "entitled at venue V?" = *the member holds an active membership whose CLUB
  operates at V* (`club_id → club_venues`). One STABLE helper `_membership_covers_venue(member/row,
  target)` becomes the single seam. **Exact surface = 6 eligibility gates** (`member_book_class_session`,
  `member_book_appointment`, `member_purchase_class_package`, `member_join_club_team`,
  `member_list_trainers`, `member_get_venue_membership_pass`) move from `venue_id =` to the helper; the
  other ~9 `venue_memberships`+`venue_id` functions key off club_id/audience/own-enrolment-venue (not
  eligibility — audit-to-confirm, expected no-change). Enrolment stays venue-pinned (tier is
  `venue_membership_tiers.venue_id` NOT NULL — scope is consumption, not creation).
- **Cross-CLUB passes — DEFERRED ENTIRELY (option 1, s180), NOT modelled-but-dormant.** A membership
  valid across DISTINCT `clubs.id` (leisure-group/franchise) crosses an ORG boundary; the entitlement
  predicate is easy but the blockers are commercial/safety, not SQL: (1) **settlement** — tier price +
  Stripe-Connect sub / GC mandate belong to ONE connected account, so cross-club consumption needs a
  revenue-split rule (a commercial decision); (2) **safeguarding / org RLS wall** — club B's operator
  would serve a member who enrolled at club A across separate `id_mandate`/`safeguarding_config` orgs;
  (3) **no demand** — 0 multi-venue clubs live. So we do NOT pre-add dormant `club_groups`/scope schema
  now (option 2 rejected as speculative). The single helper seam keeps it expressible: when a pilot
  asks, decide revenue-split + cross-org consent FIRST, then add schema — a follow-up, not a rework.
- ⚠️ **Highest-risk surface in the epic (RLS + eligibility correctness) — EV every one** of the 6 gates
  against a deliberately multi-venue `_e2e_` club fixture (member of a 2-venue club books at the SECOND
  venue; non-member still rejected; single-venue data byte-identical — the no-op proven, not assumed).

### Phases + effort (≈5–6 build sessions total; one shipped+merged before the next)
- **Phase 0 — IA cleanup (pure UI, no flags):** rail regroup/rename (Run · People-with-tabs ·
  Programmes · Competition · Club&admin), Memberships **13→5** tabs, kill duplicate Staff, renames
  (Sessions→Club sessions · Table→Standings), **internal/external Competition split** (FA surfaces
  visibly read-only — protects the mig 394–397 fixtures work), venue-hex tech-debt (BUGS s174) fixed.
  Ships standalone, additive. **~1 session.**
- **Phase 1 — Flag foundation:** `venue_features` + `club_features` (extend the mig-351
  `get_team_feature_flags` / `getTeamFeatureFlags` pattern — don't invent a new one), **3-layer gate
  (nav + route + RPC)** so off = unreachable (closes the deep-link footgun), **default-all-on**.
  **~2 sessions.**
- **Phase 2 — Dependencies + discipline axis + operator toggle UI (= backlog #11):** dependency graph
  (Memberships→Payments, Coaching→Memberships→Payments, paid Tournaments→Payments; auto-enable
  prereqs, block unsafe disables), discipline × purchased gating, per-club/venue toggle UI in the
  venue console. **~1.5 sessions.**
- **Phase 3 — Package presets:** named presets expand to a flag set (flags = truth, presets =
  shortcuts; commercial tier decision stays deferred). **~0.5 session.**
- **Phase 4 — Rail modulation wiring:** point the cleaned-up rail at the flags → 18→~8 per club.
  **~0.5 session.**
- **Membership-scope refactor** rides Phase 1–2's Memberships gate; **+0.5–1 session.**

## SEQUENCING

A → B → C, plus D (venue tournament-create, depends on A's `tournaments` flag) and the venue nav
work (presence with A, IA merge standalone). Each shipped and merged before the next (cloud-session
discipline — one session start-to-finish). A is the prerequisite for everything; B feeds C; D
surfaces the already-built Event OS engine. Run feature-plan skill against live code on each epic
before any edits — start by confirming the stale bits (ref arm shape, the FA feed format for the
target club's league, current Event OS club-admin RPC signatures before cloning to venue-token).
