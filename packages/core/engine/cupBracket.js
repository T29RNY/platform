// CUP BRACKET — Pure tournament generator for League Mode Phase 2.
//
// Two formats:
//   'single_elimination'
//     — Byes given to top seeds; the remaining teams pair in round 1.
//     — Engine returns ONLY round 1 fixtures. Subsequent rounds are
//       described in the `bracket` array as placeholders; the ref view
//       (Phase 3) populates each next round with winners as results
//       land. This avoids needing winners up-front to satisfy the
//       fixtures.home_team_id NOT NULL constraint.
//
//   'group_stage'
//     — Teams divided into N groups (default 2). Round-robin within
//       each group using the same circle method as roundRobin.js.
//     — Knockout phase from group survivors is deferred to Phase 11.
//
// Inputs (single_elimination):
//   teams         — string[], ≥2.
//   format        — 'single_elimination'.
//   seedings      — optional ordered top-seeds. Remaining teams are
//                    appended in given order (shuffle externally if
//                    randomness wanted — engine stays deterministic).
//   startWeek     — number, week_number for round 1 fixtures.
//   scheduledDate — 'YYYY-MM-DD' of round 1.
//   kickoffTime   — 'HH:MM' default for round 1.
//
// Inputs (group_stage):
//   teams, format='group_stage', seedings (optional),
//   groupCount    — number, default 2.
//   weeks         — number of weeks for group stage.
//   startDate     — first match week.
//   slotTimes     — same shape as roundRobin.js.
//   pitches       — same shape as roundRobin.js.
//
// Returns:
//   {
//     fixtures: [...same shape as roundRobin output...],
//     bracket: [                            // single_elimination only
//       { round_number, round_name, slots: [
//           { home_team_id|null, away_team_id|null, source: 'seed'|'tbd' }
//         ] }
//     ],
//     groups: [                              // group_stage only
//       { group_name: 'A', team_ids: [...] }
//     ],
//     warnings: string[]
//   }
//
// Throws (codes):
//   'teams_required', 'teams_too_few', 'duplicate_teams',
//   'invalid_format', 'invalid_group_count', 'capacity_insufficient'

import { generateRoundRobin } from './roundRobin.js';

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function nextPowerOfTwo(n) {
  if (n < 2) return 2;
  return 2 ** Math.ceil(Math.log2(n));
}

function validateTeams(teams) {
  if (!Array.isArray(teams) || teams.length === 0) throw err('teams_required');
  if (teams.length < 2) throw err('teams_too_few');
  const seen = new Set();
  for (const t of teams) {
    if (typeof t !== 'string' || t.length === 0) throw err('teams_required');
    if (seen.has(t)) throw err('duplicate_teams', `duplicate: ${t}`);
    seen.add(t);
  }
}

