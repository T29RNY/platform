# QR Onboarding — Full Scope & Build Plan

## Context

QR codes are the next net-new build and the centrepiece of the 2026-06-18
pilot pitch (see `STRATEGY.md`). The architecture is settled in
`DECISIONS.md` session 84 "QR ONBOARDING ARCHITECTURE" and the entries that
follow it. This doc is the **build plan** — the slice-by-slice execution
order feature-plan.md produced (session 84), to be worked through one
AUDIT → EXECUTE → VERIFY → COMMIT cycle per slice.

**Core principle — stable code → mutable destination:** never QR-encode an
internal database ID or a direct entity URL. A printed/laminated QR encodes
ONLY `https://in-or-out.com/q/<code>`; the `invite_links` row behind that
code can be re-pointed forever.

**Library:** `react-qr-code` (not yet a dependency anywhere — added in
slice 4 to `apps/display` and `apps/venue`).

**Slices 1–4 are demo-critical for 18 June and land first. 5–7 follow.**

## Three surfaces, do not blur (full detail in DECISIONS.md)

- **Venue dashboard** (`apps/venue`) — PRIVATE staff ops. Where the QR is
  *managed* (slices 4, 5, 7).
- **Reception display** (`apps/display`) — PUBLIC *passive* wall screen.
  Where the QR is *rendered* (slice 4).
- **Venue landing page** (`apps/inorout` `/q/<code>`) — PUBLIC *active* phone
  page. Where a scan *goes* (slices 2, 3, 6).

## Settled product rules (full reasoning in DECISIONS.md session 84)

- **Public landing surfaces public/open competitions + register-your-team
  ONLY — never private/casual teams.** No `venue_id` added to casual
  `teams`; slice 3 reuses the display's competition/team assembly. Zero
  `teams` schema change.
- **You register a TEAM, not a person.** A league is a competition of teams;
  there is no individual "join a league" path. Landing "join options" =
  captain registers a team (`join_register_team`).
