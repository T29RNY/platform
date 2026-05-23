# Player Profile + Self-Service Account Actions — Scope

*Locked: May 23 2026 (session 34). Replaces session 34's "trim
PlayerProfile" audit outcome with a player-facing redesign.*

## TL;DR

Convert PlayerProfile from admin-only to **player-facing** with
admin mode as a graft-on. Player taps own avatar (new, top-left of
MY VIEW PageHeader) → sees their profile with three expandable
sections (Stats / Payment history / Injuries) and two destructive
actions (Leave squad / Delete account). Admin reaches the same
screen from SquadScreen avatar tap in admin mode.

Three sessions of work (A/B/C). All decisions locked below.

---

## Sessions

### Session A — Surface foundations (no destructive actions)
1. New PageHeader layout — avatar top-left overlay, IN OR OUT
   centre-aligned. Header height unchanged.
2. Remove Payment History accordion from MY VIEW (~80 lines).
3. New `PlayerProfile.jsx` in player mode. Stats section live
   (data already in props). Payment History + Injuries sections
   render collapsed; expand fires their respective RPCs.
4. New RPCs: `get_my_payment_history`, `get_my_injuries`.
   Wrappers in `supabase.js`, barrel exports.

### Session B — Destructive actions
5. New RPC: `leave_squad`. Player-token authed. Refuses if
   `owes > 0` ("Settle £X first"). No attendance check.
6. New RPC + edge function: `delete_my_account`.
   - RPC: anonymises player_match rows (name/identifiers
     replaced with "Deleted player"), removes player rows from
     every team, removes push subscriptions.
   - Edge function: deletes Supabase auth.users via admin API.
   - **Last-admin guard:** RPC refuses with "Hand over admin
     first" if the player is the only admin of any team they're in.
7. Profile destructive zone: Leave-squad button (amber, two-tap
   confirm) + Delete-account button (red, modal with typed
   "DELETE" check).

### Session C — Admin merge + cleanup
8. Add `isAdminView` prop to PlayerProfile.
   - Player mode: as built in A/B.
   - Admin mode: same screen + small "Admin" badge in header
     + ROLES → Vice Captain toggle + admin quick-actions
     (Reset link, Mark as injured) above the destructive zone.
     Delete-account hidden. Leave-squad becomes "Remove from
     squad" (admin's existing flow).
9. SquadScreen `onPlayerTap` continues to open PlayerProfile
   (now in admin mode).
10. Delete code that's been superseded.

---

## Locked decisions

| # | Decision |
|---|----------|
| 1 | Player-facing profile, admin mode is a graft, one file |
| 2 | Header: avatar overlay top-left, IN OR OUT centred, no resize |
| 3 | 3 expandable sections: Stats / Payment history / Injuries |
| 4 | Stats data already in state — expand opens instantly |
| 5 | Payment + Injuries lazy-load on first expand |
| 6 | Leave squad = soft remove, debt blocks |
| 7 | Delete account = hard nuke, last-admin guard |
| 8 | Historical data on delete = **anonymise** (preserve rows, replace identifiers with "Deleted player") |
| 9 | Edge function uses Supabase service-role key on Vercel |
| 10 | Avatar gets a subtle ring for contrast on varying hero bgs |
| 11 | Payment History accordion is REMOVED from MY VIEW (lives in Profile now) |
| 12 | Current-week payment state STAYS in MY VIEW response card |
| 13 | VC toggle stays inside PlayerProfile (admin mode only) |
| 14 | No new tables, no column changes — schema-sync skill not invoked |

---

## Out of scope

- Notification preferences inside PlayerProfile (separate feature).
- Editing email / phone / push prefs (separate feature).
- Player-facing "About this team" screen.
- Standalone admin handover flow (only triggered if last-admin
  edge case forces it).
- StatsView per-player drilldown changes.

---

## Risks / open questions remaining

None. All risks raised during scoping were resolved with
locked decisions above.

---

## Backend inventory (new)

| Item | Type | Auth | Where |
|------|------|------|-------|
| `get_my_payment_history` | RPC (SECURITY DEFINER) | `p_token` | new migration |
| `get_my_injuries` | RPC (SECURITY DEFINER) | `p_token` | new migration |
| `leave_squad` | RPC (SECURITY DEFINER) | `p_token` | new migration |
| `delete_my_account` | RPC (SECURITY DEFINER) | `auth.uid()` | new migration |
| Delete-account edge function | Vercel edge route | service-role key | `/api/delete-account` |

All RPCs follow CLAUDE.md RPC checklist. All four wrapped in
`packages/core/storage/supabase.js`, barrel-exported from
`packages/core/index.js`.

---

## File-level scope (rough)

| File | Change |
|------|--------|
| `apps/inorout/src/components/ui/PageHeader.jsx` | Add avatar overlay + recenter logo. Add `me` + `onAvatarTap` props |
| `apps/inorout/src/views/PlayerView.jsx` | Wire avatar tap → open Profile. Remove payment-history accordion (L1250–1329) |
| `apps/inorout/src/views/PlayerProfile.jsx` | **NEW** (player-facing root) |
| `apps/inorout/src/views/AdminView/PlayerProfile.jsx` | Eventually deleted; merged into the new one in Session C |
| `apps/inorout/src/views/AdminView/SquadScreen.jsx` | `onPlayerTap` continues working — opens new PlayerProfile in admin mode |
| `apps/inorout/src/views/AdminView/index.jsx` | Routing update — selectedPlayer now opens new PlayerProfile |
| `packages/core/storage/supabase.js` | 4 new wrappers |
| `packages/core/index.js` | 4 new exports |
| `rls_migrations/` | 4 new SQL files |
| `apps/inorout/api/delete-account.js` (or similar) | NEW edge function |
