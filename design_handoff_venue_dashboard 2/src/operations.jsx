/* Operations screen — Tonight, This week, Recent, Upcoming, Open issues + sidebars + modals */

const { useState: useStateOps } = React;

const Icon = (props) => window.Icon ? React.createElement(window.Icon, props) : null;

function Operations({ state, liveCount = 3, onUpdateFixture, onApproveReg, onRejectReg, hideSidebar = false }) {
  const [pickerFixture, setPickerFixture] = useStateOps(null);
  const [pickerKind, setPickerKind] = useStateOps(null);
  const [rejectReg, setRejectReg] = useStateOps(null);

  const openPicker = (fx, kind) => { setPickerFixture(fx); setPickerKind(kind); };
  const closePicker = () => { setPickerFixture(null); setPickerKind(null); };

  // Tonight already has live-count overrides applied upstream
  const tonight = state.fixtures.tonight || [];
  const thisweek = state.fixtures.this_week || [];
  const recent = state.fixtures.recent || [];
  const upcoming = state.fixtures.upcoming || [];

  const pendingRegs = state.pending_registrations || [];
  const incidents = state.open_incidents || [];
  const issuesCount = pendingRegs.length + incidents.length;

  return (
    <>
      <div>
        <section className="tonight">
          <div className="tonight-head">
            <h1>Tonight</h1>
            <span className="display">{(new Date()).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            {tonight.length > 0 && (
              <span className="matches-count">
                {tonight.length} matches ·{' '}
                {tonight.filter(f => f.status === 'in_progress').length} live ·{' '}
                {tonight.filter(f => !['in_progress','completed'].includes(f.status)).length} to come
              </span>
            )}
          </div>

          {tonight.length === 0 ? (
            <div className="tonight-empty">
              <div className="floods">
                <div className="flood" /><div className="flood" />
                <div className="flood" /><div className="flood" />
              </div>
              <div>
                <h3>Floodlights down.</h3>
                <p>No fixtures scheduled here tonight. Quiet night at the venue.</p>
                <div className="next-up">
                  <span style={{ color: 'var(--ink-3)' }}>Next up</span>
                  <strong>Wed 10 Jun &middot; 19:30</strong>
                  <span>Northside Athletic vs Highbridge FC</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="tonight-grid">
              {tonight.map((fx, i) =>
                <FixtureCard key={fx.id} fx={fx}
                  currentMinute={fx.status === 'in_progress' ? 32 + (i * 11) % 55 : 0}
                  onPitch={() => openPicker(fx, 'pitch')}
                  onRef={() => openPicker(fx, 'ref')}
                  onStatus={() => openPicker(fx, 'status')} />
              )}
            </div>
          )}
        </section>

        {/* Open issues */}
        {(issuesCount > 0 || !state.tonightEmpty) && (
          <section className="issues">
            <header className="issues-head">
              <h3>Open issues</h3>
              {issuesCount > 0 && <span className="count">{issuesCount}</span>}
              <span style={{ flex: 1 }} />
              {issuesCount > 0 && <button className="btn btn-xs btn-ghost">View all</button>}
            </header>
            {issuesCount === 0 ? (
              <div className="issues-empty">Nothing to action right now.</div>
            ) : (
              <>
                {pendingRegs.map(r => (
                  <div className="issues-row" key={r.id}>
                    <span className="sev sev-info"><Icon name="info" size={16} /></span>
                    <div>
                      <div className="label">{r.team_name}</div>
                      <div className="meta">Pending team registration · awaiting approval</div>
                    </div>
                    <div className="actions">
                      <button className="btn btn-xs btn-primary" onClick={() => onApproveReg?.(r.id)}>Approve</button>
                      <button className="btn btn-xs" onClick={() => setRejectReg(r)}>Reject</button>
                    </div>
                  </div>
                ))}
                {incidents.map(i => (
                  <div className="issues-row" key={i.id}>
                    <span className={'sev sev-' + i.severity}>
                      <Icon name={i.severity === 'info' ? 'info' : 'alert'} size={16} />
                    </span>
                    <div>
                      <div className="label">{i.description}</div>
                      <div className="meta">Incident · {i.severity}</div>
                    </div>
                    <div className="actions">
                      <button className="btn btn-xs">Resolve</button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </section>
        )}

        {/* This week */}
        {thisweek.length > 0 && (
          <section style={{ marginBottom: 'var(--gap-3)' }}>
            <SectionHead label="This week" count={thisweek.length + ' fixtures'}>
              <button className="btn btn-sm btn-ghost">View all</button>
            </SectionHead>
            <div className="tonight-grid">
              {thisweek.map(fx =>
                <FixtureCard key={fx.id} fx={fx}
                  onPitch={() => openPicker(fx, 'pitch')}
                  onRef={() => openPicker(fx, 'ref')}
                  onStatus={() => openPicker(fx, 'status')} />
              )}
            </div>
          </section>
        )}

        <div className="two-col">
          <div>
            <SectionHead label="Recent results" count={recent.length} />
            {recent.length === 0
              ? <EmptyState title="No recent results" body="Completed fixtures will appear here." />
              : recent.slice(0, 6).map(fx => <FixtureCompact key={fx.id} fx={fx} />)}
          </div>
          <div>
            <SectionHead label="Upcoming" count={upcoming.length} />
            {upcoming.length === 0
              ? <EmptyState title="No upcoming fixtures" body="Future fixtures will appear here." />
              : upcoming.slice(0, 6).map(fx => <FixtureCompact key={fx.id} fx={fx} />)}
          </div>
        </div>
      </div>

      {/* Modals */}
      {pickerFixture && pickerKind === 'pitch' && (
        <PitchPicker fx={pickerFixture}
          onClose={closePicker}
          onPick={(pitchId) => { onUpdateFixture?.(pickerFixture.id, { playing_area_id: pitchId }); closePicker(); }} />
      )}
      {pickerFixture && pickerKind === 'ref' && (
        <RefPicker fx={pickerFixture}
          onClose={closePicker}
          onPick={(refId) => { onUpdateFixture?.(pickerFixture.id, { official_id: refId }); closePicker(); }} />
      )}
      {pickerFixture && pickerKind === 'status' && (
        <StatusChanger fx={pickerFixture}
          onClose={closePicker}
          onApply={(patch) => { onUpdateFixture?.(pickerFixture.id, patch); closePicker(); }} />
      )}
      {rejectReg && (
        <RejectRegistration reg={rejectReg}
          onClose={() => setRejectReg(null)}
          onConfirm={(reason) => { onRejectReg?.(rejectReg.id, reason); setRejectReg(null); }} />
      )}
    </>
  );
}

function PitchPicker({ fx, onClose, onPick }) {
  const pitches = window.DATA_pitches.filter(p => p.active && p.is_available);
  const home = window.DATA_teams[fx.home_team_id], away = window.DATA_teams[fx.away_team_id];
  return (
    <Modal title="Assign pitch" onClose={onClose}>
      <div className="text-mute" style={{ marginBottom: 14, fontSize: 13 }}>
        <strong style={{ color: 'var(--ink)' }}>{home.name}</strong> vs <strong style={{ color: 'var(--ink)' }}>{away.name}</strong>
        <span className="mono" style={{ marginLeft: 10, fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {window.dayLabel(fx.scheduled_date)} · {fx.kickoff_time}
        </span>
      </div>
      <div className="picker-list">
        {pitches.map(p => (
          <div key={p.id} className="picker-row" onClick={() => onPick(p.id)}>
            <span className="pip" />
            <div>
              <div className="name">{p.name}</div>
              <div className="meta">{p.surface} · cap {p.capacity}</div>
            </div>
            <span className="meta">Pick</span>
          </div>
        ))}
        {pitches.length === 0 && (
          <div style={{ padding: 18, color: 'var(--ink-3)', textAlign: 'center' }}>
            No pitches available — all active pitches are in maintenance.
          </div>
        )}
      </div>
    </Modal>
  );
}

function RefPicker({ fx, onClose, onPick }) {
  const refs = window.DATA_refs.filter(r => r.active);
  return (
    <Modal title="Assign referee" onClose={onClose}>
      <div className="picker-list">
        {refs.map(r => (
          <div key={r.id} className="picker-row" onClick={() => onPick(r.id)}>
            <span className="pip" />
            <div>
              <div className="name">{r.name}</div>
              <div className="meta">
                {r.employment_type.replace('_',' ')} · ★{r.overall_rating} · contact via {r.preferred_channel}
              </div>
            </div>
            <span className="meta">Pick</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function StatusChanger({ fx, onClose, onApply }) {
  const [choice, setChoice] = useStateOps(null);
  const [winner, setWinner] = useStateOps(null);
  const [reason, setReason] = useStateOps('');
  const home = window.DATA_teams[fx.home_team_id], away = window.DATA_teams[fx.away_team_id];

  const transitions = [
    { id: 'postpone', label: 'Postpone',   needs: 'reason', status: 'postponed' },
    { id: 'void',     label: 'Void match', needs: 'reason', status: 'void' },
    { id: 'walkover', label: 'Walkover',   needs: 'winner', status: 'walkover' },
    { id: 'forfeit',  label: 'Forfeit',    needs: 'winner', status: 'forfeit' },
  ];

  const canApply = choice && (
    (choice.needs === 'reason' && reason.trim().length > 0) ||
    (choice.needs === 'winner' && winner)
  );

  return (
    <Modal title="Change status" onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="btn btn-primary" disabled={!canApply}
            onClick={() => {
              const patch = { status: choice.status };
              if (choice.id === 'walkover') patch.walkover_winner_id = winner;
              if (choice.id === 'forfeit') patch.forfeit_winner_id = winner;
              onApply(patch);
            }}>Apply</button>
        </>
      }>
      <div className="text-mute" style={{ marginBottom: 14, fontSize: 13 }}>
        <strong style={{ color: 'var(--ink)' }}>{home.name}</strong> vs <strong style={{ color: 'var(--ink)' }}>{away.name}</strong>
      </div>
      <label className="field-label">Outcome</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {transitions.map(t => (
          <button key={t.id} type="button"
            onClick={() => setChoice(t)}
            className="btn"
            style={{ justifyContent: 'flex-start',
              borderColor: choice?.id === t.id ? 'var(--ink)' : 'var(--rule-strong)',
              background: choice?.id === t.id ? 'var(--paper-2)' : 'var(--paper)' }}>
            {t.label}
          </button>
        ))}
      </div>
      {choice?.needs === 'reason' && (
        <>
          <label className="field-label">Reason</label>
          <textarea className="input" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. severe weather, referee no-show…" />
        </>
      )}
      {choice?.needs === 'winner' && (
        <>
          <label className="field-label">Winner</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[fx.home_team_id, fx.away_team_id].map(tid => {
              const t = window.DATA_teams[tid];
              return (
                <button key={tid} type="button"
                  onClick={() => setWinner(tid)}
                  className="btn"
                  style={{ justifyContent: 'flex-start', gap: 10,
                    borderColor: winner === tid ? 'var(--ink)' : 'var(--rule-strong)',
                    background: winner === tid ? 'var(--paper-2)' : 'var(--paper)' }}>
                  <Crest c1={t.primary_colour} c2={t.secondary_colour} />
                  {t.name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

function RejectRegistration({ reg, onClose, onConfirm }) {
  const [reason, setReason] = useStateOps('');
  return (
    <Modal title="Reject registration" onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="btn btn-danger" disabled={!reason.trim()} onClick={() => onConfirm(reason)}>Reject</button>
        </>
      }>
      <div style={{ marginBottom: 14, fontSize: 13 }}>
        <strong>{reg.team_name}</strong> — they'll see this reason.
      </div>
      <label className="field-label">Reason</label>
      <textarea className="input" value={reason} onChange={e => setReason(e.target.value)}
        placeholder="e.g. competition full, missing payment method…" />
    </Modal>
  );
}

function PitchForm({ pitch, onClose }) {
  const isNew = !pitch.id;
  const [name, setName] = useStateOps(pitch.name || '');
  const [surface, setSurface] = useStateOps(pitch.surface || '3G');
  const [capacity, setCapacity] = useStateOps(pitch.capacity || 14);
  const [active, setActive] = useStateOps(pitch.active !== false);
  return (
    <Modal title={isNew ? 'Add pitch' : 'Edit pitch'} onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>{isNew ? 'Add' : 'Save'}</button>
        </>
      }>
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pitch 6 (West)" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label className="field-label">Surface</label>
            <select className="input" value={surface} onChange={e => setSurface(e.target.value)}>
              <option>3G</option><option>4G</option><option>Grass</option><option>Indoor</option><option>Hard</option>
            </select>
          </div>
          <div>
            <label className="field-label">Capacity</label>
            <input className="input" type="number" value={capacity} onChange={e => setCapacity(+e.target.value)} />
          </div>
        </div>
        <div>
          <label className="field-label">Maintenance windows</label>
          <div className="text-mute" style={{ fontSize: 12 }}>
            No upcoming maintenance. <button className="btn btn-xs" style={{ marginLeft: 6 }}>+ Add window</button>
          </div>
        </div>
        <label className="toggle" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          <span className="track" />
          <span style={{ fontSize: 13 }}>Active</span>
        </label>
      </div>
    </Modal>
  );
}

function RefForm({ ref_, onClose }) {
  const isNew = !ref_.id;
  const [name, setName] = useStateOps(ref_.name || '');
  const [phone, setPhone] = useStateOps(ref_.phone || '');
  const [whatsapp, setWhatsapp] = useStateOps(ref_.whatsapp_number || '');
  const [email, setEmail] = useStateOps(ref_.email || '');
  const [channel, setChannel] = useStateOps(ref_.preferred_channel || 'whatsapp');
  const [emp, setEmp] = useStateOps(ref_.employment_type || 'freelance');
  const [rating, setRating] = useStateOps(ref_.overall_rating ?? 4);
  const [active, setActive] = useStateOps(ref_.active !== false);
  return (
    <Modal title={isNew ? 'Add official' : 'Edit official'} onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>{isNew ? 'Add' : 'Save'}</button>
        </>
      }>
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label className="field-label">Phone</label>
            <input className="input" value={phone} onChange={e => setPhone(e.target.value)} /></div>
          <div><label className="field-label">WhatsApp</label>
            <input className="input" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} /></div>
        </div>
        <div>
          <label className="field-label">Email</label>
          <input className="input" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label className="field-label">Preferred channel</label>
            <select className="input" value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="whatsapp">WhatsApp</option><option value="phone">Phone</option><option value="email">Email</option>
            </select>
          </div>
          <div><label className="field-label">Employment</label>
            <select className="input" value={emp} onChange={e => setEmp(e.target.value)}>
              <option value="freelance">Freelance</option><option value="in_house">In-house</option>
            </select>
          </div>
        </div>
        <div>
          <label className="field-label">Rating (0–5)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input type="range" min={0} max={5} step={1} value={rating} onChange={e => setRating(+e.target.value)} style={{ flex: 1 }} />
            <StarRating n={rating} />
          </div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          <span className="track" />
          <span style={{ fontSize: 13 }}>Active</span>
        </label>
      </div>
    </Modal>
  );
}

Object.assign(window, { Operations });
