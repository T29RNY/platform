/* Display Settings + Season Wizard + global states */

const { useState: useStateW } = React;

function DisplaySettingsModal({ onClose }) {
  const cfg = window.DATA_display_config;
  const [panels, setPanels] = useStateW(cfg.panels);
  const [mode, setMode] = useStateW(cfg.auto_mode);
  const [cycle, setCycle] = useStateW(cfg.cycle_seconds);
  const [pin, setPin] = useStateW('');
  const [removePin, setRemovePin] = useStateW(false);
  const [msg, setMsg] = useStateW(cfg.custom_message);
  const [copied, setCopied] = useStateW(false);
  const [saved, setSaved] = useStateW(false);

  const url = `display.ioo.fc/${window.DATA_venue.display_token}`;

  const togglePanel = (id) => {
    setPanels(panels.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };
  const move = (id, dir) => {
    const idx = panels.findIndex(p => p.id === id);
    const tgt = idx + dir;
    if (tgt < 0 || tgt >= panels.length) return;
    const next = [...panels];
    [next[idx], next[tgt]] = [next[tgt], next[idx]];
    setPanels(next);
  };

  return (
    <Modal title="Reception display" onClose={onClose} wide
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <span className="spacer" />
        {saved && <span className="pill pill-ok"><span className="pill-dot" />Saved</span>}
        <button className="btn btn-primary" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }}>Save</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ display: 'grid', gap: 18 }}>
          <div>
            <label className="field-label">Display screen link</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input mono" value={url} readOnly style={{ flex: 1, fontSize: 12 }} />
              <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div className="text-mute" style={{ fontSize: 12, marginTop: 6 }}>Open this on the lobby TV. Bookmark it on the device.</div>
          </div>

          <div>
            <label className="field-label">Screen PIN</label>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              {cfg.pin_set ? <span className="pill pill-ok">PIN set</span> : <span className="pill pill-muted">No PIN</span>}
            </div>
            <input className="input" type="password" placeholder="Enter new PIN (4–8 digits) or leave blank to keep current"
              value={pin} onChange={e => setPin(e.target.value)} />
            {cfg.pin_set && (
              <label className="toggle" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={removePin} onChange={e => setRemovePin(e.target.checked)} />
                <span className="track" /><span style={{ fontSize: 12 }}>Remove PIN entirely</span>
              </label>
            )}
          </div>

          <div>
            <label className="field-label">Auto-cycling mode</label>
            <select className="input" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="smart">Smart (big scores during live games, fixtures/results between)</option>
              <option value="cycle">Cycle (rotate on a timer)</option>
              <option value="fixed">Fixed (never rotate)</option>
            </select>
            {mode === 'cycle' && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="label-xs" style={{ margin: 0 }}>Cycle every</span>
                <input className="input" type="range" min={10} max={60} step={5}
                  value={cycle} onChange={e => setCycle(+e.target.value)} style={{ flex: 1 }} />
                <span className="mono" style={{ minWidth: 40, textAlign: 'right' }}>{cycle}s</span>
              </div>
            )}
          </div>

          <div>
            <label className="field-label">Custom message</label>
            <textarea className="input" value={msg} onChange={e => setMsg(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="field-label">Panels · drag to reorder, toggle to show/hide</label>
          {panels.map((p, i) => (
            <div key={p.id} className={'panel-row' + (!p.enabled ? ' off' : '')}>
              <span className="drag">⋮⋮</span>
              <label className="toggle">
                <input type="checkbox" checked={p.enabled} onChange={() => togglePanel(p.id)} />
                <span className="track" />
              </label>
              <span className="pname">{p.name}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-xs" onClick={() => move(p.id, -1)} disabled={i === 0}>▲</button>
                <button className="btn btn-xs" onClick={() => move(p.id, 1)} disabled={i === panels.length - 1}>▼</button>
              </span>
            </div>
          ))}
          <div className="text-mute" style={{ fontSize: 11, marginTop: 8 }}>
            Disabled panels never appear, even in Smart mode.
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SeasonWizardModal({ onClose, leagues }) {
  const [step, setStep] = useStateW(0);
  // Step 1 — Basics
  const [leagueId, setLeagueId] = useStateW(leagues[0]?.id);
  const [name, setName] = useStateW('Autumn 2026');
  const [start, setStart] = useStateW('2026-09-09');
  const [end, setEnd] = useStateW('2027-01-27');
  const [weeks, setWeeks] = useStateW(18);
  const [kickoff, setKickoff] = useStateW('19:30');
  const [exclude, setExclude] = useStateW('2026-12-23, 2026-12-30');
  const [doubleRound, setDoubleRound] = useStateW(false);
  const [pitches, setPitches] = useStateW(['p1', 'p2', 'p3']);
  // Step 2 — Competitions
  const [comps, setComps] = useStateW([
    { id: 'nc1', name: 'GPL Division 1', type: 'league', format: 'round_robin', teams: 12 },
    { id: 'nc2', name: 'Open Cup', type: 'cup', format: 'group_stage', num_groups: 4, qualifiers_per_group: 2, teams: 16 },
  ]);

  const steps = ['Basics', 'Competitions', 'Teams', 'Preview', 'Confirm'];

  return (
    <Modal title="New season" onClose={onClose} xwide
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <span className="spacer" />
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {step < steps.length - 1
          ? <button className="btn btn-primary" onClick={() => setStep(step + 1)}>Next</button>
          : <button className="btn btn-primary" onClick={onClose}>Create season</button>}
      </>}>
      <div className="steps">
        {steps.map((s, i) => (
          <div key={s} className={'step' + (i === step ? ' current' : i < step ? ' done' : '')}>
            <span className="num">{i < step ? '✓' : String(i + 1).padStart(2, '0')}</span> {s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div><label className="field-label">League</label>
              <select className="input" value={leagueId} onChange={e => setLeagueId(e.target.value)}>
                {leagues.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div><label className="field-label">Season name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div><label className="field-label">Start date</label>
              <input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
            <div><label className="field-label">End date</label>
              <input className="input" type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
            <div><label className="field-label">Weeks</label>
              <input className="input" type="number" value={weeks} onChange={e => setWeeks(+e.target.value)} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div><label className="field-label">Default kickoff</label>
              <input className="input" type="time" value={kickoff} onChange={e => setKickoff(e.target.value)} /></div>
            <div><label className="field-label">Weeks to exclude</label>
              <input className="input" value={exclude} onChange={e => setExclude(e.target.value)} placeholder="2026-12-23, 2026-12-30" /></div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={doubleRound} onChange={e => setDoubleRound(e.target.checked)} />
            <span className="track" /><span style={{ fontSize: 13 }}>Double round-robin (home + away)</span>
          </label>
          <div>
            <label className="field-label">Available pitches</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {window.DATA_pitches.filter(p => p.active).map(p => {
                const on = pitches.includes(p.id);
                return (
                  <button key={p.id} type="button" className="btn btn-sm"
                    onClick={() => setPitches(on ? pitches.filter(x => x !== p.id) : [...pitches, p.id])}
                    style={{
                      borderColor: on ? 'var(--ink)' : 'var(--rule-strong)',
                      background: on ? 'var(--ink)' : 'var(--paper)',
                      color: on ? 'var(--paper)' : 'var(--ink)'
                    }}>{p.name}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <SectionHead label="Competitions">
            <button className="btn btn-sm" onClick={() => setComps([...comps, { id: 'new' + comps.length, name: 'New competition', type: 'league', format: 'round_robin', teams: 8 }])}>+ Add</button>
          </SectionHead>
          {comps.map((c, i) => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto auto', gap: 10, marginBottom: 10, alignItems: 'end' }}>
              <div><label className="field-label">Name</label>
                <input className="input" value={c.name} onChange={e => {
                  const n = [...comps]; n[i] = { ...n[i], name: e.target.value }; setComps(n);
                }} /></div>
              <div><label className="field-label">Type</label>
                <select className="input" value={c.type} onChange={e => {
                  const n = [...comps]; n[i] = { ...n[i], type: e.target.value }; setComps(n);
                }}><option value="league">League</option><option value="cup">Cup</option></select>
              </div>
              <div><label className="field-label">Format</label>
                <select className="input" value={c.format} onChange={e => {
                  const n = [...comps]; n[i] = { ...n[i], format: e.target.value }; setComps(n);
                }}>
                  <option value="round_robin">Round robin</option>
                  <option value="single_elimination">Single elim</option>
                  <option value="group_stage">Group stage</option>
                </select>
              </div>
              {c.format === 'group_stage' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ width: 60 }}>
                    <label className="field-label">Groups</label>
                    <input className="input" type="number" value={c.num_groups || 2} onChange={e => {
                      const n = [...comps]; n[i] = { ...n[i], num_groups: +e.target.value }; setComps(n);
                    }} />
                  </div>
                  <div style={{ width: 60 }}>
                    <label className="field-label">Qual/grp</label>
                    <input className="input" type="number" value={c.qualifiers_per_group || 2} onChange={e => {
                      const n = [...comps]; n[i] = { ...n[i], qualifiers_per_group: +e.target.value }; setComps(n);
                    }} />
                  </div>
                </div>
              ) : <div />}
              <button className="btn btn-xs btn-danger" onClick={() => setComps(comps.filter((_,j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {step === 2 && (
        <div>
          {comps.map(c => (
            <div key={c.id} style={{ marginBottom: 18 }}>
              <SectionHead label={c.name} count={`${c.teams || 0} teams`} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
                {window.DATA_teams_directory.slice(0, c.teams || 8).map(t => (
                  <label key={t.team_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: 'var(--hairline)', borderRadius: 3, fontSize: 12 }}>
                    <input type="checkbox" defaultChecked />
                    <Crest c1={t.primary_colour} c2={t.secondary_colour} size={12} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="banner banner-info">
            <span>Generated from your settings. <strong>Regenerate</strong> if you go back and change basics.</span>
            <span className="spacer" />
            <button className="btn btn-sm">↻ Regenerate</button>
          </div>
          {comps.map(c => {
            const teams = c.teams || 8;
            const rounds = c.format === 'round_robin' ? (teams - 1) * (doubleRound ? 2 : 1)
                          : c.format === 'group_stage' ? (teams / (c.num_groups || 2) - 1)
                          : Math.ceil(Math.log2(teams));
            const perRound = Math.floor(teams / 2);
            const total = rounds * perRound;
            return (
              <div key={c.id} className="card card-pad" style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{c.name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  <Stat label="Rounds" value={rounds} />
                  <Stat label="Matches / round" value={perRound} />
                  <Stat label="Total fixtures" value={total} />
                  <Stat label="Weeks needed" value={Math.ceil(rounds / 1)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 14 }}>{name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <Field label="League" value={leagues.find(l => l.id === leagueId)?.name} />
            <Field label="Dates" value={`${start} → ${end} · ${weeks} weeks`} />
            <Field label="Default kickoff" value={kickoff} />
            <Field label="Format" value={doubleRound ? 'Double round-robin' : 'Single round-robin'} />
            <Field label="Pitches" value={pitches.length + ' available'} />
            <Field label="Competitions" value={comps.length} />
          </div>
          <div className="banner banner-warn" style={{ marginTop: 18 }}>
            <span>Once created, fixtures are generated and saved. You can still postpone or void individual matches later.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Field({ label, value }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div style={{ fontWeight: 500, marginTop: 4, fontSize: 14 }}>{value}</div>
    </div>
  );
}

/* Token entry + loading screens */
function TokenEntry({ phase = 'form', onSubmit }) {
  const [token, setToken] = useStateW('');
  return (
    <div className="token-screen">
      <div className="token-card">
        <div className="wordmark">in or out.</div>
        {phase === 'loading' ? (
          <>
            <h1>Connecting…</h1>
            <p>Loading the venue. This usually takes a second.</p>
            <div className="skel" style={{ height: 12, width: '70%', marginBottom: 8 }} />
            <div className="skel" style={{ height: 12, width: '50%' }} />
          </>
        ) : phase === 'error' ? (
          <>
            <h1>Couldn't load the venue.</h1>
            <p>The token may be wrong or expired. Try again, or check the link.</p>
            <div className="banner banner-warn" style={{ marginBottom: 16 }}>
              <span className="mono" style={{ fontSize: 11 }}>code · UNKNOWN_TOKEN</span>
            </div>
            <div className="token-input-row">
              <input className="input" placeholder="Paste your token" value={token} onChange={e => setToken(e.target.value)} />
              <button className="btn btn-primary" onClick={() => onSubmit?.(token)}>Retry</button>
            </div>
          </>
        ) : (
          <>
            <h1>Sign in to your venue.</h1>
            <p>Paste the link from your IoO setup email, or just the token at the end.</p>
            <div className="token-input-row">
              <input className="input" placeholder="venue-7t3xz-2026"
                value={token} onChange={e => setToken(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onSubmit?.(token)} />
              <button className="btn btn-primary" onClick={() => onSubmit?.(token)}>Open</button>
            </div>
            <div className="text-mute" style={{ fontSize: 12, marginTop: 14 }}>
              No account, no password. Lose the link? <a style={{ textDecoration: 'underline' }}>Get a new one</a>.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GlobalError({ onRetry }) {
  return (
    <div className="token-screen">
      <div className="token-card">
        <div className="wordmark">in or out.</div>
        <h1>Something broke.</h1>
        <p>We couldn't load the venue. This is on us, not you.</p>
        <div className="banner banner-warn" style={{ marginBottom: 16 }}>
          <span className="mono" style={{ fontSize: 11 }}>code · NETWORK_ERROR · retrying in 12s</span>
        </div>
        <button className="btn btn-primary" onClick={onRetry}>Retry now</button>
      </div>
    </div>
  );
}

function GlobalLoading() {
  return (
    <div className="token-screen">
      <div style={{ textAlign: 'center' }}>
        <div className="wordmark" style={{ justifyContent: 'center', marginBottom: 18 }}>in or out.</div>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          Opening venue<span className="mono" style={{ animation: 'blink 1s steps(1,end) infinite' }}>…</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DisplaySettingsModal, SeasonWizardModal, TokenEntry, GlobalError, GlobalLoading });
