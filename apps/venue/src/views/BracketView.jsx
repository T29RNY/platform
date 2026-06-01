import React, { useEffect, useMemo, useState, useCallback } from "react";
import { getCupBracket, getGroupStandings, venueScheduleCupTie, venueSeedKnockoutFromGroups } from "@platform/core";
import Modal from "./Modal.jsx";

// Phase 11 Cycle 11.3 — venue-side cup bracket + scheduling.
// Lists the venue's single-elim cup competitions, renders the bracket tree
// (rounds as columns), and lets the operator schedule each 'ready' next-round tie.

const fmtDate = (d) => {
  if (!d) return "";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch (e) { return d; }
};

const DECIDER_NOTE = {
  penalties: "on penalties",
  extra_time: "after extra time",
  walkover: "walkover",
  forfeit: "forfeit",
};

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

  useEffect(() => {
    if (!compId && cups[0]) setCompId(cups[0].id);
  }, [cups, compId]);

  const load = useCallback(async () => {
    if (!compId) { setBracket(null); setGroups(null); return; }
    setLoading(true); setError(null);
    try {
      const [bk, gs] = await Promise.all([
        getCupBracket(compId),
        isGroupStage ? getGroupStandings(compId) : Promise.resolve(null),
      ]);
      setBracket(bk);
      setGroups(gs);
    } catch (e) {
      setError(e?.message || String(e));
    } finally { setLoading(false); }
  }, [compId, isGroupStage]);

  useEffect(() => { load(); }, [load]);

  if (!cups.length) {
    return (
      <main className="content">
        <section className="panel">
          <h2 className="panel-title">Cups</h2>
          <p className="muted">No knockout cups yet. Create one from “Set up new season” and pick the cup format.</p>
        </section>
      </main>
    );
  }

  const rounds = bracket?.rounds ?? [];
  const champion = bracket?.champion;

  return (
    <main className="content">
      <section className="panel">
        <div className="panel-head-row">
          <h2 className="panel-title">Cups</h2>
          {cups.length > 1 && (
            <select value={compId ?? ""} onChange={(e) => setCompId(e.target.value)} aria-label="Choose cup">
              {cups.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {loading && <p className="muted">Loading bracket…</p>}
        {error && <p className="error">{error}</p>}

        {champion && (
          <div className="bracket-champion">🏆 Champion: <strong>{champion.name}</strong></div>
        )}

        {!loading && !error && isGroupStage && groups?.groups?.length > 0 && (
          <GroupsPanel groups={groups.groups} />
        )}

        {!loading && !error && isGroupStage && !bracket?.knockout_seeded && (
          <div style={{ margin: "12px 0" }}>
            {bracket?.all_groups_complete ? (
              <button className="btn-accent" onClick={() => setBuildOpen(true)}>Build knockout</button>
            ) : (
              <p className="muted">
                Group stage in progress. Once every group fixture is played, “Build knockout” seeds the bracket from the final standings.
              </p>
            )}
          </div>
        )}

        {!loading && !error && (
          <div className="bracket-scroll">
            <div className="bracket-rounds">
              {rounds.map((rd) => (
                <div className="bracket-round" key={rd.round_number}>
                  <div className="bracket-round-name">{rd.round_name}</div>
                  {(rd.ties ?? []).map((tie) => (
                    <TieCard key={tie.id} tie={tie} onSchedule={() => setScheduleTie(tie)} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {scheduleTie && (
        <ScheduleTieModal
          tie={scheduleTie}
          pitches={pitches}
          venueToken={venueToken}
          onClose={() => setScheduleTie(null)}
          onDone={async () => { setScheduleTie(null); await load(); onRefresh?.(); }}
        />
      )}

      {buildOpen && (
        <BuildKnockoutModal
          competitionId={compId}
          pitches={pitches}
          venueToken={venueToken}
          onClose={() => setBuildOpen(false)}
          onDone={async () => { setBuildOpen(false); await load(); onRefresh?.(); }}
        />
      )}
    </main>
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
    try {
      await venueSeedKnockoutFromGroups(venueToken, competitionId, date, time, pitchId ? [pitchId] : []);
      await onDone();
    } catch (e) { setError(e?.message || String(e)); setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()}
      title="Build knockout from group standings"
      footer={<>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Building…" : "Build knockout"}</button>
      </>}>
      <p className="muted">Seeds the knockout bracket from the final group standings — group winners are kept apart. The first knockout round plays on:</p>
      <div className="form-row">
        <div><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label>Kickoff</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <label>Pitch</label>
      <select value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
        <option value="">Unallocated</option>
        {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

function GroupsPanel({ groups }) {
  return (
    <div className="groups-grid" style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
      {groups.map((g) => (
        <div key={g.group_label} className="group-table" style={{ flex: "1 1 280px", minWidth: 260 }}>
          <h3 style={{ margin: "0 0 6px" }}>Group {g.group_label}</h3>
          <table className="standings-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--text-dim, #888)" }}>
                <th style={{ textAlign: "left" }}>Team</th>
                <th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {(g.standings ?? []).map((s) => (
                <tr key={s.team_id} className={s.qualifying ? "is-qualifying" : ""}
                    style={s.qualifying ? { fontWeight: 600 } : undefined}>
                  <td style={{ textAlign: "left" }}>
                    {s.qualifying && <span aria-hidden style={{ color: "#2a2", marginRight: 4 }}>●</span>}
                    {s.team_name}
                  </td>
                  <td style={{ textAlign: "right" }}>{s.played}</td>
                  <td style={{ textAlign: "right" }}>{s.w}</td>
                  <td style={{ textAlign: "right" }}>{s.d}</td>
                  <td style={{ textAlign: "right" }}>{s.l}</td>
                  <td style={{ textAlign: "right" }}>{s.gd}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{s.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function TieCard({ tie, onSchedule }) {
  const winH = tie.winner_team_id && tie.winner_team_id === tie.home_team_id;
  const winA = tie.winner_team_id && tie.winner_team_id === tie.away_team_id;
  const hasScore = tie.home_score != null && tie.away_score != null;
  const note = tie.decided_by && DECIDER_NOTE[tie.decided_by];
  const teamLabel = (name, src) =>
    name || (src === "bye" ? "(bye)" : src === "winner" ? "TBD" : "TBD");

  return (
    <div className={`bracket-tie bracket-tie-${tie.status}`}>
      <div className={`bracket-row${winH ? " is-winner" : ""}`}>
        <span className="bracket-team">{teamLabel(tie.home_team_name, tie.home_source)}</span>
        {hasScore && <span className="bracket-score">{tie.home_score}</span>}
      </div>
      <div className={`bracket-row${winA ? " is-winner" : ""}`}>
        <span className="bracket-team">{tie.away_team_name == null && tie.home_source === "bye" ? "—" : teamLabel(tie.away_team_name, tie.away_source)}</span>
        {hasScore && <span className="bracket-score">{tie.away_score}</span>}
      </div>
      <div className="bracket-meta">
        {tie.status === "decided" && note && <span className="bracket-tag">{note}</span>}
        {tie.status === "decided" && !note && <span className="bracket-tag">full time</span>}
        {tie.status === "scheduled" && tie.scheduled_date && (
          <span className="bracket-tag">{fmtDate(tie.scheduled_date)}{tie.kickoff_time ? ` · ${String(tie.kickoff_time).slice(0,5)}` : ""}</span>
        )}
        {tie.status === "ready" && (
          <button className="btn-accent btn-sm" onClick={onSchedule}>Schedule</button>
        )}
        {tie.status === "pending" && <span className="bracket-tag muted">awaiting teams</span>}
      </div>
    </div>
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
    try {
      await venueScheduleCupTie(venueToken, tie.id, date, time, pitchId || null);
      await onDone();
    } catch (e) { setError(e?.message || String(e)); setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()}
      title={`Schedule ${tie.home_team_name} v ${tie.away_team_name}`}
      footer={<>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn-accent">{busy ? "Scheduling…" : "Schedule tie"}</button>
      </>}>
      <div className="form-row">
        <div>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label>Kickoff</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <label>Pitch</label>
      <select value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
        <option value="">Unallocated</option>
        {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
