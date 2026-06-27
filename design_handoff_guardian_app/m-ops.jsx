/* m-ops.jsx — Operations (the hero) + shared primitives (Sheet, StatTile, SwipeRow). */

/* ---------- shared: bottom Sheet wrapper ---------- */
function Sheet({ children, tall, onClose, title, right, footer }) {
  return (
    <React.Fragment>
      <div className="sheet-scrim" onClick={onClose} />
      <div className={'sheet' + (tall ? ' tall' : '')} role="dialog" aria-modal="true">
        <div className="sheet-grab" />
        {title !== undefined && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'8px 18px 6px' }}>
            <div style={{ fontSize:19, fontWeight:700, letterSpacing:'-0.02em' }}>{title}</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {right}
              <button className="icon-btn" style={{ width:34, height:34 }} onClick={onClose} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </React.Fragment>
  );
}

/* ---------- collapsible section ---------- */
function Section({ title, meta, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <React.Fragment>
      <button className="sec-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span style={{ display:'flex', alignItems:'center', gap:9, minWidth:0 }}>
          <span className="chev" style={{ transform: open ? 'none' : 'rotate(-90deg)', display:'flex' }}>
            <Icon name="chevdown" size={17} color="var(--ink3)" />
          </span>
          <h2>{title}</h2>
        </span>
        {meta && <span className="meta">{meta}</span>}
      </button>
      {open && children}
    </React.Fragment>
  );
}

/* ---------- stat tile ---------- */
function StatTile({ tone, label, value, sub, onClick, live, icon }) {
  const toneColor = { live:'var(--live)', amber:'var(--amber)', ok:'var(--ok)', ink:'var(--ink)' }[tone] || 'var(--ink)';
  return (
    <button className="card" onClick={onClick} style={{
      flex:'none', width:122, textAlign:'left', padding:'13px 13px', cursor:'pointer',
      display:'flex', flexDirection:'column', gap:7,
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
          {live && <span className="live-dot" />}
          <span className="eyebrow" style={{ fontSize:10.5 }}>{label}</span>
        </span>
        {icon && <span style={{ width:27, height:27, borderRadius:9, flex:'none', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--s3)' }}><Icon name={icon} size={15} color={toneColor} /></span>}
      </div>
      <div className="tnum" style={{ fontSize:28, fontWeight:800, letterSpacing:'-0.03em', color:toneColor, lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:11.5, color:'var(--ink3)', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{sub}</div>
    </button>
  );
}

/* ---------- live match card ---------- */
function ScoreNum({ value }) {
  return <span className="tnum" key={value} style={{ display:'inline-block', animation:'scorePop .4s cubic-bezier(.2,1.4,.4,1)' }}>{value}</span>;
}

function LiveMatchCard({ fx, now, onOpen, justScored }) {
  const min = liveMinute(fx.koAt, now);
  const blink = Math.floor(now / 1000) % 2 === 0;
  // period feel: cap at 50, "HT" window omitted for simplicity of continuous clock
  const pct = Math.min(100, (min / 50) * 100);
  const home = TEAMS[fx.home], away = TEAMS[fx.away];
  return (
    <button onClick={onOpen} className="card" style={{
      width:'100%', textAlign:'left', cursor:'pointer', padding:0, overflow:'hidden',
      marginBottom:11, position:'relative',
      boxShadow: justScored ? '0 0 0 1.5px var(--amber), 0 10px 30px -10px var(--amber-glow)' : 'var(--shadow-card)',
      transition:'box-shadow .5s ease',
    }}>
      {/* top: round + live */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px 8px' }}>
        <span className="eyebrow" style={{ fontSize:10.5 }}>{fx.round} · {PITCHES[fx.pitch].split(' · ')[0]}</span>
        <span className="pill pill-live"><span className="live-dot" style={{ width:6, height:6 }} />LIVE</span>
      </div>
      {/* teams + score */}
      <div style={{ display:'flex', alignItems:'center', padding:'2px 14px 12px', gap:12 }}>
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:9, minWidth:0 }}>
          <Row crest={fx.home} name={home.name} bold={fx.hs > fx.as} />
          <Row crest={fx.away} name={away.name} bold={fx.as > fx.hs} />
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, paddingLeft:8 }}>
          <div className="tnum" style={{ fontSize:34, fontWeight:800, letterSpacing:'-0.04em', lineHeight:1,
            color: justScored ? 'var(--amber)' : 'var(--ink)', transition:'color .5s' }}>
            <ScoreNum value={fx.hs} /><span style={{ color:'var(--ink4)', margin:'0 4px', fontWeight:600 }}>:</span><ScoreNum value={fx.as} />
          </div>
          <div className="tnum" style={{ fontSize:12.5, fontWeight:700, color:'var(--live)' }}>
            {min}<span style={{ opacity: blink ? 1 : 0.25, transition:'opacity .15s' }}>′</span>
          </div>
        </div>
      </div>
      {/* progress */}
      <div style={{ height:3, background:'var(--s3)', position:'relative' }}>
        <div style={{ position:'absolute', inset:0, width:pct + '%', background:'linear-gradient(90deg, var(--live), #FF8478)',
          boxShadow:'0 0 12px var(--live)' }} />
      </div>
      {/* footer */}
      <div style={{ display:'flex', alignItems:'center', gap:14, padding:'9px 14px', color:'var(--ink3)', fontSize:12, fontWeight:600 }}>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}><Icon name="whistle" size={14} />{REFS[fx.ref].name.split(' ')[0]}</span>
        <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:5, color:'var(--ink3)' }}>Match <Icon name="chevron" size={13} /></span>
      </div>
    </button>
  );
}
function Row({ crest, name, bold }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:9, minWidth:0 }}>
      <Crest id={crest} size={26} r={7} />
      <span style={{ fontSize:15, fontWeight: bold ? 700 : 600, color: bold ? 'var(--ink)' : 'var(--ink2)',
        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</span>
    </div>
  );
}

