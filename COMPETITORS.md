# COMPETITORS.md — Competitive Landscape & Pricing

*Session 91, 2026-06-13. Built from a deep-research sweep (26 sources,
107 extracted claims, 25 adversarially verified before a session-limit
cutoff). Read alongside STRATEGY.md. This is intelligence for pitches and
positioning — not all figures are equally trustworthy, so each carries a
confidence tag.*

**Confidence legend**
- ✅ **VERIFIED** — confirmed by 2–3 independent adversarial checks against a primary/secondary source.
- ⚠️ **UNVERIFIED** — from a real source but verification was cut off (session limit) or the source is a pricing-aggregator (often stale). Treat as directional; re-check before quoting to a customer.
- ❌ **REFUTED** — failed verification; do not use.
- 🧠 **BACKGROUND** — analyst/operator knowledge, not from this sweep; flagged so it isn't mistaken for sourced fact.

---

## THE HEADLINE

The grassroots/amateur sports software market splits into **four lanes**, and
almost every competitor sits in **one or two** of them:

1. **Team management apps** (scheduling, availability, chat, payments) — Spond, TeamSnap, Heja, Teamer
2. **Club websites + membership/admin** — Pitchero, Clubforce, LoveAdmin
3. **League & competition management** — Spawtz, LeagueRepublic, Playwaze, GameDay
4. **Venue / pitch booking & operations** — Pitchbooking, Spawtz (venue side), MatchPint-type tools

**No single player credibly spans all four — and none of the team-app
giants run a venue.** In or Out's modular stack (player app + venue ops +
league/tournament + ref + reception display + membership + payments) is
built to sit *across* lanes 1–4. That breadth is the differentiation; the
risk is being shallower than the specialist in any one lane (see §B).

---

## A — COMPETITOR PROFILES

### Spond 🇳🇴 (the one to fear)
- **Model:** Free team app forever; monetises **Spond Club** (membership/finance layer) via payment transaction fees.
- **Pricing:** App = **£0**. Spond Club transaction fee (UK): **2.5% + £0.20** per transaction, via Stripe. ✅ VERIFIED
  - Regional: EUR 2.5% + €0.20 · USD 3.29% + $1.00 · NOK 2.99% + 2 NOK · CAD 5% + C$0.50. ✅ VERIFIED
- **Scale:** **3M+ monthly active users globally** (May 2024), of which **1M+ MAUs in the UK alone** (UK hit 1M Nov 2023). ✅ VERIFIED
- **Funding:** Well-funded; a Tracxn figure of "$17M across 2 rounds" is ⚠️ UNVERIFIED and almost certainly stale/partial (Spond has raised materially more since). 🧠 Spond is widely reported as one of the better-funded European sports apps.
- **Why it matters:** This is the free-forever incumbent that has *already trained the UK grassroots market* to expect $0 software + a payment clip. It owns lane 1 in the UK. **You cannot out-free it** — hence the STRATEGY.md "Spond defence."

### TeamSnap 🇺🇸
- **Model:** Freemium team app + sales-led "TeamSnap for Business" (leagues/clubs).
- **Pricing:** Free single-team tier. Paid coach plans — aggregator figures: **Premium ~$15.99/mo** (~$10/mo annual), **Ultra ~$21.99/mo** (~$12.50/mo annual); payment processing **~3.25% + $1.50** per transaction. ⚠️ UNVERIFIED (verification cut off; checkthat.ai is a secondary aggregator). Earlier search also suggested org plans scaling to ~$80–$500/mo. ⚠️ UNVERIFIED
- **Scale:** **25 million** coaches/admins/players/parents on platform (as of 2021). ✅ VERIFIED
- **Ownership:** **Waud Capital Partners took majority ownership** via growth-capital partnership, announced **14 Apr 2021** (amount undisclosed). ✅ VERIFIED (the PE deal); ⚠️ exact terms undisclosed.
- **Why it matters:** US-dominant, PE-backed war chest, per-team pricing. Less of a direct UK grassroots threat than Spond, but a model reference for the paid SKU.

