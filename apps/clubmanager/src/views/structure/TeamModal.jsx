import React, { useRef, useState } from "react";
import { clubCreateTeam, clubUpdateTeam } from "@platform/core/storage/supabase.js";
import Modal from "../../shell/Modal.jsx";
import { useToast } from "../../shell/toast.jsx";

const GENDERS = ["mixed", "boys", "girls"];

// Create / edit a team within a cohort. Venue-token write.
export default function TeamModal({ venueId, clubId, cohorts, team, presetCohortId, onClose, onSaved }) {
  const isEdit = !!team;
  const t = useToast();
  const [name, setName] = useState(team?.name || "");
  const [cohortId, setCohortId] = useState(team?.cohort_id || presetCohortId || cohorts?.[0]?.cohort_id || "");
  const [gender, setGender] = useState(team?.gender || "mixed");
  const [priorityRank, setPriorityRank] = useState(team?.priority_rank ?? "");
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  const save = async () => {
    if (savingRef.current) return;
    if (!name.trim()) { t.show("Give the team a name.", "error"); return; }
    if (!cohortId) { t.show("Pick a cohort.", "error"); return; }
    savingRef.current = true; setBusy(true);
    const payload = {
      name: name.trim(),
      cohortId,
      gender,
      priorityRank: priorityRank === "" ? null : Number(priorityRank),
    };
    try {
      if (isEdit) await clubUpdateTeam(venueId, team.team_id, payload);
      else await clubCreateTeam(venueId, clubId, payload);
      t.show(isEdit ? "Team updated." : "Team created.");
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error("[clubmanager] team save failed", err);
      t.show("Couldn't save the team.", "error");
    } finally {
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "Edit team" : "New team"}
      onClose={onClose}
      footer={
        <>
          <button className="small" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. U7 Dortmund" autoFocus />
      </label>
      <label className="field">
        <span>Cohort</span>
        <select value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
          {(cohorts || []).map((c) => <option key={c.cohort_id} value={c.cohort_id}>{c.name}</option>)}
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Gender</span>
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Priority <span className="muted">(pitch rank)</span></span>
          <input type="number" min="0" value={priorityRank} onChange={(e) => setPriorityRank(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
