# ADMIN DEBT CHASE — build manifest

`/loop /dev-loop ADMIN_DEBT_CHASE_HANDOFF.md`

Plan gate: batched · Merge mode: **auto** (see grant below)

✅ **FULL AUTONOMY GRANTED 2026-07-16** — operator: *"proceed through to completion. full approvals
for merges, commits, applies, changes and edits."* This waives the human sign-off on: migration
applies (PR #1, #5), tier-3 intent (PR #5), ship-live merge (PR #6), and per-PR merge taps. Build →
prove → apply → merge, hands-off. Precedent: the guardian-hub epic ran the same way.
⛔ **What the grant CANNOT waive, because it is physical, not procedural:**
**Hard Rule 13 — the real-iPhone walks on PR #2 and PR #3/#3b.** No device, no walk. Those PRs ship
to `main` on the operator's word only after he walks them; the loop builds, proves and PRs them, then
**stops and batches both walks into one sitting**. A build hook cannot see "the tap does nothing" —
which is exactly the class of bug PR #3b exists to fix, so waiving it here would be self-defeating.
⚠️ Migration number: **586 is contested** by open PR #569 (`fix/member-claim-shell-on-signup`, parked
on an auth-config hole). Do NOT hardcode a number — `check-next-migration.sh` resolves it at build
time. This manifest's "next free = 586" went stale *within one session*, which is the whole argument
for letting the gate decide.
Scoped 2026-07-16. Supersedes nothing; **reconciles two existing half-built chase paths**
(mig 472 `casual.chase_payment`, dark; `notify.js` `debtReminder` cron, live-but-silent).

---

## WHAT IT IS

A casual team admin — a volunteer chasing five mates for a fiver each — opens
**Payments**, sees "OWES MONEY · 5", and taps one button that asks all five for the
money, so the *app* is the one doing the asking and he doesn't have to be the dickhead
in the group chat.

That is the entire job. The interesting part is what we found scoping it.

**The feature already exists twice, and neither one works.**

1. `rls_migrations/472_gaffer_write_rpcs_payment_reserves.sql:230-297` — `casual.chase_payment`
   is fully built: picks the debtors, rate-limits, audits, pushes. It is unreachable because
   it sits behind `ai_agent_access.act_enabled` (`NOT NULL DEFAULT false`, mig 470:87) and the
   Gaffer canary never ran (`GAFFER.md:3` — zero `ai_briefings` rows).
2. `apps/inorout/api/notify.js:524-536` — a `debtReminder` cron fires 24h after kickoff, every
   week, in production, right now.

