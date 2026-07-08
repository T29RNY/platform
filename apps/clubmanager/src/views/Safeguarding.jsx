import React, { useCallback, useEffect, useState } from "react";
import {
  venueListClubStaff,
  clubListCohorts,
  venueListClubs,
  venueListSafeguardingIncidents,
} from "@platform/core/storage/supabase.js";
import { useToast } from "../shell/toast.jsx";

// Safeguarding — the welfare-officer compliance board. Composes EXISTING venue-token
// readers only (no new backend). Every safeguarding boundary is enforced server-side;
// this board only renders their safe output:
//  · DBS clearance R/A/G  — venue_list_club_staff (certificate number is NEVER returned,
//    only status/expiry). Reuses the People dbsChip contract.
//  · Public-page policy   — read-only display of min_public_age + hide_public_rosters
//    (from venue_list_clubs). Editing/loosening it is a deliberate policy decision made
//    elsewhere — this board does not weaken protection.
//  · Open safeguarding concerns — Lead-ONLY, COUNT-ONLY. venue_list_safeguarding_incidents
//    throws `not_a_safeguarding_lead` for anyone but the club's Designated Safeguarding
//    Lead (a grant-only cap — NOT owner/manager), and every Lead read is server-audited.
//    We surface only a COUNT + "review in the incident tool" — never a concern's content
//    on a dashboard — and never a count to a non-Lead (existence-oracle safe).
//  · DBS-to-youth-assignment = a DISPLAY-ONLY warning (a coach with no valid DBS on a
//    youth cohort). It is NOT an enforced gate — enforcement is a product+legal decision.
//
// Deferred (needs new backend / operator decision): naming the welfare officer (committee
// is coach-auth, no venue-token reader); an enforced DBS-assignment block.

function dbsChip(row) {
  if (!row.dbs_id || !row.dbs_status) return { cls: "danger", label: "No DBS" };
  const s = String(row.dbs_status).toLowerCase();
  if (s === "valid" || s === "verified" || s === "clear") {
    if (row.dbs_expiry_date) {
      const days = (new Date(row.dbs_expiry_date + "T00:00:00").getTime() - Date.now()) / 86400000;
      if (Number.isNaN(days)) return { cls: "warn", label: "Check" };
      if (days < 0) return { cls: "danger", label: "Expired" };
      if (days <= 60) return { cls: "warn", label: "Expiring" };
    }
    return { cls: "good", label: "Valid" };
  }
  return { cls: "danger", label: "Not valid" };
}

