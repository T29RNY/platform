/* Payments, Teams, Players, Staff screens */

const { useState: useStateD1 } = React;

/* ----------- Payments ----------- */
function Payments({ state }) {
  const [filter, setFilter] = useStateD1('all');
  const [recordCharge, setRecordCharge] = useStateD1(null);
  const [addCharge, setAddCharge] = useStateD1(false);
  const [voidCharge, setVoidCharge] = useStateD1(null);
  const [editLink, setEditLink] = useStateD1(false);
  const [link, setLink] = useStateD1(state.venue.payment_link || '');

  const s = state.payments_summary;
  const all = state.charges || [];
  const filtered = filter === 'all' ? all : all.filter(c => c.status === filter);

  return (
    <div>
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Owed</div>
          <div className="stat-value">{poundsRound(s.owed_pence)}</div>
          <div className="stat-sub">{all.length} charges</div>
        </div>
        <div className="stat stat--ok">
          <div className="stat-label">Collected</div>
          <div className="stat-value">{poundsRound(s.collected_pence)}</div>
          <div className="stat-sub">{all.filter(c => c.status === 'paid').length} paid</div>
        </div>
        <div className="stat stat--crit">
          <div className="stat-label">Outstanding</div>
          <div className="stat-value">{poundsRound(s.outstanding_pence)}</div>
          <div className="stat-sub">{all.filter(c => c.status === 'unpaid' || c.status === 'part_paid').length} due</div>
        </div>
        <div className="stat stat--accent">
          <div className="stat-label">Collection rate</div>
          <div className="stat-value">{Math.round(s.collection_rate * 100)}%</div>
          <div className="bar"><div className="bar-fill" style={{ width: `${s.collection_rate * 100}%` }} /></div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 'var(--gap-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div className="label-xs">Online pay link</div>
          {!link ? (
            <span className="text-mute">No online pay link set.</span>
          ) : editLink ? (
            <>
              <input className="input" value={link} onChange={e => setLink(e.target.value)} style={{ flex: 1, minWidth: 200, maxWidth: 320 }} />
              <button className="btn btn-sm btn-primary" onClick={() => setEditLink(false)}>Save</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditLink(false)}>Cancel</button>
            </>
          ) : (
            <>
              <span className="mono" style={{ fontSize: 13 }}>{link}</span>
              <button className="btn btn-sm" onClick={() => setEditLink(true)}>Edit</button>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm">↻ Refresh</button>
        </div>
      </div>

      <div className="dt-card">
        <div className="dt-toolbar">
          <div className="chips">
            {['all','unpaid','part_paid','paid','voided'].map(f =>
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f.replace('_',' ')}
              </button>)}
          </div>
          <span className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={() => setAddCharge(true)}>+ Add charge</button>
        </div>
        <table className="dt">
          <thead>
            <tr>
              <th>Source</th>
              <th>Team</th>
              <th className="num">Due</th>
              <th className="num">Paid</th>
              <th className="num">Balance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id}>
                <td>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {c.source}
                  </span>
                  {c.due_date && <span className="mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
                    due {shortDate(c.due_date)}
                  </span>}
                </td>
                <td>{c.team_name}</td>
                <td className="num">{poundsFromPence(c.amount_due_pence)}</td>
                <td className="num">{poundsFromPence(c.paid_pence)}</td>
                <td className="num"><strong>{poundsFromPence(c.balance_pence)}</strong></td>
                <td><PaymentStatusPill status={c.status} /></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {(c.status === 'unpaid' || c.status === 'part_paid') && (
                      <button className="btn btn-xs btn-primary" onClick={() => setRecordCharge(c)}>Record payment</button>
                    )}
                    {c.status !== 'refunded' && c.status !== 'voided' && (
                      <button className="btn btn-xs" onClick={() => setVoidCharge(c)}>Void</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: 24, color: 'var(--ink-3)' }}>
                No charges match this filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {recordCharge && <RecordPaymentModal charge={recordCharge} onClose={() => setRecordCharge(null)} />}
      {addCharge && <AddChargeModal onClose={() => setAddCharge(false)} />}
      {voidCharge && (
        <Modal title="Void charge" onClose={() => setVoidCharge(null)}
          foot={<>
            <button className="btn btn-ghost" onClick={() => setVoidCharge(null)}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-danger" onClick={() => setVoidCharge(null)}>Void</button>
          </>}>
          <p style={{ fontSize: 13 }}>Void <strong>{voidCharge.team_name}</strong>'s charge of {poundsFromPence(voidCharge.amount_due_pence)}?</p>
          <p className="text-mute" style={{ fontSize: 12 }}>Refunds aren't issued automatically — handle that separately if you've already received payment.</p>
        </Modal>
      )}
    </div>
  );
}

