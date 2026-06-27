# CLUB_PAGE_BUILD_HANDOVER.md — In or Out Public Club Page (Epic B) · LOCKED SCOPE

**Audience: Claude Code / engineering. Authoritative — supersedes the other docs where they conflict**
(`COMPOSITION_SPEC`, `VOCAB_PROPOSAL`, `DESIGN_HANDOVER` kept for detail/history). Reconciled to the
backend contract + the locked feasibility answers.

Designs are nine `.dc.html` files (canvas mode). Build **presentational** components that take props
matching the field names here. **Legend:** ✅ in payload now · 🔧 confirmed build (this phase) · ⚠ conditional
(present only when a team has the data / opts in) · ❌ out of scope this phase.

---

## 1. North star + the one hard principle

Baller-level live-data feel for a club that configures almost nothing; mobile-first, parent-first,
safeguarding-dominant. **The thin/empty club is the PRIMARY design target** — one team, no stats, no
sponsors, no FA feed, no hero image must still look full, alive and *deliberate*. Every module below must
have a designed empty/absent state and **degrade gracefully** — never a blank panel, never fabricated data.

## 2. Public read — `get_club_public(slug)` (build to this)

```
{ found,
  club        {name, short_name, discipline, founded_year},
  branding    {primary_colour, secondary_colour, accent_colour, crest_url, hero_url,
               tagline, about, socials{facebook,instagram,x,youtube,tiktok,website},
               sections:[{key, enabled, order}]},          // 11 keys — see §4
  teams       [{cohort, name, category, ... , members:[{name, is_minor, photo_url}]}],
  leagues     [{name, season_label, fixtures:[{our_team, opponent, is_home,
               scheduled_date, kickoff_time, home_score, away_score, status}]}],
  sponsors    [{name, logo_url, website_url, display_order, active, tier}],  // tier 🔧
  news        [{slug, title, body, hero_url, author_name, published_at}],
  tournaments [{slug, name, status, event_date}],
  // 🔧 added this phase (conditional slices):
  stats       per-team {reliability:[{name, pct}], topScorer:{name,goals}|null, potm:{name,month}|null},
  contacts    {contact_name, contact_email, welfareOfficer:{name,email}|null, committee:[{role,name,email}]},
  documents   [{title, url, type, size}],
  events      [{title, date, blurb}],          // social "what's on" — NOT a calendar
  getInvolved [{label, url}] }
```
- `found:false` → render the 404/not-found screen.
- `news[].body` is full text → truncate client-side for the homepage teaser.
- **`photo_url` is ALWAYS null today** → avatar placeholders everywhere, ready to accept a real photo later.
- `status` ∈ `scheduled | completed | postponed | void` — **no in-play/live value** (see §5).

## 3. Five honesty constraints (design MUST account for these)

1. **No computed league table.** We only hold our own games vs free-text opponents. `fixtures` ships a
   **form guide (W/D/L from our `completed` fixtures) — the guaranteed, always-filled layer.** The richer
   **FA table** comes from ingesting the club's FA Full-Time feed (we render our own styled version), is
   **per-league/age-group**, and **degrades to the form guide** when a league has no usable feed. One styled
   component, two fidelities. Position/"meaning" line is only valid **from the FA feed**, never computed by us.
2. **No member photos yet** (`photo_url` null) → intentional avatar placeholders.
3. **Safeguarding is server-side + dominant.** Minors → "First L." (initial, no photo); rosters may be fully
   hidden. Every roster/squad/stat must look deliberate when truncated or hidden. **Minors are NEVER named on
   public stat boards — excluded entirely** (not even an initial).
4. **Modular sections** — any of the 11 can be toggled off and reordered; design each as independent, any may
   be absent, arbitrary order.
5. **Empty-state is primary** (see §1).

## 4. The 11 section keys (modular blocks) + data + empty/degrade behaviour

| `key` | shows | source | empty / degrade |
|---|---|---|---|
| `about` | blurb, founded, socials | `branding.about`,`socials`,`club` | hide if no about |
| `teams` | cohorts → teams (senior→youngest) → mini-view link | `teams[]` | always ≥1 team |
| `fixtures` | **eldest/senior team** form-guide + results; FA table when fed | `leagues[].fixtures[]` (+FA feed) | form-guide always; table only when feed |
| `news` | latest-first teaser → article page | `news[]` | hide block if 0 posts |
| `sponsors` | **tiered** wall (headline=hero, supporters=grid) | `sponsors[]` (`tier`,`display_order`,`active`) | degrade to flat row; hide if none |
| `tournaments` | links into existing tournament hub `/a/<slug>` | `tournaments[]` | hide if none |
| `stats` | reliability board (positive-only) + top-scorer + POTM, **opt-in per team** | `stats` slice | show 1–3 cards present; hide whole block if a team tracks nothing; **no minors named** |
| `contacts` | committee + prominent **Welfare/Safeguarding Officer** | `contacts` | clean partial/empty; Welfare officer foregrounded |
| `documents` | policies/forms list (constitution, codes, privacy, safeguarding, PDFs) | `documents[]` | intentional empty state |
| `events` | social "what's on" upcoming list (Awards Night, Fundraiser…) | `events[]` | hide if none |
| `get-involved` | links CTA list (volunteer/shop/lottery/donate) + Join/QR CTA | `getInvolved[]` | hide list if none; Join CTA can stand alone |

