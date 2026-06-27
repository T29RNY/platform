/* m-livematch.jsx — live match centre. Shared detail sheet opened from the
   operator's LiveMatchCard ("Match ›") and the guardian's live card ("Live ›").
   Read-only match feed: score + ticking clock, timeline of events, lineups, info. */

/* deterministic event feed from the scoreline */
const GOAL_NAMES = ['Onyango','Clarke','Doyle','Rossi','Osei','Pereira','Mensah','Ahmed','Reyes','Walsh','Fenton','Okafor'];
function genEvents(homeId, awayId, hs, as, maxMin) {
  const total = hs + as, evs = [];
  const top = Math.max(6, Math.min(45, maxMin || 45));
  let h = 0, a = 0;
  for (let i = 0; i < total; i++) {
    const min = Math.max(2, Math.round(2 + (i + 1) * ((top - 3) / (total + 1))));
    let side;
    if (h < hs && a < as) side = (i % 2 === 0) ? 'home' : 'away';
    else side = h < hs ? 'home' : 'away';
    if (side === 'home') h++; else a++;
    const who = GOAL_NAMES[(min + (side === 'home' ? homeId.length * 3 : awayId.length * 5)) % GOAL_NAMES.length];
    evs.push({ min, type:'goal', side, who });
  }
  if (total > 0 && top > 8) evs.push({ min: Math.round(top * 0.55), type:'yellow', side:'away', who: GOAL_NAMES[4] });
  evs.sort((x, y) => x.min - y.min);
  return evs;
}

function liveMatchFromFx(fx) {
  return {
    reg: TEAMS, homeId: fx.home, awayId: fx.away, hs: fx.hs, as: fx.as, koAt: fx.koAt,
    comp: fx.round, venue: fx.pitch ? PITCHES[fx.pitch] : 'Venue TBC',
    refName: fx.ref ? REFS[fx.ref].name : 'Unassigned',
    events: genEvents(fx.home, fx.away, fx.hs, fx.as, liveMinute(fx.koAt, NOW.getTime())), operator: true,
  };
}
function liveMatchFromWorld(w) {
  const L = w.live;
  return {
    reg: w.reg, homeId: L.home, awayId: L.away, hs: L.hs, as: L.as,
    koAt: new Date(NOW.getTime() - L.koMin * 60000),
    comp: L.comp, venue: L.venue, refName: L.ref,
    events: genEvents(L.home, L.away, L.hs, L.as, L.koMin), operator: false,
  };
}

function MBadge({ reg, id, size = 30, r = 8, fs }) {
  const t = reg[id] || { name:'??', p:'#444', s:'#222' };
  return <div className="crest" style={{ width:size, height:size, borderRadius:r,
    background:`linear-gradient(135deg, ${t.p} 0 48%, ${t.s} 52% 100%)`, fontSize: fs || size*0.36 }}>{initials(t.name)}</div>;
}

