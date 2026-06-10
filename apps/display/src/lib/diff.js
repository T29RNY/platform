// Payload diffing for animations — HANDOVER §9. Pure: returns what changed,
// App dispatches (celebration queue, score punches handled per-component).

function eventKey(fixtureId, ev) {
  return `${fixtureId}|${ev.type}|${ev.minute}|${ev.player_name || ""}|${ev.team_id || ""}`;
}

function collectGoalEvents(payload) {
  const map = new Map();
  for (const f of payload?.live_fixtures || []) {
    for (const ev of f.recent_events || []) {
      if (ev.type !== "goal") continue;
      map.set(eventKey(f.fixture_id, ev), { ...ev, fixture: f });
    }
  }
  return map;
}

// Returns { celebrations: [{plr, team, c, min}] } — new goal events only.
export function diffPayloads(prev, next) {
  const celebrations = [];
  if (prev && next) {
    const prevEvents = collectGoalEvents(prev);
    const nextEvents = collectGoalEvents(next);
    for (const [id, ev] of nextEvents) {
      if (prevEvents.has(id)) continue;
      const f = ev.fixture;
      const isHome = ev.team_id === f.home_team_id;
      celebrations.push({
        plr: ev.player_name || "GOAL",
        team: isHome ? f.home_team_name : f.away_team_name,
        c: (isHome ? f.home_primary_colour : f.away_primary_colour) || "#FFC83A",
        cH: f.home_primary_colour || "#FFC83A",
        cA: f.away_primary_colour || "#FF1A38",
        min: ev.minute != null ? `${ev.minute}'` : "",
      });
    }
  }
  return { celebrations };
}