function normalizeKickoff(s) {
  if (typeof s !== 'string') throw err('invalid_kickoff_time');
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw err('invalid_kickoff_time', `bad kickoff: ${s}`);
  const hh = String(Number(m[1])).padStart(2, '0');
  const mm = String(Number(m[2])).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

function orderedTeams(teams, seedings) {
  if (!seedings || seedings.length === 0) return [...teams];
  const seedSet = new Set(seedings);
  // Seeded teams first (in given order), then non-seeded in given order
  const seeded = seedings.filter((t) => teams.includes(t));
  const unseeded = teams.filter((t) => !seedSet.has(t));
  return [...seeded, ...unseeded];
}

function roundName(roundsRemaining) {
  if (roundsRemaining === 0) return 'Final';
  if (roundsRemaining === 1) return 'Semi-final';
  if (roundsRemaining === 2) return 'Quarter-final';
  if (roundsRemaining === 3) return 'Round of 16';
  if (roundsRemaining === 4) return 'Round of 32';
  return `Round of ${2 ** (roundsRemaining + 1)}`;
}

// SINGLE ELIMINATION
function generateSingleElim({
  teams,
  seedings,
  startWeek,
  scheduledDate,
  kickoffTime,
}) {
  validateTeams(teams);
  if (!Number.isInteger(startWeek) || startWeek < 1) {
    throw err('invalid_start_week');
  }
  const ko = normalizeKickoff(kickoffTime || '19:30');

  const ordered = orderedTeams(teams, seedings);
  const n = ordered.length;
  const bracketSize = nextPowerOfTwo(n);
  const byes = bracketSize - n;

  // Top `byes` seeds get a free pass to round 2.
  const seedsWithBye = ordered.slice(0, byes);
  const round1Teams = ordered.slice(byes);

  // Round 1 pairing: standard "highest seed plays lowest seed" amongst
  // the remaining teams. round1Teams is already ordered seed-high → seed-low.
  // Pair (top) vs (bottom) — index i vs index (len - 1 - i)
  const round1Fixtures = [];
  for (let i = 0; i < round1Teams.length / 2; i++) {
    const home = round1Teams[i];
    const away = round1Teams[round1Teams.length - 1 - i];
    round1Fixtures.push({
      week_number: startWeek,
      home_team_id: home,
      away_team_id: away,
      scheduled_date: scheduledDate,
      kickoff_time: ko,
      round_name: roundName(Math.log2(bracketSize) - 1),
      pitch_index: i,
      slot_index: 0,
    });
  }

  // Build the bracket structure for visualisation.
  const totalRounds = Math.log2(bracketSize);
  const bracket = [];

  // Round 1
  const round1Slots = [];
  // Seed bye slots first — they're paired into round 2, not round 1
  for (const seed of seedsWithBye) {
    round1Slots.push({ home_team_id: seed, away_team_id: null, source: 'bye' });
  }
  for (const fx of round1Fixtures) {
    round1Slots.push({
      home_team_id: fx.home_team_id,
      away_team_id: fx.away_team_id,
      source: 'seed',
    });
  }
  bracket.push({
    round_number: 1,
    round_name: roundName(totalRounds - 1),
    slots: round1Slots,
  });

  // Rounds 2..final: all TBD
  for (let r = 2; r <= totalRounds; r++) {
    const slotCount = bracketSize / (2 ** r);
    const slots = [];
    for (let i = 0; i < slotCount; i++) {
      slots.push({ home_team_id: null, away_team_id: null, source: 'tbd' });
    }
    bracket.push({
      round_number: r,
      round_name: roundName(totalRounds - r),
      slots,
    });
  }

  return {
    fixtures: round1Fixtures,
    bracket,
    groups: [],
    warnings: byes > 0
      ? [`${byes} bye(s) awarded to top seed(s); they enter at round 2.`]
      : [],
  };
}

// GROUP STAGE
function generateGroupStage({
  teams,
  seedings,
  groupCount = 2,
  weeks,
  startDate,
  pitches = 1,
  slotTimes = ['19:30'],
  weekdayInterval = 7,
}) {
  validateTeams(teams);
  if (!Number.isInteger(groupCount) || groupCount < 2) {
    throw err('invalid_group_count');
  }
  if (groupCount > teams.length / 2) {
    throw err('invalid_group_count', 'each group needs ≥2 teams');
  }

  // Snake-seed teams into groups for balanced strength distribution.
  const ordered = orderedTeams(teams, seedings);
  const groups = Array.from({ length: groupCount }, () => []);
  let dir = 1;
  let g = 0;
  for (const t of ordered) {
    groups[g].push(t);
    g += dir;
    if (g === groupCount) {
      g = groupCount - 1;
      dir = -1;
    } else if (g < 0) {
      g = 0;
      dir = 1;
    }
  }

  const groupOutputs = groups.map((teamIds, idx) => ({
    group_name: String.fromCharCode(65 + idx), // 'A','B','C'…
    team_ids: teamIds,
  }));

  // Generate round-robin within each group, then concatenate fixtures.
  // Group label is carried on each fixture for downstream display.
  const allFixtures = [];
  const warnings = [];
  for (const gr of groupOutputs) {
    if (gr.team_ids.length < 2) {
      warnings.push(`Group ${gr.group_name} has fewer than 2 teams; no fixtures generated.`);
      continue;
    }
    const rr = generateRoundRobin({
      teams: gr.team_ids,
      weeks,
      startDate,
      doubleRound: false,
      pitches,
      slotTimes,
      weekdayInterval,
    });
    for (const fx of rr.fixtures) {
      allFixtures.push({ ...fx, group_name: gr.group_name });
    }
    if (rr.warnings.length) warnings.push(...rr.warnings);
  }

  return {
    fixtures: allFixtures,
    bracket: [],
    groups: groupOutputs,
    warnings,
  };
}

export function generateCupBracket(args = {}) {
  const { format } = args;
  if (format === 'single_elimination') return generateSingleElim(args);
  if (format === 'group_stage') return generateGroupStage(args);
  throw err('invalid_format', `format must be single_elimination or group_stage; got ${format}`);
}

export default generateCupBracket;
