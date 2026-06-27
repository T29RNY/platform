/* m-tournament.jsx — dedicated tournament screen. Only surfaces while a
   tournament is live (a banner on Operations / Matches links in). Groups →
   knockout, live ticking scores, group tables + results, filter by team/group,
   follow a team, public results page + referee-updated note. */

const TOURN = {
  name: 'Crystal Palace 7s', sub: 'U12 · Summer Cup', dates: 'Sat 5 – Sun 6 Jul',
  status: 'live', day: 1, days: 2, reg: JR, publicUrl: 'cp7s.ioo.fc/live',
  groups: { A: ['br','ho','pp','dd'], B: ['ff','cc','nx','ss'] },
  groupMatches: {
    A: [
      { h:'br', a:'dd', hs:3, as:0, status:'ft' },
      { h:'ho', a:'pp', hs:1, as:1, status:'ft' },
      { h:'br', a:'pp', hs:2, as:1, status:'live', koMin:14, pitch:'P1' },
      { h:'ho', a:'dd', hs:0, as:0, status:'live', koMin:14, pitch:'P2' },
      { h:'br', a:'ho', status:'soon', ko:'13:30', pitch:'P1' },
      { h:'pp', a:'dd', status:'soon', ko:'13:30', pitch:'P2' },
    ],
    B: [
      { h:'ff', a:'ss', hs:4, as:1, status:'ft' },
      { h:'cc', a:'nx', hs:2, as:2, status:'ft' },
      { h:'ff', a:'nx', status:'soon', ko:'14:00', pitch:'P3' },
      { h:'cc', a:'ss', status:'soon', ko:'14:00', pitch:'P4' },
      { h:'ff', a:'cc', status:'soon', ko:'15:00', pitch:'P3' },
      { h:'nx', a:'ss', status:'soon', ko:'15:00', pitch:'P4' },
    ],
  },
  knockout: {
    sf: [
      { id:'sf1', label:'Semi-final 1', h:'A1', a:'B2', when:'Sun 10:00' },
      { id:'sf2', label:'Semi-final 2', h:'B1', a:'A2', when:'Sun 10:30' },
    ],
    final: { label:'Final', h:'W·SF1', a:'W·SF2', when:'Sun 14:00' },
  },
};

function tournTable(teams, matches) {
  const row = {};
  teams.forEach(t => row[t] = { id:t, P:0, W:0, D:0, L:0, gf:0, ga:0, Pts:0 });
  matches.filter(m => m.status === 'ft').forEach(m => {
    const H = row[m.h], A = row[m.a];
    H.P++; A.P++; H.gf += m.hs; H.ga += m.as; A.gf += m.as; A.ga += m.hs;
    if (m.hs > m.as) { H.W++; A.L++; H.Pts += 3; }
    else if (m.hs < m.as) { A.W++; H.L++; A.Pts += 3; }
    else { H.D++; A.D++; H.Pts++; A.Pts++; }
  });
  return teams.map(t => ({ ...row[t], GD: row[t].gf - row[t].ga }))
    .sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.gf - a.gf);
}

