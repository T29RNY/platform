/* Topbar overlays — universal search palette + notifications dropdown */

const { useState: useStateTbo, useEffect: useEffectTbo, useMemo: useMemoTbo, useRef: useRefTbo } = React;
const Icon = (props) => window.Icon ? React.createElement(window.Icon, props) : null;

/* =========================================================
   SEARCH PALETTE — ⌘K / icon click
   ========================================================= */

function SearchPalette({ state, onClose, onNavigate }) {
  const [q, setQ] = useStateTbo('');
  const [activeIdx, setActiveIdx] = useStateTbo(0);
  const inputRef = useRefTbo(null);

  useEffectTbo(() => {
    inputRef.current?.focus();
  }, []);

  // Build a flat searchable index
  const index = useMemoTbo(() => buildSearchIndex(state), [state]);
  const results = useMemoTbo(() => filterResults(index, q), [index, q]);
  const grouped = useMemoTbo(() => groupResults(results), [results]);

  useEffectTbo(() => {
    setActiveIdx(0);
  }, [q]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) { onNavigate(r); onClose(); }
    }
  };

  return (
    <div className="palette-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search bookings, customers, fixtures, teams, players…" />
          <kbd className="kbd">esc</kbd>
        </div>
        <div className="palette-body">
          {results.length === 0 ? (
            <div className="palette-empty">
              {q ? <>No matches for "<strong>{q}</strong>"</>
                 : <>Type to search. Try a name, team, pitch, or date.</>}
            </div>
          ) : (
            <>
              {grouped.map(([group, items]) => (
                <div key={group} className="palette-group">
                  <div className="palette-group-label">{group}</div>
                  {items.map((r) => {
                    const idx = results.indexOf(r);
                    return (
                      <button key={r.id} className={'palette-row' + (idx === activeIdx ? ' active' : '')}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => { onNavigate(r); onClose(); }}>
                        <span className={'palette-ico palette-ico-' + r.type}>
                          <Icon name={r.icon} size={14} />
                        </span>
                        <span className="palette-text">
                          <span className="palette-title">{highlight(r.title, q)}</span>
                          {r.subtitle && (
                            <span className="palette-sub">{highlight(r.subtitle, q)}</span>
                          )}
                        </span>
                        {r.meta && <span className="palette-meta">{r.meta}</span>}
                        <span className="palette-arrow">↵</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="palette-foot">
          <span className="palette-hint"><kbd className="kbd">↑↓</kbd> navigate</span>
          <span className="palette-hint"><kbd className="kbd">↵</kbd> open</span>
          <span className="palette-hint"><kbd className="kbd">esc</kbd> close</span>
          <span style={{ flex: 1 }} />
          <span className="palette-hint">{results.length} result{results.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}

function highlight(text, q) {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function buildSearchIndex(state) {
  const out = [];
  // Fixtures
  const allFx = [
    ...(state.fixtures.tonight || []).map(f => ({ ...f, _bucket: 'Tonight' })),
    ...(state.fixtures.this_week || []).map(f => ({ ...f, _bucket: 'This week' })),
    ...(state.fixtures.upcoming || []).map(f => ({ ...f, _bucket: 'Upcoming' })),
    ...(state.fixtures.recent || []).map(f => ({ ...f, _bucket: 'Recent' })),
  ];
  allFx.forEach(f => {
    const home = window.DATA_teams[f.home_team_id];
    const away = window.DATA_teams[f.away_team_id];
    if (!home || !away) return;
    out.push({
      id: 'fx-' + f.id,
      type: 'fixture',
      icon: 'ops',
      group: 'Fixtures',
      title: `${home.name} vs ${away.name}`,
      subtitle: `${f._bucket} · ${f.kickoff_time} · ${f.round_name}`,
      meta: f.status === 'in_progress' ? 'LIVE' : f.status === 'completed' ? `${f.home_score}–${f.away_score}` : '',
      tab: 'ops',
      searchText: [home.name, away.name, f.kickoff_time, f.round_name, f.status, f._bucket].join(' '),
    });
  });

  // Bookings / requests
  (state.pending_bookings || []).forEach(b => {
    out.push({
      id: 'bk-' + b.id,
      type: 'booking',
      icon: 'bookings',
      group: 'Booking requests',
      title: b.booker_name,
      subtitle: `${b.booker_org ? b.booker_org + ' · ' : ''}${b.kind === 'weekly' ? `Weekly · ${b.weeks} wks` : 'One-off'} · ${b.pitch_name.replace(/ \(.*\)/, '')}`,
      meta: new Date(b.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      tab: 'bookings',
      searchText: [b.booker_name, b.booker_org, b.pitch_name, b.message].filter(Boolean).join(' '),
    });
  });

  // Cancellations
  (window.DATA_cancellations || []).forEach(c => {
    out.push({
      id: 'cn-' + c.id,
      type: 'cancellation',
      icon: 'x',
      group: 'Cancellations',
      title: c.booker_name,
      subtitle: `${c.reason} · ${c.pitch_name.replace(/ \(.*\)/, '')} · ${window.relativeFrom(c.cancelled_at)}`,
      meta: c.decision === 'full' ? 'Full refund' : c.decision === 'partial' ? '50% credit' : 'No refund',
      tab: 'bookings',
      searchText: [c.booker_name, c.team_name, c.booker_org, c.pitch_name, c.reason, c.note].filter(Boolean).join(' '),
    });
  });

  // Customers
  (state.customers || []).forEach(c => {
    out.push({
      id: 'cu-' + c.id,
      type: 'customer',
      icon: 'customers',
      group: 'Customers',
      title: c.name,
      subtitle: `${c.kind === 'group' ? c.app_users.length + ' admin' + (c.app_users.length === 1 ? '' : 's') + '/VCs' : 'Individual'} · ${c.bookings_count} bookings`,
      meta: c.nudge_status === 'dormant' ? 'Dormant' : c.nudge_status === 'low_ins' ? 'Low ins' : '',
      tab: 'customers',
      searchText: [c.name, ...c.app_users.map(u => u.name)].join(' '),
    });
  });

  // Teams
  (state.teams_directory || []).forEach(t => {
    out.push({
      id: 'tm-' + t.team_id,
      type: 'team',
      icon: 'teams',
      group: 'Teams',
      title: t.name,
      subtitle: `${t.competition_count} comp${t.competition_count !== 1 ? 's' : ''} · active ${t.last_active_at}`,
      tab: 'teams',
      searchText: t.name,
    });
  });

  // Players
  (state.players_directory || []).forEach(p => {
    out.push({
      id: 'pl-' + p.id,
      type: 'player',
      icon: 'players',
      group: 'Players',
      title: p.name,
      subtitle: `${p.team_name}${p.shirt_number ? ' · #' + p.shirt_number : ''} · ${p.goals}g ${p.attended} apps`,
      tab: 'players',
      searchText: [p.name, p.nickname, p.team_name].filter(Boolean).join(' '),
    });
  });

  // Staff + refs
  (state.staff || []).forEach(s => {
    out.push({
      id: 'st-' + s.id,
      type: 'staff',
      icon: 'staff',
      group: 'Staff',
      title: s.name,
      subtitle: `${s.role}${s.notes ? ' · ' + s.notes : ''}`,
      tab: 'staff',
      searchText: [s.name, s.role, s.notes].filter(Boolean).join(' '),
    });
  });
  (window.DATA_refs || []).forEach(r => {
    out.push({
      id: 'rf-' + r.id,
      type: 'staff',
      icon: 'whistle',
      group: 'Officials',
      title: r.name,
      subtitle: `${r.employment_type.replace('_',' ')} · ★${r.overall_rating}${r.active ? '' : ' · retired'}`,
      tab: 'staff',
      searchText: r.name,
    });
  });

  // Pitches
  (window.DATA_pitches || []).forEach(p => {
    out.push({
      id: 'pt-' + p.id,
      type: 'pitch',
      icon: 'pitch',
      group: 'Pitches',
      title: p.name,
      subtitle: `${p.surface} · cap ${p.capacity}${!p.is_available && p.active ? ' · in maintenance' : ''}${!p.active ? ' · retired' : ''}`,
      tab: 'ops',
      searchText: p.name + ' ' + p.surface,
    });
  });

  return out;
}

function filterResults(index, q) {
  const search = q.toLowerCase().trim();
  if (!search) return index.slice(0, 40); // Show first batch when no query
  return index.filter(r => r.searchText.toLowerCase().includes(search)).slice(0, 60);
}

function groupResults(results) {
  const map = new Map();
  results.forEach(r => {
    if (!map.has(r.group)) map.set(r.group, []);
    map.get(r.group).push(r);
  });
  return [...map.entries()];
}

/* =========================================================
   NOTIFICATIONS PANEL — bell click
   ========================================================= */

function NotificationsPanel({ state, onClose, onNavigate }) {
  const notifications = useMemoTbo(() => buildNotifications(state), [state]);
  const STORAGE_KEY = 'iotools:notifs-seen';
  const [seen, setSeen] = useStateTbo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) { return new Set(); }
  });

  // Persist seen IDs whenever they change
  useEffectTbo(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
    } catch (e) { /* ignore */ }
  }, [seen]);

  const unread = notifications.filter(n => !seen.has(n.id));
  const read = notifications.filter(n => seen.has(n.id));

  // Close on outside click
  const ref = useRefTbo(null);
  useEffectTbo(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="notifs-panel" ref={ref}>
      <div className="notifs-head">
        <h3>Notifications</h3>
        {unread.length > 0 && <span className="pill pill-accent" style={{ height: 18 }}>{unread.length}</span>}
        <span style={{ flex: 1 }} />
        {unread.length > 0 && (
          <button className="btn btn-xs btn-ghost"
            onClick={() => setSeen(new Set(notifications.map(n => n.id)))}>
            Mark all read
          </button>
        )}
      </div>
      <div className="notifs-body">
        {notifications.length === 0 ? (
          <div className="notifs-empty">All clear — nothing needing attention.</div>
        ) : (
          <>
            {unread.length > 0 && (
              <div className="notifs-section">
                <div className="notifs-section-label">New</div>
                {unread.map(n => <NotifRow key={n.id} n={n}
                  onClick={() => { setSeen(prev => new Set([...prev, n.id])); onNavigate(n); onClose(); }}
                  onMarkRead={() => setSeen(prev => new Set([...prev, n.id]))} />)}
              </div>
            )}
            {read.length > 0 && (
              <div className="notifs-section">
                <div className="notifs-section-label">Earlier</div>
                {read.map(n => <NotifRow key={n.id} n={n} read
                  onClick={() => { onNavigate(n); onClose(); }} />)}
              </div>
            )}
          </>
        )}
      </div>
      <div className="notifs-foot">
        <button className="btn btn-xs btn-ghost">Notification settings</button>
      </div>
    </div>
  );
}

function NotifRow({ n, onClick, onMarkRead, read }) {
  return (
    <button className={'notif-row' + (read ? ' read' : '')} onClick={onClick}>
      <span className={'notif-ico notif-ico-' + n.tone}>
        <Icon name={n.icon} size={14} />
      </span>
      <span className="notif-text">
        <span className="notif-title">{n.title}</span>
        <span className="notif-sub">{n.subtitle}</span>
      </span>
      <span className="notif-time">{n.time}</span>
    </button>
  );
}

function buildNotifications(state) {
  const out = [];
  const tonightLive = (state.fixtures.tonight || []).filter(f => f.status === 'in_progress').length;
  const tonightUnassigned = (state.fixtures.tonight || []).filter(f => !f.playing_area_id || !f.official_id);

  // Critical: pitch 4 floodlights / open incidents
  (state.open_incidents || []).forEach(i => {
    out.push({
      id: 'inc-' + i.id,
      tone: i.severity === 'critical' ? 'crit' : i.severity === 'warning' ? 'warn' : 'info',
      icon: i.severity === 'info' ? 'info' : 'alert',
      title: i.description,
      subtitle: `Incident · ${i.severity}`,
      time: '12m',
      tab: 'ops',
    });
  });

  // Unassigned fixtures tonight
  tonightUnassigned.forEach(f => {
    const home = window.DATA_teams[f.home_team_id];
    const away = window.DATA_teams[f.away_team_id];
    if (!home || !away) return;
    out.push({
      id: 'unassigned-' + f.id,
      tone: 'warn',
      icon: 'alert',
      title: `${home.name} vs ${away.name} — ${!f.playing_area_id && !f.official_id ? 'needs pitch & ref' : !f.playing_area_id ? 'needs pitch' : 'needs ref'}`,
      subtitle: `Kickoff ${f.kickoff_time} tonight`,
      time: '30m',
      tab: 'ops',
    });
  });

  // Pending registrations
  (state.pending_registrations || []).forEach(r => {
    out.push({
      id: 'reg-' + r.id,
      tone: 'info',
      icon: 'info',
      title: `${r.team_name} wants to register`,
      subtitle: 'Pending team registration · awaiting approval',
      time: '1h',
      tab: 'ops',
    });
  });

  // Pending bookings (first 3)
  (state.pending_bookings || []).slice(0, 3).forEach(b => {
    out.push({
      id: 'bkreq-' + b.id,
      tone: 'info',
      icon: 'bookings',
      title: `New booking request from ${b.booker_name}${b.booker_org ? ' (' + b.booker_org + ')' : ''}`,
      subtitle: `${b.kind === 'weekly' ? `Weekly · ${b.weeks} wks` : 'One-off'} · ${b.pitch_name.replace(/ \(.*\)/, '')}`,
      time: '2h',
      tab: 'bookings',
    });
  });

  // Recent cancellations today
  const today = new Date('2026-06-08').toDateString();
  (window.DATA_cancellations || []).filter(c => new Date(c.cancelled_at).toDateString() === today)
    .forEach(c => {
      out.push({
        id: 'cn-' + c.id,
        tone: 'mute',
        icon: 'x',
        title: `Cancelled: ${c.booker_name}`,
        subtitle: `${c.reason} · ${c.decision === 'full' ? `£${(c.refund_pence/100).toFixed(2)} refund` : c.decision === 'partial' ? '50% credit' : 'no refund'}`,
        time: window.relativeFrom(c.cancelled_at),
        tab: 'bookings',
      });
    });

  // Dormant/low-ins customers
  (state.customers || []).filter(c => c.nudge_status === 'dormant' || c.nudge_status === 'low_ins')
    .forEach(c => {
      out.push({
        id: 'cu-' + c.id,
        tone: c.nudge_status === 'dormant' ? 'warn' : 'info',
        icon: 'customers',
        title: c.nudge_status === 'dormant' ? `${c.name} hasn't booked in a while` : `${c.name} is short on ins`,
        subtitle: c.nudge_status === 'dormant'
          ? `Last active ${window.relativeFrom(c.last_active_at)} · consider a nudge`
          : `Avg ${c.avg_ins?.toFixed(1)} / ${c.target_ins} ins · consider nudging`,
        time: '4h',
        tab: 'customers',
      });
    });

  return out;
}

Object.assign(window, { SearchPalette, NotificationsPanel });
