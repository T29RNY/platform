/* m-broadcast.jsx — operator/manager broadcast composer.
   Broadcasts are one-way: admins & managers compose; teams/members receive
   (read-only) in their "Club notices" / "Team broadcasts" feed.
   Supports scheduling for later + per-recipient read receipts. */

const BROADCAST_SENT = [
  { aud:'All members',       when:'Mon',       body:'Car park resurfacing Thursday — please use the Riverside Road entrance.', read:88, n:412 },
  { aud:'Northside Athletic', when:'Sat',       body:'Great win today, well played all. Training as normal Tuesday 7pm.',       read:94, n:18 },
  { aud:'U12 South',          when:'Last week', body:'Astro boots only at Peckham Rye — no metal studs. Shin pads compulsory.', read:81, n:96 },
];
const BROADCAST_SCHEDULED = [
  { aud:'All members', when:'Fri 13 · 18:00', body:'Weekend fixtures confirmed — full list and pitch allocations attached.', n:412 },
];
const AGE_GROUPS = ['U10','U12','U14','U16','Seniors'];
const SCHED_DAYS = ['Today','Tomorrow','Fri 13','Sat 14'];
const SCHED_TIMES = ['08:00','12:00','17:00','19:00','20:00'];
const RECEIPT_NAMES = [
  'Priya Anand','James Okonkwo','Sara Lindqvist','Daniel Park','Hannah Williams','Marcus Yeboah',
  'Tariq Ahmed','Lena Hartmann','Reza Pourmand','Dion Fraser','Felipe Cordeiro','Edward Reilly',
  'Aimée Belanger','Grace Miller','Amir Khan','Sofia Romano',
];
const SEEN_AGO = ['2m ago','9m ago','24m ago','41m ago','1h ago','1h ago','2h ago','3h ago','5h ago','Yesterday'];