### Heja 🇸🇪
- **Model:** Free youth-sports team app + paid premium (attendance stats, team fees, desktop login).
- **Pricing:** Free tier; premium price **not published** (in-app/contact only). 🧠
- **Scale:** **140,000+ teams, 1M+ users, 50+ countries** (US/UK/AU/NZ primary) — as of June 2021. ✅ VERIFIED
- **Funding:** **$4.2M seed led by Peak Capital (Amsterdam)**, **$7M total raised**. ✅ VERIFIED
- **"Owned by Sportradar?"** — NOT confirmed by this sweep. The verified investor is **Peak Capital**. Treat Sportradar ownership as 🧠 unconfirmed until checked.

### Pitchero 🇬🇧 (the closest UK analogue)
- **Model:** Club website + membership + payments. Tiered SaaS **plus** a payment clip — the exact dual model In or Out is considering.
- **Pricing (2026):** **Free** (single team) · **Standard £38/mo** · **Pro £99/mo** (annual discounts available). ✅ VERIFIED
  - Payment fees on top: Standard **from 2.42% + 17p**, Pro **from 1.67% + 15p**. ✅ VERIFIED
- **Scale:** Pitchero Group **22,000+ clubs, 160,000 active teams, 2M+ members**. ✅ VERIFIED (one verifier dissented on exact figures — directionally solid).
- **M&A:** **Acquired Teamer, Club Website and Fixtures Live** (Oct 2018) — consolidated three UK grassroots rivals into the Pitchero Group. ✅ VERIFIED
- **Why it matters:** Proves the **£/mo + transaction-fee** model works in UK grassroots, and proves the market consolidates by acquisition. But it's a *website/admin* tool — no live venue ops, no reception display, no ref view.

### Teamer 🇬🇧 — **Owned by Pitchero** since 2018 (see above). Legacy "who's playing + collect match fees" app, now part of the Group. ✅ VERIFIED

### Stack Sports / Stack Team App / GameDay 🇺🇸
- **Model:** Large youth-sports software roll-up (registration, league/club management, team app).
- **M&A:** **June 2025 — Genstar Capital acquired PlayMetrics and merged it with Stack Sports**, becoming majority owner of the combined youth-sports software leader. ✅ VERIFIED
- **Why it matters:** Confirms PE-driven consolidation at the top end. Big, US-centric, not a direct UK grassroots threat — but shows where successful platforms in this space exit *to*.

