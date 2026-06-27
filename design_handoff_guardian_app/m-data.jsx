/* m-data.jsx — In or Out mobile: data, role/flag nav model, icons, helpers.
   Reuses the venue data contract field names. Exported to window. */

const { useState, useEffect, useRef, useCallback } = React;

/* ---------- theme (light / dark / auto), persisted ---------- */
const THEME_KEY = 'ioo-mobile-theme';
function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode === 'system' ? systemTheme() : mode;
}
function getThemePref() { try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) { return 'dark'; } }
function setThemePref(mode) { try { localStorage.setItem(THEME_KEY, mode); } catch (e) {} applyTheme(mode); }
applyTheme(getThemePref());
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onSys = () => { if (getThemePref() === 'system') applyTheme('system'); };
  mq.addEventListener ? mq.addEventListener('change', onSys) : mq.addListener && mq.addListener(onSys);
}

/* ---------- teams (subset palette) ---------- */
const TEAMS = {
  t1:  { name: 'Northside Athletic',    p: '#1E5BAA', s: '#F4D03F' },
  t2:  { name: 'Eastpark United',       p: '#C0392B', s: '#1B1B1F' },
  t3:  { name: 'Brockley Rovers',       p: '#0F7B5A', s: '#F4F1E8' },
  t4:  { name: 'Old Brompton Stars',    p: '#6E2A8C', s: '#F0C75E' },
  t5:  { name: 'Highbridge FC',         p: '#E08B1F', s: '#2A2A2E' },
  t6:  { name: 'Marsh Lane Crusaders',  p: '#28394A', s: '#C9B98A' },
  t7:  { name: 'Wandle Phoenix',        p: '#B23A48', s: '#F7D38C' },
  t8:  { name: 'Cypress Park Wanderers',p: '#0E4D3F', s: '#FFFFFF' },
  t9:  { name: 'Battersea Bulldogs',    p: '#1F1F22', s: '#C0392B' },
  t10: { name: "Saint Olave's Old Boys",p: '#7E1F2A', s: '#E6D9B8' },
  t11: { name: 'Quaybridge Inter.',     p: '#000A4B', s: '#0EA5E9' },
  t12: { name: 'Honor Oak Hooligans',   p: '#C9A400', s: '#0E0E0C' },
};

const PITCHES = {
  p1: 'Pitch 1 · North', p2: 'Pitch 2 · Centre', p3: 'Pitch 3 · South',
  p4: 'Pitch 4 · Indoor', p5: 'Pitch 5 · Cage',
};
const REFS = {
  r1: { name: 'Maya Petersen', rating: 5 }, r2: { name: 'Daniel Okafor', rating: 4 },
  r3: { name: 'Priya Shah', rating: 5 },    r4: { name: 'Tomás Reyes', rating: 3 },
};

/* ---------- tonight's fixtures ----------
   Live ones carry koMinsAgo so the clock derives live from a fixed "now". */
const NOW = new Date('2026-06-08T20:06:00');
function koDate(minsAgo) { return new Date(NOW.getTime() - minsAgo * 60000); }

const TONIGHT = [
  { id: 'f1', home: 't1', away: 't2', pitch: 'p1', ref: 'r1', ko: '19:30',
    status: 'in_progress', hs: 2, as: 1, koAt: koDate(36), round: 'GPL · R12' },
  { id: 'f3', home: 't5', away: 't6', pitch: 'p3', ref: 'r4', ko: '19:30',
    status: 'in_progress', hs: 3, as: 2, koAt: koDate(36), round: 'GPL · R12' },
  { id: 'f2', home: 't3', away: 't4', pitch: 'p2', ref: 'r3', ko: '19:30',
    status: 'in_progress', hs: 0, as: 0, koAt: koDate(22), round: 'GPL · R12' },
  { id: 'f4', home: 't7', away: 't8', pitch: 'p1', ref: null, ko: '20:30',
    status: 'allocated', round: 'GPL · R12' },
  { id: 'f5', home: 't9', away: 't10', pitch: null, ref: 'r2', ko: '20:30',
    status: 'scheduled', round: 'GPL · R12' },
  { id: 'f6', home: 't11', away: 't12', pitch: null, ref: null, ko: '21:30',
    status: 'scheduled', round: 'GPL · R12' },
];

