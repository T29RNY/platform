# League Dashboard — Functional Brief

> Read `README.md` first. This brief is functional only — no style direction. Use the
> field names from the **Data contract appendix** at the bottom; design every state.

---

## Surface header

**Product context.** The League dashboard is for the person running a single **league** —
the fixture organiser. It's a slimmer cousin of the Venue dashboard, focused on the
competition itself: this week's matches, recent results, upcoming fixtures, the standings
table, and the list of teams. The organiser corrects results and manages fixture status
(reschedule / postpone / void / walkover / forfeit) from here.

**Who uses it + device.** A league organiser. Used **on a phone and on desktop** — design
for both.

**Auth / launch.** A private link carrying a **league admin token** (`?token=…` or
`/league/<token>`). No login. If the link belongs to a venue admin who runs **more than one
league**, the screen instead shows a **"pick a league"** prompt (the user opens the
league-specific link). Design: token entry/gate, loading, and an error ("Could not load")
state; plus the "requires league pick" list state.

**App shell.**
- **Header**: league name, venue name + league code (e.g. "North United · NUL01"), an
  **On Air / Standby** badge (On Air = a match is in progress), a live clock, a **Refresh**
  button, and a scrolling ticker (venue, competitions, team count, season count, this-week
  fixture count).
- **Tab nav**: `Operations · Table · Teams`.
- **Global states**: gate (no token), loading, error.

---

## Screen 1 — Operations (default)

**Purpose.** The fixtures board: this week, recent results, and upcoming — with the ability
to correct results and manage fixture status.

**Audience / role.** League administrator. Read + write.

**Data shown.** A three-panel layout:
- **This week** — count badge; fixture cards; empty → "No fixtures scheduled this week."
- **Recent results** — up to ~12 most-recent completed fixtures (compact, scores shown);
  empty → "No completed fixtures yet."
- **Upcoming** — up to ~12 future fixtures (compact); sorted by date/time.

**Fixture card** fields:
- Kickoff time + date ("Wed 15 May").
- **Status pill**: *Scheduled · Allocated · Live · Result · Postponed · Void · Walkover ·
  Forfeit*.
- Home team name + away team name (or "(bye)" if there's no away team), each with its team
  colour as an accent.
- Score if completed (home–away); walkover shown as e.g. 3–0.
- Round name if present (e.g. "Round 5").
- Buttons (status-dependent): **Edit result** (completed fixtures), **Manage** (scheduled /
  allocated / postponed fixtures).

**States.** Loading (skeleton); per-panel empty states; error. Status drives which button a
card shows.

**Interactions.**
- **Edit result** → modal: correct home/away scores + a reason → saves.
- **Manage** → modal whose options depend on status:
  - *scheduled / allocated*: reschedule (new date/time, optional reason), postpone (reason),
    void (reason), walkover (pick winner), forfeit (pick winner + reason).
  - *postponed*: reschedule or void.
  - Validation: reschedule needs date+time; postpone/void/forfeit need a reason;
    walkover/forfeit need a winner.

**Real-time.** No live subscription — the organiser taps **Refresh** to reload.

---

## Screen 2 — Table (standings)

**Purpose.** The league's standings for its round-robin competition(s).

**Audience / role.** League administrator.

**Data shown.**
- Header: "League Table · updates as results come in." A competition dropdown if more than
  one round-robin competition exists.
- Table columns: **#** (position) · **Team** (with colour) · **P** · **W** · **D** · **L** ·
  **GF** · **GA** (GF/GA may hide on mobile) · **GD** (colour-coded +/−/0) · **Pts** (bold).
  Top 3 rows highlighted. Teams with no games show zeros.

**States.** No round-robin competition → "No round-robin competition yet." Loading; error;
populated; empty (no teams).

**Interactions.** Switch competition via the dropdown (re-fetches that competition's table).

**Real-time.** Reflects results as they're entered (on refresh).

---

## Screen 3 — Teams

**Purpose.** Browse the teams registered to this league.

**Audience / role.** League administrator.

**Data shown.**
- Header: "Teams · {N} teams in this league" + a live search box.
- **Team cards** (grid): a generated crest (gradient from the team's two colours + a
  two-letter monogram), the team name, and a "League team" label.

**States.** Empty → "No teams registered yet." Populated grid. Filtered → matching subset.

**Interactions.** Type to filter teams by name (case-insensitive). No drill-down (read-only).

**Real-time.** No.

---

## Data contract appendix

Field names are what your components should expect as props.

**League state** (feeds the shell + Operations):
```
league: { id, name, league_code }
venue: { id, name, primary_colour? }
seasons: [{ id, name, … }]
competitions: [{ id, name, type ('league'|'cup'),
                 format ('round_robin'|'single_elimination'|'group_stage') }]
fixtures: {
  this_week: [Fixture], upcoming: [Fixture], recent: [Fixture]
}
requires_league_pick?: true        // shown instead of the dashboard for multi-league admins

Fixture = {
  id,
  status ('scheduled'|'allocated'|'in_progress'|'completed'|'postponed'|'void'|'walkover'|'forfeit'),
  home_team_id, away_team_id (nullable → "(bye)"),
  home_score?, away_score?,
  scheduled_date, kickoff_time, round_name?
}
```

**Teams** (Teams tab; also builds the id→name map Operations uses for fixture cards):
```
teams: [{ id, name, primary_colour, secondary_colour }]
```

**Standings** (Table tab — fetched per competition):
```
standings: [{ rank, team_id, team_name, primary_colour,
              played, w, d, l, gf, ga, gd, pts }]
```

> Note on naming: team names on fixture cards are resolved from the `teams` list by
> `home_team_id` / `away_team_id`. Always show real team names; a missing away team renders
> as "(bye)".
