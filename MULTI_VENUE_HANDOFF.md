# Multi-venue (pilot ask #7) — Handoff & Scope

> **STATUS (2026-06-23, s188):** SCOPED, locked, ready to build. Pilot club has **2 venues
> with pitches under ONE operator** and runs **training AND matches at either site**. Scope is
> **same-operator only** (one `company_id` owns the venues); different-operator multi-venue stays
> deferred (inherits the cross-club settlement/safeguarding wall, DECISIONS s180). Next free mig = **412**.

## GOAL (plain English)
A club operates from more than one site owned by the **same operator**. Any activity — a training
session OR a match/fixture — can be scheduled at **either** of the club's venues, lands on the right
venue's pitch, and shows the right venue's address/availability/reception to members and staff.

## WHAT ALREADY WORKS (the access layer — shipped mig 401, s180)
- **Membership entitlement** resolves across all the club's venues (`_member_entitled_at_venue` /
  `_membership_covers_venue` via `club_venues`) — a member enrolled via the club is honoured at every
  venue the club operates from.
- **Feature flags** (`club_features`) follow the club to every venue.
- **Teams / cohorts / members** are club-scoped (`club_id`) → both venue consoles already see them.

So "who's allowed where" is solved. The gap is **anchoring each activity to the right site**.

## GAPS (audited s188)
1. **Sessions aren't venue-anchored.** `club_sessions.location` is **free text**, no `venue_id`/pitch —
   a training session can't be tied to a specific venue, so it never reaches that venue's reception/
   availability/address. (Create RPCs: `club_create_session` / `club_update_session` /
   `club_manager_create_session(_series)` — all take `p_location text`, no venue.)
2. **Fixtures are single-venue-locked.** `club_leagues.venue_id` pins a league to ONE venue, and
   `club_create_fixture` rejects any pitch not at the caller's venue (`pitch_not_in_venue`). Can't
   schedule a match at the club's *other* venue.
3. **No pitch reservation / clash protection.** Neither `club_sessions` nor `club_fixtures` writes
   `pitch_occupancy`, so club activity doesn't show as "busy" on a venue's calendar and can double-book.
4. **No same-operator seam yet.** `venues.company_id` exists (operator grouping) but nothing uses it to
   authorise "this club's other venue, owned by the same operator."

## KEY DECISIONS (operator-confirmed s188)
- **Same operator only.** Authorise a cross-venue write iff the target venue is in the club's
  `club_venues` AND shares the caller venue's `company_id` (non-null). No settlement/consent needed.
- **Activity venue is chosen per-activity, not fixed.** Training and matches can both be at either site,
  so do NOT add a "training venue / match venue" role to `club_venues` — each session/fixture picks its
  venue (+ pitch) at create time. `club_venues` stays the flat set of venues the club operates from.
- **`club_leagues.venue_id` stays** as the league's owning/home venue (for ownership rollup); individual
  fixtures may point at any of the club's same-operator venues.

## PROPOSED PHASES (each its own AUDIT→EXECUTE→VERIFY→COMMIT cycle; same-operator)

### Phase 1 — venue-anchor club sessions (mig 412)
- `club_sessions` += `venue_id text FK→venues` (nullable; **backfill** existing rows to their club's
  current single `club_venues` venue → byte-identical) + optional `playing_area_id uuid FK→playing_areas`.
- New shared guard `_venue_in_club_operator(p_caller_venue_id, p_club_id, p_target_venue_id)` →
  target ∈ `club_venues(club)` AND `venues.company_id` equal + non-null. (Reused by Phase 2.)
- `club_create_session` / `club_update_session` / `club_manager_create_session(_series)` gain
  `p_venue_id` (+ optional `p_playing_area_id`); validate via the guard + pitch∈venue. Old overloads
  DROPped, re-granted. Audited.
- Session readers (`member_list_club_sessions`, the venue/club session lists, `club_session_detail`)
  carry `venue_id` + venue name/address so the member sees WHERE each session is and the right venue's
  reception/display picks it up. Wrappers + barrel; **casual-regression** (apps/inorout reads sessions).
