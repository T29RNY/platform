/* m-more.jsx — More launcher, Profile (role toggle), Search, Standings, Placeholder. */

/* ============================================================ MORE launcher */
function MoreSheet({ app, role }) {
  // consumer (guardian / member) gets a curated set; operators get the full nav.
  return ROLES[role].rank < 0
    ? <ConsumerMoreSheet app={app} role={role} />
    : <OperatorMoreSheet app={app} role={role} />;
}

function ConsumerMoreSheet({ app, role }) {
  const subj = subjectFor(role, app.childId);
  const items = [
    { id:'g_team',     icon:'shield',   label:'Team',                 desc:`${subj.poss} squad, coach & broadcasts` },
    { id:'g_schedule', icon:'calendar', label:'Schedule',             desc:'Training, matches & classes' },
    { id:'g_notices',  icon:'bell',     label:'Club notices',         desc:'Announcements & updates' },
    { id:'g_docs',     icon:'info',     label:'Documents & consent',  desc:'Forms, medical, photo consent' },
  ];
  return (
    <Sheet onClose={app.closeSheet} tall title="More">
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:6 }}>
        {items.map(n => (
          <button key={n.id} className="card" onClick={() => { app.closeSheet(); app.go(n.id, { from:'more' }); }}
            style={{ display:'flex', alignItems:'center', gap:13, padding:'12px 14px', cursor:'pointer', textAlign:'left', background:'var(--s2)' }}>
            <div style={{ width:40, height:40, borderRadius:12, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Icon name={n.icon} size={20} color="var(--amber)" />
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:700 }}>{n.label}</div>
              <div style={{ fontSize:12, color:'var(--ink3)', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{n.desc}</div>
            </div>
            <Icon name="chevron" size={16} color="var(--ink4)" />
          </button>
        ))}
      </div>

      <div className="eyebrow" style={{ margin:'22px 4px 10px' }}>Account</div>
      <button className="card" onClick={() => app.openSheet('profile')}
        style={{ display:'flex', alignItems:'center', gap:13, padding:'12px 14px', cursor:'pointer', textAlign:'left', background:'var(--s2)', width:'100%' }}>
        <div style={{ width:40, height:40, borderRadius:12, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon name="cog" size={19} color="var(--ink2)" />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700 }}>Profile &amp; settings</div>
          <div style={{ fontSize:12, color:'var(--ink3)' }}>{ROLES[role].name} · {ROLES[role].label}</div>
        </div>
        <Icon name="chevron" size={16} color="var(--ink4)" />
      </button>
    </Sheet>
  );
}

