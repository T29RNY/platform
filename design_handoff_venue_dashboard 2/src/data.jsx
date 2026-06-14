/* Sample data — realistic content following the venue.md data contract.
   Field names match exactly. Money is in pence. */

const DATA_venue = {
  name: 'Greenway Sports Park',
  short_name: 'Greenway',
  bookings_enabled: true,
  payment_link: 'pay.ioo.fc/greenway',
  cancellation_policy: '48h notice, full refund. Under 48h: 50% credit.',
  display_token: 'gw-display-7t3xz',
  display_pin: true,
  default_prime_time_windows: [
    { day: 'mon', from: '18:00', to: '22:00' },
    { day: 'tue', from: '18:00', to: '22:00' },
    { day: 'wed', from: '18:00', to: '22:00' },
    { day: 'thu', from: '18:00', to: '22:00' },
  ],
};

const DATA_leagues = [
  { id: 'l1', name: 'Greenway Premier League', short_name: 'GPL', format: '7-a-side',
    day_of_week: 'wednesday', default_kickoff_time: '19:30',
    standings_visibility: 'public', league_code: 'GW-PREM' },
  { id: 'l2', name: 'Greenway Open Cup', short_name: 'GOC', format: '7-a-side',
    day_of_week: 'thursday', default_kickoff_time: '19:00',
    standings_visibility: 'public', league_code: 'GW-CUP' },
];

const DATA_seasons = [
  { id: 's1', league_id: 'l1', name: 'Spring 2026', start_date: '2026-03-04',
    end_date: '2026-06-24', num_weeks: 16, status: 'active' },
  { id: 's2', league_id: 'l2', name: 'Spring Cup 2026', start_date: '2026-04-15',
    end_date: '2026-06-18', num_weeks: 8, status: 'active' },
  { id: 's3', league_id: 'l1', name: 'Autumn 2025', start_date: '2025-09-10',
    end_date: '2026-01-28', num_weeks: 18, status: 'completed' },
];

const DATA_competitions = [
  { id: 'c1', season_id: 's1', name: 'GPL Division 1', type: 'league', format: 'round_robin' },
  { id: 'c2', season_id: 's1', name: 'GPL Division 2', type: 'league', format: 'round_robin' },
  { id: 'c3', season_id: 's2', name: 'Open Cup — Group Stage', type: 'cup', format: 'group_stage',
    num_groups: 4, qualifiers_per_group: 2 },
  { id: 'c4', season_id: 's2', name: 'Open Cup — Knockout', type: 'cup', format: 'single_elimination' },
];

// Team palette — distinctive primary + secondary
const DATA_teams = {
  t1:  { id: 't1',  name: 'Northside Athletic',     primary_colour: '#1E5BAA', secondary_colour: '#F4D03F' },
  t2:  { id: 't2',  name: 'Eastpark United',         primary_colour: '#C0392B', secondary_colour: '#1B1B1F' },
  t3:  { id: 't3',  name: 'Brockley Rovers',         primary_colour: '#0F7B5A', secondary_colour: '#F4F1E8' },
  t4:  { id: 't4',  name: 'Old Brompton Stars',      primary_colour: '#6E2A8C', secondary_colour: '#F0C75E' },
  t5:  { id: 't5',  name: 'Highbridge FC',           primary_colour: '#E08B1F', secondary_colour: '#2A2A2E' },
  t6:  { id: 't6',  name: 'Marsh Lane Crusaders',    primary_colour: '#28394A', secondary_colour: '#C9B98A' },
  t7:  { id: 't7',  name: 'Wandle Phoenix',          primary_colour: '#B23A48', secondary_colour: '#F7D38C' },
  t8:  { id: 't8',  name: 'Cypress Park Wanderers',  primary_colour: '#0E4D3F', secondary_colour: '#FFFFFF' },
  t9:  { id: 't9',  name: 'Battersea Bulldogs',      primary_colour: '#1F1F22', secondary_colour: '#C0392B' },
  t10: { id: 't10', name: 'Saint Olave\'s Old Boys', primary_colour: '#7E1F2A', secondary_colour: '#E6D9B8' },
  t11: { id: 't11', name: 'Quaybridge Internazionale Reserves', primary_colour: '#000A4B', secondary_colour: '#0EA5E9' },
  t12: { id: 't12', name: 'Honor Oak Hooligans',     primary_colour: '#FFD700', secondary_colour: '#0E0E0C' },
  t13: { id: 't13', name: 'FC Sundown',              primary_colour: '#E94B27', secondary_colour: '#FFE3CC' },
  t14: { id: 't14', name: 'Lewisham Locomotives',    primary_colour: '#1A2A48', secondary_colour: '#E8C547' },
};

const DATA_pitches = [
  { id: 'p1', name: 'Pitch 1 (North)', active: true, is_available: true, surface: '3G', capacity: 14,
    sort_order: 1, maintenance_windows: [], booking_windows: [], prime_time_windows: [] },
  { id: 'p2', name: 'Pitch 2 (Centre)', active: true, is_available: true, surface: '3G', capacity: 14,
    sort_order: 2, maintenance_windows: [], booking_windows: [], prime_time_windows: [] },
  { id: 'p3', name: 'Pitch 3 (South)', active: true, is_available: true, surface: '4G', capacity: 14,
    sort_order: 3, maintenance_windows: [], booking_windows: [], prime_time_windows: [] },
  { id: 'p4', name: 'Pitch 4 (Indoor)', active: true, is_available: false, surface: 'Indoor', capacity: 12,
    sort_order: 4,
    maintenance_windows: [{ from: '2026-06-08T20:00', to: '2026-06-08T21:30', reason: 'Floodlight repair' }],
    booking_windows: [], prime_time_windows: [] },
  { id: 'p5', name: 'Pitch 5 (Cage)', active: false, is_available: false, surface: 'Hard', capacity: 10,
    sort_order: 5, maintenance_windows: [], booking_windows: [], prime_time_windows: [] },
];

