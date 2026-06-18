# Demo sign-in users & seed data

Two cross-role demo accounts + a deep feature seed, so any feature can be shown at
any time. Seeded by migrations **363** (feature data) + **364** (sign-in users).
All anchored to the existing **`demo_venue`** ("Demo Sports Centre"). Re-runnable
(`ON CONFLICT DO NOTHING`); never touches the football/casual demo.

## Sign-in credentials

| | User 1 — **Alex Demo** | User 2 — **Sam Carter** |
|---|---|---|
| Email | `tarny+demo@lettrack.co.uk` | `tarny+family@lettrack.co.uk` |
| Password | `DemoBoss1!` | `DemoFam2!` |
| Covers | platform superadmin · HQ company super-admin · venue **owner** · squad admin · casual + competitive player · club member of **both** combat clubs (fight record + grading via multi-context) | plain member (**paused**) · **guardian** of a junior · venue **staff** (booking caps only) · plain casual player |

Both emails are `+`-aliases of `tarny@lettrack.co.uk` (Google Workspace), so every
OTP code lands in that one inbox. (Repointed from the original `@in-or-out.com` in
mig 365 — same user UUIDs, all role links intact.)

> **Sign-in method per app:**
> - **Venue + HQ apps** → email + **password** (works directly).
> - **Consumer app (inorout)** → **email OTP** or Google only (no password). Pick
>   the **email-code** option (NOT the Google button — Google only works for the
>   bare `tarny@lettrack.co.uk` and resolves to your real identity, not the demo
>   roles), enter the `+demo`/`+family` address, and read the code from your
>   `tarny@lettrack.co.uk` inbox. (OTP delivery depends on Supabase Auth SMTP /
>   rate limits — the request returns 200; if a code doesn't arrive, that's the
>   Supabase email provider, not the account.)

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

## Switching the demo emails
Done in **mig 365** (repointed to `tarny+…@lettrack.co.uk`). To change again, edit the
`auth.users` email + `auth.identities` `identity_data` email + `member_profiles.email`
in a new migration — the role links key on the fixed user UUIDs, so nothing else changes.

## Teardown
Run `365…_down.sql` (revert emails) → `364…_down.sql` (users + links) → `363…_down.sql` (feature data).