function BroadcastSheet({ app, role }) {
  const isManager = role === 'manager';
  const myTeam = (PROFILE.manager && PROFILE.manager.team) || 't1';

  const AUD = isManager
    ? [
        { id:'team',      label:'My team',        sub:`${TEAMS[myTeam].name} · 18`, icon:'shield',  n:18 },
        { id:'guardians', label:'Guardians only', sub:'Parents in my team',         icon:'users',   n:11 },
        { id:'players',   label:'Players only',   sub:'Squad members',              icon:'figure',  n:18 },
      ]
    : [
        { id:'all',       label:'All members',      sub:'Everyone at the venue', icon:'users',   n:412 },
        { id:'team',      label:'A team',           sub:'Pick a team',           icon:'shield',  pick:'team' },
        { id:'age',       label:'Age group',        sub:'e.g. U12, Seniors',     icon:'grid',    pick:'age' },
        { id:'guardians', label:'Guardians',        sub:'All parents',           icon:'users',   n:168 },
        { id:'staff',     label:'Staff & officials',sub:'Internal only',         icon:'whistle', n:14 },
      ];

  const [aud, setAud] = useState(AUD[0].id);
  const [team, setTeam] = useState(myTeam);
  const [age, setAge] = useState('U12');
  const [msg, setMsg] = useState('');
  const [important, setImportant] = useState(false);
  const [mode, setMode] = useState('now');
  const [schedDay, setSchedDay] = useState('Today');
  const [schedTime, setSchedTime] = useState('17:00');

  const sel = AUD.find(a => a.id === aud) || AUD[0];
  const pick = sel.pick;
  const recipients = pick === 'team' ? 18 : pick === 'age' ? 96 : sel.n;
  const audLabel = pick === 'team' ? TEAMS[team].name : pick === 'age' ? `${age}` : sel.label;
  const valid = msg.trim().length > 0;
  const later = mode === 'later';

  const send = () => {
    app.closeSheet();
    if (later) {
      app.toast({ icon:'clock', tone:'ok', text:'Broadcast scheduled', sub:`${audLabel} · ${schedDay} ${schedTime}` });
    } else {
      app.toast({ icon:'bell', tone:'ok', text: important ? 'Important broadcast sent' : 'Broadcast sent',
        sub:`${audLabel} · ${recipients} recipients` });
    }
  };

  const teamOpts = Object.keys(TEAMS).slice(0, 6);

  return (
    <Sheet onClose={app.closeSheet} tall title="New broadcast"
      footer={
        <button className="btn btn-amber btn-md btn-block" disabled={!valid} onClick={send}>
          {valid
            ? (later
                ? <React.Fragment><Icon name="clock" size={17} />Schedule · {schedDay} {schedTime}</React.Fragment>
                : <React.Fragment><Icon name="bell" size={17} />Send to {audLabel} · {recipients}</React.Fragment>)
            : <span style={{ color:'#1A1403', opacity:.8 }}>Write a message to send</span>}
        </button>
      }>

      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--ink3)', margin:'2px 2px 14px', lineHeight:1.4 }}>
        <Icon name="info" size={14} style={{ flex:'none' }} />One-way broadcast — recipients can't reply. Lands in their notices feed.
      </div>

      {/* audience */}
      <FieldLabel>Send to</FieldLabel>
      <div className="opt-grid">
        {AUD.map(a => (
          <button key={a.id} className={'opt' + (aud===a.id ? ' sel' : '')} onClick={() => setAud(a.id)}>
            <span style={{ width:38, height:38, borderRadius:11, flex:'none', background: aud===a.id?'var(--amber)':'var(--s3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Icon name={a.icon} size={19} color={aud===a.id ? '#1A1403' : 'var(--ink2)'} /></span>
            <span style={{ flex:1 }}>
              <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)', display:'block' }}>{a.label}</span>
              <span style={{ fontSize:12.5, color:'var(--ink3)', display:'block', marginTop:1 }}>{a.sub}</span>
            </span>
            {aud===a.id
              ? <Icon name="check" size={18} color="var(--amber)" />
              : <span className="pill pill-mut" style={{ height:21, fontSize:11 }}>{a.pick ? 'Pick' : `${a.n}`}</span>}
          </button>
        ))}
      </div>

      {pick === 'team' && (
        <React.Fragment>
          <FieldLabel>Which team</FieldLabel>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {teamOpts.map(id => (
              <button key={id} className={'chip' + (team===id ? ' sel' : '')} style={{ gap:8, padding:'0 13px 0 8px' }} onClick={() => setTeam(id)}>
                <Crest id={id} size={22} r={6} fs={9} />{TEAMS[id].name.split(' ')[0]}
              </button>
            ))}
          </div>
        </React.Fragment>
      )}
      {pick === 'age' && (
        <React.Fragment>
          <FieldLabel>Which age group</FieldLabel>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {AGE_GROUPS.map(a => (
              <button key={a} className={'chip' + (age===a ? ' sel' : '')} onClick={() => setAge(a)}>{a}</button>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* message */}
      <FieldLabel>Message</FieldLabel>
      <textarea className="flow-input" value={msg} onChange={e => setMsg(e.target.value)}
        placeholder={`Write your message to ${audLabel}…`}
        style={{ height:'auto', minHeight:118, padding:'12px 14px', resize:'none', lineHeight:1.45, display:'block' }} />
      <div style={{ fontSize:11.5, color:'var(--ink4)', margin:'7px 2px 0', textAlign:'right' }}>{msg.length}/600</div>

      {/* important toggle */}
      <button onClick={() => setImportant(v => !v)}
        style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'13px 14px', marginTop:14,
          borderRadius:15, border:'1px solid var(--hair)', background:'var(--s2)', cursor:'pointer', fontFamily:'var(--font)', textAlign:'left', color:'inherit' }}>
        <div style={{ width:36, height:36, borderRadius:10, flex:'none', background: important?'var(--live-soft)':'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon name="alert" size={18} color={important?'var(--live-ink)':'var(--ink2)'} /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14.5, fontWeight:700 }}>Mark important</div>
          <div style={{ fontSize:12, color:'var(--ink3)' }}>Pinned to the top with an alert push</div>
        </div>
        <span className="ios-toggle" data-on={important}><span className="ios-knob" /></span>
      </button>

      {/* delivery — now or scheduled */}
      <FieldLabel>Delivery</FieldLabel>
      <div style={{ display:'flex', gap:4, padding:5, background:'var(--s2)', borderRadius:13, border:'1px solid var(--hair)' }}>
        {[['now','Send now'],['later','Schedule']].map(([id,label]) => (
          <button key={id} onClick={() => setMode(id)} style={{ flex:1, height:36, borderRadius:9, border:'none', cursor:'pointer',
            fontFamily:'var(--font)', fontWeight:700, fontSize:13.5, transition:'color .2s, background .2s',
            background: mode===id?'var(--s4)':'transparent', color: mode===id?'var(--ink)':'var(--ink3)' }}>{label}</button>
        ))}
      </div>
      {later && (
        <React.Fragment>
          <FieldLabel>Day</FieldLabel>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {SCHED_DAYS.map(d => <button key={d} className={'chip' + (schedDay===d?' sel':'')} style={{ padding:'0 13px' }} onClick={() => setSchedDay(d)}>{d}</button>)}
          </div>
          <FieldLabel>Time</FieldLabel>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {SCHED_TIMES.map(t => <button key={t} className={'chip' + (schedTime===t?' sel':'')} style={{ minWidth:0, padding:'0 13px' }} onClick={() => setSchedTime(t)}>{t}</button>)}
          </div>
        </React.Fragment>
      )}

      {/* delivery summary */}
      <div className="card" style={{ padding:'13px 15px', background:'var(--s2)', marginTop:14, display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:34, height:34, borderRadius:10, flex:'none', background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name={later?'clock':'bell'} size={17} color="var(--amber)" /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:700 }}>{audLabel}</div>
          <div style={{ fontSize:12, color:'var(--ink3)' }}>{later ? `Scheduled · ${schedDay} ${schedTime}` : 'In-app notice + push'} · ~{recipients} people</div>
        </div>
      </div>

      {/* scheduled queue */}
      {BROADCAST_SCHEDULED.length > 0 && <React.Fragment>
        <div className="eyebrow" style={{ margin:'22px 4px 11px' }}>Scheduled</div>
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          {BROADCAST_SCHEDULED.map((b, i) => (
            <div key={i} className="card" style={{ padding:'13px 15px', background:'var(--s2)', display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:34, height:34, borderRadius:10, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="clock" size={17} color="var(--ink2)" /></div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{b.body}</div>
                <div style={{ fontSize:12, color:'var(--ink3)', marginTop:1 }}>{b.aud} · {b.n} recipients</div>
              </div>
              <span className="pill pill-warn" style={{ height:22, fontSize:11, flex:'none' }}>{b.when}</span>
            </div>
          ))}
        </div>
      </React.Fragment>}

      {/* recently sent — tap for read receipts */}
      <div className="eyebrow" style={{ margin:'22px 4px 11px' }}>Recently sent · tap for receipts</div>
      <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
        {BROADCAST_SENT.map((b, i) => (
          <button key={i} className="card" onClick={() => app.openSheet(<ReadReceiptSheet app={app} b={b} />)}
            style={{ width:'100%', textAlign:'left', cursor:'pointer', padding:'13px 15px', background:'var(--s2)', font:'inherit', color:'inherit' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span className="pill pill-mut" style={{ height:20, fontSize:10.5 }}>{b.aud}</span>
              <span style={{ marginLeft:'auto', fontSize:11, color:'var(--ink4)', fontWeight:600 }}>{b.when}</span>
            </div>
            <div style={{ fontSize:13, color:'var(--ink2)', lineHeight:1.4 }}>{b.body}</div>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, color:'var(--ink4)', fontWeight:600, marginTop:9 }}>
              <span style={{ flex:1, height:5, borderRadius:3, background:'var(--s4)', overflow:'hidden' }}>
                <span style={{ display:'block', height:'100%', width:b.read+'%', background:'var(--ok)', borderRadius:3 }} />
              </span>
              <span style={{ color:'var(--ok-ink)' }}>{b.read}% read</span>
              <Icon name="chevron" size={14} color="var(--ink4)" />
            </div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------- read receipts: who's seen a broadcast ---------- */
function ReadReceiptSheet({ app, b }) {
  const shown = Math.min(b.n, 14);
  const seenInShown = Math.round(shown * b.read / 100);
  const rows = RECEIPT_NAMES.slice(0, shown).map((name, i) => ({
    name, seen: i < seenInShown, when: SEEN_AGO[i % SEEN_AGO.length],
  }));
  const seen = rows.filter(r => r.seen);
  const unseen = rows.filter(r => !r.seen);
  const seenTotal = Math.round(b.n * b.read / 100);

  const Row = ({ r }) => (
    <div className="prof-line" data-last="false" style={{ cursor:'default' }}>
      <span style={{ width:34, height:34, borderRadius:'50%', flex:'none', display:'flex', alignItems:'center', justifyContent:'center',
        background:'var(--s4)', fontSize:12.5, fontWeight:800, color:'var(--ink2)' }}>{initials(r.name)}</span>
      <span style={{ flex:1, fontSize:14.5, fontWeight:600, textAlign:'left', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.name}</span>
      {r.seen
        ? <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'var(--ok-ink)', fontWeight:700, flex:'none' }}><Icon name="check" size={14} color="var(--ok-ink)" />{r.when}</span>
        : <span style={{ fontSize:12, color:'var(--ink4)', fontWeight:600, flex:'none' }}>Not seen</span>}
    </div>
  );

  return (
    <Sheet onClose={app.closeSheet} tall title="Read receipts"
      footer={
        <button className="btn btn-amber btn-md btn-block" onClick={() => { app.closeSheet(); app.toast({ icon:'bell', tone:'ok', text:'Reminder sent', sub:`${b.n - seenTotal} who haven't seen it` }); }}>
          <Icon name="bell" size={17} />Remind {b.n - seenTotal} who haven't seen it
        </button>
      }>
      {/* header */}
      <div className="card" style={{ padding:'14px 15px', background:'var(--s2)', marginTop:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
          <span className="pill pill-mut" style={{ height:21, fontSize:11 }}>{b.aud}</span>
          <span style={{ marginLeft:'auto', fontSize:11.5, color:'var(--ink4)', fontWeight:600 }}>Sent {b.when}</span>
        </div>
        <div style={{ fontSize:13.5, color:'var(--ink2)', lineHeight:1.45 }}>{b.body}</div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:12 }}>
          <span style={{ flex:1, height:6, borderRadius:3, background:'var(--s4)', overflow:'hidden' }}>
            <span style={{ display:'block', height:'100%', width:b.read+'%', background:'var(--ok)', borderRadius:3 }} />
          </span>
          <span className="tnum" style={{ fontSize:13, fontWeight:800 }}><span style={{ color:'var(--ok-ink)' }}>{seenTotal}</span> <span style={{ color:'var(--ink4)' }}>/ {b.n} seen</span></span>
        </div>
      </div>

      <ProfLabel>Seen · {seenTotal}</ProfLabel>
      <div className="prof-group">
        {seen.map((r,i) => <Row key={i} r={r} />)}
        {b.n > shown && <div style={{ padding:'11px 14px', fontSize:12.5, color:'var(--ink4)', fontWeight:600 }}>+ {seenTotal - seen.length} more</div>}
      </div>

      {unseen.length > 0 && <React.Fragment>
        <ProfLabel>Not seen yet · {b.n - seenTotal}</ProfLabel>
        <div className="prof-group">
          {unseen.map((r,i) => <Row key={i} r={r} />)}
          {(b.n - seenTotal) > unseen.length && <div style={{ padding:'11px 14px', fontSize:12.5, color:'var(--ink4)', fontWeight:600 }}>+ {(b.n - seenTotal) - unseen.length} more</div>}
        </div>
      </React.Fragment>}
    </Sheet>
  );
}

Object.assign(window, { BroadcastSheet, ReadReceiptSheet, BROADCAST_SENT, BROADCAST_SCHEDULED });