const PENDING_REGS = [
  { id: 'pr1', team: 'FC Sundown', league: 'GPL Division 2', when: '4 min ago', captain: 'Marcus Yeboah' },
  { id: 'pr2', team: 'Lewisham Locomotives', league: 'GPL Division 2', when: '1h ago', captain: 'Sara Lindqvist' },
];
const INCIDENTS = [
  { id: 'i1', sev: 'critical', text: 'Pitch 4 floodlights tripping breaker', sub: 'Engineer en route · 18 min' },
  { id: 'i2', sev: 'warning', text: 'Two refs unconfirmed for Thursday cup ties', sub: 'Maya + Tomás' },
];
const PENDING_BOOKINGS = [
  { id: 'pb1', who: 'James Okonkwo', kind: 'Weekly · 6 wks', pitch: 'p3', when: 'Mon · 19:00 · 60m',
    note: 'Sunday League 5-a-side, paid up front.', ch: 'whatsapp' },
  { id: 'pb3', who: 'Daniel Park', org: 'Carter & Co', kind: 'One-off', pitch: 'p2', when: 'Fri · 21:00 · 60m',
    note: 'Team build for ~14 staff.', ch: 'email' },
  { id: 'pb5', who: 'Marcus Yeboah', kind: 'One-off', pitch: 'p3', when: 'Sat · 10:00 · 120m',
    note: "Kid's birthday — 12 kids age 8.", ch: 'phone' },
];

const PAY = { owed: 4820, collected: 3180, outstanding: 1640, rate: 0.66 };
const CHARGES = [
  { team: 't3', src: 'Fixture', due: 4500, paid: 0,    status: 'unpaid' },
  { team: 't6', src: 'Fixture', due: 4500, paid: 0,    status: 'unpaid' },
  { team: 't2', src: 'Fixture', due: 4500, paid: 2000, status: 'part' },
  { team: 't12',src: 'Fixture', due: 4500, paid: 1500, status: 'part' },
  { team: 't1', src: 'Fixture', due: 4500, paid: 4500, status: 'paid' },
  { team: 't5', src: 'Fixture', due: 4500, paid: 4500, status: 'paid' },
  { team: 't11',src: 'Booking', due: 6000, paid: 0,    status: 'unpaid' },
];

/* ---------- NAV MODEL (role + capability + feature-flag gated) ---------- */
// role rank: member -2, guardian -1, staff 0, manager 1, owner 2
const ROLES = {
  owner:    { rank: 2, label: 'Owner',   name: 'Alex Rivera',  email: 'alex@greenway.fc',
             context: { name: 'Greenway Park', kind: 'venue' },
             caps: ['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins'] },
  manager:  { rank: 1, label: 'Manager', name: 'Aimée Belanger', email: 'aimee@greenway.fc',
             context: { name: 'Northside Athletic', kind: 'team', crest: 't1' },
             caps: ['reverse_money','booking_settings','staff_directory'] },
  staff:    { rank: 0, label: 'Staff',   name: 'Rohan Vyas', email: 'reception@greenway.fc',
             context: { name: 'Greenway Park', kind: 'venue' },
             caps: [] },
  guardian: { rank: -1, label: 'Guardian', name: 'Priya Anand', email: 'priya.anand@gmail.com',
             context: { name: "Joel's team · Brockley Rovers", kind: 'team', crest: 't3' },
             caps: [] },
  member:   { rank: -2, label: 'Member', name: 'Daniel Okafor', email: 'daniel.okafor@gmail.com',
             context: { name: 'Brockley Rovers', kind: 'team', crest: 't3' },
             caps: [] },
};
const FLAGS = { bookings:true, spaces:true, room_hire:true, equipment:true, memberships:true,
                coaching:true, competition:true, club_leagues:true, tournaments:true };
const CUP_EXISTS = true;

