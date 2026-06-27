/* m-guardian.jsx — consumer (guardian / member) experience.
   Three primary tabs: Matches · League · Membership.
   A "world" abstracts the difference between a parent's junior team and a
   player's own senior team so both roles share the same views. */

/* ---------- junior team registry (palette only) ---------- */
const JR = {
  br: { name: 'Brockley Rovers',    p: '#0F7B5A', s: '#F4F1E8' },
  ho: { name: 'Honor Oak Owls',     p: '#C9A400', s: '#0E0E0C' },
  pp: { name: 'Peckham Pumas',      p: '#1E5BAA', s: '#F4D03F' },
  dd: { name: 'Dulwich Dragons',    p: '#7E1F2A', s: '#E6D9B8' },
  ff: { name: 'Forest Hill Foxes',  p: '#E08B1F', s: '#2A2A2E' },
  cc: { name: 'Camberwell Comets',  p: '#6E2A8C', s: '#F0C75E' },
  nx: { name: 'New Cross Knights',  p: '#28394A', s: '#C9B98A' },
  ss: { name: 'Sydenham Sharks',    p: '#B23A48', s: '#F7D38C' },
};

const JR_SQUAD = [
  [1,'Ben Carter','GK'],[2,'Theo Walsh','DF'],[3,'Amir Khan','DF'],[4,'Leo Fenton','DF'],
  [5,'Sam Whitfield','DF'],[6,'Noah Pereira','MF'],[7,'Joel Anand','MF'],[8,'Kai Osei','MF'],
  [9,'Finn Doyle','FW'],[10,'Reuben Clarke','FW'],[11,'Marco Rossi','FW'],[12,'Ollie Grant','SUB'],
];
const SR_SQUAD = [
  [1,'Marek Nowak','GK'],[2,'Tom Hayes','DF'],[3,'Sol Adebayo','DF'],[4,'Chris Dunne','DF'],
  [5,'Ravi Menon','DF'],[6,'Jordan Blake','MF'],[8,'Owen Pryce','MF'],[10,'Liam Foster','MF'],
  [9,'Andre Costa','FW'],[7,'Sean Mullan','FW'],[11,'Daniel Okafor','FW'],[14,'Yusuf Demir','SUB'],
];

