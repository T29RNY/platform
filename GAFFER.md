# Ask the Gaffer — AI Agent Layer

*Last updated: May 23 2026 (session 33 — migrations 033–037 applied + smoke-tested; awaiting Anthropic key confirm + UI wire-up)*

This file is the operating spec for Ask the Gaffer. It consolidates the
positioning from `DECISIONS.md` and the architecture from
`venue_league_hq_SCOPE.md` Phase 7 into one source of truth. Read this
file in full before any Gaffer work.

---

## POSITIONING

Ask the Gaffer is **the AI agent layer for the entire In or Out platform**
(and future Venue/HQ products). Not a chatbot. Not a generic LLM wrapper.

- **Grounded, not generative.** Every output is backed by a specific
  Supabase query result. The LLM narrates and patterns — it never
  invents facts.
- **Football-operations agent.** Feel: "a smart assistant for the
  organiser who already knows the squad." Tone: knowledgeable football
  observer, not corporate.
- **Trust-graduated.** Four phases, each unlocked only after the prior
  one is proven in production. No phase skips.
- **Admin-approval gate.** Anything visible to players requires admin
  approval, even in Phase 4. Hard rule.

---

## ARCHITECTURE

### Principle: query → context → LLM → audit

```
  Supabase RPC          edge function           Claude API
  (gaffer_get_*)   →    /api/gaffer       →     (sonnet-4-6)
       │                     │                       │
       │                     │                       │
       ▼                     ▼                       ▼
  ai_briefings.        ai_briefings.            ai_briefings.
  context_snapshot     prompt_key               content
                       (system prompt id)       tokens_used
```

Every claim the LLM makes is traceable to `context_snapshot`. The snapshot
is jsonb, immutable, queryable. Audit is built in.

### LLM provider — Vercel AI Gateway → Anthropic

**Provider:** Vercel AI Gateway, routing to Anthropic `claude-sonnet-4-6`.

**Why AI Gateway and not direct Anthropic SDK:**
- Single bill on Vercel — no new vendor onboarding.
- Provider failover built in (if Anthropic is down, fall back to OpenAI
  for non-critical outputs like Opposition Intel narrative). Critical
  outputs (pre-match briefing) hold for Anthropic.
- Per-route cost tracking surfaces in Vercel dashboard alongside
  function invocation cost.
- Swappable provider config without code change — useful if a cheaper
  model lands mid-season.

**Why Sonnet 4.6 and not Opus or Haiku:**
- Opus: overkill for 150–200 word briefings, ~3× the cost.
- Haiku: cheaper but factuality on grounded-data tasks is noticeably
  weaker. Worth the Sonnet premium for "never fabricate stats."
- Sonnet 4.6 hits the cost/quality sweet spot for everything spec'd
  here (1000-token briefings, 2000-token HQ digests).

**Token budget per output:**
- Player matchday briefing: 2000 input + 500 output ≈ £0.004
- Post-match summary: 1500 input + 400 output ≈ £0.003
- HQ weekly digest: 5000 input + 1000 output ≈ £0.010
- Negligible at current scale. £20/month covers ~5000 briefings.

**No tool use in initial build.** Pure text generation from pre-computed
context. Tool use is a Phase 3+ option (when the agent moves from
"recommend" to "act").

### Data access pattern — Gaffer RPCs

All context assembly happens server-side via dedicated
`gaffer_get_context_*` RPCs. The edge function does **not** assemble
context from raw table reads. This keeps the data-access pattern:
- Auditable — one RPC per Gaffer surface, version-pinnable.
- RLS-safe — each RPC is `SECURITY DEFINER`, derives team scope from
  `p_admin_token` per the RLS checklist.
- Cheap to evolve — adding a new field to a briefing means editing
  one RPC, not editing the edge function.

**Phase 1 RPCs (to be built when implementation starts):**
- `gaffer_get_team_summary(p_admin_token)` — squad size, this-week status
  breakdown, last 3 results, top scorer, attendance trend.
- `gaffer_get_payment_summary(p_admin_token)` — outstanding ledger,
  oldest debt, top owers, last week's collected total.
- `gaffer_get_attendance_risk(p_admin_token)` — players whose reliability
  has dropped in the last 4 weeks, players who haven't responded yet
  this week, cover pool depth vs squad shortfall.
- `gaffer_get_matchday_briefing(p_admin_token)` — confirmed squad,
  predicted teams, last meeting vs same opponents (if any), POTM
  contender, last goal scorer, weather/venue notes (if available).

