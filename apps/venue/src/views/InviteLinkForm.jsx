import React, { useState, useMemo } from "react";
import { venueCreateInviteLink, venueRepointInviteLink } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

// Create a new QR code, or re-point an existing one. Re-point is fully
// flexible — a code may move across entity types (team → venue → fixture),
// so the same target picker serves both modes. action is derived from the
// chosen entity type (the only valid pairing), matching the server check in
// mig 254 (venue_create_invite_link / venue_repoint_invite_link).

const ACTION_FOR = { venue: "venue_landing", team: "join_team", fixture: "match_checkin" };
const TYPE_LABEL = { venue: "This venue", team: "A team", fixture: "A fixture" };

export default function InviteLinkForm({ venueToken, state, mode, code, current, onDone, onClose }) {
  const repoint = mode === "repoint";
  const venue = state?.venue || {};
  const teams = useMemo(() => Object.values(state?.teams || {}), [state]);
  const fixtures = useMemo(() => {
    const g = state?.fixtures || {};
    const all = [...(g.tonight || []), ...(g.upcoming || []), ...(g.this || []), ...(g.recent || [])];
    const seen = new Set();
    return all.filter((f) => f && f.id && !seen.has(f.id) && seen.add(f.id));
  }, [state]);

  const [entityType, setEntityType] = useState(current?.entity_type || "team");
  const [entityId, setEntityId] = useState(
    repoint && current?.entity_type === (current?.entity_type) ? current?.entity_id : ""
  );
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Reset the chosen target whenever the entity type changes.
  function pickType(t) {
    setEntityType(t);
    setEntityId(t === "venue" ? (venue.id || "") : "");
  }

  const targetMissing = entityType !== "venue" && !entityId;

  async function save() {
    const targetId = entityType === "venue" ? venue.id : entityId;
    if (!targetId) { setError("Pick a target."); return; }
    setBusy(true); setError(null);
    try {
      if (repoint) {
        await venueRepointInviteLink(venueToken, code, entityType, targetId, ACTION_FOR[entityType]);
      } else {
        await venueCreateInviteLink(venueToken, entityType, targetId, ACTION_FOR[entityType], label.trim() || null);
      }
      onDone?.(); onClose();
    } catch (e) {
      setError(friendlyError(e?.message || String(e)));
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={repoint ? "Re-point code" : "New QR code"}
      footer={<>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy || targetMissing} className="btn-accent">
          {busy ? "Saving…" : repoint ? "Re-point" : "Create code"}
        </button>
      </>}>
      {repoint && (
        <p className="text-mute" style={{ fontSize: 13, marginTop: 0 }}>
          Anyone holding this code — printed posters, saved photos — will land on the new
          destination next time they scan. The code itself ({code}) does not change.
        </p>
      )}

      <label>Points to</label>
      <select value={entityType} onChange={(e) => pickType(e.target.value)}>
        {Object.keys(TYPE_LABEL).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
      </select>

      {entityType === "venue" && (
        <p className="text-mute" style={{ fontSize: 13 }}>
          Opens “what’s on at {venue.name || "this venue"}”.
        </p>
      )}

      {entityType === "team" && (
        <>
          <label>Team</label>
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">Choose a team…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {teams.length === 0 && <p className="text-mute" style={{ fontSize: 13 }}>No teams registered yet.</p>}
        </>
      )}

      {entityType === "fixture" && (
        <>
          <label>Fixture</label>
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">Choose a fixture…</option>
            {fixtures.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {(f.home_team_name || "Home")} v {(f.away_team_name || "bye")}
                {f.kickoff_time ? ` · ${f.kickoff_time}` : ""}
              </option>
            ))}
          </select>
          {fixtures.length === 0 && <p className="text-mute" style={{ fontSize: 13 }}>No nearby fixtures loaded.</p>}
        </>
      )}

      {!repoint && (
        <>
          <label>Label (optional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Bar poster, Reception desk" />
        </>
      )}

      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

function friendlyError(msg) {
  if (msg.includes("not_your_entity")) return "That target doesn’t belong to this venue.";
  if (msg.includes("action_entity_mismatch")) return "That destination type isn’t valid.";
  if (msg.includes("invalid_venue_token")) return "Your session has expired — sign in again.";
  if (msg.includes("invite_link_not_found")) return "That code no longer exists.";
  return msg;
}
