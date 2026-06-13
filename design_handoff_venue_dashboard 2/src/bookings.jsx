/* Bookings — requests inbox + multi-pitch schedule grid */

const { useState: useStateBk, useMemo, useEffect: useEffectBk } = React;

const Icon = (props) => window.Icon ? React.createElement(window.Icon, props) : null;

function Bookings({ state }) {
  const [date, setDate] = useStateBk(new Date('2026-06-08'));
  const [walkin, setWalkin] = useStateBk(null);
  const [bookingDetail, setBookingDetail] = useStateBk(null);
  const [showSettings, setShowSettings] = useStateBk(false);
  const [showAllRequests, setShowAllRequests] = useStateBk(false);

  // Listen for "Add booking" trigger from Topbar
  useEffectBk(() => {
    const open = () => setWalkin({
      pitchId: window.DATA_pitches.find(p => p.active)?.id,
      time: '19:00',
    });
    window.addEventListener('iotools:add-booking', open);
    return () => window.removeEventListener('iotools:add-booking', open);
  }, []);

  const enabled = state.venue.bookings_enabled;
  const activePitches = window.DATA_pitches.filter(p => p.active);
  const occ = state.occupancy || [];
  const requests = state.pending_bookings || [];

  // Max 2 rows visible. At desktop ~4 columns = 8 cards shown.
  const PREVIEW_COUNT = 8;
  const visibleRequests = showAllRequests ? requests : requests.slice(0, PREVIEW_COUNT);
  const hiddenCount = requests.length - visibleRequests.length;

  const fmt = (d) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const isToday = (d) => d.toISOString().slice(0,10) === '2026-06-08';

  return (
    <div>
      {!enabled && (
        <div className="banner banner-warn">
          <strong>Bookings are off.</strong> No-one outside the venue can request a pitch.
          <span className="spacer" />
          <button className="btn btn-sm btn-primary">Turn on bookings</button>
        </div>
      )}

      <section style={{ marginBottom: 'var(--gap-3)' }}>
        <SectionHead label="Requests" count={requests.length}>
          {requests.length > PREVIEW_COUNT && !showAllRequests && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowAllRequests(true)}>
              View {hiddenCount} more
            </button>
          )}
          {showAllRequests && requests.length > PREVIEW_COUNT && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowAllRequests(false)}>
              Show less
            </button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={14} /> Settings
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setWalkin({ pitchId: window.DATA_pitches.find(p => p.active)?.id, time: '19:00' })}>
            <Icon name="plus" size={14} /> Add booking
          </button>
        </SectionHead>
        {requests.length === 0 ? (
          <div className="empty"><h3>The queue is clear.</h3><p>New requests will arrive here.</p></div>
        ) : (
          <div className="req-grid">
            {visibleRequests.map(r => {
              const startD = new Date(r.start);
              const ts = startD.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
              const dt = startD.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
              const channelLabel = { whatsapp: 'WhatsApp', phone: 'Phone', email: 'Email' }[r.preferred_channel] || r.preferred_channel;
              const channelValue = r.preferred_channel === 'email' ? r.booker_email : r.booker_phone;
              return (
                <div className="req-card" key={r.id}>
                  <div className="req-top">
                    <span className="req-label">
                      {r.kind === 'weekly' ? `Weekly · ${r.weeks} wks` : 'One-off'}
                    </span>
                    <span className="req-pitch">
                      <Icon name="pitch" size={12} /> {r.pitch_name.replace(/ \(.*\)/, '')}
                    </span>
                  </div>
                  <div className="req-booker">
                    <div className="avatar">{getInitials(r.booker_name)}</div>
                    <div className="req-booker-text">
                      <div className="bname">{r.booker_name}</div>
                      {r.booker_org && <div className="borg">{r.booker_org}</div>}
                    </div>
                  </div>
                  <div className="req-when">
                    <Icon name="clock" size={12} />
                    <span><strong>{dt}</strong> · {ts} · {r.duration_min}m</span>
                  </div>
                  {r.message && (
                    <div className="req-note">"{r.message}"</div>
                  )}
                  <div className="req-actions">
                    <button className="btn btn-sm btn-primary">Confirm</button>
                    <button className="btn btn-sm">Decline</button>
                    <a className="btn btn-sm btn-icon btn-ghost" title={`${channelLabel}: ${channelValue}`}>
                      <Icon name={r.preferred_channel === 'email' ? 'mail' : r.preferred_channel === 'whatsapp' ? 'whatsapp' : 'phone'} size={14} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionHead label="Schedule">
          <button className="btn btn-sm" onClick={() => setDate(new Date('2026-06-08'))} disabled={isToday(date)}>
            Jump to today
          </button>
        </SectionHead>
        <div className="schedule">
          <div className="schedule-head">
            <button className="btn btn-xs" onClick={() => {
              const d = new Date(date); d.setDate(d.getDate() - 1); setDate(d);
            }}>‹</button>
            <span className="date">{fmt(date)}</span>
            <button className="btn btn-xs" onClick={() => {
              const d = new Date(date); d.setDate(d.getDate() + 1); setDate(d);
            }}>›</button>
            <span style={{ flex: 1 }} />
            <span className="label-xs">17:00 – 23:00</span>
          </div>
            <ScheduleGrid pitches={activePitches} occupancy={occ}
              onEmptyClick={(p, time) => setWalkin({ pitchId: p.id, time })}
              onBlockClick={(o) => o.source_kind === 'booking' && setBookingDetail(o)}
            />
        </div>
      </section>

      <CancellationsSection cancellations={window.DATA_cancellations || []} />

      {walkin && <WalkinModal walkin={walkin} onClose={() => setWalkin(null)} />}
      {bookingDetail && <BookingDetailModal booking={bookingDetail} onClose={() => setBookingDetail(null)} />}
      {showSettings && <BookingSettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function CancellationsSection({ cancellations }) {
  const [q, setQ] = useStateBk('');
  const [pitchFilter, setPitchFilter] = useStateBk('all');
  const [decisionFilter, setDecisionFilter] = useStateBk('all');
  const [period, setPeriod] = useStateBk('30d');
  const [showAll, setShowAll] = useStateBk(false);

  const PREVIEW = 6;

  const filtered = useMemo(() => {
    const now = Date.now();
    const periodMs = period === 'today' ? 24*36e5
      : period === '7d' ? 7*24*36e5
      : period === '30d' ? 30*24*36e5
      : Infinity;
    const search = q.toLowerCase().trim();
    return cancellations.filter(c => {
      if (pitchFilter !== 'all' && c.pitch_id !== pitchFilter) return false;
      if (decisionFilter !== 'all' && c.decision !== decisionFilter) return false;
      if (period !== 'all' && now - new Date(c.cancelled_at).getTime() > periodMs) return false;
      if (search) {
        const hay = [c.booker_name, c.team_name, c.booker_org, c.pitch_name, c.reason]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [q, pitchFilter, decisionFilter, period, cancellations]);

  const visible = showAll ? filtered : filtered.slice(0, PREVIEW);
  const hidden = filtered.length - visible.length;

  return (
    <section style={{ marginTop: 'var(--gap-3)' }}>
      <SectionHead label="Cancellations" count={filtered.length === cancellations.length
        ? `${filtered.length} total`
        : `${filtered.length} of ${cancellations.length}`}>
        <button className="btn btn-sm btn-ghost">
          <Icon name="copy" size={14} /> Export CSV
        </button>
      </SectionHead>

      <div className="cancel-toolbar">
        <div className="search" style={{ flex: 1, minWidth: 220 }}>
          <span className="ico"><Icon name="search" size={14} /></span>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search booker, team, pitch, reason…" />
          {q && (
            <button className="btn btn-xs btn-ghost" onClick={() => setQ('')}
              style={{ height: 22, padding: '0 6px' }}>×</button>
          )}
        </div>
        <select className="input" style={{ width: 160 }}
          value={pitchFilter} onChange={e => setPitchFilter(e.target.value)}>
          <option value="all">All pitches</option>
          {window.DATA_pitches.filter(p => p.active).map(p =>
            <option key={p.id} value={p.id}>{p.name.replace(/ \(.*\)/, '')}</option>)}
        </select>
        <select className="input" style={{ width: 150 }}
          value={decisionFilter} onChange={e => setDecisionFilter(e.target.value)}>
          <option value="all">Any outcome</option>
          <option value="full">Full refund</option>
          <option value="partial">50% credit</option>
          <option value="none">No refund</option>
        </select>
        <div className="chips">
          {[['today','Today'],['7d','7d'],['30d','30d'],['all','All']].map(([k,l]) => (
            <button key={k} className="chip" aria-pressed={period === k}
              onClick={() => setPeriod(k)}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No cancellations match"
          body={q || pitchFilter !== 'all' || decisionFilter !== 'all'
            ? 'Try clearing some filters.'
            : 'Cancellations will appear here once any happen.'} />
      ) : (
        <div className="cancel-list">
          {visible.map(c => <CancelRow key={c.id} c={c} />)}
        </div>
      )}

      {hidden > 0 && !showAll && (
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 12 }}
          onClick={() => setShowAll(true)}>
          View {hidden} more
        </button>
      )}
      {showAll && filtered.length > PREVIEW && (
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 12 }}
          onClick={() => setShowAll(false)}>
          Show less
        </button>
      )}
    </section>
  );
}

function CancelRow({ c }) {
  const start = new Date(c.booking_start);
  const dt = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const ts = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute:'2-digit', hour12: false });
  const decisionMeta = c.decision === 'full'
    ? { tone: 'ok', label: 'Full refund', meta: `£${(c.refund_pence/100).toFixed(2)} refund` }
    : c.decision === 'partial'
      ? { tone: 'warn', label: '50% credit', meta: `£${(c.refund_pence/100).toFixed(2)} credit · £${(c.charged_pence/100).toFixed(2)} charged` }
      : { tone: 'crit', label: 'No refund', meta: `£${(c.charged_pence/100).toFixed(2)} charged` };

  return (
    <div className="cancel-row">
      <div className="cr-when">
        <div className="cr-rel">{window.relativeFrom(c.cancelled_at)}</div>
        <div className="cr-by">by {c.cancelled_by.split(' ')[0]}</div>
      </div>
      <div className="cr-booker">
        <div className="avatar">{getInitials(c.booker_name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="cr-name">{c.booker_name}</div>
          {(c.team_name || c.booker_org) && (
            <div className="cr-org">{c.team_name || c.booker_org}</div>
          )}
        </div>
      </div>
      <div className="cr-when2">
        <div className="cr-line"><Icon name="clock" size={12} /> {dt} · {ts}</div>
        <div className="cr-line"><Icon name="pitch" size={12} /> {c.pitch_name.replace(/ \(.*\)/, '')}</div>
      </div>
      <div className="cr-reason">
        <span className="pill pill-muted">{c.reason}</span>
        {c.note && <div className="cr-note">"{c.note}"</div>}
        {c.kind === 'series' && (
          <div className="cr-line" style={{ marginTop: 4 }}>Series</div>
        )}
      </div>
      <div className="cr-charge">
        <span className={'pill pill-' + (decisionMeta.tone === 'ok' ? 'ok' : decisionMeta.tone === 'warn' ? 'warn' : 'crit')}>
          {decisionMeta.label}
        </span>
        <div className="cr-charge-meta">{decisionMeta.meta}</div>
        <div className="cr-notify">
          {c.notified
            ? <><Icon name="check" size={11} /> {c.notify_channel} sent</>
            : <span style={{ color: 'var(--warn)' }}>not notified</span>}
        </div>
      </div>
    </div>
  );
}

function ScheduleGrid({ pitches, occupancy, onEmptyClick, onBlockClick }) {
  // Time range 17:00 -> 23:00, 6 hours
  const startHour = 17, endHour = 23;
  const totalMin = (endHour - startHour) * 60;
  const pxPerMin = 1.4;
  const gridH = totalMin * pxPerMin;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

  const parseTime = (s) => {
    const d = new Date(s);
    return d.getHours() * 60 + d.getMinutes();
  };
  const topFromTime = (mins) => (mins - startHour * 60) * pxPerMin;

  return (
    <div className="schedule-grid" style={{ ['--cols']: pitches.length }}>
      <div className="time-head" />
      {pitches.map(p => (
        <div className="pitch-head" key={p.id}>{p.name}</div>
      ))}
      <div style={{ gridColumn: '1 / 2', gridRow: '2 / 3', position: 'relative', height: gridH }}>
        {hours.map((h, i) => (
          <div key={h} className="time-cell" style={{
            position: 'absolute', top: (h - startHour) * 60 * pxPerMin,
            right: 0, left: 0, height: 60 * pxPerMin,
            borderTop: i === 0 ? 'none' : '1px dashed var(--rule)'
          }}>{String(h).padStart(2, '0')}:00</div>
        ))}
      </div>
      {pitches.map((p, idx) => {
        const blocks = occupancy.filter(o => o.pitch_id === p.id);
        return (
          <div className="pitch-col" key={p.id}
               style={{ gridColumn: `${idx + 2} / ${idx + 3}`, gridRow: '2 / 3', height: gridH }}
               onClick={(e) => {
                 if (e.target.classList.contains('pitch-col')) {
                   const rect = e.currentTarget.getBoundingClientRect();
                   const y = e.clientY - rect.top;
                   const mins = startHour * 60 + (y / pxPerMin);
                   const hh = Math.floor(mins / 60), mm = Math.floor((mins % 60) / 30) * 30;
                   onEmptyClick(p, `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`);
                 }
               }}>
            {hours.map((h) => (
              <div key={h} style={{
                position: 'absolute', left: 0, right: 0,
                top: (h - startHour) * 60 * pxPerMin, height: 60 * pxPerMin,
                borderBottom: '1px dashed var(--rule)', pointerEvents: 'none'
              }} />
            ))}
            {blocks.map((b, i) => {
              const s = parseTime(b.starts_at), e = parseTime(b.ends_at);
              const top = topFromTime(s);
              const height = (e - s) * pxPerMin;
              const cls = b.source_kind === 'fixture' ? 'occ--fixture'
                : b.source_kind === 'maintenance' ? 'occ--maint'
                : b.detail.status === 'requested' ? 'occ--req' : 'occ--conf';
              return (
                <div key={i} className={'occ ' + cls}
                     style={{ top, height }}
                     onClick={(ev) => { ev.stopPropagation(); onBlockClick(b); }}>
                  <div className="occ-time">
                    {new Date(b.starts_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12: false })}
                    {' – '}
                    {new Date(b.ends_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12: false })}
                  </div>
                  <div className="occ-title">
                    {b.source_kind === 'maintenance' ? '⚠ ' + (b.detail.reason || 'Maintenance')
                     : b.source_kind === 'fixture' ? '⚽ ' + b.detail.team_name
                     : (b.detail.status === 'requested' ? '◇ ' : '● ') + b.detail.team_name}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function WalkinModal({ walkin, onClose }) {
  const [pitchId, setPitchId] = useStateBk(walkin.pitchId);
  const [time, setTime] = useStateBk(walkin.time);
  const [date, setDate] = useStateBk('2026-06-08');
  const [length, setLength] = useStateBk(60);
  const [mode, setMode] = useStateBk('team');
  const [repeat, setRepeat] = useStateBk('one_off');
  const [weeks, setWeeks] = useStateBk(6);
  const [skipDates, setSkipDates] = useStateBk('');

  const occurrenceDates = useMemo(() => {
    if (repeat !== 'weekly') return [];
    const result = [];
    const start = new Date(date);
    for (let i = 0; i < weeks; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i * 7);
      result.push(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
    }
    return result;
  }, [repeat, date, weeks]);

  return (
    <Modal title="New booking" onClose={onClose} wide
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          {repeat === 'weekly' && (
            <span className="text-mute" style={{ fontSize: 12, alignSelf: 'center', marginRight: 8 }}>
              Creates {weeks} occurrences
            </span>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            {repeat === 'weekly' ? `Create block (${weeks})` : 'Create booking'}
          </button>
        </>
      }>
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label className="field-label">Repeat</label>
          <div className="chips" style={{ marginBottom: 0 }}>
            <button className="chip" aria-pressed={repeat === 'one_off'} onClick={() => setRepeat('one_off')}>One-off</button>
            <button className="chip" aria-pressed={repeat === 'weekly'} onClick={() => setRepeat('weekly')}>Weekly block</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
          <div>
            <label className="field-label">Pitch</label>
            <select className="input" value={pitchId} onChange={e => setPitchId(e.target.value)}>
              {window.DATA_pitches.filter(p => p.active).map(p =>
                <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">{repeat === 'weekly' ? 'First date' : 'Date'}</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Time</label>
            <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="field-label">Length</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[30, 45, 60, 90, 120].map(m => (
              <button key={m} type="button" onClick={() => setLength(m)}
                className="btn btn-sm"
                style={{ flex: 1,
                  borderColor: length === m ? 'var(--accent)' : 'var(--border)',
                  background: length === m ? 'var(--accent-soft)' : 'var(--bg-3)',
                  color: length === m ? 'var(--accent)' : 'var(--ink)' }}>
                {m}m
              </button>
            ))}
          </div>
        </div>

        {repeat === 'weekly' && (
          <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 }}>
              <div>
                <label className="field-label">Number of weeks</label>
                <input className="input" type="number" min={2} max={26} value={weeks} onChange={e => setWeeks(Math.max(2, +e.target.value))} />
              </div>
              <div>
                <label className="field-label">Skip dates (optional)</label>
                <input className="input" placeholder="2026-12-23, 2026-12-30" value={skipDates} onChange={e => setSkipDates(e.target.value)} />
              </div>
            </div>
            <div className="field-label" style={{ marginBottom: 6 }}>Occurrences</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {occurrenceDates.map((d, i) => (
                <span key={i} className="pill pill-accent" style={{ height: 22 }}>{d}</span>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="field-label">Booked for</label>
          <div className="chips" style={{ marginBottom: 10 }}>
            <button className="chip" aria-pressed={mode === 'team'} onClick={() => setMode('team')}>Registered team</button>
            <button className="chip" aria-pressed={mode === 'walkin'} onClick={() => setMode('walkin')}>Walk-in / external</button>
          </div>
          {mode === 'team'
            ? <select className="input">
                {window.DATA_teams_directory.map(t => <option key={t.team_id}>{t.name}</option>)}
              </select>
            : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input className="input" placeholder="Name" />
                <input className="input" placeholder="Phone or email" />
              </div>}
        </div>
      </div>
    </Modal>
  );
}

function BookingDetailModal({ booking, onClose }) {
  const series = !!booking.detail.series_id;
  const requested = booking.detail.status === 'requested';
  const [cancelling, setCancelling] = useStateBk(null); // 'one' | 'series' | null

  if (cancelling) {
    return <CancelBookingModal booking={booking} scope={cancelling}
      onBack={() => setCancelling(null)} onClose={onClose} />;
  }

  return (
    <Modal title="Booking" onClose={onClose}
      foot={
        <>
          {requested ? (
            <>
              <button className="btn" onClick={onClose}>Decline</button>
              <span className="spacer" />
              <button className="btn btn-primary" onClick={onClose}>Confirm</button>
            </>
          ) : (
            <>
              {series && (
                <button className="btn btn-danger" onClick={() => setCancelling('series')}>
                  Cancel weekly series
                </button>
              )}
              <span className="spacer" />
              <button className="btn" onClick={() => setCancelling('one')}>
                Cancel this booking
              </button>
            </>
          )}
        </>
      }>
      <div style={{ display: 'grid', gap: 14, fontSize: 13 }}>
        <Row label="Pitch" value={window.DATA_pitches.find(p => p.id === booking.pitch_id)?.name} />
        <Row label="When" value={
          `${new Date(booking.starts_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit', hour12: false })} – ${new Date(booking.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
        } />
        <Row label="Type" value={series ? 'Weekly series' : 'One-off'} />
        <Row label="Status" value={booking.detail.status} />
        <Row label="Booked for" value={booking.detail.team_name} />
      </div>
    </Modal>
  );
}

function CancelBookingModal({ booking, scope, onBack, onClose }) {
  // Determine cancellation window — venue policy is "48h notice, full refund. Under 48h: 50% credit."
  const noticeHours = 48;
  const hoursUntil = (new Date(booking.starts_at) - new Date()) / 36e5;
  const withinPolicy = hoursUntil >= noticeHours;

  // Default refund decision based on policy
  const defaultDecision = withinPolicy ? 'full' : 'partial';
  const [decision, setDecision] = useStateBk(defaultDecision);
  const [reason, setReason] = useStateBk('');
  const [reasonCategory, setReasonCategory] = useStateBk(null);
  const [notify, setNotify] = useStateBk(true);

  const reasons = scope === 'series'
    ? ['Series complete', 'Booker request', 'Venue closure', 'Pitch unavailable', 'Other']
    : ['Booker request', 'Weather', 'Pitch unavailable', 'Venue closure', 'Operator error', 'Other'];

  const canSubmit = reasonCategory && (reasonCategory !== 'Other' || reason.trim().length > 0);

  // Charge logic
  const dueAmount = 4500; // pence
  const refundAmount = decision === 'full' ? dueAmount
    : decision === 'partial' ? Math.round(dueAmount / 2)
    : 0;
  const teamCharged = decision === 'none' ? dueAmount : decision === 'partial' ? Math.round(dueAmount / 2) : 0;

  return (
    <Modal title={scope === 'series' ? 'Cancel weekly series' : 'Cancel booking'} onClose={onClose} wide
      foot={
        <>
          <button className="btn btn-ghost" onClick={onBack}>Back</button>
          <span className="spacer" />
          <button className="btn btn-danger" disabled={!canSubmit} onClick={onClose}>
            Confirm cancellation
          </button>
        </>
      }>
      <div style={{ display: 'grid', gap: 18 }}>
        {/* Summary of booking being cancelled */}
        <div style={{ background: 'var(--bg-3)', padding: 14, borderRadius: 12 }}>
          <div className="field-label" style={{ margin: 0, marginBottom: 8 }}>
            {scope === 'series' ? 'Cancelling all remaining occurrences in this series' : 'Cancelling'}
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
            {booking.detail.team_name}
          </div>
          <div className="text-mute" style={{ fontSize: 13 }}>
            {window.DATA_pitches.find(p => p.id === booking.pitch_id)?.name} ·{' '}
            {new Date(booking.starts_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit', hour12: false })}
          </div>
        </div>

        {/* Policy + notice */}
        <div className={'banner ' + (withinPolicy ? 'banner-info' : 'banner-warn')}>
          <Icon name={withinPolicy ? 'info' : 'alert'} size={16} />
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--ink)', fontWeight: 600, marginBottom: 2 }}>
              {withinPolicy
                ? `Within policy — ${Math.round(hoursUntil)}h notice (≥ ${noticeHours}h required)`
                : hoursUntil > 0
                  ? `Short notice — only ${Math.round(hoursUntil)}h until kickoff (${noticeHours}h required)`
                  : 'Past kickoff — manual decision required'}
            </div>
            <div style={{ fontSize: 12 }}>
              Venue policy: {window.DATA_venue.cancellation_policy}
            </div>
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="field-label">Reason</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {reasons.map(r => (
              <button key={r} type="button" className="btn btn-xs"
                onClick={() => setReasonCategory(r)}
                style={{
                  borderColor: reasonCategory === r ? 'var(--accent)' : 'var(--border)',
                  background: reasonCategory === r ? 'var(--accent-soft)' : 'var(--bg-3)',
                  color: reasonCategory === r ? 'var(--accent)' : 'var(--ink-2)',
                }}>{r}</button>
            ))}
          </div>
          {reasonCategory === 'Other' && (
            <textarea className="input" placeholder="Describe the reason…"
              value={reason} onChange={e => setReason(e.target.value)} />
          )}
          {reasonCategory && reasonCategory !== 'Other' && (
            <input className="input" placeholder="Add a note (optional)"
              value={reason} onChange={e => setReason(e.target.value)} />
          )}
        </div>

        {/* Charge decision */}
        <div>
          <label className="field-label">
            Charge decision
            {withinPolicy ? (
              <span className="pill pill-ok" style={{ marginLeft: 8, height: 18 }}>Within policy</span>
            ) : (
              <span className="pill pill-warn" style={{ marginLeft: 8, height: 18 }}>Outside policy</span>
            )}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <ChargeOption
              selected={decision === 'full'}
              onClick={() => setDecision('full')}
              title="Full refund"
              sub="Refund the booker"
              meta={`+${poundsFromPence(dueAmount)} refund`}
              tone="ok"
            />
            <ChargeOption
              selected={decision === 'partial'}
              onClick={() => setDecision('partial')}
              title="50% credit"
              sub="Half to credit / half charged"
              meta={`${poundsFromPence(Math.round(dueAmount/2))} credit · ${poundsFromPence(Math.round(dueAmount/2))} charged`}
              tone="warn"
            />
            <ChargeOption
              selected={decision === 'none'}
              onClick={() => setDecision('none')}
              title="No refund"
              sub="Full charge stands"
              meta={`${poundsFromPence(dueAmount)} charged`}
              tone="crit"
            />
          </div>
          {decision !== defaultDecision && (
            <div className="text-mute" style={{ fontSize: 12, marginTop: 8 }}>
              <Icon name="info" size={12} /> {withinPolicy
                ? 'You\'re overriding the default (full refund within policy).'
                : 'You\'re overriding the default (50% credit outside policy).'}
            </div>
          )}
        </div>

        {/* Notify */}
        <label className="toggle" style={{ alignSelf: 'start' }}>
          <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
          <span className="track" />
          <span style={{ fontSize: 13 }}>Notify booker via their preferred channel</span>
        </label>
      </div>
    </Modal>
  );
}

function ChargeOption({ selected, onClick, title, sub, meta, tone }) {
  return (
    <button type="button" onClick={onClick} className="charge-opt"
      style={{
        borderColor: selected ? `var(--${tone === 'ok' ? 'ok' : tone === 'crit' ? 'live' : 'warn'})` : 'var(--border)',
        background: selected ? `var(--${tone === 'ok' ? 'ok' : tone === 'crit' ? 'live' : 'warn'}-soft)` : 'var(--bg-3)',
      }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2, textAlign: 'left' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10, textAlign: 'left' }}>{sub}</div>
      <div style={{ fontSize: 11, fontWeight: 600,
        color: selected
          ? `var(--${tone === 'ok' ? 'ok' : tone === 'crit' ? 'live' : 'warn'})`
          : 'var(--ink-2)',
        textAlign: 'left' }}>{meta}</div>
    </button>
  );
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 14 }}>
      <span className="field-label" style={{ margin: 0 }}>{label}</span>
      <span className={mono ? 'mono' : ''} style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function BookingSettingsModal({ onClose }) {
  const [enabled, setEnabled] = useStateBk(true);
  return (
    <Modal title="Booking settings" onClose={onClose} wide
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>Save</button>
        </>
      }>
      <div style={{ display: 'grid', gap: 18 }}>
        <label className="toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span className="track" />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Bookings enabled</span>
        </label>
        <div>
          <label className="field-label">Cancellation policy</label>
          <textarea className="input" defaultValue={window.DATA_venue.cancellation_policy} />
        </div>
        <div>
          <label className="field-label">Booking windows · per pitch</label>
          <div style={{ border: 'var(--hairline)', borderRadius: 4, overflow: 'hidden' }}>
            {window.DATA_pitches.filter(p => p.active).map((p, i) => (
              <div key={p.id} style={{
                display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14,
                padding: '10px 14px',
                borderTop: i === 0 ? 'none' : '1px dashed var(--rule)',
                alignItems: 'center'
              }}>
                <div style={{ fontWeight: 500 }}>{p.name}</div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Mon–Fri 17:00–23:00 · Sat–Sun 09:00–21:00
                </span>
                <button className="btn btn-xs">Configure</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="field-label">Default prime-time windows</label>
          <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Mon–Thu 18:00 – 22:00 &nbsp; <button className="btn btn-xs">Edit</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

Object.assign(window, { Bookings });