const DATA_refs = [
  { id: 'r1', name: 'Maya Petersen', phone: '+44 7700 900123', email: 'maya@example.com',
    whatsapp_number: '+44 7700 900123', preferred_channel: 'whatsapp',
    employment_type: 'in_house', overall_rating: 5, active: true },
  { id: 'r2', name: 'Daniel Okafor', phone: '+44 7700 900222', email: 'd.okafor@example.com',
    whatsapp_number: '', preferred_channel: 'phone',
    employment_type: 'freelance', overall_rating: 4, active: true },
  { id: 'r3', name: 'Priya Shah', phone: '+44 7700 900333', email: 'priya@example.com',
    whatsapp_number: '+44 7700 900333', preferred_channel: 'whatsapp',
    employment_type: 'freelance', overall_rating: 5, active: true },
  { id: 'r4', name: 'Tomás Reyes', phone: '+44 7700 900444', email: 't.reyes@example.com',
    whatsapp_number: '+44 7700 900444', preferred_channel: 'email',
    employment_type: 'freelance', overall_rating: 3, active: true },
  { id: 'r5', name: 'Geoff Holloway', phone: '+44 7700 900555', email: 'geoff@example.com',
    whatsapp_number: '', preferred_channel: 'phone',
    employment_type: 'in_house', overall_rating: 4, active: false },
];

const DATA_pending_registrations = [
  { id: 'pr1', team_id: 't13', team_name: 'FC Sundown' },
  { id: 'pr2', team_id: 't14', team_name: 'Lewisham Locomotives' },
];

const DATA_open_incidents = [
  { id: 'i1', severity: 'critical', description: 'Pitch 4 floodlights tripping breaker — engineer en route' },
  { id: 'i2', severity: 'warning',  description: 'Two refs unconfirmed for Thursday cup ties' },
  { id: 'i3', severity: 'info',     description: 'Vending machine restocked — invoice in inbox' },
];

// Tonight = 6 fixtures, mixed statuses so we can stress-test the layout.
// Live count is controlled by the "live matches" tweak.
const TONIGHT_DATE = '2026-06-08';
const DATA_fixtures_tonight_full = [
  // Live
  { id: 'f1', home_team_id: 't1', away_team_id: 't2', playing_area_id: 'p1', official_id: 'r1',
    scheduled_date: TONIGHT_DATE, kickoff_time: '19:30', status: 'in_progress',
    home_score: 2, away_score: 1, round_name: 'Round 12' },
  { id: 'f2', home_team_id: 't3', away_team_id: 't4', playing_area_id: 'p2', official_id: 'r3',
    scheduled_date: TONIGHT_DATE, kickoff_time: '19:30', status: 'in_progress',
    home_score: 0, away_score: 0, round_name: 'Round 12' },
  { id: 'f3', home_team_id: 't5', away_team_id: 't6', playing_area_id: 'p3', official_id: 'r4',
    scheduled_date: TONIGHT_DATE, kickoff_time: '19:30', status: 'in_progress',
    home_score: 3, away_score: 2, round_name: 'Round 12' },
  // Needs ref
  { id: 'f4', home_team_id: 't7', away_team_id: 't8', playing_area_id: 'p1', official_id: null,
    scheduled_date: TONIGHT_DATE, kickoff_time: '20:30', status: 'allocated',
    round_name: 'Round 12' },
  // Needs pitch
  { id: 'f5', home_team_id: 't9', away_team_id: 't10', playing_area_id: null, official_id: 'r2',
    scheduled_date: TONIGHT_DATE, kickoff_time: '20:30', status: 'scheduled',
    round_name: 'Round 12' },
  // Needs both
  { id: 'f6', home_team_id: 't11', away_team_id: 't12', playing_area_id: null, official_id: null,
    scheduled_date: TONIGHT_DATE, kickoff_time: '21:30', status: 'scheduled',
    round_name: 'Round 12' },
];

const DATA_fixtures_thisweek = [
  { id: 'fw1', home_team_id: 't1', away_team_id: 't5', playing_area_id: 'p2', official_id: 'r1',
    scheduled_date: '2026-06-10', kickoff_time: '19:30', status: 'allocated', round_name: 'Round 13' },
  { id: 'fw2', home_team_id: 't3', away_team_id: 't9', playing_area_id: 'p1', official_id: 'r3',
    scheduled_date: '2026-06-10', kickoff_time: '20:30', status: 'allocated', round_name: 'Round 13' },
  { id: 'fw3', home_team_id: 't2', away_team_id: 't8', playing_area_id: null, official_id: null,
    scheduled_date: '2026-06-11', kickoff_time: '19:00', status: 'scheduled', round_name: 'Cup R1' },
  { id: 'fw4', home_team_id: 't6', away_team_id: 't11', playing_area_id: 'p3', official_id: null,
    scheduled_date: '2026-06-12', kickoff_time: '19:30', status: 'allocated', round_name: 'Round 13' },
];

const DATA_fixtures_recent = [
  { id: 'fr1', home_team_id: 't2', away_team_id: 't1', playing_area_id: 'p1', official_id: 'r1',
    scheduled_date: '2026-06-04', kickoff_time: '19:30', status: 'completed',
    home_score: 3, away_score: 3, round_name: 'Round 11' },
  { id: 'fr2', home_team_id: 't4', away_team_id: 't3', playing_area_id: 'p2', official_id: 'r3',
    scheduled_date: '2026-06-04', kickoff_time: '19:30', status: 'completed',
    home_score: 1, away_score: 4, round_name: 'Round 11' },
  { id: 'fr3', home_team_id: 't6', away_team_id: 't5', playing_area_id: 'p3', official_id: 'r2',
    scheduled_date: '2026-06-04', kickoff_time: '19:30', status: 'completed',
    home_score: 2, away_score: 2, round_name: 'Round 11' },
  { id: 'fr4', home_team_id: 't8', away_team_id: 't7', playing_area_id: 'p1', official_id: 'r3',
    scheduled_date: '2026-06-04', kickoff_time: '20:30', status: 'completed',
    home_score: 0, away_score: 2, round_name: 'Round 11' },
  { id: 'fr5', home_team_id: 't10', away_team_id: 't9', playing_area_id: 'p2', official_id: 'r1',
    scheduled_date: '2026-06-03', kickoff_time: '19:30', status: 'walkover',
    walkover_winner_id: 't10', round_name: 'Cup R1' },
  { id: 'fr6', home_team_id: 't12', away_team_id: 't11', playing_area_id: 'p3', official_id: 'r4',
    scheduled_date: '2026-06-03', kickoff_time: '20:30', status: 'completed',
    home_score: 5, away_score: 2, round_name: 'Round 11' },
  { id: 'fr7', home_team_id: 't1', away_team_id: 't7', playing_area_id: 'p1', official_id: 'r2',
    scheduled_date: '2026-06-02', kickoff_time: '19:30', status: 'postponed', round_name: 'Round 11' },
];

