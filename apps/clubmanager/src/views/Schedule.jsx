import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getOperatorPitchOccupancy,
  clubListTeams,
  venueListClubLeagues,
} from "@platform/core/storage/supabase.js";
import FixtureModal from "./schedule/FixtureModal.jsx";
import SessionSeriesModal from "./schedule/SessionSeriesModal.jsx";
import BumpProposals from "./schedule/BumpProposals.jsx";

// Schedule — a clash-aware, multi-ground calendar over the pitch-occupancy
// ledger. Read is getOperatorPitchOccupancy (all grounds sharing the operator's
// company, each with its pitches + occupancy). Writes (fixtures, training
// series) go through the venue-token creators, which the occupancy trigger
// guards — a collision throws slot_unavailable (surfaced), a higher-priority
// club event bumps the incumbent (→ a bump proposal, resolved in the panel).
const DAY_MS = 86400000;
const WINDOW_DAYS = 21;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function dayKey(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(iso) {
  const d = new Date(iso);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}
function occLabel(o) {
  const d = o.detail || {};
  if (o.source_kind === "club_fixture") return `${d.our_team || "Team"} ${d.is_home ? "vs" : "@"} ${d.opponent || "TBC"}`;
  if (o.source_kind === "club_session") return `${d.title || "Training"}${d.team_name ? ` · ${d.team_name}` : ""}`;
  if (o.source_kind === "fixture") return `${d.home_team || "?"} v ${d.away_team || "?"}`;
  if (o.source_kind === "booking") return `${d.team_name || "Booking"}`;
  if (o.source_kind === "maintenance") return "Maintenance";
  return o.source_kind;
}
const KIND_CLASS = {
  club_fixture: "warn", club_session: "good", fixture: "warn",
  booking: "", maintenance: "danger",
};

export default function Schedule({ venueId, clubId }) {
  const [state, setState] = useState({ loading: true, error: false, venues: [] });
  const [teams, setTeams] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [modal, setModal] = useState(null);  // "fixture" | "series" | null

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from.getTime() + WINDOW_DAYS * DAY_MS);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, venues: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await getOperatorPitchOccupancy(venueId, range.from, range.to);
      setState({ loading: false, error: false, venues: res?.venues || [] });
    } catch (err) {
      console.error("[clubmanager] occupancy load failed", err);
      setState({ loading: false, error: true, venues: [] });
    }
  }, [venueId, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  // pickers for the modals
  useEffect(() => {
    if (!venueId || !clubId) return;
    let cancelled = false;
    clubListTeams(venueId, clubId, false).then((t) => { if (!cancelled) setTeams(Array.isArray(t) ? t : []); }).catch(() => {});
    venueListClubLeagues(venueId, clubId).then((l) => {
      if (cancelled) return;
      setLeagues(Array.isArray(l) ? l : (l?.leagues || []));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [venueId, clubId]);

  const { loading, error, venues } = state;
  // grounds with pitches, for the modal target-venue + pitch pickers
  const grounds = venues.map((v) => ({ venue_id: v.venue_id, venue_name: v.venue_name, pitches: v.pitches || [] }));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Schedule</h2>
          <p className="sub">Training, fixtures and pitch clashes across your grounds.</p>
        </div>
        <div className="page-actions">
          <button className="small" onClick={() => setModal("series")} disabled={grounds.length === 0}>+ Training</button>
          <button className="primary" onClick={() => setModal("fixture")} disabled={grounds.length === 0}>+ Fixture</button>
        </div>
      </div>

      <BumpProposals venueId={venueId} onResolved={load} />

      {loading && <div className="tile"><div className="state">Loading the calendar…</div></div>}
      {error && (
        <div className="tile">
          <div className="state err">Couldn't load the schedule.</div>
          <button className="retry" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && venues.every((v) => (v.occupancy || []).length === 0) && (
        <div className="tile"><div className="state">Nothing booked in the next 3 weeks. Add a fixture or training series to start.</div></div>
      )}

      {!loading && !error && venues.map((v) => {
        const occ = (v.occupancy || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
        if (occ.length === 0) return null;
        const byDay = {};
        occ.forEach((o) => { (byDay[dayKey(o.start)] ||= []).push(o); });
        return (
          <div key={v.venue_id} className="cohort-card">
            <div className="cohort-head">
              <span className="cohort-name">{v.venue_name}{v.is_self ? "" : " (partner ground)"}</span>
              <span className="chip">{occ.length} booked</span>
            </div>
            {Object.keys(byDay).map((k) => (
              <div key={k} className="sched-day">
                <div className="sched-daylabel">{dayLabel(byDay[k][0].start)}</div>
                <table className="atable">
                  <tbody>
                    {byDay[k].map((o) => (
                      <tr key={o.id}>
                        <td style={{ width: 96, color: "var(--t2)" }}>{fmtTime(o.start)}–{fmtTime(o.end)}</td>
                        <td style={{ width: 130 }}>{o.pitch_name}</td>
                        <td>
                          <span className={`rag rag--${KIND_CLASS[o.source_kind] || "good"}`}><span className="dot" /></span>{" "}
                          {occLabel(o)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        );
      })}

      {modal === "fixture" && (
        <FixtureModal grounds={grounds} teams={teams} leagues={leagues}
          onClose={() => setModal(null)} onSaved={load} />
      )}
      {modal === "series" && (
        <SessionSeriesModal clubId={clubId} grounds={grounds} teams={teams}
          onClose={() => setModal(null)} onSaved={load} />
      )}
    </>
  );
}
