#!/usr/bin/env node
// seed-demo.js — full demo data seed for Supabase production
// Run: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/seed-demo.js
//
// Seeds: team_demo, 25 players, 22 matches (20 played + 2 cancelled),
//        player_match rows, player_injuries, schedule, settings, demo_sessions,
//        bib_history

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ktvpzpnqbwhooiaqrigm.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY env var is required");
  console.error("Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/seed-demo.js");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Name + ID helpers ──────────────────────────────────────────────────────────
const NAMES = {
  1:'Hassan', 2:'Dave',  3:'Mike',   4:'Steve',  5:'Jordan', 6:'Liam',
  7:'Callum', 8:'Chris', 9:'Robbie', 10:'Finbar',11:'Paul',  12:'Tom',
  13:'Kieran',14:'Declan',15:'Sarah',16:'Priya', 17:'Maya',  18:'Aisha',
  19:'Marcus',20:'Danny',21:'Ryan',  22:'Aaron', 23:'Luke',  24:'Gav',   25:'Tarny',
};
const pid = n => `p_demo_${String(n).padStart(2,'0')}`;
const tok = n => `p_demotoken_${String(n).padStart(2,'0')}`;

// ── Canonical match data ───────────────────────────────────────────────────────
// [matchId, winner, teamA_nums[], teamB_nums[], {scorer_num:goals}, motm_num, bib_num]
const DEMO_MATCH_DATA = [
  ['m_demo_01','A',[1,20,4,10,15,16,7], [2,3,23,25,13,21,9], {1:2,20:1,15:1,2:1,21:1}, 1,3],
  ['m_demo_02','A',[2,4,10,19,13,22,23],[1,20,7,3,16,25,21], {2:2,19:1,1:1,20:1},       2,3],
  ['m_demo_03','A',[1,20,4,10,19,15,16],[2,3,7,23,25,21,5],  {1:2,19:2,15:1,2:1,21:1},  19,3],
  ['m_demo_04','B',[1,20,4,10,16,6,7],  [2,3,23,25,13,11,21],{1:1,20:1,2:2,21:1},        2,23],
  ['m_demo_05','A',[1,20,4,10,16,24,15],[2,3,7,23,25,13,21], {1:2,20:1,15:1,2:1},        1,3],
  ['m_demo_06','B',[2,4,10,9,22,23,25], [1,20,7,3,16,15,21], {22:1,1:1,20:1,15:2},       15,7],
  ['m_demo_07','A',[2,1,4,10,19,24,16], [3,20,7,23,25,21,13],{2:2,1:1,19:1,3:1,21:1},   2,3],
  ['m_demo_09','A',[2,4,10,3,12,23,25], [1,20,7,16,15,5,21], {2:2,3:1,1:1,20:1},         2,10],
  ['m_demo_10','A',[1,20,4,10,19,16,13],[2,3,7,23,25,21,18], {1:2,19:2,2:1},             1,3],
  ['m_demo_11','A',[1,20,4,10,15,16,8], [2,3,7,23,25,21,14], {1:1,20:2,2:1,21:1},        20,3],
  ['m_demo_12','A',[2,4,10,19,24,22,23],[1,20,7,3,16,25,21], {2:2,19:1,1:1,21:1},        2,2],
  ['m_demo_13','A',[1,20,4,10,15,16,13],[2,3,7,23,25,21,9],  {1:2,20:1,15:1,2:1,9:1},   1,25],
  ['m_demo_14','A',[1,20,4,10,15,16,11],[2,3,7,23,25,21,6],  {15:2,1:1,2:1},             15,4],
  ['m_demo_16','A',[2,4,10,19,13,22,23],[1,20,7,3,16,25,21], {2:2,19:2,1:2,20:1},        2,16],
  ['m_demo_17','A',[1,20,4,10,19,16,13],[2,3,7,24,23,25,21], {19:3,1:1,20:1,2:2,21:1},  19,23],
  ['m_demo_18','A',[1,20,4,10,15,16,13],[2,3,7,23,25,21,9],  {1:3,15:1,2:1,21:1},        1,7],
  ['m_demo_19','B',[1,20,4,10,19,16,13],[2,3,7,22,23,25,21], {1:2,20:1,3:2,2:1,21:1},   3,3],
  ['m_demo_20','A',[2,4,10,9,24,23,25], [1,20,7,3,16,15,21], {2:3,9:1,1:1,15:1},         2,9],
  ['m_demo_21','A',[1,20,4,10,15,16,19],[2,3,7,23,25,21,22], {20:2,1:1,15:1,2:1,3:1},   20,10],
  ['m_demo_22','A',[1,20,4,10,15,16,14],[2,3,7,24,23,25,21], {15:2,1:1,2:1,3:1},         15,25],
];