const DATA_fixtures_upcoming = [
  { id: 'fu1', home_team_id: 't5', away_team_id: 't2', playing_area_id: null, official_id: null,
    scheduled_date: '2026-06-17', kickoff_time: '19:30', status: 'scheduled', round_name: 'Round 14' },
  { id: 'fu2', home_team_id: 't9', away_team_id: 't3', playing_area_id: null, official_id: null,
    scheduled_date: '2026-06-17', kickoff_time: '20:30', status: 'scheduled', round_name: 'Round 14' },
  { id: 'fu3', home_team_id: 't8', away_team_id: 't4', playing_area_id: null, official_id: null,
    scheduled_date: '2026-06-17', kickoff_time: '21:30', status: 'scheduled', round_name: 'Round 14' },
  { id: 'fu4', home_team_id: 't11', away_team_id: 't6', playing_area_id: null, official_id: null,
    scheduled_date: '2026-06-18', kickoff_time: '19:00', status: 'scheduled', round_name: 'Cup QF' },
  { id: 'fu5', home_team_id: 't1', away_team_id: 't10', playing_area_id: null, official_id: null,
    scheduled_date: '2026-06-24', kickoff_time: '19:30', status: 'scheduled', round_name: 'Round 15' },
];

// Bookings occupancy
const DATA_occupancy = [
  // Pitch 1 — Tonight's fixtures
  { source_kind: 'fixture', pitch_id: 'p1', starts_at: '2026-06-08T19:30', ends_at: '2026-06-08T20:20',
    detail: { team_name: 'Northside vs Eastpark' } },
  { source_kind: 'fixture', pitch_id: 'p1', starts_at: '2026-06-08T20:30', ends_at: '2026-06-08T21:20',
    detail: { team_name: 'Wandle vs Cypress' } },
  // Pitch 2
  { source_kind: 'fixture', pitch_id: 'p2', starts_at: '2026-06-08T19:30', ends_at: '2026-06-08T20:20',
    detail: { team_name: 'Brockley vs Old Brompton' } },
  { source_kind: 'booking', pitch_id: 'p2', starts_at: '2026-06-08T20:30', ends_at: '2026-06-08T21:30',
    detail: { status: 'confirmed', series_id: 'b-weekly-1', team_name: 'Tuesday Casuals' } },
  // Pitch 3
  { source_kind: 'fixture', pitch_id: 'p3', starts_at: '2026-06-08T19:30', ends_at: '2026-06-08T20:20',
    detail: { team_name: 'Highbridge vs Marsh Lane' } },
  { source_kind: 'booking', pitch_id: 'p3', starts_at: '2026-06-08T20:30', ends_at: '2026-06-08T21:30',
    detail: { status: 'requested', series_id: 'b-req-1', team_name: 'Carter & Co (corporate)' } },
  // Pitch 4 — Maintenance
  { source_kind: 'maintenance', pitch_id: 'p4', starts_at: '2026-06-08T20:00', ends_at: '2026-06-08T21:30',
    detail: { reason: 'Floodlight repair' } },
  { source_kind: 'booking', pitch_id: 'p4', starts_at: '2026-06-08T18:00', ends_at: '2026-06-08T19:00',
    detail: { status: 'confirmed', team_name: 'Hannah Williams' } },
];

const DATA_pending_bookings = [
  { id: 'pb1', kind: 'weekly', weeks: 6, pitch_id: 'p3', pitch_name: 'Pitch 3 (South)',
    start: '2026-06-15T19:00', day: 'Mon', duration_min: 60,
    booker_name: 'James Okonkwo', booker_org: null,
    booker_phone: '+44 7700 902341', booker_email: 'james.ok@example.com',
    preferred_channel: 'whatsapp',
    message: 'Sunday League 5-a-side, paid up front for 6 weeks. Cheers.' },
  { id: 'pb2', kind: 'one_off', pitch_id: 'p1', pitch_name: 'Pitch 1 (North)',
    start: '2026-06-09T18:30', day: 'Tue', duration_min: 90,
    booker_name: 'Hannah Williams', booker_org: null,
    booker_phone: '+44 7700 902798', booker_email: 'hwilliams@example.com',
    preferred_channel: 'phone',
    message: null },
  { id: 'pb3', kind: 'one_off', pitch_id: 'p2', pitch_name: 'Pitch 2 (Centre)',
    start: '2026-06-12T21:00', day: 'Fri', duration_min: 60,
    booker_name: 'Daniel Park', booker_org: 'Carter & Co',
    booker_phone: '+44 7700 902112', booker_email: 'd.park@carterco.co.uk',
    preferred_channel: 'email',
    message: 'Team build for ~14 staff. Need light catering option if available.' },
  { id: 'pb4', kind: 'weekly', weeks: 4, pitch_id: 'p1', pitch_name: 'Pitch 1 (North)',
    start: '2026-06-16T20:00', day: 'Tue', duration_min: 60,
    booker_name: 'Sara Lindqvist', booker_org: 'Brewmasters FC',
    booker_phone: '+44 7700 905512', booker_email: 'sara@brewmasters.fc',
    preferred_channel: 'whatsapp',
    message: 'Block of 4 for our reserves training, same time each week if poss.' },
  { id: 'pb5', kind: 'one_off', pitch_id: 'p3', pitch_name: 'Pitch 3 (South)',
    start: '2026-06-13T10:00', day: 'Sat', duration_min: 120,
    booker_name: 'Marcus Yeboah', booker_org: null,
    booker_phone: '+44 7700 906601', booker_email: 'm.yeboah@example.com',
    preferred_channel: 'phone',
    message: "Kid's birthday party — 12 kids age 8. Need cones if you have any spare." },
  { id: 'pb6', kind: 'one_off', pitch_id: 'p2', pitch_name: 'Pitch 2 (Centre)',
    start: '2026-06-14T18:00', day: 'Sun', duration_min: 60,
    booker_name: 'Olivia Tran', booker_org: null,
    booker_phone: '+44 7700 907723', booker_email: 'olivia.t@example.com',
    preferred_channel: 'email',
    message: null },
  { id: 'pb7', kind: 'weekly', weeks: 8, pitch_id: 'p1', pitch_name: 'Pitch 1 (North)',
    start: '2026-06-18T18:30', day: 'Thu', duration_min: 90,
    booker_name: 'Coach Bennett', booker_org: 'Greenway U14s',
    booker_phone: '+44 7700 908834', booker_email: 'bennett@gwu14.org',
    preferred_channel: 'whatsapp',
    message: 'Pre-season training block. Booked through the academy.' },
  { id: 'pb8', kind: 'one_off', pitch_id: 'p3', pitch_name: 'Pitch 3 (South)',
    start: '2026-06-20T16:00', day: 'Sat', duration_min: 60,
    booker_name: 'Priya Nair', booker_org: null,
    booker_phone: '+44 7700 909945', booker_email: 'priya.n@example.com',
    preferred_channel: 'phone',
    message: null },
  { id: 'pb9', kind: 'one_off', pitch_id: 'p2', pitch_name: 'Pitch 2 (Centre)',
    start: '2026-06-21T19:30', day: 'Sun', duration_min: 60,
    booker_name: 'Marco Fischer', booker_org: 'Heidelberg Old Boys',
    booker_phone: '+44 7700 910056', booker_email: 'marco@heidelbergob.com',
    preferred_channel: 'email',
    message: 'Annual reunion match — flying over from Berlin. Big deal for us!' },
];

