# Event OS vs Tournify — competitive comparison

*Session 172 (2026-06-22). Sources: tournifyapp.com/en/features, /en, /en/pricing.*

**Verdict:** we already match most of Tournify's core tournament features; 4–5 real
gaps to close for true parity; big differentiators because we're a whole club + venue
platform, not a standalone tournament tool.

## Parity matrix

| Tournify feature | Us (Event OS) |
|---|---|
| Formats: groups, knockout, friendlies, combinations | ✅ Equal/better — groups, single-elim, **double-elim**, round-robin |
| Auto-generate schedule | ✅ Yes (round-robin circle method + seed knockout from groups) |
| Drag-and-drop schedule editing | ⚠️ **GAP** — auto-generate + form-assign, no drag-drop |
| Live scorekeeping, real-time everywhere | ✅✅ Better — ref tool **works offline**, syncs |
| Referee assignment / teams self-officiate | ✅ Have it (thin UI for casual self-ref) |
| Live standings + bracket | ✅ Auto-calculated |
| Player stats: goals, cards, MVP | ✅ + sin-bin, notes; Player-of-Tournament ⚠️ no set-button |
| Online registration + built-in payment | ✅ Registration yes; payment plumbed (Stripe/GC) **dormant until live keys** |
| Public tournament website | ✅ Live bracket page (TournamentScreen): branding, sponsors, 30s poll |
| Real-time slideshow/display | ✅✅ Much better — full **reception TV** (scores, standings, bracket, goals ticker, sponsors, member check-in) |
| Sponsor banners / branding | ✅ Yes |
| Mobile apps (players/refs/fans) | ✅ PWA now; native iOS wrap **pending App Store approval** |
| Push notifications | ✅ Web push live; native APNs/FCM dormant |
| Multi-language + multi-currency | ❌ **GAP** — UK/English/GBP only |
| Multi-sport scoring (12+ incl. set-based tennis/volleyball) | ⚠️ **GAP** — scoring football-shaped; athletics/sports-day entry unbuilt |

## Gaps to close to EQUAL Tournify
1. **Venue-operator self-serve creation** (the scoped epic — today club-manager gated; see [[project_venue_operator_tournaments]] / memory).
2. **Drag-and-drop schedule editing.**
3. **Multi-sport tournament scoring** (set-based sports + athletics/sports-day results; `sport_stats` jsonb scaffolding is dormant).
4. **Multi-language / multi-currency** (lower priority for UK pilot).
5. Polish: self-officiating UI, Player-of-Tournament button, co-organiser roles, native apps live.

## Where we blow it out of the water
1. **Offline-first live refereeing** — score with no signal, syncs later. Tournify needs connectivity.
2. **Real venue big-screen system** (not a slideshow) — live scores, brackets, goals ticker, sponsors, member check-in.
3. **One platform** — tournament teams/players are also your members, league players, class-bookers, casual squads, kids — one identity, one login (SSO shipped s172). Tournify is a data island.
4. **Youth-safeguarding registration** — CPSU forms, e-signed consents + audit, ID-doc upload. Tournify sign-up is generic.
5. **Runs inside real venue ops** — pitches, equipment/room hire, QR check-in, staff, payments on the club's existing Stripe/ledger.
6. Coming: watchOS ref companion, single-writer live clock, AI pre-match briefings.

**Pitch:** *Tournify runs your tournament; we run your tournament AND your whole club — the
same players, one login, a live reception TV, and refs that work even with no signal.*