- **Two QR types, two speeds.** `action='join_team'` (a team admin's own
  code → instant `playerJoinTeam`, the STRATEGY.md <30s money moment — the
  demo display QR is one of these, pointing at a demo team) vs
  `action='venue_landing'` (public "what's on" + register-your-team,
  auth'd + approval-gated, NOT <30s).
- **Venue↔casual-team dashboard visibility is a SEPARATE post-pitch
  feature** (FEATURES.md row), out of QR scope.

## What already exists (reuse, do not rebuild)

- **Router** — pathname-based `getRoute()` (`apps/inorout/src/App.jsx`
  ~L56–117). New `/q/<code>` route slots in next to `/join` (~L80).
- **Casual join flow** — `getTeamByJoinCode` → `useRequireAuth` gate →
  `playerJoinTeam` → redirect `/p/<token>?just_joined=1`
  (App.jsx ~L919–948). iOS PWA install REQUIRES the final URL be
  `/p/<token>` (Hard Rule #13) — slice 2 reuses this redirect verbatim.
- **League registration (captain submit)** — `join_register_team`
  (migs 098/158) + wrapper `joinRegisterTeam` (supabase.js:2998) exist;
  **NO UI** (slice 3 builds the first-ever form). `joinGetLeagueByCode`
  wrapper (supabase.js:2288) likewise built, uncalled.
- **League registration (venue approve)** — COMPLETE: `venue_approve_team_
  registration` / `venue_reject_team_registration` (migs 099/100) +
  wrappers + live UI (`Operations.jsx` pending list →
  `RegistrationActions.jsx`). Lights up automatically when slice 3 drops a
  `pending` row. **One enrichment needed — see slice 3.**
- **Display** — `apps/display`; rotation `lowerPanels` array (App.jsx ~L237);
  keyed off `venues.display_token` via `getDisplayState`; Plus Jakarta Sans
  / JetBrains Mono.
- **Venue dashboard** — `apps/venue`; tabbed nav `Dashboard.jsx` TABS
  (L21–39); every RPC takes a `credential` resolved by
  `resolve_venue_caller`; teams via `venueListActiveTeams`; Manrope /
  `--accent #FFC83A`. `StaffView.jsx` is the panel template.
- **Token + helpers** — `generate_url_safe_token` (code generation);
  `audit_events` (Hard Rule #9 for every write RPC).

---

## SCHEMA — `invite_links` (slice 1, migration 248)

```
invite_links
  code         text PRIMARY KEY        -- generate_url_safe_token, server-side
  entity_type  text NOT NULL CHECK (entity_type IN ('team','venue','fixture'))
  entity_id    text NOT NULL           -- teams.id / venues.id / fixtures.id::text
  action       text NOT NULL CHECK (action IN ('join_team','venue_landing','match_checkin'))
  active       boolean NOT NULL DEFAULT true
  expires_at   timestamptz NULL        -- NULL = never
  max_uses     int NULL                -- NULL = unlimited
  use_count    int NOT NULL DEFAULT 0
  label        text NULL               -- venue-facing ("Reception poster")
  created_by   text NULL               -- venue actor_ident (audit)
  created_at   timestamptz NOT NULL DEFAULT now()
  Index: (entity_type, entity_id)      -- for the management panel's per-entity list
```

`entity_id` is text, not a typed FK (the point is decoupling; `fixtures.id`
is uuid, others text) — referential integrity is enforced INSIDE the
resolver per `entity_type`, returning a not-found status if the target is
gone. The QR encodes only `/q/<code>` — never `entity_id`.

---

## SLICE-BY-SLICE BUILD ORDER

Each slice is its own AUDIT → EXECUTE → VERIFY → COMMIT cycle. New write
RPCs require **ephemeral-verify** + **rpc-security-sweep**. Anything
touching `apps/inorout` requires **casual-regression**; routing/join/install
changes require a **real-iPhone PWA test** (Hard Rule #13). Update RPCS.md,
SCHEMA.md, FEATURES.md as each slice ships.

### Slice 1 — Routing layer  🔴 DEMO-CRITICAL
- SQL mig 248: `invite_links` table + `_down.sql` (same commit, Hard Rule #11).
- `resolve_invite_link(p_code)` → jsonb — **read-only**, anon. Returns
  `{ok, code, action, entity_type, entity_id, status, destination{…}}`;
  `status ∈ ok|inactive|expired|exhausted|not_found`. Joins to the target
  table per `entity_type` and denormalises what the `/q/` page needs.
- `redeem_invite_link(p_code)` → jsonb — **write**, anon. Atomic
  `use_count++`, re-checks active/expiry/max_uses in-txn, INSERTs
  `audit_events`. → EV + sweep. (v1 demo codes use `max_uses=NULL`, so
  non-blocking — but built now so counting is correct from day one.)
- JS wrappers `resolveInviteLink` / `redeemInviteLink` + index.js barrel.
- `/q/<code>` route + `InviteResolve.jsx` (dispatches on `action`,
  unknown-action fallback).
- RPCS.md (record consumers, Hard Rule #14) + SCHEMA.md + FEATURES.md.

### Slice 2 — Join-team action  🔴 DEMO-CRITICAL
- `InviteResolve.jsx` `join_team` branch hands off to the EXISTING join
  flow (resolve team → `useRequireAuth` → `playerJoinTeam` → redirect
  `/p/<token>?just_joined=1`). No new join logic; reuse the redirect so iOS
  install is unaffected.
- → casual-regression + real-iPhone PWA test before commit.

### Slice 3 — Venue landing page  🔴 DEMO-CRITICAL
- `get_venue_landing(p_venue_id)` → jsonb — read-only, anon. Venue identity
  + active competitions + their teams (REUSE `get_display_state` assembly,
  per [[feedback_reuse_over_new_systems]]) + register-your-team entry point.
  Public/open only — never private teams.
- `VenueLanding.jsx` — "what's on here" + **register-your-team form**
  (first-ever UI for `join_register_team` / `joinRegisterTeam`).
- **Approval-card enrichment (in this slice):** the existing approval card
  shows only team name — too thin for a real self-serve registration.
  Extend `v_pending` in `venue_get_state` (latest mig 227 → REPLACE) to also
  select the **competition/league NAME** (join via existing `v_competitions`
  CTE) + **`admin_email`** (`registered_at` already present). Return-shape
  add → Hard Rule #12 (consumer = raw-jsonb `Operations.jsx` card). Render
  "competition · captain email · registered Xh ago" on the card.
  *Watch-item, NOT v1:* public QR lets anyone mint `pending` rows — consider
  rate-limiting/abuse handling later; the approval card is the gate.
- → casual-regression before commit.

### Slice 4 — QR rendering  🔴 DEMO-CRITICAL
- `npm i react-qr-code` in `apps/display` AND `apps/venue`.
- Display: `QRPanel.jsx` added to `lowerPanels` rotation, gated by a
  `display_config.zones` toggle, wrapped in `PanelBoundary`. PJS heading +
  JetBrains Mono caption. Encodes a `/q/<code>` (demo: a `join_team` code).
- Venue: per-team + per-venue QR in the dashboard (view / copy / print).
- Build BOTH apps after.

### Slice 5 — Printable assets
- `PrintAssets.jsx` — print-friendly poster / table-talker (`@media print`),
  opened from the venue dashboard.

### Slice 6 — Match check-in
- `checkin_via_invite(p_code, p_player_token)` → jsonb — write, anon.
  Resolves a `fixture`-scoped invite → marks the caller IN for tonight's
  fixture, reusing `set_player_status` semantics (respects the mig-241
  game-live gate). `fixtures.id` is uuid → cast `entity_id` text. INSERTs
  audit_events. → EV + sweep.
- Check-in confirm UI in `InviteResolve.jsx`. → casual-regression.

### Slice 7 — Link management
- `venue_create_invite_link`, `venue_set_invite_link_active`,
  `venue_repoint_invite_link` (writes) + `venue_list_invite_links` (read) —
  caller via `resolve_venue_caller`; server validates the target entity
  belongs to the caller's venue (no minting codes at another venue's
  teams); all writes INSERT audit_events. → EV + sweep on the three writes.
- `InvitesView.jsx` venue tab (Directory group, `StaffView.jsx` template) —
  create / deactivate / re-point + list, with QR view/copy/print per code.

---

## RISK FLAGS

1. **PWA install path (slice 2)** — must terminate at
   `/p/<token>?just_joined=1` or iOS install silently breaks (Hard Rule
   #13). Reuse the existing redirect.
2. **`fixtures.id` uuid vs `entity_id` text (slice 6)** — store/cast as text.
3. **mig-241 game-live gate (slice 6)** — check-in only works when the
   schedule is `game_is_live`; demo timing must account for it.
4. **Two apps gain `react-qr-code` (slice 4)** — monorepo install; build both.
5. **Public-QR abuse (slice 3 watch-item)** — pending-row spam; approval
   card is the gate; rate-limiting deferred.
6. **Grant discipline** — every new anon-callable RPC must EXPLICITLY GRANT
   EXECUTE to both anon AND authenticated (the player app runs authenticated
   post-sign-in) — per [[feedback_vc_parity_sweep_grants]].

## TEST PLAN

- **Demo (per slice):** mint a code → `/q/<code>` resolves to the right
  destination; slice 2 join lands on `/p/<token>` with the install carousel;
  slice 4 QR scans from the live display to the same `/q/<code>`.
- **Real team (auth):** join + check-in on a freshly-created real team,
  never `team_demo` (Hard Rule #6).
- **DB:** after each write, SELECT `invite_links` (use_count) +
  `audit_events` (server trace). EV uses `_e2e_`-prefixed throwaway rows
  only (Hard Rule #15).
- **Real-device:** slice 4 display on a real TV; slice 2 join on a real
  iPhone home-screen install.

---
*Created session 84 (2026-06-11). Architecture: DECISIONS.md "QR ONBOARDING
ARCHITECTURE" + following entries. Backlog row: FEATURES.md "QR Onboarding
v1". Pilot context: STRATEGY.md.*
