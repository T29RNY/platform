import React, { useMemo, useRef, useState } from "react";
import { clubUpdateCohort, clubArchiveTeam } from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";

// Season rollover — the annual grassroots must-have, ported from the retired
// clubmanager into the venue console's Structure tab (Club Console Consolidation
// PR #2d). Promotes each cohort a year (U11 → U12, min/max age +1) and archives
// last season's teams in one reviewed pass. COMPOSES existing venue-token writers
// (clubUpdateCohort + clubArchiveTeam) — no new backend.
//
// Deliberately out (documented): auto-carrying rosters forward — club roster
// membership is coach-auth (no venue-token roster writer), so players re-join the
// promoted teams via the existing membership/QR join flow. The rollover here is
// the structural roll-forward (age bands + archiving), which is the annual pain.

// "U11" → "U12"; "Under 11s" → "Under 12s"; leaves non-age labels unchanged.
function rollLabel(name) {
  const s = String(name || "");
  const mU = s.match(/^([Uu])\s*(\d+)(.*)$/);
  if (mU) return `${mU[1]}${Number(mU[2]) + 1}${mU[3]}`;
  const mUnder = s.match(/^(Under\s+)(\d+)(.*)$/i);
  if (mUnder) return `${mUnder[1]}${Number(mUnder[2]) + 1}${mUnder[3]}`;
  return s;
}
const bump = (v) => (v == null ? null : Number(v) + 1);

export default function SeasonRolloverModal({ venueToken, cohorts, teams, onClose, onDone }) {
  const activeCohorts = useMemo(() => (cohorts || []).filter((c) => c.active !== false), [cohorts]);
  const activeTeams = useMemo(() => teams || [], [teams]);   // clubListTeams already excludes archived

  // per-cohort roll plan. Adult/open-age cohorts default OFF — their age band
  // shouldn't creep up every season (youth banding is the intended behaviour).
  const [rolls, setRolls] = useState(() => {
    const m = {};
    activeCohorts.forEach((c) => {
      const isAdult = String(c.category || "").toLowerCase() === "adult";
      m[c.cohort_id] = { on: !isAdult, newName: rollLabel(c.name) };
    });
    return m;
  });
  // per-team archive plan
  const [archives, setArchives] = useState(() => {
    const m = {}; activeTeams.forEach((tm) => { m[tm.team_id] = true; }); return m;
  });

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind:'error', text } — only on partial failure
  const savingRef = useRef(false);

  const setRoll = (id, patch) => setRolls((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const rollCount = Object.values(rolls).filter((r) => r.on).length;
  const archiveCount = Object.values(archives).filter(Boolean).length;

  const run = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(true); setFeedback(null);
    let ok = 0, fail = 0;
    const doneCohorts = [], doneTeams = [];
    try {
      for (const c of activeCohorts) {
        const r = rolls[c.cohort_id];
        if (!r?.on) continue;
        try {
          await clubUpdateCohort(venueToken, c.cohort_id, {
            name: (r.newName || c.name).trim(),
            minAge: bump(c.min_age),
            maxAge: bump(c.max_age),
          });
          ok++; doneCohorts.push(c.cohort_id);
        } catch (err) { console.error("[season-rollover] cohort failed", c.cohort_id, err); fail++; }
      }
      for (const tm of activeTeams) {
        if (!archives[tm.team_id]) continue;
        try { await clubArchiveTeam(venueToken, tm.team_id); ok++; doneTeams.push(tm.team_id); }
        catch (err) { console.error("[season-rollover] archive failed", tm.team_id, err); fail++; }
      }
      onDone?.();   // refresh the parent either way so it reflects what DID apply
      if (fail === 0) {
        onClose?.();
      } else {
        // Turn OFF everything that already succeeded so a retry re-applies ONLY the
        // failures — never double-promotes a cohort that already rolled forward.
        setRolls((prev) => { const n = { ...prev }; doneCohorts.forEach((id) => { n[id] = { ...n[id], on: false }; }); return n; });
        setArchives((prev) => { const n = { ...prev }; doneTeams.forEach((id) => { n[id] = false; }); return n; });
        setFeedback({ kind: "error", text: `${ok} applied, ${fail} couldn’t be saved — still selected below. Press Roll over to retry just those.` });
      }
    } finally {
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <Modal
      title="Season rollover"
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || (rollCount === 0 && archiveCount === 0)}>
            {busy ? "Rolling over…" : `Roll over (${rollCount} + ${archiveCount})`}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 13, color: "var(--ink-3)" }}>
        Promote each age group a year and archive last season’s teams. Players re-join the
        promoted teams through your normal join links — rosters aren’t moved automatically.
      </p>

      {feedback && (
        <div className="banner banner-warn" style={{ margin: "10px 0" }}>{feedback.text}</div>
      )}

      <h4 style={{ margin: "14px 0 8px", fontSize: 13 }}>Promote cohorts</h4>
      {activeCohorts.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-3)" }}>No active cohorts to promote.</p>
      ) : activeCohorts.map((c) => {
        const r = rolls[c.cohort_id] || { on: true, newName: rollLabel(c.name) };
        return (
          <div key={c.cohort_id} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
            <input type="checkbox" checked={r.on} onChange={(e) => setRoll(c.cohort_id, { on: e.target.checked })} style={{ marginTop: 4 }} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "var(--ink)", textDecoration: r.on ? "none" : "line-through" }}>{c.name}</span>
              <span style={{ color: "var(--ink-3)" }}>→</span>
              <input className="input" value={r.newName}
                onChange={(e) => setRoll(c.cohort_id, { newName: e.target.value })}
                disabled={!r.on} style={{ maxWidth: 160, height: 34 }} />
              {(c.min_age != null || c.max_age != null) && (
                <span className="chip">{c.min_age ?? "?"}–{c.max_age ?? "?"} → {bump(c.min_age) ?? "?"}–{bump(c.max_age) ?? "?"} yrs</span>
              )}
            </div>
          </div>
        );
      })}

      <h4 style={{ margin: "16px 0 8px", fontSize: 13 }}>Archive teams</h4>
      {activeTeams.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-3)" }}>No active teams to archive.</p>
      ) : activeTeams.map((tm) => (
        <label key={tm.team_id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={!!archives[tm.team_id]} onChange={(e) => setArchives((a) => ({ ...a, [tm.team_id]: e.target.checked }))} />
          <span>{tm.name} <span style={{ color: "var(--ink-3)" }}>({tm.member_count ?? 0} players)</span></span>
        </label>
      ))}
      <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12 }}>
        Archived teams are hidden, not deleted — their history is kept. You can create this
        season’s teams fresh in each promoted cohort afterwards.
      </p>
    </Modal>
  );
}