/* ---------- the two worlds ---------- */
const JUNIOR_WORLD = {
  reg: JR, my: 'br', league: 'Junior League', division: 'U12 South', round: 'Round 13',
  coach: 'Marcus Bell', squad: JR_SQUAD,
  live: { home:'br', away:'ho', hs:1, as:1, koMin:24, comp:'U12 South · R13',
          venue:'Greenway Park · P3', ref:'Sunday volunteers', last:"Honor Oak level it · 21'" },
  fixtures: [
    { opp:'pp', ha:'A', when:'Sat 14 Jun', ko:'10:30', venue:'Peckham Rye 3G', rsvp:null },
    { opp:'ff', ha:'H', when:'Sat 21 Jun', ko:'10:00', venue:'Greenway Park · P3', rsvp:'in' },
    { opp:'ss', ha:'A', when:'Sat 28 Jun', ko:'11:00', venue:'Sydenham Wells', rsvp:null },
  ],
  results: [
    { opp:'cc', ha:'H', us:3, them:1, when:'Sat 31 May', note:'Joel 2 goals' },
    { opp:'dd', ha:'A', us:1, them:1, when:'Sat 24 May', note:'Joel assist' },
    { opp:'nx', ha:'H', us:4, them:0, when:'Sat 17 May', note:'Joel 1 goal' },
  ],
  table: [
    ['pp',12,9,2,1,21,29],['br',12,8,3,1,15,27],['ho',12,8,1,3,11,25],['dd',12,6,3,3,5,21],
    ['ff',12,5,3,4,2,18],['cc',12,4,2,6,-6,14],['nx',12,2,3,7,-12,9],['ss',12,1,1,10,-21,4],
  ],
  divFixtures: [['pp','br','10:30'],['ho','dd','10:30'],['ff','cc','12:00'],['nx','ss','12:00']],
  divResults: [['br','cc',3,1],['dd','ho',2,2],['nx','ff',0,3],['ss','pp',1,5]],
  schedule: [
    { day:'Tue 10 Jun', items:[{ time:'18:00', title:'Team training', sub:'Greenway Park · P3', icon:'figure' }] },
    { day:'Thu 12 Jun', items:[{ time:'18:00', title:'Team training', sub:'Greenway Park · P3', icon:'figure' }] },
    { day:'Fri 13 Jun', items:[{ time:'17:00', title:'Skills School', sub:'Optional class · booked', icon:'grid' }] },
    { day:'Sat 14 Jun', items:[{ time:'10:30', title:'Peckham Pumas (A)', sub:'Match · Peckham Rye 3G', icon:'pulse' }] },
  ],
};
const SENIOR_WORLD = {
  reg: TEAMS, my: 't3', league: 'GPL', division: 'Division 1', round: 'Round 12',
  coach: 'Aimée Belanger', squad: SR_SQUAD,
  live: { home:'t3', away:'t4', hs:0, as:0, koMin:22, comp:'GPL · R12',
          venue:'Greenway Park · P2', ref:'Priya Shah', last:"Goalless · 0–0" },
  fixtures: [
    { opp:'t2', ha:'A', when:'Sun 15 Jun', ko:'14:00', venue:'Eastpark Rec', rsvp:null },
    { opp:'t7', ha:'H', when:'Sun 22 Jun', ko:'15:00', venue:'Greenway Park · P1', rsvp:'in' },
    { opp:'t10', ha:'A', when:'Sun 29 Jun', ko:'13:00', venue:"St Olave's", rsvp:null },
  ],
  results: [
    { opp:'t9', ha:'H', us:2, them:0, when:'Sun 1 Jun', note:'Clean sheet' },
    { opp:'t5', ha:'A', us:1, them:3, when:'Sun 25 May', note:'' },
    { opp:'t11', ha:'H', us:2, them:2, when:'Sun 18 May', note:'Daniel 1 goal' },
  ],
  table: STANDINGS,
  divFixtures: [['t1','t2','19:30'],['t5','t6','19:30'],['t3','t4','19:30'],['t7','t8','20:30']],
  divResults: [['t1','t9',3,0],['t3','t10',2,1],['t5','t8',4,1],['t11','t12',2,0]],
  schedule: [
    { day:'Tonight · Mon 8 Jun', items:[{ time:'19:30', title:'Old Brompton Stars (H)', sub:'Match · Greenway P2 · live now', icon:'pulse' }] },
    { day:'Wed 10 Jun', items:[{ time:'20:00', title:'Team training', sub:'Greenway Park · P1', icon:'figure' }] },
    { day:'Sun 15 Jun', items:[{ time:'14:00', title:'Eastpark United (A)', sub:'Match · Eastpark Rec', icon:'pulse' }] },
  ],
};
const JUNIOR_WORLD_2 = {
  reg: JR, my: 'br', league: 'Junior League', division: 'U14 Girls', round: 'Round 11',
  coach: 'Dani Okafor', squad: [
    [1,'Ella Brooks','GK'],[2,'Aisha Rahman','DF'],[3,'Grace Miller','DF'],[4,'Sofia Romano','DF'],
    [5,'Hannah Cole','DF'],[6,'Lily Chen','MF'],[7,'Zara Hassan','MF'],[8,'Freya Watson','MF'],
    [9,'Maya Anand','FW'],[10,'Chloe Davies','FW'],[11,'Isla Murphy','FW'],[12,'Ava Thompson','SUB'],
  ],
  live: null,
  fixtures: [
    { opp:'ff', ha:'H', when:'Sat 14 Jun', ko:'12:00', venue:'Greenway Park · P1', rsvp:null },
    { opp:'pp', ha:'A', when:'Sat 21 Jun', ko:'12:30', venue:'Peckham Rye 3G', rsvp:'in' },
    { opp:'cc', ha:'H', when:'Sat 28 Jun', ko:'12:00', venue:'Greenway Park · P1', rsvp:null },
  ],
  results: [
    { opp:'dd', ha:'A', us:2, them:2, when:'Sat 31 May', note:'Maya 1 goal' },
    { opp:'ss', ha:'H', us:5, them:0, when:'Sat 24 May', note:'Maya 2 goals' },
    { opp:'nx', ha:'A', us:1, them:2, when:'Sat 17 May', note:'' },
  ],
  table: [
    ['ho',11,8,2,1,16,26],['dd',11,8,1,2,12,25],['pp',11,7,2,2,9,23],['br',11,6,2,3,7,20],
    ['ff',11,5,2,4,1,17],['cc',11,3,3,5,-5,12],['ss',11,2,2,7,-14,8],['nx',11,1,2,8,-16,5],
  ],
  divFixtures: [['br','ff','12:00'],['ho','pp','12:00'],['dd','cc','13:30'],['ss','nx','13:30']],
  divResults: [['dd','br',2,2],['pp','cc',3,1],['ho','nx',4,0],['ss','ff',1,3]],
  schedule: [
    { day:'Mon 9 Jun', items:[{ time:'18:30', title:'Team training', sub:'Greenway Park · P1', icon:'figure' }] },
    { day:'Wed 11 Jun', items:[{ time:'18:30', title:'Team training', sub:'Greenway Park · P1', icon:'figure' }] },
    { day:'Sat 14 Jun', items:[{ time:'12:00', title:'Forest Hill Foxes (H)', sub:'Match · Greenway Park · P1', icon:'pulse' }] },
  ],
};

