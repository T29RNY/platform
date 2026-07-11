import React, { useCallback, useEffect, useState } from "react";
import {
  venueListClubStaff, clubListCohorts, venueListClubs, venueListSafeguardingIncidents,
  venueGetClubDocStatus,
} from "@platform/core/storage/supabase.js";
import { SectionHead, EmptyState } from "./atoms.jsx";

// Safeguarding board — the welfare-officer compliance surface for the venue
// console's club lens (Club Console Consolidation PR #2c). Ported from the
// retired clubmanager; composes EXISTING venue-token readers only (no new
// backend). Every safeguarding boundary is enforced server-side; this board
// only renders their safe output:
//  · DBS clearance R/A/G — venue_list_club_staff (certificate number is NEVER
//    returned, only status/expiry).
//  · Public-page policy — read-only min_public_age + hide_public_rosters (from
//    venue_list_clubs.safeguarding_config). Loosening it is a decision made in
//    club settings — this board never weakens protection.
//  · Open concerns — Lead-ONLY, COUNT-ONLY. venue_list_safeguarding_incidents
//    throws not_a_safeguarding_lead for anyone but the Designated Safeguarding
//    Lead (a grant-only cap, NOT owner/manager); every Lead read is server-
//    audited. Surfaces only a COUNT + "review in the incident tool" — never a
//    concern's content, and never a count to a non-Lead (existence-oracle safe).
//  · DBS-to-youth-assignment = a DISPLAY-ONLY warning, not an enforced gate
//    (enforcement is a product+legal decision).
//
// Deferred (needs new backend / a decision): a bulk-nudge that targets specific
// coaches (no wrapper targets an arbitrary coach list — clubSendAnnouncement is
// whole-club/cohort/team only); naming the welfare officer; an enforced
// DBS-assignment block. The actual incident tool (SafeguardingPanel) stays in
// venue-mode Operations for now.

function dbsChip(row) {
  if (!row.dbs_id || !row.dbs_status) return { cls: "crit", label: "No DBS" };
  const s = String(row.dbs_status).toLowerCase();
  if (s === "valid" || s === "verified" || s === "clear") {
    if (row.dbs_expiry_date) {
      const days = (new Date(row.dbs_expiry_date + "T00:00:00").getTime() - Date.now()) / 86400000;
      if (Number.isNaN(days)) return { cls: "warn", label: "Check" };
      if (days < 0) return { cls: "crit", label: "Expired" };
      if (days <= 60) return { cls: "warn", label: "Expiring" };
    }
    return { cls: "ok", label: "Valid" };
  }
  return { cls: "crit", label: "Not valid" };
}

// A member's outstanding-doc summary line (status only — never medical content).
function dueLabels(m) {
  const out = [];
  if (m.consents?.status === "due") out.push(`consents (${m.consents.signed ?? 0}/${m.consents.required ?? 0})`);
  if (m.id?.status === "due") out.push("proof of age");
  if (m.id?.status === "submitted") out.push("ID in review");
  if (m.medical?.status === "due") out.push("medical check");
  return out.join(" · ");
}

