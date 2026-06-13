/* Customers — bookers (groups + individuals) that use the In or Out app
   to confirm "ins". Distinct from registered competition teams. */

const DATA_customers = [
  {
    id: 'cu1', name: 'Brewmasters FC', kind: 'group',
    primary_colour: '#7E1F2A', secondary_colour: '#E6D9B8',
    last_active_at: '2026-06-08T11:15', joined_at: '2025-09-12',
    notes: 'Reserves training block — same Tuesday slot for 4 weeks.',
    preferred_pitch_id: 'p1',
    bookings_count: 14, total_spend_pence: 63000,
    avg_ins: 9.4, target_ins: 12,
    nudge_status: 'healthy',
    app_users: [
      { id: 'au1', name: 'Sara Lindqvist', role: 'admin', phone: '+44 7700 905512', email: 'sara@brewmasters.fc', whatsapp: '+44 7700 905512', preferred_channel: 'whatsapp', avatar_initials: 'SL' },
      { id: 'au2', name: 'Niels Hove',     role: 'vc',    phone: '+44 7700 905513', email: 'niels@brewmasters.fc', whatsapp: '+44 7700 905513', preferred_channel: 'whatsapp', avatar_initials: 'NH' },
    ],
    upcoming: [
      { id: 'b1', date: '2026-06-16', time: '20:00', pitch_name: 'Pitch 1 (North)', duration_min: 60,
        source: 'casual', status: 'confirmed', ins: 8,  needed: 12 },
      { id: 'b2', date: '2026-06-23', time: '20:00', pitch_name: 'Pitch 1 (North)', duration_min: 60,
        source: 'casual', status: 'confirmed', ins: 3,  needed: 12 },
      { id: 'b3', date: '2026-06-30', time: '20:00', pitch_name: 'Pitch 1 (North)', duration_min: 60,
        source: 'casual', status: 'confirmed', ins: 0,  needed: 12 },
    ],
    recent: [
      { id: 'b4', date: '2026-06-02', pitch_name: 'Pitch 1 (North)', source: 'casual', status: 'completed', ins: 11, needed: 12 },
      { id: 'b5', date: '2026-05-26', pitch_name: 'Pitch 1 (North)', source: 'casual', status: 'completed', ins: 10, needed: 12 },
      { id: 'b6', date: '2026-05-19', pitch_name: 'Pitch 1 (North)', source: 'casual', status: 'completed', ins: 9,  needed: 12 },
    ],
  },
  {
    id: 'cu2', name: 'Carter & Co', kind: 'group',
    primary_colour: '#28394A', secondary_colour: '#C9B98A',
    last_active_at: '2026-06-08T09:48', joined_at: '2026-02-04',
    notes: 'Corporate. Light catering if available.',
    preferred_pitch_id: 'p2',
    bookings_count: 5, total_spend_pence: 30000,
    avg_ins: 11.0, target_ins: 14,
    nudge_status: 'healthy',
    app_users: [
      { id: 'au3', name: 'Daniel Park',  role: 'admin', phone: '+44 7700 902112', email: 'd.park@carterco.co.uk', whatsapp: '', preferred_channel: 'email', avatar_initials: 'DP' },
      { id: 'au4', name: 'Jess Holloway', role: 'vc',   phone: '+44 7700 902113', email: 'j.holloway@carterco.co.uk', whatsapp: '+44 7700 902113', preferred_channel: 'whatsapp', avatar_initials: 'JH' },
    ],
    upcoming: [
      { id: 'b7', date: '2026-06-12', time: '21:00', pitch_name: 'Pitch 2 (Centre)', duration_min: 60,
        source: 'casual', status: 'requested', ins: 10, needed: 14 },
    ],
    recent: [
      { id: 'b8', date: '2026-05-30', pitch_name: 'Pitch 2 (Centre)', source: 'casual', status: 'completed', ins: 12, needed: 14 },
      { id: 'b9', date: '2026-05-09', pitch_name: 'Pitch 2 (Centre)', source: 'casual', status: 'completed', ins: 11, needed: 14 },
    ],
  },
  {
    id: 'cu3', name: 'Sunday League 5-a-side', kind: 'group',
    primary_colour: '#0F7B5A', secondary_colour: '#F4F1E8',
    last_active_at: '2026-06-07T18:20', joined_at: '2025-11-03',
    notes: 'Paid up front for 6 weeks. Cheers.',
    preferred_pitch_id: 'p3',
    bookings_count: 22, total_spend_pence: 99000,
    avg_ins: 7.8, target_ins: 10,
    nudge_status: 'low_ins',
    app_users: [
      { id: 'au5', name: 'James Okonkwo', role: 'admin', phone: '+44 7700 902341', email: 'james.ok@example.com', whatsapp: '+44 7700 902341', preferred_channel: 'whatsapp', avatar_initials: 'JO' },
    ],
    upcoming: [
      { id: 'b10', date: '2026-06-15', time: '19:00', pitch_name: 'Pitch 3 (South)', duration_min: 60,
        source: 'casual', status: 'requested', ins: 4, needed: 10 },
      { id: 'b11', date: '2026-06-22', time: '19:00', pitch_name: 'Pitch 3 (South)', duration_min: 60,
        source: 'casual', status: 'requested', ins: 2, needed: 10 },
    ],
    recent: [
      { id: 'b12', date: '2026-06-01', pitch_name: 'Pitch 3 (South)', source: 'casual', status: 'completed', ins: 6, needed: 10 },
      { id: 'b13', date: '2026-05-25', pitch_name: 'Pitch 3 (South)', source: 'casual', status: 'completed', ins: 7, needed: 10 },
      { id: 'b14', date: '2026-05-18', pitch_name: 'Pitch 3 (South)', source: 'casual', status: 'completed', ins: 8, needed: 10 },
    ],
  },
  {
    id: 'cu4', name: 'Hannah Williams', kind: 'individual',
    primary_colour: '#B23A48', secondary_colour: '#F7D38C',
    last_active_at: '2026-06-08T11:42', joined_at: '2026-05-20',
    notes: '',
    preferred_pitch_id: null,
    bookings_count: 3, total_spend_pence: 13500,
    avg_ins: null, target_ins: null,
    nudge_status: 'new',
    app_users: [
      { id: 'au6', name: 'Hannah Williams', role: 'admin', phone: '+44 7700 902798', email: 'hwilliams@example.com', whatsapp: '', preferred_channel: 'phone', avatar_initials: 'HW' },
    ],
    upcoming: [
      { id: 'b15', date: '2026-06-09', time: '18:30', pitch_name: 'Pitch 1 (North)', duration_min: 90,
        source: 'casual', status: 'requested', ins: 1, needed: null },
    ],
    recent: [
      { id: 'b16', date: '2026-05-23', pitch_name: 'Pitch 4 (Indoor)', source: 'casual', status: 'completed', ins: 1, needed: null },
      { id: 'b17', date: '2026-05-09', pitch_name: 'Pitch 1 (North)', source: 'casual', status: 'completed', ins: 1, needed: null },
    ],
  },
  {
    id: 'cu5', name: 'Greenway U14s', kind: 'group',
    primary_colour: '#1E5BAA', secondary_colour: '#F4D03F',
    last_active_at: '2026-06-08T09:15', joined_at: '2025-08-19',
    notes: 'Academy team — pre-season training. Booked via Coach Bennett.',
    preferred_pitch_id: 'p1',
    bookings_count: 31, total_spend_pence: 186000,
    avg_ins: 16.2, target_ins: 18,
    nudge_status: 'healthy',
    app_users: [
      { id: 'au7', name: 'Coach Bennett', role: 'admin', phone: '+44 7700 908834', email: 'bennett@gwu14.org', whatsapp: '+44 7700 908834', preferred_channel: 'whatsapp', avatar_initials: 'CB' },
      { id: 'au8', name: 'Amir Khalil',   role: 'vc',    phone: '+44 7700 908835', email: 'amir@gwu14.org', whatsapp: '+44 7700 908835', preferred_channel: 'whatsapp', avatar_initials: 'AK' },
      { id: 'au9', name: 'Toby Rowe',     role: 'vc',    phone: '+44 7700 908836', email: 'toby@gwu14.org', whatsapp: '', preferred_channel: 'phone', avatar_initials: 'TR' },
    ],
    upcoming: [
      { id: 'b18', date: '2026-06-18', time: '18:30', pitch_name: 'Pitch 1 (North)', duration_min: 90,
        source: 'casual', status: 'requested', ins: 14, needed: 18 },
      { id: 'b19', date: '2026-06-25', time: '18:30', pitch_name: 'Pitch 1 (North)', duration_min: 90,
        source: 'casual', status: 'requested', ins: 12, needed: 18 },
    ],
    recent: [
      { id: 'b20', date: '2026-06-04', pitch_name: 'Pitch 1 (North)', source: 'casual', status: 'completed', ins: 17, needed: 18 },
      { id: 'b21', date: '2026-05-28', pitch_name: 'Pitch 1 (North)', source: 'casual', status: 'completed', ins: 16, needed: 18 },
    ],
  },
  {
    id: 'cu6', name: 'Northside Athletic', kind: 'group',
    primary_colour: '#1E5BAA', secondary_colour: '#F4D03F',
    last_active_at: '2026-06-08T19:30', joined_at: '2025-03-10',
    notes: 'Competition team — GPL Division 1. Also books extra training.',
    preferred_pitch_id: 'p1',
    bookings_count: 38, total_spend_pence: 171000,
    avg_ins: 8.5, target_ins: 9,
    nudge_status: 'healthy',
    linked_team_id: 't1',
    app_users: [
      { id: 'au10', name: 'Eli Bautista', role: 'admin', phone: '+44 7700 911011', email: 'eli@northside.fc', whatsapp: '+44 7700 911011', preferred_channel: 'whatsapp', avatar_initials: 'EB' },
      { id: 'au11', name: 'Tariq Ahmed',  role: 'vc',    phone: '+44 7700 911012', email: 'tariq@northside.fc', whatsapp: '+44 7700 911012', preferred_channel: 'whatsapp', avatar_initials: 'TA' },
    ],
    upcoming: [
      { id: 'b22', date: '2026-06-08', time: '19:30', pitch_name: 'Pitch 1 (North)', duration_min: 60,
        source: 'league_fixture', status: 'in_progress', ins: 9, needed: 9,
        opponent: 'Eastpark United', league: 'GPL Division 1', round_name: 'Round 12' },
      { id: 'b23', date: '2026-06-10', time: '19:30', pitch_name: 'Pitch 2 (Centre)', duration_min: 60,
        source: 'league_fixture', status: 'confirmed', ins: 7, needed: 9,
        opponent: 'Highbridge FC', league: 'GPL Division 1', round_name: 'Round 13' },
      { id: 'b24', date: '2026-06-15', time: '20:00', pitch_name: 'Pitch 1 (North)', duration_min: 60,
        source: 'casual', status: 'confirmed', ins: 6, needed: 9 },
    ],
    recent: [
      { id: 'b25', date: '2026-06-04', pitch_name: 'Pitch 1 (North)', source: 'league_fixture', status: 'completed',
        ins: 9, needed: 9, opponent: 'Eastpark United', score: '3–3', round_name: 'Round 11' },
      { id: 'b26', date: '2026-05-28', pitch_name: 'Pitch 1 (North)', source: 'league_fixture', status: 'completed',
        ins: 9, needed: 9, opponent: 'Brockley Rovers', score: '2–1', round_name: 'Round 10' },
    ],
  },
  {
    id: 'cu7', name: 'Marsh Lane Crusaders', kind: 'group',
    primary_colour: '#28394A', secondary_colour: '#C9B98A',
    last_active_at: '2026-05-12T08:00', joined_at: '2025-03-10',
    notes: 'Used to book weekly Mondays. Not booked in 4 weeks.',
    preferred_pitch_id: 'p3',
    bookings_count: 18, total_spend_pence: 81000,
    avg_ins: 6.4, target_ins: 9,
    nudge_status: 'dormant',
    linked_team_id: 't6',
    app_users: [
      { id: 'au12', name: 'Marco Vitelli', role: 'admin', phone: '+44 7700 912340', email: 'marco@example.com', whatsapp: '+44 7700 912340', preferred_channel: 'whatsapp', avatar_initials: 'MV' },
    ],
    upcoming: [],
    recent: [
      { id: 'b27', date: '2026-05-12', pitch_name: 'Pitch 3 (South)', source: 'casual', status: 'completed', ins: 7, needed: 9 },
      { id: 'b28', date: '2026-05-05', pitch_name: 'Pitch 3 (South)', source: 'casual', status: 'completed', ins: 6, needed: 9 },
    ],
  },
  {
    id: 'cu8', name: 'Heidelberg Old Boys', kind: 'group',
    primary_colour: '#E08B1F', secondary_colour: '#2A2A2E',
    last_active_at: '2026-05-30T14:20', joined_at: '2026-05-30',
    notes: 'Annual reunion match — flying over from Berlin.',
    preferred_pitch_id: 'p2',
    bookings_count: 1, total_spend_pence: 6000,
    avg_ins: null, target_ins: 14,
    nudge_status: 'new',
    app_users: [
      { id: 'au13', name: 'Marco Fischer', role: 'admin', phone: '+44 7700 910056', email: 'marco@heidelbergob.com', whatsapp: '', preferred_channel: 'email', avatar_initials: 'MF' },
    ],
    upcoming: [
      { id: 'b29', date: '2026-06-21', time: '19:30', pitch_name: 'Pitch 2 (Centre)', duration_min: 60,
        source: 'casual', status: 'requested', ins: 6, needed: 14 },
    ],
    recent: [],
  },
];

