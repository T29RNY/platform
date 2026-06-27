/* m-booking.jsx — Apple-style progressive new-booking flow + booking detail sheet. */

const BOOK_TYPES = [
  { id:'oneoff', label:'One-off hire', desc:'A single session on one date', icon:'calendar' },
  { id:'weekly', label:'Weekly block', desc:'Same slot, repeating each week', icon:'refresh' },
  { id:'academy', label:'Academy / class', desc:'Recurring coached session', icon:'figure' },
];
const DURS = [[60,'1h'],[90,'1½h'],[120,'2h']];
const WD = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const WDL = ['M','T','W','T','F','S','S'];
const TODAY = new Date(2026, 5, 8); // Mon 8 Jun 2026 (demo anchor)
const sameDay = (a,b) => a&&b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const CHANNELS = [['whatsapp','WhatsApp'],['phone','Phone'],['email','Email'],['walkin','Walk-in']];
const chIcon = id => id==='walkin' ? 'users' : channelIcon[id];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// existing people/groups already on the system — looked up before adding new
const PEOPLE_SOURCE = [
  { name:'James Okonkwo', org:'Sunday League', ch:'whatsapp', meta:'12 bookings · regular' },
  { name:'Hannah Williams', ch:'phone', meta:'8 bookings' },
  { name:'Daniel Park', org:'Carter & Co', ch:'email', meta:'Corporate account' },
  { name:'Marcus Yeboah', ch:'whatsapp', meta:'Parties · 5 bookings' },
  { name:'Tariq Ahmed', org:'Northside Athletic', ch:'whatsapp', meta:'Member · #9' },
  { name:'Sara Lindqvist', org:'Lewisham Locos', ch:'email', meta:'Captain' },
];
const GROUP_SOURCE = [
  { name:'Greenway U10s', meta:'Academy · 14 players' },
  { name:'Greenway U14s', meta:'Academy · 16 players' },
  { name:'Northside Athletic', meta:'League team' },
  { name:'Tuesday Casuals', meta:'Casual group' },
];
const PAY_OPTS = [
  { id:'now', label:'Paid now', desc:'Card or online — settled', icon:'card' },
  { id:'deposit', label:'Deposit taken', desc:'Balance due on arrival', icon:'pound' },
  { id:'arrival', label:'Pay on arrival', desc:'Cash or card at the venue', icon:'door' },
  { id:'invoice', label:'Invoice', desc:'Account customers · net 30', icon:'mail' },
];
const rateFor = pid => pid === 'p4' ? 6000 : 4500; // pence/hour, indoor dearer

// available start hours for a pitch given a duration (only free-fitting slots)
function slotStarts(pid, durMin) {
  if (!pid) return [];
  const durH = durMin / 60, out = [];
  freeGaps(DAY_DATA[pid]).forEach(g => {
    for (let t = g.from; t <= g.to - durH + 1e-6; t += 0.5) out.push(Math.round(t * 2) / 2);
  });
  return out;
}