`hero` (state-driven, §5) and `footer` are page-level, always present — not in the toggle list. **Homepage
fixtures default = the eldest/senior team; full per-league tables live on each team's mini-view.**

## 5. Hero — next-fixture / latest-result ONLY (no live ticker on the club page)

Derive from `leagues[].fixtures[]`: **pre-match** (nearest `scheduled` — countdown + opponent + venue),
**post-match** (most recent `completed` + score → report), **idle** (none upcoming → crest + tagline + next
date + Join), **empty/zero-config** (crest + 3 colours only, still intentional). The ~30s poll only **swaps
next-fixture → result** when a result lands (and pulls new posts/events). **There is NO live in-play club
score** — `club_fixtures` has no minute/in-play state; live scores exist only on the tournament hub. **Do not
design a ticking live score on the club homepage.** (Designs updated accordingly.)

## 6. Theming (per-club, scoped, accents only)

3 colours (`primary/secondary/accent`) via **CSS vars scoped to the page container — no global override**.
They skin **accents / headers / rails only** — they do NOT replace the type/icon system. Platform stays
**Bebas Neue** headings/numbers, **DM Sans** body, **Phosphor icons (thin)**, `tokens.css` spacing. *(Design
files use emoji as placeholders for Phosphor-thin icons and a heavier colour wash for legibility on dark —
apply the real icon set + accent-only theming on the way in.)* Contrast guard is **advisory** (wizard,
client-side) + auto-suggest from crest; server only validates hex.

## 7. Wizard + edit dashboard — write ops

`club_set_page` (slug, 3 colours, crest_url, hero_url, tagline, about, socials, sections) · `club_publish_page`
(published on/off — design draft AND live) · sponsors add/update/remove/**reorder(display_order)**/active ·
news create/edit/delete/publish · `club_set_safeguarding` (min_public_age + hide_public_rosters).

**Canonical flow:** identity → crest → colours (contrast guard + auto-suggest) → hero → **sections (toggle +
drag-reorder, 11 keys)** → teams (auto-pulled, **read-only confirm**) → sponsors → first news post →
safeguarding → preview (as public) → publish. Then an **always-on edit/manage dashboard** (reopen any block;
clubs return to tweak, not re-run). Draft vs published obvious throughout.

- **Contrast guard = advisory visual warning, never a hard stop** (server doesn't block low contrast).
- **Safeguarding step is TIGHTENING-ONLY:** show the current policy (a venue operator may have set it); allow
  only *stronger* (raise `min_public_age`, switch `hide_public_rosters` ON). Loosening is venue-controlled —
  no two-way toggle; explain why.
- **Images:** client-side resize/compress on upload; clean up orphaned images on post/page delete. Limits:
  5 MB, png/jpeg/webp/gif/svg, bucket `club-media/<club_id>/`. Targets: crest 512², hero 16:9 1920×1080,
  sponsor ~400×200, post 1200×675, OG 1200×630.
- **Forward-compat:** the publish/share step shows the **canonical URL** (don't hard-code `/c/<slug>`); leave a
  **"custom domain — coming soon"** row in settings (subdomain/own-domain later). Don't build it, don't preclude it.

## 8. Also on the public page
Next/live-fixture treatment (~30s poll, swap-only — §5) · Join/QR CTA (deep-links the **existing** membership
flow — flow itself reused as-is, out of scope) · social-share OG card (1200×630, stateful next/result).

## 9. Design-file map
Homepage blocks → `Football Baller` / `Gym Boxing`. Hero states + theming + **thin-club page** → `Hero States`.
Team + player → `Team View`. Match-day + Join → `Destinations`. Utility blocks (about/contacts/docs/events/
sponsors) → `Club Pages`. Share + edge states + article → `Share Artefacts`. Setup → `Setup Wizard`. Manage +
editors → `Manage Dashboard`.

## 10. Scope summary
**Build this phase (🔧):** form-guide + FA-table component · sponsor tiers · stats slice (reliability/top-scorer/
POTM, opt-in, positive-only, no minors) · contacts (committee + Welfare Officer) · documents store · social
events list · get-involved links · OG card + image resize/compress · 11-key section model · tightening-only
safeguarding. **Reused as-is:** membership/join flow (CTA deep-links it). **Out of scope:** live club-match
ticker (no source), custom domains (slot only).
