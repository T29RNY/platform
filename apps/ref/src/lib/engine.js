// ============================================================
// engine.js — pure derivation helpers + the pause-aware clock model.
// Lifted from the broadcast-dark artifact (engine.jsx) with the mock
// RPC stubs, scenarios and localStorage store removed — those are now
// the real @platform/core wrappers + IndexedDB offlineQueue.js.
//
// Score & period are ALWAYS derived from match_events, never from
// fixture flat columns. The clock derives from timestamps so it
// survives screen-lock, and accounts for pause exactly the way the
// reception display does (shared formula — they can never disagree):
//   elapsed = now − actual_kickoff_at − clock_paused_ms
//                 − (clock_paused_at ? now − clock_paused_at : 0)
// ============================================================

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }));

export const nowISO = () => new Date().toISOString();

// ---------- derivations (pure) ----------
export function derivePeriod(events) {
  const pcs = events.filter((e) => e.event_type === "period_change");
  return pcs.length ? pcs[pcs.length - 1].period : "1H";
}

// Regular goals add to the scorer's team; own goals flip to the opposite
// side (the RPC stores own_goal under the scorer's own team_id).
export function deriveScore(events, homeId, awayId) {
  let h = 0, a = 0;
  for (const e of events) {
    if (e.event_type === "goal") {
      if (e.team_id === homeId) h++;
      else if (e.team_id === awayId) a++;
    } else if (e.event_type === "own_goal") {
      if (e.team_id === homeId) a++;
      else if (e.team_id === awayId) h++;
    }
  }
  return [h, a];
}

export function hasLineup(squad) { return squad.some((p) => p.lineup_role); }
export function isSuspended(p) {
  return p.suspension_until && new Date(p.suspension_until) > new Date();
}

// Per-player live status from the event stream.
export function playerStatus(events, playerId) {
  let goals = 0, og = 0, yellows = 0, red = false, subbedOff = false, subbedOn = false;
  const sinBins = [];
  for (const e of events) {
    if (e.player_id === playerId) {
      if (e.event_type === "goal") goals++;
      else if (e.event_type === "own_goal") og++;
      else if (e.event_type === "yellow_card") yellows++;
      else if (e.event_type === "red_card") red = true;
      else if (e.event_type === "sin_bin") sinBins.push({ minute: e.minute, duration: e.duration || 10 });
    }
    if (e.event_type === "substitution") {
      if (e.sub_player_off_id === playerId) subbedOff = true;
      if (e.sub_player_on_id === playerId) subbedOn = true;
    }
  }
  return { goals, og, yellows, red, subbedOff, subbedOn, sinBins };
}

// Seconds remaining on an active sin bin for a player (0 = none/expired).
export function sinBinRemaining(sinBins, fixture, now = Date.now()) {
  if (!sinBins || !sinBins.length) return 0;
  const elapsedMin = elapsedMs(fixture, now) / 60000;
  let best = 0;
  for (const sb of sinBins) {
    const remMin = sb.minute + sb.duration - elapsedMin;
    if (remMin > 0) best = Math.max(best, remMin);
  }
  return Math.round(best * 60);
}

export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// ---------- clock model (period-anchored + pausable) ----------
export function elapsedMs(fixture, now = Date.now()) {
  if (!fixture || !fixture.actual_kickoff_at) return 0;
  const ko = new Date(fixture.actual_kickoff_at).getTime();
  let paused = Number(fixture.clock_paused_ms) || 0;
  if (fixture.clock_paused_at) paused += now - new Date(fixture.clock_paused_at).getTime();
  return Math.max(0, now - ko - paused);
}

export function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function currentMinute(fixture, now = Date.now()) {
  return Math.floor(elapsedMs(fixture, now) / 60000);
}

export const PERIOD_LABEL = { "1H": "1ST HALF", HT: "HALF TIME", "2H": "2ND HALF", ET1: "EXTRA 1", ET2: "EXTRA 2", PEN: "PENALTIES", FT: "FULL TIME" };
export const LOCKED_PERIODS = new Set(["HT", "FT"]);

// ---------- match-format config (resolved league→competition→fixture) ----------
// state.match_format from get_fixture_state_by_ref_token. Defaults keep the
// football-first behaviour when a league has no config row yet.
export function resolveFormat(matchFormat) {
  const mf = matchFormat || {};
  return {
    numPeriods: Number(mf.num_periods) || 2,
    periodLengthMins: Number(mf.period_length_mins) || 45,
    periodNames: Array.isArray(mf.period_names) && mf.period_names.length ? mf.period_names : ["1H", "2H"],
    matchDurationMins: Number(mf.match_duration_mins) || 90,
    hasSinBin: mf.has_sin_bin !== false,
    sinBinMins: Number(mf.sin_bin_mins) || 10,
    isOverridden: !!mf.is_overridden,
  };
}
