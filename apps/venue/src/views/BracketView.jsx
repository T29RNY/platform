import React, { useEffect, useMemo, useState, useCallback } from "react";
import { getCupBracket, getGroupStandings, venueScheduleCupTie, venueSeedKnockoutFromGroups } from "@platform/core";
import Modal from "./Modal.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";

// Venue-side cup bracket + scheduling. Lists single-elim / group-stage cups,
// renders the bracket tree, schedules 'ready' ties, seeds knockout from groups.
const fmtDate = (d) => {
  if (!d) return "";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return d; }
};
const DECIDER_NOTE = { penalties: "on penalties", extra_time: "after extra time", walkover: "walkover", forfeit: "forfeit" };

export default function BracketView({ state, venueToken, onRefresh }) {
  const cups = useMemo(
    () => (state.competitions ?? []).filter((c) => c.type === "cup" && (c.format === "single_elimination" || c.format === "group_stage")),
    [state.competitions]
  );
  const pitches = state.pitches ?? [];
  const [compId, setCompId] = useState(cups[0]?.id ?? null);
  const [bracket, setBracket] = useState(null);
  const [groups, setGroups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scheduleTie, setScheduleTie] = useState(null);
  const [buildOpen, setBuildOpen] = useState(false);

  const selectedCup = useMemo(() => cups.find((c) => c.id === compId), [cups, compId]);
  const isGroupStage = selectedCup?.format === "group_stage";

  useEffect(() => { if (!compId && cups[0]) setCompId(cups[0].id); }, [cups, compId]);

  const load = useCallback(async () => {
    if (!compId) { setBracket(null); setGroups(null); return; }
    setLoading(true); setError(null);
    try {
      const [bk, gs] = await Promise.all([
        getCupBracket(compId),
        isGroupStage ? getGroupStandings(compId) : Promise.resolve(null),
      ]);
      setBracket(bk); setGroups(gs);
    } catch (e) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [compId, isGroupStage]);

  useEffect(() => { load(); }, [load]);

  if (!cups.length) {
    return <EmptyState title="No knockout cups yet" body="Create one from “Set up new season” and pick the cup format." />;
  }

  const rounds = bracket?.rounds ?? [];
  const champion = bracket?.champion;

  return (
    <div>
      <SectionHead label="Cups">
        {cups.length > 1 && (
          <select className="input" style={{ width: "auto" }} value={compId ?? ""} onChange={(e) => setCompId(e.target.value)} aria-label="Choose cup">
            {cups.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </SectionHead>

      {error && <EmptyState title="Couldn’t load bracket" body={error} />}
      {loading && rounds.length === 0 && !error && <EmptyState title="Loading bracket…" />}

      {champion && (
        <div className="cup-banner">
          <span className="trophy">🏆</span>
          <div><h2>Champion</h2><div className="winner">{champion.name}</div></div>
        </div>
      )}

      {!loading && !error && isGroupStage && groups?.groups?.length > 0 && (
        <div className="groups-grid">
          {groups.groups.map((g) => (
            <div key={g.group_label} className="group-mini">
              <div className="gh">Group {g.group_label}</div>
              <table>
                <thead><tr><th>Team</th><th className="num">P</th><th className="num">W</th><th className="num">D</th><th className="num">L</th><th className="num">GD</th><th className="num">Pts</th></tr></thead>
                <tbody>
                  {(g.standings ?? []).map((s) => (
                    <tr key={s.team_id} className={s.qualifying ? "qualifying" : ""}>
                      <td>{s.team_name}</td>
                      <td className="num">{s.played}</td><td className="num">{s.w}</td><td className="num">{s.d}</td><td className="num">{s.l}</td>
                      <td className="num">{s.gd}</td><td className="num">{s.pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && isGroupStage && !bracket?.knockout_seeded && (
        <div style={{ margin: "0 0 var(--gap-2)" }}>
          {bracket?.all_groups_complete ? (
            <button className="btn btn-primary" onClick={() => setBuildOpen(true)}>Build knockout</button>
          ) : (
            <p className="text-mute">Group stage in progress. Once every group fixture is played, “Build knockout” seeds the bracket from the final standings.</p>
          )}
        </div>
      )}

      {!loading && !error && rounds.length > 0 && (
        <div className="bracket">
          <div className="bracket-inner">
            {rounds.map((rd) => (
              <div className="bracket-round" key={rd.round_number}>
                <div className="rh">{rd.round_name}</div>
                {(rd.ties ?? []).map((tie) => <TieCard key={tie.id} tie={tie} onSchedule={() => setScheduleTie(tie)} />)}
              </div>
            ))}
          </div>
        </div>
      )}

      {scheduleTie && (
        <ScheduleTieModal tie={scheduleTie} pitches={pitches} venueToken={venueToken}
          onClose={() => setScheduleTie(null)}
          onDone={async () => { setScheduleTie(null); await load(); onRefresh?.(); }} />
      )}
      {buildOpen && (
        <BuildKnockoutModal competitionId={compId} pitches={pitches} venueToken={venueToken}
          onClose={() => setBuildOpen(false)}
          onDone={async () => { setBuildOpen(false); await load(); onRefresh?.(); }} />
      )}
    </div>
  );
}

function TieCard({ tie, onSchedule }) {
  const winH = tie.winner_team_id && tie.winner_team_id === tie.home_team_id;
  const winA = tie.winner_team_id && tie.winner_team_id === tie.away_team_id;
  const hasScore = tie.home_score != null && tie.away_score != null;
  const note = tie.decided_by && DECIDER_NOTE[tie.decided_by];
  const teamLabel = (name, src) => name || (src === "bye" ? "(bye)" : "TBD");

  return (
    <div className={"tie" + (tie.status === "ready" ? " ready" : "")}>
      <div className={"team-line" + (winH ? " win" : winA ? " loss" : "")}>
        <span>{teamLabel(tie.home_team_name, tie.home_source)}</span>
        {hasScore && <span className="score">{tie.home_score}</span>}
      </div>
      <div className={"team-line" + (winA ? " win" : winH ? " loss" : "")}>
        <span>{tie.away_team_name == null && tie.home_source === "bye" ? "—" : teamLabel(tie.away_team_name, tie.away_source)}</span>
        {hasScore && <span className="score">{tie.away_score}</span>}
      </div>
      <div className="meta">
        {tie.status === "decided" && <span>{note || "full time"}</span>}
        {tie.status === "scheduled" && tie.scheduled_date && (
          <span>{fmtDate(tie.scheduled_date)}{tie.kickoff_time ? ` · ${String(tie.kickoff_time).slice(0, 5)}` : ""}</span>
        )}
        {tie.status === "ready" && <button className="btn btn-xs btn-primary" onClick={onSchedule}>Schedule</button>}
        {tie.status === "pending" && <span className="text-mute">awaiting teams</span>}
      </div>
    </div>
  );
}

function TieScheduleForm({ date, setDate, time, setTime, pitchId, setPitchId, pitches, error }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
        <div>
          <label className="field-label">Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Kickoff</label>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <label className="field-label">Pitch</label>
      <select className="input" value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
        <option value="">Unallocated</option>
        {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{error}</p>}
    </>
  );
}

function ScheduleTieModal({ tie, pitches, venueToken, onClose, onDone }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:30");
  const [pitchId, setPitchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (!date || !time) { setError("Date and kickoff time are required."); return; }
    setBusy(true); setError(null);
    try { await venueScheduleCupTie(venueToken, tie.id, date, time, pitchId || null); await onDone(); }
    catch (e) { setError(e?.message || String(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title={`Schedule ${tie.home_team_name} v ${tie.away_team_name}`}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Scheduling…" : "Schedule tie"}</button>
      </>}>
      <TieScheduleForm {...{ date, setDate, time, setTime, pitchId, setPitchId, pitches, error }} />
    </Modal>
  );
}

function BuildKnockoutModal({ competitionId, pitches, venueToken, onClose, onDone }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:30");
  const [pitchId, setPitchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (busy) return;
    if (!date || !time) { setError("Date and kickoff time are required."); return; }
    setBusy(true); setError(null);
    try { await venueSeedKnockoutFromGroups(venueToken, competitionId, date, time, pitchId ? [pitchId] : []); await onDone(); }
    catch (e) { setError(e?.message || String(e)); setBusy(false); }
  }

  return (
    <Modal onClose={() => !busy && onClose()} title="Build knockout from group standings"
      foot={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Building…" : "Build knockout"}</button>
      </>}>
      <p className="text-mute" style={{ marginBottom: 14 }}>Seeds the knockout from the final group standings — group winners are kept apart. The first knockout round plays on:</p>
      <TieScheduleForm {...{ date, setDate, time, setTime, pitchId, setPitchId, pitches, error }} />
    </Modal>
  );
}