export default function Safeguarding({ venueId, clubId }) {
  const t = useToast();
  const [state, setState] = useState({ loading: true, error: false, staff: [], youthCohorts: new Set(), policy: null });
  // Lead-only concerns panel (deliberate, audited read)
  const [concerns, setConcerns] = useState({ status: "idle", count: 0 });

  const load = useCallback(async () => {
    if (!venueId || !clubId) { setState({ loading: false, error: false, staff: [], youthCohorts: new Set(), policy: null }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [staff, cohorts, clubs] = await Promise.all([
        venueListClubStaff(venueId, clubId),
        clubListCohorts(venueId, clubId, true),
        venueListClubs(venueId).catch(() => []),
      ]);
      const youth = new Set(
        (Array.isArray(cohorts) ? cohorts : [])
          .filter((c) => String(c.category || "").toLowerCase() === "youth" || (c.max_age != null && Number(c.max_age) < 18))
          .map((c) => c.cohort_id),
      );
      // Only show the policy panel when we actually loaded the club — never default
      // to "18 / Off" on a read failure, which would misrepresent a safeguarding setting.
      const club = (Array.isArray(clubs) ? clubs : []).find((c) => c.id === clubId);
      const cfg = club?.safeguarding_config || {};
      setState({
        loading: false, error: false,
        staff: Array.isArray(staff) ? staff : [],
        youthCohorts: youth,
        policy: club ? {
          minPublicAge: cfg.min_public_age != null ? Number(cfg.min_public_age) : 18,
          hideRosters: cfg.hide_public_rosters === true,
        } : null,
      });
    } catch (err) {
      console.error("[clubmanager] safeguarding load failed", err);
      setState({ loading: false, error: true, staff: [], youthCohorts: new Set(), policy: null });
    }
  }, [venueId, clubId]);
  useEffect(() => { load(); }, [load]);

  const showConcerns = useCallback(async () => {
    setConcerns({ status: "loading", count: 0 });
    try {
      const res = await venueListSafeguardingIncidents(venueId);   // audited Lead read
      setConcerns({ status: "lead", count: res?.count ?? (Array.isArray(res?.incidents) ? res.incidents.length : 0) });
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("not_a_safeguarding_lead")) { setConcerns({ status: "notlead", count: 0 }); }
      else { console.error("[clubmanager] safeguarding incidents failed", err); setConcerns({ status: "error", count: 0 }); t.show("Couldn't load safeguarding concerns.", "error"); }
    }
  }, [venueId, t]);

  const { loading, error, staff, youthCohorts, policy } = state;

  // R/A/G tally + youth-no-DBS warnings (display-only)
  let green = 0, amber = 0, red = 0;
  const warnings = [];
  staff.forEach((row) => {
    const c = dbsChip(row);
    if (c.cls === "good") green++; else if (c.cls === "warn") amber++; else red++;
    if (c.cls === "danger" && youthCohorts.has(row.cohort_id)) {
      warnings.push(`${row.first_name || ""} ${row.last_name || ""}`.trim() + ` — ${row.team_name} (youth) — ${c.label}`);
    }
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Safeguarding</h2>
          <p className="sub">DBS clearance, public-page protection, and open concerns.</p>
        </div>
      </div>

      {loading && <div className="tile"><div className="state">Loading safeguarding…</div></div>}
      {error && (
        <div className="tile">
          <div className="state err">Couldn't load the safeguarding board.</div>
          <button className="retry" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* DBS clearance R/A/G */}
          <div className="tiles tiles--3">
            <div className="tile"><h3>Cleared</h3><div className="big">{green}</div><div className="sub">valid DBS</div></div>
            <div className="tile"><h3>Attention</h3><div className="big">{amber}</div><div className="sub">expiring / to check</div></div>
            <div className="tile"><h3>At risk</h3><div className="big">{red}</div><div className="sub">expired / missing / invalid</div></div>
          </div>

          {warnings.length > 0 && (
            <div className="tile" style={{ borderLeft: "3px solid var(--warn, var(--accent))" }}>
              <h3>Youth-cohort DBS warnings</h3>
              <p className="sub" style={{ marginTop: 0 }}>Review before these coaches work with under-18s — this is a recommendation, not an automatic block.</p>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {warnings.map((w, i) => <li key={i} style={{ fontSize: 13, margin: "3px 0" }}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="tile" style={{ minHeight: 0 }}>
            <h3>Coach &amp; staff DBS</h3>
            {staff.length === 0 ? (
              <div className="state">No coaches or staff recorded yet.</div>
            ) : (
              <table className="atable">
                <thead><tr><th>Name</th><th>Team</th><th className="num">DBS</th></tr></thead>
                <tbody>
                  {staff.map((row) => {
                    const c = dbsChip(row);
                    return (
                      <tr key={row.manager_id || `${row.member_profile_id}-${row.team_id}`}>
                        <td>{`${row.first_name || ""} ${row.last_name || ""}`.trim() || "—"}</td>
                        <td style={{ color: "var(--t2)" }}>{row.team_name}{youthCohorts.has(row.cohort_id) ? " · youth" : ""}</td>
                        <td className="num"><span className={`rag rag--${c.cls}`}><span className="dot" />{c.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Public-page protection (read-only) */}
          {policy && (
            <div className="tile" style={{ minHeight: 0 }}>
              <h3>Public-page protection</h3>
              <table className="atable">
                <tbody>
                  <tr><td>Minimum public age</td><td className="num">{policy.minPublicAge}</td></tr>
                  <tr><td>Hide public rosters</td><td className="num">{policy.hideRosters ? "On" : "Off"}</td></tr>
                </tbody>
              </table>
              <div className="state" style={{ fontSize: 12, marginTop: 8 }}>
                Under-{policy.minPublicAge}s are shown on the public page as first name + initial and never with a photo. Changing these protections is a policy decision made in club settings.
              </div>
            </div>
          )}

          {/* Open concerns — Lead only, count only */}
          <div className="tile" style={{ minHeight: 0 }}>
            <h3>Open safeguarding concerns</h3>
            {concerns.status === "idle" && (
              <>
                <p className="sub" style={{ marginTop: 0 }}>Open concerns are visible only to the Designated Safeguarding Lead. Each check is recorded.</p>
                <button className="small" onClick={showConcerns}>Show open concerns (Lead only)</button>
              </>
            )}
            {concerns.status === "loading" && <div className="state">Checking…</div>}
            {concerns.status === "lead" && (
              <div className="state">
                {concerns.count === 0
                  ? "No open safeguarding concerns."
                  : `${concerns.count} open safeguarding concern${concerns.count === 1 ? "" : "s"} — review each in the incident tool.`}
              </div>
            )}
            {concerns.status === "notlead" && (
              <div className="state">You are not the Designated Safeguarding Lead. Open concerns are visible to the Lead only.</div>
            )}
            {concerns.status === "error" && (
              <div className="state err">Couldn't load safeguarding concerns. <button className="retry" onClick={showConcerns}>Try again</button></div>
            )}
          </div>
        </>
      )}
    </>
  );
}