// Payments
const DATA_payments_summary = {
  owed_pence: 482000,
  collected_pence: 318000,
  outstanding_pence: 164000,
  collection_rate: 0.66,
};
const DATA_charges = [
  { id: 'ch1', source: 'fixture', team_name: 'Northside Athletic',  due_date: '2026-06-08',
    amount_due_pence: 4500, paid_pence: 4500, balance_pence: 0, status: 'paid' },
  { id: 'ch2', source: 'fixture', team_name: 'Eastpark United',     due_date: '2026-06-08',
    amount_due_pence: 4500, paid_pence: 2000, balance_pence: 2500, status: 'part_paid' },
  { id: 'ch3', source: 'fixture', team_name: 'Brockley Rovers',     due_date: '2026-06-08',
    amount_due_pence: 4500, paid_pence: 0, balance_pence: 4500, status: 'unpaid' },
  { id: 'ch4', source: 'fixture', team_name: 'Old Brompton Stars',  due_date: '2026-06-08',
    amount_due_pence: 4500, paid_pence: 4500, balance_pence: 0, status: 'paid' },
  { id: 'ch5', source: 'fixture', team_name: 'Highbridge FC',       due_date: '2026-06-08',
    amount_due_pence: 4500, paid_pence: 4500, balance_pence: 0, status: 'paid' },
  { id: 'ch6', source: 'fixture', team_name: 'Marsh Lane Crusaders',due_date: '2026-06-08',
    amount_due_pence: 4500, paid_pence: 0, balance_pence: 4500, status: 'unpaid' },
  { id: 'ch7', source: 'booking', team_name: 'Tuesday Casuals',     due_date: '2026-06-08',
    amount_due_pence: 6000, paid_pence: 6000, balance_pence: 0, status: 'paid' },
  { id: 'ch8', source: 'booking', team_name: 'Carter & Co',         due_date: '2026-06-15',
    amount_due_pence: 6000, paid_pence: 0, balance_pence: 6000, status: 'unpaid' },
  { id: 'ch9', source: 'fixture', team_name: 'Saint Olave\'s Old Boys', due_date: '2026-06-01',
    amount_due_pence: 4500, paid_pence: 0, balance_pence: 0, status: 'voided' },
  { id: 'ch10', source: 'fixture', team_name: 'Quaybridge Internazionale Reserves', due_date: '2026-06-08',
    amount_due_pence: 4500, paid_pence: 0, balance_pence: 4500, status: 'unpaid' },
  { id: 'ch11', source: 'fixture', team_name: 'Battersea Bulldogs', due_date: '2026-06-01',
    amount_due_pence: 4500, paid_pence: 4500, balance_pence: 0, status: 'paid' },
  { id: 'ch12', source: 'fixture', team_name: 'Honor Oak Hooligans', due_date: '2026-06-08',
    amount_due_pence: 4500, paid_pence: 1500, balance_pence: 3000, status: 'part_paid' },
];

// Teams directory + roster
const DATA_teams_directory = Object.values(DATA_teams).slice(0, 12).map((t, i) => ({
  team_id: t.id, name: t.name,
  primary_colour: t.primary_colour, secondary_colour: t.secondary_colour,
  competition_count: (i % 3) + 1,
  last_active_at: ['today', '2d', '5d', '1w', '3w', '2mo'][i % 6],
}));