/* ---------- swipe-to-approve row ---------- */
function SwipeRow({ children, onApprove, onDecline, height }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(null); // 'approve' | 'decline'
  const start = useRef(null);
  const TH = 84;

  const onDown = (e) => { start.current = (e.touches ? e.touches[0].clientX : e.clientX); };
  const onMove = (e) => {
    if (start.current == null) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    setDx(x - start.current);
  };
  const onUp = () => {
    if (start.current == null) return;
    if (dx > TH) finish('approve');
    else if (dx < -TH) finish('decline');
    else setDx(0);
    start.current = null;
  };
  const finish = (dir) => {
    setGone(dir);
    setDx(dir === 'approve' ? 420 : -420);
    setTimeout(() => { dir === 'approve' ? onApprove() : onDecline(); }, 240);
  };

  const prog = Math.min(1, Math.abs(dx) / TH);
  const side = dx > 0 ? 'approve' : 'decline';
  return (
    <div style={{ position:'relative', borderRadius:'var(--r-lg)', overflow:'hidden', marginBottom:10,
      height: gone ? 0 : 'auto', transition: gone ? 'height .24s ease .12s, margin .24s ease .12s' : 'none',
      marginBottom: gone ? 0 : 10 }}>
      {/* action backdrop */}
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
        justifyContent: side === 'approve' ? 'flex-start' : 'flex-end', padding:'0 22px',
        background: side === 'approve' ? 'var(--ok-soft)' : 'var(--live-soft)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, color: side==='approve'?'var(--ok-ink)':'var(--live-ink)',
          fontWeight:700, fontSize:14, transform:`scale(${0.8 + prog*0.3})`, opacity: prog }}>
          <Icon name={side==='approve'?'check':'x'} size={20} />
          {side==='approve' ? 'Approve' : 'Decline'}
        </div>
      </div>
      <div
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        style={{ position:'relative', transform:`translateX(${dx}px)`, transition: start.current==null?'transform .32s cubic-bezier(.2,.9,.3,1.2)':'none',
          touchAction:'pan-y', cursor:'grab' }}>
        {children}
      </div>
    </div>
  );
}