- Venue UI: session create/edit gains a **venue picker** (the club's same-operator venues) + optional
  pitch. Member UI: session card shows the venue + address/directions.
- Gates: rpc-security, **EV** (own `_e2e_` 2-venue same-company club; session at venue B authorised,
  at a different-operator/other-club venue rejected, backfill default), build + hygiene, casual-regression
  (additive — session shape gains keys), Playwright smoke. Same-commit SCHEMA/RPCS/FEATURES/DECISIONS/BUGS.

### Phase 2 — cross-venue fixtures (mig 413)
- Relax `club_create_fixture` / `club_update_fixture` pitch validation from "pitch.venue = caller venue"
  to "pitch.venue ∈ the league's club's same-operator venues" (reuse the Phase-1 guard). `club_leagues`
  unchanged. Fixture readers already return `pitch_name`; add `venue_id` + venue address so the
  matchday link (`get_club_fixture_matchday`, which already derives venue address from the pitch) shows
  the correct ground for an away-site home game.
- Venue UI: the Fixtures-tab pitch picker spans the club's same-operator venues (grouped by venue).
- Gates: rpc-security, EV (fixture at the club's 2nd venue authorised; pitch at a non-operator venue
  rejected), build + hygiene, casual-regression N/A (venue-app + matchday public only, no apps/inorout
  write) — confirm matchday public read still clean. Same-commit docs.

### Phase 3 — pitch occupancy / clash protection (mig 414, OPTIONAL — decide after P1/P2)
- Sessions + fixtures that carry a pitch write `pitch_occupancy` at the chosen venue (source_kind
  'club_session' / 'club_fixture') so they show busy on that venue's calendar and the existing
  exclusion constraint blocks double-booking (`slot_unavailable`). Heavier (touches the venue calendar +
  cancellation/void must release occupancy). Build only if the pilot needs hard clash-protection rather
  than just correct-venue display.

## OUT OF SCOPE
- Different-operator multi-venue (rent a stranger's venue) — settlement/safeguarding wall, deferred.
- Cross-CLUB passes (leisure-group across clubs) — deferred entirely (DECISIONS s180).
- Per-team fixed "home ground" automation — activity venue is per-activity by operator choice.

## SEQUENCING
Order 1→2→(3 optional), each merged before the next (cloud-session discipline). Phase 1 unblocks the
"train at the other site" story; Phase 2 the "play at the other site" story; together they are the #7
headline. Phase 3 is the polish that makes the venue calendars honest.

---

## NEXT-SESSION KICKOFF PROMPT (paste-ready) — PHASE 1

```
Read MULTI_VENUE_HANDOFF.md in full (pilot ask #7, scoped + locked: SAME-OPERATOR only, one company_id
owns the club's venues; training AND matches can be at either site; activity venue chosen per-activity,
no fixed role on club_venues). The access layer (membership entitlement + features + teams across the
club's venues) already shipped mig 401; this epic anchors ACTIVITY to the right venue. Then read
rls_migrations/298_club_attendance_slice1.sql (club_create_session/club_update_session),
rls_migrations/303_club_attendance_slice4d.sql (club_manager_create_session), the club_sessions schema
in SCHEMA.md, the member session reader (member_list_club_sessions), and the venue session UI in
apps/inorout (SessionsScreen) + apps/venue. Confirm next free mig off origin/main (Phase 1 = mig 412).

Run a full AUDIT → VERIFY (review) → EXECUTE → VERIFY → COMMIT cycle (skills/audit.md FIRST). PHASE 1 —
venue-anchor club sessions:
- club_sessions += venue_id (FK→venues, nullable) + optional playing_area_id (FK→playing_areas). BACKFILL
  existing rows to their club's current single club_venues venue (byte-identical for today's data).
- NEW shared guard _venue_in_club_operator(caller_venue_id, club_id, target_venue_id): target ∈
  club_venues(club) AND venues.company_id equal + non-null (same-operator seam). SECDEF/STABLE/internal.
- club_create_session / club_update_session / club_manager_create_session(_series) gain p_venue_id (+
  optional p_playing_area_id), validated via the guard (+ pitch∈venue). DROP old overloads, re-grant.
  Audited per Hard Rule #9.
- Session readers (member_list_club_sessions + venue/club session lists + detail) return venue_id +
  venue name/address. Wrappers + barrel. Venue UI session create/edit: a venue picker (the club's
  same-operator venues) + optional pitch. Member UI: session card shows venue + address.

GATES: rpc-security-sweep; EPHEMERAL-VERIFY (own _e2e_ fixture: a 2-venue SAME-company club — prove a
session at venue B is authorised, a venue NOT in the club / a different company is rejected, and the
backfill default; leak 0); build inorout+venue + hygiene 7/7 + hex; casual-regression (apps/inorout reads
sessions — additive-diff proof); Playwright smoke (create a session at the 2nd venue, member sees the
right venue+address, 0 console errors). Same-commit SCHEMA/RPCS/FEATURES/DECISIONS/BUGS. PR → merge before
Phase 2 (cross-venue fixtures). End by giving the Phase 2 next-session prompt in chat.
```