export default function SafeguardingBoard({ venueToken, clubId }) {
  const [state, setState] = useState({ loading: true, error: false, staff: [], youthCohorts: new Set(), policy: null, docs: null });
  const [concerns, setConcerns] = useState({ status: "idle", count: 0 });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setState({ loading: false, error: false, staff: [], youthCohorts: new Set(), policy: null, docs: null }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [staff, cohorts, clubs, docs] = await Promise.all([
        venueListClubStaff(venueToken, clubId),
        clubListCohorts(venueToken, clubId, true),
        venueListClubs(venueToken).catch(() => []),
        // Player compliance doc-status (mig 539) — soft-caught so the board still renders
        // its DBS panels if this reader fails (e.g. a staff role without manage_facility).
        venueGetClubDocStatus(venueToken, clubId).catch(() => null),
      ]);
      const youth = new Set(
        (Array.isArray(cohorts) ? cohorts : [])
          .filter((c) => String(c.category || "").toLowerCase() === "youth" || (c.max_age != null && Number(c.max_age) < 18))
          .map((c) => c.cohort_id),
      );
      // Only show the policy panel when the club actually loaded — never default
      // to "18 / Off" on a read failure, which would misrepresent a protection.
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
        docs: docs && docs.ok ? docs : null,
      });
    } catch (err) {
      console.error("[safeguarding] board load failed", err);
      setState({ loading: false, error: true, staff: [], youthCohorts: new Set(), policy: null, docs: null });
    }
  }, [venueToken, clubId]);
  useEffect(() => { load(); }, [load]);

  const showConcerns = useCallback(async () => {
    setConcerns({ status: "loading", count: 0 });
    try {
      const res = await venueListSafeguardingIncidents(venueToken);   // audited Lead read
      setConcerns({ status: "lead", count: res?.count ?? (Array.isArray(res?.incidents) ? res.incidents.length : 0) });
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("not_a_safeguarding_lead")) setConcerns({ status: "notlead", count: 0 });
      else { console.error("[safeguarding] incidents failed", err); setConcerns({ status: "error", count: 0 }); }
    }
  }, [venueToken]);

  const { loading, error, staff, youthCohorts, policy, docs } = state;

  let green = 0, amber = 0, red = 0;
  const warnings = [];
  staff.forEach((row) => {
    const c = dbsChip(row);
    if (c.cls === "ok") green++; else if (c.cls === "warn") amber++; else red++;
    if (c.cls === "crit" && youthCohorts.has(row.cohort_id)) {
      warnings.push(`${row.first_name || ""} ${row.last_name || ""}`.trim() + ` — ${row.team_name} (youth) — ${c.label}`);
    }
  });

  return (
    <div>
      <SectionHead label="Safeguarding" />

      {loading ? (
        <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading safeguarding…</p>
      ) : error ? (
        <p style={{ color: "var(--live)", fontSize: 13 }}>
          Couldn’t load the safeguarding board. <button className="btn btn-ghost btn-xs" onClick={load}>Try again</button>
        </p>
      ) : (
        <>
          {/* DBS clearance R/A/G */}
          <div className="stat-row">
            <div className="stat stat--ok">
              <div className="stat-head"><span>Cleared</span></div>
              <div className="stat-value">{green}</div>
              <div className="stat-sub">valid DBS</div>
            </div>
            <div className="stat stat--accent">
              <div className="stat-head"><span>Attention</span></div>
              <div className="stat-value">{amber}</div>
              <div className="stat-sub">expiring / to check</div>
            </div>
            <div className="stat stat--crit">
              <div className="stat-head"><span>At risk</span></div>
              <div className="stat-value">{red}</div>
              <div className="stat-sub">expired / missing / invalid</div>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--warn)", marginTop: "var(--gap-2)" }}>
              <h3 style={{ marginTop: 0, fontSize: 15 }}>Youth-cohort DBS warnings</h3>
              <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 0 }}>Review before these coaches work with under-18s — a recommendation, not an automatic block.</p>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {warnings.map((w, i) => <li key={i} style={{ fontSize: 13, margin: "3px 0" }}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="card card-pad" style={{ marginTop: "var(--gap-2)" }}>
            <SectionHead label="Coach & staff DBS" />
            {staff.length === 0 ? (
              <EmptyState title="No coaches or staff recorded yet" body="Coaches added under Staff will show their DBS status here." />
            ) : (
              <div>
                {staff.map((row) => {
                  const c = dbsChip(row);
                  return (
                    <div key={row.manager_id || `${row.member_profile_id}-${row.team_id}`} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                      padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13,
                    }}>
                      <span>
                        {`${row.first_name || ""} ${row.last_name || ""}`.trim() || "—"}
                        <span style={{ color: "var(--ink-3)" }}>
                          {" · "}{row.team_name}{youthCohorts.has(row.cohort_id) ? " · youth" : ""}
                        </span>
                      </span>
                      <span className={"pill pill-" + c.cls}><span className="pill-dot" />{c.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Player documents / compliance (mig 539) — status only, never medical content */}
          {docs && (
            <div className="card card-pad" style={{ marginTop: "var(--gap-2)" }}>
              <SectionHead label="Player documents" />
              <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 0 }}>
                Consent forms{docs.requirements?.id_mandate ? ", proof of age" : ""} and the yearly medical check, per member — status only, never the medical details.
              </p>
              <div className="stat-row" style={{ marginTop: 8 }}>
                <div className="stat stat--ok">
                  <div className="stat-head"><span>Cleared</span></div>
                  <div className="stat-value">{docs.summary?.all_clear ?? 0}</div>
                  <div className="stat-sub">fully compliant</div>
                </div>
                <div className="stat stat--accent">
                  <div className="stat-head"><span>Attention</span></div>
                  <div className="stat-value">{docs.summary?.with_outstanding ?? 0}</div>
                  <div className="stat-sub">docs outstanding</div>
                </div>
                <div className="stat">
                  <div className="stat-head"><span>Members</span></div>
                  <div className="stat-value">{docs.summary?.members ?? 0}</div>
                  <div className="stat-sub">in this club</div>
                </div>
              </div>
              {(docs.members || []).length === 0 ? (
                <EmptyState title="No members yet" body="Enrolled members will show their document status here." />
              ) : (
                <div style={{ marginTop: 8 }}>
                  {docs.members.map((m) => {
                    const cls = m.all_clear ? "ok" : ((m.outstanding || 0) > 0 ? "crit" : "warn");
                    const label = m.all_clear ? "Cleared" : ((m.outstanding || 0) > 0 ? `${m.outstanding} outstanding` : "In review");
                    const due = dueLabels(m);
                    return (
                      <div key={m.member_profile_id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                        padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13,
                      }}>
                        <span>
                          {m.name}
                          {due ? <span style={{ color: "var(--ink-3)" }}>{" · "}{due}</span> : null}
                        </span>
                        <span className={"pill pill-" + cls}><span className="pill-dot" />{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Public-page protection (read-only) */}
          {policy && (
            <div className="card card-pad" style={{ marginTop: "var(--gap-2)" }}>
              <SectionHead label="Public-page protection" />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <span>Minimum public age</span><span style={{ color: "var(--ink-3)" }}>{policy.minPublicAge}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13 }}>
                <span>Hide public rosters</span><span style={{ color: "var(--ink-3)" }}>{policy.hideRosters ? "On" : "Off"}</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
                Under-{policy.minPublicAge}s are shown on the public page as first name + initial and never with a photo. Changing these protections is a policy decision made in club settings.
              </p>
            </div>
          )}

          {/* Open concerns — Lead only, count only */}
          <div className="card card-pad" style={{ marginTop: "var(--gap-2)" }}>
            <SectionHead label="Open safeguarding concerns" />
            {concerns.status === "idle" && (
              <>
                <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 0 }}>Open concerns are visible only to the Designated Safeguarding Lead. Each check is recorded.</p>
                <button className="btn btn-ghost btn-sm" onClick={showConcerns}>Show open concerns (Lead only)</button>
              </>
            )}
            {concerns.status === "loading" && <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Checking…</p>}
            {concerns.status === "lead" && (
              <p style={{ fontSize: 13 }}>
                {concerns.count === 0
                  ? "No open safeguarding concerns."
                  : `${concerns.count} open safeguarding concern${concerns.count === 1 ? "" : "s"} — review each in the incident tool.`}
              </p>
            )}
            {concerns.status === "notlead" && (
              <p style={{ fontSize: 13, color: "var(--ink-3)" }}>You are not the Designated Safeguarding Lead. Open concerns are visible to the Lead only.</p>
            )}
            {concerns.status === "error" && (
              <p style={{ fontSize: 13, color: "var(--live)" }}>Couldn’t load safeguarding concerns. <button className="btn btn-ghost btn-xs" onClick={showConcerns}>Try again</button></p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