// Cancelled matches (m_demo_08 and m_demo_15 skipped in data = these were cancelled weeks)
const CANCELLED_MATCHES = [
  { id:'m_demo_08', reason:'Opposition cancelled last minute' },
  { id:'m_demo_15', reason:'Venue unavailable' },
];

// ── Player baseline stats ─────────────────────────────────────────────────────
const DEMO_BASELINE = [
  { n:1,  goals:18, motm:6,  attended:20, w:13, l:5, d:2, bib_count:2, pay_count:20, late_dropouts:1, owes:0  },
  { n:2,  goals:8,  motm:9,  attended:19, w:12, l:5, d:2, bib_count:3, pay_count:18, late_dropouts:2, owes:0  },
  { n:3,  goals:6,  motm:3,  attended:18, w:11, l:5, d:2, bib_count:8, pay_count:16, late_dropouts:3, owes:0  },
  { n:4,  goals:4,  motm:2,  attended:22, w:14, l:6, d:2, bib_count:1, pay_count:22, late_dropouts:0, owes:0  },
  { n:5,  goals:3,  motm:1,  attended:12, w:7,  l:3, d:2, bib_count:1, pay_count:10, late_dropouts:5, owes:0  },
  { n:6,  goals:5,  motm:1,  attended:16, w:10, l:4, d:2, bib_count:2, pay_count:12, late_dropouts:7, owes:0  },
  { n:7,  goals:3,  motm:2,  attended:20, w:13, l:5, d:2, bib_count:3, pay_count:19, late_dropouts:1, owes:0  },
  { n:8,  goals:4,  motm:1,  attended:17, w:10, l:5, d:2, bib_count:2, pay_count:10, late_dropouts:3, owes:15 },
  { n:9,  goals:7,  motm:3,  attended:15, w:8,  l:5, d:2, bib_count:2, pay_count:14, late_dropouts:2, owes:0  },
  { n:10, goals:0,  motm:0,  attended:22, w:14, l:6, d:2, bib_count:4, pay_count:22, late_dropouts:0, owes:0  },
  { n:11, goals:2,  motm:0,  attended:10, w:6,  l:3, d:1, bib_count:1, pay_count:10, late_dropouts:1, owes:0  },
  { n:12, goals:4,  motm:1,  attended:8,  w:5,  l:2, d:1, bib_count:1, pay_count:8,  late_dropouts:0, owes:0  },
  { n:13, goals:3,  motm:1,  attended:14, w:9,  l:4, d:1, bib_count:2, pay_count:13, late_dropouts:2, owes:0  },
  { n:14, goals:1,  motm:0,  attended:8,  w:5,  l:2, d:1, bib_count:0, pay_count:6,  late_dropouts:1, owes:0  },
  { n:15, goals:11, motm:4,  attended:18, w:11, l:5, d:2, bib_count:2, pay_count:17, late_dropouts:1, owes:0  },
  { n:16, goals:6,  motm:2,  attended:20, w:13, l:5, d:2, bib_count:1, pay_count:20, late_dropouts:0, owes:0  },
  { n:17, goals:5,  motm:2,  attended:14, w:8,  l:4, d:2, bib_count:2, pay_count:12, late_dropouts:3, owes:0  },
  { n:18, goals:3,  motm:1,  attended:13, w:8,  l:3, d:2, bib_count:1, pay_count:10, late_dropouts:5, owes:0  },
  { n:19, goals:14, motm:3,  attended:16, w:10, l:4, d:2, bib_count:1, pay_count:15, late_dropouts:1, owes:0  },
  { n:20, goals:7,  motm:2,  attended:18, w:12, l:4, d:2, bib_count:2, pay_count:17, late_dropouts:1, owes:0  },
  { n:21, goals:5,  motm:2,  attended:17, w:10, l:5, d:2, bib_count:3, pay_count:16, late_dropouts:2, owes:0  },
  { n:22, goals:4,  motm:1,  attended:16, w:11, l:3, d:2, bib_count:2, pay_count:15, late_dropouts:1, owes:0  },
  { n:23, goals:3,  motm:1,  attended:19, w:12, l:5, d:2, bib_count:1, pay_count:19, late_dropouts:0, owes:0  },
  { n:24, goals:4,  motm:1,  attended:11, w:7,  l:3, d:1, bib_count:1, pay_count:10, late_dropouts:2, owes:0  },
  { n:25, goals:6,  motm:2,  attended:18, w:11, l:5, d:2, bib_count:1, pay_count:18, late_dropouts:1, owes:0  },
];

// ── Date helpers ───────────────────────────────────────────────────────────────
// 22 Tuesdays ending at 2026-05-12 (most recent Tuesday before script date)
function matchDates() {
  const end = new Date('2026-05-12T12:00:00Z');
  return Array.from({ length: 22 }, (_, i) => {
    const d = new Date(end);
    d.setDate(end.getDate() - (21 - i) * 7);
    return d;
  });
}