/* world + subject resolution, keyed on the active child (guardian) or self (member) */
const WORLDS = { jr_u12: JUNIOR_WORLD, jr_u14: JUNIOR_WORLD_2, senior: SENIOR_WORLD };
function activeChild(role, childId) {
  if (role !== 'guardian') return null;
  const kids = PROFILE.guardian.children;
  return kids.find(c => c.id === childId) || kids[0];
}
function worldFor(role, childId) {
  if (role === 'guardian') return WORLDS[activeChild(role, childId).world] || JUNIOR_WORLD;
  return SENIOR_WORLD;
}
function subjectFor(role, childId) {
  if (role === 'guardian') {
    const c = activeChild(role, childId);
    return { id:c.id, name:c.name, first:c.first, poss:`${c.first}'s`, num:c.num, age:c.age, kind:'child' };
  }
  return { name:'Daniel Okafor', first:'Daniel', poss:'Your', num:11, age:'Senior', kind:'self' };
}
function feesFor(role, childId) { return role === 'guardian' ? activeChild(role, childId).fees : MEMBER_FEES; }
function consumerCard(role, childId) {
  if (role === 'guardian') {
    const c = activeChild(role, childId), w = worldFor(role, childId);
    return { name:c.name, team:w.reg[w.my], membership:c.membership, memberId:null };
  }
  const p = PROFILE.member;
  return { name:ROLES.member.name, team:TEAMS[p.team], membership:p.membership, memberId:p.memberId };
}

/* ---------- member fees + programmes ---------- */
const MEMBER_FEES = [
  { id:'season', icon:'card',  label:'Season membership',    sub:'2025/26 · Junior', amt:18000, status:'paid', when:'Paid 2 Sep 2025' },
  { id:'subs',   icon:'pound', label:'Match subs · June',    sub:'£4 × 3 matches',   amt:1200,  status:'due',  when:'Due 30 Jun' },
  { id:'kit',    icon:'shield',label:'Away kit top',         sub:'Optional · size YM', amt:2400, status:'due',  when:'Optional add-on' },
  { id:'tour',   icon:'cup',   label:'Summer tournament',    sub:'Crystal Palace 7s · 5 Jul', amt:1500, status:'paid', when:'Paid 10 Jun' },
];
const PROGRAMMES = [
  { id:'skills', icon:'figure',  name:'Friday Skills School', sub:'Weekly · Fri 17:00 · 8 weeks', price:6000,  spots:'4 spaces left' },
  { id:'gk',     icon:'shield',  name:'Goalkeeping Clinic',   sub:'Monthly · Sat 09:00',          price:1200,  spots:'Open' },
  { id:'camp',   icon:'grid',    name:'Summer Holiday Camp',  sub:'Aug · 5 days · 9am–3pm',        price:12000, spots:'Filling up' },
  { id:'1to1',   icon:'whistle', name:'1-to-1 coaching',      sub:'Book a slot with a coach',      price:3500,  spots:'By appointment' },
];

/* ---------- shared bits ---------- */
function WBadge({ world, id, size = 40, r = 11, fs, style }) {
  const t = world.reg[id] || { name:'??', p:'#444', s:'#222' };
  return (
    <div className="crest" style={{ width:size, height:size, borderRadius:r,
      background:`linear-gradient(135deg, ${t.p} 0 48%, ${t.s} 52% 100%)`, fontSize: fs || size*0.36, ...style }}>
      {initials(t.name)}
    </div>
  );
}
const resultOf = (us, them) => us > them ? 'W' : us < them ? 'L' : 'D';
function ResultBadge({ us, them, size = 30 }) {
  const r = resultOf(us, them);
  const col = r==='W' ? 'var(--ok-ink)' : r==='L' ? 'var(--live-ink)' : 'var(--ink2)';
  const bg  = r==='W' ? 'var(--ok-soft)' : r==='L' ? 'var(--live-soft)' : 'var(--s3)';
  return <span style={{ width:size, height:size, borderRadius:9, flex:'none', display:'flex', alignItems:'center',
    justifyContent:'center', background:bg, color:col, fontSize:13, fontWeight:800 }}>{r}</span>;
}

