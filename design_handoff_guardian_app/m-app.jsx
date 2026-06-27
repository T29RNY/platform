/* m-app.jsx — root shell: state, router, header, tab bar, sheets, live goal. */

const initial = {
  fixtures: TONIGHT.map(f => ({ ...f })),
  regs: PENDING_REGS.map(r => ({ ...r })),
  incidents: INCIDENTS.map(i => ({ ...i })),
  bookings: PENDING_BOOKINGS.map(b => ({ ...b })),
  justScored: null,
};
function reducer(s, a) {
  switch (a.type) {
    case 'reg': return { ...s, regs: s.regs.filter(r => r.id !== a.id) };
    case 'incident': return { ...s, incidents: s.incidents.filter(i => i.id !== a.id) };
    case 'booking': return { ...s, bookings: s.bookings.filter(b => b.id !== a.id) };
    case 'assign': return { ...s, fixtures: s.fixtures.map(f => f.id === a.id ? { ...f, [a.kind]: a.value } : f) };
    case 'goal': return { ...s, fixtures: s.fixtures.map(f => f.id === a.id ? { ...f, [a.side]: f[a.side] + 1 } : f), justScored: a.id };
    case 'clearScored': return { ...s, justScored: null };
    default: return s;
  }
}

const TAB_META = {
  operations: { icon:'pulse', label:'Tonight' },
  bookings:   { icon:'calendar', label:'Bookings' },
  payments:   { icon:'pound', label:'Payments' },
  people:     { icon:'users', label:'People' },
  matches:    { icon:'pulse', label:'Matches' },
  league:     { icon:'trophy', label:'League' },
  membership: { icon:'card', label:'Membership' },
  more:       { icon:'dots', label:'More' },
};
// views that live in the bottom tab bar (operator + consumer) — drive header
// chrome, active-tab indicator and role-switch bounce protection.
const PRIMARY = ['operations','bookings','payments','people','matches','league','membership'];
function viewTitle(view) {
  if (view.startsWith('placeholder:')) { const n = NAV.find(x => x.id === view.split(':')[1]); return n ? n.label : 'View'; }
  return { operations:'Operations', bookings:'Bookings', payments:'Payments', people:'People', standings:'Standings',
    matches:'Matches', league:'League', membership:'Membership',
    g_team:'Team', g_schedule:'Schedule', g_notices:'Club notices', g_docs:'Documents', tournament:'Tournament' }[view] || 'Operations';
}

