/* League overview, Table standings, Cups */

const { useState: useStateLg } = React;

/* ----------- League ----------- */
function League({ state, onOpenWizard }) {
  const leagues = state.leagues || [];
  if (leagues.length === 0) {
    return <EmptyState title="No leagues configured yet" body="Get in touch with your IoO contact to set one up." />;
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--gap-2)' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'} · {state.seasons.length} seasons
        </h2>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary" onClick={onOpenWizard}>+ Set up new season</button>
      </div>

      {leagues.map(l => {
        const seasons = state.seasons.filter(s => s.league_id === l.id);
        return (
          <div key={l.id} className="league-card">
            <div className="lh">
              <h3>{l.name}</h3>
              <span className="lmeta">{l.format} · {l.day_of_week} {l.default_kickoff_time}</span>
              <span className="pill pill-muted">{l.standings_visibility}</span>
              <span className="lcode">{l.league_code}</span>
            </div>
            {seasons.length === 0 ? (
              <div style={{ padding: 18, color: 'var(--ink-3)' }}>No seasons yet.</div>
            ) : seasons.map(s => {
              const comps = state.competitions.filter(c => c.season_id === s.id);
              return (
                <div className="season-row" key={s.id}>
                  <div>
                    <div className="sname">{s.name} <span className={'pill ' + (s.status === 'active' ? 'pill-live' : 'pill-muted')} style={{ marginLeft: 8 }}>{s.status}</span></div>
                    <div className="sdate">{shortDate(s.start_date)} – {shortDate(s.end_date)} · {s.num_weeks} weeks</div>
                    <div className="comps">
                      {comps.map(c => (
                        <span key={c.id} className="pill">
                          <span className="pill-dot" style={{ background: c.type === 'cup' ? 'var(--accent)' : 'var(--ok)' }} />
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <button className="btn btn-xs">Edit</button>
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

/* ----------- Table standings ----------- */
function StandingsTable({ state }) {
  const [comp, setComp] = useStateLg('c1');
  const rr = state.competitions.filter(c => c.format === 'round_robin');
  const rows = state.standings || [];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--gap-2)', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>League Table</h2>
          <div className="text-mute" style={{ fontSize: 12, marginTop: 4 }}>Updates as results come in.</div>
        </div>
        <span style={{ flex: 1 }} />
        {rr.length > 1 && (
          <select className="input" style={{ width: 240 }} value={comp} onChange={e => setComp(e.target.value)}>
            {rr.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <span className="pill pill-live"><span className="pill-dot" />Live</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing to show" body="Add teams to this competition to start a table." />
      ) : (
        <div className="dt-card">
          <table className="dt standings">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Team</th>
                <th className="num">P</th>
                <th className="num">W</th>
                <th className="num">D</th>
                <th className="num">L</th>
                <th className="num">GF</th>
                <th className="num">GA</th>
                <th className="num">GD</th>
                <th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.team_id} className={r.rank <= 3 ? 'top3' : ''}>
                  <td className="mono"><strong>{String(r.rank).padStart(2, '0')}</strong></td>
                  <td>
                    <span className="team-color-bar" style={{ ['--c']: r.primary_colour }} />
                    {r.team_name}
                  </td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.w}</td>
                  <td className="num">{r.d}</td>
                  <td className="num">{r.l}</td>
                  <td className="num">{r.gf}</td>
                  <td className="num">{r.ga}</td>
                  <td className={'num ' + (r.gd > 0 ? 'gd-pos' : r.gd < 0 ? 'gd-neg' : 'gd-zero')}>
                    {r.gd > 0 ? '+' : ''}{r.gd}
                  </td>
                  <td className="num pts">{r.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ----------- Cups ----------- */
function Cups({ state }) {
  const [scheduleTie, setScheduleTie] = useStateLg(null);
  const [buildKnock, setBuildKnock] = useStateLg(false);
  const cupComps = state.competitions.filter(c => c.type === 'cup');
  if (cupComps.length === 0) {
    return <EmptyState title="No cup yet" body="Your season doesn't include a cup competition." />;
  }
  const groups = state.cup_groups;
  const bracket = state.cup_bracket;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--gap-2)' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Open Cup · Spring 2026</h2>
        <span style={{ flex: 1 }} />
        <select className="input" style={{ width: 220 }} defaultValue="open">
          <option value="open">Open Cup</option>
        </select>
      </div>

      {bracket.champion && (
        <div className="cup-banner">
          <div className="trophy">CH</div>
          <div>
            <h2>Champion</h2>
            <div className="winner">{bracket.champion.name}</div>
          </div>
        </div>
      )}

      {groups && (
        <section style={{ marginBottom: 'var(--gap-3)' }}>
          <SectionHead label="Group stage">
            {bracket.knockout_seeded
              ? <span className="pill pill-ok">Knockout seeded</span>
              : bracket.all_groups_complete
                ? <button className="btn btn-sm btn-primary" onClick={() => setBuildKnock(true)}>Build knockout</button>
                : <span className="pill pill-warn">In progress</span>}
          </SectionHead>
          <div className="groups-grid">
            {groups.groups.map(g => (
              <div key={g.group_label} className="group-mini">
                <div className="gh">Group {g.group_label}</div>
                <table>
                  <thead>
                    <tr><th>Team</th><th className="num">P</th><th className="num">GD</th><th className="num">Pts</th></tr>
                  </thead>
                  <tbody>
                    {g.standings.map(t => (
                      <tr key={t.team_id} className={t.qualifying ? 'qualifying' : ''}>
                        <td>{t.team_name}</td>
                        <td className="num">{t.played}</td>
                        <td className="num">{t.gd > 0 ? '+' : ''}{t.gd}</td>
                        <td className="num"><strong>{t.pts}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          {!bracket.all_groups_complete && (
            <div className="text-mute" style={{ fontSize: 12, marginTop: 12 }}>
              Knockout opens once every group has played its final fixture.
            </div>
          )}
        </section>
      )}

      <section>
        <SectionHead label="Knockout bracket" />
        <div className="bracket">
          <div className="bracket-inner">
            {bracket.rounds.map(r => (
              <div className="bracket-round" key={r.round_number}>
                <div className="rh">{r.round_name}</div>
                {r.ties.map(t => <TieCard key={t.id} tie={t} onSchedule={() => setScheduleTie(t)} />)}
              </div>
            ))}
          </div>
        </div>
      </section>

      {scheduleTie && <ScheduleTieModal tie={scheduleTie} onClose={() => setScheduleTie(null)} />}
      {buildKnock && <BuildKnockoutModal onClose={() => setBuildKnock(false)} />}
    </div>
  );
}

function TieCard({ tie, onSchedule }) {
  const decided = tie.status === 'decided';
  const ready = tie.status === 'ready';
  const homeWin = decided && tie.home_score > tie.away_score ||
    (tie.decided_by === 'penalties' && false); // unknown winner in pen — keep both bold
  const awayWin = decided && tie.away_score > tie.home_score;
  return (
    <div className={'tie' + (ready ? ' ready' : '')}>
      <div className={'team-line' + (decided && homeWin ? ' win' : decided && awayWin ? ' loss' : '')}>
        <span>{tie.home_team_name || 'TBD'}</span>
        {decided && <span className="score">{tie.home_score}</span>}
      </div>
      <div className={'team-line' + (decided && awayWin ? ' win' : decided && homeWin ? ' loss' : '')}>
        <span>{tie.away_team_name || 'TBD'}</span>
        {decided && <span className="score">{tie.away_score}</span>}
      </div>
      <div className="meta">
        {decided ? (
          <>
            <span>{tie.decided_by === 'penalties' ? 'Pens' : tie.decided_by === 'extra_time' ? 'AET' : 'FT'}</span>
            <span>{shortDate(tie.scheduled_date)} · {tie.kickoff_time}</span>
          </>
        ) : tie.status === 'scheduled' ? (
          <>
            <span>Scheduled</span>
            <span>{shortDate(tie.scheduled_date)} · {tie.kickoff_time}</span>
          </>
        ) : (
          <>
            <span>Ready</span>
            <button className="btn btn-xs" onClick={onSchedule}>Schedule</button>
          </>
        )}
      </div>
    </div>
  );
}

function ScheduleTieModal({ tie, onClose }) {
  return (
    <Modal title="Schedule tie" onClose={onClose}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onClose}>Schedule</button>
      </>}>
      <div className="text-mute" style={{ marginBottom: 14, fontSize: 13 }}>
        <strong style={{ color: 'var(--ink)' }}>{tie.home_team_name}</strong> vs <strong style={{ color: 'var(--ink)' }}>{tie.away_team_name}</strong>
      </div>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label className="field-label">Date</label><input className="input" type="date" defaultValue="2026-06-18" /></div>
          <div><label className="field-label">Kickoff</label><input className="input" type="time" defaultValue="19:30" /></div>
        </div>
        <div>
          <label className="field-label">Pitch (optional)</label>
          <select className="input"><option>—</option>{window.DATA_pitches.filter(p => p.active).map(p => <option key={p.id}>{p.name}</option>)}</select>
        </div>
      </div>
    </Modal>
  );
}

function BuildKnockoutModal({ onClose }) {
  return (
    <Modal title="Build knockout" onClose={onClose}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onClose}>Seed bracket</button>
      </>}>
      <p style={{ fontSize: 13, marginTop: 0 }}>This will pair group winners and runners-up into Round 1.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div><label className="field-label">Round 1 date</label><input className="input" type="date" defaultValue="2026-06-18" /></div>
        <div><label className="field-label">Kickoff</label><input className="input" type="time" defaultValue="19:30" /></div>
      </div>
      <div style={{ marginTop: 14 }}>
        <label className="field-label">Pitch (optional)</label>
        <select className="input"><option>—</option>{window.DATA_pitches.filter(p => p.active).map(p => <option key={p.id}>{p.name}</option>)}</select>
      </div>
    </Modal>
  );
}

Object.assign(window, { League, StandingsTable, Cups });
