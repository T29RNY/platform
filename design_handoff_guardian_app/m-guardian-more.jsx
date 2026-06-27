/* m-guardian-more.jsx — consumer "More" views: Team, Schedule, Notices, Documents. */

/* ============================================================ TEAM */
function GuardianTeam({ app, role }) {
  const w = worldFor(role, app.childId);
  const subj = subjectFor(role, app.childId);
  const t = w.reg[w.my];
  const row = w.table.find(r => r[0] === w.my) || [];
  const [,, won, d, l] = row;
  const pos = w.table.findIndex(r => r[0] === w.my) + 1;

  return (
    <div className="view">
      {/* team header */}
      <div className="card" style={{ padding:'16px 16px', marginTop:6, display:'flex', alignItems:'center', gap:14, overflow:'hidden', position:'relative' }}>
        <span style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:t.p }} />
        <WBadge world={w} id={w.my} size={52} r={15} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:18, fontWeight:800, letterSpacing:'-0.01em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.name}</div>
          <div style={{ fontSize:12.5, color:'var(--ink3)', marginTop:2 }}>{w.league} · {w.division}</div>
          <div style={{ display:'flex', gap:6, marginTop:9 }}>
            <span className="pill pill-warn" style={{ height:21, fontSize:11 }}>{pos===1?'1st':pos===2?'2nd':pos===3?'3rd':`${pos}th`}</span>
            <span className="pill pill-mut" style={{ height:21, fontSize:11 }}>{won}W · {d}D · {l}L</span>
          </div>
        </div>
      </div>

      {/* coach */}
      <div className="sec-head"><h2>Coach</h2></div>
      <div className="prof-row" style={{ cursor:'default' }}>
        <div className="prof-row-ic" style={{ background:'var(--s4)' }}><Icon name="whistle" size={18} color="var(--ink2)" /></div>
        <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
          <div style={{ fontSize:15, fontWeight:700 }}>{w.coach}</div>
          <div style={{ fontSize:12, color:'var(--ink3)' }}>Team coach · sends your team's updates</div>
        </div>
      </div>

      {/* squad */}
      <div className="sec-head"><h2>Squad</h2><span className="meta">{w.squad.length} players</span></div>
      <div className="card" style={{ overflow:'hidden' }}>
        {w.squad.map(([num, name, pos], i) => {
          const mine = num === subj.num;
          return (
            <div key={num} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px',
              borderBottom: i<w.squad.length-1?'1px solid var(--hair)':'none', background: mine?'var(--amber-soft)':'transparent' }}>
              <span className="tnum" style={{ width:26, flex:'none', fontSize:14, fontWeight:800, color: mine?'var(--amber)':'var(--ink3)', textAlign:'center' }}>{num}</span>
              <span style={{ flex:1, fontSize:14.5, fontWeight: mine?800:600, color: mine?'var(--amber)':'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</span>
              {mine && <span className="pill pill-warn" style={{ height:18, fontSize:9.5, padding:'0 6px' }}>{subj.kind==='child'?'Your child':'You'}</span>}
              <span className="pill pill-mut" style={{ height:20, fontSize:10.5, flex:'none' }}>{pos}</span>
            </div>
          );
        })}
      </div>

      {/* team broadcasts — one-way: coach / club admins → team */}
      <div className="sec-head"><h2>Team broadcasts</h2><span className="meta">from {w.coach.split(' ')[0]}</span></div>
      {TEAM_MSGS.map((m, i) => (
        <div key={i} className="card" style={{ padding:'13px 15px', marginBottom:9 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:7 }}>
            <div style={{ width:28, height:28, borderRadius:9, flex:'none', background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="whistle" size={15} color="var(--amber)" /></div>
            <span style={{ fontSize:13.5, fontWeight:700 }}>{w.coach}</span>
            <span style={{ marginLeft:'auto', fontSize:11, color:'var(--ink4)', fontWeight:600 }}>{m.when}</span>
          </div>
          <div style={{ fontSize:13.5, color:'var(--ink2)', lineHeight:1.45 }}>{m.body}</div>
        </div>
      ))}
      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--ink4)', margin:'4px 2px 0', lineHeight:1.4 }}>
        <Icon name="info" size={14} style={{ flex:'none' }} />Broadcasts are one-way — only your coach and club admins can post here.
      </div>
    </div>
  );
}

