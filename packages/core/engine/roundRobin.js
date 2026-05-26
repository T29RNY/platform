// ROUND ROBIN — Pure fixture generator for League Mode Phase 2.
//
// Uses the classic "circle method": fix team 0 in position 0, rotate
// the rest one position per round. For odd team counts, a phantom bye
// slot is inserted; whichever team is paired with the phantom that
// week takes the bye.
//
// Home/Away: the fixed top pairing alternates home/away each round so
// the otherwise-overweighted "fixed" team gets a fair home/away split.
// Other pairings keep position-A-is-home (which already alternates
// naturally via rotation). For doubleRound, the second half mirrors
// the first with all home/away swapped, so every pair plays once home
// and once away across the full season.
//
// Pitch + slot allocation: round fixtures are distributed across the
// (pitches × slotTimes) grid in row-major order (pitch 0 slot 0, pitch
// 1 slot 0, pitch 2 slot 0, pitch 0 slot 1, …). The caller validates
// upfront that `pitches * slotTimes.length >= ceil(teams.length / 2)`
// — i.e. all fixtures fit one match night per round.
//
// Inputs:
//   teams           — string[], ≥2 unique team IDs.
//   weeks           — number, total match weeks available post-exclude.
//   startDate       — 'YYYY-MM-DD' of week 1's match night.
//   excludeWeeks    — number[] of calendar week numbers to skip
//                      (counted from 1). e.g. [3, 7] skips weeks 3+7.
//   doubleRound     — boolean. If true, play each opponent twice.
//   pitches         — number, available pitches per night.
//   slotTimes       — string[], 'HH:MM' kickoff per slot.
//   weekdayInterval — number of days between consecutive match weeks.
//                      Default 7. Use 14 for fortnightly.
//
// Returns:
//   {
//     fixtures: [{
//       week_number, home_team_id, away_team_id,
//       scheduled_date ('YYYY-MM-DD'), kickoff_time ('HH:MM:SS'),
//       pitch_index, slot_index
//     }, …],
//     byes: [{ week_number, team_id }, …],
//     rounds_needed: number,         // logical rounds (pre week-skip)
//     weeks_used: number,            // last week_number assigned
//     warnings: string[]             // soft issues, never errors
//   }
//
// Throws:
//   'teams_required'             — teams empty
//   'teams_too_few'              — fewer than 2 teams
//   'duplicate_teams'            — duplicate IDs in teams[]
//   'weeks_insufficient'         — not enough weeks for the rounds needed
//   'capacity_insufficient'      — pitches × slots < ceil(teams/2)
//   'invalid_start_date'         — bad date
//   'invalid_kickoff_time'       — bad HH:MM
//
// All errors are thrown as plain Error with .code set to the string.

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function isoAddDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw err('invalid_start_date');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeKickoff(s) {
  if (typeof s !== 'string') throw err('invalid_kickoff_time');
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw err('invalid_kickoff_time', `bad kickoff: ${s}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) throw err('invalid_kickoff_time');
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

// One single round of fixtures using the circle method.
// `rotation` is the current circle; rotates clockwise (positions 1..n-1)
// after each round, with position 0 fixed.
function pairRound(rotation) {
  const n = rotation.length;
  const half = n / 2;
  const pairs = [];
  for (let i = 0; i < half; i++) {
    pairs.push([rotation[i], rotation[n - 1 - i]]);
  }
  return pairs;
}

function rotateClockwise(rotation) {
  // Position 0 stays. Position 1 receives the value from position n-1.
  // Positions 2..n-1 receive the value from the previous position.
  const n = rotation.length;
  const last = rotation[n - 1];
  for (let i = n - 1; i > 1; i--) rotation[i] = rotation[i - 1];
  rotation[1] = last;
}

export function generateRoundRobin({
  teams,
  weeks,
  startDate,
  excludeWeeks = [],
  doubleRound = false,
  pitches = 1,
  slotTimes = ['19:30'],
  weekdayInterval = 7,
} = {}) {
  // -------- Input validation
  if (!Array.isArray(teams) || teams.length === 0) throw err('teams_required');
  if (teams.length < 2) throw err('teams_too_few');
  const seen = new Set();
  for (const t of teams) {
    if (typeof t !== 'string' || t.length === 0) throw err('teams_required');
    if (seen.has(t)) throw err('duplicate_teams', `duplicate: ${t}`);
    seen.add(t);
  }
  if (!Number.isInteger(weeks) || weeks < 1) throw err('weeks_insufficient');
  if (!Array.isArray(slotTimes) || slotTimes.length === 0) {
    throw err('invalid_kickoff_time', 'slotTimes required');
  }
  const normalisedSlots = slotTimes.map(normalizeKickoff);
  if (!Number.isInteger(pitches) || pitches < 1) {
    throw err('capacity_insufficient', 'pitches < 1');
  }
  isoAddDays(startDate, 0); // validates

  // -------- Topology
  const hasBye = teams.length % 2 === 1;
  const circle = hasBye ? [...teams, null] : [...teams];
  const N = circle.length;
  const fixturesPerRound = Math.floor(teams.length / 2); // excludes bye
  const capacity = pitches * normalisedSlots.length;
  if (fixturesPerRound > capacity) {
    throw err(
      'capacity_insufficient',
      `${fixturesPerRound} fixtures per round > capacity ${capacity}`
    );
  }
  const baseRounds = N - 1;
  const totalRounds = doubleRound ? baseRounds * 2 : baseRounds;

  // -------- Week assignment honouring excludeWeeks
  const excludeSet = new Set(excludeWeeks.filter(Number.isFinite));
  const weekNumbers = [];
  for (let w = 1; weekNumbers.length < totalRounds && w <= weeks; w++) {
    if (excludeSet.has(w)) continue;
    weekNumbers.push(w);
  }
  if (weekNumbers.length < totalRounds) {
    throw err(
      'weeks_insufficient',
      `need ${totalRounds} rounds, only ${weekNumbers.length} weeks available`
    );
  }

  // -------- Generate fixtures
  const fixtures = [];
  const byes = [];
  const warnings = [];
  const rotation = [...circle];

  for (let r = 0; r < baseRounds; r++) {
    const pairs = pairRound(rotation);
    // home/away alternation for the fixed top pairing
    const topSwap = r % 2 === 1;

    let slotCursor = 0; // distributes across (pitch × slot) row-major
    for (let i = 0; i < pairs.length; i++) {
      const [a, b] = pairs[i];
      const w1 = weekNumbers[r];
      const date1 = isoAddDays(startDate, (w1 - 1) * weekdayInterval);

      if (a === null || b === null) {
        const team = a === null ? b : a;
        byes.push({ week_number: w1, team_id: team });
        continue;
      }

      // Position 0 (i === 0) gets alternated for balance.
      let home = a;
      let away = b;
      if (i === 0 && topSwap) {
        home = b;
        away = a;
      }

      const pitch_index = slotCursor % pitches;
      const slot_index = Math.floor(slotCursor / pitches);
      slotCursor++;

      const fx = {
        week_number: w1,
        home_team_id: home,
        away_team_id: away,
        scheduled_date: date1,
        kickoff_time: normalisedSlots[slot_index],
        pitch_index,
        slot_index,
      };
      fixtures.push(fx);

      // Mirror leg for doubleRound — same pairing, swapped home/away,
      // in the second half of the season.
      if (doubleRound) {
        const w2 = weekNumbers[r + baseRounds];
        fixtures.push({
          week_number: w2,
          home_team_id: away,
          away_team_id: home,
          scheduled_date: isoAddDays(startDate, (w2 - 1) * weekdayInterval),
          kickoff_time: normalisedSlots[slot_index],
          pitch_index,
          slot_index,
        });
      }
    }
    rotateClockwise(rotation);
  }

  // Carry byes forward for doubleRound's mirror half
  if (doubleRound) {
    const baseByes = [...byes];
    for (const b of baseByes) {
      // find the mirror week
      const baseIdx = weekNumbers.indexOf(b.week_number);
      if (baseIdx >= 0 && baseIdx + baseRounds < weekNumbers.length) {
        byes.push({
          week_number: weekNumbers[baseIdx + baseRounds],
          team_id: b.team_id,
        });
      }
    }
  }

  return {
    fixtures,
    byes,
    rounds_needed: totalRounds,
    weeks_used: weekNumbers[weekNumbers.length - 1],
    warnings,
  };
}

export default generateRoundRobin;
