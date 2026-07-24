# BACKLOG.md — the ranked source of truth

*Last updated: 2026-07-24 (full backlog audit + housekeeping — PR #630).*

This is the **single ranked view of what's left to build and whether it's worth it.**
It is the decision layer. The detail/record layer lives in:

- `FEATURES.md` — feature log + raw `📥 CAPTURED` inbox
- `BUGS.md` — bug log + raw `📥 CAPTURED` inbox
- `GO_LIVE_ISSUES.md` — production pre-flight log + raw `📥 CAPTURED` inbox
- `docs/archive/` — handoff docs for **shipped** work (moved out of root 2026-07-24)

**Rule:** when an item ships, mark it here AND in its record doc, then archive its handoff.
When `/backlog-capture` files a raw item, it lands in a `📥 CAPTURED` inbox above; promote it
into the table below (with a verdict) during the next audit.

---

## The lens

Pre-broad-launch, solo non-technical operator, native iOS app live in the App Store, **no real
user base yet** — courting venue/club pilots (PA Sports, DF Sports, Pitchbox Arena). The value
test for every item: **does it land or keep a pilot, or unblock a real user — or is it
polish/platform for users who don't exist yet?**

Verdicts: **NOW** = go-live blocker or live defect · **SOON** = valuable + near-done or
high-ROI-cheap · **LATER** = real but premature/heavy · **DROP** = not worth building.

---

## 🔴 NOW — ✅ CLEARED 2026-07-24 (only operator device-walks remain)

| # | Item | Status |
|---|------|--------|
| 1 | Stripe `charge.refunded` | ✅ Operator confirmed already live on the webhook |
| 2 | `club-media` upload 403 | ✅ **FIXED + LIVE** — mig 619 applied + prod-verified (manager=true/random=false/anon=false), PR #633 merged. ⛔ owed: confirming upload smoke by an authed club manager |
| 3 | DF trial-booking P4 | ✅ Already merged (#608) + CTA live (P5). ⛔ owed: real-iPhone walk of the 4 trial screens |
| 4 | `hubResumeTarget` bypass | ✅ **FIXED + LIVE** — PR #632 merged + deployed + boot-verified (12/12 vectors). ⛔ owed: real-iPhone /hub-landing walk |
| 5 | `log_session_ping` rate-limit | ⤵ **Re-triaged → LATER** — `auth.uid()` footgun + fresh-telemetry regression risk; do properly (JWT-forwarding edge route) in the pre-launch hardening pass |
| — | Admin Debt Chase #579 | ✅ Verified LIVE in prod bundle — no action |

**Owed (operator, device-only): real-iPhone walks of the /hub landing + the DF trial screens; a confirming club-manager upload smoke. No code work remains in NOW.**

## 🟢 SOON — status after the 2026-07-24 batch

**✅ Shipped this batch (merged + live; each owes a device walk):**

| # | Item | Result |
|---|------|--------|
| 6 | Email templates redesign | ✅ **PR #637** — rebased onto main, supersedes stale **#250** (now closed). All ~27 emails branded; render 4/4 clean |
| 8 | Venue setup wizard W5 | ✅ **mig 620 + PR #638** — self-serve venues go publicly live on signup (no pitch/class gate); anti-abuse cap re-based |
| 13 | Apple workout **type** in attach picker | ✅ **PR #636** — shows the activity type when several workouts fall in the game window |
| 10 | WhatsApp share (count-suffix + Live-Board button) | ✅ **already built + live** — stale inbox item, no work needed |

**⏸ Held / still open:**

| # | Item | Value | Progress | Effort left | What it achieves |
|---|------|-------|----------|-------------|------------------|
| 7 | Self-serve multi-vertical — gym | High | ~85% | S | ⏸ **HELD by operator (2026-07-24).** Completes gym self-provisioning |
| 11 | H2H share digest button | Med-High (growth) | ~85% | S | ⏸ **HELD by operator.** Finishes the "show your mate" viral loop |
| 9 | Club public page redesign — port mockup | Med-High | design 100%, code 0% | S | The public club shop-window feels premium, lifting share→signup |
| 12 | Records & Rivalry | Med-High (retention) | 0% | M | Surfaces banter/records the app already computes — a retention moat, zero backend |
| 14 | Verification-debt sweep (owed device walks + venue/superadmin deploys) | High (pre-pilot) | n/a | M (one session) | Proves shipped features actually work on-device before a pilot touches them |

## 🟡 LATER — real, but premature or heavy for now

| # | Item | Value | Progress | Effort left | What it achieves |
|---|------|-------|----------|-------------|------------------|
| 15 | Venue nav IA nits (Programmes split + Settings rename) | Low-Med | 0% | XS–S | Operator console rail reads coherently |
| 16 | Public page: past fixtures stuck under "Upcoming" | Med | 0% | S + product call | Public page stops showing stale games as "upcoming" (needs a decision) |
| 17 | `/hub` spin-forever on a failed reload | Med (reliability) | 0% | S | A failed reload doesn't strand a user on a spinner |
| 18 | club_member landing arm ignores hubEligible | Low-Med | 0% | S | Hub-eligible club members land on /hub, not /sessions |
| 19 | Security hardening batch (search_path pg_temp · ~13 admin RPCs inline caller-check · UNIQUE(storage_path) · get_my_world guardian filter) | Med (defense) | 0% | S–M | Tightens SECURITY-DEFINER / RLS surfaces before broad launch |
| 19b | `log_session_ping` anon rate-limit (re-triaged from NOW) | Med (sec) | 0% | S | Caps write-amplification on the telemetry write — needs a JWT-forwarding edge route (the RPC reads `auth.uid()`, so the BotID/service-role recipe would break user attribution); do in the pre-launch hardening pass |
| 20 | Data/invariant nits (team_3v3 casual seed · two squad-name columns) | Low | 0% | XS–M | Removes latent schema drift |
| 21 | Cloud-session e2e blockers (Supabase creds · IPv4 bind · egress · sharp) | Med (dev velocity) | 0% | M | Nightly QA runs in cloud instead of silently skipping ~7 tests |
| 22 | Dev-loop/harness gaps (manual-deploy gate · rollback lane · migration-collision · verification ledger · advisor baseline · hooks doc drift · dead-code audit) | Low-Med | mixed | S–M each | Closes small automation-harness gaps |
| 23 | Progressive squad setup | Med | unbuilt | M | Guided first-run squad setup for new admins |
| 24 | Support issue log | Med | 0% | L | In-app feedback + reply loop for pilots (doubles as a "what breaks most" board) |
| 25 | Mobile operator league | Med-High (Pitchbox) | 0% (design not started) | L | Run your internal league from your phone, not just the desktop console |
| 26 | Season lifecycle + Player of Season | Low-Med | 0% | L | Ability to END a season + award an end-of-season MVP |
| 27 | Referee-owed P2/P3/P4 | Low | P1 done | M | Ref broadcast / history / ratings |
| 28 | Interactive Widgets (iOS WidgetKit) | Med (retention) | 0% | XL | Home/lock-screen RSVP for the casual player without opening the app |
| 29 | Live Activities / Dynamic Island | Med | 0% | L | Match-day countdown on the lock screen (blocked behind Widgets) |
| 30 | Android app + Wear OS tracking | Low now | 0% | XL each | Android reach (park until iOS demand is proven) |
| 31 | Gaffer / AI layer — ALL remaining (canary · player-widen · team-balance · universal foundation) | Low now | built but 100% dark, ZERO briefings ever | XL total | An AI assistant across the app — every next step burns per-call LLM £ for an audience that doesn't exist |

## ⚪ DROP — not worth building

| # | Item | Why drop |
|---|------|----------|
| 32 | Client onboarding import (XL) | Manual entry is fine at 3-pilot scale; XL + compliance-heavy for a rare task |
| 33 | "No post-ship done-closing skill" (L) | Process tooling for a one-person shop; low ROI |
| 34 | "Match combined distance" feature | Already satisfied by the Team-vs-Team fitness card |

---

## Recommended sequence

1. **NOW bucket** (a few days) — refund config → club-media upload → finish DF P4 → the two cheap security fixes → confirm Admin Debt Chase #579 is live.
2. **Merge what's already built** — Email templates (#250), venue setup wizard, self-serve gym. You're storing finished work that isn't live.
3. **The cheap growth wins** — WhatsApp count-suffix + share button, H2H share button, club-page redesign port.
4. **The verification-debt sweep** — one session: batch the owed device walks + do the manual venue + superadmin deploys.
5. **Everything in LATER stays parked** until a pilot converts or an iOS user base exists.

*Also outstanding (housekeeping, not backlog): ~40 loose `*.png` + 6 `design_handoff_*/` folders
in the repo root want a sweep into a mockups/archive folder.*