function PaymentStatusPill({ status }) {
  const map = {
    paid:      { cls: 'pill-ok',    label: 'Paid' },
    unpaid:    { cls: 'pill-crit',  label: 'Unpaid' },
    part_paid: { cls: 'pill-warn',  label: 'Part paid' },
    voided:    { cls: 'pill-muted', label: 'Voided' },
    refunded:  { cls: 'pill-muted', label: 'Refunded' },
  };
  const c = map[status] || map.unpaid;
  return <span className={'pill ' + c.cls}>{c.label}</span>;
}

function RecordPaymentModal({ charge, onClose }) {
  const [amount, setAmount] = useStateD1((charge.balance_pence / 100).toFixed(2));
  const [method, setMethod] = useStateD1('Bank transfer');
  const [note, setNote] = useStateD1('');
  return (
    <Modal title="Record payment" onClose={onClose}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onClose}>Record</button>
      </>}>
      <div style={{ marginBottom: 16, padding: 12, background: 'var(--paper-2)', borderRadius: 4 }}>
        <div className="label-xs">Charge</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 4 }}>
          <strong style={{ fontSize: 14 }}>{charge.team_name}</strong>
          <span className="mono" style={{ fontSize: 13 }}>balance {poundsFromPence(charge.balance_pence)}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <label className="field-label">Amount (£)</label>
          <input className="input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Method</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {['Cash','Bank transfer','Card','Other'].map(m => (
              <button key={m} type="button" className="btn btn-sm"
                onClick={() => setMethod(m)}
                style={{ borderColor: method === m ? 'var(--ink)' : 'var(--rule-strong)',
                         background: method === m ? 'var(--paper-2)' : 'var(--paper)' }}>{m}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="field-label">Note (optional)</label>
          <input className="input" value={note} onChange={e => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function AddChargeModal({ onClose }) {
  const [team, setTeam] = useStateD1('home');
  return (
    <Modal title="Add charge" onClose={onClose}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onClose}>Create</button>
      </>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <label className="field-label">Fixture</label>
          <select className="input">
            <option>Wed 10 Jun · Northside Athletic vs Highbridge FC</option>
            <option>Wed 10 Jun · Brockley Rovers vs Battersea Bulldogs</option>
            <option>Thu 11 Jun · Eastpark United vs Cypress Park</option>
          </select>
        </div>
        <div>
          <label className="field-label">Team</label>
          <div className="chips">
            <button className="chip" aria-pressed={team === 'home'} onClick={() => setTeam('home')}>Home (Northside)</button>
            <button className="chip" aria-pressed={team === 'away'} onClick={() => setTeam('away')}>Away (Highbridge)</button>
          </div>
        </div>
        <div>
          <label className="field-label">Amount (£) <span className="text-mute" style={{ textTransform: 'none', letterSpacing: 0 }}>· blank uses league default (£45)</span></label>
          <input className="input" type="number" step="0.01" placeholder="45.00" />
        </div>
      </div>
    </Modal>
  );
}

