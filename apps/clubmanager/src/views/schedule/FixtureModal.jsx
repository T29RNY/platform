import React, { useRef, useState } from "react";
import { venueUpsertClubFixture } from "@platform/core/storage/supabase.js";
import Modal from "../../shell/Modal.jsx";
import { useToast } from "../../shell/toast.jsx";

// Create a club-league fixture. Venue-token write; the GROUND picker chooses
// which venue_id is the credential (Decision 2 — a write names its ground) and
// scopes the pitch list. A pitch/time collision throws slot_unavailable, caught
// and surfaced as a clash toast (no row is written on clash → zero residue).
export default function FixtureModal({ grounds, teams, leagues, onClose, onSaved }) {
  const t = useToast();
  const [leagueId, setLeagueId] = useState(leagues?.[0]?.id || leagues?.[0]?.league_id || "");
  const [teamId, setTeamId] = useState(teams?.[0]?.team_id || "");
  const [opponent, setOpponent] = useState("");
  const [isHome, setIsHome] = useState(true);
  const [date, setDate] = useState("");
  const [kickoff, setKickoff] = useState("10:00");
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
    if (!leagueId) { t.show("Create a league first (Club page).", "error"); return; }
    if (!teamId) { t.show("Pick a team.", "error"); return; }
    if (!opponent.trim()) { t.show("Enter the opponent.", "error"); return; }
    if (!date) { t.show("Pick a date.", "error"); return; }
    if (!pitchId) { t.show("Pick a pitch.", "error"); return; }
    savingRef.current = true; setBusy(true);
    const team = teams.find((x) => x.team_id === teamId);
    try {
      await venueUpsertClubFixture(groundId, {
        leagueId, clubTeamId: teamId, clubTeamName: team?.name || null,
        opponentName: opponent.trim(), isHome,
        scheduledDate: date, kickoffTime: kickoff,
        playingAreaId: pitchId,
      });
      t.show("Fixture added.");
      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.message === "slot_unavailable") {
        t.show("Pitch clash — that pitch is already booked at that time.", "error");
      } else {
        console.error("[clubmanager] fixture save failed", err);
        t.show("Couldn't save the fixture.", "error");
      }
    } finally {
      savingRef.current = false; setBusy(false);
    }
  };

  const noLeagues = !leagues || leagues.length === 0;

  return (
    <Modal title="New fixture" onClose={onClose}
      footer={
        <>
          <button className="small" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || noLeagues}>{busy ? "Saving…" : "Save"}</button>
        </>
      }>
      {noLeagues && <div className="state err" style={{ marginBottom: 10 }}>No league yet — create one on the Club page before adding fixtures.</div>}
      {leagues && leagues.length > 1 && (
        <label className="field"><span>League</span>
          <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
            {leagues.map((l) => <option key={l.id || l.league_id} value={l.id || l.league_id}>{l.name}</option>)}
          </select>
        </label>
      )}
      <div className="field-row">
        <label className="field"><span>Team</span>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {(teams || []).map((tm) => <option key={tm.team_id} value={tm.team_id}>{tm.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Home / away</span>
          <select value={isHome ? "home" : "away"} onChange={(e) => setIsHome(e.target.value === "home")}>
            <option value="home">Home</option>
            <option value="away">Away</option>
          </select>
        </label>
      </div>
      <label className="field"><span>Opponent</span>
        <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="e.g. Earlsdon Lions U7" />
      </label>
      <div className="field-row">
        <label className="field"><span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field"><span>Kick-off</span>
          <input type="time" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
        </label>
      </div>
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