/* ---------- profile data (per role) ---------- */
const PROFILE = {
  owner: {
    venues: [
      { id:'gw', name:'Greenway Park', sub:'5 pitches · 3 rooms', active:true },
      { id:'rv', name:'Riverside Courts', sub:'4 courts · 2 rooms' },
      { id:'es', name:'Eastside Arena', sub:'3 pitches · 1 hall' },
    ],
    notif: [['match','Live match alerts',true],['pay','Payment activity',true],['book','Booking requests',true],['inc','Incident escalations',true]],
  },
  manager: {
    team: 't1', teamSub: 'GPL Division 1 · 18 players',
    notif: [['match','Match reminders',true],['pay','Payment activity',true],['book','Booking requests',false]],
  },
  staff: {
    venue: 'Greenway Park',
    notif: [['match','Live match alerts',true],['book','Booking requests',true]],
  },
  guardian: {
    children: [
      { id:'joel', name:'Joel Anand', first:'Joel', age:'U12', num:7, sub:'Brockley Rovers · U12', world:'jr_u12',
        membership:{ status:'Active', since:'1 Sep 2025', renews:'1 Sep 2026', plan:'Junior season' },
        fees:[
          { id:'season', icon:'card',  label:'Season membership', sub:'2025/26 · Junior',  amt:18000, status:'paid', when:'Paid 2 Sep 2025' },
          { id:'subs',   icon:'pound', label:'Match subs · June',  sub:'£4 × 3 matches',    amt:1200,  status:'due',  when:'Due 30 Jun' },
          { id:'kit',    icon:'shield',label:'Away kit top',       sub:'Optional · size YM', amt:2400, status:'due',  when:'Optional add-on' },
          { id:'tour',   icon:'cup',   label:'Summer tournament',  sub:'Crystal Palace 7s · 5 Jul', amt:1500, status:'paid', when:'Paid 10 Jun' },
        ] },
      { id:'maya', name:'Maya Anand', first:'Maya', age:'U14 Girls', num:9, sub:'Brockley Rovers · U14 Girls', world:'jr_u14',
        membership:{ status:'Active', since:'8 Jan 2026', renews:'1 Sep 2026', plan:'Junior season' },
        fees:[
          { id:'season', icon:'card',  label:'Season membership', sub:'2025/26 · Junior · mid-year', amt:13500, status:'paid', when:'Paid 8 Jan 2026' },
          { id:'subs',   icon:'pound', label:'Match subs · June',  sub:'£4 × 2 matches',  amt:800,  status:'due', when:'Due 30 Jun' },
          { id:'camp',   icon:'grid',  label:'Summer camp deposit',sub:'August holiday camp', amt:3000, status:'due', when:'Balance later' },
        ] },
    ],
    card: { brand:'Visa', last4:'4471' },
    notif: [['match','Match reminders',true],['pay','Payment reminders',true]],
  },
  member: {
    team: 't3', memberId: 'BR·11420',
    membership: { status:'Active', since:'1 Sep 2025', renews:'1 Sep 2026', plan:'Adult season' },
    card: { brand:'Mastercard', last4:'8820' },
    notif: [['match','Match reminders',true],['pay','Payment reminders',true]],
  },
};

// each: id, label, group, icon, [flag], [cap], [minRole], [desc]
const NAV = [
  // RUN
  { id:'operations', label:'Operations', group:'Run', icon:'pulse', minRole:0, desc:"Tonight's fixtures, live" },
  { id:'bookings', label:'Bookings', group:'Run', icon:'calendar', flag:'bookings', minRole:0, desc:'Calendar, requests, grounds' },
  { id:'payments', label:'Payments', group:'Run', icon:'pound', minRole:0, desc:'Charges, revenue, billing' },
  // PEOPLE
  { id:'members', label:'Members', group:'People', icon:'users', flag:'memberships', minRole:0, desc:'Members + guardians' },
  { id:'memberships', label:'Memberships', group:'People', icon:'card', flag:'memberships', minRole:1, desc:'Tiers, grading, club' },
  { id:'teams', label:'Teams', group:'People', icon:'shield', minRole:0, desc:'League, casual + club teams' },
  { id:'staff', label:'Staff', group:'People', icon:'whistle', minRole:0, desc:'Officials, venue staff, coaches' },
  // PROGRAMMES
  { id:'timetable', label:'Timetable', group:'Programmes', icon:'grid', flag:'coaching', minRole:0, desc:'Classes + team training' },
  { id:'trainers', label:'Trainers', group:'Programmes', icon:'figure', flag:'coaching', minRole:1, desc:'PT roster + appointments' },
  { id:'equipment', label:'Equipment', group:'Programmes', icon:'box', flag:'equipment', minRole:0, desc:'Catalogue, hires, utilisation' },
  { id:'rooms', label:'Rooms', group:'Programmes', icon:'door', flag:'spaces', minRole:0, desc:'Spaces + room bookings' },
  // COMPETITION
  { id:'club_leagues', label:'Club Leagues', group:'Competition', icon:'globe', flag:'club_leagues', minRole:1, desc:'External fixtures + matchday' },
  { id:'league', label:'Internal League', group:'Competition', icon:'trophy', flag:'competition', minRole:1, desc:'Overview + season setup' },
  { id:'standings', label:'Standings', group:'Competition', icon:'list', flag:'competition', desc:'Round-robin table' },
  { id:'cups', label:'Cups', group:'Competition', icon:'cup', flag:'tournaments', minRole:1, cupOnly:true, desc:'Knockout brackets' },
  // CLUB & ADMIN
  { id:'broadcasts', label:'Broadcasts', group:'Club & Admin', icon:'bell', minRole:0, desc:'Message teams & members' },
  { id:'qr', label:'QR codes', group:'Club & Admin', icon:'qr', desc:'Join / check-in links' },
  { id:'access', label:'Access', group:'Club & Admin', icon:'key', cap:'manage_logins', desc:'Admin roster + capabilities' },
];
const NAV_GROUPS = ['Run','People','Programmes','Competition','Club & Admin'];