### Clubforce 🇮🇪/🇬🇧
- **Model:** Club membership + fundraising + payments.
- **Pricing (paid annually):** **Membership £25/mo · Fundraising £25/mo · Bundle £40/mo** (EUR €25/€25/€35). ✅ VERIFIED
  - Transaction fees charged but **rates not published** ("vary by transaction type"). ✅ VERIFIED (that they're undisclosed)
- **Why it matters:** Cheaper than Pitchero on subscription; membership/fundraising focus. Strong in GAA/Ireland. Another £/mo + opaque-clip player.

### Spawtz 🇬🇧/🇦🇺 (league + venue — overlaps your Venue SKU most)
- **Model:** League & venue management software, **priced per team** on a sliding scale.
- **Pricing:** **£15/team** (0–100 teams) → £12 (101–150) → £10 (151–200) → £7 (201–250) → **£5/team** (250+), quarterly. ✅ VERIFIED (2 verifiers; 1 abstain)
- **Why it matters:** The most direct overlap with the **Venue/league** SKU — a venue running multiple leagues is exactly Spawtz's customer. Per-team pricing is a model to weigh against per-venue.

### LeagueRepublic 🇬🇧
- **Model:** League/competition management.
- **Pricing:** Reportedly a **free tier** + paid bands ~**£13.60 (≤25 teams) / £23.20 (≤100) / £46.40 (≤300) / £68.30 (300+)** per month, plus ~**1% transaction fee** on top of Stripe. ⚠️ UNVERIFIED (verification cut off by session limit — source is their own pricing page, so likely accurate; re-confirm before quoting).
- **Why it matters:** Cheap, league-only, widely used by amateur leagues. A low-cost anchor for the league-management slice.

### Playwaze 🇬🇧 — Community/league platform (sport-governing-body and multi-sport community focus). Thinly sourced in this sweep; ⚠️ pricing not captured. 🧠 Tends to sell to leagues/NGBs rather than individual venues.

### LoveAdmin 🇬🇧 — Membership/admin/payments for clubs and activity providers. Thinly sourced here; Spond itself publishes a "Spond Club vs LoveAdmin" comparison, confirming LoveAdmin is a recognised UK membership-admin competitor. ⚠️ pricing not captured this sweep.

### Pitchbooking 🇬🇧/🇮🇪 — Venue/pitch booking & facility management. Identified as a venue-ops player; ⚠️ pricing not captured (site returned no extractable claims). The clearest *venue-booking* specialist on the list — worth a dedicated follow-up since it overlaps the Venue SKU's booking edge.

---

## B — HOW IN OR OUT FARES

**Coverage map — who does what (✅ = core competence):**

| Capability | Spond | TeamSnap | Heja | Pitchero | Clubforce | Spawtz | LeagueRep | **In or Out** |
|---|---|---|---|---|---|---|---|---|
| Player availability ("in/out") | ✅ | ✅ | ✅ | partial | – | – | – | ✅ |
| Team chat / comms | ✅ | ✅ | ✅ | partial | – | – | – | partial |
| Payments / fee collection | ✅ | ✅ | partial | ✅ | ✅ | partial | partial | ✅ |
| Club membership / admin | ✅ (Club) | – | – | ✅ | ✅ | – | – | ✅ |
| League / competition mgmt | – | partial | – | partial | – | ✅ | ✅ | ✅ |
| Tournament management | – | – | – | – | – | ✅ | partial | ✅ |
| Venue / facility operations | – | – | – | – | – | ✅ | – | ✅ |
| Referee match-day view | – | – | – | – | – | – | – | ✅ |
| Reception / TV display | – | – | – | – | – | – | – | ✅ |
| QR onboarding | – | – | – | – | – | – | – | ✅ |

**Where In or Out is genuinely differentiated:**
- **The full stack across lanes 1–4 in one system.** No competitor combines team app + venue ops + leagues + membership + payments. Spond/Heja stop at the team; Pitchero/Clubforce stop at the club website/admin; Spawtz/LeagueRepublic stop at leagues.
- **Reception/TV display, referee view, QR onboarding — nobody on this list has these.** These are the "money moments" in the pilot demo and are *unique to In or Out* in this set. They make a venue *look elite* — a selling point no competitor offers.
- **Venue as the customer.** The team-app giants sell to coaches/parents; In or Out sells to the venue/club operator, who has budget and a P&L reason to pay. Different, better-monetising buyer.

**Where In or Out is weak or late:**
- **Acquisition scale.** Spond has 1M+ UK MAUs and 3M+ globally; In or Out has two pilots. The free wedge is the right answer but it starts from zero against a free incumbent with a 7-figure UK base.
- **Depth vs specialists.** Spawtz/LeagueRepublic are mature in pure league management; Pitchero/Clubforce in membership/fundraising. In or Out's breadth must not come at the cost of being visibly thinner where a customer already uses a specialist.
- **Team chat/comms** is only partial — Spond/Heja/TeamSnap are strong here and it's a daily-habit hook.
- **Payments maturity & trust.** Competitors have years of Stripe-rail operation; In or Out's payments module is new and unproven at volume.
- **No funding war chest.** Every serious competitor is PE-backed (TeamSnap/Waud, Stack/Genstar) or well-funded (Spond, Heja/Peak). In or Out competes on focus and product breadth, not capital.

**Pricing read-across (what the market will bear):**
- Dual model (**£/mo SaaS + payment clip**) is *proven* — it's exactly Pitchero's and Spond-Club's model. The transaction-fee question in STRATEGY.md is well-supported by the market.
- **Transaction-fee benchmark:** Spond Club 2.5% + £0.20; Pitchero 1.67–2.42% + 15–17p; LeagueRepublic ~1% (⚠️). A clip in the **~1.5–2.5% + ~15–20p** band is market-normal.
- **SaaS benchmark:** Pitchero £38 / £99; Clubforce £25–£40; Spawtz £5–£15/team; LeagueRepublic ~£14–£68. The **Venue SKU** sits naturally around/above Pitchero Standard–Pro (£38–£99) *given it does live ops Pitchero doesn't*; the **Club/Org SKU** sits above that and can scale per-team/per-member like Spawtz.

---

## C — POTENTIAL SCALE

**Market size (third-party analyst estimates — ⚠️ directional, vendors differ widely):**
- The **sports management software** market is generally sized by analysts (Grand View, Mordor, Business Research Insights) in the **high-single-digit to low-double-digit £/$ billions today**, growing low-to-mid **teens % CAGR** into the early 2030s. Exact figures vary by definition and were not individually verified in this sweep — quote as "analysts size the global sports-management software market in the billions, growing double-digit %," not a precise number.
- **Youth sports software** and **sports club management software** are tracked as distinct, fast-growing sub-markets by the same houses.

**Grassroots base (the addressable count):**
- 🧠 The UK alone has tens of thousands of grassroots football clubs and hundreds of thousands of teams (the FA's grassroots strategy 2024–2028 was a source but yielded no extracted figure this sweep). Pitchero's own footprint — **22,000+ clubs, 160,000 teams, 2M+ members** ✅ — is a concrete proxy for the UK/semi-pro addressable base *for a club-website product alone*. Spond's **1M+ UK MAUs** ✅ shows the player-side reach available through a free wedge.
- Add **venues** (the buyer In or Out actually targets) — leisure centres, 5-a-side/pitch operators, multi-pitch clubs — and the operator-side count is smaller but far higher-value-per-account than individual teams.

**What the funding/M&A activity implies about achievable scale:**
- **The space consolidates by acquisition, repeatedly:** Pitchero rolled up Teamer + Club Website + Fixtures Live (2018) ✅; Waud took majority of TeamSnap (2021) ✅; Genstar merged PlayMetrics into Stack Sports (2025) ✅. **PE sees this as a roll-up market.** A focused, differentiated UK platform with real venue/club logos is an *acquisition target*, not just a standalone — that is a credible exit thesis.
- **Spond/Heja prove the free-wedge-to-millions-of-users path** is real in Europe; **Pitchero/Clubforce prove the paid £/mo + clip path** is real in UK grassroots. In or Out's strategy deliberately combines both (free wedge → paid venue/club SKUs + clip), which is coherent with what has actually funded and exited in this market.
- **Realistic ceiling framing:** the giants (Spond, TeamSnap, Stack) are 7–8 figure-user, PE-backed platforms. In or Out's *near-term* realistic scale is **regional venue/club density** (win a city/region's venues and their leagues), with the *long-term* upside being either (a) a UK-wide venue+league platform à la Pitchero's club base, or (b) acquisition by a consolidator wanting the venue-ops + live-display layer none of them have built.

---

## FOLLOW-UPS OWED (verification cut off by session limit ~2:40pm)
- Re-verify **TeamSnap** exact 2026 pricing + payment fee (currently ⚠️).
- Re-verify **LeagueRepublic** free tier + band pricing + 1% fee (currently ⚠️).
- Confirm **Heja ↔ Sportradar** ownership question (verified investor = Peak Capital only).
- Capture **LoveAdmin, Playwaze, Pitchbooking** pricing (thinly sourced).
- Pin a **defensible TAM number** with a single cited analyst report if a precise figure is ever needed for a deck.

## KEY SOURCES
- Spond fees: help.spond.com/club/.../58192 · Spond MAUs: spond.com/news-and-blog/spond-3-million-monthly-active-users
- Pitchero pricing: pitchero.com/pricing · Pitchero acquisitions: blog.pitchero.com/pitchero-acquires-teamer-0
- Clubforce pricing: clubforce.com/pricing-nextgen
- Heja funding/scale: peak.capital/heja-raises-investment-peak-capital
- TeamSnap/Waud: teamsnap.com/company/press-releases/teamsnap-partners-with-waud-capital · prnewswire.com/.../waud-capital-completes-growth-capital-partnership-with-teamsnap
- Stack/PlayMetrics/Genstar: gencap.com/playmetrics-and-stack-sports-combine
- Spawtz pricing: spawtz.com/Products/League%20and%20Management%20Software/Price
- LeagueRepublic: leaguerepublic.com/pricing.html (⚠️)
- Market size: grandviewresearch.com, mordorintelligence.com, businessresearchinsights.com (sports management / youth sports / club management software reports)
