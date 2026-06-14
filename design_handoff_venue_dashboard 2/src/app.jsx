/* App shell — vertical sidebar nav, topbar with greeting + clock, stat row */

const { useState: useStateApp, useEffect: useEffectApp } = React;

/* ----------- Icons (24x24 viewBox, stroke 1.6) ----------- */
const Icon = ({ name, size = 18 }) => {
  const props = { viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
                  stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    ops:      <><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
    bookings: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 3v4M16 3v4" /></>,
    payments: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>,
    teams:    <><circle cx="9" cy="9" r="3.2" /><circle cx="17" cy="10" r="2.4" /><path d="M3 19c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5" /><path d="M15 19c0-2 1.5-3.4 4-3.4 1 0 1.7.2 2 .5" /></>,
    players:  <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" /></>,
    staff:    <><circle cx="12" cy="7" r="3" /><path d="M6 21v-1c0-2.8 2.7-5 6-5s6 2.2 6 5v1" /><path d="M16 3l2 2-2 2" /></>,
    league:   <><path d="M6 4h12v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V4z" /><path d="M6 6H4v1a2 2 0 0 0 2 2" /><path d="M18 6h2v1a2 2 0 0 1-2 2" /><path d="M9 20h6M10 20l1-5h2l1 5" /></>,
    table:    <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></>,
    cups:     <><path d="M7 4h10v6a5 5 0 0 1-10 0V4z" /><path d="M7 7H4a3 3 0 0 0 3 3" /><path d="M17 7h3a3 3 0 0 1-3 3" /><path d="M9 21h6M12 15v6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.4.97 1.36 1.51 2.5 1.51H21a2 2 0 1 1 0 4h-.09c-.7 0-1.3.4-1.51 1z" /></>,
    tv:       <><rect x="2" y="5" width="20" height="13" rx="2" /><path d="M8 21h8M12 18v3" /></>,
    plus:     <><path d="M12 5v14M5 12h14" /></>,
    search:   <><circle cx="11" cy="11" r="6" /><path d="m21 21-3.5-3.5" /></>,
    bell:     <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
    arrow_r:  <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    chevron_l:<><path d="M15 18l-6-6 6-6" /></>,
    chevron_r:<><path d="M9 6l6 6-6 6" /></>,
    refresh:  <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
    check:    <><path d="M5 12l5 5L20 7" /></>,
    x:        <><path d="M6 6l12 12M18 6 6 18" /></>,
    copy:     <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
    alert:    <><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v5M12 18v.5" /></>,
    info:     <><circle cx="12" cy="12" r="9" /><path d="M12 8v.5M12 11v6" /></>,
    pound:    <><path d="M16 7c-1.2-1.3-2.8-2-4.5-2C9 5 7.5 6.5 7.5 9c0 1 .3 2 1 3M5 13h10M7 19h11" /></>,
    clock:    <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    pitch:    <><rect x="2" y="6" width="20" height="12" rx="1.5" /><path d="M12 6v12M2 12h4a2 2 0 0 1 0 4H2M22 12h-4a2 2 0 0 0 0 4h4" /></>,
    whistle:  <><circle cx="8" cy="14" r="5" /><path d="M13 14h7l2-4H13" /></>,
    phone:    <><path d="M22 16v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4 1h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.4 2.1L8 9a16 16 0 0 0 6 6l1.4-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.7A2 2 0 0 1 22 16z" /></>,
    whatsapp: <><path d="M21 12a9 9 0 1 1-3-6.7L21 4l-1.3 3.3A9 9 0 0 1 21 12z" /><path d="M9 9c0 4 3 7 7 7l1.5-1.5-2.5-1-1 1c-1.5-.5-3-2-3.5-3.5l1-1-1-2.5L9 9z" /></>,
    mail:     <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="3" /><path d="M21 11l-2 2 4 4" /><path d="M19 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /></>,
    drag:     <><circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" /></>,
  };
  return <svg {...props}>{paths[name] || null}</svg>;
};

function LiveClock() {
  const [now, setNow] = useStateApp(new Date());
  useEffectApp(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="clock">
      <span className="time">{h}<span className="colon">:</span>{m}</span>
      <span className="date">{date}</span>
    </div>
  );
}

