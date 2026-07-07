import React, { useState, useEffect, useCallback } from "react";
import {
  adminListTournamentReports,
  adminHideTournament,
} from "@platform/core/storage/supabase.js";

// UGC moderation queue (migs 495/497). Lists every self-serve tournament that has
// been reported by the public (tournament_report), aggregated by reason, newest
// report first. A platform admin hides/unhides a tournament from its public page
// via admin_hide_tournament. This is the operator-facing consumer of the
// tournament_reports inbox — the loop the report affordance feeds.

const REASON_LABEL = {
  offensive: "Offensive",
  inappropriate: "Inappropriate",
  spam: "Spam",
  impersonation: "Impersonation",
  other: "Other",
};

function fmtWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function Moderation() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await adminListTournamentReports();
      setReports(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleHide(t) {
    if (busyId) return;
    const nextHidden = !t.hidden_at;
    setBusyId(t.tournament_id);
    setError(null);
    try {
      await adminHideTournament(t.tournament_id, nextHidden, nextHidden ? "moderation" : null);
      await load();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (reports === null && !error) {
    return (
      <div className="section">
        <h2 style={{ margin: 0, marginBottom: 8 }}>Moderation</h2>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="section">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ margin: 0, marginBottom: 4 }}>Reported tournaments</h2>
        <button onClick={load} disabled={!!busyId}>Refresh</button>
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
        Public reports of self-serve tournaments, newest first. Hide takes the
        tournament down from its public page immediately (a soft-hide — reversible
        with Unhide). Offensive team names are removed by the organiser; this queue
        is for the tournament itself.
      </p>

      {error && <div className="error" style={{ marginBottom: 12 }}>Error: {error}</div>}

      {reports && reports.length === 0 && <p className="muted">No reports. Nothing to review. 🎉</p>}

      <div style={{ display: "grid", gap: 8 }}>
        {(reports || []).map((t) => {
          const hidden = !!t.hidden_at;
          const reasons = t.reasons || {};
          const notes = t.recent_notes || [];
          return (
            <div key={t.tournament_id} className="card" style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 600 }}>
                    {t.name || "(unnamed)"}{" "}
                    <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                      {t.club_name ? `· ${t.club_name}` : t.venue_name ? `· ${t.venue_name}` : ""}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    <span>{t.total_reports} report{t.total_reports === 1 ? "" : "s"}</span>
                    {" · "}
                    <span>latest {fmtWhen(t.latest_report_at)}</span>
                    {" · "}
                    <span>status {t.status}</span>
                    {t.slug ? <> · <code className="mono">/tournament/{t.slug}</code></> : null}
                  </div>
                </div>
                <span
                  className="pill"
                  style={{
                    padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                    background: hidden ? "#3d1212" : "#3a3410",
                    color: hidden ? "#ff8080" : "#e8cf5a",
                  }}
                >
                  {hidden ? "Hidden" : "Visible"}
                </span>
                <button disabled={busyId === t.tournament_id} onClick={() => toggleHide(t)}>
                  {busyId === t.tournament_id ? "…" : hidden ? "Unhide" : "Hide"}
                </button>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.entries(reasons).map(([reason, count]) => (
                  <span
                    key={reason}
                    className="pill"
                    style={{
                      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                      background: "#1a1a20", color: "#c7c7d1",
                    }}
                  >
                    {REASON_LABEL[reason] || reason} · {count}
                  </span>
                ))}
              </div>

              {notes.length > 0 && (
                <div className="muted" style={{ fontSize: 12, display: "grid", gap: 3 }}>
                  {notes.map((n, i) => (
                    <div key={i}>
                      <span style={{ opacity: 0.7 }}>{REASON_LABEL[n.reason] || n.reason}:</span>{" "}
                      “{n.note}”
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