function navVisible(item, roleKey) {
  const r = ROLES[roleKey];
  if (item.minRole != null && r.rank < item.minRole) return false;
  if (item.cap && !r.caps.includes(item.cap)) return false;
  if (item.flag && !FLAGS[item.flag]) return false;
  if (item.cupOnly && !CUP_EXISTS) return false;
  return true;
}
// primary tab bar set, role-aware
function tabsFor(roleKey) {
  const r = ROLES[roleKey];
  if (r.rank < 0) return ['matches','league','membership','more']; // consumer roles: guardian / member
  const base = ['operations','bookings'];
  if (roleKey !== 'staff') base.push('payments');
  base.push('people'); // hub
  base.push('more');
  return base;
}

/* ---------- helpers ---------- */
function initials(name) {
  const w = name.split(/\s+/).filter(Boolean);
  if (w.length === 1) return w[0].slice(0,2).toUpperCase();
  return (w[0][0] + w[w.length-1][0]).toUpperCase();
}
function gbp(pence, dec) {
  const v = pence / 100;
  return '£' + (dec ? v.toFixed(2) : Math.round(v).toLocaleString('en-GB'));
}
function liveMinute(koAt, now) {
  return Math.max(0, Math.floor((now - koAt) / 60000));
}
let _t0 = Date.now();
function tickOffset() { return Date.now() - _t0; }
// anchored "now": starts at the fixed demo clock, advances in real time so
// live match minutes climb believably while the prototype is open.
function useNow(intervalMs) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), intervalMs || 1000);
    return () => clearInterval(id);
  }, [intervalMs]);
  return NOW.getTime() + tickOffset();
}

/* count-up hook for numbers */
function useCountUp(target, dur, deps) {
  const [val, setVal] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current, to = target, t0 = performance.now();
    if (from === to) return;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / (dur || 600));
      const e = 1 - Math.pow(1 - k, 3);
      setVal(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else prev.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, deps || [target]);
  return val;
}

/* ---------- crest component ---------- */
function Crest({ id, size = 40, r = 9, fs, style }) {
  const t = TEAMS[id] || { name: '??', p: '#444', s: '#222' };
  return (
    <div className="crest" style={{
      width: size, height: size, borderRadius: r,
      background: `linear-gradient(135deg, ${t.p} 0 48%, ${t.s} 52% 100%)`,
      fontSize: fs || size * 0.36, ...style,
    }}>{initials(t.name)}</div>
  );
}