const DATA_roster_sample = {
  team: { name: 'Northside Athletic', primary_colour: '#1E5BAA', secondary_colour: '#F4D03F' },
  competitions: [{ name: 'GPL Division 1' }, { name: 'Open Cup' }],
  players: [
    { shirt_number: 1,  name: 'Adam Carlsen',    nickname: 'Adz',    is_vc: false, is_reserve: false, injured: false, disabled: false, goals: 0,  motm: 1, attended: 11, w: 7, d: 2, l: 2 },
    { shirt_number: 4,  name: 'Eli Bautista',    nickname: '',       is_vc: true,  is_reserve: false, injured: false, disabled: false, goals: 2,  motm: 2, attended: 12, w: 8, d: 2, l: 2 },
    { shirt_number: 6,  name: 'Marcus Goh',      nickname: 'Goh',    is_vc: false, is_reserve: false, injured: false, disabled: false, goals: 4,  motm: 1, attended: 12, w: 8, d: 2, l: 2 },
    { shirt_number: 7,  name: 'Ben Whitfield',   nickname: 'Whit',   is_vc: false, is_reserve: false, injured: false, disabled: false, goals: 9,  motm: 3, attended: 11, w: 8, d: 1, l: 2 },
    { shirt_number: 9,  name: 'Tariq Ahmed',     nickname: 'T',      is_vc: false, is_reserve: false, injured: false, disabled: false, goals: 14, motm: 4, attended: 12, w: 8, d: 2, l: 2 },
    { shirt_number: 10, name: 'Jordan Castillo', nickname: 'Cas',    is_vc: false, is_reserve: false, injured: true,  disabled: false, goals: 6,  motm: 1, attended: 8,  w: 5, d: 1, l: 2 },
    { shirt_number: 11, name: 'Sam Aboagye',     nickname: '',       is_vc: false, is_reserve: false, injured: false, disabled: false, goals: 7,  motm: 2, attended: 11, w: 7, d: 2, l: 2 },
    { shirt_number: 14, name: 'Lewis Sandberg',  nickname: '',       is_vc: false, is_reserve: true,  injured: false, disabled: false, goals: 1,  motm: 0, attended: 4,  w: 3, d: 0, l: 1 },
    { shirt_number: 17, name: 'Oluwadamilare Adebayo', nickname: 'Dami', is_vc: false, is_reserve: true,  injured: false, disabled: false, goals: 2,  motm: 0, attended: 6,  w: 4, d: 1, l: 1 },
    { shirt_number: 22, name: 'Henrik Lassen',   nickname: '',       is_vc: false, is_reserve: false, injured: false, disabled: true,  goals: 0,  motm: 0, attended: 2,  w: 1, d: 0, l: 1 },
  ],
};

// Players directory
const DATA_players_directory = [
  { id: 'pl1',  team_id: 't1', team_name: 'Northside Athletic', team_colour: '#1E5BAA',
    name: 'Tariq Ahmed', nickname: 'T', shirt_number: 9, goals: 14, motm: 4, attended: 12, injured: false, disabled: false },
  { id: 'pl2',  team_id: 't1', team_name: 'Northside Athletic', team_colour: '#1E5BAA',
    name: 'Ben Whitfield', nickname: 'Whit', shirt_number: 7, goals: 9, motm: 3, attended: 11, injured: false, disabled: false },
  { id: 'pl3',  team_id: 't2', team_name: 'Eastpark United', team_colour: '#C0392B',
    name: 'Reza Pourmand', nickname: '', shirt_number: 9, goals: 12, motm: 5, attended: 10, injured: false, disabled: false },
  { id: 'pl4',  team_id: 't3', team_name: 'Brockley Rovers', team_colour: '#0F7B5A',
    name: 'Dion Fraser', nickname: 'Frase', shirt_number: 10, goals: 11, motm: 2, attended: 12, injured: false, disabled: false },
  { id: 'pl5',  team_id: 't4', team_name: 'Old Brompton Stars', team_colour: '#6E2A8C',
    name: 'Henry Brookman', nickname: '', shirt_number: 8, goals: 8, motm: 2, attended: 11, injured: true, disabled: false },
  { id: 'pl6',  team_id: 't5', team_name: 'Highbridge FC', team_colour: '#E08B1F',
    name: 'Joseph Onyango', nickname: 'JO', shirt_number: 11, goals: 10, motm: 3, attended: 12, injured: false, disabled: false },
  { id: 'pl7',  team_id: 't1', team_name: 'Northside Athletic', team_colour: '#1E5BAA',
    name: 'Jordan Castillo', nickname: 'Cas', shirt_number: 10, goals: 6, motm: 1, attended: 8, injured: true, disabled: false },
  { id: 'pl8',  team_id: 't6', team_name: 'Marsh Lane Crusaders', team_colour: '#28394A',
    name: 'Marco Vitelli', nickname: '', shirt_number: 4, goals: 0, motm: 0, attended: 9, injured: false, disabled: false },
  { id: 'pl9',  team_id: 't7', team_name: 'Wandle Phoenix', team_colour: '#B23A48',
    name: 'Felipe Cordeiro', nickname: 'Fe', shirt_number: 7, goals: 11, motm: 4, attended: 11, injured: false, disabled: false },
  { id: 'pl10', team_id: 't8', team_name: 'Cypress Park Wanderers', team_colour: '#0E4D3F',
    name: 'Aidan Park', nickname: '', shirt_number: 14, goals: 5, motm: 1, attended: 10, injured: false, disabled: false },
  { id: 'pl11', team_id: 't9', team_name: 'Battersea Bulldogs', team_colour: '#1F1F22',
    name: 'Kwame Mensah', nickname: 'K', shirt_number: 6, goals: 7, motm: 2, attended: 11, injured: false, disabled: false },
  { id: 'pl12', team_id: 't10', team_name: 'Saint Olave\'s Old Boys', team_colour: '#7E1F2A',
    name: 'Edward Reilly', nickname: 'Eddie', shirt_number: 9, goals: 9, motm: 3, attended: 12, injured: false, disabled: false },
  { id: 'pl13', team_id: 't11', team_name: 'Quaybridge Internazionale Reserves', team_colour: '#000A4B',
    name: 'Marc Vandenberg', nickname: '', shirt_number: 10, goals: 13, motm: 4, attended: 11, injured: false, disabled: false },
  { id: 'pl14', team_id: 't12', team_name: 'Honor Oak Hooligans', team_colour: '#FFD700',
    name: 'Liam O\'Connor', nickname: 'Lio', shirt_number: 8, goals: 6, motm: 1, attended: 9, injured: false, disabled: true },
  { id: 'pl15', team_id: 't5', team_name: 'Highbridge FC', team_colour: '#E08B1F',
    name: 'Sukhpreet Bhandari', nickname: '', shirt_number: 5, goals: 1, motm: 0, attended: 12, injured: false, disabled: false },
];

