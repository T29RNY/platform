import React, { useCallback, useEffect, useState } from "react";
import { venueListClubStaff } from "@platform/core/storage/supabase.js";

// DBS compliance tile — the welfare/ops "who's cleared" glance.
// Self-loads venue_list_club_staff (venue-token = venue_id credential) and
// classifies each active coach's DBS into red/amber/green. Full loading/error/
// empty triad (mirrors GuardianMatches). Real surfacing only — the hard-block on
// assigning a non-valid coach is a PR #11 product+legal decision, not enforced here.
const WARN_DAYS = 60;

function classify(row, now) {
  if (!row.dbs_id || !row.dbs_status) return "danger";       // no check on file
  const s = String(row.dbs_status).toLowerCase();
  if (s !== "valid" && s !== "verified" && s !== "clear") return "danger";
  if (row.dbs_expiry_date) {
    const exp = new Date(row.dbs_expiry_date + "T00:00:00");
    if (!isNaN(exp.getTime())) {
      const days = (exp.getTime() - now.getTime()) / 86400000;
      if (days < 0) return "danger";
      if (days <= WARN_DAYS) return "warn";
    }
  }
  return "good";
}

export default function ComplianceTile({ venueId, clubId }) {
  const [state, setState] = useState({ loading: true, error: false, staff: [] });

  const load = useCallback(async () => {
    if (!venueId || !clubId) { setState({ loading: false, error: false, staff: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const staff = await venueListClubStaff(venueId, clubId);
      setState({ loading: false, error: false, staff: Array.isArray(staff) ? staff : [] });
    } catch {
      setState({ loading: false, error: true, staff: [] });
    }
  }, [venueId, clubId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, staff } = state;

  if (loading) {
    return (
      <div className="tile">
        <h3>DBS compliance</h3>
        <div className="state">Checking clearances…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="tile">
        <h3>DBS compliance</h3>
        <div className="state err">Couldn't load DBS status.</div>
        <button className="retry" onClick={load}>Try again</button>
      </div>
    );
  }

  const active = staff.filter((s) => s.is_active !== false);
  const now = new Date();
  const buckets = { good: 0, warn: 0, danger: 0 };
  const issues = [];
  active.forEach((row) => {
    const c = classify(row, now);
    buckets[c] += 1;
    if (c !== "good") {
      issues.push({
        name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Coach",
        team: row.team_name || "",
        level: c,
        reason: !row.dbs_id ? "No DBS on file" : c === "danger" ? "Expired / not valid" : "Expiring soon",
      });
    }
  });

  if (active.length === 0) {
    return (
      <div className="tile">
        <h3>DBS compliance</h3>
        <div className="state">No coaches on the books yet.</div>
      </div>
    );
  }

  const allClear = buckets.danger === 0 && buckets.warn === 0;

  return (
    <div className="tile">
      <h3>DBS compliance</h3>
      {allClear ? (
        <div className="stat-row">
          <span className="stat">{buckets.good}</span>
          <span className="rag rag--good"><span className="dot" />all clear</span>
        </div>
      ) : (
        <div className="stat-row">
          <span className="stat">{buckets.danger + buckets.warn}</span>
          <span className="stat-label">of {active.length} coaches need attention</span>
        </div>
      )}
      <table className="atable" style={{ marginTop: 12 }}>
        <tbody>
          {issues.slice(0, 5).map((it, i) => (
            <tr key={i}>
              <td>
                <span className={`rag rag--${it.level}`}><span className="dot" /></span>{" "}
                {it.name}{it.team ? ` · ${it.team}` : ""}
              </td>
              <td className="num" style={{ color: "var(--t2)" }}>{it.reason}</td>
            </tr>
          ))}
          {allClear && (
            <tr><td colSpan={2} style={{ color: "var(--t2)" }}>Every coach has a valid DBS.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
