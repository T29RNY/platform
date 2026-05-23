# In or Out — Full Platform Scope
## From Team Organiser to Football Operations Platform
*Scoped: May 23 2026*

---

## DOCUMENT PURPOSE

This document is the complete, methodical scope for building In or Out
into a full football operations platform. It covers every feature, every
data model change, every RPC, every route, every UI screen, and every
build phase required to go from the current team organiser app to a
commercially deployable platform serving players, team admins, venue
operators, league administrators, referees, HQ executives, and the
general public.

It is structured as a phased build plan. Each phase has a clear output,
clear acceptance criteria, and clear dependencies. Nothing in Phase N
assumes Phase N+1 is built.

---

## PLATFORM OVERVIEW

### The hierarchy

```
Company HQ (Goals, Powerleague, independent chain)
  └── Venue (Goals Manchester, Powerleague Leeds)
        └── League (Tuesday Mens Div 1, Wednesday Mixed)
              └── Season (2026 Autumn, 2027 Spring)
                    └── Fixture (Team A vs Team B, Week 4)
                          └── Match Events (Goals, Cards, Subs)
                    └── Cup (Tuesday Cup 2026)
                          └── Round (Quarter Final)
                                └── Fixture
        └── Pitch (Pitch 1, Pitch 2, Pitch 3)
        └── Referee Pool
Team (In or Out squad — Friends or Competitive)
  └── Player (career spans multiple teams)
```

### The access roles

| Role | Access | Auth method |
|---|---|---|
| Player | Own stats, fixtures, league table, squad | Token link or authenticated |
| Team Admin | Squad management, availability, payments | Token link or authenticated |
| Referee | Single fixture, both squads, event entry | Ref token link |
| League Admin | Fixtures, results, standings for their league | Token or authenticated |
| Venue Admin | All leagues at their venue, pitches, refs | Authenticated |
| Company Admin | All venues in their company, HQ dashboard | Authenticated (@domain SSO) |
| Platform Admin | Everything (Tarny only) | Authenticated |
| Public | League tables, fixtures, results (read only) | Display token or public URL |

### The two game types (unchanged from existing)

**Casual** — internal squad games, kickabouts, no opponent
**Competitive** — league fixtures, cup ties, against an opponent

All existing In or Out features continue unchanged for Casual games.
Competitive mode adds the league/fixture/opponent layer.

---

## PHASE 0 — FOUNDATION CHANGES TO EXISTING APP

*Prerequisite for everything. Must complete before any Phase 1 work.*
*Estimated: 5 days*

### 0A — Generic labels and configuration layer

Replace all hardcoded context-specific text with a configuration system.

**New table: `league_config`**
```sql
league_config (
  id uuid PK,
  league_id text REFERENCES leagues(id),
  game_label text DEFAULT 'Game',
  squad_label text DEFAULT 'Squad',
  fixture_label text DEFAULT 'Fixture',
  availability_label text DEFAULT 'Availability',
  standings_label text DEFAULT 'Standings',
  appearances_label text DEFAULT 'Appearances',
  potg_label text DEFAULT 'Player of the Game',
  match_duration_mins integer DEFAULT 40,
  has_halves boolean DEFAULT false,
  half_duration_mins integer NULL,
  has_sin_bin boolean DEFAULT false,
  sin_bin_mins integer NULL,
  card_types text[] DEFAULT '{yellow,red}',
  points_win integer DEFAULT 3,
  points_draw integer DEFAULT 1,
  points_loss integer DEFAULT 0,
  tiebreaker_order text[] DEFAULT '{goal_difference,goals_scored,head_to_head,playoff}',
  teamsheet_required boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
)
```

**New hook: `useLeagueConfig(leagueId)`**
Returns label and config object. All UI components read labels
from this hook. Never hardcoded strings.

**Format presets (applied at league creation):**
- `5-a-side` — 40 min, no halves, yellow/red, no teamsheet
- `7-a-side` — 50 min, no halves, yellow/red, no teamsheet  
- `11-a-side` — 90 min, halves 45 min, yellow/red, teamsheet required
- `futsal` — 40 min, halves 20 min, yellow/red/blue, sin bin 2 min
- `walking_football` — 60 min, halves 30 min, yellow only, no sin bin
- `custom` — all fields manual

### 0B — Casual vs Competitive split throughout app

**`matches.match_type`** — add column: `'casual' | 'competitive'`
All existing matches backfilled as `'casual'`.

**Stats views** — add three-tab selector everywhere stats appear:
`Casual | Competitive | All`

Affects:
- Player hero card (goals, wins, form strip)
- IO Intelligence (all cards filter by context)
- Stats view / league table
- Results / History view
- Head to Head (Competitive only — opponent context required)
- Career stats in player profile

**Implementation:**
- App-level state: `statsContext: 'casual' | 'competitive' | 'all'`
- Persistent in localStorage per user
- All stat-bearing components read from context
- League button greyed with tooltip if no competitive games exist
- Casual button greyed with tooltip if no casual games exist

### 0C — Team type selection at creation

**`teams.team_type`** — add column: `'casual' | 'competitive'`

At team creation, second screen asks:
*"What kind of team is this?"*

- **Casual** — Friends game, internal kickabout, no league
- **Competitive** — League team, fixtures against opponents

Casual teams: existing flow unchanged.
Competitive teams: additional step asks for league context (search
for venue/league or create pending entry).

Competitive teams hide: Plus One, per-game cash payments (replaced
by season fee model), internal team balancer.

Competitive teams show: Fixture schedule, opponent stats, teamsheet,
league standings, pre-match briefing.

### 0D — Player career cross-context

**`player_match.match_type`** — add column mirroring match type.