// Venue staff
const DATA_staff = [
  { id: 'st1', name: 'Aimée Belanger', role: 'manager', email: 'aimee@greenway.fc',
    phone: '+44 7700 911011', whatsapp_number: '+44 7700 911011', preferred_channel: 'email',
    notes: 'Mon–Thu, opens at 16:00', active: true },
  { id: 'st2', name: 'Rohan Vyas', role: 'reception', email: 'reception@greenway.fc',
    phone: '+44 7700 911022', whatsapp_number: '', preferred_channel: 'phone',
    notes: '', active: true },
  { id: 'st3', name: 'Lena Hartmann', role: 'reception', email: 'lena@greenway.fc',
    phone: '+44 7700 911033', whatsapp_number: '+44 7700 911033', preferred_channel: 'whatsapp',
    notes: 'Weekends', active: true },
  { id: 'st4', name: 'Carlos Mendez', role: 'groundstaff', email: '',
    phone: '+44 7700 911044', whatsapp_number: '+44 7700 911044', preferred_channel: 'whatsapp',
    notes: 'Pitch maintenance + line-marking', active: true },
  { id: 'st5', name: 'Oluchi Iwu', role: 'coach', email: 'olu@greenway.fc',
    phone: '+44 7700 911055', whatsapp_number: '', preferred_channel: 'email',
    notes: 'Junior development sessions Sat AM', active: true },
  { id: 'st6', name: 'Geoff Holloway', role: 'admin', email: 'geoff@greenway.fc',
    phone: '+44 7700 900555', whatsapp_number: '', preferred_channel: 'phone',
    notes: 'Retired — kept on for cup nights', active: false },
];

// Standings — GPL Division 1, 12 teams
const DATA_standings = [
  { rank: 1, team_id: 't1', team_name: 'Northside Athletic', primary_colour: '#1E5BAA',
    played: 11, w: 8, d: 2, l: 1, gf: 28, ga: 10, gd: 18, pts: 26 },
  { rank: 2, team_id: 't3', team_name: 'Brockley Rovers', primary_colour: '#0F7B5A',
    played: 11, w: 7, d: 3, l: 1, gf: 25, ga: 12, gd: 13, pts: 24 },
  { rank: 3, team_id: 't5', team_name: 'Highbridge FC', primary_colour: '#E08B1F',
    played: 11, w: 7, d: 1, l: 3, gf: 22, ga: 14, gd: 8, pts: 22 },
  { rank: 4, team_id: 't11', team_name: 'Quaybridge Internazionale Reserves', primary_colour: '#000A4B',
    played: 11, w: 6, d: 2, l: 3, gf: 20, ga: 14, gd: 6, pts: 20 },
  { rank: 5, team_id: 't2', team_name: 'Eastpark United', primary_colour: '#C0392B',
    played: 11, w: 5, d: 3, l: 3, gf: 18, ga: 16, gd: 2, pts: 18 },
  { rank: 6, team_id: 't7', team_name: 'Wandle Phoenix', primary_colour: '#B23A48',
    played: 11, w: 4, d: 4, l: 3, gf: 17, ga: 16, gd: 1, pts: 16 },
  { rank: 7, team_id: 't9', team_name: 'Battersea Bulldogs', primary_colour: '#1F1F22',
    played: 11, w: 4, d: 2, l: 5, gf: 15, ga: 18, gd: -3, pts: 14 },
  { rank: 8, team_id: 't4', team_name: 'Old Brompton Stars', primary_colour: '#6E2A8C',
    played: 11, w: 3, d: 4, l: 4, gf: 14, ga: 17, gd: -3, pts: 13 },
  { rank: 9, team_id: 't6', team_name: 'Marsh Lane Crusaders', primary_colour: '#28394A',
    played: 11, w: 3, d: 2, l: 6, gf: 12, ga: 20, gd: -8, pts: 11 },
  { rank: 10, team_id: 't10', team_name: 'Saint Olave\'s Old Boys', primary_colour: '#7E1F2A',
    played: 11, w: 2, d: 3, l: 6, gf: 11, ga: 19, gd: -8, pts: 9 },
  { rank: 11, team_id: 't8', team_name: 'Cypress Park Wanderers', primary_colour: '#0E4D3F',
    played: 11, w: 2, d: 1, l: 8, gf: 9,  ga: 22, gd: -13, pts: 7 },
  { rank: 12, team_id: 't12', team_name: 'Honor Oak Hooligans', primary_colour: '#FFD700',
    played: 11, w: 1, d: 1, l: 9, gf: 8, ga: 21, gd: -13, pts: 4 },
];

// Cup data
const DATA_cup_groups = {
  groups: [
    { group_label: 'A', standings: [
      { team_id: 't1', team_name: 'Northside Athletic', qualifying: true,  played: 3, w: 3, d: 0, l: 0, gd: 7,  pts: 9 },
      { team_id: 't5', team_name: 'Highbridge FC',      qualifying: true,  played: 3, w: 2, d: 0, l: 1, gd: 3,  pts: 6 },
      { team_id: 't9', team_name: 'Battersea Bulldogs', qualifying: false, played: 3, w: 1, d: 0, l: 2, gd: -2, pts: 3 },
      { team_id: 't8', team_name: 'Cypress Park Wanderers', qualifying: false, played: 3, w: 0, d: 0, l: 3, gd: -8, pts: 0 },
    ]},
    { group_label: 'B', standings: [
      { team_id: 't3', team_name: 'Brockley Rovers',    qualifying: true,  played: 3, w: 2, d: 1, l: 0, gd: 4,  pts: 7 },
      { team_id: 't2', team_name: 'Eastpark United',    qualifying: true,  played: 3, w: 2, d: 0, l: 1, gd: 2,  pts: 6 },
      { team_id: 't4', team_name: 'Old Brompton Stars', qualifying: false, played: 3, w: 1, d: 1, l: 1, gd: 0,  pts: 4 },
      { team_id: 't10',team_name: 'Saint Olave\'s Old Boys', qualifying: false, played: 3, w: 0, d: 0, l: 3, gd: -6, pts: 0 },
    ]},
    { group_label: 'C', standings: [
      { team_id: 't11', team_name: 'Quaybridge Internazionale Reserves', qualifying: true,  played: 3, w: 3, d: 0, l: 0, gd: 8,  pts: 9 },
      { team_id: 't7',  team_name: 'Wandle Phoenix',    qualifying: true,  played: 3, w: 2, d: 0, l: 1, gd: 1,  pts: 6 },
      { team_id: 't6',  team_name: 'Marsh Lane Crusaders', qualifying: false, played: 3, w: 1, d: 0, l: 2, gd: -3, pts: 3 },
      { team_id: 't12', team_name: 'Honor Oak Hooligans', qualifying: false, played: 3, w: 0, d: 0, l: 3, gd: -6, pts: 0 },
    ]},
  ],
};