/* ---------- icon registry (stroke line icons) ---------- */
function Icon({ name, size = 22, stroke = 1.7, color = 'currentColor', style }) {
  const p = { fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    pulse: <path {...p} d="M3 12h3l2.5-7 5 14 2.5-7H21"/>,
    calendar: <g {...p}><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></g>,
    pound: <g {...p}><path d="M16 7.5a3.5 3.5 0 0 0-7 0c0 5-1.5 6.5-2.5 7.5h11"/><path d="M6.5 11.5h7M6.5 19h11"/></g>,
    users: <g {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.5-3 2.8-4.5 5.5-4.5S14 16 14.5 19"/><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19c-.3-2-1.3-3.3-2.5-4"/></g>,
    card: <g {...p}><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M6.5 14.5h4"/></g>,
    shield: <path {...p} d="M12 3l7 2.5v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9v-6L12 3z"/>,
    whistle: <g {...p}><circle cx="9" cy="13" r="5"/><path d="M13.5 11l7-3M13.5 11l6.5 0M9 8V5.5h3"/></g>,
    grid: <g {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></g>,
    figure: <g {...p}><circle cx="12" cy="5" r="2.3"/><path d="M12 8v7M12 11l-4 2M12 11l4 2M12 15l-3 5M12 15l3 5"/></g>,
    box: <g {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></g>,
    door: <g {...p}><path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M5 21h14"/><circle cx="13" cy="12" r="1" fill={color} stroke="none"/></g>,
    globe: <g {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></g>,
    trophy: <g {...p}><path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M9 19h6M12 13v6"/></g>,
    list: <g {...p}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></g>,
    cup: <g {...p}><path d="M6 4h12v3a6 6 0 0 1-12 0V4z"/><path d="M9 16h6M12 13v3M9 20h6"/></g>,
    qr: <g {...p}><rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14.5 14.5h2v2M20.5 14.5v6M16.5 20.5h4M16.5 18h0"/></g>,
    toggle: <g {...p}><rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16" cy="12" r="2.7" fill={color} stroke="none"/></g>,
    key: <g {...p}><circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M16 16l2-2M18 18l2-2"/></g>,
    plug: <g {...p}><path d="M9 2v5M15 2v5M6 7h12v3a6 6 0 0 1-12 0V7zM12 16v6"/></g>,
    search: <g {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></g>,
    bell: <g {...p}><path d="M6 9a6 6 0 0 1 12 0c0 5 1.5 6 2 7H4c.5-1 2-2 2-7zM10 20a2 2 0 0 0 4 0"/></g>,
    plus: <path {...p} d="M12 5v14M5 12h14"/>,
    check: <path {...p} d="M4 12.5l5 5 11-11"/>,
    x: <path {...p} d="M6 6l12 12M18 6L6 18"/>,
    chevron: <path {...p} d="M9 5l7 7-7 7"/>,
    chevdown: <path {...p} d="M5 9l7 7 7-7"/>,
    dots: <g {...p}><rect x="3.5" y="4" width="7" height="7" rx="1.8"/><rect x="13.5" y="4" width="7" height="7" rx="1.8"/><rect x="3.5" y="14" width="7" height="7" rx="1.8"/><circle cx="17" cy="17.5" r="3.6"/></g>,
    flag: <g {...p}><path d="M5 3v18M5 4h11l-2 4 2 4H5"/></g>,
    clock: <g {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g>,
    alert: <g {...p}><path d="M12 3l9 16H3l9-16zM12 10v4M12 17h.01"/></g>,
    info: <g {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></g>,
    tv: <g {...p}><rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8 21h8M12 17v4"/></g>,
    spark: <path {...p} d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>,
    refresh: <g {...p}><path d="M20 11a8 8 0 1 0-1 5"/><path d="M20 5v6h-6"/></g>,
    arrow: <path {...p} d="M5 12h14M13 6l6 6-6 6"/>,
    cog: <g {...p}><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></g>,
    out: <g {...p}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 12h10M16 8l4 4-4 4"/></g>,
    phone: <path {...p} d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L20 13l-1 4a16 16 0 0 1-14-13z"/>,
    whatsapp: <g {...p}><path d="M4 20l1.5-4A8 8 0 1 1 9 19l-5 1z"/></g>,
    mail: <g {...p}><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 7l8 6 8-6"/></g>,
    pin: <g {...p}><path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></g>,
    star: <path {...p} d="M12 3l2.5 5.5 6 .5-4.5 4 1.5 6L12 16l-5 3 1.5-6L4 9l6-.5L12 3z"/>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true">
      {paths[name] || null}
    </svg>
  );
}

const channelIcon = { whatsapp:'whatsapp', phone:'phone', email:'mail' };

Object.assign(window, {
  React, useState, useEffect, useRef, useCallback,
  TEAMS, PITCHES, REFS, TONIGHT, NOW, PENDING_REGS, INCIDENTS, PENDING_BOOKINGS,
  PAY, CHARGES, ROLES, FLAGS, PROFILE, NAV, NAV_GROUPS, navVisible, tabsFor,
  initials, gbp, liveMinute, useNow, useCountUp, tickOffset,
  Crest, Icon, channelIcon,
  THEME_KEY, applyTheme, getThemePref, setThemePref, systemTheme,
});
