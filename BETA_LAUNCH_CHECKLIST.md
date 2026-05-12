# IN OR OUT — Beta Launch Checklist
*Pre-flight checks before opening to a new cohort. Run end-to-end before each stage expansion.*

---

## STAGE 1 — CLOSED ALPHA (Finbar's Tuesdays + Monday Footy)
**Target: Tuesday May 19 2026 (Finbar's) → Tuesday May 26 2026 (Monday Footy added if week 1 clean)**

### Security — must clear before any external user
- [ ] Supabase publishable key rotated
- [ ] Old key removed from all env vars (Vercel, local)
- [ ] Old key invalidated in Supabase dashboard
- [ ] RLS policies audited on every table — confirm team_id isolation
- [ ] Google DNS TXT record added via 123-reg
- [ ] Verify OAuth screen shows in-or-out.com, not Supabase URL
- [ ] Confirm /admin/TOKEN routes 404 on invalid tokens, not 500
- [ ] Confirm /p/TOKEN routes 404 on invalid tokens, not 500
- [ ] Confirm find_player_by_email RPC cannot leak players outside requester's teams

### Core loop — Tuesday night survival kit
- [ ] IN → OUT → IN status change persists and broadcasts to other devices
- [ ] Reserve queue auto-promotes when an IN drops out
- [ ] Plus One add → pay → guest appears in teams
- [ ] Injured toggle → removed from squad → not counted in stats
- [ ] Bib selection persists and shows on player view
- [ ] Score entry writes player_match rows for every player on both teams
- [ ] POTM selection writes to matches.motm AND player_match.was_motm
- [ ] Cash self-confirm two-step works end to end
- [ ] Clear Debt multi-step works for player with multiple unpaid weeks
- [ ] Realtime broadcasts within 2s on player count change
- [ ] Game live toggle on admin side immediately enables/disables note-add for players

### PWA + notifications
- [ ] PWA install prompt fires on iOS Safari
- [ ] PWA install prompt fires on Android Chrome
- [ ] Push notification consent prompt only appears after status set + game live
- [ ] Test push delivered to: fresh Android install
- [ ] Test push delivered to: installed iOS PWA
- [ ] Test push delivered to: re-installed PWA (subscription rebuilt)
- [ ] Quiet hours respected — push queued not sent overnight
- [ ] gameDay9am fires at 9am local time, not server time
- [ ] oneHrBefore fires correctly given kickoff_time
- [ ] notification_log row written for every push

### Join + onboarding
- [ ] /join/team_finbars tested end-to-end on fresh iPhone (clean device, never signed in)
- [ ] Google OAuth full round trip from /join/CODE
- [ ] Email magic link full round trip from /join/CODE
- [ ] /auth/callback redirects to correct destination after login
- [ ] JoinSuccess.jsx shows install instructions
- [ ] iOS Safari users see 3-frame install guide (Share → Add to Home Screen → Open from home screen)
- [ ] Android Chrome users see 2-frame install guide (menu → Install)
- [ ] Desktop users see "open on your phone" softer message
- [ ] "Skip for now" link present but de-emphasised
- [ ] After install, opening from home screen icon triggers push permission prompt at right moment

### Auth + access
- [ ] Token URL /p/TOKEN loads without auth
- [ ] /admin/TOKEN loads without auth, but validates against teams table
- [ ] /demoadmin loads with no auth and resets after 2hrs idle
- [ ] ioo_last_visited cookie redirects returning user to their last team

### Data integrity
- [ ] Finbar's Tuesdays team data clean and accurate
- [ ] All Finbar's players have correct tokens
- [ ] All Finbar's players linked to correct user_id where authed
- [ ] Demo team_demo loads 25 players, 22 matches
- [ ] Demo auto-reset cron firing every 2 hours
- [ ] Demo manual reset button works

### Monitoring + error handling
- [ ] Posthog firing on key events (status change, score saved, payment, push received)
- [ ] Vercel deployment alerts going to your email
- [ ] Supabase error log reviewed for any prod errors this week
- [ ] Sentry or equivalent error tracking — DECISION NEEDED
- [ ] Health-check page or dashboard for Tuesday night standby

### Communication
- [ ] WhatsApp group created: Tarny + Finbar's admin (Stage 2: + Monday Footy admin + 3 testers)
- [ ] Welcome message drafted explaining what to do, what to ignore, what to flag
- [ ] Beta user expectations doc: what's working, what's not, what's coming
- [ ] Crash report path defined: "screenshot + WhatsApp message + don't refresh"

### Standby procedure for first 3 Tuesdays
- [ ] Tarny available 6:30-9:30pm Tuesdays
- [ ] Vercel deploy frozen 6pm-10pm Tuesdays (no pushes during live game prep)
- [ ] Supabase dashboard tab open
- [ ] Posthog dashboard tab open
- [ ] Phone on loud

---

## STAGE 2 — CLOSED BETA (3-5 more teams)
**Target: ~Jun 9 2026 — open to anyone willing to mandate the app for their team**

### Hard requirements before opening
- [ ] All Stage 1 items still passing
- [ ] Stripe Connect live — first treasurer onboarded
- [ ] At least one real Stripe payment processed end-to-end
- [ ] Refund flow tested (game cancelled → auto refund)
- [ ] My IO screen fully built — all unlock tiers firing correctly
- [ ] Admin screens redesigned (Teams/Score/Bibs/Squad/Schedule)
- [ ] Onboarding flow redesigned and tested with someone who has never used the app
- [ ] Join/login flow redesigned

### Beta user recruitment
- [ ] Target list of 5 candidate teams identified
- [ ] Personal outreach drafted (WhatsApp/text, not email)
- [ ] Beta agreement: free forever for first 10 teams in exchange for feedback
- [ ] Onboarding call template — 15min Zoom to walk them through setup

### Observability
- [ ] Per-team Posthog filter so you can watch each beta team independently
- [ ] Tuesday-evening health dashboard (active sessions, recent errors, push delivery rate)
- [ ] Weekly beta digest email/Notion auto-generated

### Documentation
- [ ] FAQ doc for beta admins (top 20 questions)
- [ ] FAQ doc for beta players (top 10 questions)
- [ ] "Known issues" doc kept current and shared in WhatsApp group

---

## PUBLIC LAUNCH (late July / early August target — quiet, no big push)

### Hard requirements before public availability
- [ ] All Stage 2 items still passing
- [ ] 8+ weeks of clean Tuesday/weekly operation across Stage 2 teams
- [ ] <1% error rate on key flows over 30 days
- [ ] Super admin dashboard built (Tarny-only read-only)
- [ ] Apple Sign In live
- [ ] Pricing page live
- [ ] Help/support page live
- [ ] In or Out Ltd incorporated (Companies House)
- [ ] Trademark application filed

### Capacity
- [ ] Vercel plan reviewed for expected traffic
- [ ] Supabase plan reviewed — current free/pro tier limits
- [ ] Posthog plan reviewed — event volume projection
- [ ] On-call rotation — even if it's just Tarny, define quiet hours

---

## KILL CRITERIA (pre-committed — review before reacting)

**Stop and rebuild if:**
- Core loop fails in match-night use (status/squad/score) for 2+ consecutive weeks
- Push notifications fundamentally unreliable across iOS+Android
- Real money payment processed incorrectly even once
- Data leak between teams (cross-tenant exposure)

**Iterate, don't stop, if:**
- Users don't immediately understand IO Intelligence value prop (= copy/onboarding)
- Onboarding takes too long (= UX iteration)
- Admin screens feel cluttered (= design iteration)
- Push notification opt-in rate is low (= messaging iteration)

**Ignore until 50+ teams if:**
- Edge cases in 11-a-side, women's football, kids football
- Multi-language support requests
- Statistics depth complaints (assists, ratings)

---

## SESSION 8+ SHIP BLOCKERS (in order)

1. Test /join/team_finbars on clean iPhone + capture install screenshots
2. Rotate Supabase keys
3. Google DNS verification
4. JoinSuccess.jsx install screen + screenshot mockups
5. Tuesday-night standby kit
6. WhatsApp comms to Finbar's admin
7. Stage 1 launch — Tue May 19