/* ============================================================ MATCHES (consumer hero) */
function GuardianMatches({ app, role }) {
  const w = worldFor(role, app.childId);
  const subj = subjectFor(role, app.childId);
  const live = w.live;
  const now = useNow(1000);
  const koAt = live ? new Date(NOW.getTime() - live.koMin * 60000) : null;
  const min = live ? liveMinute(koAt, now) : 0;
  const blink = Math.floor(now / 1000) % 2 === 0;
  const pct = Math.min(100, (min / 50) * 100);
  const home = live ? w.reg[live.home] : null, away = live ? w.reg[live.away] : null;
  const myScore = live ? (live.home === w.my ? live.hs : live.as) : 0;
  const oppScore = live ? (live.home === w.my ? live.as : live.hs) : 0;
  const winning = myScore > oppScore, losing = myScore < oppScore;
  const next = w.fixtures[0];

  const [rsvp, setRsvp] = useState(() => Object.fromEntries(w.fixtures.map((f,i) => [i, f.rsvp])));
  const setAvail = (i, v) => {
    setRsvp(s => ({ ...s, [i]: v }));
    app.toast({ icon: v==='in'?'check':'x', tone: v==='in'?'ok':'live',
      text: v==='in' ? `${subj.first} marked available` : `${subj.first} marked unavailable`,
      sub: w.reg[w.fixtures[i].opp].name });
  };

  return (
    <div className="view">
      <TournamentBanner app={app} />
      {/* LIVE banner */}
      {live ? <React.Fragment>
      <div className="eyebrow" style={{ margin:'8px 2px 10px', display:'flex', alignItems:'center', gap:7 }}>
        <span className="live-dot" style={{ width:7, height:7 }} />Live now · {subj.poss} team
      </div>
      <button onClick={() => app.openSheet(<LiveMatchSheet app={app} match={liveMatchFromWorld(w)} />)}
        className="card" style={{ width:'100%', textAlign:'left', cursor:'pointer', padding:0, overflow:'hidden', position:'relative',
          boxShadow:'0 0 0 1.5px var(--live), 0 12px 34px -14px var(--live-soft)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px 8px' }}>
          <span className="eyebrow" style={{ fontSize:10.5 }}>{w.live.comp} · {w.live.venue}</span>
          <span className="pill pill-live"><span className="live-dot" style={{ width:6, height:6 }} />LIVE</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', padding:'2px 14px 12px', gap:12 }}>
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:9, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, minWidth:0 }}>
              <WBadge world={w} id={w.live.home} size={26} r={7} />
              <span style={{ fontSize:15, fontWeight: w.live.hs>=w.live.as?700:600, color: w.live.hs>=w.live.as?'var(--ink)':'var(--ink2)',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{home.name}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:9, minWidth:0 }}>
              <WBadge world={w} id={w.live.away} size={26} r={7} />
              <span style={{ fontSize:15, fontWeight: w.live.as>=w.live.hs?700:600, color: w.live.as>=w.live.hs?'var(--ink)':'var(--ink2)',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{away.name}</span>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, paddingLeft:8 }}>
            <div className="tnum" style={{ fontSize:34, fontWeight:800, letterSpacing:'-0.04em', lineHeight:1 }}>
              {w.live.hs}<span style={{ color:'var(--ink4)', margin:'0 4px', fontWeight:600 }}>:</span>{w.live.as}
            </div>
            <div className="tnum" style={{ fontSize:12.5, fontWeight:700, color:'var(--live)' }}>
              {min}<span style={{ opacity: blink?1:0.25, transition:'opacity .15s' }}>′</span>
            </div>
          </div>
        </div>
        <div style={{ height:3, background:'var(--s3)', position:'relative' }}>
          <div style={{ position:'absolute', inset:0, width:pct+'%', background:'linear-gradient(90deg, var(--live), #FF8478)', boxShadow:'0 0 12px var(--live)' }} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 14px', color:'var(--ink3)', fontSize:12, fontWeight:600 }}>
          <span className="pill pill-mut" style={{ height:20, fontSize:10.5, color: winning?'var(--ok-ink)':losing?'var(--live-ink)':'var(--ink2)' }}>
            {winning ? `${subj.poss} team ahead` : losing ? 'Behind' : 'Level'}
          </span>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{w.live.last}</span>
          <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:5, flex:'none' }}>Live <Icon name="chevron" size={13} /></span>
        </div>
      </button>
      </React.Fragment> : (
        <React.Fragment>
        <div className="eyebrow" style={{ margin:'8px 2px 10px' }}>{subj.poss} team · no live match</div>
        <div className="card" style={{ padding:'16px 15px', display:'flex', alignItems:'center', gap:13 }}>
          <div style={{ width:42, height:42, borderRadius:13, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="clock" size={20} color="var(--ink3)" /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:700 }}>No match in play right now</div>
            <div style={{ fontSize:12.5, color:'var(--ink3)', marginTop:2 }}>Next: {next.when} · {next.ha==='H'?'vs':'away to'} {w.reg[next.opp].name}</div>
          </div>
        </div>
        </React.Fragment>
      )}

      {/* UP NEXT + availability */}
      <div className="sec-head"><h2>Up next</h2><span className="meta">{subj.poss} availability</span></div>
      {w.fixtures.map((f, i) => (
        <div key={i} className="card" style={{ padding:'13px 14px', marginBottom:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div className="tnum" style={{ width:50, flex:'none', textAlign:'center' }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:'var(--ink2)' }}>{f.when.replace(/^\w+ /, m => m)}</div>
              <div style={{ fontSize:11, color:'var(--ink3)', marginTop:1 }}>{f.ko}</div>
            </div>
            <WBadge world={w} id={f.opp} size={38} r={11} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{w.reg[f.opp].name}</div>
              <div style={{ fontSize:12, color:'var(--ink3)', marginTop:3, display:'flex', alignItems:'center', gap:7, minWidth:0 }}>
                <span className="pill pill-mut" style={{ height:18, fontSize:10, padding:'0 7px', flex:'none' }}>{f.ha==='H'?'Home':'Away'}</span>
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.venue}</span>
              </div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:11, paddingTop:11, borderTop:'1px solid var(--hair)' }}>
            <span style={{ fontSize:12.5, color:'var(--ink3)', fontWeight:600, flex:1 }}>
              {rsvp[i]==='in' ? `${subj.first} is available` : rsvp[i]==='out' ? `${subj.first} can't make it` : `Is ${subj.first} available?`}
            </span>
            <button onClick={() => setAvail(i,'in')} className="pill" style={{ height:30, padding:'0 13px', cursor:'pointer', border:'1px solid',
              background: rsvp[i]==='in'?'var(--ok-soft)':'transparent', color: rsvp[i]==='in'?'var(--ok-ink)':'var(--ink3)', borderColor: rsvp[i]==='in'?'var(--ok)':'var(--hair2)' }}>
              <Icon name="check" size={13} />In</button>
            <button onClick={() => setAvail(i,'out')} className="pill" style={{ height:30, padding:'0 13px', cursor:'pointer', border:'1px solid',
              background: rsvp[i]==='out'?'var(--live-soft)':'transparent', color: rsvp[i]==='out'?'var(--live-ink)':'var(--ink3)', borderColor: rsvp[i]==='out'?'var(--live)':'var(--hair2)' }}>
              <Icon name="x" size={13} />Out</button>
          </div>
        </div>
      ))}

      {/* RECENT RESULTS */}
      <div className="sec-head"><h2>Recent results</h2><span className="meta">last {w.results.length}</span></div>
      {w.results.map((r, i) => (
        <div key={i} className="card" style={{ padding:'12px 14px', marginBottom:9, display:'flex', alignItems:'center', gap:12 }}>
          <ResultBadge us={r.us} them={r.them} />
          <WBadge world={w} id={r.opp} size={34} r={9} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {w.reg[r.opp].name} <span style={{ color:'var(--ink4)', fontWeight:500 }}>({r.ha})</span>
            </div>
            <div style={{ fontSize:12, color:'var(--ink3)', marginTop:1 }}>{r.when}{r.note ? ` · ${r.note}` : ''}</div>
          </div>
          <div className="tnum" style={{ fontSize:18, fontWeight:800, letterSpacing:'-0.02em', flex:'none' }}>{r.us}<span style={{ color:'var(--ink4)', margin:'0 3px' }}>–</span>{r.them}</div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================ LEAGUE */
function GuardianLeague({ app, role }) {
  const w = worldFor(role, app.childId);
  const [tab, setTab] = useState('table');
  return (
    <div className="view">
      <div className="sec-head" style={{ marginTop:6 }}><h2>{w.league}</h2><span className="meta">{w.division} · {w.round}</span></div>

      <div style={{ display:'flex', gap:4, padding:5, background:'var(--s2)', borderRadius:14, border:'1px solid var(--hair)' }}>
        {[['table','Table'],['fixtures','Fixtures'],['results','Results']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, height:36, borderRadius:10, border:'none', cursor:'pointer',
            fontFamily:'var(--font)', fontWeight:700, fontSize:13.5, transition:'color .2s',
            background: tab===id?'var(--s4)':'transparent', color: tab===id?'var(--ink)':'var(--ink3)' }}>{label}</button>
        ))}
      </div>

      {tab==='table' && (
        <div className="card" style={{ overflow:'hidden', marginTop:14 }}>
          <div className="tnum" style={{ display:'grid', gridTemplateColumns:'26px 1fr 26px 26px 30px 30px', padding:'9px 14px',
            fontSize:11, fontWeight:700, color:'var(--ink3)', borderBottom:'1px solid var(--hair)' }}>
            <span>#</span><span>Team</span><span style={{ textAlign:'center' }}>W</span><span style={{ textAlign:'center' }}>L</span>
            <span style={{ textAlign:'center' }}>GD</span><span style={{ textAlign:'center', color:'var(--ink2)' }}>Pts</span>
          </div>
          {w.table.map(([id,p,won,d,l,gd,pts], i) => {
            const mine = id === w.my;
            return (
              <div key={id} className="tnum" style={{ display:'grid', gridTemplateColumns:'26px 1fr 26px 26px 30px 30px', alignItems:'center',
                padding:'10px 14px', fontSize:13, borderBottom: i<w.table.length-1?'1px solid var(--hair)':'none',
                background: mine?'var(--amber-soft)':'transparent' }}>
                <span style={{ fontWeight:700, color: mine?'var(--amber)':i<2?'var(--ink2)':'var(--ink3)' }}>{i+1}</span>
                <span style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:w.reg[id].p, flex:'none' }} />
                  <span style={{ fontSize:13, fontWeight: mine?800:600, color: mine?'var(--amber)':'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{w.reg[id].name}</span>
                  {mine && <span className="pill pill-warn" style={{ height:16, fontSize:9, padding:'0 5px', flex:'none' }}>YOU</span>}
                </span>
                <span style={{ textAlign:'center', color:'var(--ink2)' }}>{won}</span>
                <span style={{ textAlign:'center', color:'var(--ink3)' }}>{l}</span>
                <span style={{ textAlign:'center', color: gd>0?'var(--ok-ink)':gd<0?'var(--live-ink)':'var(--ink3)' }}>{gd>0?'+':''}{gd}</span>
                <span style={{ textAlign:'center', fontWeight:800 }}>{pts}</span>
              </div>
            );
          })}
        </div>
      )}

      {tab==='fixtures' && (
        <div style={{ marginTop:14 }}>
          <div className="eyebrow" style={{ margin:'0 2px 11px' }}>{w.round} · next round</div>
          {w.divFixtures.map(([h,a,ko], i) => (
            <div key={i} className="card" style={{ padding:'12px 14px', marginBottom:9, display:'flex', alignItems:'center', gap:10 }}>
              <div className="tnum" style={{ width:42, flex:'none', fontSize:12.5, fontWeight:700, color:'var(--ink3)' }}>{ko}</div>
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'flex-end', gap:8, minWidth:0 }}>
                <span style={{ fontSize:13.5, fontWeight: h===w.my?800:600, color: h===w.my?'var(--amber)':'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textAlign:'right' }}>{w.reg[h].name}</span>
                <WBadge world={w} id={h} size={28} r={8} />
              </div>
              <span style={{ fontSize:11, fontWeight:700, color:'var(--ink4)', flex:'none' }}>v</span>
              <div style={{ flex:1, display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                <WBadge world={w} id={a} size={28} r={8} />
                <span style={{ fontSize:13.5, fontWeight: a===w.my?800:600, color: a===w.my?'var(--amber)':'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{w.reg[a].name}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==='results' && (
        <div style={{ marginTop:14 }}>
          <div className="eyebrow" style={{ margin:'0 2px 11px' }}>Last round</div>
          {w.divResults.map(([h,a,hs,as_], i) => (
            <div key={i} className="card" style={{ padding:'12px 14px', marginBottom:9, display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'flex-end', gap:8, minWidth:0 }}>
                <span style={{ fontSize:13.5, fontWeight: hs>as_?700:500, color: hs>=as_?'var(--ink)':'var(--ink3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textAlign:'right' }}>{w.reg[h].name}</span>
                <WBadge world={w} id={h} size={28} r={8} />
              </div>
              <span className="tnum" style={{ fontSize:15, fontWeight:800, flex:'none', minWidth:42, textAlign:'center' }}>{hs}<span style={{ color:'var(--ink4)', margin:'0 3px' }}>–</span>{as_}</span>
              <div style={{ flex:1, display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                <WBadge world={w} id={a} size={28} r={8} />
                <span style={{ fontSize:13.5, fontWeight: as_>hs?700:500, color: as_>=hs?'var(--ink)':'var(--ink3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{w.reg[a].name}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ MEMBERSHIP */
function GuardianMembership({ app, role }) {
  const subj = subjectFor(role, app.childId);
  const cc = consumerCard(role, app.childId);
  const m = cc.membership;
  const fees = feesFor(role, app.childId);
  const outstanding = fees.filter(f => f.status==='due').reduce((a,f) => a + f.amt, 0);

  return (
    <div className="view">
      <div className="eyebrow" style={{ margin:'8px 2px 10px' }}>{subj.kind==='child' ? `${subj.poss} membership` : 'Your membership'}</div>
      <MembershipCard name={cc.name} team={cc.team} membership={cc.membership} memberId={cc.memberId} />

      {/* plan details */}
      <div className="prof-group" style={{ marginTop:14 }}>
        <KV k="Plan" v={m.plan} />
        <KV k="Started" v={m.since} />
        <KV k="Renews" v={m.renews} />
        <KV k="Status" v={<span className="pill pill-ok" style={{ height:20, fontSize:11 }}>{m.status}</span>} last />
      </div>

      {/* fees */}
      <div className="sec-head"><h2>Fees & payments</h2>{outstanding>0 && <span className="meta" style={{ color:'var(--amber)' }}>{gbp(outstanding)} outstanding</span>}</div>
      {outstanding>0 && (
        <button className="card" onClick={() => app.openSheet(<PayFeeSheet app={app} all fees={fees} />)}
          style={{ width:'100%', textAlign:'left', cursor:'pointer', padding:'14px 15px', marginBottom:10, display:'flex', alignItems:'center', gap:12,
            background:'var(--amber-soft)', borderColor:'var(--amber)' }}>
          <div style={{ width:38, height:38, borderRadius:11, flex:'none', background:'var(--amber)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="pound" size={19} color="#1A1403" /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:700 }}>Settle outstanding fees</div>
            <div style={{ fontSize:12, color:'var(--ink2)' }}>{fees.filter(f=>f.status==='due').length} items · {subj.kind==='child'?subj.poss:'your'} account</div>
          </div>
          <span className="tnum" style={{ fontSize:18, fontWeight:800, color:'var(--amber)', flex:'none' }}>{gbp(outstanding)}</span>
        </button>
      )}
      {fees.map(f => {
        const due = f.status==='due';
        const Tag = due ? 'button' : 'div';
        return (
          <Tag key={f.id} className="card" onClick={due ? () => app.openSheet(<PayFeeSheet app={app} fee={f} fees={fees} />) : undefined}
            style={{ width:'100%', textAlign:'left', font:'inherit', color:'inherit', cursor: due?'pointer':'default',
              padding:'12px 14px', marginBottom:9, display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:36, height:36, borderRadius:10, flex:'none', display:'flex', alignItems:'center', justifyContent:'center',
              background: due?'var(--amber-soft)':'var(--s4)' }}><Icon name={f.icon} size={17} color={due?'var(--amber)':'var(--ink2)'} /></div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{f.label}</div>
              <div style={{ fontSize:12, color:'var(--ink3)', marginTop:1 }}>{f.sub} · {f.when}</div>
            </div>
            <div style={{ textAlign:'right', flex:'none' }}>
              <div className="tnum" style={{ fontSize:15, fontWeight:800 }}>{gbp(f.amt)}</div>
              {due ? <span className="pill pill-warn" style={{ height:20, fontSize:10.5, marginTop:3 }}>Pay now</span>
                   : <span className="pill pill-ok" style={{ height:20, fontSize:10.5, marginTop:3 }}>Paid</span>}
            </div>
          </Tag>
        );
      })}

      {/* extra classes */}
      <div className="sec-head"><h2>Extra classes</h2><span className="meta">book for {subj.first}</span></div>
      {PROGRAMMES.map(pr => (
        <button key={pr.id} className="card" onClick={() => app.openSheet(<BookClassSheet app={app} prog={pr} role={role} />)}
          style={{ width:'100%', textAlign:'left', cursor:'pointer', padding:'12px 14px', marginBottom:9, display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:38, height:38, borderRadius:11, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name={pr.icon} size={19} color="var(--ink2)" /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{pr.name}</div>
            <div style={{ fontSize:12, color:'var(--ink3)', marginTop:1 }}>{pr.sub}</div>
            <div style={{ fontSize:11, color:'var(--ok)', fontWeight:700, marginTop:3 }}>{pr.spots}</div>
          </div>
          <div style={{ textAlign:'right', flex:'none' }}>
            <div className="tnum" style={{ fontSize:15, fontWeight:800, color:'var(--amber)' }}>{gbp(pr.price)}</div>
            <span className="pill pill-mut" style={{ height:20, fontSize:10.5, marginTop:3 }}>Book</span>
          </div>
        </button>
      ))}
    </div>
  );
}
function KV({ k, v, last }) {
  return (
    <div className="prof-line" data-last={last} style={{ cursor:'default' }}>
      <span style={{ flex:1, fontSize:14, color:'var(--ink3)', fontWeight:600 }}>{k}</span>
      <span style={{ fontSize:14, fontWeight:700 }}>{v}</span>
    </div>
  );
}

/* pay-fee sheet */
function PayFeeSheet({ app, fee, all, fees }) {
  const dueItems = (fees || MEMBER_FEES).filter(f => f.status==='due');
  const items = all ? dueItems : [fee];
  const total = items.reduce((a,f) => a + f.amt, 0);
  return (
    <Sheet onClose={app.closeSheet} title={all ? 'Settle fees' : 'Pay fee'}
      footer={<button className="btn btn-amber btn-md btn-block" onClick={() => { app.closeSheet(); app.toast({ icon:'check', tone:'ok', text:`${gbp(total)} paid`, sub: all ? `${items.length} fees settled · via Stripe` : `${fee.label} · via Stripe` }); }}>Pay {gbp(total)} · Card</button>}>
      <div className="card" style={{ padding:'6px 15px', background:'var(--s2)', marginTop:4 }}>
        {items.map((f,i) => (
          <div key={f.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom: i<items.length-1?'1px solid var(--hair)':'none' }}>
            <div style={{ width:34, height:34, borderRadius:10, flex:'none', background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name={f.icon} size={16} color="var(--amber)" /></div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14.5, fontWeight:700 }}>{f.label}</div>
              <div style={{ fontSize:12, color:'var(--ink3)' }}>{f.sub}</div>
            </div>
            <span className="tnum" style={{ fontSize:15, fontWeight:800, flex:'none' }}>{gbp(f.amt)}</span>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', margin:'16px 4px 6px' }}>
        <span style={{ fontSize:15, fontWeight:700 }}>Total</span>
        <span className="tnum" style={{ fontSize:22, fontWeight:800, color:'var(--amber)' }}>{gbp(total)}</span>
      </div>
      <div className="prof-row" style={{ cursor:'default', marginTop:8 }}>
        <div className="prof-row-ic" style={{ background:'var(--s4)' }}><Icon name="globe" size={18} color="var(--ink2)" /></div>
        <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
          <div style={{ fontSize:14.5, fontWeight:700 }}>Secure card checkout</div>
          <div style={{ fontSize:12, color:'var(--ink3)' }}>Powered by Stripe · card details never stored</div>
        </div>
      </div>
    </Sheet>
  );
}

/* book-class sheet */
function BookClassSheet({ app, prog, role }) {
  const subj = subjectFor(role, app.childId);
  return (
    <Sheet onClose={app.closeSheet} title="Book class"
      footer={<button className="btn btn-amber btn-md btn-block" onClick={() => { app.closeSheet(); app.toast({ icon:'check', tone:'ok', text:`${prog.name} booked`, sub:`${subj.first} · ${gbp(prog.price)}` }); }}>Book · {gbp(prog.price)}</button>}>
      <div className="card" style={{ padding:'16px 16px', background:'var(--s2)', marginTop:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:13 }}>
          <div style={{ width:46, height:46, borderRadius:14, flex:'none', background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name={prog.icon} size={22} color="var(--amber)" /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:700, letterSpacing:'-0.01em' }}>{prog.name}</div>
            <div style={{ fontSize:13, color:'var(--ink3)', marginTop:2 }}>{prog.sub}</div>
          </div>
        </div>
      </div>
      <div className="card" style={{ padding:'4px 15px', marginTop:11, background:'var(--s2)' }}>
        <InfoRow icon="users" k="For" v={`${subj.name} · ${subj.age}`} />
        <InfoRow icon="pound" k="Price" v={gbp(prog.price)} />
        <InfoRow icon="check" k="Availability" v={prog.spots} last />
      </div>
      <div style={{ fontSize:12.5, color:'var(--ink4)', textAlign:'center', marginTop:14, lineHeight:1.5, padding:'0 12px' }}>
        Paid by card via Stripe secure checkout. Cancel free up to 48h before the first session.
      </div>
    </Sheet>
  );
}

Object.assign(window, {
  JR, JUNIOR_WORLD, JUNIOR_WORLD_2, SENIOR_WORLD, WORLDS, worldFor, subjectFor, activeChild,
  feesFor, consumerCard, MEMBER_FEES, PROGRAMMES,
  WBadge, ResultBadge, resultOf, GuardianMatches, GuardianLeague, GuardianMembership,
  KV, PayFeeSheet, BookClassSheet,
});