const DATA_cup_bracket = {
  champion: null,
  all_groups_complete: true,
  knockout_seeded: true,
  rounds: [
    { round_number: 1, round_name: 'Quarter Finals', ties: [
      { id: 'qf1', status: 'decided',
        home_team_name: 'Northside Athletic', away_team_name: 'Wandle Phoenix',
        home_score: 3, away_score: 1, decided_by: 'full_time',
        scheduled_date: '2026-06-04', kickoff_time: '19:30' },
      { id: 'qf2', status: 'decided',
        home_team_name: 'Quaybridge Inter.', away_team_name: 'Eastpark United',
        home_score: 2, away_score: 2, decided_by: 'penalties',
        scheduled_date: '2026-06-04', kickoff_time: '20:30' },
      { id: 'qf3', status: 'scheduled',
        home_team_name: 'Brockley Rovers', away_team_name: 'Highbridge FC',
        scheduled_date: '2026-06-11', kickoff_time: '19:30' },
      { id: 'qf4', status: 'ready',
        home_team_name: '2A vs 1B winner', away_team_name: 'TBD' },
    ]},
    { round_number: 2, round_name: 'Semi Finals', ties: [
      { id: 'sf1', status: 'ready',
        home_team_name: 'TBD', away_team_name: 'TBD' },
      { id: 'sf2', status: 'ready',
        home_team_name: 'TBD', away_team_name: 'TBD' },
    ]},
    { round_number: 3, round_name: 'Final', ties: [
      { id: 'fnl', status: 'ready',
        home_team_name: 'TBD', away_team_name: 'TBD' },
    ]},
  ],
};

const DATA_display_config = {
  pin_set: true,
  auto_mode: 'smart',
  cycle_seconds: 25,
  custom_message: 'Welcome to Greenway. Boots only on the 3G.',
  panels: [
    { id: 'live',      name: 'Live scores',     enabled: true,  order: 1 },
    { id: 'standings', name: 'League standings',enabled: true,  order: 2 },
    { id: 'scorers',   name: 'Top scorers',     enabled: true,  order: 3 },
    { id: 'upcoming',  name: 'Upcoming',        enabled: true,  order: 4 },
    { id: 'recent',    name: 'Recent results',  enabled: true,  order: 5 },
    { id: 'goals',     name: 'Goals ticker',    enabled: false, order: 6 },
    { id: 'custom',    name: 'Custom message',  enabled: true,  order: 7 },
  ],
};

