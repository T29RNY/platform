/* m-views.jsx — Bookings, Payments, People hub. */

/* ============================================================ BOOKINGS */
const DAY_DATA = {
  p1: [ { from:19.5, to:20.33, type:'fixture', home:'t1', away:'t2', ref:'r1', status:'live', what:'League fixture · GPL R12' },
        { from:20.5, to:21.33, type:'fixture', home:'t7', away:'t8', ref:null, status:'soon', what:'League fixture · GPL R12' } ],
  p2: [ { from:19.5, to:20.33, type:'fixture', home:'t3', away:'t4', ref:'r3', status:'live', what:'League fixture · GPL R12' },
        { from:20.5, to:21.5, type:'confirmed', who:'Tuesday Casuals', what:'Weekly block · 5-a-side', ch:'whatsapp' } ],
  p3: [ { from:16, to:17, type:'confirmed', who:'Greenway U14s', what:'Academy training', ch:'whatsapp' },
        { from:19.5, to:20.33, type:'fixture', home:'t5', away:'t6', ref:'r4', status:'live', what:'League fixture · GPL R12' },
        { from:20.5, to:21.5, type:'requested', who:'Carter & Co', what:'Corporate · one-off', ch:'email' } ],
  p4: [ { from:18, to:19, type:'confirmed', who:'Hannah Williams', what:'One-off booking', ch:'phone' },
        { from:20, to:21.5, type:'maintenance', who:'Maintenance', what:'Floodlight repair' } ],
};
const GROUNDS = [['greenway','Greenway Park'],['riverside','Riverside 4G'],['the_dome','The Dome']];
const PITCH_LIST = [['p1','P1','North'],['p2','P2','Centre'],['p3','P3','South'],['p4','P4','Indoor']];
const FILTER_DEFS = [
  ['fixture','Fixtures','var(--amber)'], ['confirmed','Confirmed','var(--ok)'],
  ['requested','Requests','#FFD37A'], ['maintenance','Maintenance','var(--ink3)'], ['free','Free slots','var(--ok)'],
];
const DAYS = [['Mon','8 Jun'],['Tue','9 Jun'],['Wed','10 Jun'],['Thu','11 Jun'],['Fri','12 Jun'],['Sat','13 Jun'],['Sun','14 Jun']];
const D0 = 16, D1 = 23, PXH = 80;
const fmtHm = h => `${String(Math.floor(h)).padStart(2,'0')}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2,'0')}`;
function freeGaps(events) {
  const s = [...events].sort((a,b) => a.from - b.from); const out = []; let c = D0;
  for (const e of s) { if (e.from - c > 0.34) out.push({ from:c, to:e.from }); c = Math.max(c, e.to); }
  if (D1 - c > 0.34) out.push({ from:c, to:D1 });
  return out;
}
const evtTone = {
  fixture:    { stripe:'var(--amber)', bg:'var(--s2)' },
  confirmed:  { stripe:'var(--ok)', bg:'var(--s2)' },
  requested:  { stripe:'#FFD37A', bg:'var(--s2)' },
  maintenance:{ stripe:'var(--ink3)', bg:'repeating-linear-gradient(45deg,#1C2230,#1C2230 7px,#181D27 7px,#181D27 14px)' },
};

function combineEvents(pids, active) {
  const evs = [];
  pids.forEach(pid => DAY_DATA[pid].forEach(e => { if (active.has(e.type)) evs.push({ ...e, pid }); }));
  evs.sort((a,b) => a.from - b.from || a.to - b.to);
  let cluster = [], clusterEnd = 0;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds = [];
    cluster.forEach(ev => { let c = 0; while (c < colEnds.length && colEnds[c] > ev.from + 0.001) c++; ev._col = c; colEnds[c] = ev.to; });
    const n = colEnds.length; cluster.forEach(ev => ev._cols = n); cluster = [];
  };
  evs.forEach(ev => {
    if (cluster.length && ev.from >= clusterEnd - 0.001) flush();
    cluster.push(ev); clusterEnd = cluster.length === 1 ? ev.to : Math.max(clusterEnd, ev.to);
  });
  flush();
  return evs;
}
function freeGapsMulti(pids) {
  const evs = pids.flatMap(pid => DAY_DATA[pid]).sort((a,b) => a.from - b.from);
  const out = []; let c = D0;
  for (const e of evs) { if (e.from - c > 0.34) out.push({ from:c, to:e.from }); c = Math.max(c, e.to); }
  if (D1 - c > 0.34) out.push({ from:c, to:D1 });
  return out;
}