function App() {
  const [role, setRole] = useState('owner');
  const [childId, setChildId] = useState('joel');
  const [venue, setVenue] = useState('Greenway Park');
  const [view, setView] = useState('operations');
  const [backSheet, setBackSheet] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [state, dispatch] = React.useReducer(reducer, initial);
  const [scale, setScale] = useState(1);
  const scrollRef = useRef(null);

  // fit phone to viewport
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 28) / 844, (window.innerWidth - 28) / 390));
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit);
  }, []);

  const toast = useCallback((opts) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, ...opts }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2700);
  }, []);

  const go = useCallback((v, opts) => {
    setView(v);
    setBackSheet(opts && opts.from ? opts.from : null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const app = {
    role, setRole: (r) => { setRole(r); toast({ icon:'spark', text:`Viewing as ${ROLES[r].label}`, sub:'Navigation updated' }); },
    go, toast,
    childId, setChild: (id) => setChildId(id),
    openSheet: (node) => setSheet(node),
    closeSheet: () => setSheet(null),
  };

  // keep role/view valid: bounce off any primary view the current role can't access
  useEffect(() => {
    const allowed = tabsFor(role).filter(t => t !== 'more');
    if (PRIMARY.includes(view) && !allowed.includes(view)) {
      go(allowed[0] || 'operations');
    }
  }, [role, view, go]);

  // simulated live goal (once, ~7s in)
  useEffect(() => {
    const t = setTimeout(() => {
      dispatch({ type:'goal', id:'f3', side:'hs' });
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      toast({ icon:'pulse', tone:'amber', text:'GOAL · Highbridge 4–2', sub:"Joseph Onyango · 36'" });
      setTimeout(() => dispatch({ type:'clearScored' }), 2600);
    }, 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const tabs = tabsFor(role);
  const isSecondary = !PRIMARY.includes(view);
  const tabBtnRefs = useRef({});
  const [indStyle, setIndStyle] = useState(null);
  useEffect(() => {
    const id = PRIMARY.includes(view) ? view : null;
    const el = id && tabBtnRefs.current[id];
    if (el) setIndStyle({ left: el.offsetLeft, width: el.offsetWidth });
    else setIndStyle(null);
  }, [view, role, scale]);

  const renderView = () => {
    if (view === 'operations') return <Ops app={app} state={state} dispatch={dispatch} />;
    if (view === 'bookings') return <Bookings app={app} state={state} dispatch={dispatch} />;
    if (view === 'payments') return <Payments app={app} state={state} role={role} />;
    if (view === 'people') return <People app={app} role={role} />;
    if (view === 'standings') return <Standings app={app} />;
    if (view === 'matches') return <GuardianMatches app={app} role={role} />;
    if (view === 'league') return <GuardianLeague app={app} role={role} />;
    if (view === 'membership') return <GuardianMembership app={app} role={role} />;
    if (view === 'g_team') return <GuardianTeam app={app} role={role} />;
    if (view === 'g_schedule') return <GuardianSchedule app={app} role={role} />;
    if (view === 'g_notices') return <GuardianNotices app={app} role={role} />;
    if (view === 'g_docs') return <GuardianDocs app={app} role={role} />;
    if (view === 'tournament') return <Tournament app={app} role={role} />;
    if (view.startsWith('placeholder:')) return <Placeholder app={app} navId={view.split(':')[1]} />;
    return <Ops app={app} state={state} dispatch={dispatch} />;
  };

  const renderSheet = () => {
    if (!sheet) return null;
    if (React.isValidElement(sheet)) return sheet;
    if (sheet === 'more') return <MoreSheet app={app} role={role} />;
    if (sheet === 'profile') return <ProfileSheet app={app} role={role} />;
    if (sheet === 'search') return <SearchSheet app={app} role={role} />;
    if (sheet && sheet.type === 'assign') {
      const fx = state.fixtures.find(f => f.id === sheet.fxId);
      return fx ? <AssignSheet kind={sheet.kind} fx={fx} app={app} dispatch={dispatch} /> : null;
    }
    return null;
  };

  const liveCount = state.fixtures.filter(f => f.status === 'in_progress').length;
  const needCount = state.regs.length + state.incidents.length;
  const consumer = ROLES[role].rank < 0;
  const consumerAlerts = consumer
    ? feesFor(role, childId).filter(f => f.status === 'due').length + (role === 'guardian' ? DOCS.filter(d => d.status === 'due').length : 0)
    : 0;

  return (
    <div className="phone" style={{ transform:`scale(${scale})`, transformOrigin:'center center' }}>
      <div className="phone-screen">
        <div className="island" />
        <div className="statusbar">
          <span className="clock">{NOW.toTimeString().slice(0,5)}</span>
          <span style={{ display:'flex', gap:6, alignItems:'center' }}>
            <Icon name="pulse" size={16} /><Icon name="whatsapp" size={15} />
            <svg width="26" height="13" viewBox="0 0 26 13"><rect x="0.5" y="0.5" width="22" height="12" rx="3.5" stroke="currentColor" strokeOpacity="0.4" fill="none"/><rect x="2" y="2" width="19" height="9" rx="2" fill="currentColor"/><rect x="24" y="4.5" width="1.6" height="4" rx="0.8" fill="currentColor" fillOpacity="0.5"/></svg>
          </span>
        </div>

        <div className="app">
          {/* header */}
          <div className="hdr">
            <div className="hdr-row">
              {isSecondary ? (
                <button className="icon-btn" onClick={() => { if (backSheet) { const s = backSheet; setBackSheet(null); app.openSheet(s); } else go('operations'); }} aria-label="Back"><Icon name="chevron" size={18} style={{ transform:'rotate(180deg)' }} /></button>
              ) : (
                <button className="avatar" onClick={() => app.openSheet('profile')}>{initials(ROLES[role].name)}</button>
              )}
              <div className="hdr-venue">
                <div className="v-name">{viewTitle(view)}</div>
                {ROLES[role].context.kind === 'team' ? (
                  consumer ? (() => { const cw = worldFor(role, childId); return (
                    <div className="v-sub">
                      <WBadge world={cw} id={cw.my} size={15} r={4} fs={7} />
                      <span className="v-ctx">{cw.reg[cw.my].name} · {cw.division}</span>
                    </div>
                  ); })() : (
                    <div className="v-sub">
                      <Crest id={ROLES[role].context.crest} size={15} r={4} fs={7} />
                      <span className="v-ctx">{ROLES[role].context.name}</span>
                    </div>
                  )
                ) : (
                  <button className="v-sub" style={{ background:'none', border:'none', padding:0, font:'inherit', color:'inherit', cursor:'pointer' }}
                    onClick={() => app.openSheet(
                      <Sheet onClose={app.closeSheet} title="Switch venue">
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {['Greenway Park','Riverside 4G','The Dome'].map(v => (
                            <button key={v} className="card" onClick={() => { setVenue(v); app.closeSheet(); }}
                              style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 15px', cursor:'pointer', textAlign:'left', background:'var(--s2)' }}>
                              <div style={{ width:36, height:36, borderRadius:11, background:'var(--amber-soft)', display:'flex', alignItems:'center', justifyContent:'center', flex:'none' }}><Icon name="pin" size={18} color="var(--amber)" /></div>
                              <span style={{ flex:1, fontSize:15, fontWeight:700 }}>{v}</span>
                              {venue===v && <Icon name="check" size={18} color="var(--amber)" />}
                            </button>
                          ))}
                        </div>
                      </Sheet>
                    )}>
                    <Icon name="pin" size={13} style={{ flex:'none' }} />
                    <span className="v-ctx">{venue}</span>
                    <Icon name="chevdown" size={13} color="var(--ink3)" style={{ flex:'none' }} />
                  </button>
                )}
              </div>
              {!consumer && <button className="icon-btn" onClick={() => app.openSheet('search')} aria-label="Search"><Icon name="search" size={19} /></button>}
              <button className="icon-btn" onClick={() => app.toast({ icon:'bell', text:'Notifications', sub: consumer ? `${consumerAlerts} reminder${consumerAlerts===1?'':'s'}` : `${needCount} venue alerts` })} aria-label="Notifications">
                <Icon name="bell" size={19} />
                {(consumer ? consumerAlerts : needCount) > 0 && <span className="dot-badge">{consumer ? consumerAlerts : needCount}</span>}
              </button>
            </div>
            {consumer && role === 'guardian' && PROFILE.guardian.children.length > 1 && (
              <div className="child-strip">
                {PROFILE.guardian.children.map(c => {
                  const cw = worldFor('guardian', c.id);
                  const on = c.id === childId;
                  return (
                    <button key={c.id} className={'child-chip' + (on ? ' on' : '')}
                      onClick={() => { if (!on) { app.setChild(c.id); app.toast({ icon:'spark', text:`Viewing ${c.first}`, sub:c.sub }); } }}>
                      <WBadge world={cw} id={cw.my} size={22} r={6} fs={9} />
                      <span>{c.first}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* scroll body */}
          <div className="scroll" ref={scrollRef} key={view + '·' + childId}>
            {renderView()}
          </div>

          {/* tab bar */}
          <div className="tabbar">
            {indStyle && (
              <div className="tab-ind" style={{ width:indStyle.width, left:indStyle.left }} />
            )}
            {tabs.map(id => {
              const m = TAB_META[id];
              const on = id === 'more' ? isSecondary : view === id;
              const badge = id==='operations' ? liveCount : (id==='bookings' ? state.bookings.length : 0);
              return (
                <button key={id} ref={el => tabBtnRefs.current[id] = el} className={'tab' + (on ? ' on' : '')}
                  onClick={() => id === 'more' ? app.openSheet('more') : go(id)}>
                  <div style={{ position:'relative' }}>
                    <Icon name={m.icon} size={23} stroke={on ? 2 : 1.7} />
                    {badge > 0 && <span className="tbadge" style={{ position:'absolute', top:-4, right:-10 }}>{badge}</span>}
                  </div>
                  <span className="tlabel">{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* toasts */}
          {toasts.length > 0 && (
            <div className="toast-wrap">
              {toasts.map(t => (
                <div key={t.id} className="toast">
                  <div style={{ width:30, height:30, borderRadius:9, flex:'none', display:'flex', alignItems:'center', justifyContent:'center',
                    background: t.tone==='ok'?'var(--ok-soft)':t.tone==='live'?'var(--live-soft)':t.tone==='amber'?'var(--amber-soft)':'var(--s3)' }}>
                    <Icon name={t.icon||'check'} size={17} color={t.tone==='ok'?'var(--ok-ink)':t.tone==='live'?'var(--live-ink)':t.tone==='amber'?'var(--amber)':'var(--ink2)'} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.text}</div>
                    {t.sub && <div style={{ fontSize:11.5, color:'var(--ink3)' }}>{t.sub}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* sheets */}
          {renderSheet()}

          <div className="home-ind" />
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
