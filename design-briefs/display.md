# Display / TV Board — Functional Brief

> Read `README.md` first. This brief is functional only — no style direction. Use the
> field names from the **Data contract appendix** at the bottom; design every state.

---

## Surface header

**Product context.** The Display is the **public-facing big screen** in a venue's reception
or bar — a wall-mounted TV showing live scores, standings, top scorers and a goals ticker
for the league(s) playing right now. It's read-only: nobody interacts with it. It runs
unattended for hours and updates itself as matches unfold.

**Who sees it + device.** The public — players, parents, drinkers — glancing at a TV from
**3–6 metres away**. Target **1920×1080 landscape**. Everything must be **large and legible
at distance**: big numerals, high contrast, no fine print. It is *not* touched, so there are
no buttons — just well-paced motion.

**Auth / launch.** The TV opens a link with a venue **display token** (`/display/<token>`).
The venue may set an optional **screen PIN** to stop passers-by remotely opening it; if set,
a **PIN gate** appears first (numeric entry; after 3 wrong tries it locks out for ~30 min).
Once unlocked it stays unlocked on that device.

**Behaviour & cadence.**
- One **unified screen** (no nav). What shows is driven by the venue's display config: which
  **zones** are enabled, and a **rotation mode** — *Smart* (lead with big live scores during
  games, fixtures/results between), *Cycle* (rotate on a timer), or *Fixed* (no rotation).
- If multiple competitions exist, the standings/top-scorers zones **rotate** through them on
  a timer (configurable 10–60s).