Object.assign(window, { DATA_customers });

/* ========================================================== */

const { useState: useStateCu, useMemo: useMemoCu, useEffect: useEffectCu } = React;
const Icon = (props) => window.Icon ? React.createElement(window.Icon, props) : null;

function Customers({ state }) {
  const [q, setQ] = useStateCu('');
  const [kindFilter, setKindFilter] = useStateCu('all');
  const [statusFilter, setStatusFilter] = useStateCu('all');
  const [openCustomer, setOpenCustomer] = useStateCu(null);
  const customers = state.customers || [];

  // Listen for "nudge dormant" trigger from Topbar — open first dormant customer's detail + auto-nudge
  useEffectCu(() => {
    const open = () => {
      const dormant = customers.find(c => c.nudge_status === 'dormant');
      if (dormant) {
        setStatusFilter('dormant');
        setOpenCustomer({ ...dormant, _autoNudge: true });
      }
    };
    window.addEventListener('iotools:open-dormant-nudge', open);
    return () => window.removeEventListener('iotools:open-dormant-nudge', open);
  }, [customers]);

  const filtered = useMemoCu(() => {
    const search = q.toLowerCase().trim();
    return customers.filter(c => {
      if (kindFilter !== 'all' && c.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && c.nudge_status !== statusFilter) return false;
      if (search) {
        const hay = [c.name, ...c.app_users.map(u => u.name), c.notes]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [q, kindFilter, statusFilter, customers]);

  const dormant = customers.filter(c => c.nudge_status === 'dormant').length;
  const lowIns  = customers.filter(c => c.nudge_status === 'low_ins').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--gap-2)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.015em' }}>
          {customers.length} customers <span className="text-mute" style={{ fontWeight: 400, fontSize: 14, marginLeft: 6 }}>
            using the In or Out app
          </span>
        </h2>
        <span style={{ flex: 1 }} />
        {(dormant > 0 || lowIns > 0) && (
          <span className="pill pill-warn">
            <span className="pill-dot" />
            {dormant} dormant · {lowIns} low ins
          </span>
        )}
        <button className="btn btn-sm">
          <Icon name="plus" size={14} /> Invite customer
        </button>
      </div>

      <div className="cancel-toolbar">
        <div className="search" style={{ flex: 1, minWidth: 220 }}>
          <span className="ico"><Icon name="search" size={14} /></span>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search customers, admins or VCs…" />
        </div>
        <div className="chips">
          {[['all','All'],['group','Groups'],['individual','Individuals']].map(([k,l]) => (
            <button key={k} className="chip" aria-pressed={kindFilter === k}
              onClick={() => setKindFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="chips">
          {[['all','Any status'],['healthy','Healthy'],['low_ins','Low ins'],['dormant','Dormant'],['new','New']].map(([k,l]) => (
            <button key={k} className="chip" aria-pressed={statusFilter === k}
              onClick={() => setStatusFilter(k)}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No customers match" body="Try clearing some filters." />
      ) : (
        <div className="customers-grid">
          {filtered.map(c => (
            <CustomerCard key={c.id} c={c} onClick={() => setOpenCustomer(c)} />
          ))}
        </div>
      )}

      {openCustomer && (
        <CustomerDetailModal customer={openCustomer} onClose={() => setOpenCustomer(null)} />
      )}
    </div>
  );
}

function CustomerCard({ c, onClick }) {
  const inFill = c.target_ins ? Math.min(100, (c.avg_ins / c.target_ins) * 100) : 0;
  const statusPill = {
    healthy: { cls: 'pill-ok',   label: 'Healthy' },
    low_ins: { cls: 'pill-warn', label: 'Low ins' },
    dormant: { cls: 'pill-muted',label: 'Dormant' },
    new:     { cls: 'pill-info', label: 'New' },
  }[c.nudge_status] || { cls: 'pill-muted', label: c.nudge_status };

  return (
    <button className="customer-card" onClick={onClick}>
      <div className="cu-top">
        <div className="cu-crest"
          style={{ background: `linear-gradient(135deg, ${c.primary_colour} 0 50%, ${c.secondary_colour} 50% 100%)` }}>
          <span>{getInitials(c.name)}</span>
        </div>
        <div className="cu-head-text" style={{ minWidth: 0 }}>
          <div className="cu-name">{c.name}</div>
          <div className="cu-sub">
            {c.kind === 'group' ? `${c.app_users.length} ${c.app_users.length === 1 ? 'admin' : 'admins/VCs'}` : 'Individual booker'}
            {c.linked_team_id && <span style={{ marginLeft: 6 }}>· league team</span>}
          </div>
        </div>
        <span className={'pill ' + statusPill.cls}>
          <span className="pill-dot" /> {statusPill.label}
        </span>
      </div>

      <div className="cu-stats">
        <div className="cu-stat">
          <div className="cu-stat-label">Bookings</div>
          <div className="cu-stat-value">{c.bookings_count}</div>
        </div>
        <div className="cu-stat">
          <div className="cu-stat-label">Avg ins</div>
          <div className="cu-stat-value">{c.avg_ins == null ? '—' : c.avg_ins.toFixed(1)}{c.target_ins && <span className="cu-stat-of">/{c.target_ins}</span>}</div>
          {c.target_ins && (
            <div className="bar" style={{ marginTop: 6, height: 4 }}>
              <div className="bar-fill" style={{
                width: inFill + '%',
                background: inFill < 60 ? 'var(--warn)' : inFill < 85 ? 'var(--accent)' : 'var(--ok)'
              }} />
            </div>
          )}
        </div>
        <div className="cu-stat">
          <div className="cu-stat-label">Total spend</div>
          <div className="cu-stat-value">£{(c.total_spend_pence/100).toFixed(0)}</div>
        </div>
      </div>

      <div className="cu-foot">
        <div className="cu-avatars">
          {c.app_users.slice(0, 3).map(u => (
            <span key={u.id} className="cu-avatar" title={`${u.name} · ${u.role}`}>
              {u.avatar_initials}
            </span>
          ))}
          {c.app_users.length > 3 && (
            <span className="cu-avatar more">+{c.app_users.length - 3}</span>
          )}
        </div>
        <span className="text-mute" style={{ fontSize: 11, marginLeft: 'auto' }}>
          Active {window.relativeFrom(c.last_active_at)}
        </span>
      </div>
    </button>
  );
}

function CustomerDetailModal({ customer: c, onClose }) {
  const [showNudge, setShowNudge] = useStateCu(c._autoNudge || false);
  const admin = c.app_users.find(u => u.role === 'admin') || c.app_users[0];
  const channelLabel = { whatsapp: 'WhatsApp', phone: 'Phone', email: 'Email' }[admin?.preferred_channel] || 'channel';

  return (
    <Modal title="Customer" onClose={onClose} xwide
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <span className="spacer" />
          <button className="btn">
            <Icon name="plus" size={14} /> New booking
          </button>
          <button className="btn btn-primary" onClick={() => setShowNudge(true)}>
            Nudge via {channelLabel}
          </button>
        </>
      }>
      {showNudge && <NudgePreviewModal customer={c} onClose={() => setShowNudge(false)} />}

      <div className="cu-detail-head">
        <div className="cu-crest cu-crest-xl"
          style={{ background: `linear-gradient(135deg, ${c.primary_colour} 0 50%, ${c.secondary_colour} 50% 100%)` }}>
          <span>{getInitials(c.name)}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cu-detail-name">{c.name}</div>
          <div className="cu-detail-sub">
            {c.kind === 'group' ? 'Group · ' : 'Individual · '}
            joined {new Date(c.joined_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
            {' · '}active {window.relativeFrom(c.last_active_at)}
          </div>
          {c.notes && <div className="cu-detail-notes">{c.notes}</div>}
        </div>
        <div className="cu-detail-stats">
          <div className="cu-stat">
            <div className="cu-stat-label">Bookings</div>
            <div className="cu-stat-value">{c.bookings_count}</div>
          </div>
          <div className="cu-stat">
            <div className="cu-stat-label">Total spend</div>
            <div className="cu-stat-value">£{(c.total_spend_pence/100).toFixed(0)}</div>
          </div>
          <div className="cu-stat">
            <div className="cu-stat-label">Avg ins</div>
            <div className="cu-stat-value">{c.avg_ins == null ? '—' : c.avg_ins.toFixed(1)}{c.target_ins && <span className="cu-stat-of">/{c.target_ins}</span>}</div>
          </div>
        </div>
      </div>

      <div className="cu-tabs">
        <SectionHead label="App admins & VCs" />
        <div className="cu-users-grid">
          {c.app_users.map(u => (
            <div key={u.id} className="cu-user">
              <div className="cu-user-avatar">{u.avatar_initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cu-user-name">{u.name}</div>
                <div className="cu-user-role">
                  <span className={'pill ' + (u.role === 'admin' ? 'pill-accent' : 'pill-muted')} style={{ height: 18 }}>
                    {u.role === 'admin' ? 'Admin' : 'VC'}
                  </span>
                  <span style={{ marginLeft: 8 }}>{channelOf(u)}</span>
                </div>
              </div>
              <div className="cu-user-contact">
                {u.preferred_channel === 'whatsapp' && <button className="btn btn-xs btn-icon btn-ghost"><Icon name="whatsapp" size={13} /></button>}
                {u.preferred_channel === 'phone' && <button className="btn btn-xs btn-icon btn-ghost"><Icon name="phone" size={13} /></button>}
                {u.preferred_channel === 'email' && <button className="btn btn-xs btn-icon btn-ghost"><Icon name="mail" size={13} /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionHead label="Upcoming bookings" count={c.upcoming.length} />
        {c.upcoming.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <h3>No upcoming bookings</h3>
            <p>Nudge them to book a regular slot.</p>
          </div>
        ) : (
          <div className="cu-bookings">
            {c.upcoming.map(b => <BookingRow key={b.id} b={b} />)}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionHead label="Recent" count={c.recent.length} />
        {c.recent.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <h3>No history yet</h3>
            <p>Past bookings will appear here.</p>
          </div>
        ) : (
          <div className="cu-bookings cu-bookings--past">
            {c.recent.map(b => <BookingRow key={b.id} b={b} past />)}
          </div>
        )}
      </div>
    </Modal>
  );
}

function channelOf(u) {
  if (u.preferred_channel === 'whatsapp') return u.whatsapp || u.phone || '';
  if (u.preferred_channel === 'email') return u.email || '';
  return u.phone || '';
}

function BookingRow({ b, past = false }) {
  const insFill = b.needed ? Math.min(100, (b.ins / b.needed) * 100) : 100;
  const insStatusTone = !b.needed ? '' : insFill >= 100 ? 'ok' : insFill >= 60 ? 'warn' : 'crit';
  const statusPillCls = {
    in_progress: 'pill-live',
    confirmed:   'pill-ok',
    requested:   'pill-warn',
    completed:   'pill-muted',
    cancelled:   'pill-muted',
  }[b.status] || 'pill-muted';

  return (
    <div className={'cu-booking' + (past ? ' past' : '')}>
      <div className="cb-when">
        <div className="cb-date">{new Date(b.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        {b.time && <div className="cb-time">{b.time}{b.duration_min ? ` · ${b.duration_min}m` : ''}</div>}
      </div>

      <div className="cb-where">
        <div className="cb-pitch"><Icon name="pitch" size={12} /> {b.pitch_name.replace(/ \(.*\)/, '')}</div>
        <div className="cb-source">
          {b.source === 'league_fixture'
            ? <span className="pill pill-accent">League · {b.round_name}</span>
            : <span className="pill pill-muted">Casual</span>}
        </div>
      </div>

      <div className="cb-content">
        {b.source === 'league_fixture' && b.opponent && (
          <div className="cb-matchup">
            vs <strong>{b.opponent}</strong>{b.score && <span className="cb-score"> {b.score}</span>}
          </div>
        )}
        {(!b.opponent || b.source !== 'league_fixture') && (
          <div className="cb-matchup text-mute">Pitch booking</div>
        )}
      </div>

      <div className="cb-ins">
        <div className="cb-ins-label">
          <strong>{b.ins}</strong>{b.needed ? <span className="text-mute"> / {b.needed} ins</span> : <span className="text-mute"> in</span>}
        </div>
        {b.needed && (
          <div className="bar" style={{ height: 4, marginTop: 6, width: 100 }}>
            <div className="bar-fill" style={{
              width: insFill + '%',
              background: insStatusTone === 'ok' ? 'var(--ok)' : insStatusTone === 'warn' ? 'var(--warn)' : 'var(--live)'
            }} />
          </div>
        )}
      </div>

      <div className="cb-status">
        <span className={'pill ' + statusPillCls}>
          {b.status === 'in_progress' && <span className="pill-dot" />}
          {b.status.replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}

function NudgePreviewModal({ customer: c, onClose }) {
  const admin = c.app_users.find(u => u.role === 'admin') || c.app_users[0];
  const channelLabel = { whatsapp: 'WhatsApp', phone: 'Call', email: 'Email' }[admin?.preferred_channel];

  const TEMPLATES = c.nudge_status === 'dormant' ? [
    { id: 'come_back', label: 'Win them back', body: `Hey ${admin.name.split(' ')[0]}, it's been a while since you booked with us at Greenway. We've got our regular Monday evening slot still open if you fancy it — want me to lock in your usual?` },
    { id: 'discount', label: 'Discount offer', body: `Hi ${admin.name.split(' ')[0]} — we'd love to have ${c.name} back. Book any night this week and we'll knock 20% off. Reply YES and I'll set it up.` },
  ] : c.nudge_status === 'low_ins' ? [
    { id: 'low_ins', label: 'Heads up on ins', body: `Hi ${admin.name.split(' ')[0]}, just spotted you're a bit short on confirmed ins for ${c.upcoming[0]?.date}. Want us to delay confirming until you hit your number, or shall we hold the pitch as-is?` },
    { id: 'cancel_option', label: 'Offer to release', body: `Hi ${admin.name.split(' ')[0]}, no pressure either way — if you'd rather drop the booking on ${c.upcoming[0]?.date} we can give you a full credit (still within policy). Let me know.` },
  ] : c.nudge_status === 'new' ? [
    { id: 'welcome', label: 'Welcome', body: `Hi ${admin.name.split(' ')[0]} — welcome to Greenway. Anything we can do to make your booking on ${c.upcoming[0]?.date || 'the day'} go smoothly? Cones, bibs, water, etc.` },
  ] : [
    { id: 'check_in', label: 'Friendly check-in', body: `Hi ${admin.name.split(' ')[0]} — hope ${c.name} is going well. Anything you need from us for upcoming sessions?` },
    { id: 'regular_slot', label: 'Offer regular slot', body: `Hi ${admin.name.split(' ')[0]}, you've been booking the same time pretty often. Want me to set up a recurring weekly block so you can stop manually rebooking?` },
  ];

  const [template, setTemplate] = useStateCu(TEMPLATES[0].id);
  const [body, setBody] = useStateCu(TEMPLATES[0].body);

  const pickTemplate = (t) => { setTemplate(t.id); setBody(t.body); };

  return (
    <Modal title={`Nudge ${c.name}`} onClose={onClose} wide
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Send via {channelLabel}
          </button>
        </>
      }>
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label className="field-label">Recipient</label>
          <div className="cu-user" style={{ background: 'var(--bg-3)' }}>
            <div className="cu-user-avatar">{admin.avatar_initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cu-user-name">{admin.name}</div>
              <div className="cu-user-role">
                <span className="pill pill-accent" style={{ height: 18 }}>Admin</span>
                <span style={{ marginLeft: 8 }}>{channelOf(admin)}</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="field-label">Template</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TEMPLATES.map(t => (
              <button key={t.id} className="btn btn-sm"
                onClick={() => pickTemplate(t)}
                style={{
                  borderColor: template === t.id ? 'var(--accent)' : 'var(--border)',
                  background: template === t.id ? 'var(--accent-soft)' : 'var(--bg-3)',
                  color: template === t.id ? 'var(--accent)' : 'var(--ink)',
                }}>{t.label}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="field-label">Message preview <span className="text-mute" style={{ marginLeft: 8, fontWeight: 400 }}>· will send via {channelLabel}</span></label>
          <textarea className="input" value={body} onChange={e => setBody(e.target.value)}
            style={{ minHeight: 140 }} />
        </div>

        <label className="toggle">
          <input type="checkbox" defaultChecked />
          <span className="track" />
          <span style={{ fontSize: 13 }}>Log nudge in customer history</span>
        </label>
      </div>
    </Modal>
  );
}

Object.assign(window, { Customers });