**And the automated one is reaching people — while telling them the wrong number.** `notify.js:533`
sends `sched.price_per_player`, not the player's actual debt, so a player owing three weeks (£15) is
told *"You owe £5"* — wrong for precisely the multi-week debtors it most needs to reach. Live, weekly,
right now. (PR #6.)

⚠️ **An earlier draft of this manifest asserted the opposite** — that APNs was dormant and the cron had
been "sending nothing for months" — reasoning from `notify.js:28-34` and `native-push.js:15-18`, which
both say the transport is *"DORMANT until the operator supplies signing creds"*. **PR #0 ran the probe
and refuted it: `credsAccepted:true`, production, correct bundle.** Those comments are stale. Push
works. Kept here because it's the manifest's own cautionary tale: **two files agreeing is not
corroboration when one was copied from the other, and a comment is a claim, not a fact.**

So the honest framing of this epic is not "add a chase button". It is:

> **Make the debt chase real, honest, and admin-triggered — and stop lying to the admin
> about whether it worked.**

The design consequence stands, but for the durable reason rather than the dramatic one: **the share
sheet is the primary channel, not the fallback.** Reach was never about the transport — it's about how
many casual players have a push **subscription** at all. They're token users who mostly never enabled
notifications, and debtors skew hardest into that group. The share sheet is the only channel at 100%
reach, and it lands in the WhatsApp group where the squad actually lives. Working APNs raises the
ceiling for the subscribed minority; it doesn't reach the bloke who never opened the app. Push and
email are additive upgrades on top.

---

## LOCKED DECISIONS

Assumptions this manifest builds on. Correct any that are wrong **before** firing the loop.

1. **Share-sheet first.** v1 ships a `Chase all N · £X` button whose guaranteed-working output
   is a prefilled, copy/shareable message for the team chat. Push and email are PR3/PR4, each
   independently gated. Rationale: reach is inversely correlated with the target population —
   the bloke who hasn't paid is the bloke who hasn't signed in.
2. **Honest counts, always. No dishonest success toast.** The UI never says "sent to 9" when it
   reached 4. Inherited from the existing bug: `chaseNoResponders` (`AdminView/index.jsx:524-531`)
   does `fetch(...).catch(console.error)` and toasts `noRespPlayers.length` — the count it *aimed
   at*. If nobody has push it still says "✓ Chase sent to 9 players". `AnnounceModal.jsx:34-35`
   doesn't even read the response. **Neither precedent may be copied into money.**
   The reason this is locked rather than nice-to-have: when the admin is told "chased Barry" and
   Barry never got it, he doesn't conclude "the push failed" — he concludes **"Barry's blanking
   me."** A false toast doesn't lose a notification, it manufactures a grudge between mates.
   🔴 **The trap inside this decision — an earlier draft of this manifest fell into it.**
   `net.http_post` is fire-and-forget, so **the RPC returns before any send happens and can never
   know delivery.** A field called `sent_count` returned synchronously would be *the exact lie this
   decision exists to ban*, dressed as its remedy. And `notify.js:715` returns `{sent: subs.length}`
   unconditionally — subscriptions aimed at, not people delivered to (`getSubsForPlayers:319-327`
   is one row per **device**, so a phone + a laptop counts 2) — while `pushToSubs:284-291` only
   writes `notification_log` when `res.ok`. **Therefore: the RPC returns `attempted_count`, never
   `sent_count`.** Delivery truth arrives asynchronously in `notification_log` and PR #2 reads it
   back for the per-row "chased 2h ago" state. The honest word for the moment of the tap is
   *attempted*; anything stronger is the `chaseNoResponders` bug with better manners.
3. **Comms only — never a ledger write.** Inherited verbatim from mig 472:276-277 (Locked
   Decision #3). A chase must not touch `payment_ledger` or `players.owes`.
4. **Server-templated body, debtor-addressed only. No admin free text in the push/email.**
   A custom-message field turns this into `AnnounceModal` with a debt list attached, and a vice
   captain (who holds `team_admin`-grade authority — mig 074:39-47) could broadcast *"Dave still
   hasn't paid"* to the whole squad. The app would become the shaming instrument.
   ⚠️ The **share-sheet text is editable** — it's going into the admin's own WhatsApp under his
   own name, which is a different act with different accountability.
5. **Team-scoped debt comes from `payment_ledger`, never `players.owes`.** `owes` is deliberately
   **cross-team** (mig 460:33-38, RPCS.md:64 — "the recompute is intentionally NOT filtered by
   p_team_id"). Mig 472:236 filters on `COALESCE(pl.owes,0) > 0`, so **Team A's admin currently
   chases a two-squad player about money owed to Team B**, with copy naming Team A's fixture
   (472:287). That's a live correctness defect in the built-but-dark RPC.
6. **Pending claims are excluded from the chase audience — reusing mig 463's existing definition,
   not a new one.** A player who paid cash Tuesday and is waiting on the admin still has
   `owes > 0`: `setPlayerPaid` (`supabase.js:1529-1530`) and `claimLedgerPayment` (`:1556-1557`)
   both explicitly do NOT clear `owes`. Chasing him is the single most likely real-world complaint.
   ✅ **The definition already exists and is already team-scoped** — `463_admin_pending_claims_banner.sql:40-45`:
   `WHERE team_id = v_team_id AND type='game_fee' AND status='unpaid' AND claimed_at IS NOT NULL`
   … `AND (p.self_paid = true OR COALESCE(c.cnt,0) > 0)`. Mig 463 exists because the admin banner
   had *this exact bug in reverse* (`463:3-5` — it listed only whole-player `self_paid` and missed
   per-week `claimed_at` claimants). `_team_debtors` is the **inverse of 463's set** and must cite
   it rather than reinvent it — in an epic whose thesis is "one definition of who owes", writing a
   second pending-claim predicate would be the sharpest possible own goal.
7. **KNOWN under-18 debtors are excluded from the chase. Unknown-age debtors are chased, and we say
   so out loud.** Casual squads contain minors, and push-notifying a child for money is a
   safeguarding question, not a UX one — it's why the sibling epic's P11 payment reminders are
   **guardian-facing by design** (minors don't pay, their parents do).
   ✅ **The casual age signal is `players.date_of_birth date NULL`** (mig 056:52) — **not**
   `member_profiles.dob` (SCHEMA.md:1124), which lives on the club/membership spine with **no join
   to `players`**. An earlier draft of this manifest specced the member column and would have been
   unbuildable.
   🔴 **State the limit honestly: this is a partial control, not a safeguard.** `date_of_birth` is
   nullable, is not captured on any casual join path, and **isn't even mapped by `dbToPlayer`**
   (`grep date_of_birth packages/core/storage/supabase.js` → nothing), so it is NULL for
   approximately every real casual player — including approximately every real child. A NULL-means-
   adult rule therefore **fails open**, which is the exact failure class this manifest convicts
   elsewhere (`has_push` row-exists ≠ deliverable; the RLS-dead cooldown). We ship it anyway,
   because the alternative — NULL-means-minor — excludes the entire squad and the feature does
   nothing. **Precedent is settled and identical:** mig 584's coach age gate rejects only a *known*
   under-age dob and permits NULL (`coach_must_be_16`); MEMORY records that a stricter rule was
   tried and operator-corrected. We follow 584.
   ⚠️ **What must NOT happen is the doc implying this is solved.** `is_minor` means *"known to be
   a minor"*, nothing more.
   ✅ **OPERATOR DECISION 2026-07-16: "no — guardians."** Never chase a child; route to the guardian.
   **Translated to what is buildable here: exclude known minors from the casual chase.** The guardian
   half is NOT reachable from casual and must not be faked — `member_guardians` joins
   `guardian_profile_id` → `member_profiles` and `child_profile_id` → `member_profiles` (SCHEMA.md:1125),
   i.e. **both ends are member profiles**, and a casual `players` row is not one. `grep -rl guardian
   apps/inorout/src/views/AdminView/ PlayerView.jsx` returns **nothing** — the casual surface has never
   heard of a guardian. The only theoretical chain (`players.user_id` → auth.users →
   `member_profiles.auth_user_id` → `member_guardians`) needs the CHILD to be signed in with a linked
   member profile and an accepted guardian row — which is essentially never for a casual token player.
   **And the intent is already honoured where it's reachable:** children in this platform live on the
   **club** side (DF Sports, PA Sports), where fees are `venue_charges` membership charges and P11
   (mig 541) already sends **guardian-facing** payment reminders. A minor carrying a casual
   `payment_ledger` game-fee debt is a near-empty set. So: exclude known minors here; guardians are
   P11's job over there. **Filed as the real fix (LD#11): capture `date_of_birth` on the casual join
   path, and link casual players to the guardian graph.**
8. **Quiet hours are disclosed, never overridden.** Direct mode queues 22:00–08:00
   (`notify.js:699-712`). A debt push at bedtime is exactly the message that turns a fiver into a
   falling-out. The sheet says "⏰ Quiet hours — this'll send at 8am"; the admin who genuinely
   can't wait uses the share sheet, and *he* owns that.
9. **Rate limit is per-player / 24h, and partial — not team-wide / 2h / all-or-nothing.**
   Mig 472's `(team_id, type, game_date)` + 120min key is a game-day cadence borrowed from an
   availability chase. Debt persists across weeks; `game_date` rolls forward and silently mutates
   the key. Per-recipient/24h bounds harassment at the unit that matters (what one human receives)
   and lets a legitimate next-week chase through with no special-casing.
   *Checked externally (web, 2026-07 — [duetrail](https://duetrail.com/blog/dunning-process-explained),
   [chaserhq](https://www.chaserhq.com/blog/what-is-dunning-in-accounts-receivables-and-how-to-optimize-it),
   [churnkey](https://churnkey.co/blog/dunning-process-best-practices/)):* standard dunning practice is a
   spaced, escalating sequence — roughly **weekly** while an invoice is freshly overdue, escalating
   over ~60 days (typ. day -3/+1/+7/+14/+30/+45/+60); nothing remotely resembles a 2-hour window,
   which confirms 472's key is a borrowed game-day artefact rather than a considered cadence. The published guidance is all B2B/subscription and explicitly
   doesn't cover peer-to-peer, so we're not copying its 7-touch ladder — and we don't need to:
   **the admin's tap IS the cadence.** He'll naturally chase about weekly (when he does the books),
   which lands on the industry rhythm for free. The 24h floor isn't a cadence, it's a harassment
   guardrail under one. That distinction is why an automated escalation ladder would be wrong here:
   a robot escalating on a mate over £5 is exactly the social damage LD#4 and LD#7 are guarding
   against. Ship the guardrail, let the human set the pace.
10. **One definition of "who owes on this team", shared by all three chase paths.** See
   FUTURE-PROOF below. This is the load-bearing structural decision of the epic.
11. **Out of scope, filed separately** (see 🚦 GATES): capturing `date_of_birth` on the casual
    join path (LD#7's real fix), `/api/notify` direct-mode auth,
    `CRON_SECRET` plaintext rotation, `resolve_admin_caller` disabled-VC check. Each is a real
    live defect; each needs its own regression surface; none may be buried inside a feature PR.

---

## KEY AUDIT FACTS

Load-bearing and verified this session. **Do not re-derive.**

**Next free migration = 586.** (Highest in `rls_migrations/` = `585_rename_syncs_team_name.sql`.
First-come on `main` — CLAUDE.md cloud-session discipline.)

### The two existing chase paths
- **mig 472:230-297** `casual.chase_payment` — dark behind `ai_agent_access.act_enabled`
  (mig 470:87, default false). Full shape to copy: audience → cooldown → `gaffer_actions` update
  → `audit_events` → **synchronous `notification_log` insert** → `net.http_post`.
- **`notify.js:524-536`** `debtReminder` cron — live, 24h post-kickoff, `*/15` schedule
  (`361_domain_migration_cron_fns.sql:55`), audience `!p.paid && !p.self_paid`.
  🐛 **Sends the wrong number**: body uses `sched.price_per_player`, so a player owing three weeks
  (£15) is told *"You owe £5"* — wrong for exactly the multi-week debtors it most needs to reach.

### Deliverability (the gating unknown)
- APNs/FCM dormant pending operator creds — `notify.js:28-34` says so in its own header;
  `native-push.js:15-18` repeats it. `apnsConfigured()` = `notify.js:46-49`.
- **`apnsDiag` settles it in one HTTP call, sending nothing:** `apnsHandshakeProbe()`
  (`notify.js:112-151`), branch at `:431-433`. `POST /api/notify`, `Authorization: Bearer <CRON_SECRET>`,
  body `{"cronType":"apnsDiag"}`. `{configured:false}` = creds absent. `credsAccepted:true` =
  creds/signing/topic all good (Apple rejects the dummy token with 400/BadDeviceToken).
- 🔴 **Push has a SECOND, independent blocker: no tap listener.** `grep pushNotificationActionPerformed
  apps/inorout/src/` returns **nothing**. `deliverApns` puts `url` in the APNs payload
  (`notify.js:79`) and nothing reads it. So even with creds, a tapped debt push does not deep-link.
  (Known — logged as deferred D6 in the guardian-hub epic.) **Push needs creds AND a listener.**
- Legacy `platform='web'` rows self-clean (410 → `gone:true` → row deleted, `notify.js:229/292-293`)
  — not a correctness risk, but they inflate `superadmin_health`'s `has_push`, which counts **row
  existence, not deliverability** (`236_superadmin_health.sql:55-78`). The platform's own reach
  metric overstates reach.

### Contactability
- `players` has **no email column**. Only chain: `players.user_id` → `supabase.auth.admin.getUserById()`
  (service-role) — `cron.js:1551-1561` `authEmailsForUserIds`, `emailForUser()` `:1919-1923`.
  **Service-role only: reachable from `apps/inorout/api/*`, NEVER from an RPC or the client.**
- `user_id` is set only by `link_player_to_user` (requires `auth.uid()` — mig 067:35-38), i.e. only
  when an already-signed-in user opens their own token link. Anonymous `/p/TOKEN` players never get one.
- Guests (`add_guest_player`, mig 346:124-140) get **name + token only** — structurally unreachable,
  forever, by every channel.
- **No casual email template exists.** `_mailer.js` `TEMPLATES` (57-528) is entirely
  venue/club/league/membership. `sendTemplated` returns `{skipped:"no_template"}` for an unknown
  type — **a missing template no-ops silently**.
- `dispatchReminder` (`cron.js:1932-1962`) is the right reuse target — push→email→SMS via
  `pickChannel`, per-channel `notification_log` rows, and it already computes `counts.none` for
  unreachable players (`:1936/:1943`) — *that is the "5 have no app" number, already written*.
  It selects `phone, notification_channel, user_id, token` (`:1894`) and builds a casual
  `/p/${p.token}` link, so it is **mechanically casual-capable**; it's merely only *wired* to two
  league types (`:1994`, `:2038`).
  🐛 **But it has the bug that would sink the email half:** `:1939` `contacts.push = subbed.has(p.id)`
  gates on a **row existing**, not on the transport being **deliverable**. Every iOS user has a row
  and zero deliverability → `pickChannel` routes them to push → APNs skips → **the email fallback
  never fires**. Reusing it as-is *looks* routed and sends nothing. Gate on transport-configured.

### Security posture (see GATES)
- 🔴 **`/api/notify` direct mode is unauthenticated** — `notify.js:662-664` checks only
  `if (!teamId || !payload)`. Siblings `cronType` (`:624`), `memberProfileIds` (`:635`),
  `authUserIds` (`:652`) all require `Bearer CRON_SECRET`.
  **Bounded**: the URL is NOT attacker-controllable — `pushToSubs:279-282` spreads `payload` first
  then overwrites `url` with the server-derived per-player link, so no arbitrary-link phishing and
  no token leak. **Unbounded**: arbitrary `title`/`body` to the whole squad (omit `playerIds` →
  `getSubsForPlayers:319-326` skips the `.in()` filter → every sub on the team), and the trigger
  gate is bypassable (`:674` is `=== false`, so any unknown `type` passes).
  `teamId` is ~64-bit random (`015:76` → `001_helpers.sql:134-140`) but is **ordinary client state**,
  not a secret — so the threat is any current-or-removed player, not the internet.
  `AnnounceModal.jsx:27-34` already ships admin free text over this exact path.
  ⚠️ **Fair-reading note:** direct mode is unauthenticated **by design, not by accident** —
  `361:12-13` documents it as such, because `notify_spot_opened` (the live no-bearer DB caller is
  `361:148`, superseding the older `230:69`) needs it. It's a deliberate trade that has since aged
  badly, not an oversight. Frame it that way when filing, or the fix gets scoped as a bug when it's
  actually a design reversal with ~7 callers to migrate.
- 🔴 **The existing 2h cooldown is dead and fail-open.** `getRecentNotification`
  (`supabase.js:795-810`) client-reads `notification_log`, which is `REVOKE ALL FROM anon,
  authenticated` + RLS-on-with-no-policies (mig 008:63-69, mig 019:40). The wrapper swallows it
  (`if (error) return 0`). So `AdminView/index.jsx:517` **always passes** — the admin can spam
  "chase no responders" without limit. Reads as enforced in review; doesn't exist at runtime.
- **Every server-side `/api/notify` caller already sends the bearer** (`cron.js:118-125`, `:467`,
  `:545`, `:584`, `:694`, `:1904`) — so fixing direct mode breaks **zero** crons. What breaks:
  4 browser callers (`PlayerView.jsx:46-52`+`:728-740`, `AnnounceModal.jsx:27-34`,
  `Gaffer/index.jsx:222`) + DB `net.http_post` callers (`230:69`, `472:278`) which *can* pass one
  (`117_install_cron_main_job.sql:22` already hardcodes a bearer in committed SQL).
- ⚠️ **`CRON_SECRET` is committed in plaintext** — `117:22`, `361_domain_migration_cron_fns.sql:27,38,
  49,60,71,82,93` (+ `_down`), and in CONTEXT/DECISIONS/BUGS/DOMAIN_MIGRATION MDs. It is a
  repo-read gate, not a strong one, and it gates the money-adjacent cron surface. Don't let the
  direct-mode fix assume it's strong without rotating first.
- ⚠️ **Removed-VC privilege retention** — `resolve_admin_caller` (mig 074:39-47) matches
  `pl.token` + `tp.is_vice_captain` with **no `pl.disabled` check**, and nothing clears
  `is_vice_captain` on soft-remove. A soft-removed ex-VC keeps admin-grade authority indefinitely.
  Gates the whole `admin_*` surface via the mig-075 sweep → **file separately, do not touch here.**

### Data model
- **Canonical team-scoped debt** (NOT `players.owes`):
  `SELECT player_id, SUM(amount) FROM payment_ledger WHERE team_id = <t> AND type='game_fee'
   AND status='unpaid' GROUP BY player_id`
- `players.owes` = a **derived cache**, recomputed cross-team by `_recompute_player_owes`
  (mig 460:39-47). Source of truth is `payment_ledger` (mig 460 header, lines 3-7).
- ⚠️ **Treat SCHEMA.md's whole `payment_ledger` block (363-375) as untrusted — verify against live
  before PR #1.** Two independent faults found this session: (a) `amount` — line 367 says `int`,
  lines 12-16 say whole-pounds `numeric`, and no DDL exists in `rls_migrations/` (the table predates
  the series); (b) the block **omits `claimed_at`/`claimed_by` entirely** (added by mig 459:31) —
  the very columns LD#6's pending-claim filter depends on. A doc that's wrong about the type *and*
  missing the columns is not a source of truth for this epic.
  Unit trap: casual ledger = whole **pounds**; `venue_charges.amount_due_pence` = pence.
- ⚠️ **SCHEMA.md's `audit_events` block (430-439) is STALE and WRONG.** Real DDL = mig 003:7-26:
  `team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata,
  created_at`. Insert pattern to copy: mig 472:257-261.
- `guest_fee` debt is **never** in `owes` (guests use `set_guest_payment`); Stripe `debt_payment`
  rows likewise absent (RPCS.md:68).

### The admin write-RPC contract
Auth = `p_admin_token` → `resolve_admin_caller(p_token)` (mig 074:17-49) → `(team_id, actor_type,
actor_ident)`; `actor_type ∈ ('team_admin','vice_captain')`. NOT `auth.uid()`.
`SECURITY DEFINER` + `SET search_path TO 'public','pg_temp'` · derive `team_id` server-side, never
from the client · `RETURN jsonb` · `INSERT INTO audit_events` (HR#9) · `notify_team_change` needs a
matching client subscriber (HR#10) · wrapper in `supabase.js` (camelCase) + barrel export in
`packages/core/index.js` · raw RPC name in exactly ONE `supabase.rpc()`.
✅ **Grants: `GRANT EXECUTE TO anon, authenticated`** (mig 470:492 pattern). This RPC **must** stay
anon-callable — the `/admin` route is unauthenticated and `p_admin_token` *is* the auth.
❗ The mig-460:51-55 "REVOKE from the **named** roles, not just PUBLIC" rule applies to **internal
helpers** that must not be anon-reachable (`ALTER DEFAULT PRIVILEGES` auto-grants every new
function). Apply it to the shared `_team_debtors` helper; **misapplying it to the chase RPC breaks
every casual admin.**

### The pg_net ordering trap (EV-discovered, mig 472:263-274)
`net.http_post` is **fire-and-forget** — pg_net queues and returns immediately, so notify.js's own
`notification_log` insert on the far end is NOT guaranteed to land before a rapid second call's
cooldown check runs. **Any RPC-internal send must insert its own `notification_log` rows
synchronously, in the same transaction, BEFORE the `net.http_post`.** Mig 472 does this; copy it.

🔴 **POST to `https://app.in-or-out.com/api/notify` — NOT `www`.** This overturned a claim in an
earlier draft of this manifest and is worth stating loudly. Mig 361 exists *precisely* for this:
its header (`361:1-8`) reads *"the LAST apex/www references inside the live DB — timed/triggered
POSTs that do NOT follow a 301, so they must be repointed, not redirected: 7 pg_cron jobs,
www.in-or-out.com → **app.in-or-out.com**"*. Every live caller now posts to `app.` (`361:24,35,46,
57,68,79,149`; `:147` comments "canonical **app** URL"), and `361_..._down.sql` reverts to `www`,
proving `www` is the **pre-migration** host.
⚠️ **Mig 472:279 and :348 still hardcode `www.`** — written after 361, it regressed, carrying a
rationalising comment inherited from the pre-migration migs 230/049. **472 is dark, so its `www`
URL has never once been exercised in production.** Copying 472's send block verbatim — the natural
move, since it's the reference implementation for everything else here — would post migration 586
to a host that drops the body, in an epic whose entire thesis is "stop lying to the admin about
whether it worked". Fixing 472's host is now in PR #5's scope.

### The `has_push` problem — why the reachability signal needs a DB mirror
`_team_debtors` is a **Postgres function**. `APNS_KEY_P8`/`APNS_BUNDLE_ID` live only in the Vercel
Node runtime (`notify.js:46-49`) — `grep -rln "APNS_KEY_P8" rls_migrations/ packages/` returns
**nothing**. Postgres cannot read Vercel's env, so "is the push transport configured?" is
**unanswerable in SQL**. But the honest-reachability guarantee (Locked Decision #2) depends on
answering it, and the security gate forbids a client round-trip through `/api/notify` to ask Node.
**Resolution: a one-row `platform_config` mirror** (`push_transport_live boolean NOT NULL DEFAULT
false`, mig 586). No such table exists today — `club_features` (mig 399) is the nearest pattern but
is club-scoped and casual teams aren't clubs. `DEFAULT false` makes today's dormancy honest by
construction, and **PR #0's verdict becomes a machine-readable fact** rather than tribal knowledge.
Two things the spec must nail, because a config table is exactly where this codebase has been bitten:
- **RLS + grants — copy `club_features`' house pattern (`399_modular_feature_flags.sql`): RLS ON with
  NO client policies (`:54-55`), reads only via SECURITY-DEFINER helpers, and `REVOKE EXECUTE … FROM
  anon, authenticated` on those helpers by *named role* (`:121-123`), not just `FROM public`
  (`:115-117`).** Per this repo's own
  `ALTER DEFAULT PRIVILEGES` trap (mig 460:51-55), a new public table **auto-grants anon +
  authenticated** and a bare `REVOKE FROM PUBLIC` will not undo it. Skip this and mig 586 ships a
  world-readable platform flag.
- **Drift is the real risk, and it fails dangerously in one direction.** This is a hand-maintained
  mirror of a Vercel env var with no reconciliation. Creds pasted but flag not flipped → we
  *over-report* unreachable: annoying, honest, safe. **Creds revoked or expired with the flag still
  true → the sheet says "4 will get a push" and nothing sends — which is precisely the LD#2 lie,
  reintroduced by the mechanism built to prevent it.** Close it: have `notify.js` **write the flag
  back** from `apnsConfigured()` on each `apnsDiag` run and on each send, so the mirror self-heals
  from the only process that actually knows. Node holds the service-role key, so it can write a
  SECDEF-walled table; the flag then has one writer and one truth.
(Alternative if the operator prefers no new table: return raw signals and compute the copy in Node —
but that forces PR #2's dry-run through the unauthenticated endpoint. Rejected on those grounds.)

### UI anchors
- `AdminView/PaymentsScreen.jsx` (696 lines): `owesSection` = `:486-488`, `totalOwed` = `:504`,
  `paidCount` = `:505`, summary chips `:528-545`, **§1 OWES MONEY card `:548-560`**, `PlayerRow`
  `:79-422`, `⋯` menu items `:256-283` (Waive debt = `:274-278`, the `danger` precedent),
  `MenuItem` `:426-443`, `SectionLabel` `:447-457`, `PlayerCard` `:461-473`.
- ⚠️ **`totalOwed` (`:504`) ≠ sum of `owesSection` (`:486`)** — `totalOwed` includes guests /
  cover pool, `owesSection` excludes them. The button must use `owesSection` only, or its number
  won't match the list it acts on.
- Action-tile pattern (`AdminView/index.jsx:1071-1128`): `{key, iconEl, iconBg, iconBorder, title,
  sub, badge, action}`; `iconEl` is pre-rendered (`<Megaphone size={18} weight="thin"/>` `:1075`);
  `badge:0` renders nothing; conditional tiles spread (`:1095-1101`).
- `RemindersScreen.jsx`: 9 boolean trigger toggles (`TRIGGER_LABELS` `:16-26`) + quiet hours
  (`:76-109`) → `schedule.remindersConfig` via `upsertSchedule` (`:41-55`).
  🔴 **TRAP — do not reuse `type:"debtReminder"` for the manual send.** `notify.js:674` is
  `if (triggers[type] === false) return 200 {skipped:true}`. Any admin who toggled off *"💸 24hrs
  after game — unpaid players"* (`:23`) would **silently disable his own manual button** — HTTP 200,
  success toast, nothing sent. Existing manual chases dodge this only by accident (`chaseNoResp` /
  `announce` are absent from `triggers`, and `undefined === false` is false). **Use a NEW type
  (`adminChasePayment`) and do NOT add it to `TRIGGER_LABELS`.** Automation toggles govern robots;
  they must not govern a button a human just pressed.
- The player landing is **already good**: the push/share URL is `/p/{token}` (`notify.js:281`) →
  `PlayerView.jsx:1094` `I've paid (cash) · £{thisWeekFee}` + `:1221` `You owe £{backlog} more from
  earlier — see Payment History →` (`setShowProfile(true)`, `:1215`). The pay action exists; it just
  isn't *opened* by the link (see MISSED).
- Share-sheet precedent to copy: `HistoryView.jsx:173-183` — `buildShareText()` → `navigator.share({text})`
  → `navigator.clipboard.writeText` + "Copied" toast. Also `TeamManagerPeople.jsx:139`,
  `TournamentScreen.jsx:705/:729`. ⚠️ `@capacitor/share` is **not** installed — this rides
  `navigator.share` in WKWebView, which `HistoryView` already ships natively; clipboard covers the gap.

---

## ROADMAP

### 🚨 FIRST THING IN THE MORNING — ONE ACTION OWED

**RE-APPLY migration 594** once prod carries the email code. It is currently **HELD** (594's own
`_down.sql` re-applied on top) — deliberately.

Why: 594 makes the RPC hand over email-reachable debtors to `notify.js`'s new email leg. All six
of the operator's debtors are `has_email=true, has_push=false`. With 594 live but the deploy
stuck at #579 (no email leg in prod), tapping Chase would have: posted for all 6 → notify.js
finds no push subs → sends nothing → but the RPC has already written 6 `notification_log` rows,
suppressing them 24h → sheet reports **"Chased 6 · 0 couldn't be reached"**. Six chased, none
reached, app says it worked — the exact lie this epic exists to remove, caused by letting the DB
run ahead of the deploy. Held until the code lands.
**Check first:** `curl -s https://app.in-or-out.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'`
— if it is still `index-277h8C6F.js`, the deploy has NOT landed and 594 must stay held.
**Do not** grep for a string that predates the change (that mistake is logged below); the bundle
**hash** changing is the signal.

### 🔴 STATUS 2026-07-17 — ALL 7 PRs MERGED. DB fully applied; DEPLOY STUCK at #579.

| PR | | State |
|----|--|-------|
| #577 | mig 591 RPC + `_team_debtors` | ✅ merged · applied · **deployed** |
| #578 | button + sheet | ✅ merged · **deployed** |
| #579 | push + tap listener + per-row Mark paid + email-lie fix | ✅ merged · **deployed** |
| #580 | NOT PLAYING tappable | ✅ merged · ⏳ **not deployed** |
| #581 | mig 592 — waivers | ✅ merged · applied · ⏳ not deployed (SQL, so live) |
| #582 | mig 593 — Gaffer delegates | ✅ merged · applied · ⏳ not deployed (SQL, so live) |
| #583 | cron real amount | ✅ merged · ⏳ **not deployed** |
| #584 | mig 594 + email leg | ✅ merged · **594 HELD** · ⏳ not deployed |

**Deploy stuck ~1h behind GitHub's API outage (500s / "Unicorn" pages).** Migrations are applied
directly and are live; app + serverless code is not. That asymmetry is what forced the 594 hold.

**⛔ NOT PROVEN — flagged, not presented as done:**
- **An email actually arriving.** Needs a debtor linked to a real inbox (the demo's only debtor
  has no account) AND the deploy. Honest first test: link a demo player to
  `tarny+demo@lettrack.co.uk`, give them an unpaid game, chase.
- **The cron's send.** Only fires ±7min at 24h after a kickoff; can't be simulated. First real
  exercise is after the next Wednesday game.
- **The iPhone walk** on #580's NOT PLAYING rows + the share sheet (`navigator.share` in a
  WKWebView; `@capacitor/share` is not installed).

| PR | State |
|----|-------|
| #0 apnsDiag probe | ✅ PASSED — `credsAccepted:true`. **Push works**; the "DORMANT" comments were stale. |
| #1 mig **591** + RPC (#577) | ✅ LIVE. EV 9/9, leak 0. |
| #2 button + sheet (#578) | ✅ LIVE. |
| #3/#3b push + tap listener + per-row Mark paid (#579) | ✅ LIVE. |
| #3c NOT PLAYING tappable (#580) | ✅ LIVE. |
| #4 email · #5 reconcile 472 · #6 cron amount | ⬜ not started (#6 deferred by operator) |

**🔴 THE BIG FIND — `players.owes` under-reports debt on live squads.** `owes` is a CACHE
recomputed ONLY by `admin_confirm_payment`/`_reset`/`_settle`. A player never touched by an
admin keeps `owes=0` forever while unpaid ledger rows pile up — and lands in **NOT PLAYING**
(filtered on `!(p.owes>0)`), where nobody looks. On the operator's real squad: **screen said
5 players / £70; the ledger said 14 / £235.** Eight invisible debtors, **£165 under-reported**
(Karan £30 across 6 games). Operator decision: **the ledger is truth** (mig 460's own header),
the chase RPC is right, the screen was wrong. #579's per-row Mark paid recomputes `owes`, so
the screen now heals as the admin works — but **only from #580 onward**, because until then
NOT PLAYING rows weren't even tappable: the fix couldn't reach the only players who needed it.
⬜ **FILED, NOT RUN: a one-off `owes` backfill** — would surface all £165 at once instead of
one tap at a time. Rewrites `owes` for every player on every squad → operator's call.

**⚠️ THREE THINGS THE GATES COULDN'T SEE — all found by the operator's walk:**
1. **The sheet lied.** #578 rendered `reachable_email` and told a live admin *"14 will get an
   email"* when the RPC has **no email leg** (send loop = `CONTINUE WHEN NOT r.has_push`).
   Build green, EV 9/9, reviewers clean — every check verified the RPC **against itself**;
   none could see a UI claiming a channel that doesn't exist. Fixed #579. Rule now in the
   component: it may claim ONLY what the RPC can do TODAY.
2. **NOT PLAYING was inert** — the one section not using `PlayerRow`. Missed because Mark paid
   was tested on Chris, who is in OWES MONEY: the one section where the bug can't occur. The
   demo squad has no stale-cache debtor, so no local test could have surfaced it. Fixed #580.
3. **The deploy check was vacuous** — waited for `"Mark paid"`, a string that **already
   existed** (the ⋯ menu), so it matched the OLD bundle and passed instantly. Same failure
   class as (1): verifying a thing that can't distinguish the two outcomes. Use a string
   unique to the change, or the bundle hash.

Dependency order. Each PR independently shippable. Tier + ship-safety + size per dev-loop.

| PR | What | Size | Gate |
|----|------|------|------|
| #0 | Apple credentials probe | XS | ✅ **DONE — PASSED, push works** |
| #1 | `_team_debtors` + `admin_chase_payment` + `platform_config` (migration) | **L** | 🚦 migration apply |
| #2 | Chase button + confirm sheet + share sheet + `?pay=1` | **L** | 🚦 iPhone walk |
| #3 | Wire the push send | S | ✅ unblocked · 🚦 iPhone walk |
| #3b | Push-tap listener + deep-link (inside #3) | M | ✅ unblocked · 🚦 iPhone walk |
| #4 | Email template + dispatch + the routing-gate fix | M | — |
| #5 | Reconcile mig 472 (+ its dead `www` host) | S | 🚦 tier-3 intent · migration |
| #6 | Point the live cron at the shared definition | S | 🚦 ship-live |

**Two L, two M, three S/XS.** #1 and #2 are ~⅔ of the epic and are the only two that must ship for
the feature to exist. Everything after #2 is an upgrade to an already-working nudge.

### PR #0 — ✅ **DONE 2026-07-16 — PASSED. Push works.** Tier-3 (operator-only) · **XS**
**RAN:** `POST https://app.in-or-out.com/api/notify`, `{"cronType":"apnsDiag"}`, Bearer CRON_SECRET.
**VERDICT:**
```json
{"configured":true,"production":true,"bundleId":"uk.inorout.app",
 "status":400,"reason":"BadDeviceToken","credsAccepted":true,
 "verdict":"APNs creds/signing/topic all accepted by Apple (dummy token rejected as expected)."}
```
🔴 **This REFUTES this manifest's original headline.** Earlier drafts asserted, on the strength of
`notify.js:28-34` ("DORMANT until the operator supplies signing creds") and `native-push.js:15-18`
saying the same, that APNs was dark and therefore *"the automated debt reminder has almost certainly
been sending nothing for months"*. **Wrong.** The creds are configured, signing is accepted, the topic
is right, and it's pointed at **production**. Those code comments are **stale** — they describe the
state when the transport was written, not today, and two independent files agreeing with each other
is not evidence when one was copied from the other. The lesson for anyone reading this manifest:
**a comment is a claim, not a fact.** One HTTP call settled what two files asserted.

**Consequences, all of which move work rather than remove it:**
- ✅ **PR #3 is UNBLOCKED.**
- ✅ The push estate is **not** dark. Guardian reminders, coach pings, POTM voting and P11's
  tap-to-pay reminders have been landing. The scary version of the OPPORTUNITY finding is dead.
- 🔺 **PR #6 gets MORE urgent, not less.** The live weekly cron *is* reaching real players — and it
  tells a three-week debtor he owes £5 (`notify.js:533` sends `price_per_player`, not their debt).
  That's not a latent bug any more; it's a live one, misinforming real people every week.
- ⚠️ **PR #3b still stands.** Independently verified: `grep pushNotificationActionPerformed
  apps/inorout/src/` returns **nothing**. Push *arrives*; tapping it still goes nowhere.
- ⚠️ **LD#1 (share-sheet first) is UNCHANGED** — and it's worth being clear this isn't stubbornness.
  Reach was never about the transport; it's about how many casual players have a **subscription
  row** at all. They're token users who mostly never enabled notifications, and debtors skew hardest
  into that group. Working APNs raises the ceiling for the subscribed minority; it does not reach
  the bloke who never opened the app. Still open: `SELECT platform, count(*) FROM push_subscriptions
  GROUP BY platform` — a live-DB read this scope is not permitted to run.
- ⚠️ **`platform_config.push_transport_live` (PR #1) survives, seeded `true`.** SQL still cannot read
  Vercel's env, and creds can still be revoked or expire — the mirror + the notify.js write-back is
  what stops that becoming the LD#2 lie. It's now a mirror of a *true* value rather than a false one.
Run `POST https://app.in-or-out.com/api/notify` with `Authorization: Bearer <CRON_SECRET>` and body
`{"cronType":"apnsDiag"}`. Pair with `SELECT platform, count(*) FROM push_subscriptions GROUP BY platform`.
- `{configured:false}` → APNs creds absent → **PR3 is BLOCKED** on the operator supplying `APNS_*`;
  PR1/PR2/PR4/PR5/PR6 all proceed unaffected.
- `{credsAccepted:true}` → creds good → PR3 buildable (still needs the tap listener, PR3b).
- Anything else → `verdict` string names the fault (`InvalidProviderToken` = .p8/key-id/team-id;
  `TopicDisallowed` = bundle id).
**Done-check:** the verdict is written into this manifest + BUGS.md, and PR3's blocked/unblocked
state is decided. **This gate also answers a much bigger question than this epic** — see OPPORTUNITY.

### PR #1 — ✅ **BUILT + PROVEN + APPLIED (mig 591)** · Tier-2 · 🔴 PROTECTED · **L**
**Status 2026-07-16:** migration **591** applied live (NOT 586 — see below). All gates green:
rpc-security PASS (both fns secdef + search_path-pinned + 1 overload; `_team_debtors` grants =
`{postgres,service_role}` only — the named-role REVOKE defeated the default-privileges trap;
`admin_chase_payment` = anon+authenticated, intentional) · **ephemeral-verify PASS, 9/9 assertions,
leak-check 0/11** · build PASS · lint PASS · hygiene 8/8 PASS · audit-events + rpc-consumers clean.
Branch `feat/admin-debt-chase` (isolated worktree). Awaiting: e2e A/B verdict + PR.

🔴 **The consumer e2e lane is STILL silently skipped on `main` — BUGS.md:15's fix was reverted.**
BUGS.md:15 (filed 2026-07-16) says the squad-less-owner PR pinned `vite --host 127.0.0.1` so
`qa-suite.sh:46`'s `/dev/tcp/127.0.0.1/$port` probe could see the server. **It didn't stick** —
commit `dd71d302` ("leave the dev script alone") reverted it, so `apps/inorout`'s dev script is bare
`vite` again → binds `[::1]` only → probe fails → **every consumer project reports SKIP, and
`qa-suite.sh` prints "RESULT: no real failures"**. Verified directly this session:
`curl 127.0.0.1:5173` → 000, `curl localhost:5173` → 200. A vacuous green, not a real one. The lane
has not actually run since.
**Corrected baseline (measured this session, `--host 127.0.0.1` forced, A/B against the same
worktree with the diff stashed):** `tokens` = **4** failures, not the 1 BUGS.md records —
`tokens.memberpass-frozen:13` **plus all 3 of `tokens.public.spec.js`** (`/p/` squad view, `/m/`
pass, the `/classes` auth-gate negative). All 4 reproduce **byte-identically with the diff stashed**
→ pre-existing, environment/seed, NOT caused by this PR. BUGS.md:15's "7 pre-existing" figure is
understated; update it with the real numbers once the alex/sam arms are A/B'd too.
⚠️ **Migration number went stale TWICE in one session** — the manifest said 586; PR #569 took it;
then DF Sports merged 587-590 while this was being scoped. The number resolved to **591** only by
running `check-next-migration.sh` in a worktree off a freshly-fetched `origin/main`. The local `main`
ref was 6 commits behind and made both `check-next-migration.sh` AND `check-diff-triggers.sh` report
nonsense (587, and the whole DF epic as "my diff"). Fixed with `git fetch origin main:main`. **Never
trust a migration number written in a doc.**
✅ **EV proved the two defects mig 472 still carries:** a two-squad player's debt is team-scoped
(host owed 20, not 40 — 472's `players.owes` filter would leak the other team's money), and the
guest's fee rolled up to the host per the operator's decision.
⚠️ **Live-schema findings — SCHEMA.md is wrong in THREE places here.** `payment_ledger.amount` is
**numeric**, not `int` (SCHEMA.md:367); `players.owes` is **numeric**, not `int`; and the
`payment_ledger` block **omits `claimed_at`/`claimed_by`** entirely (mig 459:31) — the very columns
the pending-claim filter needs. Verified via live `list_tables`. Do not do arithmetic off that doc.
Gates: `ephemeral-verify.md` (MANDATORY — new write RPC) · `rpc-security-sweep.md` ·
`check-rpc-security.sh admin_chase_payment` · `check-rpc-columns.sh` · `check-audit-events.sh` ·
`check-rpc-consumers.sh` · `check-next-migration.sh` · `check-ev-leak.sh` · `check-build.sh` ·
🚦 human sign-off on the mig-586 apply.

The structural core. No UI, nothing user-visible.
- **mig 586 is additive:** `586_admin_chase_payment.sql` + **`586_admin_chase_payment_down.sql` in
  the same commit (Hard Rule 11)**. Contents: the `platform_config` singleton (`push_transport_live
  boolean NOT NULL DEFAULT false`, RLS-on/no-client-policies/named-role REVOKE per
  `399_modular_feature_flags.sql:54-55` + `:121-123` — see AUDIT) + `_team_debtors()` +
  `admin_chase_payment()`. Down drops both functions and the table.
- **`_team_debtors(p_team_id text)`** → `TABLE(player_id text, owed numeric, has_push bool,
  has_email bool, has_phone bool, claimed bool, is_minor bool, last_chased_at timestamptz)`.
  THE single definition of "who owes on this team": from `payment_ledger` (team-scoped,
  `type='game_fee'`, `status='unpaid'`), excluding `disabled`, excluding pending claims **per mig
  463:40-45's existing predicate** (LD#6 — cite it, don't rewrite it). Reachability follows mig
  236:55-78's own definitions — `has_email` = `user_id IS NOT NULL`, `has_phone` = `phone IS NOT
  NULL` (mig 236:64) — with `has_push` = **push-sub row exists AND
  `platform_config.push_transport_live`** (see AUDIT: SQL cannot read Vercel's env, hence the mirror).
  `is_minor` = **`date_of_birth IS NOT NULL AND age(date_of_birth) < 18`** — `players.date_of_birth`
  (mig 056:52), **NOT** `member_profiles.dob` (no join exists from `players`). NULL = unknown =
  chased, per LD#7 and the mig-584 precedent.
  `last_chased_at` — the cooldown already reads `notification_log` server-side, so returning it is
  free, and it is **the only lawful way PR #2 can render "chased 2h ago"** (the client cannot read
  that table — that's what killed `getRecentNotification`).
  ⚠️ **`has_phone` is not padding:** `pickChannel` (`_sms.js:98-111`) routes `sms`/`whatsapp` for
  players who set that preference, so omitting it would let PR #2's sheet say "can't be reached"
  about someone PR #4 then texts — a fresh instance of the dishonesty LD#2 exists to ban.
  Internal helper → **REVOKE from the named roles** (mig 460:51-55).
- **`admin_chase_payment(p_admin_token text, p_dry_run boolean default false)`** → jsonb
  `{targets[], total_owed, reachable_push, reachable_email, reachable_phone, unreachable[],
  attempted_count, suppressed_count}` — **`attempted_count`, never `sent_count`** (LD#2: the RPC
  returns before pg_net sends and cannot know delivery).
  `resolve_admin_caller` → audience from `_team_debtors` → per-player 24h
  cooldown on `(team_id, player_id, type='adminChasePayment')`, **filtering** rather than
  failing-all (raise `chase_rate_limited` only when *every* target is suppressed) → `audit_events`
  (action `admin_chase_payment_sent`; record player_ids + counts, **never per-player amounts** —
  the `set_player_contact` precedent, mig 189:11/:50, records the fact not the value; a single
  aggregate `total_outstanding` is acceptable) → **synchronous `notification_log` insert** →
  `net.http_post` (skipped entirely when `p_dry_run`).
- `p_dry_run` is what powers PR2's confirm sheet: same audience, same reachability, no send.
- **Gates:** `ephemeral-verify.md` (new write RPC — mandatory, and it's what caught mig 472's pg_net
  race) · `rpc-security-sweep.md` · `check-rpc-security.sh` · `check-audit-events.sh` ·
  `check-rpc-consumers.sh` (HR#14 — record PR2/PR5/PR6 as consumers in RPCS.md **now**).
- **Done-check:** EV proves — a two-team player is chased only for THIS team's debt; a `self_paid`
  claimant is NOT in the audience; a second call inside 24h suppresses that player and still sends
  to the others; the `notification_log` rows exist before the http_post; leak-check `_e2e_%` = 0.

### PR #2 — PaymentsScreen chase UI + share sheet. Tier-2 · CLEAR · 🚦 native walk (HR13) · **L**
Gates: `casual-regression.md` (MANDATORY — touches `apps/inorout/src/`) · `check-hygiene.sh` ·
`check-lint.sh` · `check-build.sh` · Playwright smoke · 🚦 **real-iPhone walk (Hard Rule 13)** —
share sheet + `navigator.share` in WKWebView; the build hook cannot see "tap does nothing".

**This is the PR that ships the value.** Works at 100% reach with zero push infrastructure.
- Footer row **inside** the OWES MONEY `PlayerCard` — after the `owesSection.map()` closes and
  before its `</PlayerCard>`, in the `:548-560` block. (Re-read the exact lines before editing:
  the file is 695 lines and the anchors here are ±1. Don't trust a line number from a scope doc
  over the file in front of you.) It inherits the card's red accent + `borderTop` separators, and
  self-hides when nobody owes.
  **Not** an Actions tile: that list is *this-week's-match* actions, debt is cross-week, and a tile
  would orphan at `badge:0` every week and collide with the existing "Chase No-Responses".
- Label `Chase all 5 · £40` — 🔴 **derived from the dry-run RPC, NOT from `owesSection`.**
  Two client-side sets are both wrong: `totalOwed` (`:504`) includes guests/cover-pool the chase
  won't touch, and `owesSection` (`:486`) **includes pending claimants** — `PaymentsScreen.jsx:490-491`
  says so outright: *"A self-claim still has owes > 0 and lands in owesSection."* Since LD#6 excludes
  them from the audience, a label built from `owesSection` would say `Chase all 5` and chase 4. Same
  class of bug as the `totalOwed` trap, one layer deeper. **The dry-run is the only source that
  matches what the send will actually do.**
- Tap → confirm sheet (reuse `AnnounceModal`'s bottom-sheet geometry `:39-44`, **not** its
  fire-blind behaviour `:34-35`), driven by `admin_chase_payment(p_dry_run:true)`:
  > **Chasing 9 · £40**
  > 📱 4 will get a push · ✉️ 2 will get an email
  > ⚠️ **3 can't be reached** — Barry, Dave, Sam *(no app, no email)*
  > → **`Copy their names for WhatsApp`**
  Plus `⏰ Quiet hours — this'll send at 8am` when applicable. Reachability shown **before** the
  send, while the admin can still act on it.
- Share text: `Barry £15, Dave £5, Sam £20 — pay up 👉 app.in-or-out.com/p/…`, editable, via the
  `HistoryView.jsx:173-183` `navigator.share` → clipboard pattern. **PR #2b appends the payment
  instructions** (`→ Barclays 12-34-56, ref: your name`) — that line is what turns this from a nag
  into a payable message for a bank-transfer squad.
- Result state + per-row `chased 2h ago` under the name (`guestLine` slot `:208-210`).
- Cooldown UX: keep the button **visible and disabled**, labelled `Chased 40 mins ago · again at 4:20`.
  State on the control, not a floating amber string (the `:519` precedent is poor).
- 🔴 **Both of those states need `last_chased_at`, and the client CANNOT read it.** An earlier draft
  specced them against `notification_log` — the very table this manifest proves is RLS-walled from
  anon+authenticated (mig 008:63-69, 019:40), which is *why* `getRecentNotification` is dead. Speccing
  a new UI state against it would repeat the bug we're citing as the cautionary tale, two sections
  later. **Fix: `_team_debtors` returns `last_chased_at timestamptz` per target** (it already reads
  `notification_log` server-side for the cooldown, so this is free), and the dry-run carries it to
  the sheet. No new reader RPC, no client read, no second source of truth.
- Per-player chase → a new non-`danger` `MenuItem` beside "Waive debt" (`:274-278`).
- **The dry-run is a network round-trip** — spec the loading state (skeleton in the sheet, not a
  blocked tap) and the RPC-failure state (`chase_rate_limited` / `invalid_admin_token` / offline →
  a real message, never a silent no-op). Send button needs the `isSavingRef = useRef(false)`
  double-fire guard (CLAUDE.md conventions) — a double-tapped chase is a double-chase.
- **Deep-link the landing (moved here from PR #3, where it was wrongly blocked).** Add `?pay=1` →
  `setShowProfile(true)` (`PlayerView.jsx:1215`) so the `/p/{token}` link opens **Payment History**
  rather than the top of PlayerView. The share-sheet link needs this **today**, regardless of how
  PR #0 resolves — it is not push-dependent and must not sit behind a push gate. (The push *tap*
  half stays in PR #3b, which genuinely is APNs-dependent.)
- **Gates:** `check-hygiene.sh` · `casual-regression.md` (MANDATORY — touches `apps/inorout/src/`) ·
  🚦 **real-iPhone walk (HR13)** — share sheet + native `navigator.share` in WKWebView.
- **Done-check:** with APNs dark, an admin can still chase 5 debtors end-to-end via the share sheet,
  and the UI states the true reachability rather than a fake success count.

### PR #3 — push send. Tier-2 · 🚦 BLOCKED ON PR #0 · 🚦 native walk · **S** (+ **M** for #3b)
Gates: 🚦 PR #0 verdict = `credsAccepted:true` (hard precondition) · `casual-regression.md` ·
`check-realtime-subscriber.sh` · `check-build.sh` · 🚦 **real-iPhone walk (HR13)** — push arrives
AND its tap deep-links.

Only if PR #0 returns `credsAccepted:true`. Wire the real send in `admin_chase_payment` (`p_dry_run:false`)
with type `adminChasePayment` (**never** `debtReminder` — the RemindersScreen trap), posting to
**`app.in-or-out.com`** (see AUDIT — not 472's `www`). Flip `platform_config.push_transport_live`
in the same change, so the reachability copy and the transport turn on together.
**PR #3b — the tap listener.** The independent second blocker: no `pushNotificationActionPerformed`
listener exists anywhere. Add it + a role-aware payload + an App.jsx route hook so a tapped debt push
routes to the `?pay=1` landing PR #2 already built. Without 3b a tapped chase goes nowhere — but note
PR #2's share-sheet link works regardless, which is why the `?pay=1` route itself lives there.
**Note for the App-Store freeze:** 3b is a **JS-bundle change** — the app is a remote-URL WKWebView
(`capacitor.config.ts:60-64`), so this ships via the web bundle and needs **no new binary**. Not
frozen. **Done-check:** on a real iPhone, a chase push arrives AND its tap lands on Payment History.

### PR #4 — email leg. Tier-2 · CLEAR (dark until template lands) · **M**
Gates: `check-hygiene.sh` · `check-build.sh` · `casual-regression.md` (touches `packages/core`
consumers) · 🚦 product decision on injured debtors (below) before merge.

- New casual `adminChasePayment` template in `_mailer.js TEMPLATES` (a missing one **no-ops silently**).
- Route the send through `dispatchReminder` (`cron.js:1932-1962`) — **fixing `:1939`'s
  `contacts.push = subbed.has(p.id)` to gate on transport-configured, not row-exists**, or the email
  fallback never fires for the iOS users who need it.
- Reuse its `counts.none` (`:1936/:1943`) as the canonical unreachable number for PR2's sheet.
- ⚠️ PII: `cron.js:1951-1955` writes the raw email/phone into `notification_log.recipient`. Match the
  existing pattern, but flag retention — same GDPR data-minimisation family as mig 577.
- **Decision needed:** `notify.js:688-694` filters injured players out of **push** only. Via
  `dispatchReminder` an injured debtor gets no push but *does* get email. Make that explicit.
- **Done-check:** a debtor with `user_id` set and no working push receives an email.

### PR #5 — reconcile mig 472 `casual.chase_payment`. Tier-3 · 🚦 human-on-intent · 🚦 migration · **S**
Gates: 🚦 **tier-3 human-on-intent** (live Gaffer-surface RPC) · `ephemeral-verify.md` ·
`rpc-security-sweep.md` · `check-rpc-security.sh` · `check-rpc-consumers.sh` · `check-ev-leak.sh` ·
🚦 human sign-off on the migration apply.

Either point its branch at `_team_debtors()` (fixing the cross-team + pending-claim + rate-limit-key
defects in place) **or** retire it in favour of `admin_chase_payment`. Tier-3 because it's a live-DB
RPC touching the Gaffer action surface.
➕ **Also fix 472's dead host** — `:279` and `:348` post to `www.in-or-out.com`, which mig 361
abandoned because these POSTs don't follow redirects. Both of 472's send paths (`chase_payment` and
`notify_reserves`) would silently no-op the day `act_enabled` is ever switched on. Dark today, so
nobody has noticed; a one-line fix while the file is open.
**Done-check:** exactly one definition of "who owes" remains, and no `www.in-or-out.com` survives in
`rls_migrations/` outside a `_down.sql` (`check-references.sh "www.in-or-out.com"`).

### PR #6 — fix the `debtReminder` cron. Tier-2 · 🚦 SHIP-LIVE (changes a live weekly send) · **S**
Gates: 🚦 **SHIP-LIVE** — `check-live-config.sh` will flag this PROTECTED; changes a weekly send
to real players the moment it deploys · `casual-regression.md` · `check-build.sh` ·
🚦 human sign-off on merge (merge = live prod deploy).

Point `notify.js:524-536` at `_team_debtors()` so the automated reminder stops telling multi-week
debtors the wrong figure (`price_per_player` instead of their real debt). **Done-check:** a player
owing 3 weeks is told £15, not £5.

**SCOPE DECISION (operator, 2026-07-16): casual reminders ONLY.** Venue/club tap-to-pay chasing and
casual Stripe are both **out** — filed below, not built. The epic is PRs #0-#6: a casual admin nudges
the players who owe. Nothing else.

**Filed separately via `/backlog-capture`, NOT this epic:**
- **The venue/club manual chase (the "tap to pay reminder").** Cheap and mostly built: P11 (mig 541)
  already sends stage-aware payment-due reminders by email **+ push** carrying `url = pay_url || app`,
  and mig 550 already renders reminder-sent pills on both Payments surfaces. **It only lacks a button**
  — P11 fires on a 10am cron, so an operator can't chase four people *now*. Would reuse P11's dispatch
  verbatim over a `venue_charges` audience (NOT `_team_debtors` — different ledger). Different app,
  different auth (`auth.uid()`, not `p_admin_token`), so it was always a separate implementation
  sharing only the product verb.
- **Casual Stripe** — see OPPORTUNITY. Blocked on ONE product question: does the **venue** collect a
  squad's fees, or the **squad admin**? Engine's built and already team-aware; the answer decides
  whether it's plumbing or an epic. Carry the three snags: `stripe-charge-checkout.js:80-82` rejects
  non-membership/class source types; payer resolves via `auth_user_id → member_profiles` (casual
  players mostly have no account); `_recompute_player_owes` ignores `debt_payment` (RPCS.md:68) so a
  card payment wouldn't clear the debt. Plus the dead `payMode`/`Transfer` stub
  (`PlayerView.jsx:1438/:1481`).
- **`payment_ledger.method` has no `bank_transfer`** — transfers currently record as `cash`.
- Direct-mode auth (4 browser callers →
RPCs + ~3 DB callers, ~3 migrations); `CRON_SECRET` rotation + vault; `resolve_admin_caller`
disabled-VC check; `getRecentNotification` fail-open + its barrel export (delete it with PR2 if the
loop has budget — leaving a dead wrapper beside a working one guarantees someone copies the wrong
pattern).

---

## 🚦 GATES the loop must stop at

1. **PR0 — operator runs `apnsDiag`.** Nothing in PR3 starts until the verdict is in.
2. **Migration applies (586, PR1; PR5).** Human sign-off — no pre-authorisation carried over from
   the per-game epic.
3. **PR2 + PR3 — real-iPhone walk (Hard Rule 13).** Native-affecting; the build hook cannot see
   "tap does nothing".
4. **PR5 — tier-3 human-on-intent.** Live Gaffer-surface RPC.
5. **PR6 — SHIP-LIVE.** Changes a weekly send that goes to real players on apply.
6. **Security gates, non-negotiable, any PR:**
   - No new client `fetch('/api/notify')`. Server RPC + `net.http_post` only. A client-fired chase
     is an automatic reject. (Note honestly: this **avoids widening** the direct-mode hole; it does
     not close it — the DB can't send push, so the RPC must still POST to the open endpoint.)
   - Server-templated body, debtor-addressed only. No admin free text in push/email.
   - Cooldown inside the RPC, per-player, 24h; `notification_log` inserted synchronously **before**
     `net.http_post`.
   - Pending claims (`self_paid`/`claimed_at`) filtered out of the audience.
   - `GRANT EXECUTE TO anon, authenticated` on the chase RPC; named-role REVOKE on `_team_debtors`.
7. **Mandatory skills:** `ephemeral-verify.md` (PR1) · `rpc-security-sweep.md` (PR1, PR5) ·
   `casual-regression.md` (PR2, PR3, PR6 — all touch `apps/inorout/src/` / `packages/core/`).
8. ✅ **Product decisions — ALL ANSWERED 2026-07-16. None outstanding; PR #1 may start.**
   - **U18 → "no — guardians."** Never chase a child. Buildable form = **exclude known minors**
     (`date_of_birth IS NOT NULL AND age < 18`); the guardian half isn't reachable from casual and
     is already P11's job on the club side. Full reasoning in LD#7. Real fix filed (LD#11).
   - **Guests → CHASE THE HOST.** Not the guest. A guest has name + token only (mig 346:124-140) and
     is unreachable by every channel forever, but the host who brought them IS reachable and IS
     responsible. `_team_debtors` resolves a guest's debt to `paid_by='host'` and targets the host;
     the guest is never messaged. (Note: `guest_fee` is excluded from `owes` by the mig-460 recompute
     — RPCS.md:68 — so the host's guest debt must come from the ledger directly, not `owes`.)
   - **Injured debtors → CHASE THEM.** The debt is real regardless of the hamstring. ⚠️ This makes
     the chase **deliberately inconsistent** with `notify.js:688-694`, which filters injured players
     out of push for availability nudges — correct there (don't ask an injured man if he's playing),
     wrong here (he still owes £15). The chase RPC must therefore **bypass that filter**, which means
     it cannot lean on direct mode's injured-filtering. Record the intent at the call site or someone
     will "fix" it back.
   - **`platform_config` → YES, and it's my call not the operator's** (plumbing, not product): one
     row, seeded `true` (PR #0 proved the transport live), with `notify.js` writing back from
     `apnsConfigured()` on every `apnsDiag`/send so the mirror self-heals and can never drift into
     the LD#2 lie.
   - **Scope** = casual reminders only. Venue/club chase + casual Stripe filed, not built.
   - **PR #6 stays last** (operator: "we fix it after this is complete") — despite PR #0 proving the
     wrong-amount bug is live and reaching real players weekly. Deliberate, not an oversight.

---

## DONE =

An admin taps **Chase all 5 · £40** in Payments, sees exactly who will be reached and who won't
*before* sending, sends to those who can be reached, and copies a ready-made message to WhatsApp for
those who can't — with per-player 24h rate limiting, a server-side audit trail, and no ledger write.
Every debtor who *can* be reached gets an accurate figure for **this team's** debt and a tap straight
through to the `I've paid` claim the admin then confirms — the loop that already works, finally
started by a button instead of a WhatsApp message. Exactly one definition of "who owes" exists in the codebase, shared by the
manual chase, the cron, and the Gaffer action. The APNs question is answered rather than assumed.

---

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

**MISSED (1) — the U18 debtor, invisible to every lens because each one had a different adult in mind.**
Casual squads contain minors. The user lens pictured a volunteer chasing his mates; the security lens
threat-modelled admins and vice captains; the platform lens counted push subscriptions. Not one asked
**how old the person receiving the message is.** So the draft would have shipped a push notification
demanding money from a child — and the proof it's wrong sits in this repo's own sibling epic: guardian
`/hub` payment reminders (P11) are guardian-facing *by design*, because minors don't pay, their parents
do. The platform already knew; this scope forgot. It hid because every lens was individually reasonable
and "who is the recipient" felt like lens ①'s job — but lens ① was asked about the *admin*, who is
categorically an adult. The persona question got answered for the sender and never asked for the receiver.
**And the tail is sharper than the finding.** Chasing it down produced two more: the first fix named
`member_profiles.dob`, which has **no join to `players`** and was unbuildable; the real column is
`players.date_of_birth` (mig 056:52) — which is NULL for approximately every casual player and isn't
even mapped by `dbToPlayer`. So the honest resolution (LD#7) is a **partial control that fails open**,
shipped only because mig 584 settled the same trade-off and NULL-means-minor would exclude the whole
squad. The lesson worth carrying: *this manifest's instinct to hunt fail-open controls in other people's
code — the dead cooldown, row-exists-≠-deliverable — needed pointing at its own additions twice before
it caught them* (see also the "chased 2h ago" state, specced against an RLS-walled table). Writing the
critique doesn't immunise you from the bug.

**MISSED (2) — the tap listener, sitting in the gap between the platform lens and the UX lens.**
The push half has *two* independent blockers, not one, and only the first was on anyone's radar.
Everyone knew APNs creds were dormant. Nobody noticed that
`grep pushNotificationActionPerformed apps/inorout/src/` returns **nothing** — so even the day the
operator pastes the `.p8` into Vercel, a tapped debt push still goes nowhere. `deliverApns` faithfully
packs `url` into the payload (`notify.js:79`) and no client code ever reads it. The UX lens designed
the *send* and the platform lens audited the *transport*; the *landing* fell between them. It matters
most here because a debt chase you can't act on isn't a reminder, it's a nag — and the pay action
already exists two taps away (`PlayerView.jsx:1094`/`:1221`). Hence PR3b. The smaller sibling: even
via the share sheet, the link opens PlayerView's top rather than the payment panel, so `?pay=1` earns
its keep regardless of how PR0 resolves.

**OPPORTUNITY — the chase is ONE feature with TWO ceilings, set by whether the payer can be charged.
The operator's framing, and it's the right one.** (Two earlier drafts got this wrong: first "Stripe
funnel" — wrong audience; then "put bank details in the chase" — solving a problem the operator
doesn't have. Both are recorded here because the correction is the finding.)

**Casual = nudge, and that is the CEILING, not a compromise.** The settlement loop already works and
the operator is happy with it: player pays cash/bank → taps `I've paid (cash) · £5`
(`PlayerView.jsx:1094`) → admin confirms (mig 460 `admin_confirm_payment`). The chase's whole job is
to *start* that loop. PR #2's `?pay=1` deep-link finishes it. **No new money path, no sort-code field,
no new system.**
⚠️ **CORRECTION — an earlier draft claimed casual Stripe was "structurally impossible". That was
wrong, and the operator was right to push.** The Stripe **engine is fully built and live** (migs
403-408): Connect, customer linking, hosted invoices, webhooks, reconciliation, refunds, billing
portal, `pay_url`, plus ~7 endpoints in `apps/inorout/api/` (`stripe-connect`, `stripe-charge-checkout`,
`stripe-bulk-invoices`, `stripe-webhook`…). And it is **already team-aware in two places**:
`venue_charges` uniqueness is `(source_type, source_id, COALESCE(team_id,''))` — the table carries a
`team_id` — and `venue_billing_runs.cohort_type` accepts **`'team'`** with `cohort_ref = team_id`
(mig 405). **A venue can already bill a team.** Nothing about Stripe needs inventing.

**What's actually missing is plumbing, and it reduces to ONE product question: who owns the Stripe
account for a casual squad's £5?** Stripe accounts hang off `venue_integrations`
`UNIQUE(venue_id, provider)` (mig 329) — an account needs a **venue** to own it. And `teams` has no
`venue_id`/`club_id` (SCHEMA.md:82-93 — `id, name, admin_token, join_code, onboarding_complete,
admin_email, team_type, created_at`), while `schedule.venue` is **free text** (`:217`), not a link.
So:
- **If a squad plays at a Stripe-connected venue** (the pilot model — squads at Finbars), the rails
  are essentially there: the account exists, `venue_charges` takes the `team_id`, billing runs take
  the team cohort. The gap is that casual game fees live in a **different ledger**
  (`payment_ledger`, whole pounds) and were never plugged into `venue_charges` (pence). **Plumbing.**
- **If a squad admin should collect his own £5s**, that's a new Connect owner type (`team_id` on
  `venue_integrations`, or model a squad as a lightweight venue). **Bigger, but still not "build
  Stripe".**
Three known snags for whoever builds it: `stripe-charge-checkout.js:80-82` hard-rejects any
`source_type` other than `membership`/`class`; it resolves the payer via `auth_user_id →
member_profiles`, and casual players are token users who mostly have no account at all; and RPCS.md:68
— `_recompute_player_owes` sums `type='game_fee'` only, so a Stripe `debt_payment` row would not clear
the debt it just paid (right fix: settle the `game_fee` rows directly, as `admin_confirm_payment` does,
rather than teaching the recompute a second money type).
Corroborating that someone started this and stopped: `PlayerView.jsx:1438` hardcodes
`const payMode = 'both'` — a placeholder for squad payment config that never arrived — and `:1481-1483`
renders a **permanently `disabled`** `Transfer £{price}` button at `opacity:0.4`, while
`getGuestPaymentState` already has a `paid_stripe` state (`:1450`).
**Still its own epic, and still not a blocker for this one** — the casual chase ships as a nudge
either way, and gains "tap to pay" for free the day the rail lands, because the deep-link and the
audience RPC are already built here.

**Venue/club = tap-to-pay, and it is ALREADY BUILT — as a cron, not a button.** This is the real find.
Guardian-hub **P11 is COMPLETE (mig 541)**: `membershipRemindersJob` sends payment-due reminders by
**email + push**, stage-aware ("*£X at &lt;venue&gt; is due next week/tomorrow/today/now overdue*"),
with **`url = pay_url || app`** — i.e. the tap-to-pay reminder the operator wants **exists and ships
today**. And mig 550 already put **reminder-sent pills** on both Payments surfaces via a
`venue_charges` LATERAL. What's missing is not the rail, the copy, the push, or the pay link — it's
**the button**. P11 fires at 10am on a schedule; the operator cannot say *"chase these four now."*

**So the opportunity is a manual trigger over machinery that already exists → PR #7.** Same product
verb ("nudge who owes"), different ceiling per audience, and the expensive half is already paid for.

**~~And the cheap one: PR #0 audits the whole push estate~~ — RAN IT. It's fine.** ✅ `credsAccepted:
true`, production, correct bundle. The push estate is **healthy**; guardian reminders, coach pings,
POTM voting and P11's tap-to-pay reminders have all been landing. The alarming version of this
finding — *"every push has silently no-oped"* — was built on two stale code comments and is **dead**.
Recorded because the near-miss is the lesson: it took one HTTP call to check, and the manifest had
already reasoned three sections deep off an unverified premise.
**What survives, and it's sharper for it:** `superadmin_health` still counts **subscription rows**,
not deliverability (mig 236:55-78), so it would report a player "reachable" whether or not APNs
worked. That metric was never measuring what its name implies — the probe just proves it happens to
be right today, for the wrong reason.

**And the cheap one: PR #0 audits the whole push estate for one HTTP call.** If `apnsDiag` returns
`{configured:false}`, then **every push In or Out has ever sent to the native app has silently
no-oped** — guardian reminders, coach pings, POTM voting, spot-opened alerts, the lot — while
`superadmin_health` reported them reachable the whole time, because it counts rows, not
deliverability (mig 236:55-78). This epic is simply the first consumer to look.

**FUTURE-PROOF — `_team_debtors()` as the single definition of "who owes on this team".**
⚠️ **Scoped honestly: one definition per LEDGER, not one globally.** `_team_debtors` unifies the three
**casual** chase paths (`payment_ledger`). The venue/club side has its own ledger (`venue_charges`)
and PR #7 must use that — a single cross-ledger "who owes" would be a false abstraction over two
different money models (whole **pounds** vs `amount_due_pence`; `p_admin_token` vs `auth.uid()`;
squad fees vs memberships). The win is killing the *three* competing definitions inside one ledger,
not inventing a fourth that spans both.
Not "we made it generic". One named SQL function, consumed by all three chase paths. The cost is
maybe twenty lines over inlining the query in PR1. The reason it's the highest-leverage bet in the
epic: **three definitions already exist and they already disagree.** Mig 472:236 uses cross-team
`players.owes`. `notify.js:527` uses `!p.paid && !p.self_paid`. PR1 would have been the third. They
disagree about two-squad players, about pending claims, and about guests — which is precisely why the
live cron tells a three-week debtor he owes £5. Every future change lands in one place: Stripe
`debt_payment` rows entering the recompute, guest_fee debt, a per-player amount in the copy, a
league-side chase. Get this wrong and each new channel forks the definition again; get it right and
PR5/PR6 collapse from "rewrite two chase paths" into "point them at the function".

**WOW — one per audience. Honesty rather than cleverness, which is the right ceiling for a nudge.**
*Admin:* **"3 can't be reached — Barry, Dave, Sam → Copy for WhatsApp."** Every other product would
have shown a green tick and a lie. This one admits the gap and hands him the fix in the same tap —
into the group chat where the squad actually lives. An unreachable player stops being a silent failure
and becomes a solved problem, and the three who get the WhatsApp link find out they're missing an app.
Honesty that recruits.
*Player:* a chase that's **actionable, accurate, and private** — the real figure for the right team,
landing on a screen with an "I've paid" button, sent to him alone and never to the group. Today's
alternative is the admin naming him in WhatsApp.
*Operator:* the PR0 verdict. Not a feature — but "your entire push estate may be dark and your health
dashboard has been telling you otherwise" is the loudest thing in this document.
*The one audience with no wow, stated plainly:* **guests.** Name + token only (mig 346:124-140), no
push, no email, no phone, forever. The share sheet is the only thing that will ever reach them, which
is another argument for it being the primary channel rather than the fallback. No cheap addition
changes this — it's structural, and pretending otherwise would be the same dishonesty Locked Decision
#2 exists to prevent.

---

## Related

`PER_GAME_PAYMENT_MARKING_HANDOFF.md` (the ledger this chases) · `GAFFER.md` (mig 470/472, the dark
twin) · `STRIPE_FULL_BUILD_HANDOFF.md` (the collection funnel this opens) ·
`docs/epics/guardian-hub-followups.md` (P11 payment reminders — the membership-side sibling; D6 is
the same missing tap listener) · Hard Rules 9, 10, 11, 12, 13, 15.