Each RPC returns a single jsonb object. The edge function passes that
object verbatim into the system prompt as `<context>...</context>`.

### Storage — `ai_briefings` table

```sql
ai_briefings (
  id uuid PK DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES teams(id),
  audience text NOT NULL CHECK (audience IN ('admin','player','hq')),
  surface text NOT NULL,
    -- 'team_summary' | 'payment_summary' | 'attendance_risk'
    -- | 'matchday_briefing' | 'post_match_summary'
    -- | 'opposition_intel' | 'hq_weekly_digest'
  match_id text REFERENCES matches(match_id) NULL,
  player_id uuid REFERENCES players(id) NULL,
  content text NOT NULL,
  context_snapshot jsonb NOT NULL,
  prompt_key text NOT NULL,        -- versioned system prompt id
  model text NOT NULL,             -- e.g. 'claude-sonnet-4-6'
  tokens_in integer NOT NULL,
  tokens_out integer NOT NULL,
  cost_pence numeric(10,4) NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
)

CREATE INDEX ai_briefings_team_surface_idx
  ON ai_briefings(team_id, surface, generated_at DESC);
```

RLS:
- Admins read their own team's briefings.
- Players read only briefings where `audience='player'` AND
  `player_id` matches their token's player.
- HQ reads all `audience='hq'` rows for companies they admin.

### Runtime — Vercel edge function

`apps/inorout/api/gaffer.js` (Vercel Edge Runtime).

Inputs: `{ adminToken, surface, params? }`
Steps:
1. Verify `adminToken` resolves to a `team_admins` row (else 401).
2. Call the matching `gaffer_get_context_<surface>` RPC.
3. Resolve system prompt by `surface` (versioned strings in
   `apps/inorout/src/views/Gaffer/prompts/<surface>.js`).
4. Call Vercel AI Gateway with model `claude-sonnet-4-6`, prompt +
   context.
5. Insert `ai_briefings` row.
6. Return `{ content, briefingId, cachedAt }`.

Caching policy:
- `team_summary`, `payment_summary`, `attendance_risk`: 30-minute TTL
  per team per surface. Return cached on subsequent reads within window.
- `matchday_briefing`: invalidate on any of: squad confirmed, status
  change, schedule change. Otherwise 6-hour TTL.
- `post_match_summary`: never regenerate (immutable after first write).
- `opposition_intel`: never regenerate per fixture.

Cache key: `(team_id, surface, match_id?, last_invalidator_ts)`.

---

## FOUR-PHASE ROLLOUT

### Phase 1 — Read-only assistant

**Sequenced after:** Group Balancer (done, session 30).

**Surface area:**
- Ask the Gaffer Q&A panel in AdminView (replaces the disabled
  `Gaffer/index.jsx` chatbot scaffold).
- Team summary card on admin home (auto-refreshed pre-game day).
- Payment summary card on PaymentsScreen header.
- Attendance risk banner on AdminView when squad shortfall detected.
- Matchday briefing modal (admin opens on demand on match day).

**No actions taken.** All output is text only.

**Exit criteria for Phase 1:**
- 4 weeks of production use across ≥ 3 real teams.
- < 1% factual error rate (audited against `context_snapshot`).
- Admin satisfaction signal (PostHog event `gaffer_briefing_useful`
  > 60% positive).

### Phase 2 — Recommendations

**Surface area additions:**
- Fair team suggestions (calls `generateBalancedTeams` from Group
  Balancer engine, returns draft Group 1 / Group 2 as a recommendation).
- Reserve recommendations (rank cover pool by recent reliability vs
  current squad shortfall).
- Payment chase drafts (per-player WhatsApp message text, admin copies
  manually — no send).
- Weekly match summary draft (admin reviews, posts to group chat).
- Player insight explanations ("Why is Hassan flagged as priority?"
  → narrate the underlying stats).

**Still no writes from the agent.** Drafts only.

### Phase 3 — Confirmed actions

**Surface area additions:**
- "Send chase" — admin one-tap approval, fires existing payment
  notification RPC.
- "Notify reserves" — fires push notification to cover pool.
- "Use these teams" — confirms the suggested split via
  `admin_confirm_teams`.
- "Post match summary" — writes to a notifications table for player
  view consumption.
- "Confirm payment reminders" — bulk-mark reminders sent.

**All writes via existing SECURITY DEFINER RPCs.** No new direct-write
paths for the agent. Auth via `adminToken`.

### Phase 4 — Semi-autonomous

**Surface area additions:**
- Auto-detect short squads on match day morning, draft a reserve
  notification, push to admin for one-tap approval.