/* ---------- Operations screen ---------- */
function Ops({ app, state, dispatch }) {
  const now = useNow(1000);
  const liveRef = useRef(null), needRef = useRef(null), upRef = useRef(null);
  const fixtures = state.fixtures;
  const live = fixtures.filter(f => f.status === 'in_progress');
  const later = fixtures.filter(f => f.status !== 'in_progress');
  const toAssign = later.filter(f => !f.pitch || !f.ref).length;

  const jump = (ref) => {
    const el = ref.current; if (!el) return;
    const sc = el.closest('.scroll'); if (!sc) return;
    const target = Math.max(0, sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 70);
    const start = sc.scrollTop, dist = target - start, dur = 420, t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      sc.scrollTop = start + dist * ease(p);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  return (
    <div className="view">
      <TournamentBanner app={app} />
      {/* stat strip */}
      <div style={{ display:'flex', gap:10, overflowX:'auto', padding:'4px 0 2px', margin:'0 -2px', scrollbarWidth:'none' }}>
        <StatTile tone="live" live icon="pulse" label="Live now" value={live.length} sub="right now" onClick={() => jump(liveRef)} />
        <StatTile tone="amber" icon="flag" label="To assign" value={toAssign} sub="pitch / ref" onClick={() => jump(upRef)} />
        <StatTile tone="ink" icon="alert" label="Issues" value={state.incidents.length + state.regs.length} sub={`${state.regs.length} regs · ${state.incidents.length} alerts`} onClick={() => jump(needRef)} />
        <StatTile tone="amber" icon="pound" label="Outstanding" value={gbp(PAY.outstanding*100)} sub="this cycle" onClick={() => app.go('payments')} />
      </div>

      {/* LIVE */}
      <div ref={liveRef}>
        <Section title="Live now" meta={`${live.length} of ${TONIGHT.length} · KO 19:30`}>
        {live.map(fx => (
          <LiveMatchCard key={fx.id} fx={fx} now={now}
            justScored={state.justScored === fx.id}
            onOpen={() => app.openSheet(<LiveMatchSheet app={app} match={liveMatchFromFx(fx)} />)} />
        ))}
        </Section>
      </div>

      {/* NEEDS YOU */}
      <div ref={needRef}>
        <Section title="Needs you" meta={`${state.regs.length + state.incidents.length} items`}>

        {state.regs.length > 0 && <div className="eyebrow" style={{ margin:'2px 2px 9px' }}>New registrations · swipe</div>}
        {state.regs.map(r => (
          <SwipeRow key={r.id}
            onApprove={() => { dispatch({ type:'reg', id:r.id }); app.toast({ icon:'check', tone:'ok', text:`${r.team} approved`, sub:'Added to '+r.league }); }}
            onDecline={() => { dispatch({ type:'reg', id:r.id }); app.toast({ icon:'x', tone:'live', text:`${r.team} declined`, sub:'Captain notified' }); }}>
            <div className="card" style={{ padding:'13px 15px', display:'flex', alignItems:'center', gap:12, background:'var(--s2)' }}>
              <div style={{ width:38, height:38, borderRadius:11, background:'var(--amber-soft)', display:'flex',
                alignItems:'center', justifyContent:'center', flex:'none' }}>
                <Icon name="shield" size={20} color="var(--amber)" />
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:15, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.team}</div>
                <div style={{ fontSize:12, color:'var(--ink3)', fontWeight:500 }}>{r.league} · {r.captain} · {r.when}</div>
              </div>
              <div style={{ display:'flex', gap:7 }} onMouseDown={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()}>
                <button className="icon-btn" style={{ width:34, height:34, background:'var(--live-soft)', borderColor:'transparent' }}
                  onClick={() => { dispatch({ type:'reg', id:r.id }); app.toast({ icon:'x', tone:'live', text:`${r.team} declined`, sub:'Captain notified' }); }}>
                  <Icon name="x" size={16} color="var(--live-ink)" /></button>
                <button className="icon-btn" style={{ width:34, height:34, background:'var(--ok-soft)', borderColor:'transparent' }}
                  onClick={() => { dispatch({ type:'reg', id:r.id }); app.toast({ icon:'check', tone:'ok', text:`${r.team} approved`, sub:'Added to '+r.league }); }}>
                  <Icon name="check" size={16} color="var(--ok-ink)" /></button>
              </div>
            </div>
          </SwipeRow>
        ))}

        {state.incidents.length > 0 && <div className="eyebrow" style={{ margin:'14px 2px 9px' }}>Open issues</div>}
        {state.incidents.map(inc => (
          <div key={inc.id} className="card" style={{ padding:'13px 15px', display:'flex', alignItems:'flex-start', gap:12, marginBottom:10 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', marginTop:5, flex:'none',
              background: inc.sev==='critical' ? 'var(--live)' : 'var(--amber)',
              boxShadow: inc.sev==='critical' ? '0 0 10px var(--live)' : 'none' }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:600, lineHeight:1.3 }}>{inc.text}</div>
              <div style={{ fontSize:12, color:'var(--ink3)', marginTop:2 }}>{inc.sub}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => app.openSheet(<ResolveIncidentSheet app={app} inc={inc} dispatch={dispatch} />)}>Resolve</button>
          </div>
        ))}

        {state.regs.length + state.incidents.length === 0 && (
          <div className="card" style={{ padding:'26px 18px', textAlign:'center', color:'var(--ink3)' }}>
            <Icon name="check" size={26} color="var(--ok)" />
            <div style={{ fontSize:14, fontWeight:600, marginTop:8, color:'var(--ink2)' }}>All clear — nothing needs you</div>
          </div>
        )}
        </Section>
      </div>

      {/* COMING UP */}
      <div ref={upRef}>
        <Section title="Coming up" meta="tonight">
        {later.map(fx => (
          <UpcomingRow key={fx.id} fx={fx} state={state} app={app} dispatch={dispatch} />
        ))}
        </Section>
      </div>
    </div>
  );
}

