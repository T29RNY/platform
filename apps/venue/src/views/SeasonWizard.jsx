import React, { useEffect, useState } from "react";
import {
  venueListActiveTeams,
  venueCreateSeason,
  venueGenerateFixtures,
  venuePersistCupBracket,
  generateRoundRobin,
  generateCupBracket,
} from "@platform/core";
import Modal from "./Modal.jsx";

const TODAY = new Date().toISOString().slice(0, 10);

function defaultState(state) {
  const league = state.leagues?.[0] || {};
  return {
    league_id: league.id || "",
    name: "",
    start_date: TODAY,
    end_date: addDays(TODAY, 7 * 8),
    num_weeks: 8,
    default_kickoff_time: stripSeconds(league.default_kickoff_time) || "19:30",
    double_round: false,
    exclude_weeks: "",
    pitches: (state.pitches || []).filter((p) => p.active).map((p) => p.id),
  };
}

export default function SeasonWizard({ state, venueToken, onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [season, setSeason] = useState(() => defaultState(state));
  const [competitions, setCompetitions] = useState([
    { name: "", type: "league", format: "round_robin", team_ids: [] },
  ]);
  const [teams, setTeams] = useState([]);
  const [previews, setPreviews] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (step !== 3 || teams.length > 0) return;
    venueListActiveTeams(venueToken)
      .then((rows) => setTeams(rows || []))
      .catch((e) => setError(e?.message || String(e)));
  }, [step, teams.length, venueToken]);

  const canNext =
    (step === 1 && validBasics(season)) ||
    (step === 2 && competitions.every((c) => c.name.trim())) ||
    (step === 3 && competitions.every((c) => c.team_ids.length >= 2)) ||
    (step === 4 && previews && !previews.error) ||
    step === 5;

  function regeneratePreview() {
    setError(null);
    try {
      const out = {};
      let total = 0;
      for (const c of competitions) {
        const opts = {
          teams: c.team_ids,
          startDate: season.start_date,
          pitches: season.pitches.length || 1,
          slotTimes: [season.default_kickoff_time],
        };
        let r;
        if (c.format === "round_robin") {
          r = generateRoundRobin({
            ...opts,
            weeks: Number(season.num_weeks),
            doubleRound: !!season.double_round,
            excludeWeeks: parseExclude(season.exclude_weeks),
          });
        } else {
          r = generateCupBracket({ ...opts, format: c.format });
        }
        out[c.name] = r;
        total += r.fixtures.length;
      }
      setPreviews({ byName: out, total });
    } catch (e) {
      setPreviews({ error: e?.code || e?.message || String(e) });
    }
  }

  async function submit() {
    setSubmitting(true); setError(null);
    try {
      const res = await venueCreateSeason(venueToken, {
        league_id: season.league_id,
        name: season.name.trim(),
        start_date: season.start_date,
        end_date: season.end_date,
        num_weeks: Number(season.num_weeks),
        competitions: competitions.map((c) => ({
          name: c.name.trim(), type: c.type, format: c.format,
        })),
      });
      const createdComps = res.competitions || [];
      for (let i = 0; i < competitions.length; i++) {
        const def = competitions[i];
        const created = createdComps.find((cc) => cc.name === def.name.trim());
        if (!created) throw new Error(`Competition not returned: ${def.name}`);
        const engineOut = previews.byName[def.name];
        if (def.type === "cup" && def.format === "single_elimination") {
          // Single-elim: the server builds the whole bracket (rounds + ties + round-1
          // fixtures) from the seeded team order. The client engine output above was
          // preview-only. Round 1 plays on the season start date at the default kickoff.
          await venuePersistCupBracket(
            venueToken, created.id, season.start_date, season.default_kickoff_time,
            season.pitches || [], def.team_ids
          );
        } else {
          const payload = engineOut.fixtures.map((f) => ({
            week_number: f.week_number,
            home_team_id: f.home_team_id,
            away_team_id: f.away_team_id,
            scheduled_date: f.scheduled_date,
            kickoff_time: f.kickoff_time,
            playing_area_id: season.pitches[f.pitch_index] || null,
            round_name: f.round_name || null,
          }));
          await venueGenerateFixtures(venueToken, created.id, payload);
        }
      }
      onDone?.();
      onClose();
    } catch (e) {
      setError(e?.message || String(e));
    } finally { setSubmitting(false); }
  }

  return (
    <Modal open onClose={() => !submitting && onClose()} wide
      title={`Set up new season — Step ${step} of 5`}
      footer={
        <div className="wiz-foot">
          {step > 1 && <button onClick={() => setStep(step - 1)} disabled={submitting}>Back</button>}
          {step < 5 && (
            <button className="btn-accent" disabled={!canNext}
              onClick={() => { if (step === 3 && !previews) {/* lazy */} setStep(step + 1); }}>
              Next
            </button>
          )}
          {step === 5 && (
            <button className="btn-accent" disabled={submitting || !previews || previews.error}
              onClick={submit}>
              {submitting ? "Creating…" : "Create season"}
            </button>
          )}
        </div>
      }>
      <Stepper step={step} />
      {step === 1 && <StepBasics state={state} season={season} setSeason={setSeason} />}
      {step === 2 && <StepCompetitions competitions={competitions} setCompetitions={setCompetitions} />}
      {step === 3 && <StepTeams teams={teams} competitions={competitions} setCompetitions={setCompetitions} />}
      {step === 4 && <StepPreview previews={previews} regenerate={regeneratePreview} competitions={competitions} state={state} season={season} />}
      {step === 5 && <StepConfirm season={season} competitions={competitions} previews={previews} />}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

// ─── Step components ─────────────────────────────────────────────────────────

function Stepper({ step }) {
  const labels = ["Basics", "Competitions", "Teams", "Preview", "Confirm"];
  return (
    <div className="wiz-steps">
      {labels.map((lbl, i) => (
        <div key={i} className={`wiz-step ${i + 1 === step ? "active" : ""} ${i + 1 < step ? "done" : ""}`}>
          <span className="wiz-step-n">{i + 1}</span>
          <span className="wiz-step-lbl">{lbl}</span>
        </div>
      ))}
    </div>
  );
}

function StepBasics({ state, season, setSeason }) {
  const leagues = state.leagues || [];
  const pitches = (state.pitches || []).filter((p) => p.active);
  function set(k, v) { setSeason({ ...season, [k]: v }); }
  function togglePitch(id) {
    set("pitches", season.pitches.includes(id) ? season.pitches.filter((x) => x !== id) : [...season.pitches, id]);
  }
  return (
    <>
      <label>League</label>
      <select value={season.league_id} onChange={(e) => set("league_id", e.target.value)}>
        <option value="">— pick a league —</option>
        {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <label>Season name</label>
      <input value={season.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Autumn 2026" />
      <div className="form-row">
        <div><label>Start date</label><input type="date" value={season.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
        <div><label>End date</label><input type="date" value={season.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
        <div><label>Weeks</label><input type="number" min={1} value={season.num_weeks} onChange={(e) => set("num_weeks", e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div><label>Default kickoff</label><input type="time" value={season.default_kickoff_time} onChange={(e) => set("default_kickoff_time", e.target.value)} /></div>
        <div><label>Exclude weeks</label><input value={season.exclude_weeks} onChange={(e) => set("exclude_weeks", e.target.value)} placeholder="e.g. 3, 7" /></div>
        <div className="form-checks" style={{ alignSelf: "end" }}>
          <label className="check"><input type="checkbox" checked={season.double_round} onChange={(e) => set("double_round", e.target.checked)} /> Double round (home + away)</label>
        </div>
      </div>
      <label>Pitches available</label>
      {pitches.length === 0 && <p className="muted">No active pitches at this venue — add one first.</p>}
      <div className="form-checks">
        {pitches.map((p) => (
          <label key={p.id} className="check">
            <input type="checkbox" checked={season.pitches.includes(p.id)} onChange={() => togglePitch(p.id)} />
            {p.name} {p.surface ? `(${p.surface})` : ""}
          </label>
        ))}
      </div>
    </>
  );
}

function StepCompetitions({ competitions, setCompetitions }) {
  function update(i, patch) {
    const next = competitions.slice();
    next[i] = { ...next[i], ...patch };
    if (patch.type === "league") next[i].format = "round_robin";
    if (patch.type === "cup" && next[i].format === "round_robin") next[i].format = "single_elimination";
    setCompetitions(next);
  }
  function add() {
    if (competitions.length >= 5) return;
    setCompetitions([...competitions, { name: "", type: "league", format: "round_robin", team_ids: [] }]);
  }
  function remove(i) {
    setCompetitions(competitions.filter((_, idx) => idx !== i));
  }
  return (
    <>
      <p className="muted">One or more competitions inside this season. A "league" plays round-robin; a "cup" plays elimination or group stage.</p>
      {competitions.map((c, i) => (
        <div className="form-row mw-row" key={i}>
          <div><label>Name</label><input value={c.name} onChange={(e) => update(i, { name: e.target.value })} placeholder={`e.g. ${i === 0 ? "Autumn League" : "Cup"}`} /></div>
          <div><label>Type</label>
            <select value={c.type} onChange={(e) => update(i, { type: e.target.value })}>
              <option value="league">League</option>
              <option value="cup">Cup</option>
            </select>
          </div>
          <div><label>Format</label>
            <select value={c.format} onChange={(e) => update(i, { format: e.target.value })}>
              {c.type === "league" ? (
                <option value="round_robin">Round robin</option>
              ) : (
                <>
                  <option value="single_elimination">Single elimination</option>
                  <option value="group_stage">Group stage</option>
                </>
              )}
            </select>
          </div>
          {i > 0 && <button onClick={() => remove(i)} className="btn-bad">Remove</button>}
        </div>
      ))}
      {competitions.length < 5 && <button onClick={add} className="btn-link">+ Add competition</button>}
    </>
  );
}

function StepTeams({ teams, competitions, setCompetitions }) {
  function toggle(ci, teamId) {
    const next = competitions.slice();
    const set = new Set(next[ci].team_ids);
    set.has(teamId) ? set.delete(teamId) : set.add(teamId);
    next[ci] = { ...next[ci], team_ids: [...set] };
    setCompetitions(next);
  }
  if (teams.length === 0) return <p className="muted">Loading approved teams…</p>;
  return (
    <>
      <p className="muted">Pick teams for each competition. Same team can be in multiple.</p>
      {competitions.map((c, ci) => (
        <div key={ci} style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8 }}>{c.name || `Competition ${ci + 1}`} <span className="muted">— {c.team_ids.length} / {teams.length} selected</span></h3>
          <div className="form-checks">
            {teams.map((t) => (
              <label key={t.team_id} className="check">
                <input type="checkbox" checked={c.team_ids.includes(t.team_id)} onChange={() => toggle(ci, t.team_id)} />
                {t.name}
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function StepPreview({ previews, regenerate, competitions, state, season }) {
  const pitchById = Object.fromEntries((state.pitches || []).map((p) => [p.id, p]));
  return (
    <>
      <button onClick={regenerate} className="btn-accent">
        {previews ? "Re-generate preview" : "Generate fixture preview"}
      </button>
      {previews?.error && <p className="error">Engine error: {previews.error}</p>}
      {previews && !previews.error && (
        <>
          <p className="muted" style={{ marginTop: 12 }}>{previews.total} fixtures across {competitions.length} competition{competitions.length === 1 ? "" : "s"}.</p>
          {competitions.map((c) => {
            const out = previews.byName[c.name];
            if (!out) return null;
            return (
              <div key={c.name} style={{ marginTop: 16 }}>
                <h3>{c.name} — {out.fixtures.length} fixtures{out.byes?.length ? ` (+${out.byes.length} byes)` : ""}</h3>
                <div className="preview-table">
                  {out.fixtures.slice(0, 20).map((f, i) => (
                    <div className="preview-row" key={i}>
                      <span>W{f.week_number}</span>
                      <span>{f.scheduled_date}</span>
                      <span>{f.kickoff_time?.slice(0, 5) || ""}</span>
                      <span className="muted">{f.home_team_id}</span>
                      <span>vs</span>
                      <span className="muted">{f.away_team_id || "(bye)"}</span>
                      <span className="muted">{pitchById[season.pitches[f.pitch_index]]?.name || "—"}</span>
                    </div>
                  ))}
                  {out.fixtures.length > 20 && <p className="muted">…and {out.fixtures.length - 20} more</p>}
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function StepConfirm({ season, competitions, previews }) {
  return (
    <>
      <h3>Summary</h3>
      <ul className="confirm-list">
        <li><strong>Season:</strong> {season.name}</li>
        <li><strong>Dates:</strong> {season.start_date} → {season.end_date} ({season.num_weeks} weeks)</li>
        <li><strong>Competitions:</strong> {competitions.length}</li>
        <li><strong>Total fixtures:</strong> {previews?.total ?? 0}</li>
      </ul>
      <p className="warn-block">
        Once created, fixtures cannot be bulk-deleted — only mutated one by one via the dashboard.
      </p>
    </>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function validBasics(s) {
  return s.league_id && s.name.trim() && s.start_date && s.end_date
    && s.end_date > s.start_date && Number(s.num_weeks) > 0
    && /^\d{2}:\d{2}/.test(s.default_kickoff_time)
    && s.pitches.length > 0;
}
function parseExclude(text) {
  if (!text) return [];
  return text.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
}
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function stripSeconds(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{2}:\d{2})/);
  return m ? m[1] : null;
}