/* ----------- Teams ----------- */
function Teams({ state }) {
  const [q, setQ] = useStateD1('');
  const [openTeam, setOpenTeam] = useStateD1(null);
  const list = (state.teams_directory || []).filter(t => t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--gap-2)' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {state.teams_directory.length} teams <span className="text-mute" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>across active competitions</span>
        </h2>
        <span style={{ flex: 1 }} />
        <div className="search">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search teams…" />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState title="No teams match" body={`Nothing matches "${q}".`} />
      ) : (
        <div className="teams-grid">
          {list.map(t => (
            <div key={t.team_id} className="team-card" onClick={() => setOpenTeam(t)}>
              <Crest c1={t.primary_colour} c2={t.secondary_colour} size={48} big initials={getInitials(t.name)} />
              <div>
                <div className="name">{t.name}</div>
                <div className="meta">{t.competition_count} comp{t.competition_count !== 1 ? 's' : ''} · active {t.last_active_at}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {openTeam && <RosterModal team={openTeam} onClose={() => setOpenTeam(null)} />}
    </div>
  );
}

function RosterModal({ team, onClose }) {
  const r = window.DATA_roster_sample;
  return (
    <Modal title="Team" onClose={onClose} wide>
      <div className="roster-head">
        <Crest c1={team.primary_colour} c2={team.secondary_colour} size={64} big initials={getInitials(team.name)} />
        <div>
          <div className="name">{team.name}</div>
          <div className="chips-row">
            {r.competitions.map(c => <span key={c.name} className="pill">{c.name}</span>)}
          </div>
          <div className="player-count">{r.players.length} players · {r.players.filter(p => !p.disabled).length} active</div>
        </div>
      </div>
      <table className="dt">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Player</th>
            <th className="num">Goals</th>
            <th className="num">POTM</th>
            <th className="num">Apps</th>
            <th className="num">W-D-L</th>
          </tr>
        </thead>
        <tbody>
          {r.players.map((p, i) => (
            <tr key={i} className={'player-row' + (p.disabled ? ' inactive' : '')}>
              <td><span className="mono">{p.shirt_number ?? '—'}</span></td>
              <td>
                <strong>{p.name}</strong>
                {p.nickname && <span className="text-mute" style={{ marginLeft: 6 }}>"{p.nickname}"</span>}
                <span className="player-badges">
                  {p.is_vc && <span className="pb pb-vc">VC</span>}
                  {p.is_reserve && <span className="pb pb-res">RES</span>}
                  {p.injured && <span className="pb pb-inj">INJ</span>}
                  {p.disabled && <span className="pb pb-off">OFF</span>}
                </span>
              </td>
              <td className="num">{p.goals}</td>
              <td className="num">{p.motm}</td>
              <td className="num">{p.attended}</td>
              <td className="num"><span className="mono">{p.w}-{p.d}-{p.l}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/* ----------- Players ----------- */
function Players({ state }) {
  const [filter, setFilter] = useStateD1('all');
  const [q, setQ] = useStateD1('');
  const all = state.players_directory || [];
  const filtered = all.filter(p => {
    if (filter === 'injured' && !p.injured) return false;
    if (filter === 'inactive' && !p.disabled) return false;
    const search = q.toLowerCase();
    if (search) {
      return p.name.toLowerCase().includes(search) ||
             (p.nickname && p.nickname.toLowerCase().includes(search)) ||
             p.team_name.toLowerCase().includes(search);
    }
    return true;
  });
  const activeCount = all.filter(p => !p.disabled).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--gap-2)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {activeCount} active players <span className="text-mute" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>across your teams</span>
        </h2>
        <span style={{ flex: 1 }} />
        <div className="chips">
          {['all','injured','inactive'].map(f =>
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
        </div>
        <div className="search">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search players or teams…" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No players match" body="Try a different filter or search term." />
      ) : (
        <div className="dt-card">
          <table className="dt">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="num">Goals</th>
                <th className="num">POTM</th>
                <th className="num">Apps</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className={p.disabled ? 'player-row inactive' : ''}>
                  <td><span className="mono">{p.shirt_number ?? '—'}</span></td>
                  <td>
                    <strong>{p.name}</strong>
                    {p.nickname && <span className="text-mute" style={{ marginLeft: 6 }}>"{p.nickname}"</span>}
                    <span className="player-badges">
                      {p.injured && <span className="pb pb-inj">INJ</span>}
                      {p.disabled && <span className="pb pb-off">OFF</span>}
                    </span>
                  </td>
                  <td>
                    <span className="team-color-bar" style={{ ['--c']: p.team_colour }} />
                    {p.team_name}
                  </td>
                  <td className="num">{p.goals}</td>
                  <td className="num">{p.motm}</td>
                  <td className="num">{p.attended}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ----------- Staff ----------- */
function Staff({ state }) {
  const [addRef, setAddRef] = useStateD1(false);
  const [addStaff, setAddStaff] = useStateD1(false);
  const officials = window.DATA_refs;
  const staff = state.staff || [];

  return (
    <div>
      <section style={{ marginBottom: 'var(--gap-3)' }}>
        <SectionHead label={`Match officials · ${officials.filter(r => r.active).length}`} count={`${officials.length} total`}>
          <button className="btn btn-sm btn-primary" onClick={() => setAddRef(true)}>+ Add official</button>
        </SectionHead>
        {officials.length === 0 ? (
          <EmptyState title="No officials yet" body="Add a referee to start assigning them to fixtures." />
        ) : (
          <div className="staff-grid">
            {officials.sort((a,b) => Number(b.active) - Number(a.active)).map(r => (
              <div key={r.id} className={'staff-card' + (!r.active ? ' inactive' : '')}>
                <div className="head">
                  <div className="avatar">{getInitials(r.name)}</div>
                  <div style={{ flex: 1 }}>
                    <div className="name">{r.name}</div>
                    <div className="role-line">{r.employment_type.replace('_',' ')} <StarRating n={r.overall_rating} /></div>
                  </div>
                  {!r.active && <span className="pill pill-muted">Inactive</span>}
                </div>
                <div className="contact">
                  <span className={'chip-contact' + (r.preferred_channel === 'whatsapp' ? ' preferred' : '')}>WA</span>
                  <span className={'chip-contact' + (r.preferred_channel === 'phone' ? ' preferred' : '')}>{r.phone}</span>
                  {r.email && <span className={'chip-contact' + (r.preferred_channel === 'email' ? ' preferred' : '')}>{r.email}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHead label={`Venue staff · ${staff.filter(s => s.active).length}`} count={`${staff.length} total`}>
          <button className="btn btn-sm btn-primary" onClick={() => setAddStaff(true)}>+ Add staff</button>
        </SectionHead>
        {staff.length === 0 ? (
          <EmptyState title="No venue staff yet" body="Reception, managers, groundstaff — add them all here." />
        ) : (
          <div className="staff-grid">
            {staff.sort((a,b) => Number(b.active) - Number(a.active)).map(s => (
              <div key={s.id} className={'staff-card' + (!s.active ? ' inactive' : '')}>
                <div className="head">
                  <div className="avatar">{getInitials(s.name)}</div>
                  <div style={{ flex: 1 }}>
                    <div className="name">{s.name}</div>
                    <div className="role-line">{s.role}{s.notes ? ' · ' + s.notes : ''}</div>
                  </div>
                  {!s.active && <span className="pill pill-muted">Inactive</span>}
                </div>
                <div className="contact">
                  {s.phone && <span className={'chip-contact' + (s.preferred_channel === 'phone' ? ' preferred' : '')}>{s.phone}</span>}
                  {s.whatsapp_number && <span className={'chip-contact' + (s.preferred_channel === 'whatsapp' ? ' preferred' : '')}>WA</span>}
                  {s.email && <span className={'chip-contact' + (s.preferred_channel === 'email' ? ' preferred' : '')}>{s.email}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {addRef && <RefForm ref_={{}} onClose={() => setAddRef(false)} />}
      {addStaff && <StaffForm staff={{}} onClose={() => setAddStaff(false)} />}
    </div>
  );
}

function StaffForm({ staff, onClose }) {
  const isNew = !staff.id;
  const [name, setName] = useStateD1(staff.name || '');
  const [role, setRole] = useStateD1(staff.role || 'reception');
  const [phone, setPhone] = useStateD1(staff.phone || '');
  const [email, setEmail] = useStateD1(staff.email || '');
  const [whatsapp, setWhatsapp] = useStateD1(staff.whatsapp_number || '');
  const [channel, setChannel] = useStateD1(staff.preferred_channel || 'email');
  const [notes, setNotes] = useStateD1(staff.notes || '');
  const [active, setActive] = useStateD1(staff.active !== false);
  return (
    <Modal title={isNew ? 'Add staff' : 'Edit staff'} onClose={onClose}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onClose}>{isNew ? 'Add' : 'Save'}</button>
      </>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div><label className="field-label">Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label className="field-label">Role</label>
            <select className="input" value={role} onChange={e => setRole(e.target.value)}>
              <option value="reception">Reception</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              <option value="groundstaff">Groundstaff</option>
              <option value="coach">Coach</option>
              <option value="staff">Staff</option>
            </select>
          </div>
          <div><label className="field-label">Preferred channel</label>
            <select className="input" value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="email">Email</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label className="field-label">Phone</label>
            <input className="input" value={phone} onChange={e => setPhone(e.target.value)} /></div>
          <div><label className="field-label">WhatsApp</label>
            <input className="input" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} /></div>
        </div>
        <div><label className="field-label">Email</label>
          <input className="input" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div><label className="field-label">Notes</label>
          <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <label className="toggle">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          <span className="track" /><span style={{ fontSize: 13 }}>Active</span>
        </label>
      </div>
    </Modal>
  );
}

Object.assign(window, { Payments, Teams, Players, Staff });
