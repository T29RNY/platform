// TeamManagerFixtureEdit.jsx — Manager's fixture editor (bottom-sheet). Reuses the SAME
// manager-auth RPCs the desktop editor uses so the record is identical and syncs both ways:
//   • options — clubManagerGetHomeFixtureOptions(fixtureId) → { ok, fixture{is_home,…}, pitches[], officials[] }
//   • save    — clubManagerUpdateHomeFixture(fixtureId, { playingAreaId, officialId, refName, kickoffTime, location, notes })
// Manager-gated + guarded server-side (mig 421/545/564):
//   • HOME fixture → set pitch, kick-off, referee, location, notes.
//   • AWAY fixture (mig 564) → set kick-off, location, notes ONLY; the pitch + referee are
//     the home club's (the RPC rejects a pitch/ref arg with 'away_pitch_ref_read_only', and
//     this screen hides those fields for away). The RPC also rejects pitch_not_in_venue /
//     ref_not_in_venue / slot_unavailable.
//
// Opened from the League FixtureCard for BOTH home and away fixtures. Renders through the
// shared MobileSheet (pinned footer) so the scrim clears the docked nav.

import { useState, useEffect, useCallback, useRef } from "react";
import { clubManagerGetHomeFixtureOptions, clubManagerUpdateHomeFixture } from "@platform/core";
import MobileSheet from "../MobileSheet.jsx";