- Auto-suggest reserve pings when reliability slope crosses threshold.
- Auto-produce weekly admin report (delivered Monday 7am).
- Anomaly detection: dropout-profile teams, low attendance patterns,
  ref no-shows (Venue/HQ products).

**Player-visible actions still require admin approval.** Hard rule
unchanged.

---

## SURFACES — DETAILED (Phase 1)

### 1. Team summary (admin home)

**Trigger:** Auto-refresh on admin home open, 30-min cache.
**Length:** 60–80 words.
**System prompt:** `prompts/team_summary.js`.

Example output:
> Squad is 12 confirmed for Tuesday, two short of a full 14. Hassan,
> Jordan and Mike haven't responded yet — Hassan was last to respond
> the last three weeks too. Form is W-L-W over the last three games.
> Top scorer this month is Dave with 4 goals. Cover pool has 6 players
> available; only Vinny has played for you before.

### 2. Payment summary (PaymentsScreen)

**Trigger:** Auto-refresh on PaymentsScreen open, 30-min cache.
**Length:** 50–70 words.
**System prompt:** `prompts/payment_summary.js`.

Example output:
> £36 outstanding across 6 players. Oldest debt is Jordan at 3 weeks
> (£18). Last week you collected £84 of £90 owed — best collection rate
> in 4 weeks. Two players (Dave, Hassan) have paid every week this
> season.

### 3. Attendance risk (AdminView banner)

**Trigger:** Render when `gaffer_get_attendance_risk` returns
`risk_level >= 'medium'`. Refresh every page load.
**Length:** 30–50 words.

Example output:
> Squad is short by 2 with 18 hours to kickoff. Three regulars
> (Jordan, Mike, Liam) have averaged 2 reliability points below their
> season norm over the last 3 weeks. Worth a direct nudge.

### 4. Matchday briefing (admin modal)

**Trigger:** Admin taps "Matchday briefing" button on match day. Hard
TTL 6 hours; invalidates on squad confirm.
**Length:** 150–200 words.

Example output:
> 14 confirmed for tonight, full squad. Smart Teams split predicts
> a draw — both sides at 52% expected win rate. Hassan and Jordan
> together on Team A is unusual; they've started apart in the last
> 8 games with a 75% win rate. Last week's POTM Dave is on Team B
> with three of last month's goal scorers — favour Team B if the
> Smart Teams confidence drops. Bibs go to Liam this week per
> rotation. Pitch booking confirmed via cron at 18:00.

### 5. Q&A panel (AdminView Gaffer tab)

**Trigger:** Admin opens Gaffer tab, types a question.
**Length:** 80–120 words.

Questions in scope:
- "Who's our most reliable player this month?"
- "When did we last play three good games in a row?"
- "Which player has improved the most this season?"
- "Who normally pays late?"

The Q&A panel calls a generalised `gaffer_qa` edge function that:
1. Classifies the question into a known intent (or rejects gracefully
   with "I can only answer questions about your team's data").
2. Calls the matching context RPC.
3. Returns narrated answer with the underlying stat row inline as a
   "show source" expandable.

---

## SYSTEM PROMPT — SHARED BASE

```
You are Ask the Gaffer, the football-operations assistant for a casual
weekly football team using In or Out. You are speaking to the team's
admin (the "manager"). Your data is everything the team has logged
in the app: match results, player attendance, payments, bibs, POTM
votes.

Rules:
1. Never fabricate a statistic. Every claim must be backed by the
   <context> block. If the data does not say it, do not say it.
2. If the data is sparse, acknowledge it. Better to say "we only have
   3 games to go on" than to extrapolate.
3. Tone: knowledgeable football observer, not corporate. Direct,
   specific, no hedging. UK English.
4. Format: flowing paragraphs. Never use bullet points unless the
   surface explicitly requests them.
5. Address the admin by their team name in long-form surfaces,
   never by their personal name.
6. Use UK football vocabulary: "fixture" not "game", "kickoff" not
   "start time", "POTM" not "MVP", "bibs" not "vests".
7. Round percentages to whole numbers in narrative; show one decimal
   only when the difference is < 1%.

The <context> block contains pre-computed team data. Use only the
fields present. Do not invent fields.
```

Per-surface prompts extend this base with their own length cap,
example output, and any surface-specific phrasing rules. All prompts
live in `apps/inorout/src/views/Gaffer/prompts/`.

---

## IMPLEMENTATION STATUS