- Updates **live** the moment anything changes at the venue; also self-refreshes every ~60s
  as a fallback, keeps a 1-second clock, and recalculates each live match's **minute** from
  the kickoff time + a server clock offset (so a drifting TV clock doesn't matter).

**Global states** to design:
- **No token** — a bare "no display token" notice.
- **PIN gate** — numeric PIN entry; wrong-attempt feedback; locked-out state.
- **Connecting** — initial load.
- **Error** — invalid link / load failure.
- **Idle** — populated, but no match currently live (see Idle Hero).
- **Live** — one or more matches in progress (see Live Scores).
- A small **"live updates paused"** indicator if the realtime connection drops.
- A non-removable **"Powered by In or Out"** watermark, low-corner.

---

## The unified screen — zones

Think of it as a header, a two-column body, and a bottom bar. Zones are toggled on/off by
config; design each zone and how the body reflows when some are off.

### Header (always on)
- Venue **logo** (or a monogram from the first letter of the venue name).
- Venue name + a "Live Scores & Standings"-style strapline.
- A **live match count** pill when matches are in progress.
- The connection indicator (only when paused).
- A **clock + date**, top-right, ticking each second.

### Body — Left column

**Live Scores** *(shown when matches are live)* — "Live Now" + a count, then up to **6 live
fixture cards** in a responsive grid (fewer cards = bigger). Each **live fixture card**:
- Top badges: **pitch name** + **competition name**.
- A **live clock**: the current match **minute** (computed) with a "Live" marker.
- Both team **crests** (generated roundels: a colour gradient + the team's initials).
- The **score** in large numerals, animating when it changes.
- A short **recent-events** list (last ~6, newest first): goal ⚽, own goal, yellow 🟨, red
  🟥, sub 🔁, period change ⏱ — each with player name + minute.
- A **lower-third** banner for the most recent goal, sweeping in with the scoring team's
  colour: player name, minute, "(OG)" if an own goal.

**Idle Hero** *(replaces Live Scores when nothing is live)* — pick the richest tier that has
data:
1. **Next match today** → a large hero: "Next Up · time · pitch", both crests + team names,
   competition.
2. **Later today** → a compact list: time + home v away (small crests).
3. **Recent results today** → a compact list: home score–away (small crests).
4. **No fixtures today but a league exists** → a **top-3 podium**: crest + team name + points.
5. **Nothing at all** → venue logo + name + the configured **custom message**.

**Top Scorers** *(optional, lower-left)* — "Top Scorers / Golden Boot", up to 6 rows: rank
(a boot icon for #1), crest + scorer name + team, and the goal count.

### Body — Right column

**Standings** *(optional)* — the current competition's table. Title = competition name, with
a **"Provisional"** tag (in addition to the live scores) when it's reflecting in-progress
matches. There are two versions of the table: **confirmed** (finished matches only) and
**live/provisional** (includes in-progress scores); show the provisional one while a match
in that competition is live, otherwise the confirmed one. Columns: **# · Team · P · W · D ·
L · GD · Form · Pts**. The **Form** column is the last-5 results as coloured pips (W/D/L),
newest on the right. Show a position **delta** (▲/▼) when the provisional order differs from
confirmed. Top 3 highlighted. *(Standings are hidden entirely if the competition's standings
are set to private — design a tidy "table hidden" fallback or simply omit the zone.)*

**Cup Bracket** *(when the competition is a knockout/group cup instead of a league)* — a
**champion** banner if decided; **group tables** (if a group stage) with qualifiers marked;
and **knockout rounds** (Round of 16 → Final) with each tie's two teams, scores if played,
and the winner emphasised.

### Bottom bar
- **Sponsor bug** *(optional, left)* — a sponsor image + label if configured, else the venue
  logo, else nothing (the ticker takes the full width).
- **Goals ticker** *(optional, right)* — a horizontally **scrolling marquee** of today's
  goals: a team-colour dot + player name + team + minute, looping seamlessly. Empty → "No
  goals yet today — first one's coming…" (or the custom message).

---

## Data contract appendix

This whole screen is rendered from one payload. Field names are what your components should
expect as props.

```
venue: {
  id, name, logo_url?, primary_colour, secondary_colour,
  display_config: {
    zones: [ 'live_scores' | 'upcoming' | 'recent' | 'standings'
           | 'top_scorers' | 'goals_ticker' | 'custom_message' ],   // which zones are on
    mode: 'smart' | 'cycle' | 'fixed',
    interval_secs: 10..60,        // rotation speed
    custom_message?: string,
    sponsor_image_url?: string,
    sponsor_label?: string
  }
}

server_time: ISO timestamp            // used to sync the clock / live minute

competitions: [{
  competition_id, name, type ('league'|'cup'),
  format ('round_robin'|'single_elimination'|'group_stage'),
  league_name, standings_visibility ('public'|'private'),
  standings_confirmed: [Standing],     // finished matches only
  standings_live:      [Standing],     // includes in-progress scores (provisional)
  top_scorers: [{ player_id, name, team_id, team_name, primary_colour, goals }]
}]

Standing = {
  team_id, team_name, primary_colour, secondary_colour,
  played, w, d, l, gf, ga, gd, pts,
  form: [ 'W' | 'D' | 'L', … ]         // recent results, used for the Form pips
}

live_fixtures: [{
  fixture_id, competition_id, competition_name, competition_type,
  home_team_id, home_team_name, home_primary_colour, home_secondary_colour,
  away_team_id, away_team_name, away_primary_colour, away_secondary_colour,
  home_score, away_score,              // live-computed while in progress
  pitch_name, actual_kickoff_at,       // ISO — minute is computed from this + server_time
  recent_events: [{ type ('goal'|'own_goal'|'yellow_card'|'red_card'|'substitution'|'period_change'),
                    minute, period, player_name, team_id }]
}]

upcoming_fixtures: [{ fixture_id, competition_name, kickoff_time, pitch_name,
                      home_team_name, home_primary_colour,
                      away_team_name, away_primary_colour }]      // today only

recent_results: [{ fixture_id, competition_name, status,
                   home_team_name, home_primary_colour, home_score,
                   away_team_name, away_primary_colour, away_score,
                   top_scorer_name? }]                            // today only

goals_ticker: [{ player_name, team_name, primary_colour, minute, competition_name }]  // today, up to ~30

cup (when a competition is a cup): {
  champion?: { name },
  groups?: [{ group_label, standings: [{ team_id, team_name, qualifying (bool),
                                         played, w, d, l, gd, pts }] }],
  rounds: [{ round_number, round_name,
             ties: [{ home_team_name?, away_team_name?, home_score?, away_score?,
                      winner_team_id? }] }]
}
```

**Edge cases to design for:** a `bye` (away team absent) renders as "(bye)"; a walkover/
forfeit shows as e.g. 3–0; teams without colours still get a deterministic crest; form is
always padded to 5 pips (empty pips faint); private standings hide the table.
