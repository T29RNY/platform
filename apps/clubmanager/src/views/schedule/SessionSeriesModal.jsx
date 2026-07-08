import React, { useRef, useState } from "react";
import { clubCreateSessionSeries } from "@platform/core/storage/supabase.js";
import Modal from "../../shell/Modal.jsx";
import { useToast } from "../../shell/toast.jsx";

// Create a recurring training series. Venue-token write; the ground picker names
// the venue_id + pitch. Same clash contract as fixtures — a colliding slot
// throws slot_unavailable, surfaced as a toast.
const DAYS = [
  { v: 1, label: "Monday" }, { v: 2, label: "Tuesday" }, { v: 3, label: "Wednesday" },
  { v: 4, label: "Thursday" }, { v: 5, label: "Friday" }, { v: 6, label: "Saturday" }, { v: 0, label: "Sunday" },
];

export default function SessionSeriesModal({ clubId, grounds, teams, onClose, onSaved }) {
  const t = useToast();
  const [title, setTitle] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(2);
  const [startTime, setStartTime] = useState("18:00");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [teamId, setTeamId] = useState("");
  const [groundId, setGroundId] = useState(grounds?.[0]?.venue_id || "");
  const ground = grounds.find((g) => g.venue_id === groundId) || grounds[0];
  const pitches = ground?.pitches || [];
  const [pitchId, setPitchId] = useState(pitches?.[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  const onGround = (id) => {
    setGroundId(id);
    const g = grounds.find((x) => x.venue_id === id);
    setPitchId(g?.pitches?.[0]?.id || "");
  };

  const save = async () => {
    if (savingRef.current) return;
    if (!title.trim()) { t.show("Give the session a name.", "error"); return; }
    if (!fromDate || !toDate) { t.show("Set the start and end dates.", "error"); return; }
    savingRef.current = true; setBusy(true);
    try {
      await clubCreateSessionSeries(groundId, clubId, {
        title: title.trim(), sessionType: "training",
        dayOfWeek, startTime, fromDate, toDate,
        teamId: teamId || null,
        venueId: groundId, playingAreaId: pitchId || null,
      });
      t.show("Training series added.");
      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.message === "slot_unavailable") {
        t.show("Pitch clash — that pitch is already booked at that time.", "error");
      } else {
        console.error("[clubmanager] session series save failed", err);
        t.show("Couldn't save the series.", "error");
      }
    } finally {
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <Modal title="New training series" onClose={onClose}
      footer={
        <>
          <button className="small" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </>
      }>
      <label className="field"><span>Name</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. U7 Tuesday training" autoFocus />
      </label>
      <div className="field-row">
        <label className="field"><span>Day</span>
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
            {DAYS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Start time</span>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field"><span>From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="field"><span>Until</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
      </div>
      <label className="field"><span>Team <span className="muted">(optional)</span></span>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Whole cohort / unassigned</option>
          {(teams || []).map((tm) => <option key={tm.team_id} value={tm.team_id}>{tm.name}</option>)}
        </select>
      </label>
      <div className="field-row">
        <label className="field"><span>Ground</span>
          <select value={groundId} onChange={(e) => onGround(e.target.value)}>
            {grounds.map((g) => <option key={g.venue_id} value={g.venue_id}>{g.venue_name}</option>)}
          </select>
        </label>
        <label className="field"><span>Pitch</span>
          <select value={pitchId} onChange={(e) => setPitchId(e.target.value)}>
            {pitches.length === 0 && <option value="">No pitches</option>}
            {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  );
}