const TABS = [
  { id: 'ops',       label: 'Operations', icon: 'ops' },
  { id: 'bookings',  label: 'Bookings',   icon: 'bookings' },
  { id: 'payments',  label: 'Payments',   icon: 'payments' },
  { id: 'customers', label: 'Customers',  icon: 'customers' },
  { id: 'teams',     label: 'Teams',      icon: 'teams' },
  { id: 'players',   label: 'Players',    icon: 'players' },
  { id: 'staff',     label: 'Staff',      icon: 'staff' },
  { id: 'league',    label: 'Leagues',    icon: 'league' },
  { id: 'table',     label: 'Table',      icon: 'table' },
  { id: 'cups',      label: 'Cups',       icon: 'cups' },
];

function Rail({ tab, onTab, bookingBadge, hasCup, anyLive, tonightLive, onOpenWizard, onOpenDisplay }) {
  return (
    <aside className="rail">
      <div className="rail-brand">
        <div className="mark">io</div>
        <div className="wm">In or Out
          <small>Venue console</small>
        </div>
      </div>

      <nav className="rail-nav">
        <div className="rail-nav-label">Workspace</div>
        {TABS.slice(0, 3).map(t => (
          <button key={t.id} className="rail-tab"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}>
            <span className="ico"><Icon name={t.icon} /></span>
            <span>{t.label}</span>
            {t.id === 'bookings' && bookingBadge > 0 && <span className="badge">{bookingBadge}</span>}
          </button>
        ))}

        <div className="rail-nav-label">Directory</div>
        {TABS.slice(3, 7).map(t => (
          <button key={t.id} className="rail-tab"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}>
            <span className="ico"><Icon name={t.icon} /></span>
            <span>{t.label}</span>
          </button>
        ))}

        <div className="rail-nav-label">Competition</div>
        {TABS.slice(7).filter(t => t.id !== 'cups' || hasCup).map(t => (
          <button key={t.id} className="rail-tab"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}>
            <span className="ico"><Icon name={t.icon} /></span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="rail-footer">
        <div className={'rail-status ' + (anyLive ? 'live' : 'standby')}>
          <span className="dot" />
          <div style={{ minWidth: 0 }}>
            <div className="lbl">Status</div>
            <div className="val">{anyLive ? `On Air · ${tonightLive} live` : 'Standby'}</div>
          </div>
        </div>
        <button className="rail-tab" onClick={onOpenDisplay}>
          <span className="ico"><Icon name="tv" /></span>
          <span>Reception display</span>
        </button>
        <button className="rail-tab" onClick={onOpenWizard}>
          <span className="ico"><Icon name="settings" /></span>
          <span>Season setup</span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({ state, anyLive, tab, onTab, onWalkin, onNudge }) {
  const [showSearch, setShowSearch] = useStateApp(false);
  const [showNotifs, setShowNotifs] = useStateApp(false);

  // ⌘K / Ctrl+K to open search
  useEffectApp(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
        setShowNotifs(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onNavigate = (r) => {
    if (r.tab) onTab(r.tab);
  };

  const tonightCount = state.fixtures.tonight.length;
  const liveNow = state.fixtures.tonight.filter(f => f.status === 'in_progress').length;
  const needsAssign = state.fixtures.tonight.filter(f => !f.playing_area_id || !f.official_id).length;
  const pendingBookings = state.pending_bookings.length;
  const cancelsToday = (window.DATA_cancellations || []).filter(c => {
    return new Date(c.cancelled_at).toDateString() === new Date('2026-06-08').toDateString();
  }).length;
  const outstanding = state.payments_summary?.outstanding_pence || 0;
  const dormantCu = (state.customers || []).filter(c => c.nudge_status === 'dormant').length;
  const lowInsCu = (state.customers || []).filter(c => c.nudge_status === 'low_ins').length;
  const activeTeams = state.teams_directory.length;
  const activePlayers = (state.players_directory || []).filter(p => !p.disabled).length;

  const CTX = {
    ops: {
      title: 'Operations',
      bits: [
        liveNow > 0 && { tone: 'live', label: `${liveNow} live now` },
        needsAssign > 0 && { tone: 'warn', label: `${needsAssign} to assign` },
        tonightCount > 0 && liveNow === 0 && { tone: 'mute', label: `${tonightCount} kicking off tonight` },
      ].filter(Boolean),
      action: needsAssign > 0
        ? { label: 'Assign next', icon: 'arrow_r', tone: 'primary' }
        : null,
    },
    bookings: {
      title: 'Bookings',
      bits: [
        pendingBookings > 0 && { tone: 'warn', label: `${pendingBookings} requests pending` },
        cancelsToday > 0 && { tone: 'mute', label: `${cancelsToday} cancelled today` },
      ].filter(Boolean),
      action: { label: 'Add booking', icon: 'plus', tone: 'primary', onClick: onWalkin },
    },
    payments: {
      title: 'Payments',
      bits: outstanding > 0 ? [{ tone: 'crit', label: `${poundsRound(outstanding)} outstanding` }] : [],
      action: { label: 'Record payment', icon: 'pound', tone: 'primary' },
    },
    customers: {
      title: 'Customers',
      bits: [
        dormantCu > 0 && { tone: 'warn', label: `${dormantCu} dormant` },
        lowInsCu > 0 && { tone: 'warn', label: `${lowInsCu} low ins` },
      ].filter(Boolean),
      action: (dormantCu + lowInsCu) > 0
        ? { label: `Nudge dormant (${dormantCu})`, icon: 'whatsapp', tone: 'primary', onClick: onNudge }
        : { label: 'Invite customer', icon: 'plus', tone: 'default' },
    },
    teams: {
      title: 'Teams',
      bits: [{ tone: 'mute', label: `${activeTeams} active` }],
      action: null,
    },
    players: {
      title: 'Players',
      bits: [{ tone: 'mute', label: `${activePlayers} active` }],
      action: null,
    },
    staff: {
      title: 'Staff',
      bits: [],
      action: { label: 'Add staff', icon: 'plus', tone: 'default' },
    },
    league: {
      title: 'Leagues',
      bits: [{ tone: 'mute', label: `${state.seasons.length} seasons` }],
      action: { label: 'New season', icon: 'plus', tone: 'primary' },
    },
    table: {
      title: 'Standings',
      bits: [{ tone: 'live', label: 'Updates live' }],
      action: null,
    },
    cups: {
      title: 'Cups',
      bits: [],
      action: null,
    },
  };

  const ctx = CTX[tab] || CTX.ops;
  const notifications = window.NotificationsPanel
    ? buildNotificationsCount(state)
    : 0;
  const ToneBit = ({ tone, label }) => (
    <span className={'tb-bit tb-bit-' + tone}>
      <span className="tb-dot" /> {label}
    </span>
  );

  return (
    <>
      <header className="topbar">
        <div className="tb-title-block">
          <h1 className="tb-title">{ctx.title}</h1>
          {ctx.bits.length > 0 && (
            <div className="tb-bits">
              {ctx.bits.map((b, i) => <ToneBit key={i} {...b} />)}
            </div>
          )}
        </div>
        <button className="btn btn-icon btn-sm" aria-label="Search" title="Search (⌘K)"
          onClick={() => setShowSearch(true)}>
          <Icon name="search" size={16} />
        </button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-icon btn-sm" aria-label="Notifications"
            onClick={() => setShowNotifs(s => !s)}>
            <Icon name="bell" size={16} />
            {notifications > 0 && <span className="notif-badge">{notifications}</span>}
          </button>
          {showNotifs && (
            <NotificationsPanel state={state}
              onClose={() => setShowNotifs(false)}
              onNavigate={onNavigate} />
          )}
        </div>
        <LiveClock />
        {ctx.action && (
          <button className={'btn btn-sm' + (ctx.action.tone === 'primary' ? ' btn-primary' : '')}
            onClick={ctx.action.onClick || undefined}>
            <Icon name={ctx.action.icon} size={14} /> {ctx.action.label}
          </button>
        )}
      </header>
      {showSearch && (
        <SearchPalette state={state}
          onClose={() => setShowSearch(false)}
          onNavigate={onNavigate} />
      )}
    </>
  );
}

function buildNotificationsCount(state) {
  const inc = (state.open_incidents || []).length;
  const reg = (state.pending_registrations || []).length;
  const unas = (state.fixtures.tonight || []).filter(f => !f.playing_area_id || !f.official_id).length;
  const bk = Math.min(3, (state.pending_bookings || []).length);
  const cuFlag = (state.customers || []).filter(c => c.nudge_status === 'dormant' || c.nudge_status === 'low_ins').length;
  const total = inc + reg + unas + bk + cuFlag;
  try {
    const seen = JSON.parse(localStorage.getItem('iotools:notifs-seen') || '[]');
    return Math.max(0, total - seen.length);
  } catch (e) {
    return total;
  }
}

function OpsStatBar({ state, onTab }) {
  const tonight = state.fixtures.tonight.length;
  const live = state.fixtures.tonight.filter(f => f.status === 'in_progress').length;
  const needsAssignment = state.fixtures.tonight.filter(f => !f.playing_area_id || !f.official_id).length;
  const pendingReg = state.pending_registrations.length;
  const incidents = state.open_incidents.length;
  const outstanding = state.payments_summary?.outstanding_pence || 0;

  const scrollTo = (selector, flashUnassigned = false) => {
    const el = document.querySelector(selector);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: 'smooth' });
    if (flashUnassigned) {
      setTimeout(() => {
        document.querySelectorAll('.tonight-grid .fxc').forEach(card => {
          const needs = card.querySelector('.needs');
          if (needs) {
            card.classList.add('flash');
            setTimeout(() => card.classList.remove('flash'), 3000);
          }
        });
      }, 380);
    }
  };

  return (
    <div className="stat-row">
      <Stat ico="ops" label="Tonight" value={tonight}
        sub={live > 0 ? <><span className="delta up">{live} live</span> right now</> : <>kicking off</>}
        onClick={() => scrollTo('.tonight')} />
      <Stat ico="alert" label="To assign" value={needsAssignment}
        sub={needsAssignment > 0 ? <>pitch or ref missing</> : <>all set</>}
        tone={needsAssignment > 0 ? 'crit' : ''}
        onClick={() => scrollTo('.tonight', true)} />
      <Stat ico="info" label="Issues" value={pendingReg + incidents}
        sub={<>{pendingReg} regs, {incidents} incidents</>}
        tone={pendingReg + incidents > 0 ? 'accent' : ''}
        onClick={() => scrollTo('.issues')} />
      <Stat ico="pound" label="Outstanding" value={poundsRound(outstanding)}
        sub={<>this cycle</>}
        onClick={() => onTab?.('payments')} />
    </div>
  );
}

function Stat({ ico, label, value, sub, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={'stat' + (tone ? ' stat--' + tone : '')} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="stat-head">
        <span className="stat-ico"><Icon name={ico} size={15} /></span>
        <span>{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
      {onClick && (
        <span className="stat-arrow" aria-hidden="true">
          <Icon name="arrow_r" size={14} />
        </span>
      )}
    </Tag>
  );
}

function VenueDashboard({ state, tweaks, setTweak }) {
  const [tab, setTab] = useStateApp('ops');
  const [showDisplay, setShowDisplay] = useStateApp(false);
  const [showWizard, setShowWizard] = useStateApp(false);

  const [fixtures, setFixtures] = useStateApp(state.fixtures);
  const [pendingRegs, setPendingRegs] = useStateApp(state.pending_registrations);

  const errorState = tweaks.stateVariant === 'error';
  const loadingState = tweaks.stateVariant === 'loading';
  const emptyState = tweaks.stateVariant === 'empty';

  if (errorState) return <GlobalError onRetry={() => setTweak('stateVariant', 'populated')} />;
  if (loadingState) return <GlobalLoading />;

  const screenState = {
    ...state,
    fixtures: emptyState ? { tonight: [], this_week: [], recent: [], upcoming: [] } : fixtures,
    pending_registrations: emptyState ? [] : pendingRegs,
    open_incidents: emptyState ? [] : state.open_incidents,
    pending_bookings: emptyState ? [] : state.pending_bookings,
    charges: emptyState ? [] : state.charges,
    teams_directory: emptyState ? [] : state.teams_directory,
    players_directory: emptyState ? [] : state.players_directory,
    staff: emptyState ? [] : state.staff,
    standings: emptyState ? [] : state.standings,
    tonightEmpty: emptyState,
  };

  const tonightCount = screenState.fixtures.tonight?.length || 0;
  const liveCount = Math.min(tweaks.liveMatches, tonightCount);
  const anyLive = liveCount > 0 && tonightCount > 0;

  const onUpdateFixture = (id, patch) => {
    const update = (list) => list.map(f => f.id === id ? { ...f, ...patch } : f);
    setFixtures({
      tonight: update(fixtures.tonight),
      this_week: update(fixtures.this_week),
      recent: update(fixtures.recent),
      upcoming: update(fixtures.upcoming),
    });
  };
  const onApproveReg = (id) => setPendingRegs(pendingRegs.filter(r => r.id !== id));
  const onRejectReg = (id) => setPendingRegs(pendingRegs.filter(r => r.id !== id));

  const bookingBadge = (screenState.pending_bookings || []).length;
  const hasCup = state.competitions.some(c => c.type === 'cup');

  // Apply liveCount-driven status overrides to tonight fixtures
  const opsState = {
    ...screenState,
    fixtures: {
      ...screenState.fixtures,
      tonight: screenState.fixtures.tonight.map((fx, i) => ({
        ...fx,
        status: i < liveCount ? 'in_progress'
              : (fx.status === 'in_progress' ? 'allocated' : fx.status),
        home_score: i < liveCount ? (fx.home_score ?? 0)
                  : (fx.status === 'in_progress' ? null : fx.home_score),
        away_score: i < liveCount ? (fx.away_score ?? 0)
                  : (fx.status === 'in_progress' ? null : fx.away_score),
      })),
    },
  };

  return (
    <div className="app">
      <Rail
        tab={tab}
        onTab={setTab}
        bookingBadge={bookingBadge}
        hasCup={hasCup}
        anyLive={anyLive}
        tonightLive={liveCount}
        onOpenWizard={() => setShowWizard(true)}
        onOpenDisplay={() => setShowDisplay(true)}
      />

      <div className="workspace">
        <Topbar state={state} anyLive={anyLive} tab={tab} onTab={setTab}
          onWalkin={() => {
            setTab('bookings');
            // defer until tab switches and Bookings mounts
            setTimeout(() => window.dispatchEvent(new CustomEvent('iotools:add-booking')), 50);
          }}
          onNudge={() => {
            setTab('customers');
            setTimeout(() => window.dispatchEvent(new CustomEvent('iotools:open-dormant-nudge')), 50);
          }} />

        <main className={'main' + (tab === 'ops' ? ' with-sidebar' : '')}>
          {tab === 'ops' && (
            <div style={{ gridArea: 'stats', minWidth: 0 }}>
              <OpsStatBar state={opsState} onTab={setTab} />
            </div>
          )}
          {tab === 'ops' && (
            <div style={{ gridArea: 'content', minWidth: 0 }}>
              <Operations
                state={opsState}
                liveCount={liveCount}
                onUpdateFixture={onUpdateFixture}
                onApproveReg={onApproveReg}
                onRejectReg={onRejectReg}
                hideSidebar
              />
            </div>
          )}
          {tab === 'ops' && (
            <div style={{ gridArea: 'sidebar', minWidth: 0 }}>
              <RailSidebar state={screenState} />
            </div>
          )}
          {tab === 'bookings' && <Bookings state={screenState} />}
          {tab === 'payments' && <Payments state={screenState} />}
          {tab === 'customers' && <Customers state={screenState} />}
          {tab === 'teams' && <Teams state={screenState} />}
          {tab === 'players' && <Players state={screenState} />}
          {tab === 'staff' && <Staff state={screenState} />}
          {tab === 'league' && <League state={screenState} onOpenWizard={() => setShowWizard(true)} />}
          {tab === 'table' && <StandingsTable state={screenState} />}
          {tab === 'cups' && <Cups state={screenState} />}
        </main>
      </div>

      {showDisplay && <DisplaySettingsModal onClose={() => setShowDisplay(false)} />}
      {showWizard && <SeasonWizardModal onClose={() => setShowWizard(false)} leagues={state.leagues} />}
    </div>
  );
}

/* Right sidebar (pitches/officials) — extracted so Operations can render without it */
function RailSidebar({ state }) {
  const [editPitch, setEditPitch] = useStateApp(null);
  const [editRef, setEditRef] = useStateApp(null);
  return (
    <aside className="sidebar">
      <div className="sb-card">
        <header className="sb-head">
          <h3>Pitches</h3>
          <span className="count">{window.DATA_pitches.filter(p => p.active).length} active</span>
        </header>
        <div className="sb-list">
          {window.DATA_pitches.map(p => (
            <div key={p.id} className={'sb-row' + (!p.active ? ' inactive' : '') + (!p.is_available && p.active ? ' maint' : '')}>
              <span className="pip" />
              <div>
                <div className="name">{p.name}</div>
                <div className="meta">{p.surface} · cap {p.capacity}{!p.is_available && p.active ? ' · in maintenance' : ''}{!p.active ? ' · retired' : ''}</div>
              </div>
              <button className="btn btn-xs btn-ghost" onClick={() => setEditPitch(p)}>Edit</button>
            </div>
          ))}
        </div>
        <div className="sb-foot">
          <button className="btn btn-sm" onClick={() => setEditPitch({})}>
            <Icon name="plus" size={14} /> Add pitch
          </button>
        </div>
      </div>

      <div className="sb-card">
        <header className="sb-head">
          <h3>Officials</h3>
          <span className="count">{window.DATA_refs.filter(r => r.active).length} active</span>
        </header>
        <div className="sb-list">
          {window.DATA_refs.map(r => (
            <div key={r.id} className={'sb-row' + (!r.active ? ' inactive' : '')}>
              <span className="pip" />
              <div>
                <div className="name">{r.name}</div>
                <div className="meta">
                  {r.employment_type.replace('_',' ')} · ★{r.overall_rating}{!r.active && ' · retired'}
                </div>
              </div>
              <button className="btn btn-xs btn-ghost" onClick={() => setEditRef(r)}>Edit</button>
            </div>
          ))}
        </div>
        <div className="sb-foot">
          <button className="btn btn-sm" onClick={() => setEditRef({})}>
            <Icon name="plus" size={14} /> Add official
          </button>
        </div>
      </div>

      {editPitch !== null && <PitchForm pitch={editPitch} onClose={() => setEditPitch(null)} />}
      {editRef !== null && <RefForm ref_={editRef} onClose={() => setEditRef(null)} />}
    </aside>
  );
}

/* ----------- Root ----------- */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": true,
  "density": "regular",
  "type": "grotesk",
  "accent": "#FFC83A",
  "liveMatches": 3,
  "stateVariant": "populated"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const state = {
    venue: window.DATA_venue,
    leagues: window.DATA_leagues,
    seasons: window.DATA_seasons,
    competitions: window.DATA_competitions,
    fixtures: {
      tonight: window.DATA_fixtures_tonight_full,
      this_week: window.DATA_fixtures_thisweek,
      recent: window.DATA_fixtures_recent,
      upcoming: window.DATA_fixtures_upcoming,
    },
    pending_registrations: window.DATA_pending_registrations,
    open_incidents: window.DATA_open_incidents,
    pending_bookings: window.DATA_pending_bookings,
    occupancy: window.DATA_occupancy,
    payments_summary: window.DATA_payments_summary,
    charges: window.DATA_charges,
    teams_directory: window.DATA_teams_directory,
    players_directory: window.DATA_players_directory,
    staff: window.DATA_staff,
    standings: window.DATA_standings,
    cup_groups: window.DATA_cup_groups,
    cup_bracket: window.DATA_cup_bracket,
    display_config: window.DATA_display_config,
    customers: window.DATA_customers || [],
  };

  useEffectApp(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    root.setAttribute('data-density', t.density);
    root.setAttribute('data-type', t.type);
    root.style.setProperty('--accent', t.accent);
    // Derive accent-soft from accent
    const hex = t.accent.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0,2), 16),
            g = parseInt(hex.slice(2,4), 16),
            b = parseInt(hex.slice(4,6), 16);
      root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`);
    }
  }, [t.dark, t.density, t.type, t.accent]);

  return (
    <>
      <VenueDashboard state={state} tweaks={t} setTweak={setTweak} />

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={v => setTweak('dark', v)} />
        <TweakColor label="Accent" value={t.accent}
          options={['#FFC83A', '#F59E0B', '#22C55E', '#3B82F6', '#A855F7', '#EC4899']}
          onChange={v => setTweak('accent', v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density}
          options={['compact', 'regular', 'comfy']}
          onChange={v => setTweak('density', v)} />
        <TweakRadio label="Type" value={t.type}
          options={['grotesk', 'humanist', 'editorial']}
          onChange={v => setTweak('type', v)} />
        <TweakSection label="Stress test" />
        <TweakSlider label="Live matches" value={t.liveMatches} min={0} max={6} step={1}
          onChange={v => setTweak('liveMatches', v)} />
        <TweakRadio label="State" value={t.stateVariant}
          options={['populated', 'empty', 'loading', 'error']}
          onChange={v => setTweak('stateVariant', v)} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App />);
window.Icon = Icon;