/* Apple-style inline month calendar */
function DatePicker({ value, onChange }) {
  const [view, setView] = useState(new Date(value.getFullYear(), value.getMonth(), 1));
  const y = view.getFullYear(), m = view.getMonth();
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
  const dim = new Date(y, m+1, 0).getDate();
  const cells = [];
  for (let i=0;i<startDow;i++) cells.push(null);
  for (let d=1; d<=dim; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7) cells.push(null);
  const monthLabel = view.toLocaleDateString('en-GB', { month:'long', year:'numeric' });
  const canPrev = y>TODAY.getFullYear() || (y===TODAY.getFullYear() && m>TODAY.getMonth());
  const shift = (n) => setView(new Date(y, m+n, 1));
  return (
    <div className="card" style={{ padding:'12px 12px 14px', background:'var(--s1)', border:'1px solid var(--hair)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'2px 4px 10px' }}>
        <span style={{ fontSize:15, fontWeight:700, letterSpacing:'-0.01em' }}>{monthLabel}</span>
        <span style={{ display:'flex', gap:6 }}>
          <button className="icon-btn" style={{ width:32, height:32, opacity: canPrev?1:.35, pointerEvents: canPrev?'auto':'none' }} onClick={() => shift(-1)} aria-label="Previous month"><Icon name="chevron" size={15} style={{ transform:'rotate(180deg)' }} /></button>
          <button className="icon-btn" style={{ width:32, height:32 }} onClick={() => shift(1)} aria-label="Next month"><Icon name="chevron" size={15} /></button>
        </span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
        {WDL.map((d,i) => <div key={i} style={{ textAlign:'center', fontSize:10.5, fontWeight:700, color:'var(--ink4)', letterSpacing:'.03em' }}>{d}</div>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
        {cells.map((c,i) => {
          if (!c) return <span key={i} />;
          const past = c < TODAY && !sameDay(c, TODAY);
          const sel = sameDay(c, value);
          const today = sameDay(c, TODAY);
          return (
            <button key={i} disabled={past} onClick={() => onChange(c)}
              style={{ aspectRatio:'1', borderRadius:'50%', border:'none', cursor: past?'default':'pointer',
                fontFamily:'var(--font)', fontSize:14, fontWeight: sel||today?700:500,
                background: sel?'var(--amber)':'transparent',
                color: sel?'#1A1403':past?'var(--ink4)':'var(--ink)',
                opacity: past?.4:1, position:'relative', transition:'background .12s' }}>
              {c.getDate()}
              {today && !sel && <span style={{ position:'absolute', bottom:4, left:'50%', transform:'translateX(-50%)', width:4, height:4, borderRadius:'50%', background:'var(--amber)' }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* one progressive step shell */
function Step({ n, total, done, active, locked, label, value, onEdit, children }) {
  if (done && !active) {
    return (
      <div className="flow-step">
        <button className="flow-done" onClick={onEdit}>
          <span className="flow-num" style={{ background:'var(--ok-soft)', color:'var(--ok-ink)' }}><Icon name="check" size={14} color="var(--ok-ink)" /></span>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ fontSize:11.5, color:'var(--ink3)', fontWeight:600, display:'block' }}>{label}</span>
            <span style={{ fontSize:14.5, fontWeight:700, color:'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', display:'block', marginTop:1 }}>{value}</span>
          </span>
          <span style={{ fontSize:12.5, color:'var(--amber)', fontWeight:700, flex:'none' }}>Edit</span>
        </button>
      </div>
    );
  }
  const headTappable = !active && !locked;
  return (
    <div className={'flow-step' + (active ? ' active' : '') + (locked ? ' locked' : '')}>
      {headTappable ? (
        <button className="flow-head" onClick={onEdit}
          style={{ width:'100%', background:'none', border:'none', cursor:'pointer', textAlign:'left', fontFamily:'var(--font)' }}>
          <span className="flow-num" style={{ background:'var(--s4)', color:'var(--ink3)' }}>{n}</span>
          <span className="flow-q" style={{ flex:1 }}>{label}</span>
          <Icon name="chevron" size={16} color="var(--ink4)" style={{ flex:'none' }} />
        </button>
      ) : (
        <div className="flow-head">
          <span className="flow-num" style={{ background: active ? 'var(--amber)' : 'var(--s4)', color: active ? '#1A1403' : 'var(--ink3)' }}>{n}</span>
          <span className="flow-q">{label}</span>
        </div>
      )}
      {active && <div className="flow-body">{children}</div>}
    </div>
  );
}

function NewBookingSheet({ app, day = 0, presetPid = null, presetStart = null }) {
  const [type, setType] = useState(null);
  const [pitch, setPitch] = useState(presetPid);
  const [whenDay, setWhenDay] = useState(day);
  const [weekday, setWeekday] = useState(0);
  const [weeks, setWeeks] = useState(6);
  const [dur, setDur] = useState(60);
  const [start, setStart] = useState(presetStart);
  const [date, setDate] = useState(() => new Date(2026, 5, 8 + day));
  const [who, setWho] = useState('');
  const [org, setOrg] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addr, setAddr] = useState('');
  const [ch, setCh] = useState('whatsapp');
  const [pay, setPay] = useState(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [open, setOpen] = useState('type');

  const recurring = type === 'weekly' || type === 'academy';
  const starts = slotStarts(pitch, dur);
  // if chosen start no longer fits duration, drop it
  useEffect(() => { if (start != null && !starts.includes(start)) setStart(null); }, [dur, pitch]); // eslint-disable-line

  const dTypeDone = !!type;
  const dPitchDone = !!pitch;
  const dWhenDone = start != null && (recurring ? true : true);
  const dWhoDone = !!picked && who.trim().length > 0 && (!picked.isNew || phone.trim() !== '' || email.trim() !== '');
  const dPayDone = !!pay;
  const allDone = dTypeDone && dPitchDone && dWhenDone && dWhoDone && dPayDone;

  const price = Math.round(rateFor(pitch) * (dur / 60));
  const deposit = Math.round(price / 2);
  const dateLabel = recurring ? `${WD[weekday]}s × ${weeks}` : `${WD[(date.getDay()+6)%7]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const timeLabel = start != null ? `${fmtHm(start)}–${fmtHm(start + dur/60)}` : '';
  const payOpt = PAY_OPTS.find(o => o.id === pay);
  const cta = pay==='now' ? `Take payment · ${gbp(price)}`
    : pay==='deposit' ? `Take deposit · ${gbp(deposit)}`
    : pay==='arrival' ? 'Confirm · pay on arrival'
    : pay==='invoice' ? `Confirm · invoice ${gbp(price)}`
    : 'Confirm booking';
  const paySub = pay==='now' ? `Paid ${gbp(price)}` : pay==='deposit' ? `Deposit ${gbp(deposit)} · ${gbp(price-deposit)} on arrival` : pay==='arrival' ? `${gbp(price)} due on arrival` : `Invoiced ${gbp(price)}`;

  const confirm = () => {
    app.closeSheet();
    app.toast({ icon:'check', tone:'ok', text:`${who} booked`, sub:`${dateLabel} · ${timeLabel} · ${paySub}` });
  };

  const advance = (next) => setOpen(next);

  return (
    <Sheet onClose={app.closeSheet} tall title="New booking"
      footer={
        <button className="btn btn-amber btn-md btn-block" disabled={!allDone} onClick={confirm}>
          {allDone
            ? <React.Fragment>{cta}</React.Fragment>
            : <span style={{ color:'#1A1403', opacity:.8 }}>{!type ? 'Pick a booking type' : !pitch ? 'Choose a pitch' : start==null ? 'Pick a time' : !dWhoDone ? 'Add who it’s for' : 'Choose how they pay'}</span>}
        </button>
      }>

      {/* live summary chip row */}
      {(type || pitch) && (
        <div style={{ display:'flex', gap:7, flexWrap:'wrap', margin:'2px 0 14px' }}>
          {type && <SumChip icon={BOOK_TYPES.find(t=>t.id===type).icon} text={BOOK_TYPES.find(t=>t.id===type).label} />}
          {pitch && <SumChip icon="grid" text={PITCHES[pitch].split(' · ')[0]} />}
          {start!=null && <SumChip icon="clock" text={timeLabel} />}
        </div>
      )}

      {/* 1 · type */}
      <Step n={1} done={dTypeDone} active={open==='type'} label={dTypeDone && open!=='type' ? 'Booking type' : 'What kind of booking?'}
        value={type ? BOOK_TYPES.find(t=>t.id===type).label : ''} onEdit={() => setOpen('type')}>
        <div className="opt-grid">
          {BOOK_TYPES.map(t => (
            <button key={t.id} className={'opt' + (type===t.id ? ' sel' : '')} onClick={() => { setType(t.id); advance('pitch'); }}>
              <span style={{ width:38, height:38, borderRadius:11, flex:'none', background: type===t.id?'var(--amber)':'var(--s3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Icon name={t.icon} size={19} color={type===t.id ? '#1A1403' : 'var(--ink2)'} /></span>
              <span style={{ flex:1 }}>
                <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)', display:'block' }}>{t.label}</span>
                <span style={{ fontSize:12.5, color:'var(--ink3)', display:'block', marginTop:1 }}>{t.desc}</span>
              </span>
              {type===t.id && <Icon name="check" size={18} color="var(--amber)" />}
            </button>
          ))}
        </div>
      </Step>

      {/* 2 · pitch */}
      <Step n={2} done={dPitchDone} active={open==='pitch'} locked={!dTypeDone}
        label={dPitchDone && open!=='pitch' ? 'Pitch' : 'Which pitch?'}
        value={pitch ? PITCHES[pitch] : ''} onEdit={() => setOpen('pitch')}>
        <div className="opt-grid">
          {PITCH_LIST.map(([id,p,zone]) => {
            const free = freeGaps(DAY_DATA[id]).length;
            return (
              <button key={id} className={'opt' + (pitch===id ? ' sel' : '')} onClick={() => { setPitch(id); advance('when'); }} disabled={!free}>
                <span style={{ width:38, height:38, borderRadius:11, flex:'none', background:'var(--s3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color:'var(--ink2)' }}>{p}</span>
                <span style={{ flex:1 }}>
                  <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)', display:'block' }}>{PITCHES[id].split(' · ')[0]}<span style={{ color:'var(--ink3)', fontWeight:500 }}> · {zone}</span></span>
                  <span style={{ fontSize:12.5, color: free? 'var(--ok)':'var(--ink4)', display:'block', marginTop:1, fontWeight:600 }}>{free ? `${free} free window${free>1?'s':''}` : 'Fully booked'}</span>
                </span>
                {pitch===id && <Icon name="check" size={18} color="var(--amber)" />}
              </button>
            );
          })}
        </div>
      </Step>

      {/* 3 · when — contextual: date/weekday, duration, then free start times */}
      <Step n={3} done={dWhenDone} active={open==='when'} locked={!dPitchDone}
        label={dWhenDone && open!=='when' ? 'When' : recurring ? 'Set the schedule' : 'Pick date & time'}
        value={`${dateLabel} · ${timeLabel}`} onEdit={() => setOpen('when')}>

        <FieldLabel>{recurring ? 'Repeats on' : 'Date'}</FieldLabel>
        {recurring ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:6 }}>
            {WDL.map((d,i) => (
              <button key={i} className={'chip' + (weekday===i?' sel':'')} style={{ minWidth:0, padding:0, height:44, borderRadius:12, position:'relative' }} onClick={() => setWeekday(i)}>
                {d}<span style={{ position:'absolute', bottom:5, left:'50%', transform:'translateX(-50%)', fontSize:8.5, fontWeight:600, opacity:.55, letterSpacing:'.02em' }}>{WD[i].slice(0,2)}</span>
              </button>
            ))}
          </div>
        ) : (
          <DatePicker value={date} onChange={setDate} />
        )}

        {recurring && (
          <React.Fragment>
            <FieldLabel>For how many weeks</FieldLabel>
            <Stepper value={weeks} min={2} max={12} onChange={setWeeks} suffix="weeks" />
          </React.Fragment>
        )}

        <FieldLabel>Duration</FieldLabel>
        <div style={{ display:'flex', gap:8 }}>
          {DURS.map(([m,l]) => <button key={m} className={'chip' + (dur===m?' sel':'')} onClick={() => setDur(m)}>{l}</button>)}
        </div>

        <FieldLabel>{pitch ? `Free start times · ${PITCHES[pitch].split(' · ')[0]}` : 'Start time'}</FieldLabel>
        {starts.length ? (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {starts.map(t => <button key={t} className={'chip' + (start===t?' sel':'')} style={{ minWidth:0, padding:'0 13px' }} onClick={() => { setStart(t); advance('who'); }}>{fmtHm(t)}</button>)}
          </div>
        ) : (
          <div style={{ fontSize:13, color:'var(--ink3)', padding:'10px 2px', display:'flex', alignItems:'center', gap:8 }}>
            <Icon name="alert" size={15} color="var(--amber)" />No {DURS.find(d=>d[0]===dur)[1]} window free — try a shorter duration.
          </div>
        )}
      </Step>

      {/* 4 · who — look up existing people first, then add new */}
      <Step n={4} done={dWhoDone} active={open==='who'} locked={!dWhenDone}
        label={dWhoDone && open!=='who' ? 'Booked for' : type==='academy' ? 'Name the group' : 'Who’s it for?'}
        value={who + (org ? ` · ${org}` : '')} onEdit={() => setOpen('who')}>
        {!picked ? (
          <PeopleLookup kind={type} query={query} setQuery={setQuery}
            onPick={(p) => { setWho(p.name); if (!p.isNew) { setOrg(p.org || ''); if (p.ch) setCh(p.ch); setPicked(p); advance('pay'); } else { setOrg(''); setPicked(p); } }} />
        ) : (
          <React.Fragment>
            <div className="card" style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--s1)', border:'1.5px solid var(--amber)' }}>
              <span style={{ width:40, height:40, borderRadius:'50%', flex:'none', display:'flex', alignItems:'center', justifyContent:'center',
                background: picked.isNew?'var(--amber-soft)':'var(--s4)', fontSize:14, fontWeight:800, color:'var(--ink2)' }}>
                {picked.isNew ? <Icon name="plus" size={18} color="var(--amber)" /> : initials(picked.name)}</span>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ fontSize:15.5, fontWeight:700, display:'block', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{who}</span>
                <span style={{ fontSize:12.5, color: picked.isNew?'var(--amber)':'var(--ink3)', display:'block', marginTop:1 }}>
                  {picked.isNew ? `New ${type==='academy'?'group':'contact'}` : `${picked.org?picked.org+' · ':''}${picked.meta}`}</span>
              </span>
              <button onClick={() => { setPicked(null); setWho(''); setOrg(''); setPhone(''); setEmail(''); setAddr(''); }} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font)', fontSize:13, fontWeight:700, color:'var(--amber)', padding:'4px 6px', flex:'none' }}>Change</button>
            </div>
            {type!=='academy' && (
              <React.Fragment>
                {picked.isNew && (
                  <React.Fragment>
                    <FieldLabel>Full name</FieldLabel>
                    <input className="flow-input" value={who} onChange={e => setWho(e.target.value)} placeholder="First and last name" />
                    <FieldLabel>Organisation <span style={{ color:'var(--ink4)', fontWeight:500 }}>· optional</span></FieldLabel>
                    <input className="flow-input" value={org} onChange={e => setOrg(e.target.value)} placeholder="Company or club" />
                    <FieldLabel>Contact <span style={{ color:'var(--ink4)', fontWeight:500 }}>· phone or email</span></FieldLabel>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <input className="flow-input" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" />
                      <input className="flow-input" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
                    </div>
                    <FieldLabel>Address <span style={{ color:'var(--ink4)', fontWeight:500 }}>· optional</span></FieldLabel>
                    <input className="flow-input" value={addr} onChange={e => setAddr(e.target.value)} placeholder="Street, postcode" />
                  </React.Fragment>
                )}
                <FieldLabel>Booking channel</FieldLabel>
                <div style={{ display:'flex', gap:8, overflowX:'auto', scrollbarWidth:'none', paddingBottom:2 }}>
                  {CHANNELS.map(([id,l]) => <button key={id} className={'chip' + (ch===id?' sel':'')} style={{ flex:'none', gap:7, padding:'0 14px' }} onClick={() => setCh(id)}><Icon name={chIcon(id)} size={15} />{l}</button>)}
                </div>
              </React.Fragment>
            )}
          </React.Fragment>
        )}
      </Step>

      {/* 5 · payment */}
      <Step n={5} done={dPayDone} active={open==='pay'} locked={!dWhoDone}
        label={dPayDone && open!=='pay' ? 'Payment' : 'How are they paying?'}
        value={payOpt ? `${payOpt.label} · ${pay==='deposit' ? gbp(deposit) : gbp(price)}` : ''} onEdit={() => setOpen('pay')}>
        <div className="opt-grid">
          {PAY_OPTS.map(o => (
            <button key={o.id} className={'opt' + (pay===o.id ? ' sel' : '')} onClick={() => setPay(o.id)}>
              <span style={{ width:38, height:38, borderRadius:11, flex:'none', background: pay===o.id?'var(--amber)':'var(--s3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Icon name={o.icon} size={18} color={pay===o.id ? '#1A1403' : 'var(--ink2)'} /></span>
              <span style={{ flex:1 }}>
                <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)', display:'block' }}>{o.label}</span>
                <span style={{ fontSize:12.5, color:'var(--ink3)', display:'block', marginTop:1 }}>{o.desc}</span>
              </span>
              <span className="tnum" style={{ fontSize:13.5, fontWeight:700, color: pay===o.id?'var(--amber)':'var(--ink3)', flex:'none' }}>{o.id==='deposit' ? gbp(deposit) : gbp(price)}</span>
            </button>
          ))}
        </div>
      </Step>
      {allDone && (
        <div className="card" style={{ padding:'14px 15px', background:'var(--s2)', marginTop:4 }}>
          <div className="eyebrow" style={{ fontSize:10.5, marginBottom:9 }}>Summary</div>
          <ReviewRow k="Type" v={BOOK_TYPES.find(t=>t.id===type).label} />
          <ReviewRow k="Pitch" v={PITCHES[pitch]} />
          <ReviewRow k={recurring ? 'Schedule' : 'Date'} v={dateLabel} />
          <ReviewRow k="Time" v={timeLabel} />
          <ReviewRow k="For" v={who + (org ? ` · ${org}` : '')} />
          <ReviewRow k="Payment" v={paySub} />
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:10, paddingTop:11, borderTop:'1px solid var(--hair)' }}>
            <span style={{ fontSize:14, fontWeight:700 }}>{recurring ? `${gbp(price)} / week` : 'Total'}</span>
            <span className="tnum" style={{ fontSize:20, fontWeight:800, color:'var(--amber)' }}>{gbp(price)}{recurring ? '' : ''}</span>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function SumChip({ icon, text }) {
  return <span className="pill" style={{ height:28, background:'var(--s3)', color:'var(--ink2)', gap:6 }}><Icon name={icon} size={13} color="var(--amber)" />{text}</span>;
}

/* lookup existing people / groups on the system before adding a new one */
function PeopleLookup({ kind, query, setQuery, onPick }) {
  const source = kind==='academy' ? GROUP_SOURCE : PEOPLE_SOURCE;
  const q = query.trim().toLowerCase();
  const matches = q ? source.filter(p => p.name.toLowerCase().includes(q) || (p.org||'').toLowerCase().includes(q)) : source;
  const exact = source.some(p => p.name.toLowerCase() === q);
  return (
    <React.Fragment>
      <div className="card" style={{ display:'flex', alignItems:'center', gap:9, padding:'0 14px', height:46, background:'var(--s1)', border:'1.5px solid var(--hair)' }}>
        <Icon name="search" size={18} color="var(--ink3)" />
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
          placeholder={kind==='academy' ? 'Search groups & teams…' : 'Search members & bookers…'}
          style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--ink)', fontFamily:'var(--font)', fontSize:15 }} />
      </div>
      <FieldLabel>{q ? `${matches.length} on file` : (kind==='academy' ? 'Your groups' : 'Frequent')}</FieldLabel>
      <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:236, overflowY:'auto', scrollbarWidth:'none' }}>
        {matches.map((p,i) => (
          <button key={i} className="opt" style={{ padding:'10px 13px' }} onClick={() => onPick(p)}>
            <span style={{ width:38, height:38, borderRadius:'50%', flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13.5, fontWeight:800, color:'var(--ink2)' }}>{initials(p.name)}</span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)', display:'block', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</span>
              <span style={{ fontSize:12.5, color:'var(--ink3)', display:'block', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.org ? `${p.org} · ` : ''}{p.meta}</span>
            </span>
            {p.ch && <Icon name={chIcon(p.ch)} size={15} color="var(--ink4)" style={{ flex:'none' }} />}
            <span className="pill pill-mut" style={{ height:21, fontSize:10.5, flex:'none' }}>On file</span>
          </button>
        ))}
        {q.length > 1 && !exact && (
          <button className="opt" style={{ padding:'10px 13px' }} onClick={() => onPick({ isNew:true, name:query.trim() })}>
            <span style={{ width:38, height:38, borderRadius:'50%', flex:'none', background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon name="plus" size={18} color="var(--amber)" /></span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)', display:'block' }}>Add “{query.trim()}”</span>
              <span style={{ fontSize:12.5, color:'var(--ink3)' }}>New {kind==='academy' ? 'group' : 'contact'} — not on file yet</span>
            </span>
          </button>
        )}
        {matches.length === 0 && q.length <= 1 && <div style={{ fontSize:13, color:'var(--ink4)', padding:'8px 2px' }}>Start typing to search…</div>}
      </div>
    </React.Fragment>
  );
}
function FieldLabel({ children }) {
  return <div style={{ fontSize:12, fontWeight:700, color:'var(--ink3)', margin:'15px 2px 8px', letterSpacing:'.01em' }}>{children}</div>;
}
function Stepper({ value, min, max, onChange, suffix }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:14 }}>
      <button className="icon-btn" style={{ width:40, height:40, fontSize:22, fontWeight:700 }} disabled={value<=min} onClick={() => onChange(Math.max(min, value-1))}>−</button>
      <span className="tnum" style={{ fontSize:18, fontWeight:800, minWidth:90, textAlign:'center' }}>{value} <span style={{ fontSize:13, color:'var(--ink3)', fontWeight:600 }}>{suffix}</span></span>
      <button className="icon-btn" style={{ width:40, height:40, fontSize:20, fontWeight:700 }} disabled={value>=max} onClick={() => onChange(Math.min(max, value+1))}>+</button>
    </div>
  );
}
function ReviewRow({ k, v }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:14, padding:'4px 0', fontSize:13.5 }}>
      <span style={{ color:'var(--ink3)', flex:'none' }}>{k}</span>
      <span style={{ fontWeight:600, textAlign:'right', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</span>
    </div>
  );
}

/* ============================================================ BOOKING DETAIL */
function BookingDetailSheet({ app, evt, dispatch }) {
  const e = evt;
  const isFixture = e.type === 'fixture';
  const title = isFixture ? `${TEAMS[e.home].name} v ${TEAMS[e.away].name}` : e.who;
  const tone = evtTone[e.type];
  const statusPill = {
    fixture: e.status==='live' ? ['pill-live','Live now'] : ['pill-mut',`Kick-off ${fmtHm(e.from)}`],
    confirmed: ['pill-ok','Confirmed'], requested: ['pill-warn','Awaiting confirmation'], maintenance: ['pill-mut','Pitch closed'],
  }[e.type];

  return (
    <Sheet onClose={app.closeSheet} title="Booking">
      {/* hero */}
      <div className="card" style={{ padding:'16px 16px', background:'var(--s2)', overflow:'hidden', position:'relative' }}>
        <span style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:tone.stripe }} />
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
          <span className={'pill ' + statusPill[0]} style={{ height:24 }}>{e.type==='fixture' && e.status==='live' && <span className="live-dot" style={{ width:5, height:5 }} />}{statusPill[1]}</span>
          <span className="tnum" style={{ fontSize:13, fontWeight:700, color:'var(--ink2)' }}>{fmtHm(e.from)}–{fmtHm(e.to)}</span>
        </div>
        {isFixture ? (
          <div style={{ display:'flex', alignItems:'center', gap:13, marginTop:14 }}>
            <Crest id={e.home} size={42} r={12} />
            <div style={{ flex:1, textAlign:'center' }}>
              <div className="tnum" style={{ fontSize:15, fontWeight:700, color:'var(--ink3)' }}>vs</div>
            </div>
            <Crest id={e.away} size={42} r={12} />
          </div>
        ) : null}
        <div style={{ fontSize:19, fontWeight:700, letterSpacing:'-0.02em', marginTop:14, textAlign: isFixture?'center':'left' }}>{title}</div>
        <div style={{ fontSize:13, color:'var(--ink3)', marginTop:3, textAlign: isFixture?'center':'left' }}>{e.what}</div>
      </div>

      {/* info rows */}
      <div className="card" style={{ padding:'4px 15px', marginTop:11, background:'var(--s2)' }}>
        <InfoRow icon="grid" k="Pitch" v={PITCHES[e.pid]} />
        <InfoRow icon="calendar" k="Date" v="Mon 8 Jun · today" />
        {isFixture && <InfoRow icon="whistle" k="Referee" v={e.ref ? REFS[e.ref].name : 'Unassigned'} warn={!e.ref} />}
        {!isFixture && e.ch && <InfoRow icon={channelIcon[e.ch]} k="Booked via" v={e.ch[0].toUpperCase()+e.ch.slice(1)} />}
        {e.type==='confirmed' && <InfoRow icon="pound" k="Payment" v="Paid · £45.00" last />}
        {e.type==='requested' && <InfoRow icon="pound" k="Payment" v="Quote sent · £60.00" last />}
        {isFixture && <InfoRow icon="trophy" k="Competition" v="GPL Division 1" last />}
      </div>

      {/* actions — contextual */}
      <div style={{ display:'flex', flexDirection:'column', gap:9, marginTop:14 }}>
        {e.type==='requested' && (
          <div style={{ display:'flex', gap:9 }}>
            <button className="btn btn-ghost btn-md" style={{ flex:1 }} onClick={() => { app.closeSheet(); app.toast({ icon:'x', tone:'live', text:`${e.who} declined` }); }}>Decline</button>
            <button className="btn btn-amber btn-md" style={{ flex:1.4 }} onClick={() => { app.closeSheet(); app.toast({ icon:'check', tone:'ok', text:`${e.who} confirmed`, sub:`${PITCHES[e.pid].split(' · ')[0]} · ${fmtHm(e.from)}–${fmtHm(e.to)}` }); }}>Confirm booking</button>
          </div>
        )}
        {isFixture && !e.ref && (
          <button className="btn btn-amber btn-md btn-block" onClick={() => { app.closeSheet(); app.toast({ icon:'whistle', tone:'ok', text:'Assign a referee', sub:title }); }}><Icon name="whistle" size={17} />Assign referee</button>
        )}
        {(e.type==='confirmed' || (isFixture && e.ref)) && (
          <button className="btn btn-amber btn-md btn-block" onClick={() => { app.closeSheet(); app.toast({ icon: e.ch?channelIcon[e.ch]:'mail', text:'Message sent', sub: isFixture? 'Both captains notified' : `${e.who} notified` }); }}>
            <Icon name={e.ch?channelIcon[e.ch]:'mail'} size={17} />Message {isFixture?'captains':e.who.split(' ')[0]}</button>
        )}
        <div style={{ display:'flex', gap:9 }}>
          <button className="btn btn-ghost btn-md" style={{ flex:1 }} onClick={() => { app.closeSheet(); app.toast({ icon:'calendar', text:'Reschedule', sub:title }); }}><Icon name="calendar" size={16} />Reschedule</button>
          {e.type!=='maintenance' && <button className="btn btn-ghost btn-md" style={{ flex:1, color:'var(--live-ink)' }} onClick={() => { app.closeSheet(); app.toast({ icon:'x', tone:'live', text:'Booking cancelled', sub:title }); }}><Icon name="x" size={16} color="var(--live-ink)" />Cancel</button>}
        </div>
      </div>
    </Sheet>
  );
}
const PAY_METHODS = [
  { id:'cash', label:'Cash', desc:'Taken at reception', icon:'pound' },
  { id:'card', label:'Card', desc:'Venue terminal', icon:'card' },
  { id:'bank', label:'Bank transfer', desc:'Needs a reference', icon:'globe', needsRef:true },
  { id:'link', label:'Online link', desc:'Send pay.ioo.fc link', icon:'qr' },
  { id:'other', label:'Other', desc:'Add a note', icon:'dots', needsNote:true },
];

function RecordPaymentSheet({ app, charge }) {
  const balance = charge.due - charge.paid;
  const teamName = TEAMS[charge.team] ? TEAMS[charge.team].name : charge.team;
  const [open, setOpen] = useState('amount');
  const [mode, setMode] = useState('full');
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState(null);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const advance = (n) => setOpen(n);

  const amountPence = mode==='full' ? balance : Math.round((parseFloat(custom) || 0) * 100);
  const amtValid = amountPence > 0 && amountPence <= balance;
  const m = PAY_METHODS.find(x => x.id === method);
  const detailOk = !m ? false : m.needsRef ? ref.trim() !== '' : m.needsNote ? note.trim() !== '' : true;
  const dAmtDone = amtValid;
  const dMethodDone = !!method && detailOk;
  const allDone = dAmtDone && dMethodDone;
  const isLink = method === 'link';

  const hint = !amtValid ? 'Enter an amount' : !method ? 'Choose a method' : m.needsRef ? 'Add a reference' : m.needsNote ? 'Add a note' : '';
  const cta = isLink ? `Send pay link · ${gbp(amountPence, true)}` : `Record ${gbp(amountPence, true)} · ${m ? m.label : ''}`;

  const confirm = () => {
    app.closeSheet();
    if (isLink) { app.toast({ icon:'qr', tone:'ok', text:'Pay link sent', sub:`${teamName} · ${gbp(amountPence, true)}` }); return; }
    const full = amountPence >= balance;
    app.toast({ icon:'check', tone:'ok', text:`${gbp(amountPence, true)} recorded`,
      sub: full ? `${teamName} · paid in full` : `${teamName} · ${gbp(balance - amountPence, true)} still due` });
  };

  return (
    <Sheet onClose={app.closeSheet} title="Record payment"
      footer={
        <button className="btn btn-amber btn-md btn-block" disabled={!allDone} onClick={confirm}>
          {allDone ? <React.Fragment>{cta}</React.Fragment> : <span style={{ color:'#1A1403', opacity:.8 }}>{hint}</span>}
        </button>
      }>
      {/* context header */}
      <div className="card" style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--s2)', marginBottom:14 }}>
        <Crest id={charge.team} size={40} r={11} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{teamName}</div>
          <div className="tnum" style={{ fontSize:12.5, color:'var(--ink3)', marginTop:1 }}>{charge.src} · {gbp(charge.due, true)} total</div>
        </div>
        <div style={{ textAlign:'right', flex:'none' }}>
          <div className="eyebrow" style={{ fontSize:10 }}>Balance</div>
          <div className="tnum" style={{ fontSize:17, fontWeight:800, color:'var(--amber)', marginTop:2 }}>{gbp(balance, true)}</div>
        </div>
      </div>

      {/* 1 · amount */}
      <Step n={1} done={dAmtDone && open!=='amount'} active={open==='amount'} locked={false}
        label={dAmtDone && open!=='amount' ? 'Amount' : 'How much are they paying?'}
        value={`${gbp(amountPence, true)}${mode==='full' ? ' · full balance' : ''}`} onEdit={() => setOpen('amount')}>
        <div style={{ display:'flex', gap:8 }}>
          <button className={'chip' + (mode==='full' ? ' sel' : '')} style={{ flex:1 }} onClick={() => { setMode('full'); advance('method'); }}>Full · {gbp(balance, true)}</button>
          <button className={'chip' + (mode==='custom' ? ' sel' : '')} style={{ flex:'none', padding:'0 18px' }} onClick={() => setMode('custom')}>Part</button>
        </div>
        {mode==='custom' && (
          <React.Fragment>
            <FieldLabel>Amount received</FieldLabel>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', fontSize:16, fontWeight:700, color:'var(--ink3)', pointerEvents:'none' }}>£</span>
              <input className="flow-input" type="number" inputMode="decimal" value={custom} onChange={e => setCustom(e.target.value)} placeholder={(balance/100).toFixed(2)} style={{ paddingLeft:28 }} />
            </div>
            {custom !== '' && !amtValid && <div style={{ fontSize:12.5, color:'var(--live-ink)', marginTop:7 }}>Enter an amount up to {gbp(balance, true)}.</div>}
          </React.Fragment>
        )}
      </Step>

      {/* 2 · method */}
      <Step n={2} done={dMethodDone && open!=='method'} active={open==='method'} locked={!dAmtDone}
        label={dMethodDone && open!=='method' ? 'Method' : 'How did they pay?'}
        value={m ? m.label + (ref ? ` · ${ref}` : '') : ''} onEdit={() => setOpen('method')}>
        <div className="opt-grid">
          {PAY_METHODS.map(o => (
            <button key={o.id} className={'opt' + (method===o.id ? ' sel' : '')} onClick={() => setMethod(o.id)}>
              <span style={{ width:38, height:38, borderRadius:11, flex:'none', background: method===o.id?'var(--amber)':'var(--s3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Icon name={o.icon} size={18} color={method===o.id ? '#1A1403' : 'var(--ink2)'} /></span>
              <span style={{ flex:1 }}>
                <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)', display:'block' }}>{o.label}</span>
                <span style={{ fontSize:12.5, color:'var(--ink3)', display:'block', marginTop:1 }}>{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
        {m && m.needsRef && (
          <React.Fragment>
            <FieldLabel>Bank reference</FieldLabel>
            <input className="flow-input" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. GREENWAY-0612" />
          </React.Fragment>
        )}
        {m && m.needsNote && (
          <React.Fragment>
            <FieldLabel>Note</FieldLabel>
            <input className="flow-input" value={note} onChange={e => setNote(e.target.value)} placeholder="How was this paid?" />
          </React.Fragment>
        )}
        {m && m.id==='link' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--ink3)', marginTop:11, lineHeight:1.4 }}>
            <Icon name="globe" size={15} color="var(--amber)" style={{ flex:'none' }} />Sends pay.ioo.fc/greenway to the booker — logged automatically once they pay.
          </div>
        )}
      </Step>
    </Sheet>
  );
}

function InfoRow({ icon, k, v, warn, last }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom: last ? 'none' : '1px solid var(--hair)' }}>
      <Icon name={icon} size={17} color="var(--ink3)" style={{ flex:'none' }} />
      <span style={{ fontSize:13.5, color:'var(--ink3)', flex:'none' }}>{k}</span>
      <span style={{ flex:1, textAlign:'right', fontSize:14, fontWeight:600, color: warn ? 'var(--amber)' : 'var(--ink)' }}>{v}</span>
    </div>
  );
}

Object.assign(window, { NewBookingSheet, BookingDetailSheet, RecordPaymentSheet });