**`player_career` sync** — Phase 2 Tech Debt item (BUGS.md #2).
Build the sync job now as part of this foundation work.
`player_career` gets split columns:
- `casual_games`, `casual_goals`, `casual_wins` etc.
- `competitive_games`, `competitive_goals`, `competitive_wins` etc.
- `total_games`, `total_goals`, `total_wins` etc. (combined)

### 0E — Notification channel abstraction

Replace direct push notification calls with a unified
notification service that routes to the correct channel:

```javascript
// packages/core/notifications/notify.js
sendNotification({
  recipient: { playerId, token, phone, email },
  channel: 'push' | 'whatsapp' | 'sms' | 'email',
  template: 'fixture_reminder' | 'ref_assignment' | 'result' | ...,
  data: { ... }
})
```

**Twilio integration:**
- `TWILIO_ACCOUNT_SID` env var
- `TWILIO_AUTH_TOKEN` env var  
- `TWILIO_FROM_NUMBER` env var (SMS)
- `TWILIO_WHATSAPP_FROM` env var (WhatsApp Business number)

WhatsApp as primary channel for refs and venue admins.
SMS as fallback.
Push as primary for players.
Email for HQ digests and billing.

**Message templates (pre-approved Meta format for WhatsApp):**
- `ref_assignment` — "Hi {name}, you're assigned to {fixture} on {date} at {venue}, Pitch {pitch}. Open your ref view: {link}"
- `fixture_reminder` — "Reminder: {team} vs {opponent} tonight at {time}, Pitch {pitch}, {venue}"
- `result_confirmed` — "{team_a} {score_a} - {score_b} {team_b}. Full time confirmed."
- `squad_availability` — "Who's in for {fixture}? Confirm here: {link}"

### 0F — Domain-matched SSO

**New table: `company_domains`**
```sql
company_domains (
  id uuid PK,
  company_id text REFERENCES companies(id),
  domain text UNIQUE NOT NULL, -- e.g. 'goals.com'
  created_at timestamptz
)
```

On Google OAuth callback, extract email domain.
Check against `company_domains`.
If match found, auto-assign company admin role for that company.

Future SAML support: `company_domains.saml_config jsonb NULL`
— adds enterprise SSO without restructuring auth.

**New function in AuthCallback.jsx:**
```javascript
async function resolveCompanyFromEmail(email) {
  const domain = email.split('@')[1]
  const { data } = await supabase.rpc('get_company_by_domain', { p_domain: domain })
  return data // { company_id, company_name } or null
}
```

---

## PHASE 1 — CORE DATA MODEL

*Build the schema before any UI. All Phase 2+ work depends on this.*
*Estimated: 4 days*

### New tables

**`companies`**
```sql
companies (
  id text PK, -- e.g. 'company_goals', 'company_powerleague'
  name text NOT NULL,
  slug text UNIQUE, -- for URL routing
  logo_url text,
  primary_colour text, -- hex, for white-labelling
  secondary_colour text,
  contact_email text,
  contact_phone text,
  active boolean DEFAULT true,
  trial_ends_at timestamptz NULL,
  subscription_status text DEFAULT 'trial'
    CHECK IN ('trial', 'active', 'past_due', 'cancelled'),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz DEFAULT now()
)
```

**`company_admins`**
```sql
company_admins (
  id uuid PK DEFAULT gen_random_uuid(),
  company_id text REFERENCES companies(id),
  user_id uuid REFERENCES auth.users(id),
  role text CHECK IN ('super_admin', 'regional_admin', 'analyst'),
  region text NULL, -- for regional_admin scoping
  granted_by uuid NULL,
  created_at timestamptz DEFAULT now()
)
```

**`venues`**
```sql
venues (
  id text PK, -- e.g. 'venue_goals_manchester'
  company_id text REFERENCES companies(id) NULL, -- null = independent
  name text NOT NULL,
  slug text UNIQUE,
  address text,
  city text,
  postcode text,
  lat numeric(9,6),
  lng numeric(9,6),
  logo_url text,
  primary_colour text,
  secondary_colour text,
  contact_email text,
  contact_phone text,
  venue_admin_token text UNIQUE DEFAULT gen_random_uuid()::text,
  display_pin text, -- 4-digit PIN for reception display
  active boolean DEFAULT true,
  trial_ends_at timestamptz,
  subscription_status text DEFAULT 'trial'
    CHECK IN ('trial', 'active', 'past_due', 'cancelled'),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz DEFAULT now()
)
```

**`venue_admins`**
```sql
venue_admins (
  id uuid PK DEFAULT gen_random_uuid(),
  venue_id text REFERENCES venues(id),
  user_id uuid REFERENCES auth.users(id),
  role text DEFAULT 'admin' CHECK IN ('admin', 'staff'),
  created_at timestamptz DEFAULT now(),
  UNIQUE (venue_id, user_id)
)
```

**`pitches`**
```sql
pitches (
  id uuid PK DEFAULT gen_random_uuid(),
  venue_id text REFERENCES venues(id),
  name text NOT NULL, -- 'Pitch 1', 'The Arena' etc
  surface text, -- 'astroturf', '3g', 'indoor', 'grass'
  capacity integer, -- max players per side
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
)
```

**`referees`**
```sql
referees (
  id uuid PK DEFAULT gen_random_uuid(),
  venue_id text REFERENCES venues(id),
  name text NOT NULL,
  phone text,
  email text,
  whatsapp_number text,
  preferred_channel text DEFAULT 'whatsapp'
    CHECK IN ('whatsapp', 'sms', 'email', 'push'),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
)
```

**`leagues`**
```sql
leagues (
  id text PK, -- e.g. 'league_goals_mcr_tue_mens_div1'
  venue_id text REFERENCES venues(id),
  name text NOT NULL, -- 'Tuesday Mens Division 1'
  short_name text, -- 'Tue Mens D1'
  format text CHECK IN ('5-a-side','7-a-side','11-a-side',
                        'futsal','walking_football','custom'),
  day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6),
  default_kickoff_time time,
  default_pitch_id uuid REFERENCES pitches(id) NULL,
  league_admin_token text UNIQUE DEFAULT gen_random_uuid()::text,
  display_token text UNIQUE DEFAULT gen_random_uuid()::text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
)
```

**`seasons`**
```sql
seasons (
  id uuid PK DEFAULT gen_random_uuid(),
  league_id text REFERENCES leagues(id),
  name text NOT NULL, -- '2026 Autumn'
  start_date date NOT NULL,
  end_date date NOT NULL,
  num_weeks integer NOT NULL,
  status text DEFAULT 'setup'
    CHECK IN ('setup','active','completed','archived'),
  created_at timestamptz DEFAULT now()
)
```

**`competitions`**
```sql
competitions (
  id uuid PK DEFAULT gen_random_uuid(),
  season_id uuid REFERENCES seasons(id),
  name text NOT NULL, -- 'Division 1 League', 'Tuesday Cup'
  type text NOT NULL CHECK IN ('league','cup','playoff'),
  format text CHECK IN ('round_robin','single_elimination',
                        'double_elimination','group_stage'),
  status text DEFAULT 'setup'
    CHECK IN ('setup','active','completed'),
  created_at timestamptz DEFAULT now()
)
```

**`clubs`**
```sql
clubs (
  id text PK, -- e.g. 'club_riverside_athletic'
  name text NOT NULL,
  short_name text,
  founded_year integer NULL,
  created_at timestamptz DEFAULT now()
)
```

**`club_teams`**
```sql
club_teams (
  id uuid PK DEFAULT gen_random_uuid(),
  club_id text REFERENCES clubs(id),
  team_id text REFERENCES teams(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (team_id) -- one team belongs to one club
)
```

**`competition_teams`**
```sql
competition_teams (
  id uuid PK DEFAULT gen_random_uuid(),
  competition_id uuid REFERENCES competitions(id),
  team_id text REFERENCES teams(id),
  registered_at timestamptz DEFAULT now(),
  status text DEFAULT 'active'
    CHECK IN ('active','withdrawn','expelled'),
  withdrawal_reason text NULL,
  UNIQUE (competition_id, team_id)
)
```

**`team_name_history`**
```sql
team_name_history (
  id uuid PK DEFAULT gen_random_uuid(),
  team_id text REFERENCES teams(id),
  name text NOT NULL,
  effective_from_season_id uuid REFERENCES seasons(id),
  effective_to_season_id uuid REFERENCES seasons(id) NULL,
  changed_by uuid NULL,
  approved_by uuid NULL,
  change_reason text NULL,
  created_at timestamptz DEFAULT now()
)
```

**`fixtures`**
```sql
fixtures (
  id uuid PK DEFAULT gen_random_uuid(),
  competition_id uuid REFERENCES competitions(id),
  home_team_id text REFERENCES teams(id),
  away_team_id text REFERENCES teams(id) NULL, -- null = bye
  week_number integer NOT NULL,
  round_name text NULL, -- 'Quarter Final', 'Semi Final' etc
  scheduled_date date,
  kickoff_time time,
  pitch_id uuid REFERENCES pitches(id) NULL,
  referee_id uuid REFERENCES referees(id) NULL,
  ref_token text UNIQUE DEFAULT gen_random_uuid()::text,
  status text DEFAULT 'scheduled'
    CHECK IN ('scheduled','allocated','in_progress',
              'completed','postponed','void','walkover'),
  walkover_winner_id text REFERENCES teams(id) NULL,
  postpone_reason text NULL,
  void_reason text NULL,
  home_score integer NULL,
  away_score integer NULL,
  created_at timestamptz DEFAULT now()
)
```

**`match_events`**
```sql
match_events (
  id uuid PK DEFAULT gen_random_uuid(),
  fixture_id uuid REFERENCES fixtures(id),
  team_id text REFERENCES teams(id),
  player_id text REFERENCES players(id) NULL,
  player_name_override text NULL, -- for unregistered/guest scorers
  event_type text NOT NULL
    CHECK IN ('goal','own_goal','yellow_card','red_card',
              'blue_card','sin_bin','substitution_on',
              'substitution_off','penalty_scored','penalty_missed'),
  minute integer NOT NULL,
  period text NOT NULL CHECK IN ('first','second','extra_time','penalties'),
  sub_player_on_id text REFERENCES players(id) NULL,
  sub_player_off_id text REFERENCES players(id) NULL,
  recorded_by_token text NOT NULL, -- ref_token or admin_token
  recorded_by_type text CHECK IN ('referee','team_admin','system'),
  synced_at timestamptz NULL, -- null = recorded offline, not yet synced
  local_timestamp timestamptz NOT NULL, -- device time when recorded
  created_at timestamptz DEFAULT now()
)
```

**`league_standings`** (computed view, not a table)
```sql
CREATE VIEW league_standings AS
SELECT
  ct.competition_id,
  ct.team_id,
  COUNT(CASE WHEN f.status = 'completed' AND
    (f.home_team_id = ct.team_id OR f.away_team_id = ct.team_id)
    THEN 1 END) AS played,
  -- wins, draws, losses, GF, GA, GD, points computed from fixtures
  -- full SQL in migration file
```

**`cup_rounds`**
```sql
cup_rounds (
  id uuid PK DEFAULT gen_random_uuid(),
  competition_id uuid REFERENCES competitions(id),
  round_number integer NOT NULL,
  round_name text NOT NULL, -- 'Round of 16', 'Quarter Final' etc
  num_teams integer NOT NULL,
  status text DEFAULT 'pending'
    CHECK IN ('pending','active','completed'),
  created_at timestamptz DEFAULT now()
)
```

**`player_registrations`**
```sql
player_registrations (
  id uuid PK DEFAULT gen_random_uuid(),
  player_id text REFERENCES players(id),
  competition_id uuid REFERENCES competitions(id),
  team_id text REFERENCES teams(id),
  registration_number text NULL, -- FA registration number if applicable
  registered_at timestamptz DEFAULT now(),
  status text DEFAULT 'active'
    CHECK IN ('active','suspended','ineligible'),
  suspension_until date NULL,
  suspension_reason text NULL,
  UNIQUE (player_id, competition_id) -- one registration per competition
)
```

**`incidents`**
```sql
incidents (
  id uuid PK DEFAULT gen_random_uuid(),
  venue_id text REFERENCES venues(id),
  fixture_id uuid REFERENCES fixtures(id) NULL,
  reported_by uuid NOT NULL,
  description text NOT NULL,
  severity text CHECK IN ('info','warning','critical'),
  resolved_at timestamptz NULL,
  resolved_by uuid NULL,
  resolution_note text NULL,
  created_at timestamptz DEFAULT now()
)
```

**`hq_preview_tokens`**
```sql
hq_preview_tokens (
  id uuid PK DEFAULT gen_random_uuid(),
  company_id text REFERENCES companies(id),
  token text UNIQUE DEFAULT gen_random_uuid()::text,
  generated_by uuid NOT NULL,
  expires_at timestamptz NOT NULL, -- now() + 7 days
  accessed_at timestamptz NULL,
  created_at timestamptz DEFAULT now()
)
```

**`billing_events`**
```sql
billing_events (
  id uuid PK DEFAULT gen_random_uuid(),
  entity_type text CHECK IN ('venue','company'),
  entity_id text NOT NULL,
  event_type text, -- 'trial_started','trial_ended','payment_succeeded' etc
  stripe_event_id text,
  amount_pence integer NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
)
```

### Additions to existing tables

```sql
-- teams
ALTER TABLE teams ADD COLUMN team_type text DEFAULT 'casual'
  CHECK (team_type IN ('casual','competitive'));
ALTER TABLE teams ADD COLUMN club_id text REFERENCES clubs(id) NULL;
ALTER TABLE teams ADD COLUMN primary_colour text NULL;
ALTER TABLE teams ADD COLUMN secondary_colour text NULL;

-- matches  
ALTER TABLE matches ADD COLUMN match_type text DEFAULT 'casual'
  CHECK (match_type IN ('casual','competitive'));
ALTER TABLE matches ADD COLUMN fixture_id uuid REFERENCES fixtures(id) NULL;
ALTER TABLE matches ADD COLUMN opponent_team_id text NULL;
ALTER TABLE matches ADD COLUMN opponent_name text NULL;

-- players
ALTER TABLE players ADD COLUMN shirt_number integer NULL;
ALTER TABLE players ADD COLUMN date_of_birth date NULL; -- optional, consent required
ALTER TABLE players ADD COLUMN phone text NULL; -- for WhatsApp notifications
ALTER TABLE players ADD COLUMN notification_channel text DEFAULT 'push'
  CHECK (notification_channel IN ('push','whatsapp','sms','email'));

-- player_match
ALTER TABLE player_match ADD COLUMN match_type text DEFAULT 'casual';
ALTER TABLE player_match ADD COLUMN minutes_played integer NULL;
ALTER TABLE player_match ADD COLUMN was_substitute boolean DEFAULT false;
ALTER TABLE player_match ADD COLUMN shirt_number integer NULL;
```

### RLS on all new tables

Every new table gets RLS enabled immediately.
Access patterns follow existing conventions exactly:
- Company admins see their company's data via `company_admins` join
- Venue admins see their venue's data via `venue_admins` join
- Team admins see their team's data via existing `team_players` join
- Refs see single fixture data via `fixture.ref_token` validation
- Public sees display-safe data via `display_token` or public competition URLs
- No anon writes to any table — all via SECURITY DEFINER RPCs

---

## PHASE 2 — VENUE AND LEAGUE ADMIN

*Estimated: 6 days*
*Routes: `/venue/TOKEN`, `/league/TOKEN`, `/join/LEAGUE_CODE`*

### 2A — Venue admin route and screen

**Route:** `/venue/TOKEN`

**Authentication:** Token-based (like existing admin token) OR
authenticated (if @domain SSO matched). Both paths supported.

**Screen: Venue Dashboard**

Header: Venue name + logo. Tonight's date.

Three panels:

**Panel 1 — Tonight**
All fixtures happening today across all leagues at this venue.
Each fixture shows: teams, kickoff time, pitch, ref assigned (or ⚠️ unassigned).
Status badges: Scheduled / Live / Complete.
Tap any fixture to manage it.

**Panel 2 — This Week**
All fixtures for the next 7 days.
Amber flags for: unassigned ref, unallocated pitch, low squad availability.
One-tap actions: Assign ref, Change pitch, Postpone.

**Panel 3 — Open Issues**
Anything requiring attention:
- Fixtures without refs (count)
- Teams with fewer than minimum confirmed players
- Open incidents
- Teams with name change requests pending

**Bottom nav tabs:**
- Tonight
- Fixtures
- Leagues
- Squad
- Pitches
- Refs
- Settings

### 2B — League management screen

**Leagues tab** shows all active leagues at the venue.

Each league card: name, day, current season status, team count, 
next fixture date.

Tap league → League Detail:
- Current standings table
- This week's fixtures
- Top scorers (season)
- Recent results
- Settings (config, format, labels)

### 2C — Season setup flow

Step 1: Create season
- Name (e.g. "2026 Autumn")
- Start date, end date, number of weeks
- Christmas/bank holiday exclusions (multi-select calendar)
- Cup weeks (which weeks are cup rounds, not league)

Step 2: Create competitions within season
- Add League (auto-named from league name + season)
- Add Cup (name it, select format: single elimination / group stage)
- Both can coexist in same season

Step 3: Register teams
- Search for existing teams (already on platform)
- Invite new teams (generates join link)
- Minimum/maximum squad size per team (configurable)
- Each team gets a season registration record

Step 4: Generate fixtures
- League: round-robin generator
  - Every team plays every other team once (or twice — configurable)
  - Handles odd number of teams (bye week auto-generated)
  - Distributes home/away fairly
  - Conflict checker: no team plays twice in same week
- Cup: bracket generator
  - Single elimination or group stage
  - Seeded or random draw
  - Draw can be manual (venue admin drags teams into bracket)
- Fixtures preview: full season grid before confirming
- Venue admin reviews, adjusts any clashes, confirms

Step 5: Assign pitches and kickoff times
- League default pitch and time pre-populated from league settings
- Override any fixture individually
- Cup fixtures: manual assignment

Step 6: Assign referees
- Bulk assign: "assign [ref name] to all Tuesday fixtures"
- Individual: tap fixture, select from available refs
- Availability check: refs can't be double-booked same time slot
- Unassigned fixtures flagged in amber

Step 7: Confirm and notify
- Summary of entire season
- One-tap confirm
- Notifications fire to all team admins (fixture schedule)
- Notifications fire to all assigned refs (their fixtures)

### 2D — Fixture management

**Fixture detail screen (venue admin view):**
- Both teams, their confirmed squad counts
- Pitch, kickoff time, referee
- Status controls: Postpone / Void / Walkover
- Postpone: select reason (weather, pitch, team request)
  + select new date from available slots
- Void: select reason (admin error, ineligible player etc)
- Walkover: select winner + reason
- All actions create audit_events entry
- All status changes notify both team admins

**Rescheduling:**
- Drag or tap to move fixture to different week
- Conflict checker runs on save
- Both teams notified of change

### 2E — Referee management screen

**Refs tab** shows all refs at the venue.

Each ref: name, this week's assignments, season stats
(games ref'd, incidents, avg rating if implemented).

Add ref: name, phone/WhatsApp, email, preferred notification channel.
Send test notification on save.

Ref detail: full assignment history, performance summary,
upcoming fixtures.

Remove/deactivate ref: unassigns from all future fixtures first,
prompts to reassign.

### 2F — Pitch management

**Pitches tab:** list of all pitches at venue.

Each pitch: name, surface, capacity, status (active/maintenance).

Pitch detail: tonight's schedule (what's on each pitch when),
week view, maintenance blocks.

Maintenance mode: mark pitch unavailable for date range.
All affected fixtures flagged for reassignment.

### 2G — Team join flow for leagues

**Route:** `/join/LEAGUE_CODE`

LEAGUE_CODE is a short alphanumeric on the league or season record.
Venue admin shares this code with team admins to self-register.

Flow:
1. Team admin opens link
2. Authenticates (Google OAuth)
3. Sees league name and venue
4. Creates new team OR selects existing team they manage
5. Enters squad: names (minimum required number)
6. Accepts league terms
7. Registration submitted → venue admin notified for approval
8. On approval: team added to competition, team admin notified

**Venue admin approval screen:**
List of pending team registrations.
Each shows: team name, admin name, squad size.
Approve / Reject (with reason).

### 2H — New RPCs for venue/league layer

All SECURITY DEFINER. All derive context from token or auth.uid().
All return jsonb. Full list:

```
venue_get_state(p_venue_token)
  → Full venue state: leagues, fixtures, refs, pitches, issues

venue_create_season(p_venue_token, p_season jsonb)
  → Creates season + competitions

venue_generate_fixtures(p_venue_token, p_season_id, p_config jsonb)
  → Round-robin and cup bracket generation

venue_assign_ref(p_venue_token, p_fixture_id, p_referee_id)
  → Assigns ref, sends WhatsApp notification

venue_assign_pitch(p_venue_token, p_fixture_id, p_pitch_id, p_kickoff_time)
  → Updates fixture, notifies both teams

venue_update_fixture_status(p_venue_token, p_fixture_id, p_status, p_reason, p_metadata jsonb)
  → Postpone/void/walkover with full audit trail

venue_approve_team_registration(p_venue_token, p_competition_id, p_team_id)
  → Activates competition_teams record

venue_reject_team_registration(p_venue_token, p_competition_id, p_team_id, p_reason)
  → Rejects with reason, notifies team admin

venue_add_referee(p_venue_token, p_referee jsonb)
  → Creates referee record, sends test notification

venue_flag_incident(p_venue_token, p_fixture_id, p_description, p_severity)
  → Creates incident record, notifies company admins if company exists

get_venue_state_by_token(p_venue_token)
  → Bulk read for venue admin route
```

---

## PHASE 3 — REF VIEW

*Estimated: 5 days*
*Route: `/ref/TOKEN`*
*Most technically complex feature in the platform.*

### 3A — Ref authentication

Ref token is on the `fixtures` table.
Generated at season setup, activated when referee is assigned.
No OAuth required — token link is sufficient.
Token grants access to exactly one fixture — nothing else.

RPC: `get_fixture_state_by_ref_token(p_ref_token)`
Returns:
- Fixture metadata (date, kickoff, venue, pitch, competition name)
- Home team: name, confirmed squad (name, shirt number, player_id)
- Away team: same
- Current match_events for this fixture (for reconnect/resume)
- Fixture status

If fixture status is 'completed' — ref view shows final score only,
no further event entry allowed.

### 3B — Pre-match screen

Before kickoff. Ref opens link.

Shows:
- Fixture header: Team A vs Team B, date, kickoff time, pitch
- Home team squad list (confirmed players, shirt numbers)
- Away team squad list
- "Start Match" button (disabled until kickoff time - 15 mins)
- Override: "Start Early" (requires tap-hold 3 seconds)

Squads shown as scrollable lists. Ref can verify against paper
teamsheets if needed.

### 3C — Live match screen

After "Start Match" tapped.

**Layout (mobile-first, one-handed use, large tap targets):**

Top bar (sticky):
- Running match timer (MM:SS)
- Home score | Away score (large, prominent)
- Period indicator: FIRST HALF / SECOND HALF / ET
- Pause/resume timer button
- Half Time button → confirms half, resets timer for second half
- Full Time button → confirms match complete

Main area — two columns:
- Left column: Home team players
- Right column: Away team players

Each player row (large, minimum 56px height):
- Shirt number (small)
- Player name (primary)
- Four action buttons: ⚽ 🟨 🟥 ↕️
  (goal, yellow, red, substitution)

**Event entry flow:**

Tap ⚽ next to a player:
→ Confirms goal for that player's team
→ Minute auto-populated from timer
→ Score increments immediately
→ Toast: "Goal! [Name] [minute]'"
→ Undo available for 30 seconds

Tap 🟨 next to a player:
→ Yellow card logged
→ If second yellow: auto-prompt "Send off? (second yellow)"
→ Toast: "Yellow card — [Name]"

Tap 🟥 next to a player:
→ Red card logged
→ Player row dims (sent off indicator)
→ Toast: "Red card — [Name]"

Tap ↕️ next to a player:
→ Shows "Coming on or going off?"
→ Coming on: tap player from bench list
→ Going off: already selected, choose replacement from bench
→ Both: sub_player_on_id + sub_player_off_id recorded
→ Player who came off dims in the list

Own goal: long-press ⚽ → "Own goal?" confirmation
→ Records against scorer's team (goal for opposition)

**Offline handling:**

Service worker monitors connectivity.
When offline: persistent amber banner "OFFLINE — events queued locally"
Timer continues running.
All taps write to in-memory retry queue with local timestamp.
On reconnect: queue flushed to Supabase in order.
`match_events.synced_at` populated on successful write.
Reception display shows "Live updates paused" while offline.
DO NOT close this tab while offline — warning shown prominently.

### 3D — Half time

Ref taps "Half Time":
- Timer pauses
- Screen shows: First half summary (goals, cards)
- "Start Second Half" button
- Minute resets to 45 (or 0 for second half — configurable per league)

### 3E — Full time

Ref taps "Full Time":
- Shows final score summary
- Full event list (goals, cards, subs)
- "Confirm Full Time" button (requires confirmation tap)
- On confirm:
  - `fixtures.status` → 'completed'
  - `fixtures.home_score` / `away_score` materialised from events
  - Points awarded to standings
  - League broadcast fires to all subscribers
  - Reception display updates definitively
  - Both team admins notified with result
  - Referee notified: "Result confirmed. Thank you."

### 3F — Post-match screen

After full time confirmation:
- Final score prominent
- Goal scorers list
- Cards issued
- Substitutions made
- Share result button (copies text: "Full Time: [A] 3-1 [B] — goals: Hassan 23', Dave 34', Mike 67'")

Ref cannot re-enter the ref view after confirmation.
Any disputes go through venue admin override.

### 3G — Venue admin result override

If score needs correcting after ref confirmation:
Only venue admin can edit via `venue_update_fixture_result` RPC.
Creates audit_events entry with reason.
Notifies both team admins of correction.
HQ notified if company exists.

---

## PHASE 4 — RECEPTION DISPLAY

*Estimated: 3 days*
*Route: `/display/TOKEN`*

### 4A — PIN protection

Display URL: `/display/TOKEN`
On load: 4-digit PIN prompt.
PIN stored in `venues.display_pin`.
Correct PIN → display loads and stays active (PIN not required again
until browser cleared).
PIN wrong 3 times → 30 minute lockout.

### 4B — Display layout and configuration

The display is designed for a TV (1920×1080) or large tablet.
Full screen, no navigation, auto-stays-awake (wake lock API).
Auto-reconnects on network drop.

**Venue admin configures the display in Settings:**
Choose which panels to show and in what order:
- Live scores (current games)
- Upcoming fixtures (tonight's later games)
- Recent results (tonight's completed games)
- League standings
- Season top scorers
- Tonight's goals ticker (scrolling feed)
- Custom message (venue announcements)

**Auto-cycling:** Venue admin sets display mode:
- Fixed: one panel always shown
- Cycle: rotate through selected panels every N seconds (configurable 10–60s)
- Smart: show live scores when games are active, cycle to other panels between games

### 4C — Live scores panel

All fixtures currently in progress at this venue.

Each fixture card:
- Home team name + score (large)
- Away team name + score (large)
- Running timer (syncs from ref view events)
- Pitch number badge
- Competition name badge (League / Cup)
- Recent events ticker below score:
  "⚽ Hassan 23' • 🟨 Mike 31' • ⚽ Dave 34'"

When offline (ref lost signal): "Live updates paused" shown
below the timer. Last known score remains.

Real-time update: subscribes to league broadcast channel.
Every match_event insert triggers re-render.

### 4D — League standings panel

Full standings table for each active competition at venue.
Columns: Pos, Team, P, W, D, L, GF, GA, GD, Pts, Form.

Two visual states:
- **Confirmed** (solid): Points from completed fixtures
- **Live** (amber subtle highlight): Current provisional position
  if in-progress scores were final

When a fixture completes: table updates definitively with
a brief animation on rows that changed position.

### 4E — Top scorers panel

Season top scorers across all competitions at venue.
Columns: Pos, Player, Team, Goals.
Updates live as goals are entered.

### 4F — Upcoming fixtures panel

Tonight's games not yet started.
Each shows: time, pitch, Team A vs Team B, competition.

### 4G — Recent results panel

Tonight's completed games.
Each shows: final score, competition, top scorer.

### 4H — Goals ticker

Scrolling horizontal ticker at bottom of display:
"⚽ Hassan (7-a-side FC) 23' | ⚽ Dave (Riverside) 31' | 🟨 Mike (Monday FC) 34' | ..."
Updates in real time.

### 4I — White labelling

Display reads venue branding from `venues` table:
- `logo_url` → shown top-left
- `primary_colour` → header/accent colour
- `secondary_colour` → secondary accent

"Powered by In or Out" shown bottom-right in small text.
This is non-removable on free/standard tier.
Can be removed on custom enterprise deal.

---

## PHASE 5 — PLAYER AND TEAM ADMIN COMPETITIVE FEATURES

*Estimated: 5 days*

### 5A — Player view in competitive context

When a player belongs to a competitive team, their player view
changes based on match_type context toggle (Casual/Competitive/All).

**Fixture view** (replaces "who's in" for competitive games):
- Opponent name and badge
- Date, kickoff time, venue, pitch
- Competition name (League Week 4 / Cup QF)
- Pre-match briefing teaser (if AI layer built): "Tap for briefing"
- Availability confirmation: "I'm playing" / "I can't make it" / "Maybe"
- Squad confirmation: who's confirmed so far
- Team confirmed (if admin has set the lineup): your name highlighted
- Countdown to kickoff

**League standings** (new tab or card in player view):
- Current standings for their league
- Their team highlighted
- Form column
- Tap row: fixture history between those two teams

**Stats tab in competitive context:**
- Goals this season in this league
- Appearances
- Cards
- Form strip (competitive only)
- Position in top scorer list

### 5B — Team admin competitive features

**Teamsheet screen** (competitive teams only):
- Starting lineup (drag to reorder, or tap to assign shirt numbers)
- Substitutes bench
- Minimum/maximum squad size enforced by league config
- Generate Teamsheet button → formatted PDF or printable view
- Submit to league (marks teamsheet as submitted for this fixture)

**Availability for fixture** (replaces weekly in/out for competitive):
- Push notification sent to squad 48 hours before fixture
- Players confirm via their token link
- Admin sees availability in real time
- Admin sets lineup from confirmed players
- Admin submits teamsheet
- Players notified when lineup confirmed

**Player eligibility check:**
On lineup submission, system checks:
- Each player is registered in `player_registrations` for this competition
- No player is suspended (`player_registrations.status = 'suspended'`)
- If violation found: warning shown with player name and reason
- Admin can override with confirmation (flagged in audit_events)
- If double-registered player detected: flag to team admin and
  league admin, both must confirm before fixture proceeds

### 5C — Opposition intelligence (pre-match briefing data)

New screen accessible from fixture detail: "Opposition Intel"

Shows (data-driven, no AI required):
- Head to head record against this opponent (all-time)
- Head to head this season
- Opponent's current form (last 5 results from match_events)
- Opponent's top scorer this season
- Opponent's last result (score + scorers)
- Your team's form (last 5)
- Your top scorer this season

This screen works from match_events data alone.
AI layer (Phase 7) turns this data into narrative briefings.

---

## PHASE 6 — HQ DASHBOARD

*Estimated: 6 days*
*Route: `/hq` (authenticated only)*

### 6A — Authentication and access

HQ is authenticated-only. No token link.
Login via Google OAuth.
Email domain matched to company via `company_domains` table.
On match: company admin role assigned automatically.

Manual HQ admin creation: platform admin (Tarny) creates
`company_admins` record for initial setup.

**Role scoping:**
- `super_admin`: all venues in company
- `regional_admin`: subset of venues (by `region` field)
- `analyst`: read-only, all venues

### 6B — HQ dashboard layout (desktop-first)

Three-column layout at ≥1024px.
Single column collapse on mobile (graceful, not primary use case).

**Left column: Venue Health Grid**

All venues as cards. Each card:
- Venue name
- Status indicator: 🟢 All good / 🟡 Needs attention / 🔴 Issue
- Tonight's fixture count
- Active incidents count
- Subscription status (trial / active / lapsed)

Status logic:
- 🔴 if: open critical incident, or subscription lapsed
- 🟡 if: fixtures unallocated this week, or refs unassigned,
  or teams with low availability
- 🟢 otherwise

Tap venue card: drill-down to that venue's data.

**Centre column: Live Activity Feed**

Tonight's matches across all venues.
Each fixture: venue name, teams, live score (if in progress),
status badge.
Updates via multiple simultaneous channel subscriptions
(one per active league).

Recent goals ticker at bottom.

When no games active: shows tomorrow's fixtures.

**Right column: Alerts and Actions**

Open incidents (flagged by venue admins).
Each: venue name, severity, description, time.
Resolve button: adds resolution note, closes incident,
notifies venue admin.

Pending items:
- Venues approaching trial end (within 7 days)
- Venues with overdue billing
- Teams pending approval at any venue

### 6C — HQ analytics screens

**Overview tab:**
- Total active venues
- Total active leagues / seasons
- Total registered teams
- Total registered players
- Total fixtures this season (completed / remaining)
- Total goals scored (all venues, current season)
- Average goals per game (by venue, by league format)

**Venue comparison tab:**
Table view. Columns configurable. Defaults:
- Venue name
- Active leagues
- Active teams
- Player engagement rate (% of players who've opened app)
- Fixture completion rate (completed / scheduled)
- Average squad confirmation rate
- Ref no-show rate
- Open incidents

Sortable, filterable.

**Player engagement tab:**
- Total registered players vs active players (opened app ≥ once)
- Engagement by venue
- Engagement by day of week (which leagues have most engaged players)
- Availability confirmation rate (% who confirm availability before fixtures)
- Payment collection rate

**Season performance tab:**
- League table for any league at any venue
- Top scorers across all venues (combined leaderboard)
- Most played, most cards, best form — cross-venue
- Season-on-season comparison (if prior season data exists)

### 6D — HQ preview token

Venue admin can generate a one-time HQ preview link for their
company contacts:

`/hq/preview/TOKEN`

- Token stored in `hq_preview_tokens`
- Expires 7 days after generation
- Shows read-only subset of HQ dashboard for that company
- Requires no login
- Shows watermark: "Preview — upgrade to HQ tier for permanent access"
- On access: `hq_preview_tokens.accessed_at` populated
- Venue admin notified when preview link is opened

This is the commercial hook: venue shows their HQ what's possible.
HQ sees the data. HQ buys the tier.

### 6E — HQ RPCs

```
hq_get_company_state(p_company_id)
  → All venues, leagues, active seasons, summary stats

hq_get_venue_detail(p_company_id, p_venue_id)
  → Single venue drill-down data

hq_get_analytics(p_company_id, p_date_from, p_date_to)
  → Aggregated stats for period

hq_resolve_incident(p_company_id, p_incident_id, p_resolution_note)
  → Closes incident, notifies venue admin

hq_generate_preview_token(p_company_id)
  → Creates 7-day preview token

get_hq_preview_state(p_token)
  → Read-only company state for preview route
```

---

## PHASE 7 — AI LAYER (ASK THE GAFFER — EVOLVED)

*Estimated: 8 days*
*Anthropic Claude API. Internal data only. No web search.*

### 7A — Architecture

**Principle: grounded, not generative.**
Every AI output is backed by a specific query result.
LLM narrates and patterns — never invents facts.

**Data pipeline:**
1. Structured queries run against Supabase (pre-computed)
2. Results assembled into a context object (JSON)
3. Context + system prompt sent to Claude API
4. Response returned and displayed
5. Every claim is traceable to a query result

**Model:** `claude-sonnet-4-6` (current Sonnet)
**Max tokens:** 1000 for player briefings, 2000 for HQ digests
**No tool use** in initial build — pure text generation from
pre-computed context

**Cost estimate:**
- Pre-match briefing: ~2000 input tokens + 500 output = ~£0.004 per briefing
- HQ weekly digest: ~5000 input + 1000 output = ~£0.01 per digest
- Negligible at current scale. Well within pricing model.

### 7B — Pre-match briefing (team admin and player)

**Trigger:** Cron job runs night before each fixture (9pm).
For each fixture scheduled tomorrow:
1. Query match_events for all previous meetings between these teams
2. Query league_standings for current form
3. Query player_match for top scorers (both teams)
4. Query player_registrations for confirmed squad (both teams)
5. Assemble context object
6. Send to Claude with system prompt
7. Store result in `ai_briefings` table
8. Push notification to team admin: "Pre-match briefing ready"
9. Make available in player view under fixture detail

**System prompt:**
```
You are a football assistant briefing a team manager before their next game.
You have access to historical match data between these two teams and current
season statistics. Write a concise pre-match briefing (150-200 words) that:
- States the head-to-head record honestly
- Highlights any relevant form or scoring trends
- Names the opposition's danger player if one exists
- Notes anything tactically relevant from the data
- Ends with one concrete observation the manager can act on

Be direct and specific. Never fabricate statistics. If data is limited,
acknowledge it. Tone: knowledgeable football observer, not corporate.
Do not use bullet points — write in flowing paragraphs.
```

**New table: `ai_briefings`**
```sql
ai_briefings (
  id uuid PK DEFAULT gen_random_uuid(),
  fixture_id uuid REFERENCES fixtures(id),
  audience text CHECK IN ('team_admin','player','hq'),
  team_id text REFERENCES teams(id) NULL,
  content text NOT NULL,
  context_snapshot jsonb NOT NULL, -- the data used to generate it
  model text NOT NULL,
  tokens_used integer,
  generated_at timestamptz DEFAULT now()
)
```

### 7C — Opposition intel narrative

On the Opposition Intel screen (Phase 5C), below the raw stats:
An AI-generated paragraph contextualising the numbers.

"You've faced Riverside Athletic four times this season, winning two and
losing two. Both your wins came when Hassan started — he's scored in
every game against them. Their top scorer Jordan hasn't found the net
in his last three games but has two assists. Worth noting: you've
conceded in the first ten minutes in three of your four meetings."

Generated on-demand (when admin taps "Show briefing") rather than
pre-generated, to avoid wasted API calls for fixtures that never
get viewed.

### 7D — Post-match summary (team admin)

Generated automatically after full time is confirmed.
Stored in `ai_briefings` with audience='team_admin'.
Pushed to team admin.

"You beat Riverside Athletic 3-1, Hassan with a brace and Dave getting
the third. The result moves you to second in the table, two points
behind leaders Monday FC with three games remaining. Notable: it was
your first clean sheet... until Dave's own goal in the 78th minute.
Your next fixture is against bottom-side City FC in six days —
a team you've beaten in all three previous meetings."

### 7E — HQ weekly digest (email)

**Trigger:** Monday morning cron, 7am.
For each company with active HQ subscription:

1. Query all fixtures from prior week (all venues)
2. Query incidents from prior week
3. Query standings changes from prior week
4. Query engagement metrics from prior week
5. Assemble context
6. Send to Claude
7. Email sent to all company admins via Resend (existing email infra)

Content structure:
- Opening summary (1 sentence: how was the week)
- Venues that had notable events (good and bad)
- Any operational concerns (ref no-shows, low attendance patterns)
- Cross-venue top performers (goals, POTG)
- One data insight: something the LLM identified from the numbers
- Week ahead: fixture count, any flags

### 7F — Anomaly detection (HQ)

Runs weekly alongside digest generation.

Checks for:
- Venues where fixture completion rate dropped >10% vs rolling average
- Teams where squad availability is declining week-on-week
- Referees who haven't confirmed assignments
- Leagues where goal averages changed significantly (pitch/format issue?)
- Teams matching historical dropout profile (low attendance + payment issues)

Flags surface in HQ dashboard as alerts with plain-English explanation:
"Riverside Athletic's squad availability has dropped from 85% to 60%
over the last three weeks. This pattern preceded team dropout in 3 of
your last 5 mid-season withdrawals. Consider proactive outreach."

---

## PHASE 8 — BILLING AND SELF-SERVE

*Estimated: 5 days*

### 8A — Pricing tiers

**Team tier** — Free forever
Squad management, player stats, casual games, IO Intelligence.
No credit card required.

**Venue tier** — £199/month
Full league management, fixture scheduling, ref allocation,
ref view, reception display, end-of-night digest.
60-day free trial. Card required at signup, charged after trial.

**HQ tier** — £999/month per company
Cross-venue analytics, AI weekly digest, anomaly detection,
incident management, HQ dashboard.
No trial — paid from day one.
First HQ preview is free (7-day token from venue admin).

### 8B — Self-serve venue signup

**Route:** `/venue/signup`

Step 1: Create account (Google OAuth)
Step 2: Venue details (name, address, postcode)
Step 3: Choose plan (Venue tier shown, HQ tier explained)
Step 4: Card details (Stripe Elements)
Step 5: 60-day trial confirmed — card charged on day 61

On completion:
- `venues` record created
- `venue_admin_token` generated
- Redirect to `/venue/TOKEN`
- Welcome email sent
- Onboarding checklist shown in dashboard

### 8C — Stripe integration

**Stripe products:**
- `prod_venue_monthly` — £199/month recurring
- `prod_hq_monthly` — £999/month recurring

**Webhooks handled:**
- `customer.subscription.created` → set subscription_status='active'
- `customer.subscription.deleted` → set subscription_status='cancelled'
- `invoice.payment_succeeded` → log billing_event
- `invoice.payment_failed` → set subscription_status='past_due', notify admin
- `customer.subscription.trial_will_end` → 3-day warning email

**Trial enforcement:**
At 60 days: Stripe charges automatically if card on file.
If payment fails: 3-day grace period, then venue features locked.
Locked state: venue admin can still log in and see data
but cannot manage fixtures or add refs. Prompt to update billing.

**HQ billing:**
Manually created by platform admin (Tarny) initially.
Self-serve HQ signup route can be added later.
HQ trial: not applicable. Paid from day one.

### 8D — Billing portal

Venue admins can access Stripe Customer Portal from Settings.
Shows: current plan, next billing date, payment method, invoices.
Cancel subscription: goes to end of current billing period.

### 8E — Platform admin billing view

`/admin/billing` (Tarny only, authenticated)
All venues: name, status, trial end date, MRR contribution.
All companies: name, status, MRR contribution.
Total MRR display.
One-tap: extend trial, cancel subscription, update plan.

---

## PHASE 9 — NOTIFICATIONS AND COMMUNICATIONS

*Estimated: 3 days*

### 9A — Notification templates (full list)

**Player notifications:**
- fixture_reminder (48h before, 2h before)
- availability_request (48h before fixture)
- lineup_confirmed (when admin sets teamsheet)
- result_notification (full time confirmed)
- pre_match_briefing (night before)
- suspension_warning (approaching card threshold)
- suspension_confirmed (suspended for next game)

**Team admin notifications:**
- availability_update (player confirms/declines)
- squad_low_availability (< min players confirmed, 24h before)
- fixture_change (postpone/reschedule/pitch change)
- pre_match_briefing (night before, richer than player version)
- result_confirmed (after ref submits)
- post_match_summary (AI-generated, after result)
- registration_approved (team approved for league)
- registration_rejected (team rejected, with reason)

**Referee notifications:**
- ref_assigned (on assignment, with fixture details + ref link)
- ref_reminder (morning of game day)
- fixture_change (if their fixture is changed)
- result_confirmation (after they submit, "thank you" message)

**Venue admin notifications:**
- team_registration_pending (new team wants to join a league)
- ref_no_show (fixture started but ref hasn't opened ref view)
- incident_resolved (by HQ)
- trial_ending_soon (7 days, 3 days, 1 day)
- payment_failed

**HQ notifications:**
- weekly_digest (Monday 7am email)
- critical_incident (immediate, any venue)
- venue_trial_expiring (7 days before)

### 9B — Notification settings per entity

**Player:** push, WhatsApp, SMS, email — per notification type
**Team admin:** same
**Referee:** WhatsApp primary, SMS fallback, email
**Venue admin:** push + email
**HQ admin:** email primary

All configurable in their respective settings screens.

### 9C — Cron schedule additions

Existing crons continue unchanged.
New crons added to `cron.js`:

```javascript
// Fixture reminders
fixtureReminder48h   — daily 9am, checks fixtures in 48h
fixtureReminder2h    — hourly, checks fixtures in 2h
availabilityRequest  — daily 9am, checks fixtures in 48h

// AI briefings
prematachBriefing    — daily 9pm, generates for tomorrow's fixtures

// Ref checks
refNoShowCheck       — every 15 mins during typical fixture windows
                       (5pm-11pm), checks ref token last opened

// HQ
weeklyDigest         — Monday 7am
anomalyDetection     — Monday 7am (runs before digest)

// Billing
trialExpiryCheck     — daily 9am
paymentFailureRetry  — daily 11am (after Stripe retry)
```

---

## PHASE 10 — PUBLIC LEAGUE PAGES

*Estimated: 2 days*

### 10A — Public competition page

**Route:** `/league/[league-slug]/[season-slug]`

No login required. Readable by anyone.
Shareable URL. Works perfectly in WhatsApp links.

Content:
- League name, venue, season
- Current standings table
- This week's fixtures
- Recent results
- Top scorers (season)
- Link to join (if registration open)

### 10B — Public team page

**Route:** `/team/[team-slug]`

No login required.
Content:
- Team name
- Current season record (in each active competition)
- Recent results (last 5)
- Top scorers
- Next fixture

Player stats are not shown on public team page (privacy).
Only team-level aggregates.

### 10C — Public fixture page

**Route:** `/fixture/[fixture-id]`

No login required.
Content:
- Both teams, competition, date, venue, pitch
- Live score (if in progress) — updates in real time
- Final score (if complete)
- Goal scorers (names + minutes)
- Cards (names + minutes)
- Match events timeline

This page is what goes viral on WhatsApp.
"We won 4-1 — [link]" shared in the team group
and every supporter can see the events in real time.

---

## PHASE 11 — CUPS AND KNOCKOUTS

*Estimated: 4 days*
*Runs concurrently with league within a season.*

### 11A — Cup format options

**Single elimination:**
Losers out. Winners advance.
Odd byes handled by seeding top teams into later rounds.

**Group stage + knockout:**
Teams split into groups (e.g. 2 groups of 4).
Top 2 from each group advance to semis.
Final to decide cup winner.

Both formats run alongside the league.
A team could play a league fixture on Tuesday week 4
and a cup quarter final on Tuesday week 5.

### 11B — Cup draw

**For single elimination:**
Venue admin triggers draw.
Teams seeded (by current league position) or random.
Draw happens in the app — animated reveal optional.
Bracket generated and saved to `cup_rounds` + `fixtures`.
All team admins notified with their cup draw.

**For group stage:**
Venue admin assigns teams to groups (manual or random).
Group fixtures generated (round-robin within group).
On group completion: standings calculated, top 2 advance.
Knockout fixtures auto-generated from group results.

### 11C — Cup standings and bracket

Cup bracket view in league admin and player-facing views.
Shows: bracket tree, results, who's through.

On display screen: cup badge on fixture tiles.
Separate "Cup" tab in standings panel.

### 11D — Cup winner

Final confirmed via ref view (same flow as league fixture).
On full time of final:
- `competitions.status` → 'completed'
- Winner recorded
- Trophy notification to winning team
- HQ notified
- Display shows cup winner celebration panel

---

## ROUTES SUMMARY

```
/ ......................  Existing (landing/PWA)
/p/TOKEN ...............  Existing player view (Casual | Competitive | All)
/admin/TOKEN ...........  Existing admin view (Casual context)
/demoadmin .............  Existing demo
/create ................  Existing onboarding

-- NEW COMPETITIVE TEAM ROUTES
/team/[slug] ...........  Public team page
/fixture/[id] ..........  Public fixture page (live + results)
/league/[slug]/[season].  Public competition page

-- NEW VENUE/LEAGUE ROUTES
/venue/signup ..........  Self-serve venue registration
/venue/TOKEN ...........  Venue admin dashboard
/league/TOKEN ..........  League admin (may merge with venue)
/join/LEAGUE_CODE ......  Team self-registration to league

-- NEW REF/DISPLAY ROUTES
/ref/TOKEN .............  Referee view (single fixture)
/display/TOKEN .........  Reception display (PIN protected)

-- NEW HQ ROUTES
/hq ....................  HQ dashboard (authenticated)
/hq/preview/TOKEN ......  HQ preview (7-day, no login)

-- PLATFORM ADMIN
/platform ..............  Platform admin (Tarny only)
/platform/billing ......  Billing overview
```

---

## DATA MODEL DIAGRAM (simplified)

```
companies ──────────────── company_admins (user)
    │
    └── venues ──────────── venue_admins (user)
            │               pitches
            │               referees
            │
            └── leagues ─── league_config
                    │
                    └── seasons
                            │
                            ├── competitions (league + cup)
                            │       │
                            │       ├── competition_teams
                            │       │       │
                            │       │       └── teams ── players
                            │       │
                            │       └── cup_rounds
                            │
                            └── fixtures ────── match_events
                                    │           ai_briefings
                                    │
                                    └── referees (assigned)
                                        pitches (assigned)
```

---

## RPC INVENTORY (new RPCs only)

All existing RPCs unchanged. New RPCs follow identical patterns:
SECURITY DEFINER, derive context from token/auth.uid(),
return jsonb, REVOKE ALL from anon if auth-only.

**Venue RPCs (anon with venue_token):**
```
get_venue_state_by_token(p_venue_token)
venue_create_season(p_venue_token, p_config jsonb)
venue_generate_fixtures(p_venue_token, p_season_id, p_options jsonb)
venue_assign_referee(p_venue_token, p_fixture_id, p_referee_id)
venue_assign_pitch(p_venue_token, p_fixture_id, p_pitch_id, p_time)
venue_update_fixture_status(p_venue_token, p_fixture_id, p_status, p_reason)
venue_add_referee(p_venue_token, p_referee jsonb)
venue_add_pitch(p_venue_token, p_pitch jsonb)
venue_approve_team_registration(p_venue_token, p_competition_id, p_team_id)
venue_reject_team_registration(p_venue_token, p_competition_id, p_team_id, p_reason)
venue_flag_incident(p_venue_token, p_description, p_severity, p_fixture_id)
venue_generate_hq_preview(p_venue_token)
venue_update_display_config(p_venue_token, p_config jsonb)
```

**League RPCs:**
```
league_get_state(p_league_token)
league_update_config(p_league_token, p_config jsonb)
```

**Ref RPCs (anon with ref_token):**
```
get_fixture_state_by_ref_token(p_ref_token)
ref_start_match(p_ref_token)
ref_record_event(p_ref_token, p_event jsonb)
ref_confirm_halftime(p_ref_token)
ref_confirm_fulltime(p_ref_token)
ref_bulk_sync_events(p_ref_token, p_events jsonb[])
  → For offline sync: array of queued events, written in order
```

**Display RPCs (public with display_token):**
```
get_display_state(p_display_token, p_pin)
  → Returns display config + live fixture data if PIN correct
  → Returns {error: 'invalid_pin'} if wrong
```

**Team admin competitive RPCs:**
```
admin_submit_teamsheet(p_admin_token, p_fixture_id, p_squad jsonb)
admin_confirm_fixture_availability(p_admin_token, p_fixture_id)
admin_request_fixture_postpone(p_admin_token, p_fixture_id, p_reason)
```

**Player competitive RPCs:**
```
player_confirm_fixture_availability(p_token, p_fixture_id, p_status)
get_opposition_intel(p_token, p_fixture_id)
get_pre_match_briefing(p_token, p_fixture_id)
```

**HQ RPCs (authenticated only):**
```
hq_get_company_state(p_company_id)
hq_get_venue_detail(p_company_id, p_venue_id)
hq_get_analytics(p_company_id, p_date_from, p_date_to)
hq_resolve_incident(p_company_id, p_incident_id, p_note)
hq_generate_preview_token(p_company_id)
get_hq_preview_state(p_token)
```

**Auth RPCs (authenticated):**
```
create_venue(p_venue_data jsonb)
  → Creates venue, assigns venue_admin role, initiates Stripe trial
create_company(p_company_data jsonb)
  → Creates company, assigns company_admin role
link_company_domain(p_company_id, p_domain)
  → Adds domain to company_domains
get_my_company()
  → Returns company for authenticated user based on email domain
```

**Billing RPCs (authenticated):**
```
create_stripe_customer(p_entity_type, p_entity_id)
create_stripe_subscription(p_entity_type, p_entity_id, p_price_id)
handle_stripe_webhook(p_event jsonb)
  → Called by Vercel webhook handler, not directly by client
```

**Round-robin generator (pure JS, no RPC):**
```javascript
// packages/core/engine/fixtureGenerator.js
generateRoundRobin({ teams, weeks, excludeWeeks, homeAwayBalance })
  → { fixtures: [{home, away, week}], byes: [{team, week}] }

generateCupBracket({ teams, format, seedings })
  → { rounds: [{round_number, fixtures: [{home, away}]}] }
```

---

## MIGRATIONS

New migration files (continuing from 032):

```
033_companies_venues.sql
  → companies, venues, venue_admins, company_admins,
    company_domains, pitches, referees tables + RLS

034_leagues_seasons.sql
  → leagues, seasons, competitions, league_config,
    cup_rounds tables + RLS

035_teams_competitive.sql
  → clubs, club_teams, competition_teams, team_name_history,
    player_registrations tables + RLS
  → ALTER TABLE teams, matches, players, player_match

036_fixtures_events.sql
  → fixtures, match_events tables + RLS
  → league_standings view

037_ai_billing.sql
  → ai_briefings, hq_preview_tokens, billing_events,
    incidents tables + RLS

038_rpcs_venue.sql
  → All venue RPCs

039_rpcs_ref.sql
  → All ref RPCs

040_rpcs_display.sql
  → Display RPCs

041_rpcs_hq.sql
  → All HQ RPCs

042_rpcs_competitive_team.sql
  → Team admin and player competitive RPCs

043_grants_revokes.sql
  → Final grant/revoke consolidation for all new tables
```

Each migration file has a corresponding _down.sql.
All applied via Supabase SQL editor (never Claude Code).

---

## PHASED BUILD PLAN AND SEQUENCING

### Phase 0 — Foundation (5 days)
**Output:** Generic labels, Casual/Competitive split, team type selection,
notification abstraction, domain SSO scaffolding.
**Acceptance:** Existing app works unchanged. Three-tab stats selector
works. Team creation asks for type. Twilio/WhatsApp wiring in place
(not yet sending). Build passes clean.

### Phase 1 — Data model (4 days)
**Output:** All new tables created, RLS enabled, all migrations applied.
No UI yet.
**Acceptance:** All tables exist in Supabase. RLS blocks direct access.
All RPCs exist and return expected shapes. Schema cache reloaded.
`check-rpc-security.sh` passes on all new RPCs.

### Phase 2 — Venue and league admin (6 days)
**Output:** Venue admin dashboard, season setup, fixture generation,
ref/pitch management, team join flow.
**Acceptance:** Can create a venue, create a season, generate a full
round-robin fixture list, assign refs, approve team registrations.
Venue admin can manage all fixtures for a season. Notifications fire
on key events.

### Phase 3 — Ref view (5 days)
**Output:** Full ref view with offline support, goal/card/sub entry,
half time, full time confirmation.
**Acceptance:** Ref can open link, see both squads, enter goals/cards/subs,
handle half time, confirm full time. Offline mode queues events and
syncs on reconnect. Fixture marked complete. Both teams notified.

### Phase 4 — Reception display (3 days)
**Output:** PIN-protected display screen, live scores, league table,
top scorers, white labelling, auto-cycling.
**Acceptance:** Display shows all live fixtures at venue. Updates in
real time as ref enters goals. League table updates on goal entry.
Definitive update on full time. White label colours and logo applied.

### Phase 5 — Player and team competitive features (5 days)
**Output:** Fixture view in player app, availability confirmation,
teamsheet, opposition intel screen, Casual/Competitive/All stats split.
**Acceptance:** Players can see their fixtures and confirm availability.
Team admins can set lineup and generate teamsheet. Opposition intel
shows head-to-head data. Stats correctly filter by context.

### Phase 6 — HQ dashboard (6 days)
**Output:** HQ authenticated dashboard, venue health grid, live feed,
analytics screens, incident management, HQ preview token.
**Acceptance:** Company admin can log in (domain-matched), see all venues,
drill into any venue, view analytics, resolve incidents. Preview token
generates and works for 7 days. Billing shows correctly.

### Phase 7 — AI layer (8 days)
**Output:** Pre-match briefings, opposition intel narrative, post-match
summaries, HQ weekly digest email, anomaly detection.
**Acceptance:** Briefings generated night before fixtures. Correct data
cited. No fabricated statistics. HQ digest emails send Monday 7am.
Anomaly alerts surface in HQ dashboard. All AI outputs stored in
`ai_briefings` with context snapshot.

### Phase 8 — Billing and self-serve (5 days)
**Output:** Venue self-serve signup, Stripe integration, 60-day trial,
billing portal, HQ tier billing, platform admin billing view.
**Acceptance:** Venue can sign up without contacting Tarny. Card captured
at signup. Trial confirmed for 60 days. Stripe webhooks handled.
Subscription status propagates correctly. Locked state works.

### Phase 9 — Notifications (3 days)
**Output:** All notification templates, Twilio/WhatsApp sending,
full cron schedule, per-entity notification preferences.
**Acceptance:** All notification types send via correct channel. Refs
receive WhatsApp assignment. Players receive pre-match push. HQ
receives Monday email. No duplicate sends. Quiet hours respected.

### Phase 10 — Public pages (2 days)
**Output:** Public league, team and fixture pages. Live fixture page.
**Acceptance:** All pages load without auth. Live fixture page updates
in real time. Shareable URLs work in WhatsApp previews.

### Phase 11 — Cups and knockouts (4 days)
**Output:** Cup format options, draw generator, bracket view, cup
fixtures via ref view, cup winner celebration.
**Acceptance:** Can create a cup competition 