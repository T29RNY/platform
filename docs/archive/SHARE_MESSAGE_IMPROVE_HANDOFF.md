# Share Message Improve — append join-link CTA to the My View WhatsApp share

**Invocation:** `/dev-loop SHARE_MESSAGE_IMPROVE_HANDOFF.md`
**Plan gate:** batched
**Merge mode:** per-phase

---

## WHAT IT IS

The green **IN** tile on My View (the Live Board) has a "Share on WhatsApp" button that
opens a team sheet built by `buildTeamSheetText()` in
`apps/inorout/src/views/PlayerView.jsx` (~L135-189).

**Scope (decided by the operator):** leave the team sheet **exactly as it is** and append a
single two-line call-to-action at the very bottom:

```
👉 In or out? Tap to update:
app.in-or-out.com/join/<joinCode>
```

That's the whole change. No copy rewrite, no OUT-list removal, no native-share-sheet swap,
no state-aware branching — those were explored and **deferred** (see below). The link turns
the app's single most-shared surface (an organiser drops this into a football WhatsApp group
every week) from a dead end into a way back into the app: a returning squad member who taps
it re-lands on their board and marks IN; a newcomer onboards and joins.

---

## LOCKED DECISIONS

1. **The message body is unchanged.** Only the two CTA lines are appended, after the
   existing `👕 Bibs:` line, separated by a blank line. *(operator decision)*
2. **The link is the team `/join/<joinCode>` link, NOT a personal `/p/<token>` link.** A
   `/p/token` link *is* one player's identity — group-broadcasting it makes every recipient
   act as the sharer. `/join/<code>` is the team-level share-to-many URL already used in
   onboarding (`SquadReady.jsx`) and admin invite. *(hard identity constraint)*
3. **The CTA appears only when spots are open** (`shortBy > 0`). When the squad is full
   (`shortBy <= 0`, the existing "Full Squad" state) the message ends at the Bibs line as it
   does today — no link. `shortBy = cap - inCount` is already computed in the builder
   (`PlayerView.jsx:167`), so this is a one-line conditional, no new data. Cancelled matches
   already short-circuit before the sections (`❌ MATCH CANCELLED`) so they never reach the
   CTA — correct. *(operator decision)*
4. **`join_code` is non-sensitive public invite data** and is safe to expose on the
   player-token team-state RPC — it's how anyone joins the squad anyway.

---

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **Builder + call site:** `buildTeamSheetText` at `PlayerView.jsx:135-189`; called at
  `L379-386` with `{ teamName: settings?.groupName, schedule, squad, lastMatchMeta }`.
  Wrapped in `https://wa.me/?text=` and rendered via the `shareUrl` prop into
  `components/ui/Tile.jsx`. The append happens in the builder's final `return`.