function OperatorMoreSheet({ app, role }) {
  const [q, setQ] = useState('');
  // hide nav items already reachable from the bottom tab bar (Operations, the
  // primary tabs, and the People hub which covers Members/Teams/Staff)
  const tabs = tabsFor(role);
  const excluded = new Set(['operations']);
  if (tabs.includes('bookings')) excluded.add('bookings');
  if (tabs.includes('payments')) excluded.add('payments');
  if (tabs.includes('people')) { excluded.add('members'); excluded.add('teams'); excluded.add('staff'); }
  const items = NAV.filter(n => navVisible(n, role) && !excluded.has(n.id));
  const match = (n) => (n.label + ' ' + n.desc).toLowerCase().includes(q.toLowerCase());
  const groups = NAV_GROUPS.map(g => ({ g, items: items.filter(n => n.group === g && match(n)) })).filter(x => x.items.length);

  const open = (n) => {
    app.closeSheet();
    if (n.id === 'broadcasts') { app.openSheet(<BroadcastSheet app={app} role={role} />); return; }
    if (n.id === 'cups') { app.go('tournament', { from:'more' }); return; }
    if (['payments','bookings','members','teams','staff'].includes(n.id)) app.go(n.id === 'members' || n.id === 'teams' || n.id === 'staff' ? 'people' : n.id);
    else if (n.id === 'standings') app.go('standings', { from:'more' });
    else app.go('placeholder:' + n.id, { from:'more' });
  };

  return (
    <Sheet onClose={app.closeSheet} tall title="All views">
      {/* search */}
      <div className="card" style={{ display:'flex', alignItems:'center', gap:9, padding:'0 14px', height:46, marginBottom:6, background:'var(--s2)' }}>
        <Icon name="search" size={18} color="var(--ink3)" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search views…"
          style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--ink)', fontFamily:'var(--font)', fontSize:15 }} />
        <span style={{ fontSize:11, color:'var(--ink4)', fontWeight:700, border:'1px solid var(--hair2)', borderRadius:6, padding:'2px 6px' }}>⌘K</span>
      </div>

      {groups.map(({ g, items }) => (
        <div key={g} style={{ marginTop:18 }}>
          <div className="eyebrow" style={{ margin:'0 4px 10px' }}>{g}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {items.map(n => (
              <button key={n.id} className="card" onClick={() => open(n)}
                style={{ display:'flex', alignItems:'center', gap:13, padding:'12px 14px', cursor:'pointer', textAlign:'left', background:'var(--s2)' }}>
                <div style={{ width:40, height:40, borderRadius:12, flex:'none', background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Icon name={n.icon} size={20} color="var(--amber)" />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:700 }}>{n.label}</div>
                  <div style={{ fontSize:12, color:'var(--ink3)', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{n.desc}</div>
                </div>
                <Icon name="chevron" size={16} color="var(--ink4)" />
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* venue tools — operator only */}
      {ROLES[role].rank >= 0 && <React.Fragment>
      <div className="eyebrow" style={{ margin:'22px 4px 10px' }}>Venue tools</div>
      <div style={{ display:'flex', gap:10 }}>
        <button className="card" onClick={() => { app.closeSheet(); app.openSheet(<BroadcastSheet app={app} role={role} />); }}
          style={{ flex:1, padding:'14px 12px', cursor:'pointer', display:'flex', flexDirection:'column', gap:8, alignItems:'flex-start', background:'var(--amber-soft)', borderColor:'var(--amber)' }}>
          <Icon name="bell" size={20} color="var(--amber)" />
          <span style={{ fontSize:13.5, fontWeight:700, textAlign:'left' }}>Send broadcast</span>
        </button>
        {[['tv','Reception display'],['cup','Season setup']].map(([ic,label]) => (
          <button key={label} className="card" onClick={() => { app.closeSheet(); app.toast({ icon:ic, text:label, sub:'Global venue tool' }); }}
            style={{ flex:1, padding:'14px 12px', cursor:'pointer', display:'flex', flexDirection:'column', gap:8, alignItems:'flex-start', background:'var(--s2)' }}>
            <Icon name={ic} size={20} color="var(--ink2)" />
            <span style={{ fontSize:13.5, fontWeight:700, textAlign:'left' }}>{label}</span>
          </button>
        ))}
      </div>
      </React.Fragment>}
    </Sheet>
  );
}

/* ============================================================ PROFILE + role toggle */
const ROLE_DESC = {
  owner: 'Sees every view. Full capabilities incl. finance reversals, access & feature control.',
  manager: 'All operational views. Access, Features & Integrations hidden — no admin capabilities granted.',
  staff: 'Booking + people-read surfaces. Payments read-only; finance & class writes server-denied.',
  guardian: "Parent view — Joel's matches, league table, membership, fees and club info. No venue operations, finance or admin.",
  member: 'Player view — own matches, league, membership and club. Every operator, finance and admin surface is hidden.',
};

function ProfileSheet({ app, role }) {
  const r = ROLES[role];
  const p = PROFILE[role] || {};
  const consumer = r.rank < 0;
  const cc = consumer ? consumerCard(role, app.childId) : null;

  return (
    <Sheet onClose={app.closeSheet} tall title="Profile">
      {/* identity header */}
      <div className="prof-id">
        <div className="prof-id-glow" style={{ background: consumer ? `radial-gradient(120% 90% at 80% 0%, ${TEAMS[r.context.crest]?.p}66, transparent 70%)` : 'radial-gradient(120% 90% at 80% 0%, rgba(255,200,58,.22), transparent 70%)' }} />
        <div style={{ position:'relative', display:'flex', alignItems:'center', gap:14 }}>
          <div className="prof-avatar" style={{ boxShadow: `0 0 0 2px var(--app), 0 0 0 4px ${consumer ? (TEAMS[r.context.crest]?.p || 'var(--amber)') : 'var(--amber)'}` }}>{initials(r.name)}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:19, fontWeight:800, letterSpacing:'-0.02em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.name}</div>
            <div style={{ fontSize:12.5, color:'var(--ink3)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.email}</div>
            <div style={{ display:'flex', alignItems:'center', gap:7, marginTop:8 }}>
              <span className="pill pill-warn" style={{ height:22 }}>{r.label}</span>
              <div style={{ display:'flex', alignItems:'center', gap:5, minWidth:0 }}>
                {r.context.kind === 'team' && <Crest id={r.context.crest} size={15} r={4} fs={7} />}
                <span style={{ fontSize:12, color:'var(--ink2)', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.context.name}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- OWNER: venues ---- */}
      {role==='owner' && <React.Fragment>
        <ProfLabel>Your venues</ProfLabel>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {p.venues.map(v => (
            <button key={v.id} className="prof-row" onClick={() => app.toast({ icon:'pin', text:v.name, sub: v.active ? 'Current venue' : 'Switched venue' })}>
              <div className="prof-row-ic" style={{ background: v.active ? 'var(--amber-soft)' : 'var(--s4)' }}>
                <Icon name="pin" size={18} color={v.active ? 'var(--amber)' : 'var(--ink2)'} />
              </div>
              <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
                <div style={{ fontSize:15, fontWeight:700 }}>{v.name}</div>
                <div style={{ fontSize:12, color:'var(--ink3)' }}>{v.sub}</div>
              </div>
              {v.active
                ? <span className="pill pill-ok" style={{ height:22 }}>Active</span>
                : <Icon name="chevron" size={15} color="var(--ink4)" />}
            </button>
          ))}
        </div>
      </React.Fragment>}

      {/* ---- MANAGER: team ---- */}
      {role==='manager' && <React.Fragment>
        <ProfLabel>Your team</ProfLabel>
        <button className="prof-row" onClick={() => app.toast({ text:TEAMS[p.team].name, sub:'Team profile' })}>
          <Crest id={p.team} size={42} r={11} />
          <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
            <div style={{ fontSize:15, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{TEAMS[p.team].name}</div>
            <div style={{ fontSize:12, color:'var(--ink3)' }}>{p.teamSub}</div>
          </div>
          <Icon name="chevron" size={15} color="var(--ink4)" />
        </button>
      </React.Fragment>}

      {/* ---- STAFF: venue ---- */}
      {role==='staff' && <React.Fragment>
        <ProfLabel>Your venue</ProfLabel>
        <div className="prof-row" style={{ cursor:'default' }}>
          <div className="prof-row-ic" style={{ background:'var(--amber-soft)' }}><Icon name="pin" size={18} color="var(--amber)" /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:700 }}>{p.venue}</div>
            <div style={{ fontSize:12, color:'var(--ink3)' }}>Reception team · shift today</div>
          </div>
        </div>
      </React.Fragment>}

      {/* ---- GUARDIAN: children (tap to switch active child) ---- */}
      {role==='guardian' && <React.Fragment>
        <ProfLabel>Your children</ProfLabel>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {p.children.map(c => {
            const cw = worldFor('guardian', c.id);
            const on = (app.childId || p.children[0].id) === c.id;
            return (
              <button key={c.id} className="prof-row" onClick={() => { app.setChild(c.id); app.toast({ icon:'spark', text:`Viewing ${c.first}`, sub:c.sub }); }}
                style={{ boxShadow: on ? '0 0 0 1.5px var(--amber)' : 'none' }}>
                <WBadge world={cw} id={cw.my} size={42} r={11} />
                <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
                  <div style={{ fontSize:15, fontWeight:700 }}>{c.name}</div>
                  <div style={{ fontSize:12, color:'var(--ink3)' }}>{c.sub}</div>
                </div>
                {on
                  ? <span className="pill pill-warn" style={{ height:22 }}>Active</span>
                  : <Icon name="chevron" size={15} color="var(--ink4)" />}
              </button>
            );
          })}
        </div>
      </React.Fragment>}

      {/* ---- CONSUMER: membership card + payment ---- */}
      {consumer && <React.Fragment>
        <ProfLabel>{role==='guardian' ? `${cc.name.split(' ')[0]}'s membership` : 'Membership'}</ProfLabel>
        <MembershipCard name={cc.name} team={cc.team} membership={cc.membership} memberId={cc.memberId} />
        <ProfLabel>Payments</ProfLabel>
        <div className="prof-row" style={{ cursor:'default' }}>
          <div className="prof-row-ic" style={{ background:'var(--s4)' }}><Icon name="globe" size={18} color="var(--ink2)" /></div>
          <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
            <div style={{ fontSize:15, fontWeight:700 }}>Secure card checkout</div>
            <div style={{ fontSize:12, color:'var(--ink3)' }}>Powered by Stripe · card details never stored</div>
          </div>
        </div>
      </React.Fragment>}

      {/* ---- appearance (all roles) ---- */}
      <ProfLabel>Appearance</ProfLabel>
      <AppearanceToggle />

      {/* ---- notifications (all roles) ---- */}
      {p.notif && <React.Fragment>
        <ProfLabel>Notifications</ProfLabel>
        <div className="prof-group">
          {p.notif.map(([k,label,on], i) => (
            <ToggleRow key={k} label={label} defaultOn={on} last={i===p.notif.length-1} />
          ))}
        </div>
      </React.Fragment>}

      {/* ---- account ---- */}
      <ProfLabel>Account</ProfLabel>
      <div className="prof-group">
        <AccountRow icon="cog" label="Settings & preferences" onClick={() => app.toast({ text:'Settings' })} />
        <AccountRow icon="shield" label="Security" detail="Google" onClick={() => app.toast({ icon:'shield', text:'Signed in via Google', sub: r.email })} />
        <AccountRow icon="info" label="Help & support" onClick={() => app.toast({ text:'Help & support' })} />
        <AccountRow icon="out" label="Sign out" danger last onClick={() => app.toast({ icon:'out', tone:'live', text:'Signed out' })} />
      </div>

      {/* ---- viewing-as: prototype affordance ---- */}
      <div className="prof-proto">
        <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:11 }}>
          <span className="proto-badge">Prototype</span>
          <span style={{ fontSize:13, fontWeight:700 }}>Viewing as</span>
          <span style={{ fontSize:11.5, color:'var(--ink4)', fontWeight:500, marginLeft:'auto' }}>nav adapts live</span>
        </div>
        <div className="role-grid">
          {Object.keys(ROLES).map(k => (
            <button key={k} onClick={() => app.setRole(k)} className="role-seg" data-on={role===k}>
              {ROLES[k].label}</button>
          ))}
        </div>
        <div style={{ fontSize:11.5, color:'var(--ink4)', marginTop:10, lineHeight:1.45 }}>{ROLE_DESC[role]}</div>
      </div>
    </Sheet>
  );
}

function ProfLabel({ children }) {
  return <div className="eyebrow" style={{ margin:'20px 4px 9px' }}>{children}</div>;
}

function AppearanceToggle() {
  const [mode, setMode] = useState(getThemePref());
  const opts = [['light','Light'],['dark','Dark'],['system','Auto']];
  return (
    <div style={{ display:'flex', gap:4, padding:5, background:'var(--s2)', borderRadius:13, border:'1px solid var(--hair)' }}>
      {opts.map(([id,label]) => (
        <button key={id} onClick={() => { setMode(id); setThemePref(id); }}
          style={{ flex:1, height:38, borderRadius:9, border:'none', cursor:'pointer', fontFamily:'var(--font)', fontWeight:700, fontSize:13.5,
            transition:'background .2s, color .2s',
            background: mode===id ? 'var(--amber)' : 'transparent', color: mode===id ? '#1A1403' : 'var(--ink3)' }}>{label}</button>
      ))}
    </div>
  );
}

function ToggleRow({ label, defaultOn, last }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button className="prof-line" data-last={last} onClick={() => setOn(v => !v)}>
      <span style={{ flex:1, fontSize:14.5, fontWeight:600, textAlign:'left' }}>{label}</span>
      <span className="ios-toggle" data-on={on}><span className="ios-knob" /></span>
    </button>
  );
}

function MembershipCard({ name, team, membership, memberId }) {
  const t = team;
  return (
    <div className="mcard" style={{ background:`linear-gradient(135deg, ${t.p} 0%, ${t.p}cc 55%, ${t.s}aa 130%)` }}>
      <div className="mcard-sheen" />
      <div style={{ position:'relative', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase', opacity:.7 }}>{t.name}</div>
          <div style={{ fontSize:11, fontWeight:600, opacity:.6, marginTop:2 }}>{membership.plan}</div>
        </div>
        <span className="mcard-status">{membership.status}</span>
      </div>
      <div style={{ position:'relative', display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginTop:22, gap:12 }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:19, fontWeight:800, letterSpacing:'-0.01em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</div>
          <div className="tnum" style={{ fontSize:12, opacity:.75, marginTop:3 }}>{memberId || 'Renews ' + membership.renews}</div>
          {memberId && <div style={{ fontSize:11, opacity:.65, marginTop:1 }}>Renews {membership.renews}</div>}
        </div>
        <FauxQR seed={t.name + name} />
      </div>
    </div>
  );
}

function FauxQR({ seed }) {
  // deterministic 11×11 pattern from seed
  let h = 0; for (let i=0;i<seed.length;i++) h = (h*31 + seed.charCodeAt(i)) >>> 0;
  const cells = [];
  for (let i=0;i<121;i++) { h = (h*1103515245 + 12345) >>> 0; cells.push((h >>> 16) & 1); }
  return (
    <div className="qr">
      {cells.map((c,i) => <span key={i} style={{ background: c ? '#0E0F12' : 'transparent' }} />)}
    </div>
  );
}
function AccountRow({ icon, label, detail, onClick, danger, last }) {
  return (
    <button className="prof-line" data-last={last} onClick={onClick} style={{ cursor:'pointer' }}>
      <div className="prof-row-ic" style={{ background: danger ? 'rgba(255,122,112,.12)' : 'var(--s4)', width:34, height:34 }}>
        <Icon name={icon} size={17} color={danger ? 'var(--live-ink)' : 'var(--ink2)'} />
      </div>
      <span style={{ flex:1, fontSize:14.5, fontWeight:600, color: danger ? 'var(--live-ink)' : 'var(--ink)', textAlign:'left' }}>{label}</span>
      {detail && <span style={{ fontSize:13, color:'var(--ink3)' }}>{detail}</span>}
      {!danger && <Icon name="chevron" size={15} color="var(--ink4)" />}
    </button>
  );
}

/* ============================================================ SEARCH */
function SearchSheet({ app, role }) {
  const [q, setQ] = useState('');
  const idx = [
    ...NAV.filter(n => navVisible(n, role)).map(n => ({ kind:'View', label:n.label, sub:n.desc, icon:n.icon, go:()=> n.id==='broadcasts' ? app.openSheet(<BroadcastSheet app={app} role={role} />) : app.go(n.id==='operations'?'operations':(['bookings','payments','standings'].includes(n.id)?n.id:'placeholder:'+n.id)) })),
    ...Object.entries(TEAMS).map(([id,t]) => ({ kind:'Team', label:t.name, sub:'Team', crest:id, go:()=>app.toast({ text:t.name, sub:'Team' }) })),
    { kind:'Person', label:'Maya Petersen', sub:'Referee · ★5.0', icon:'whistle', go:()=>app.toast({ text:'Maya Petersen', sub:'Referee' }) },
    { kind:'Person', label:'James Okonkwo', sub:'Booker', icon:'users', go:()=>app.toast({ text:'James Okonkwo', sub:'Booker' }) },
  ];
  const res = q ? idx.filter(x => x.label.toLowerCase().includes(q.toLowerCase()) || (x.sub||'').toLowerCase().includes(q.toLowerCase())).slice(0,9) : [];
  return (
    <Sheet onClose={app.closeSheet} tall title="Search">
      <div className="card" style={{ display:'flex', alignItems:'center', gap:9, padding:'0 14px', height:48, background:'var(--s2)' }}>
        <Icon name="search" size={19} color="var(--ink3)" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Views, teams, people, bookings…"
          style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--ink)', fontFamily:'var(--font)', fontSize:15.5 }} />
      </div>
      {!q && <div style={{ textAlign:'center', color:'var(--ink4)', fontSize:13, marginTop:40 }}>Search every view, booking, team and person</div>}
      <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:8 }}>
        {res.map((x,i) => (
          <button key={i} className="card" onClick={() => { app.closeSheet(); x.go(); }}
            style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 13px', cursor:'pointer', textAlign:'left', background:'var(--s2)' }}>
            {x.crest ? <Crest id={x.crest} size={34} r={9} />
              : <div style={{ width:34, height:34, borderRadius:10, background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name={x.icon} size={17} color="var(--ink2)" /></div>}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14.5, fontWeight:600 }}>{x.label}</div>
              <div style={{ fontSize:12, color:'var(--ink3)' }}>{x.sub}</div>
            </div>
            <span className="pill pill-mut" style={{ height:20, fontSize:10.5 }}>{x.kind}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ============================================================ STANDINGS (real) */
const STANDINGS = [
  ['t1',11,8,2,1,18,26],['t3',11,7,3,1,13,24],['t5',11,7,1,3,8,22],['t11',11,6,2,3,6,20],
  ['t2',11,5,3,3,2,18],['t7',11,4,4,3,1,16],['t9',11,4,2,5,-3,14],['t4',11,3,4,4,-3,13],
  ['t6',11,3,2,6,-8,11],['t10',11,2,3,6,-8,9],['t8',11,2,1,8,-13,7],['t12',11,1,1,9,-13,4],
];
function Standings({ app }) {
  return (
    <div className="view">
      <div className="sec-head" style={{ marginTop:6 }}><h2>GPL Division 1</h2><span className="meta">Spring 2026 · R11</span></div>
      <div className="card" style={{ overflow:'hidden' }}>
        <div className="tnum" style={{ display:'grid', gridTemplateColumns:'26px 1fr 26px 26px 30px 30px', gap:0,
          padding:'9px 14px', fontSize:11, fontWeight:700, color:'var(--ink3)', borderBottom:'1px solid var(--hair)' }}>
          <span>#</span><span>Team</span><span style={{ textAlign:'center' }}>W</span><span style={{ textAlign:'center' }}>L</span><span style={{ textAlign:'center' }}>GD</span><span style={{ textAlign:'center', color:'var(--ink2)' }}>Pts</span>
        </div>
        {STANDINGS.map(([id,p,w,d,l,gd,pts], i) => (
          <div key={id} className="tnum" style={{ display:'grid', gridTemplateColumns:'26px 1fr 26px 26px 30px 30px', alignItems:'center',
            padding:'10px 14px', fontSize:13, borderBottom: i<11?'1px solid var(--hair)':'none',
            background: i<3 ? 'var(--amber-soft)' : 'transparent' }}>
            <span style={{ fontWeight:700, color: i<3 ? 'var(--amber)' : 'var(--ink3)' }}>{i+1}</span>
            <span style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
              <span style={{ width:8, height:8, borderRadius:2, background:TEAMS[id].p, flex:'none' }} />
              <span style={{ fontSize:13, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{TEAMS[id].name}</span>
            </span>
            <span style={{ textAlign:'center', color:'var(--ink2)' }}>{w}</span>
            <span style={{ textAlign:'center', color:'var(--ink3)' }}>{l}</span>
            <span style={{ textAlign:'center', color: gd>0?'var(--ok-ink)':gd<0?'var(--live-ink)':'var(--ink3)' }}>{gd>0?'+':''}{gd}</span>
            <span style={{ textAlign:'center', fontWeight:800 }}>{pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================ PLACEHOLDER (branded) */
function Placeholder({ app, navId }) {
  const n = NAV.find(x => x.id === navId) || { label:'View', desc:'', icon:'grid' };
  return (
    <div className="view" style={{ paddingTop:8 }}>
      <div className="card" style={{ padding:'30px 22px', textAlign:'center', marginTop:14, background:'var(--s1)' }}>
        <div style={{ width:64, height:64, borderRadius:19, background:'var(--s4)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
          <Icon name={n.icon} size={30} color="var(--amber)" />
        </div>
        <div style={{ fontSize:21, fontWeight:700, letterSpacing:'-0.02em' }}>{n.label}</div>
        <div style={{ fontSize:13.5, color:'var(--ink3)', marginTop:6, maxWidth:240, margin:'6px auto 0', lineHeight:1.45 }}>{n.desc}</div>
        <div className="pill pill-mut" style={{ marginTop:18 }}>{n.group}</div>
      </div>
      <div style={{ fontSize:12.5, color:'var(--ink4)', textAlign:'center', marginTop:18, lineHeight:1.5, padding:'0 20px' }}>
        Full layout designed in the build spec.<br/>Operations is the worked hero example.
      </div>
    </div>
  );
}

Object.assign(window, { MoreSheet, ConsumerMoreSheet, OperatorMoreSheet, ProfileSheet, AppearanceToggle, AccountRow, SearchSheet, Standings, Placeholder });