// Helpers
function getInitials(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function poundsFromPence(p) {
  return '£' + (p / 100).toFixed(2);
}
function poundsRound(p) {
  return '£' + Math.round(p / 100).toLocaleString('en-GB');
}
function formatTime(t) { return t; } // already HH:MM
function dayLabel(d) {
  const dt = new Date(d + 'T00:00');
  return dt.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
}
function shortDate(d) {
  const dt = new Date(d + 'T00:00');
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
}
function relativeTime(label) { return label; }

// Cancellations — full audit log, searchable by team/booker/date/pitch
const DATA_cancellations = [
  { id: 'cn1', cancelled_at: '2026-06-08T11:42',
    booker_name: 'Hannah Williams', team_name: null, booker_org: null,
    pitch_id: 'p4', pitch_name: 'Pitch 4 (Indoor)',
    booking_start: '2026-06-08T18:00', booking_end: '2026-06-08T19:00',
    series_id: null, kind: 'one_off',
    reason: 'Pitch unavailable', note: 'Floodlight repair clashes', within_policy: false,
    decision: 'full', refund_pence: 4500, charged_pence: 0,
    notified: true, notify_channel: 'phone',
    cancelled_by: 'Aimée Belanger' },
  { id: 'cn2', cancelled_at: '2026-06-08T09:15',
    booker_name: 'Coach Bennett', team_name: 'Greenway U14s', booker_org: 'Greenway U14s',
    pitch_id: 'p1', pitch_name: 'Pitch 1 (North)',
    booking_start: '2026-06-09T16:30', booking_end: '2026-06-09T18:00',
    series_id: null, kind: 'one_off',
    reason: 'Booker request', note: 'School trip clashes', within_policy: true,
    decision: 'full', refund_pence: 6000, charged_pence: 0,
    notified: true, notify_channel: 'whatsapp',
    cancelled_by: 'Rohan Vyas' },
  { id: 'cn3', cancelled_at: '2026-06-07T22:08',
    booker_name: 'Marco Vitelli', team_name: 'Marsh Lane Crusaders', booker_org: null,
    pitch_id: 'p3', pitch_name: 'Pitch 3 (South)',
    booking_start: '2026-06-08T07:30', booking_end: '2026-06-08T08:30',
    series_id: null, kind: 'one_off',
    reason: 'Booker request', note: '', within_policy: false,
    decision: 'partial', refund_pence: 2250, charged_pence: 2250,
    notified: true, notify_channel: 'email',
    cancelled_by: 'Aimée Belanger' },
  { id: 'cn4', cancelled_at: '2026-06-07T14:30',
    booker_name: 'Sara Lindqvist', team_name: null, booker_org: 'Brewmasters FC',
    pitch_id: 'p1', pitch_name: 'Pitch 1 (North)',
    booking_start: '2026-06-10T20:00', booking_end: '2026-06-10T21:00',
    series_id: 'series-bm-1', kind: 'series',
    reason: 'Series complete', note: 'End of pre-season block', within_policy: true,
    decision: 'full', refund_pence: 18000, charged_pence: 0,
    notified: true, notify_channel: 'whatsapp',
    cancelled_by: 'Aimée Belanger' },
  { id: 'cn5', cancelled_at: '2026-06-06T19:45',
    booker_name: 'Liam O\'Connor', team_name: 'Honor Oak Hooligans', booker_org: null,
    pitch_id: 'p2', pitch_name: 'Pitch 2 (Centre)',
    booking_start: '2026-06-07T21:00', booking_end: '2026-06-07T22:00',
    series_id: null, kind: 'one_off',
    reason: 'Weather', note: 'Lightning forecast', within_policy: false,
    decision: 'full', refund_pence: 4500, charged_pence: 0,
    notified: true, notify_channel: 'whatsapp',
    cancelled_by: 'Lena Hartmann' },
  { id: 'cn6', cancelled_at: '2026-06-06T11:20',
    booker_name: 'Joseph Onyango', team_name: 'Highbridge FC', booker_org: null,
    pitch_id: 'p3', pitch_name: 'Pitch 3 (South)',
    booking_start: '2026-06-06T19:30', booking_end: '2026-06-06T20:30',
    series_id: null, kind: 'one_off',
    reason: 'Booker request', note: 'Team unavailable', within_policy: false,
    decision: 'none', refund_pence: 0, charged_pence: 4500,
    notified: true, notify_channel: 'phone',
    cancelled_by: 'Aimée Belanger' },
  { id: 'cn7', cancelled_at: '2026-06-05T08:45',
    booker_name: 'Priya Nair', team_name: null, booker_org: null,
    pitch_id: 'p3', pitch_name: 'Pitch 3 (South)',
    booking_start: '2026-06-13T17:00', booking_end: '2026-06-13T18:00',
    series_id: null, kind: 'one_off',
    reason: 'Booker request', note: '', within_policy: true,
    decision: 'full', refund_pence: 4500, charged_pence: 0,
    notified: false, notify_channel: 'phone',
    cancelled_by: 'Rohan Vyas' },
  { id: 'cn8', cancelled_at: '2026-06-04T16:12',
    booker_name: 'Edward Reilly', team_name: 'Saint Olave\'s Old Boys', booker_org: null,
    pitch_id: 'p1', pitch_name: 'Pitch 1 (North)',
    booking_start: '2026-06-05T19:00', booking_end: '2026-06-05T20:00',
    series_id: null, kind: 'one_off',
    reason: 'Operator error', note: 'Double-booked with league fixture', within_policy: false,
    decision: 'full', refund_pence: 4500, charged_pence: 0,
    notified: true, notify_channel: 'whatsapp',
    cancelled_by: 'Aimée Belanger' },
  { id: 'cn9', cancelled_at: '2026-06-03T09:00',
    booker_name: 'Daniel Park', team_name: null, booker_org: 'Carter & Co',
    pitch_id: 'p2', pitch_name: 'Pitch 2 (Centre)',
    booking_start: '2026-06-04T18:30', booking_end: '2026-06-04T19:30',
    series_id: null, kind: 'one_off',
    reason: 'Booker request', note: 'Will rebook later', within_policy: true,
    decision: 'full', refund_pence: 6000, charged_pence: 0,
    notified: true, notify_channel: 'email',
    cancelled_by: 'Aimée Belanger' },
  { id: 'cn10', cancelled_at: '2026-06-02T20:15',
    booker_name: 'Marcus Yeboah', team_name: null, booker_org: null,
    pitch_id: 'p3', pitch_name: 'Pitch 3 (South)',
    booking_start: '2026-06-03T10:00', booking_end: '2026-06-03T12:00',
    series_id: null, kind: 'one_off',
    reason: 'Venue closure', note: 'Power cut', within_policy: false,
    decision: 'full', refund_pence: 9000, charged_pence: 0,
    notified: true, notify_channel: 'phone',
    cancelled_by: 'Geoff Holloway' },
  { id: 'cn11', cancelled_at: '2026-06-01T13:30',
    booker_name: 'James Okonkwo', team_name: null, booker_org: null,
    pitch_id: 'p3', pitch_name: 'Pitch 3 (South)',
    booking_start: '2026-06-08T20:00', booking_end: '2026-06-08T21:00',
    series_id: null, kind: 'one_off',
    reason: 'Booker request', note: '', within_policy: true,
    decision: 'full', refund_pence: 4500, charged_pence: 0,
    notified: true, notify_channel: 'whatsapp',
    cancelled_by: 'Aimée Belanger' },
  { id: 'cn12', cancelled_at: '2026-05-30T11:00',
    booker_name: 'Olivia Tran', team_name: null, booker_org: null,
    pitch_id: 'p2', pitch_name: 'Pitch 2 (Centre)',
    booking_start: '2026-06-02T18:00', booking_end: '2026-06-02T19:00',
    series_id: null, kind: 'one_off',
    reason: 'Other', note: 'Lost interest after team mate dropped out', within_policy: true,
    decision: 'full', refund_pence: 4500, charged_pence: 0,
    notified: true, notify_channel: 'email',
    cancelled_by: 'Rohan Vyas' },
];

function relativeFrom(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

Object.assign(window, { DATA_cancellations, relativeFrom });

Object.assign(window, {
  DATA_venue, DATA_leagues, DATA_seasons, DATA_competitions,
  DATA_teams, DATA_pitches, DATA_refs,
  DATA_pending_registrations, DATA_open_incidents,
  DATA_fixtures_tonight_full, DATA_fixtures_thisweek,
  DATA_fixtures_recent, DATA_fixtures_upcoming,
  DATA_occupancy, DATA_pending_bookings,
  DATA_payments_summary, DATA_charges,
  DATA_teams_directory, DATA_roster_sample,
  DATA_players_directory, DATA_staff,
  DATA_standings, DATA_cup_groups, DATA_cup_bracket,
  DATA_display_config,
  getInitials, poundsFromPence, poundsRound, formatTime, dayLabel, shortDate, relativeTime,
});