/* ============================================================ SCHEDULE */
function GuardianSchedule({ app, role }) {
  const w = worldFor(role, app.childId);
  const subj = subjectFor(role, app.childId);
  return (
    <div className="view">
      <div className="sec-head" style={{ marginTop:6 }}><h2>This week</h2><span className="meta">{subj.poss} sessions</span></div>
      {w.schedule.map((day, di) => (
        <div key={di} style={{ marginTop: di===0?4:18 }}>
          <div className="eyebrow" style={{ margin:'0 2px 10px' }}>{day.day}</div>
          {day.items.map((it, i) => {
            const isMatch = it.icon === 'pulse';
            return (
              <div key={i} className="card" style={{ padding:'13px 14px', marginBottom:9, display:'flex', alignItems:'center', gap:13 }}>
                <div className="tnum" style={{ width:46, flex:'none', textAlign:'center', fontSize:14, fontWeight:800, color: isMatch?'var(--amber)':'var(--ink2)' }}>{it.time}</div>
                <div style={{ width:38, height:38, borderRadius:11, flex:'none', display:'flex', alignItems:'center', justifyContent:'center',
                  background: isMatch?'var(--amber-soft)':'var(--s4)' }}><Icon name={it.icon} size={18} color={isMatch?'var(--amber)':'var(--ink2)'} /></div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.title}</div>
                  <div style={{ fontSize:12, color:'var(--ink3)', marginTop:1 }}>{it.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ fontSize:12.5, color:'var(--ink4)', textAlign:'center', marginTop:18, lineHeight:1.5, padding:'0 24px' }}>
        Training, matches and booked classes for {subj.first} in one place. Add to your calendar from any session.
      </div>
    </div>
  );
}

/* ============================================================ NOTICES (broadcasts received) */
const TEAM_MSGS = [
  { when:'2h ago',     body:'Great session tonight. Saturday: meet 10:00 sharp — astro boots only, no metal studs at Peckham Rye.' },
  { when:'Yesterday',  body:'Squad for Saturday is posted below. Well done to everyone who trained this week.' },
  { when:'3 days ago', body:'Reminder: June match subs are due — please settle in the app under Membership → Fees.' },
];
const NOTICES = [
  { from:'Greenway Park', icon:'alert', tone:'amber', title:'Saturday — astro boots & shin pads', body:'Peckham Rye is 3G astro only; metal studs are not permitted. Pads are compulsory.', when:'2 days ago' },
  { from:'Club office', icon:'pound', tone:'info', title:'June match subs now due', body:'Subs are £4 per match. Pay in-app under Membership → Fees, or hand cash to the coach.', when:'4 days ago' },
  { from:'Coach Marcus', icon:'cup', tone:'ok', title:'Tournament squad announced', body:'Crystal Palace 7s on 5 Jul. Squad list and travel plan sent to the team.', when:'1 week ago' },
  { from:'Greenway Park', icon:'calendar', tone:'mut', title:'Half-term: no training', body:'No sessions Tue/Thu next week. Fixtures continue as normal on Saturday.', when:'1 week ago' },
];
function GuardianNotices({ app, role }) {
  const toneMap = { amber:['var(--amber-soft)','var(--amber)'], info:['var(--info-soft)','var(--info-ink)'], ok:['var(--ok-soft)','var(--ok-ink)'], mut:['var(--s4)','var(--ink2)'] };
  return (
    <div className="view">
      <div className="sec-head" style={{ marginTop:6 }}><h2>Club notices</h2><span className="meta">{NOTICES.length} broadcasts</span></div>
      {NOTICES.map((n, i) => {
        const [bg, col] = toneMap[n.tone];
        return (
          <div key={i} className="card" style={{ padding:'14px 15px', marginBottom:10, display:'flex', gap:13 }}>
            <div style={{ width:38, height:38, borderRadius:11, flex:'none', background:bg, display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name={n.icon} size={18} color={col} /></div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10 }}>
                <div style={{ fontSize:14.5, fontWeight:700, lineHeight:1.25 }}>{n.title}</div>
                <span style={{ fontSize:11, color:'var(--ink4)', fontWeight:600, flex:'none' }}>{n.when}</span>
              </div>
              <div style={{ fontSize:13, color:'var(--ink2)', marginTop:5, lineHeight:1.4 }}>{n.body}</div>
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--ink4)', fontWeight:700, marginTop:7 }}>
                <Icon name="pin" size={11} />{n.from}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================ DOCUMENTS & CONSENT */
const DOCS = [
  { id:'photo', title:'Photo & media consent', sub:'2025/26 season', status:'signed', when:'Signed 2 Sep 2025', kind:'sign',
    body:'I give permission for the club to take and use photographs and video of my child for team sheets, the club website and social channels, in line with the club safeguarding policy.' },
  { id:'medical', title:'Medical & emergency contact', sub:'Review each season', status:'signed', when:'Updated 2 Sep 2025', kind:'form',
    body:'Emergency contact, allergies, medical conditions and medication. Please check this is current before the season starts.' },
  { id:'tournament', title:'Tournament consent — Crystal Palace 7s', sub:'Travel + matchday cover', status:'due', when:'Needs signature', kind:'sign',
    body:'I consent to my child travelling to and taking part in the Crystal Palace 7s tournament on 5 July, including club-arranged transport and first-aid cover on the day.' },
  { id:'age', title:'Proof of age', sub:'Birth certificate or passport', status:'due', when:'Upload required', kind:'upload',
    body:'League rules require proof of age for every junior player. Upload a clear photo of a birth certificate or passport — used once for verification, then deleted.' },
  { id:'conduct', title:'Player & parent code of conduct', sub:'FA grassroots charter', status:'signed', when:'Signed 2 Sep 2025', kind:'sign',
    body:'I agree to support positive, respectful behaviour on and off the pitch, in line with the FA Respect code for players, parents and spectators.' },
];
function GuardianDocs({ app, role }) {
  const subj = subjectFor(role, app.childId);
  const [docs, setDocs] = useState(DOCS);
  const due = docs.filter(d => d.status==='due').length;
  const complete = (id) => setDocs(ds => ds.map(d => d.id===id ? { ...d, status:'signed', when: d.kind==='upload' ? 'Uploaded just now' : d.kind==='form' ? 'Updated just now' : 'Signed just now' } : d));
  return (
    <div className="view">
      <div className="sec-head" style={{ marginTop:6 }}><h2>Documents</h2>{due>0 && <span className="meta" style={{ color:'var(--amber)' }}>{due} need action</span>}</div>
      {docs.map((d) => {
        const needs = d.status==='due';
        const act = d.kind==='upload' ? 'Upload' : d.kind==='form' ? 'Review' : 'Sign';
        return (
          <button key={d.id} className="card" onClick={() => app.openSheet(<DocSheet app={app} doc={d} onDone={complete} />)}
            style={{ width:'100%', textAlign:'left', font:'inherit', color:'inherit', cursor:'pointer',
              padding:'13px 14px', marginBottom:9, display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:38, height:38, borderRadius:11, flex:'none', display:'flex', alignItems:'center', justifyContent:'center',
              background: needs?'var(--amber-soft)':'var(--ok-soft)' }}><Icon name={needs?(d.kind==='upload'?'box':'flag'):'check'} size={18} color={needs?'var(--amber)':'var(--ok-ink)'} /></div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.title}</div>
              <div style={{ fontSize:12, color:'var(--ink3)', marginTop:1 }}>{d.sub}</div>
            </div>
            {needs
              ? <span className="pill pill-warn" style={{ height:22, fontSize:11, flex:'none' }}>{act}</span>
              : <span style={{ fontSize:11.5, color:'var(--ink4)', fontWeight:600, flex:'none' }}>{d.when}</span>}
          </button>
        );
      })}
      <div style={{ fontSize:12.5, color:'var(--ink4)', textAlign:'center', marginTop:14, lineHeight:1.5, padding:'0 24px' }}>
        Keeps {subj.poss==='Your'?'your':subj.poss} registration, medical and consent forms current for the season.
      </div>
    </div>
  );
}

/* document detail — opens to sign / upload / review, then marks complete */
function DocSheet({ app, doc, onDone }) {
  const done = doc.status === 'signed';
  const [agree, setAgree] = useState(done);
  const [sig, setSig] = useState(done ? 'Priya Anand' : '');
  const [uploaded, setUploaded] = useState(done);
  const isSign = doc.kind === 'sign', isUpload = doc.kind === 'upload', isForm = doc.kind === 'form';
  const ready = done ? false : isSign ? (agree && sig.trim().length > 1) : isUpload ? uploaded : true;
  const cta = isUpload ? 'Submit upload' : isForm ? 'Confirm details' : 'Sign & submit';
  const submit = () => { onDone(doc.id); app.closeSheet(); app.toast({ icon:'check', tone:'ok',
    text: isUpload ? 'Document uploaded' : isForm ? 'Details confirmed' : 'Consent signed', sub: doc.title }); };

  return (
    <Sheet onClose={app.closeSheet} tall title={isUpload ? 'Upload document' : isForm ? 'Review details' : 'Sign consent'}
      footer={ done
        ? <button className="btn btn-ghost btn-md btn-block" onClick={app.closeSheet}>Done</button>
        : <button className="btn btn-amber btn-md btn-block" disabled={!ready} onClick={submit}>{cta}</button> }>

      {/* doc header */}
      <div className="card" style={{ padding:'15px 16px', background:'var(--s2)', marginTop:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:42, height:42, borderRadius:13, flex:'none', background: done?'var(--ok-soft)':'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Icon name={done?'check':(isUpload?'box':'flag')} size={20} color={done?'var(--ok-ink)':'var(--amber)'} /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:16, fontWeight:700, letterSpacing:'-0.01em' }}>{doc.title}</div>
            <div style={{ fontSize:12.5, color:'var(--ink3)', marginTop:2 }}>{done ? doc.when : doc.sub}</div>
          </div>
        </div>
        <div style={{ fontSize:13.5, color:'var(--ink2)', lineHeight:1.5, marginTop:13 }}>{doc.body}</div>
      </div>

      {/* completed banner */}
      {done && (
        <div style={{ display:'flex', alignItems:'center', gap:9, fontSize:13, color:'var(--ok-ink)', fontWeight:600, margin:'14px 2px 0' }}>
          <Icon name="check" size={16} color="var(--ok-ink)" />{doc.when} · a copy has been emailed to you.
        </div>
      )}

      {/* FORM: read-only fields to review */}
      {!done && isForm && (
        <div className="prof-group" style={{ marginTop:14 }}>
          <KV k="Emergency contact" v="Priya Anand · 07700 900112" />
          <KV k="Allergies" v="None recorded" />
          <KV k="Medical notes" v="Mild asthma · inhaler" />
          <KV k="GP surgery" v="Brockley Health Centre" last />
        </div>
      )}

      {/* UPLOAD: dropzone */}
      {!done && isUpload && (
        <button onClick={() => setUploaded(true)}
          style={{ width:'100%', marginTop:14, padding:'26px 18px', borderRadius:16, cursor:'pointer', fontFamily:'var(--font)',
            border:`1.5px dashed ${uploaded?'var(--ok)':'var(--hair2)'}`, background: uploaded?'var(--ok-soft)':'var(--s1)',
            display:'flex', flexDirection:'column', alignItems:'center', gap:10, color:'inherit' }}>
          <div style={{ width:48, height:48, borderRadius:14, background: uploaded?'var(--ok-soft)':'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Icon name={uploaded?'check':'plus'} size={22} color={uploaded?'var(--ok-ink)':'var(--ink2)'} /></div>
          <div style={{ fontSize:14.5, fontWeight:700 }}>{uploaded ? 'birth-certificate.jpg' : 'Take photo or choose file'}</div>
          <div style={{ fontSize:12, color:'var(--ink4)' }}>{uploaded ? 'Tap to replace' : 'JPG or PDF · up to 10MB'}</div>
        </button>
      )}

      {/* SIGN: agree + signature */}
      {!done && isSign && (
        <React.Fragment>
          <button onClick={() => setAgree(a => !a)}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'13px 14px', marginTop:14,
              borderRadius:15, border:'1px solid var(--hair)', background:'var(--s2)', cursor:'pointer', fontFamily:'var(--font)', textAlign:'left', color:'inherit' }}>
            <span style={{ width:24, height:24, borderRadius:7, flex:'none', display:'flex', alignItems:'center', justifyContent:'center',
              background: agree?'var(--amber-soft)':'transparent', boxShadow: agree?'inset 0 0 0 1.5px var(--amber)':'inset 0 0 0 1.5px var(--hair2)' }}>
              {agree && <Icon name="check" size={15} color="var(--amber)" />}</span>
            <span style={{ flex:1, fontSize:13.5, fontWeight:600, lineHeight:1.35 }}>I have read and agree to the above on behalf of my child.</span>
          </button>
          <FieldLabel>Signature · type your full name</FieldLabel>
          <input className="flow-input" value={sig} onChange={e => setSig(e.target.value)} placeholder="Full name"
            style={{ fontFamily:'var(--font)', fontStyle:'italic', fontSize:18 }} />
          <div style={{ fontSize:11.5, color:'var(--ink4)', marginTop:8, textAlign:'center' }}>Dated {NOW.toLocaleDateString('en-GB',{ day:'numeric', month:'short', year:'numeric' })} · legally binding e-signature</div>
        </React.Fragment>
      )}
    </Sheet>
  );
}

Object.assign(window, { GuardianTeam, GuardianSchedule, GuardianNotices, GuardianDocs, DocSheet, NOTICES, DOCS });