/* live banner shown on Operations / Matches while a tournament runs */
function TournamentBanner({ app }) {
  if (TOURN.status !== 'live') return null;
  const liveCount = Object.values(TOURN.groupMatches).flat().filter(m => m.status === 'live').length;
  return (
    <button onClick={() => app.go('tournament')} className="card"
      style={{ width:'100%', textAlign:'left', cursor:'pointer', padding:'13px 15px', marginBottom:4, marginTop:2,
        display:'flex', alignItems:'center', gap:12, background:'linear-gradient(110deg, var(--amber-soft), var(--s2) 70%)', borderColor:'var(--amber)' }}>
      <div style={{ width:40, height:40, borderRadius:12, flex:'none', background:'var(--amber)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="cup" size={21} color="#1A1403" /></div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <span className="pill pill-live" style={{ height:18, fontSize:9.5 }}><span className="live-dot" style={{ width:5, height:5 }} />LIVE</span>
          <span style={{ fontSize:14.5, fontWeight:800, letterSpacing:'-0.01em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{TOURN.name}</span>
        </div>
        <div style={{ fontSize:12, color:'var(--ink3)', marginTop:2 }}>Day {TOURN.day} of {TOURN.days} · {liveCount} live now · tap for the tournament</div>
      </div>
      <Icon name="chevron" size={17} color="var(--ink3)" />
    </button>
  );
}

function TMatchRow({ m, reg, now, app, followed }) {
  const live = m.status === 'live', ft = m.status === 'ft';
  const min = live ? liveMinute(new Date(NOW.getTime() - m.koMin * 60000), now) : 0;
  const blink = Math.floor(now / 1000) % 2 === 0;
  const mine = followed && (followed.has(m.h) || followed.has(m.a));
  const Tag = live ? 'button' : 'div';
  const open = () => app && app.openSheet(<LiveMatchSheet app={app} match={{
    reg, homeId:m.h, awayId:m.a, hs:m.hs, as:m.as,
    koAt: new Date(NOW.getTime() - (m.koMin||0) * 60000),
    comp: `${TOURN.name}${m.group ? ` · Group ${m.group}` : ''}`, venue: m.pitch || 'Tournament',
    refName: 'Tournament official', events: genEvents(m.h, m.a, m.hs, m.as, m.koMin), operator: false,
  }} />);
  return (
    <Tag className="card" onClick={live ? open : undefined} style={{ width:'100%', textAlign:'left', font:'inherit', color:'inherit', cursor: live ? 'pointer' : 'default', padding:'10px 13px', marginBottom:8, display:'flex', alignItems:'center', gap:10,
      background: mine ? 'var(--amber-soft)' : 'var(--s2)', borderColor: mine ? 'var(--amber)' : 'var(--hair2)' }}>
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'flex-end', gap:8, minWidth:0 }}>
        <span style={{ fontSize:13, fontWeight: ft&&m.hs>m.as?800:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textAlign:'right',
          color: followed&&followed.has(m.h)?'var(--amber)':'var(--ink)' }}>{reg[m.h].name}</span>
        <MBadge reg={reg} id={m.h} size={24} r={7} />
      </div>
      <div style={{ flex:'none', minWidth:52, textAlign:'center' }}>
        {ft || live
          ? <div className="tnum" style={{ fontSize:16, fontWeight:800, color: live?'var(--ink)':'var(--ink2)' }}>{m.hs}<span style={{ color:'var(--ink4)', margin:'0 3px' }}>:</span>{m.as}</div>
          : <span className="tnum" style={{ fontSize:12.5, fontWeight:700, color:'var(--ink3)' }}>{m.ko}</span>}
        {live
          ? <div className="tnum" style={{ fontSize:10.5, fontWeight:700, color:'var(--live)' }}>{min}<span style={{ opacity:blink?1:.3 }}>′</span></div>
          : <div style={{ fontSize:9.5, fontWeight:700, color: ft?'var(--ink4)':'var(--ink4)', letterSpacing:'.04em' }}>{ft?'FT':(m.pitch||'')}</div>}
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
        <MBadge reg={reg} id={m.a} size={24} r={7} />
        <span style={{ fontSize:13, fontWeight: ft&&m.as>m.hs?800:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          color: followed&&followed.has(m.a)?'var(--amber)':'var(--ink)' }}>{reg[m.a].name}</span>
      </div>
    </Tag>
  );
}

function Tournament({ app, role }) {
  const reg = TOURN.reg;
  const now = useNow(1000);
  const allTeams = [...TOURN.groups.A, ...TOURN.groups.B];
  const [group, setGroup] = useState('A');
  const [teamFilter, setTeamFilter] = useState(null);
  const [followed, setFollowed] = useState(() => new Set(role === 'guardian' ? ['br'] : role === 'member' ? ['br'] : []));

  const toggleFollow = (id) => {
    setFollowed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id);
      app.toast({ icon: n.has(id)?'star':'check', tone:'ok', text: n.has(id)?`Following ${reg[id].name}`:`Unfollowed ${reg[id].name}`, sub: n.has(id)?'Live score & result alerts on':'Alerts off' }); return n; });
  };

  const allMatches = [];
  Object.entries(TOURN.groupMatches).forEach(([g, ms]) => ms.forEach(m => allMatches.push({ ...m, group:g })));
  const matchPasses = (m) => !teamFilter || m.h === teamFilter || m.a === teamFilter;
  const liveMatches = allMatches.filter(m => m.status === 'live' && matchPasses(m));
  const followMatches = allMatches.filter(m => (followed.has(m.h) || followed.has(m.a)));

  const groupMs = TOURN.groupMatches[group].filter(matchPasses);
  const table = tournTable(TOURN.groups[group], TOURN.groupMatches[group]);

  return (
    <div className="view">
      {/* hero */}
      <div className="card" style={{ padding:'15px 16px', marginTop:6, overflow:'hidden', position:'relative',
        background:'linear-gradient(135deg, var(--s2), var(--s1))' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:46, height:46, borderRadius:14, flex:'none', background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="cup" size={24} color="var(--amber)" /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:18, fontWeight:800, letterSpacing:'-0.02em' }}>{TOURN.name}</div>
            <div style={{ fontSize:12.5, color:'var(--ink3)', marginTop:2 }}>{TOURN.sub} · {TOURN.dates}</div>
          </div>
          <span className="pill pill-live" style={{ flex:'none' }}><span className="live-dot" style={{ width:6, height:6 }} />LIVE</span>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:13 }}>
          <span className="pill pill-warn" style={{ height:24 }}>Day {TOURN.day} of {TOURN.days}</span>
          <span className="pill pill-mut" style={{ height:24 }}>Group stage</span>
          <span className="pill pill-mut" style={{ height:24 }}>{allTeams.length} teams</span>
        </div>
      </div>

      {/* following */}
      {followMatches.length > 0 && <React.Fragment>
        <div className="sec-head"><h2>Following</h2><span className="meta">{[...followed].length} team{[...followed].length===1?'':'s'}</span></div>
        {followMatches.map((m, i) => <TMatchRow key={i} m={m} reg={reg} now={now} app={app} followed={followed} />)}
      </React.Fragment>}

      {/* live now */}
      {liveMatches.length > 0 && <React.Fragment>
        <div className="sec-head"><h2>Live now</h2><span className="meta">{liveMatches.length} on pitch</span></div>
        {liveMatches.map((m, i) => <TMatchRow key={i} m={m} reg={reg} now={now} app={app} followed={followed} />)}
      </React.Fragment>}

      {/* team filter */}
      <div className="sec-head"><h2>Filter</h2>{teamFilter && <button onClick={() => setTeamFilter(null)} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font)', fontSize:12.5, fontWeight:700, color:'var(--amber)' }}>Clear</button>}</div>
      <div style={{ display:'flex', gap:8, overflowX:'auto', scrollbarWidth:'none', paddingBottom:2 }}>
        {allTeams.map(id => (
          <button key={id} onClick={() => setTeamFilter(f => f===id?null:id)} className="pill" style={{ height:34, padding:'0 12px 0 6px', gap:7, flex:'none', cursor:'pointer', border:'1px solid',
            background: teamFilter===id?'var(--amber-soft)':'var(--s2)', borderColor: teamFilter===id?'var(--amber)':'var(--hair)', color: teamFilter===id?'var(--amber)':'var(--ink2)' }}>
            <MBadge reg={reg} id={id} size={22} r={6} fs={9} />{reg[id].name.split(' ')[0]}
          </button>
        ))}
      </div>

      {/* group stage */}
      <div className="sec-head"><h2>Group stage</h2></div>
      <div style={{ display:'flex', gap:4, padding:5, background:'var(--s2)', borderRadius:13, border:'1px solid var(--hair)' }}>
        {['A','B'].map(g => (
          <button key={g} onClick={() => setGroup(g)} style={{ flex:1, height:34, borderRadius:9, border:'none', cursor:'pointer', fontFamily:'var(--font)', fontWeight:700, fontSize:13,
            background: group===g?'var(--s4)':'transparent', color: group===g?'var(--ink)':'var(--ink3)' }}>Group {g}</button>
        ))}
      </div>

      {/* group table */}
      <div className="card" style={{ overflow:'hidden', marginTop:12 }}>
        <div className="tnum" style={{ display:'grid', gridTemplateColumns:'22px 1fr 22px 22px 28px 26px 22px', padding:'8px 12px', fontSize:10.5, fontWeight:700, color:'var(--ink3)', borderBottom:'1px solid var(--hair)' }}>
          <span>#</span><span>Team</span><span style={{ textAlign:'center' }}>P</span><span style={{ textAlign:'center' }}>W</span><span style={{ textAlign:'center' }}>GD</span><span style={{ textAlign:'center', color:'var(--ink2)' }}>Pts</span><span></span>
        </div>
        {table.map((r, i) => {
          const qual = i < 2, mine = followed.has(r.id);
          return (
            <div key={r.id} className="tnum" style={{ display:'grid', gridTemplateColumns:'22px 1fr 22px 22px 28px 26px 22px', alignItems:'center', padding:'9px 12px', fontSize:12.5,
              borderBottom: i<table.length-1?'1px solid var(--hair)':'none', background: mine?'var(--amber-soft)':'transparent' }}>
              <span style={{ fontWeight:700, color: qual?'var(--ok-ink)':'var(--ink4)' }}>{i+1}</span>
              <span style={{ display:'flex', alignItems:'center', gap:7, minWidth:0 }}>
                <MBadge reg={reg} id={r.id} size={20} r={5} fs={8} />
                <span style={{ fontSize:12.5, fontWeight: mine?800:600, color: mine?'var(--amber)':'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{reg[r.id].name.split(' ')[0]}</span>
              </span>
              <span style={{ textAlign:'center', color:'var(--ink3)' }}>{r.P}</span>
              <span style={{ textAlign:'center', color:'var(--ink2)' }}>{r.W}</span>
              <span style={{ textAlign:'center', color: r.GD>0?'var(--ok-ink)':r.GD<0?'var(--live-ink)':'var(--ink3)' }}>{r.GD>0?'+':''}{r.GD}</span>
              <span style={{ textAlign:'center', fontWeight:800 }}>{r.Pts}</span>
              <button onClick={() => toggleFollow(r.id)} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', justifyContent:'center' }}>
                <Icon name="star" size={15} color={mine?'var(--amber)':'var(--ink4)'} />
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:11, color:'var(--ink4)', margin:'8px 2px 0', display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ width:8, height:8, borderRadius:2, background:'var(--ok)', flex:'none' }} />Top two advance to the knockout stage
      </div>

      {/* group matches */}
      <div style={{ marginTop:14 }}>
        <div className="eyebrow" style={{ margin:'0 2px 10px' }}>Group {group} · matches</div>
        {groupMs.map((m, i) => <TMatchRow key={i} m={{ ...m, group }} reg={reg} now={now} app={app} followed={followed} />)}
        {groupMs.length === 0 && <EmptyCard icon="search" text="No matches for this filter" />}
      </div>

      {/* knockout bracket */}
      <div className="sec-head"><h2>Knockout</h2><span className="meta">Sunday</span></div>
      <div className="card" style={{ padding:'14px 15px' }}>
        <div className="eyebrow" style={{ fontSize:10, marginBottom:10 }}>Semi-finals</div>
        {TOURN.knockout.sf.map(s => (
          <div key={s.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderBottom:'1px solid var(--hair)' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>{s.label}</div>
              <div style={{ fontSize:12, color:'var(--ink3)', marginTop:1 }}>{s.h} <span style={{ color:'var(--ink4)' }}>v</span> {s.a}</div>
            </div>
            <span className="pill pill-mut" style={{ height:22, fontSize:11 }}>{s.when}</span>
          </div>
        ))}
        <div className="eyebrow" style={{ fontSize:10, margin:'14px 0 10px' }}>Final</div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:10, flex:'none', background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="cup" size={18} color="var(--amber)" /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13.5, fontWeight:700 }}>{TOURN.knockout.final.label}</div>
            <div style={{ fontSize:12, color:'var(--ink3)', marginTop:1 }}>{TOURN.knockout.final.h} <span style={{ color:'var(--ink4)' }}>v</span> {TOURN.knockout.final.a}</div>
          </div>
          <span className="pill pill-warn" style={{ height:22, fontSize:11 }}>{TOURN.knockout.final.when}</span>
        </div>
      </div>
      <div style={{ fontSize:12, color:'var(--ink4)', textAlign:'center', margin:'14px 0 4px', lineHeight:1.5, padding:'0 20px' }}>
        Bracket fills automatically as groups finish. Follow a team for goal &amp; result alerts.
      </div>

      {/* public page + referee note — foot of screen */}
      <div className="card" style={{ display:'flex', alignItems:'center', gap:11, padding:'12px 14px', marginTop:18 }}>
        <div style={{ width:34, height:34, borderRadius:10, background:'var(--info-soft)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="globe" size={18} color="var(--info-ink)" /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, color:'var(--ink3)', fontWeight:600 }}>PUBLIC RESULTS PAGE</div>
          <div style={{ fontSize:14, fontWeight:600 }}>{TOURN.publicUrl}</div>
        </div>
        <button className="icon-btn" style={{ width:34, height:34 }} onClick={() => app.toast({ icon:'check', text:'Link copied', sub:'Live results · no login needed' })}><Icon name="qr" size={17} /></button>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--ink4)', margin:'9px 2px 2px', lineHeight:1.4 }}>
        <Icon name="whistle" size={14} style={{ flex:'none' }} />Referees update scores pitch-side — tables and brackets recalculate live.
      </div>
    </div>
  );
}

Object.assign(window, { TOURN, Tournament, TournamentBanner, tournTable, TMatchRow });