export default function TeamManagerFixtureEdit({ fixtureId, opponentName, toast, onClose, onSaved }) {
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const [pitchId, setPitchId] = useState("");
  const [kickoff, setKickoff] = useState("");
  const [refMode, setRefMode] = useState("official"); // "official" | "named"
  const [officialId, setOfficialId] = useState("");
  const [refName, setRefName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setState({ loading: true, error: false, data: null });
    try {
      const res = await clubManagerGetHomeFixtureOptions(fixtureId);
      const fx = res?.fixture || {};
      setPitchId(fx.playing_area_id || "");
      setKickoff(fx.kickoff_time || "");
      setLocation(fx.location || "");
      setNotes(fx.notes || "");
      if (fx.official_id) { setRefMode("official"); setOfficialId(fx.official_id); }
      else if (fx.ref_name) { setRefMode("named"); setRefName(fx.ref_name); }
      setState({ loading: false, error: false, data: res });
    } catch {
      setState({ loading: false, error: true, data: null });
    }
  }, [fixtureId]);
  useEffect(() => { load(); }, [load]);

  const { loading, error, data } = state;
  const editable = data?.ok === true;
  const isHome = data?.fixture?.is_home !== false; // away fixtures hide pitch + referee
  const pitches = data?.pitches || [];
  const officials = data?.officials || [];

  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const useOfficial = isHome && refMode === "official" && officialId;
      await clubManagerUpdateHomeFixture(fixtureId, {
        // Pitch + referee are HOME-only — an away game is at the opponent's ground.
        playingAreaId: isHome ? (pitchId || null) : null,
        officialId: useOfficial ? officialId : null,
        refName: isHome && !useOfficial ? (refName.trim() || null) : null,
        kickoffTime: kickoff || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
      });
      toast?.({ icon: "check", text: "Fixture updated." });
      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error("[fixture-edit] update fixture failed", e);
      const reason = String(e?.message || "").toLowerCase();
      const msg = reason.includes("slot_unavailable") ? "That pitch is already booked at this time."
        : reason.includes("pitch_not_in_venue") ? "That pitch isn't at this venue."
        : reason.includes("ref_not_in_venue") ? "That referee isn't available for this venue."
        : reason.includes("away_pitch_ref_read_only") ? "The pitch and referee for an away game are set by the home club."
        : "Couldn't update the fixture.";
      toast?.({ icon: "alert", text: msg });
    } finally { savingRef.current = false; setSaving(false); }
  }, [fixtureId, isHome, pitchId, kickoff, refMode, officialId, refName, location, notes, toast, onSaved, onClose]);

  return (
    <MobileSheet
      title={opponentName ? `Edit · ${opponentName}` : "Edit fixture"}
      onClose={onClose}
      footer={editable ? (
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1, cursor: saving ? "default" : "pointer" }}>
          {saving ? "Saving…" : "Save fixture"}
        </button>
      ) : null}
    >
      {loading && <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading fixture…</p>}
      {error && (
        <div style={{ marginTop: 8 }}>
          <p style={{ color: "var(--ink2)", fontSize: 14 }}>Couldn't load this fixture.</p>
          <button onClick={load} style={retryBtn}>Try again</button>
        </div>
      )}

      {!loading && !error && !editable && (
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
          {data?.reason === "away_read_only"
            ? "This is an away fixture — its pitch, referee and kick-off are set by the home club or the venue."
            : "You can't edit this fixture."}
        </p>
      )}

      {!loading && !error && editable && (
        <div style={{ marginTop: 2 }}>
          {!isHome && (
            <div style={{ fontSize: 12, color: "var(--ink3)", background: "var(--s2)", border: "1px solid var(--hair2)", borderRadius: "var(--r-md)", padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>
              This is an away game, so the pitch and referee are set by the home club. You can still set the kick-off, ground / meeting point and notes for your players.
            </div>
          )}

          <label style={labelStyle}>Kick-off</label>
          <input type="time" value={kickoff} onChange={(e) => setKickoff(e.target.value)} style={inputStyle} />

          {isHome && (
            <>
              <label style={{ ...labelStyle, marginTop: 12 }}>Pitch</label>
              <select value={pitchId} onChange={(e) => setPitchId(e.target.value)} style={inputStyle}>
                <option value="">— No pitch set —</option>
                {pitches.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.venue_name ? ` · ${p.venue_name}` : ""}</option>
                ))}
              </select>

              <label style={{ ...labelStyle, marginTop: 12 }}>Referee</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {[["official", "From list"], ["named", "Enter a name"]].map(([id, lbl]) => {
                  const on = refMode === id;
                  return <button key={id} onClick={() => setRefMode(id)} style={{ ...segBtn, ...(on ? segOn : null) }}>{lbl}</button>;
                })}
              </div>
              {refMode === "official" ? (
                <select value={officialId} onChange={(e) => setOfficialId(e.target.value)} style={inputStyle}>
                  <option value="">— No referee set —</option>
                  {officials.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}{o.venue_name ? ` · ${o.venue_name}` : ""}</option>
                  ))}
                </select>
              ) : (
                <input value={refName} onChange={(e) => setRefName(e.target.value)} placeholder="Referee name" maxLength={80} style={inputStyle} />
              )}
            </>
          )}

          <label style={{ ...labelStyle, marginTop: 12 }}>Location / address</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={isHome ? "e.g. King's Rd car park entrance" : "e.g. away ground address or meeting point"} maxLength={200} style={inputStyle} />
          <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 5, lineHeight: 1.5 }}>
            {isHome ? "Leave blank to show the venue's address. Use this for away grounds or special meeting points." : "The away ground address or where to meet."}
          </div>

          <label style={{ ...labelStyle, marginTop: 12 }}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the players & parents should know" maxLength={500} rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 64 }} />

          <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 12, lineHeight: 1.5 }}>
            {isHome
              ? "You can set the pitch, kick-off, referee, location and notes. Opponent, date and home/away stay with the league."
              : "You can set the kick-off, location and notes. Opponent, date and home/away stay with the league."}
          </div>
        </div>
      )}
    </MobileSheet>
  );
}

const labelStyle = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink3)", letterSpacing: "0.02em", marginBottom: 5, fontFamily: "var(--m-font)" };
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: "var(--r-md)",
  background: "var(--s2)", border: "1px solid var(--hair2)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 15, outline: "none",
};
const segBtn = {
  flex: 1, height: 38, borderRadius: "var(--r-md)", cursor: "pointer", border: "1px solid var(--hair2)",
  background: "var(--s2)", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
};
const segOn = { background: "var(--amber-soft)", borderColor: "var(--amber-glow)", color: "var(--amber)" };
const primaryBtn = {
  width: "100%", padding: "13px", borderRadius: "var(--r-pill)",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontFamily: "var(--m-font)", fontSize: 14.5, fontWeight: 800,
};
const retryBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
};