function fmtLong(d)  { return d.toLocaleDateString('en-GB', { day:'numeric', month:'long',  year:'numeric', timeZone:'UTC' }); }
function fmtShort(d) { return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', timeZone:'UTC' }); }

async function run(label, fn) {
  process.stdout.write(`  ${label}... `);
  try { await fn(); console.log('✓'); }
  catch(e) { console.log(`✗ ${e.message}`); }
}

async function upsert(table, rows, conflict) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict });
  if (error) throw error;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Demo Data Seed ===\n');
  const dates = matchDates();

  // 1. Team
  await run('teams: team_demo', async () => {
    await upsert('teams', [{
      id: 'team_demo',
      name: "Finbar's Tuesdays",
      admin_token: 'admin_demo',
      join_code: 'demo',
    }], 'id');
  });

  // 2. Players (25)
  await run('players: 25 demo players', async () => {
    const rows = DEMO_BASELINE.map(b => ({
      id: pid(b.n),
      name: NAMES[b.n],
      type: 'regular',
      disabled: false,
      priority: [1,2,4,10].includes(b.n), // Hassan, Dave, Steve, Finbar
      deputy: b.n === 3, // Mike
      status: 'none',
      paid: false,
      owes: b.owes,
      goals: b.goals,
      motm: b.motm,
      attended: b.attended,
      total: 22,
      bib_count: b.bib_count,
      team: null,
      w: b.w,
      l: b.l,
      d: b.d,
      pay_count: b.pay_count,
      late_dropouts: b.late_dropouts,
      note: '',
      self_paid: false,
      paid_by: null,
      token: tok(b.n),
      is_guest: false,
      guest_of: null,
      injured: false,
      injured_since: null,
      nickname: null,
    }));
    await upsert('players', rows, 'id');
  });

  // 3. team_players (link all 25 to team_demo)
  await run('team_players: link 25 players', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      team_id: 'team_demo',
      player_id: pid(i + 1),
    }));
    await upsert('team_players', rows, 'team_id,player_id');
  });

  // 4. Matches (20 played + 2 cancelled = 22)
  await run('matches: 22 demo matches', async () => {
    const matchRows = [];

    // All 22 slots with their dates; indices where cancelled: 7 = m_demo_08, 14 = m_demo_15
    const allIds = [
      'm_demo_01','m_demo_02','m_demo_03','m_demo_04','m_demo_05','m_demo_06',
      'm_demo_07','m_demo_08','m_demo_09','m_demo_10','m_demo_11','m_demo_12',
      'm_demo_13','m_demo_14','m_demo_15','m_demo_16','m_demo_17','m_demo_18',
      'm_demo_19','m_demo_20','m_demo_21','m_demo_22',
    ];
    const cancelledSet = new Set(['m_demo_08','m_demo_15']);
    const cancelledReasons = { 'm_demo_08':'Opposition cancelled last minute', 'm_demo_15':'Venue unavailable' };

    // Build lookup from match data
    const dataByMid = {};
    for (const entry of DEMO_MATCH_DATA) dataByMid[entry[0]] = entry;

    for (let i = 0; i < allIds.length; i++) {
      const mid = allIds[i];
      const d   = dates[i];
      if (cancelledSet.has(mid)) {
        matchRows.push({
          id: mid,
          team_id: 'team_demo',
          date: fmtLong(d),
          date_short: fmtShort(d),
          team_a: [], team_b: [],
          winner: null, score_a: 0, score_b: 0,
          scorers: {}, motm: null, bib_holder: '',
          payments: {}, cancelled: true, cancel_reason: cancelledReasons[mid],
          voting_open: false,
        });
        continue;
      }

      const [, winner, ta, tb, scorersRaw, motm_n, bib_n] = dataByMid[mid];
      const taSet = new Set(ta);
      const scoreA = ta.reduce((s, n) => s + (scorersRaw[n] || 0), 0);
      const scoreB = tb.reduce((s, n) => s + (scorersRaw[n] || 0), 0);
      const scorerNames = {};
      for (const [n, g] of Object.entries(scorersRaw)) scorerNames[NAMES[+n]] = g;
      const payments = {};
      [...ta, ...tb].forEach(n => { payments[NAMES[n]] = true; });

      matchRows.push({
        id: mid,
        team_id: 'team_demo',
        date: fmtLong(d),
        date_short: fmtShort(d),
        team_a: ta.map(n => NAMES[n]),
        team_b: tb.map(n => NAMES[n]),
        winner, score_a: scoreA, score_b: scoreB,
        scorers: scorerNames,
        motm: NAMES[motm_n],
        bib_holder: pid(bib_n),
        payments,
        cancelled: false, cancel_reason: '',
        voting_open: false,
      });
    }

    await upsert('matches', matchRows, 'id');
  });

  // 5. player_match rows
  await run('player_match: rows for 20 played matches', async () => {
    const pmRows = [];
    for (const [mid, winner, ta, tb, scorersRaw, motm_n, bib_n] of DEMO_MATCH_DATA) {
      const push = (nums, side) => {
        for (const n of nums) {
          pmRows.push({
            team_id: 'team_demo',
            match_id: mid,
            player_id: pid(n),
            team_assignment: side,
            result: winner === 'D' ? 'd' : (side === winner ? 'w' : 'l'),
            attended: true,
            was_motm: n === motm_n,
            had_bibs: n === bib_n,
            goals: scorersRaw[n] || 0,
            is_guest: false,
            late_cancel: false,
            injury_absence: false,
          });
        }
      };
      push(ta, 'A');
      push(tb, 'B');
    }

    // Batch insert 50 at a time
    for (let i = 0; i < pmRows.length; i += 50) {
      const { error } = await supabase.from('player_match')
        .upsert(pmRows.slice(i, i + 50), { onConflict: 'match_id,player_id' });
      if (error) throw error;
    }
    console.log(`     (${pmRows.length} rows)`);
  });

  // 6. Player injuries (Gav's history)
  await run('player_injuries: Gav (p_demo_24)', async () => {
    await upsert('player_injuries', [
      { id:'inj_demo_01', player_id:'p_demo_24', team_id:'team_demo', injured_at:'2025-09-28', cleared_at:'2025-10-12', marked_by:'player' },
      { id:'inj_demo_02', player_id:'p_demo_24', team_id:'team_demo', injured_at:'2025-11-16', cleared_at:'2025-11-30', marked_by:'player' },
      { id:'inj_demo_03', player_id:'p_demo_24', team_id:'team_demo', injured_at:'2026-01-11', cleared_at:'2026-02-01', marked_by:'admin' },
      { id:'inj_demo_04', player_id:'p_demo_24', team_id:'team_demo', injured_at:'2026-03-22', cleared_at:'2026-04-06', marked_by:'player' },
    ], 'id');
  });

  // 7. Schedule
  await run('schedule: team_demo', async () => {
    await upsert('schedule', [{
      id: 'sched_demo',
      team_id: 'team_demo',
      day_of_week: 'Tuesday',
      kickoff: '19:00',
      venue: 'Powerleague Salford',
      opens_day: 'Wednesday',
      opens_time: '10:00',
      priority_lead_mins: 60,
      price_per_player: 6,
      game_is_live: true,
      squad_size: 14,
      game_date_time: '2026-05-19T19:00:00',
      is_draft: false,
      is_cancelled: false,
      cancel_reason: '',
      city: 'Manchester',
      lineup_locked: false,
      active_match_id: null,
      voting_open: false,
      voting_closes_at: null,
    }], 'team_id');
  });

  // 8. Settings
  await run('settings: team_demo', async () => {
    await upsert('settings', [{
      id: 'sett_team_demo',
      team_id: 'team_demo',
      group_name: "Finbar's Tuesdays",
    }], 'team_id');
  });

  // 9. demo_sessions
  await run('demo_sessions: main', async () => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('demo_sessions').upsert({
      id: 'main',
      last_reset: now,
      last_interaction: now,
    }, { onConflict: 'id' });
    if (error) throw error;
  });

  // 10. Bib history (last 6 games)
  await run('bib_history: recent entries', async () => {
    const bibMatches = DEMO_MATCH_DATA.slice(-6);
    const rows = bibMatches.map(([mid, , , , , , bib_n], i) => {
      const dateIdx = [16, 17, 18, 19, 20, 21][i];
      return {
        team_id: 'team_demo',
        name: NAMES[bib_n],
        date: fmtShort(dates[dateIdx]),
        returned: i < 5,
      };
    });
    const { error } = await supabase.from('bib_history').insert(rows);
    if (error && !error.message.includes('duplicate')) throw error;
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n=== Verifying row counts ===\n');
  for (const [table, filter] of [
    ['players',        { column:'id',       op:'like', value:'p_demo_%'  }],
    ['team_players',   { column:'team_id',  op:'eq',   value:'team_demo' }],
    ['matches',        { column:'team_id',  op:'eq',   value:'team_demo' }],
    ['player_match',   { column:'team_id',  op:'eq',   value:'team_demo' }],
    ['player_injuries',{ column:'team_id',  op:'eq',   value:'team_demo' }],
  ]) {
    let q = supabase.from(table).select('*', { count:'exact', head:true });
    if (filter.op === 'like') q = q.like(filter.column, filter.value);
    else                      q = q.eq(filter.column, filter.value);
    const { count, error } = await q;
    console.log(`  ${table.padEnd(18)} ${error ? '✗ ' + error.message : count + ' rows'}`);
  }

  console.log('\nDone.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
