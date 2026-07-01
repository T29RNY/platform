import React, { useState, useEffect, useCallback } from "react";
import { hqListEscalatedIncidents } from "@platform/core";

// Company-wide escalation inbox (mig 463/464 → hq_list_escalated_incidents).
// Cross-venue: the incidents venue operators have pushed up to HQ, region-scoped
// server-side (regional_admin sees own region; analyst may read but not resolve).
// Resolve reuses the existing hq_resolve_incident via the App-level onResolve.
export default function EscalatedInbox({ companyId, canResolve, onResolve }) {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) { setRows([]); return; }
    try {
      const r = await hqListEscalatedIncidents(companyId);
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      console.error("[hq] escalated inbox load failed", e);
      setRows([]);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id) => {
    setBusyId(id);
    try {
      await onResolve(id, null);
      await load();
    } catch (e) {
      console.error("[hq] escalated resolve failed", e);
    } finally {
      setBusyId(null);
    }
  };

  const list = rows || [];
  return (
    <div className="section">
      <h2>Escalated to HQ {list.length > 0 && <span className="badge danger">{list.length}</span>}</h2>
      {rows === null && <div className="muted">Loading…</div>}
      {rows !== null && list.length === 0 && <div className="empty">Nothing escalated 🎉</div>}
      {list.map((i) => (
        <div className="list-row" key={i.id}>
          <div className="lr-top">
            <span className={"badge " + (i.priority === "urgent" ? "danger" : i.priority === "high" ? "warn" : "")}>
              {i.priority || "normal"}
            </span>
            <span className="lr-desc">{i.description}</span>
            {canResolve && (
              <button className="small" disabled={busyId === i.id} onClick={() => resolve(i.id)}>
                {busyId === i.id ? "…" : "Resolve"}
              </button>
            )}
          </div>
          <div className="lr-meta">
            {i.venue_name}
            {i.category ? ` · ${i.category}` : ""}
            {i.assigned_to_name ? ` · ${i.assigned_to_name}` : " · unassigned"}
            {i.escalated_at ? ` · escalated ${fmtAge(i.escalated_at)}` : ""}
          </div>
          {i.escalation_reason && (
            <div className="lr-meta" style={{ fontStyle: "italic" }}>“{i.escalation_reason}”</div>
          )}
        </div>
      ))}
    </div>
  );
}

function fmtAge(ts) {
  if (!ts) return "";
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch (e) { return ""; }
}