/* upcoming fixture row with inline assign chips */
function UpcomingRow({ fx, state, app, dispatch }) {
  const pitch = fx.pitch, ref = fx.ref;
  const openAssign = (kind) => app.openSheet({ type:'assign', kind, fxId: fx.id });
  return (
    <div className="card" style={{ padding:'12px 14px', display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
      <div className="tnum" style={{ fontSize:13, fontWeight:700, color:'var(--ink2)', width:42, flex:'none' }}>{fx.ko}</div>
      <div style={{ display:'flex', alignItems:'center', flex:'none' }}>
        <Crest id={fx.home} size={26} r={7} />
        <Crest id={fx.away} size={26} r={7} style={{ marginLeft:-7 }} />
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13.5, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {TEAMS[fx.home].name.split(' ')[0]} <span style={{ color:'var(--ink4)' }}>v</span> {TEAMS[fx.away].name.split(' ')[0]}
        </div>
        <div style={{ display:'flex', gap:6, marginTop:5 }}>
          {pitch
            ? <span className="pill pill-mut" style={{ height:21, fontSize:11 }}>{PITCHES[pitch].split(' · ')[0]}</span>
            : <button className="pill pill-warn" style={{ height:21, fontSize:11, border:'none', cursor:'pointer' }} onClick={() => openAssign('pitch')}>Pitch?</button>}
          {ref
            ? <span className="pill pill-mut" style={{ height:21, fontSize:11 }}>{REFS[ref].name.split(' ')[0]}</span>
            : <button className="pill pill-warn" style={{ height:21, fontSize:11, border:'none', cursor:'pointer' }} onClick={() => openAssign('ref')}>Ref?</button>}
        </div>
      </div>
    </div>
  );
}

/* resolve-incident sheet — capture the outcome before clearing the issue */
const RESOLUTIONS = [
  { id:'fixed',      label:'Fixed',             desc:'Issue resolved on site',    icon:'check' },
  { id:'safe',       label:'Made safe',          desc:'Isolated / closed for now', icon:'shield' },
  { id:'contractor', label:'Contractor booked',  desc:'External fix scheduled',    icon:'cog' },
  { id:'nofault',    label:'No fault found',     desc:'Checked — nothing wrong',   icon:'info' },
];
function ResolveIncidentSheet({ app, inc, dispatch }) {
  const [res, setRes] = useState(null);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(inc.sev === 'critical');
  const crit = inc.sev === 'critical';
  const ready = !!res;
  const resolve = () => {
    dispatch({ type:'incident', id: inc.id });
    app.closeSheet();
    app.toast({ icon:'check', tone:'ok', text:'Issue resolved',
      sub: RESOLUTIONS.find(r => r.id === res).label + (notify ? ' · teams notified' : '') });
  };
  return (
    <Sheet onClose={app.closeSheet} title="Resolve issue"
      footer={<button className="btn btn-amber btn-md btn-block" disabled={!ready} onClick={resolve}>
        {ready ? <React.Fragment><Icon name="check" size={17} />Mark resolved</React.Fragment> : <span style={{ color:'#1A1403', opacity:.8 }}>Choose an outcome</span>}</button>}>

      <div className="card" style={{ padding:'14px 15px', background:'var(--s2)', marginTop:4, display:'flex', alignItems:'flex-start', gap:12 }}>
        <div style={{ width:8, height:8, borderRadius:'50%', marginTop:6, flex:'none', background: crit?'var(--live)':'var(--amber)', boxShadow: crit?'0 0 10px var(--live)':'none' }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14.5, fontWeight:700, lineHeight:1.3 }}>{inc.text}</div>
          <div style={{ fontSize:12, color:'var(--ink3)', marginTop:2 }}>{inc.sub}</div>
        </div>
        <span className={'pill ' + (crit?'pill-live':'pill-warn')} style={{ height:21, fontSize:10.5, flex:'none' }}>{crit?'Critical':'Warning'}</span>
      </div>

      <FieldLabel>Outcome</FieldLabel>
      <div className="opt-grid">
        {RESOLUTIONS.map(o => (
          <button key={o.id} className={'opt' + (res===o.id ? ' sel' : '')} onClick={() => setRes(o.id)}>
            <span style={{ width:38, height:38, borderRadius:11, flex:'none', background: res===o.id?'var(--amber)':'var(--s3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Icon name={o.icon} size={19} color={res===o.id ? '#1A1403' : 'var(--ink2)'} /></span>
            <span style={{ flex:1 }}>
              <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)', display:'block' }}>{o.label}</span>
              <span style={{ fontSize:12.5, color:'var(--ink3)', display:'block', marginTop:1 }}>{o.desc}</span>
            </span>
            {res===o.id && <Icon name="check" size={18} color="var(--amber)" />}
          </button>
        ))}
      </div>

      <FieldLabel>Resolution note <span style={{ color:'var(--ink4)', fontWeight:500 }}>· optional</span></FieldLabel>
      <textarea className="flow-input" value={note} onChange={e => setNote(e.target.value)}
        placeholder="What was done, by whom, any follow-up…"
        style={{ height:'auto', minHeight:90, padding:'12px 14px', resize:'none', lineHeight:1.45, display:'block' }} />

      <button onClick={() => setNotify(v => !v)}
        style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'13px 14px', marginTop:14,
          borderRadius:15, border:'1px solid var(--hair)', background:'var(--s2)', cursor:'pointer', fontFamily:'var(--font)', textAlign:'left', color:'inherit' }}>
        <div style={{ width:36, height:36, borderRadius:10, flex:'none', background: notify?'var(--amber-soft)':'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon name="bell" size={18} color={notify?'var(--amber)':'var(--ink2)'} /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14.5, fontWeight:700 }}>Notify affected teams</div>
          <div style={{ fontSize:12, color:'var(--ink3)' }}>Broadcast the update to anyone impacted</div>
        </div>
        <span className="ios-toggle" data-on={notify}><span className="ios-knob" /></span>
      </button>
    </Sheet>
  );
}

/* assign sheet (pitch or ref picker) */
function AssignSheet({ kind, fx, app, dispatch }) {
  const isRef = kind === 'ref';
  const opts = isRef ? Object.entries(REFS).map(([id,v]) => ({ id, ...v }))
                     : Object.entries(PITCHES).map(([id,name]) => ({ id, name, avail: id!=='p4' && id!=='p5' }));
  const matchup = `${TEAMS[fx.home].name.split(' ')[0]} v ${TEAMS[fx.away].name.split(' ')[0]}`;
  return (
    <Sheet onClose={app.closeSheet} title={isRef ? 'Assign referee' : 'Assign pitch'}>
      <div style={{ fontSize:13, color:'var(--ink3)', margin:'0 2px 14px', fontWeight:500 }}>{matchup} · KO {fx.ko}</div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {opts.map(o => (
          <button key={o.id} className="card" style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 15px',
            cursor:'pointer', textAlign:'left', opacity: o.avail===false ? 0.45 : 1, background:'var(--s2)' }}
            disabled={o.avail===false}
            onClick={() => { dispatch({ type:'assign', id:fx.id, kind, value:o.id });
              app.closeSheet(); app.toast({ icon:'check', tone:'ok', text:`${isRef ? o.name : o.name} assigned`, sub: matchup }); }}>
            <div style={{ width:38, height:38, borderRadius:11, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Icon name={isRef ? 'whistle' : 'flag'} size={19} color="var(--ink2)" />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15, fontWeight:700 }}>{o.name}</div>
              <div style={{ fontSize:12, color:'var(--ink3)', display:'flex', alignItems:'center', gap:4, marginTop:1 }}>
                {isRef
                  ? <React.Fragment><Icon name="star" size={12} color="var(--amber)" />{o.rating}.0 · available</React.Fragment>
                  : (o.avail===false ? 'Unavailable · maintenance' : '3G · free 20:30')}
              </div>
            </div>
            {o.avail!==false && <Icon name="chevron" size={16} color="var(--ink4)" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

Object.assign(window, { Sheet, Section, StatTile, LiveMatchCard, SwipeRow, Ops, AssignSheet, ResolveIncidentSheet });