function FilterSheet({ app, title, options, initial, onChange }) {
  const [sel, setSel] = useState(() => new Set(initial));
  const toggle = (id) => { const n = new Set(sel); if (n.has(id)) { if (n.size > 1) n.delete(id); } else n.add(id); setSel(n); onChange(n); };
  const all = () => { const n = new Set(options.map(o => o.id)); setSel(n); onChange(n); };
  const allOn = sel.size === options.length;
  return (
    <Sheet onClose={app.closeSheet} title={title}
      right={<button onClick={all} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font)', fontSize:13.5, fontWeight:700, color: allOn ? 'var(--ink4)' : 'var(--amber)', padding:'4px 6px' }}>All</button>}>
      <div className="card" style={{ padding:0, overflow:'hidden', background:'var(--s2)', marginTop:4 }}>
        {options.map((o,i) => {
          const on = sel.has(o.id);
          return (
            <button key={o.id} onClick={() => toggle(o.id)}
              style={{ display:'flex', alignItems:'center', gap:13, width:'100%', padding:'14px 15px', cursor:'pointer',
                background: on ? 'rgba(255,255,255,0.03)' : 'transparent', border:'none',
                borderTop: i>0 ? '1px solid var(--hair)' : 'none', textAlign:'left' }}>
              {o.dotStyle && <span style={{ width:12, height:12, borderRadius: o.square?3:'50%', flex:'none', ...o.dotStyle }} />}
              <span style={{ flex:1, minWidth:0, fontSize:15, fontWeight:600, color:'var(--ink)' }}>{o.label}{o.zone && <span style={{ color:'var(--ink3)', fontWeight:500 }}> · {o.zone}</span>}</span>
              {o.count != null && <span style={{ fontSize:12.5, fontWeight:700, color:'var(--ok)', whiteSpace:'nowrap' }}>{o.count} free</span>}
              <span style={{ width:23, height:23, borderRadius:7, flex:'none', display:'flex', alignItems:'center', justifyContent:'center',
                background: on ? 'var(--amber-soft)' : 'transparent', boxShadow: on ? 'inset 0 0 0 1.5px var(--amber)' : 'inset 0 0 0 1.5px var(--hair2)' }}>
                {on && <Icon name="check" size={14} color="var(--amber)" />}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function Bookings({ app, state, dispatch }) {
  const [ground, setGround] = useState('greenway');
  const [day, setDay] = useState(0);
  const [pitches, setPitches] = useState(() => new Set(['p1']));
  const [active, setActive] = useState(() => new Set(['fixture','confirmed','requested','maintenance','free']));
  const hidden = FILTER_DEFS.length - active.size;
  const selectedPids = PITCH_LIST.map(p => p[0]).filter(id => pitches.has(id));
  const allPitches = pitches.size === PITCH_LIST.length;
  const totalFree = selectedPids.reduce((a,id) => a + freeGaps(DAY_DATA[id]).length, 0);
  const allFree = PITCH_LIST.reduce((a,[id]) => a + freeGaps(DAY_DATA[id]).length, 0);
  const pitchLabel = allPitches ? 'All pitches' : pitches.size === 1 ? PITCHES[selectedPids[0]] : `${pitches.size} pitches`;
  const groundName = GROUNDS.find(g => g[0] === ground)[1];
  const showNow = day === 0; const nowH = 20.1;

  const openVenue = () => app.openSheet(
    <Sheet onClose={app.closeSheet} title="Switch ground">
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {GROUNDS.map(([id,name]) => (
          <button key={id} className="card" onClick={() => { setGround(id); app.closeSheet(); }}
            style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 15px', cursor:'pointer', textAlign:'left', background:'var(--s2)' }}>
            <div style={{ width:36, height:36, borderRadius:11, background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="pin" size={18} color="var(--amber)" /></div>
            <span style={{ flex:1, fontSize:15, fontWeight:700 }}>{name}</span>
            {ground===id && <Icon name="check" size={18} color="var(--amber)" />}
          </button>
        ))}
      </div>
    </Sheet>
  );

  const openPitches = () => app.openSheet(
    <FilterSheet key="f-pitches" app={app} title="Pitches"
      options={PITCH_LIST.map(([id,p,zone]) => ({ id, label: PITCHES[id].split(' · ')[0], zone, count: freeGaps(DAY_DATA[id]).length }))}
      initial={[...pitches]} onChange={setPitches} />
  );
  const openFilters = () => app.openSheet(
    <FilterSheet key="f-types" app={app} title="Show on calendar"
      options={FILTER_DEFS.map(([id,label,col]) => ({ id, label, square: id==='free',
        dotStyle: (id==='requested'||id==='free') ? { background:'transparent', boxShadow:`inset 0 0 0 1.5px ${col}` } : { background: col } }))}
      initial={[...active]} onChange={setActive} />
  );

  const evtTitle = e => e.type==='fixture' ? `${TEAMS[e.home].name} v ${TEAMS[e.away].name}` : e.who;
  const evtStatus = e => {
    if (e.type==='fixture') return e.status==='live'
      ? <span className="pill pill-live" style={{ height:21, fontSize:10.5 }}><span className="live-dot" style={{ width:5, height:5 }} />LIVE</span>
      : <span className="pill pill-mut" style={{ height:21, fontSize:10.5 }}>KO {fmtHm(e.from)}</span>;
    if (e.type==='confirmed') return <span className="pill pill-ok" style={{ height:21, fontSize:10.5 }}>Confirmed</span>;
    if (e.type==='requested') return <span className="pill pill-warn" style={{ height:21, fontSize:10.5 }}>Requested</span>;
    return <span className="pill pill-mut" style={{ height:21, fontSize:10.5 }}>Closed</span>;
  };

  return (
    <div className="view">
      {/* toolbar — venue · date · filter (one row) */}
      <div className="toolbar">
        <div className="tb-date" style={{ gap:0, background:'var(--s2)', border:'1px solid var(--hair)', borderRadius:12, height:38, padding:'0 4px' }}>
          <button className="tb-step" onClick={() => setDay(d => Math.max(0, d-1))} aria-label="Previous day"><Icon name="chevron" size={16} style={{ transform:'rotate(180deg)' }} /></button>
          <span style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:7, minWidth:0 }}>
            <Icon name="calendar" size={14} color="var(--ink3)" style={{ flex:'none' }} />
            <span className="dlabel tnum">{DAYS[day][0]} {DAYS[day][1]}</span>
            {day===0 && <span className="pill pill-ok" style={{ height:18, fontSize:10, padding:'0 6px', flex:'none' }}>Today</span>}
          </span>
          <button className="tb-step" onClick={() => setDay(d => Math.min(DAYS.length-1, d+1))} aria-label="Next day"><Icon name="chevron" size={16} /></button>
        </div>
        <button className={'tb-filter' + (hidden>0 ? ' on' : '')} onClick={openFilters} aria-label="Filter bookings">
          <Icon name="list" size={16} />{hidden>0 && <span className="fcount">{hidden}</span>}
        </button>
        <button className="tb-filter" style={{ background:'var(--amber)', borderColor:'var(--amber)' }}
          onClick={() => app.openSheet(<NewBookingSheet app={app} day={day} />)} aria-label="New booking">
          <Icon name="plus" size={19} color="#1A1403" />
        </button>
      </div>

      {/* pitch selector — opens a filter sheet */}
      <div style={{ padding:'10px 0 0' }}>
        <button className="tb-venue" style={{ maxWidth:'none', width:'100%', justifyContent:'space-between' }} onClick={openPitches}>
          <span style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
            <Icon name="grid" size={15} color="var(--amber)" />
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pitchLabel}</span>
          </span>
          <span style={{ display:'flex', alignItems:'center', gap:9, flex:'none' }}>
            <span style={{ fontSize:11.5, color:'var(--ok)', fontWeight:700, whiteSpace:'nowrap' }}>{totalFree} free</span>
            <Icon name="chevdown" size={14} color="var(--ink3)" />
          </span>
        </button>
      </div>
      {/* vertical day view(s) — one per selected pitch */}
      {/* ONE combined calendar — all selected pitches overlaid; overlaps squashed into columns */}
      {(() => {
        const evs = combineEvents(selectedPids, active);
        const gaps = freeGapsMulti(selectedPids);
        return (
      <div className="card" style={{ padding:'15px 14px 14px', marginTop:14, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10, marginBottom:14, paddingLeft:2 }}>
          <div style={{ fontSize:15, fontWeight:700, whiteSpace:'nowrap' }}>Day view <span style={{ color:'var(--ink3)', fontWeight:500 }}>· {evs.length} on {selectedPids.length} {selectedPids.length===1?'pitch':'pitches'}</span></div>
          <div style={{ fontSize:12, color:'var(--ok)', fontWeight:700, flex:'none', whiteSpace:'nowrap' }}>{gaps.length} all-free</div>
        </div>
        <div style={{ maxHeight:380, overflowY:'auto', overflowX:'hidden', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>
        <div className="cal" style={{ height:(D1-D0)*PXH }}>
          {Array.from({ length:D1-D0+1 }, (_,i) => D0+i).map(h => (
            <React.Fragment key={h}>
              <div className="cal-hourline" style={{ top:(h-D0)*PXH }} />
              <div className="cal-hourlab" style={{ top:(h-D0)*PXH }}>{h}:00</div>
            </React.Fragment>
          ))}
          {showNow && nowH>D0 && nowH<D1 && <div className="cal-now" style={{ top:(nowH-D0)*PXH }} />}
          {active.has('free') && gaps.map((g,i) => {
            const h = (g.to-g.from)*PXH;
            return (
              <button key={'f'+i} className="cal-free" style={{ top:(g.from-D0)*PXH+3, height:h-6 }}
                onClick={() => app.openSheet(<NewBookingSheet app={app} day={day} presetPid={selectedPids.length===1?selectedPids[0]:null} presetStart={g.from} />)}>
                <span style={{ fontSize:12.5, fontWeight:700, color:'var(--ink2)' }}>{h>42 ? 'All free' : ''}</span>
                <span style={{ display:'flex', alignItems:'center', gap:7, fontSize:11.5, fontWeight:600, color:'var(--ink4)' }} className="tnum">
                  {fmtHm(g.from)}–{fmtHm(g.to)}
                  <span style={{ width:22, height:22, borderRadius:7, background:'var(--ok-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="plus" size={14} color="var(--ok)" /></span>
                </span>
              </button>
            );
          })}
          <div style={{ position:'absolute', left:52, right:2, top:0, bottom:0 }}>
            {evs.map((e,i) => {
              const top = (e.from-D0)*PXH+3, height = Math.max(40, (e.to-e.from)*PXH-6);
              const tone = evtTone[e.type]; const w = 100/e._cols; const tight = e._cols > 1;
              return (
                <button key={i} className="cal-evt" style={{ top, height, left:`${e._col*w}%`, width:`calc(${w}% - 4px)`, right:'auto', background:tone.bg, border:'1px solid var(--hair2)', padding:'6px 8px 6px 11px', textAlign:'left', cursor:'pointer' }}
                  onClick={() => app.openSheet(<BookingDetailSheet app={app} evt={e} dispatch={dispatch} />)}>
                  <span className="estripe" style={{ background:tone.stripe }} />
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:4 }}>
                    <span style={{ fontSize:10, fontWeight:800, color:'var(--ink2)', letterSpacing:'.03em' }}>P{e.pid.slice(1)}</span>
                    {e.type==='fixture' && e.status==='live' ? <span className="live-dot" style={{ width:5, height:5 }} /> : <span style={{ width:7, height:7, borderRadius:'50%', background:tone.stripe }} />}
                  </div>
                  <div style={{ fontSize:11.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginTop:2 }}>{tight ? evtTitle(e).split(' v ')[0] : evtTitle(e)}</div>
                  {height>52 && <div className="tnum" style={{ fontSize:10, color:'var(--ink3)', fontWeight:600, marginTop:2 }}>{fmtHm(e.from)}–{fmtHm(e.to)}</div>}
                </button>
              );
            })}
          </div>
        </div>
        </div>
        <div style={{ fontSize:11.5, color:'var(--ink4)', marginTop:12, display:'flex', alignItems:'center', gap:7, paddingLeft:2 }}>
          <span style={{ width:18, height:18, borderRadius:6, border:'1.4px dashed var(--hair2)', display:'inline-flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="plus" size={11} color="var(--ok)" /></span>
          Overlapping bookings sit side by side · tap a slot to book
        </div>
      </div>
        );
      })()}

      <Section title="Requests" meta={`${state.bookings.length} pending · swipe`}>
      {state.bookings.map(b => (
        <SwipeRow key={b.id}
          onApprove={() => { dispatch({ type:'booking', id:b.id }); app.toast({ icon:'check', tone:'ok', text:`${b.who} confirmed`, sub:`${PITCHES[b.pitch].split(' · ')[0]} · ${b.when}` }); }}
          onDecline={() => { dispatch({ type:'booking', id:b.id }); app.toast({ icon:'x', tone:'live', text:`${b.who} declined` }); }}>
          <div className="card" style={{ padding:'13px 15px', background:'var(--s2)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:11 }}>
              <div style={{ width:38, height:38, borderRadius:11, background:'var(--info-soft)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}>
                <Icon name={channelIcon[b.ch]} size={18} color="var(--info-ink)" />
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:15, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {b.who}{b.org && <span style={{ color:'var(--ink3)', fontWeight:500 }}> · {b.org}</span>}
                </div>
                <div style={{ fontSize:12, color:'var(--ink3)', fontWeight:500 }}>{b.kind} · {PITCHES[b.pitch].split(' · ')[0]} · {b.when}</div>
              </div>
              <span className="pill pill-warn" style={{ height:21, fontSize:11 }}>{b.kind.startsWith('Weekly') ? b.kind.split('· ')[1] : '1×'}</span>
            </div>
            {b.note && <div style={{ fontSize:12.5, color:'var(--ink2)', marginTop:9, padding:'8px 11px', background:'var(--s1)', borderRadius:10, lineHeight:1.35 }}>“{b.note}”</div>}
          </div>
        </SwipeRow>
      ))}
      {state.bookings.length === 0 && <EmptyCard icon="calendar" text="No pending requests" />}
      </Section>

      <button className="btn btn-amber btn-md btn-block" style={{ marginTop:16 }}
        onClick={() => app.openSheet(<NewBookingSheet app={app} day={day} />)}>
        <Icon name="plus" size={18} />New booking
      </button>
    </div>
  );
}

/* ============================================================ PAYMENTS */
function Payments({ app, state, role }) {
  const [filter, setFilter] = useState('all');
  const canReverse = ROLES[role].caps.includes('reverse_money');
  const rate = useCountUp(PAY.rate * 100, 900, [filter]);
  const filters = [['all','All'],['unpaid','Unpaid'],['part','Part'],['paid','Paid']];
  const rows = CHARGES.filter(c => filter === 'all' ? true : c.status === filter);
  return (
    <div className="view">
      {/* stat tiles 2x2 */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:6 }}>
        <BigStat label="Owed" value={gbp(PAY.owed*100)} tone="ink" />
        <BigStat label="Collected" value={gbp(PAY.collected*100)} tone="ok" />
        <BigStat label="Outstanding" value={gbp(PAY.outstanding*100)} tone="amber" />
        <div className="card" style={{ padding:'13px 14px' }}>
          <span className="eyebrow" style={{ fontSize:10.5 }}>Collection</span>
          <div className="tnum" style={{ fontSize:24, fontWeight:800, letterSpacing:'-0.03em', marginTop:5 }}>{Math.round(rate)}%</div>
          <div style={{ height:5, borderRadius:3, background:'var(--s3)', marginTop:8, overflow:'hidden' }}>
            <div style={{ height:'100%', width:rate+'%', background:'var(--ok)', borderRadius:3, transition:'width .2s' }} />
          </div>
        </div>
      </div>

      {/* pay link */}
      <div className="card" style={{ display:'flex', alignItems:'center', gap:11, padding:'12px 14px', marginTop:12 }}>
        <div style={{ width:34, height:34, borderRadius:10, background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}>
          <Icon name="globe" size={18} color="var(--amber)" /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, color:'var(--ink3)', fontWeight:600 }}>ONLINE PAY LINK</div>
          <div style={{ fontSize:14, fontWeight:600 }}>pay.ioo.fc/greenway</div>
        </div>
        <button className="icon-btn" style={{ width:34, height:34 }} onClick={() => app.toast({ icon:'check', text:'Link copied' })}><Icon name="qr" size={17} /></button>
      </div>

      {/* filters */}
      <div style={{ display:'flex', gap:8, overflowX:'auto', padding:'16px 0 4px', scrollbarWidth:'none' }}>
        {filters.map(([id,label]) => (
          <button key={id} onClick={() => setFilter(id)} className="pill" style={{ height:30, padding:'0 13px', cursor:'pointer', flex:'none',
            background: filter===id ? 'var(--amber-soft)' : 'var(--s2)', color: filter===id ? 'var(--amber)' : 'var(--ink2)',
            border:'1px solid', borderColor: filter===id ? 'var(--amber)' : 'var(--hair)' }}>{label}</button>
        ))}
      </div>

      {!canReverse && (
        <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--ink3)', margin:'8px 2px 2px' }}>
          <Icon name="key" size={14} />Read-only — refunds need the reverse-money capability
        </div>
      )}

      <div style={{ marginTop:10 }}>
        {rows.map((c, i) => {
          const actionable = c.status === 'unpaid' || c.status === 'part';
          const Tag = actionable ? 'button' : 'div';
          return (
            <Tag key={i} className="card" onClick={actionable ? () => app.openSheet(<RecordPaymentSheet app={app} charge={c} />) : undefined}
              style={{ width:'100%', textAlign:'left', font:'inherit', color:'inherit', cursor: actionable ? 'pointer' : 'default',
                padding:'12px 14px', display:'flex', alignItems:'center', gap:12, marginBottom:9 }}>
              <Crest id={c.team} size={34} r={9} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{TEAMS[c.team] ? TEAMS[c.team].name : c.team}</div>
                <div className="tnum" style={{ fontSize:12, color:'var(--ink3)' }}>{c.src} · {gbp(c.due, true)}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <StatusPill status={c.status} />
                {c.status !== 'paid' && (
                  <div className="tnum" style={{ fontSize:12, color:'var(--ink2)', marginTop:3, fontWeight:600 }}>{gbp(c.due - c.paid, true)} due</div>
                )}
              </div>
              {actionable && <Icon name="chevron" size={15} color="var(--ink4)" style={{ flex:'none', marginLeft:2 }} />}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
function StatusPill({ status }) {
  const map = { paid:['pill-ok','Paid'], unpaid:['pill-warn','Unpaid'], part:['pill-info','Part-paid'], voided:['pill-mut','Void'] };
  const [cls,label] = map[status] || map.unpaid;
  return <span className={'pill '+cls} style={{ height:22, fontSize:11 }}>{label}</span>;
}
function BigStat({ label, value, tone }) {
  const color = { ink:'var(--ink)', ok:'var(--ok-ink)', amber:'var(--amber)' }[tone];
  return (
    <div className="card" style={{ padding:'13px 14px' }}>
      <span className="eyebrow" style={{ fontSize:10.5 }}>{label}</span>
      <div className="tnum" style={{ fontSize:24, fontWeight:800, letterSpacing:'-0.03em', marginTop:5, color }}>{value}</div>
    </div>
  );
}

/* ============================================================ PEOPLE hub */
function People({ app, role }) {
  const [tab, setTab] = useState('members');
  const [q, setQ] = useState('');
  const [staffTypes, setStaffTypes] = useState(() => new Set(['manager','reception','official','groundstaff','coach']));
  const STAFF_TYPES = [['manager','Managers'],['reception','Reception'],['official','Officials'],['groundstaff','Groundstaff'],['coach','Coaches']];
  const members = [
    { name:'Tariq Ahmed', team:'Northside Athletic', num:9, goals:14, tone:'t1' },
    { name:'Reza Pourmand', team:'Eastpark United', num:9, goals:12, tone:'t2' },
    { name:'Dion Fraser', team:'Brockley Rovers', num:10, goals:11, tone:'t3' },
    { name:'Felipe Cordeiro', team:'Wandle Phoenix', num:7, goals:11, tone:'t7' },
    { name:'Marc Vandenberg', team:'Quaybridge Inter.', num:10, goals:13, tone:'t11' },
    { name:'Edward Reilly', team:"Saint Olave's", num:9, goals:9, tone:'t10' },
  ];
  const teams = Object.entries(TEAMS).slice(0,8).map(([id,t]) => ({ id, name:t.name, sub:`${(parseInt(id.slice(1))%3)+1} competitions` }));
  const staff = [
    { name:'Aimée Belanger', sub:'Manager · email', ic:'cog', role:'manager' },
    { name:'Rohan Vyas', sub:'Reception · phone', ic:'phone', role:'reception' },
    { name:'Lena Hartmann', sub:'Reception · weekends', ic:'whatsapp', role:'reception' },
    { name:'Maya Petersen', sub:'Referee · in-house', ic:'whistle', rating:'5.0', role:'official' },
    { name:'Priya Shah', sub:'Referee · freelance', ic:'whistle', rating:'5.0', role:'official' },
    { name:'Carlos Mendez', sub:'Groundstaff · pitches', ic:'flag', role:'groundstaff' },
  ];
  const canSeeContacts = ROLES[role].caps.includes('staff_directory');
  const staffHidden = STAFF_TYPES.length - staffTypes.size;
  const openStaffFilter = () => app.openSheet(
    <FilterSheet key="f-staff" app={app} title="Staff type"
      options={STAFF_TYPES.map(([id,label]) => ({ id, label }))}
      initial={[...staffTypes]} onChange={setStaffTypes} />
  );

  return (
    <div className="view">
      {/* segmented */}
      <div style={{ display:'flex', gap:4, padding:5, background:'var(--s2)', borderRadius:14, marginTop:6, border:'1px solid var(--hair)' }}>
        {[['members','Members'],['teams','Teams'],['staff','Staff']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, height:36, borderRadius:10, border:'none', cursor:'pointer',
            fontFamily:'var(--font)', fontWeight:700, fontSize:13.5, transition:'color .2s',
            background: tab===id ? 'var(--s4)' : 'transparent', color: tab===id ? 'var(--ink)' : 'var(--ink3)' }}>{label}</button>
        ))}
      </div>

      {/* search */}
      <div className="card" style={{ display:'flex', alignItems:'center', gap:9, padding:'0 14px', height:44, marginTop:12, background:'var(--s2)' }}>
        <Icon name="search" size={18} color="var(--ink3)" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${tab}…`}
          style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--ink)', fontFamily:'var(--font)', fontSize:15 }} />
      </div>

      {tab==='staff' && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12 }}>
          <span style={{ fontSize:12.5, color:'var(--ink3)', fontWeight:600 }}>{staffTypes.size===STAFF_TYPES.length ? 'All staff' : `${staffTypes.size} types`}</span>
          <button className={'tb-filter' + (staffHidden>0 ? ' on' : '')} onClick={openStaffFilter} style={{ height:34 }}>
            <Icon name="list" size={15} />{staffHidden>0 ? <span className="fcount">{staffHidden}</span> : 'Type'}
          </button>
        </div>
      )}

      <div style={{ marginTop:14 }}>
        {tab==='members' && members.filter(m => m.name.toLowerCase().includes(q.toLowerCase())).map((m,i) => (
          <PersonRow key={i} accent={TEAMS[m.tone].p} left={<Crest id={m.tone} size={46} r={14} />} name={m.name} sub={`${m.team} · #${m.num}`} app={app}
            trailing={<div style={{ textAlign:'right', flex:'none' }}><div className="tnum" style={{ fontSize:18, fontWeight:800, color:'var(--amber)', lineHeight:1 }}>{m.goals}</div><div style={{ fontSize:9.5, color:'var(--ink4)', fontWeight:700, letterSpacing:'.06em', marginTop:3 }}>GOALS</div></div>} />
        ))}
        {tab==='teams' && teams.filter(t => t.name.toLowerCase().includes(q.toLowerCase())).map((t,i) => (
          <PersonRow key={i} accent={TEAMS[t.id].p} left={<Crest id={t.id} size={46} r={14} />} name={t.name} sub={t.sub} app={app} />
        ))}
        {tab==='staff' && staff.filter(s => s.name.toLowerCase().includes(q.toLowerCase()) && staffTypes.has(s.role)).map((s,i) => (
          <PersonRow key={i}
            left={<div style={{ width:46, height:46, borderRadius:14, background:'var(--s3)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name={s.ic} size={21} color="var(--ink2)" /></div>}
            name={s.name} sub={canSeeContacts ? s.sub : s.sub.split(' · ')[0]} app={app}
            locked={!canSeeContacts && s.sub.includes('·')}
            trailing={s.rating ? <span className="pill pill-warn" style={{ height:25, flex:'none', fontSize:12 }}><Icon name="star" size={12} />{s.rating}</span> : <Icon name="chevron" size={16} color="var(--ink4)" />} />
        ))}
      </div>
    </div>
  );
}
function PersonRow({ left, name, sub, app, locked, trailing, accent }) {
  return (
    <button className="card" onClick={() => app.toast({ text:name, sub:'Profile' })}
      style={{ width:'100%', textAlign:'left', cursor:'pointer', padding:'12px 14px 12px 16px', display:'flex', alignItems:'center', gap:13, marginBottom:10, position:'relative', overflow:'hidden' }}>
      {accent && <span style={{ position:'absolute', left:0, top:9, bottom:9, width:3, borderRadius:'0 3px 3px 0', background:accent }} />}
      {left}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:15, fontWeight:700, color:'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</div>
        <div style={{ fontSize:12.5, color:'var(--ink3)', fontWeight:500, marginTop:2, display:'flex', alignItems:'center', gap:5 }}>
          {locked && <Icon name="key" size={11} />}{sub}
        </div>
      </div>
      {trailing || <Icon name="chevron" size={16} color="var(--ink4)" />}
    </button>
  );
}

function EmptyCard({ icon, text }) {
  return (
    <div className="card" style={{ padding:'26px 18px', textAlign:'center', color:'var(--ink3)' }}>
      <Icon name={icon} size={24} color="var(--ink4)" />
      <div style={{ fontSize:14, fontWeight:600, marginTop:8, color:'var(--ink2)' }}>{text}</div>
    </div>
  );
}

Object.assign(window, { Bookings, Payments, People, StatusPill, BigStat, PersonRow, EmptyCard,
  DAYS, DAY_DATA, PITCH_LIST, GROUNDS, FILTER_DEFS, freeGaps, fmtHm, D0, D1, PXH, evtTone });