function LiveMatchSheet({ app, match }) {
  const m = match;
  const now = useNow(1000);
  const min = liveMinute(m.koAt, now);
  const blink = Math.floor(now / 1000) % 2 === 0;
  const pct = Math.min(100, (min / 50) * 100);
  const home = m.reg[m.homeId], away = m.reg[m.awayId];
  const [following, setFollowing] = useState(true);

  const evIcon = { goal:'pulse', yellow:'flag', red:'flag' };
  const evColor = { goal:'var(--amber)', yellow:'#FFD37A', red:'var(--live-ink)' };
  const evLabel = (e) => e.type==='goal' ? `Goal · ${e.who}` : e.type==='yellow' ? `Yellow card · ${e.who}` : `Red card · ${e.who}`;

  return (
    <Sheet onClose={app.closeSheet} tall title="Live match">
      {/* scoreboard hero */}
      <div className="card" style={{ padding:0, overflow:'hidden', marginTop:4, boxShadow:'0 0 0 1.5px var(--live), 0 12px 34px -14px var(--live-soft)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 15px 6px' }}>
          <span className="eyebrow" style={{ fontSize:10.5 }}>{m.comp}</span>
          <span className="pill pill-live"><span className="live-dot" style={{ width:6, height:6 }} />LIVE</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', padding:'8px 12px 14px', gap:6 }}>
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:9, minWidth:0 }}>
            <MBadge reg={m.reg} id={m.homeId} size={50} r={14} />
            <span style={{ fontSize:13, fontWeight:700, textAlign:'center', lineHeight:1.2, color: m.hs>=m.as?'var(--ink)':'var(--ink2)' }}>{home.name}</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, flex:'none', padding:'0 4px' }}>
            <div className="tnum" style={{ fontSize:40, fontWeight:800, letterSpacing:'-0.04em', lineHeight:1 }}>
              {m.hs}<span style={{ color:'var(--ink4)', margin:'0 6px', fontWeight:600 }}>:</span>{m.as}
            </div>
            <span className="tnum pill" style={{ height:22, fontSize:12, background:'var(--live-soft)', color:'var(--live-ink)', fontWeight:700 }}>
              {min}<span style={{ opacity: blink?1:0.3 }}>′</span>
            </span>
          </div>
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:9, minWidth:0 }}>
            <MBadge reg={m.reg} id={m.awayId} size={50} r={14} />
            <span style={{ fontSize:13, fontWeight:700, textAlign:'center', lineHeight:1.2, color: m.as>=m.hs?'var(--ink)':'var(--ink2)' }}>{away.name}</span>
          </div>
        </div>
        <div style={{ height:3, background:'var(--s3)', position:'relative' }}>
          <div style={{ position:'absolute', inset:0, width:pct+'%', background:'linear-gradient(90deg, var(--live), #FF8478)', boxShadow:'0 0 12px var(--live)' }} />
        </div>
      </div>

      {/* follow toggle (consumer) / quick note (operator) */}
      {!m.operator ? (
        <button onClick={() => { setFollowing(v => !v); app.toast({ icon:'bell', tone: following?'amber':'ok', text: following?'Alerts off':'Following this match', sub: following?'No more goal alerts':'Goal & full-time alerts on' }); }}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'13px 14px', marginTop:12,
            borderRadius:15, border:'1px solid var(--hair)', background:'var(--s2)', cursor:'pointer', fontFamily:'var(--font)', textAlign:'left', color:'inherit' }}>
          <div style={{ width:36, height:36, borderRadius:10, flex:'none', background: following?'var(--amber-soft)':'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Icon name="bell" size={18} color={following?'var(--amber)':'var(--ink2)'} /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14.5, fontWeight:700 }}>Goal alerts</div>
            <div style={{ fontSize:12, color:'var(--ink3)' }}>Push when the score changes or at full time</div>
          </div>
          <span className="ios-toggle" data-on={following}><span className="ios-knob" /></span>
        </button>
      ) : (
        <div style={{ display:'flex', gap:9, marginTop:12 }}>
          <button className="btn btn-ghost btn-md" style={{ flex:1 }} onClick={() => app.toast({ icon:'tv', text:'Pushed to reception display' })}><Icon name="tv" size={16} />To display</button>
          <button className="btn btn-ghost btn-md" style={{ flex:1 }} onClick={() => app.toast({ icon:'whistle', text:`Referee · ${m.refName}` })}><Icon name="whistle" size={16} />Referee</button>
        </div>
      )}

      {/* timeline */}
      <div className="sec-head" style={{ marginTop:20 }}><h2>Timeline</h2><span className="meta">live</span></div>
      <div className="card" style={{ padding:'6px 15px', background:'var(--s2)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:'1px solid var(--hair)' }}>
          <span className="tnum" style={{ width:30, flex:'none', fontSize:12, fontWeight:800, color:'var(--live-ink)', textAlign:'center' }}>{min}′</span>
          <span style={{ width:26, height:26, borderRadius:8, flex:'none', background:'var(--live-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><span className="live-dot" style={{ width:6, height:6 }} /></span>
          <span style={{ flex:1, fontSize:13.5, fontWeight:700 }}>Match in progress</span>
        </div>
        {[...m.events].reverse().map((e, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom: i<m.events.length-1?'1px solid var(--hair)':'none' }}>
            <span className="tnum" style={{ width:30, flex:'none', fontSize:13, fontWeight:800, color:'var(--ink2)', textAlign:'center' }}>{e.min}′</span>
            <span style={{ width:26, height:26, borderRadius:8, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Icon name={evIcon[e.type]} size={15} color={evColor[e.type]} /></span>
            <MBadge reg={m.reg} id={e.side==='home'?m.homeId:m.awayId} size={22} r={6} fs={9} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{evLabel(e)}</div>
              <div style={{ fontSize:11.5, color:'var(--ink3)' }}>{(e.side==='home'?home:away).name}</div>
            </div>
            {e.type==='goal' && <span className="pill pill-mut" style={{ height:20, fontSize:10.5, flex:'none' }}>{e.side==='home'?'home':'away'}</span>}
          </div>
        ))}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0' }}>
          <span className="tnum" style={{ width:30, flex:'none', fontSize:12, fontWeight:700, color:'var(--ink4)', textAlign:'center' }}>KO</span>
          <span style={{ width:26, height:26, borderRadius:8, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="clock" size={14} color="var(--ink3)" /></span>
          <span style={{ flex:1, fontSize:13, color:'var(--ink3)', fontWeight:600 }}>Kick-off</span>
        </div>
      </div>

      {/* match info */}
      <div className="sec-head" style={{ marginTop:20 }}><h2>Details</h2></div>
      <div className="card" style={{ padding:'4px 15px', background:'var(--s2)' }}>
        <InfoRow icon="trophy" k="Competition" v={m.comp} />
        <InfoRow icon="pin" k="Venue" v={m.venue} />
        <InfoRow icon="whistle" k="Referee" v={m.refName} last />
      </div>
    </Sheet>
  );
}

Object.assign(window, { LiveMatchSheet, liveMatchFromFx, liveMatchFromWorld, MBadge, genEvents });
