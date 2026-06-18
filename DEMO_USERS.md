# Demo sign-in users & seed data

Two cross-role demo accounts + a deep feature seed, so any feature can be shown at
any time. Seeded by migrations **363** (feature data) + **364** (sign-in users).
All anchored to the existing **`demo_venue`** ("Demo Sports Centre"). Re-runnable
(`ON CONFLICT DO NOTHING`); never touches the football/casual demo.

## Sign-in credentials

| | User 1 — **Alex Demo** | User 2 — **Sam Carter** |
|---|---|---|
| Email | `demo@in-or-out.com` | `family@in-or-out.com` |
| Password | `DemoBoss1!` | `DemoFam2!` |
| Covers | platform superadmin · HQ company super-admin · venue **owner** · squad admin · casual + competitive player · club member of **both** combat clubs (fight record + grading via multi-context) | plain member (**paused**) · **guardian** of a junior · venue **staff** (booking caps only) · plain casual player |

> ⚠️ **Sign-in method differs by app.** The **venue** and **HQ** apps accept
> **email + password** (these credentials work directly). The **consumer app
> (inorout)** signs in with **email OTP or Google only — no password**. To sign
> into the consumer app as these users you need the OTP code emailed to the
> address, so the consumer-app login only works if `in-or-out.com` mail is
> deliverable to these inboxes. If not, repoint the two emails to addresses you
> control (e.g. Gmail `+demo`/`+family`) and re-run mig 364 — see "Switching the
> demo emails" below. The seeded DATA still renders on every screen regardless;
> only the consumer-app *login method* is affected.

## Token-only entry points (no login — hand these out for demos)
- **Venue console backdoor:** `…/?token=demo_venue_token_DO_NOT_USE_IN_PROD`
- **Member pass** (`/m/<token>`): Alex boxing pass + MA pass are on his `member_get_self`; every combat member has a `pass_token`.
- **Referee:** existing `demo_league` ref tokens (see CONTEXT.md).
- **Reception display:** `demo_venue` `display_token`.
- **Casual player/admin tokens:** `team_demo` admin token `admin_demo`; player tokens `p_demo_alex_token` / `p_demo_sam_token`.

## What the feature seed contains (mig 363, on `demo_venue`)
- **2 combat clubs:** `club_demo_box` (boxing → fight records, sparring), `club_demo_ma` (martial_arts → belts/grading). Existing demo members enrolled into both.
- **4 spaces** (Studio 1, Main Hall, Mat Room, enquiry-only Function Room).
- **4 class types** incl. an **open/free** Junior Boxing (mixed-age roster), members-only Yoga, paid Spin, a **sparring** session; **7 sessions** (past/today/upcoming); **19 bookings** in every state (confirmed/waitlist/no-show/checked-in) + **3 more** for the demo users.
- **2 class packages** + member balances; **2 room hires** (confirmed w/ held deposit + pending enquiry); **2 PT trainers** + availability + **5 appointments** (upcoming/completed/no-show).
- **Belt ladders** (adult + junior) + award history; **fight records** (wins/losses/draws + sparring) for several boxers incl. a junior.
- **`venue_charges`** for paid items so **Payments + HQ analytics** show class/package/PT/room-hire/membership revenue.

## Switching the demo emails (consumer-app OTP)
If you want consumer-app sign-in too, change the two emails in `364_demo_signin_users.sql`
(both the `auth.users` and `auth.identities` `identity_data`, plus the `member_profiles.email`)
to inboxes you control, then re-apply. The role links key on the fixed user UUIDs, so
nothing else changes.

## Teardown
Run `364_demo_signin_users_down.sql` then `363_demo_features_seed_down.sql`.