**Built and committed (session 33):**
- ✅ Migration 033 — `ai_briefings` table + RLS policies.
- ✅ Migrations 034–037 — all four Phase 1 context RPCs
  (`gaffer_get_context_team_summary`, `_payment_summary`,
  `_attendance_risk`, `_matchday_briefing`).
- ✅ Edge function — `apps/inorout/api/gaffer.js`, multi-surface routing,
  cache check, Anthropic call, `ai_briefings` insert, cost tracking.
- ✅ Surface system prompts — `apps/inorout/src/views/Gaffer/prompts/`
  for all five surfaces (team_summary, payment_summary, attendance_risk,
  matchday_briefing, qa).
- ✅ JS wrappers — `getGafferBriefing(adminToken, surface, opts?)` and
  `askGafferQuestion(adminToken, question, opts?)` in supabase.js +
  barrel export.
- ✅ UI components — `<GafferCard surface=... adminToken=... />` reusable
  inline card; new `Gaffer/index.jsx` admin Q&A panel (replaces archived
  player-facing chatbot scaffold, kept as `_archived_chatbot.jsx`).
- ✅ Docs — SCHEMA, RPCS, FEATURES, CLAUDE, CONTEXT updated.

**Applied to live DB (session 33, via Supabase MCP):**
- ✅ Migration 033 — `ai_briefings` table + RLS.
- ✅ Migrations 034–037 — all four context RPCs.
- ✅ Schema cache reloaded (`pg_notify('pgrst','reload schema')`).
- ✅ Smoke-tested against `team_demo` — all four RPCs return
  well-shaped jsonb with real data (schedule, recent form, top
  scorer last 30d = Dave 4g; in-form: Hassan 7g, Dave 6g; payment
  ledger; attendance risk classification).
- ⚠️ One in-flight fix: original migration files used
  `row_to_jsonb` (non-existent function) — caught in smoke test,
  patched to `to_jsonb` via MCP, migration files synced to match
  (commit `50131c2`).

**Still blocked on the user (last two steps before live):**
1. **Confirm `ANTHROPIC_API_KEY` is set on Vercel.** The previous
   chatbot scaffold used this same env var. If it was removed when
   the chatbot was disabled, re-add it from console.anthropic.com.
2. **Wire the canary surface into AdminView.** One cycle:
   flip `ENABLE_GAFFER` to `true`, drop
   `<GafferCard surface="team_summary" adminToken={...} />` onto the
   admin home, ship to one team (set `GAFFER_ENABLED_TEAMS` env to
   gate). Audit `ai_briefings.content` vs `context_snapshot` for a
   week before rolling out the next surface.

**Canary plan (per surface, per team):**
- 1 week of team_finbars use of one surface
- Audit `ai_briefings.content` rows against `context_snapshot` for
  factual fidelity (the snapshot is the ground truth)
- If clean → enable for second team, then roll out next surface
- No mass enable. Per-surface, per-team graduation.

## FUTURE — VERCEL AI GATEWAY MIGRATION

Current edge function calls Anthropic API directly (`api.anthropic.com/v1/messages`)
matching the existing pattern. Migrating to Vercel AI Gateway is a one-file change
(edge function only) once any of the following triggers:
- Cost visibility: AI Gateway dashboard surfaces per-route token spend.
- Failover: AI Gateway can route non-critical surfaces (opposition_intel,
  team_summary) to a cheaper fallback if Anthropic is degraded.
- Multi-provider: if we want to test Haiku for cheaper surfaces or compare
  with OpenAI's GPT-4o-mini, Gateway swaps the provider without API rewrites.

No urgency at current scale.

---

## OPEN QUESTIONS

- Should we cache LLM responses across teams (e.g. if two teams ask
  the same Q&A pattern)? Probably not — context is team-specific and
  cache hit rate would be ~zero. Revisit at Phase 3.
- Should HQ digest be a separate model run from team digest, or
  aggregate team digests? Lean separate: HQ is a different audience
  with different tone needs.
- Voice input for Q&A? Defer to Phase 2 after the text-input UX is
  proven.

---

## REFERENCES

- `DECISIONS.md` — original positioning decision (kept verbatim).
- `venue_league_hq_SCOPE.md` Phase 7 — full Venue/HQ AI layer spec.
- `FEATURES.md` — phase tracker (Gaffer rows).
- `packages/core/engine/groupBalancer.js` — `generateBalancedTeams`
  function reused by Phase 2 fair-team suggestions.
- Vercel AI Gateway docs: https://vercel.com/docs/ai-gateway
- Anthropic Claude API: https://docs.anthropic.com/
