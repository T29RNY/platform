import React, { useRef, useState } from "react";
import { clubCreateCohort, clubUpdateCohort } from "@platform/core/storage/supabase.js";
import Modal from "../../shell/Modal.jsx";
import { useToast } from "../../shell/toast.jsx";

// Create / edit an age-group cohort. Venue-token write (venue_id credential;
// server gates on manage_memberships). Optimistic-UI is handled by the parent
// re-fetch on onSaved; this modal owns the saving-guard + toast.
export default function CohortModal({ venueId, clubId, cohort, onClose, onSaved }) {
  const isEdit = !!cohort;
  const t = useToast();
  const [name, setName] = useState(cohort?.name || "");
  const [category, setCategory] = useState(cohort?.category || "");
  const [minAge, setMinAge] = useState(cohort?.min_age ?? "");
  const [maxAge, setMaxAge] = useState(cohort?.max_age ?? "");
  const [active, setActive] = useState(cohort?.active ?? true);
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  const save = async () => {
    if (savingRef.current) return;
    if (!name.trim()) { t.show("Give the cohort a name.", "error"); return; }
    savingRef.current = true; setBusy(true);
    const payload = {
      name: name.trim(),
      category: category.trim() || null,
      minAge: minAge === "" ? null : Number(minAge),
      maxAge: maxAge === "" ? null : Number(maxAge),
    };
    try {
      if (isEdit) {
        await clubUpdateCohort(venueId, cohort.cohort_id, { ...payload, active });
      } else {
        await clubCreateCohort(venueId, clubId, payload);
      }
      t.show(isEdit ? "Cohort updated." : "Cohort created.");
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error("[clubmanager] cohort save failed", err);
      t.show("Couldn't save the cohort.", "error");
    } finally {
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "Edit cohort" : "New cohort"}
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Under 7s" autoFocus />
      </label>
      <label className="field">
        <span>Category <span className="muted">(optional)</span></span>
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. youth" />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Min age</span>
          <input type="number" min="0" value={minAge} onChange={(e) => setMinAge(e.target.value)} />
        </label>
        <label className="field">
          <span>Max age</span>
          <input type="number" min="0" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
        </label>
      </div>
      {isEdit && (
        <label className="field-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active {!active && <span className="muted">— archived cohorts are hidden</span>}</span>
        </label>
      )}
    </Modal>
  );
}