- **`join_code` is NOT reachable by a player today** — this is the one real piece of work.
  `settings` in PlayerView is only `{ groupName, groupLabels }`.
  `get_team_state_by_player_token` (supabase.js ~L508-583) does not return `join_code`.
  Admin-only paths have it (`getTeamByAdminToken`). Surfacing it to My View needs
  `join_code` added to the RPC return **and** the `getTeamStateByPlayerToken` mapper
  (supabase.js ~L511-521) in the **same commit** (Hard Rule #12). Nest it under `settings`
  so the builder keeps its existing `settings?.` access pattern; grep-confirm `join_code`
  appears in BOTH the RPC body and the mapper.
- **Next free migration = 483** (481/482 are latest on disk; re-confirm against live before
  taking the number — "first-come on main" caveat).
- **`/join/<code>` URL shape** is `https://app.in-or-out.com/join/<joinCode>` — verbatim
  pattern from `SquadReady.jsx` (`BASE_URL` + `/join/` + code).
- **Ship-safety:** the shell is a remote-`server.url` wrap (`capacitor.config.ts` →
  `app.in-or-out.com`); JS deploys via Vercel with no `cap sync` / Xcode rebuild /
  App-Store resubmission. This change touches a SECURITY DEFINER RPC return shape + a mapper
  + one builder string — no frozen Hard-Rule-13 surface (routing/auth/realtime/
  supabase-client/capacitor.config). **Dark-ship safe.**
- **Hygiene:** the builder is pure string-building with emoji literals (no hex, no
  `supabase.from/rpc`, no `console.log`) — keep it that way. Do NOT add a client fetch in
  PlayerView; the join code must arrive via the existing player-token load path.

---

## ROADMAP

### PR #1 — Append join-link CTA — **tier-3 · PROTECTED · 🚦 migration + real-device walk**
- **Migration 483** — add `join_code` to `get_team_state_by_player_token`'s return shape.
  Write the `.sql` (+ `_down.sql`) in the same commit as the live apply (Hard Rule #11).
- Add `join_code` to the `getTeamStateByPlayerToken` mapper (supabase.js ~L511-521), nested
  under `settings`, in the **same commit** (Hard Rule #12).
- In `buildTeamSheetText`, append after the Bibs section — **only when `shortBy > 0` AND a
  join code is present**:
  ```
  👉 In or out? Tap to update:
  https://app.in-or-out.com/join/<joinCode>
  ```
  When the squad is full (`shortBy <= 0`) the message is unchanged from today. Pass
  `joinCode` (from `settings`) into the builder at the `L379-386` call site.
Gates: 🚦 migration 483 sign-off **before apply**; RPC-security sweep (return-shape change);
mapper grep (`join_code` in RPC body AND mapper); 🚦 real-device walk — share from a real
phone, confirm the link renders and, tapped from a second phone, resolves into the app
(member marks in / newcomer onboards).
Done-check: player-token team-state exposes `join_code`; when spots are open the shared
WhatsApp message ends with a working `/join/<code>` URL; when the squad is full the message
is byte-for-byte unchanged from today (no link); the rest of the message is byte-for-byte
unchanged in both cases; mapper grep passes; migration 483 source committed with its
down-migration.

---

## 🚦 GATES the loop must stop at

- **PR #1** — migration 483 human sign-off **before apply**; RPC-security sweep; real-device
  link-resolution walk; confirm `join_code` is RLS-safe to return to a player-token caller
  (the sharer is often a plain player, not an admin — if the RPC won't return it to a
  non-admin token, the CTA silently no-ops for the exact person most likely to share).

---

## DONE =

The My View WhatsApp share message is unchanged except for a two-line join-link CTA at the
bottom **when spots are open**; the link carries the team's join code, resolves into the app
when tapped, and re-engages members / recruits newcomers. When the squad is full the message
is exactly as it is today. Verified on a real iPhone in a real WhatsApp thread (both the
spots-open and full-squad cases), dark-shipped via Vercel with no App-Store resubmission.

---

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

- **MISSED:** the sharer is *often a plain player, not an admin* — confirm
  `get_team_state_by_player_token` can return `join_code` to a non-admin token under RLS, or
  the CTA silently no-ops for the exact person most likely to share. This is the one thing
  that can quietly break the whole feature; it's the first thing to check at audit.
- **OPPORTUNITY:** this closes the growth leak on In-or-Out's highest-frequency organic
  surface with the smallest possible change. If it lands well, the natural follow-on is a
  `?src=whatsapp_sheet` attribution param (reusing the existing `redeem_invite_link` /
  `?invite` rail) so the loop's join/install conversion becomes measurable — deferred for
  now to keep this change to one line, but the moment to add it is the next iteration.
- **FUTURE-PROOF:** deferred rather than built — the fuller rewrite (action-first hook on
  its own line, a free "not yet responded" chase list from `groups.none`, dropping the OUT
  list, state-aware nag-vs-receipt tone, and swapping `wa.me` for the native share sheet
  that `HistoryView`/`TournamentScreen` already use) is all still on the table and needs no
  new backend beyond this PR. Kept here as the roadmap for a v2 if the link proves its worth.
- **WOW:** for the recipient, the cheapest wow is the `/join` link resolving to *their own
  board, already in this squad, one tap from IN* — no cold app-store landing. The true
  one-tap-IN dream (each straggler deep-linked to *their* personal check-in) can't live in a
  group broadcast (identity constraint) — it belongs in the per-player push nudge via the
  existing `checkin_via_invite` / `/q/<code>` rail; flagged as the natural follow-on, not
  part of this scope.

---

## Related

- `apps/inorout/src/views/PlayerView.jsx` — builder + call site.
- `apps/inorout/src/onboarding/steps/SquadReady.jsx` — the blessed `/join/<code>` URL shape
  to mirror.
- `packages/core/storage/supabase.js` — `getTeamStateByPlayerToken` mapper + the
  `get_team_state_by_player_token` RPC wrapper (PR #1).
- Hard Rules #11 (migration source in-commit), #12 (return-shape → mapper same-commit),
  #13 (real-device native walk).
