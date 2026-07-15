import React, { useCallback, useEffect, useState } from "react";
import {
  venueListClubStaff, venueListClubCoaches, clubListCohorts, venueListClubs,
  venueListSafeguardingIncidents, venueGetClubDocStatus,
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

// ISO → "8 Jul 2026" (viewer-local; no date lib).
function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
const ID_TYPE = { passport: "Passport", driving_licence: "Driving licence", pass_card: "PASS card", birth_certificate: "Birth certificate" };
// Team-less coach role (club_coaches.role) → readable label (mig 582).
const COACH_ROLE = { coach: "Coach", assistant_coach: "Assistant coach", session_lead: "Session lead", other: "Staff" };
const coachRoleLabel = (r) => COACH_ROLE[String(r || "").toLowerCase()] || "Coach";

// Expanded per-member detail — exactly WHICH consents are signed/missing, the ID status, the
// medical-review date. Same data the coach & club-admin /hub boards show. Status/metadata only —
// the medical content itself is never here (it stays with the family).
function DocMemberDetail({ m }) {
  const items = m.consents?.items || [];
  const idStatus = m.id?.status;
  const idDetail = m.id?.detail;
  const medStatus = m.medical?.status;
  const medDate = fmtDate(m.medical?.reviewed_at);
  const line = (label, ok, sub) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ color: ok ? "var(--ok)" : "var(--warn)", fontWeight: 700, width: 14, flex: "none" }}>{ok ? "✓" : "!"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {sub ? <span style={{ color: "var(--ink-3)" }}>{sub}</span> : null}
    </div>
  );
  return (
    <div style={{ padding: "8px 0 12px 30px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)", margin: "2px 0 4px" }}>Consent forms</div>
      {items.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>No consent forms set for this club yet.</div>}
      {items.map((it, i) => line(it.title, it.signed, it.signed ? (fmtDate(it.signed_at) ? "Signed " + fmtDate(it.signed_at) : "Signed") : "Not signed yet"))}

      {idStatus && idStatus !== "na" && (
        <>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)", margin: "10px 0 4px" }}>Proof of age</div>
          {line("ID document", idStatus === "done",
            idStatus === "done" ? (ID_TYPE[idDetail?.document_type] || "Approved") + (fmtDate(idDetail?.verified_at) ? " · verified " + fmtDate(idDetail?.verified_at) : "")
            : idStatus === "submitted" ? "Uploaded — awaiting verification"
            : idDetail?.rejection_reason ? "Rejected: " + idDetail.rejection_reason
            : "Not uploaded yet")}
        </>
      )}

      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)", margin: "10px 0 4px" }}>Medical &amp; emergency review</div>
      {line("Yearly review", medStatus === "done",
        medStatus === "done" ? (medDate ? "Confirmed " + medDate : "Confirmed")
        : (medDate ? "Last confirmed " + medDate + " — due again" : "Never confirmed"))}

      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
        Status only — the medical details themselves stay private to the family.
      </div>
    </div>
  );
}

export default function SafeguardingBoard({ venueToken, clubId }) {
  const [state, setState] = useState({ loading: true, error: false, staff: [], coaches: [], youthCohorts: new Set(), policy: null, docs: null });
  const [concerns, setConcerns] = useState({ status: "idle", count: 0 });
  const [openDoc, setOpenDoc] = useState(null); // expanded doc-member (member_profile_id) → which-docs-missing detail

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setState({ loading: false, error: false, staff: [], coaches: [], youthCohorts: new Set(), policy: null, docs: null }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const [staff, coaches, cohorts, clubs, docs] = await Promise.all([
        venueListClubStaff(venueToken, clubId),
        // Team-less session coaches (mig 582) — a SEPARATE array (never null-UNIONed into
        // staff, which would let a no-cohort coach escape the youth-DBS warning). Soft-caught
        // so the board still renders pre-582-apply or if the reader fails.
        venueListClubCoaches(venueToken, clubId).catch(() => []),
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
        coaches: Array.isArray(coaches) ? coaches : [],
        youthCohorts: youth,
        policy: club ? {
          minPublicAge: cfg.min_public_age != null ? Number(cfg.min_public_age) : 18,
          hideRosters: cfg.hide_public_rosters === true,
        } : null,
        docs: docs && docs.ok ? docs : null,
      });
    } catch (err) {
      console.error("[safeguarding] board load failed", err);
      setState({ loading: false, error: true, staff: [], coaches: [], youthCohorts: new Set(), policy: null, docs: null });
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

  const { loading, error, staff, coaches, youthCohorts, policy, docs } = state;

  // A person who is BOTH a team manager (staff) and a team-less session coach (coaches)
  // must be counted / warned ONCE. Dedupe the session coaches against the team-scoped
  // roster by member_profile_id; team-scoped counting stays byte-identical.
  const staffMemberIds = new Set(staff.map((r) => r.member_profile_id).filter(Boolean));
  const coachesOnly = coaches.filter((c) => !staffMemberIds.has(c.member_profile_id));

  let green = 0, amber = 0, red = 0;
  const warnings = [];
  // Team-scoped staff AND team-less session coaches share one R/A/G + youth-warning pass.
  // A team-scoped row is youth via its cohort_id; a team-less coach (no cohort_id) is youth
  // via the server-computed serves_youth flag — so a DBS-less session coach can't slip past.
  [...staff, ...coachesOnly].forEach((row) => {
    const c = dbsChip(row);
    if (c.cls === "ok") green++; else if (c.cls === "warn") amber++; else red++;
    const isYouth = youthCohorts.has(row.cohort_id) || row.serves_youth === true;
    if (c.cls === "crit" && isYouth) {
      warnings.push(`${row.first_name || ""} ${row.last_name || ""}`.trim() + ` — ${row.team_name || "Session coach (no team)"} (youth) — ${c.label}`);
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

          {/* One "Coach & staff DBS" card — team-scoped staff first, then a labelled
              "Session coaches (no team)" sub-section (mig 582). The empty state fires only
              when BOTH are empty, so a club with session coaches but no team staff never
              shows a "none recorded" line above a populated session-coach list. */}
          <div className="card card-pad" style={{ marginTop: "var(--gap-2)" }}>
            <SectionHead label="Coach & staff DBS" />
            {staff.length === 0 && coachesOnly.length === 0 ? (
              <EmptyState title="No coaches or staff recorded yet" body="Team coaches — and session coaches with no team — will show their DBS status here." />
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
                {coachesOnly.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)", margin: "12px 0 2px" }}>
                      Session coaches (no team)
                    </div>
                    {coachesOnly.map((row) => {
                      const c = dbsChip(row);
                      return (
                        <div key={row.coach_id || row.member_profile_id} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                          padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 13,
                        }}>
                          <span>
                            {`${row.first_name || ""} ${row.last_name || ""}`.trim() || "—"}
                            <span style={{ color: "var(--ink-3)" }}>
                              {" · "}{coachRoleLabel(row.role)}{row.serves_youth ? " · youth" : ""}
                            </span>
                          </span>
                          <span className={"pill pill-" + c.cls}><span className="pill-dot" />{c.label}</span>
                        </div>
                      );
                    })}
                  </>
                )}
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
                    const open = openDoc === m.member_profile_id;
                    return (
                      <div key={m.member_profile_id}>
                        <button type="button"
                          onClick={() => setOpenDoc(open ? null : m.member_profile_id)}
                          style={{
                            width: "100%", background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit",
                            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                            padding: "10px 0", borderBottom: open ? "none" : "1px solid var(--border)", fontSize: 13, textAlign: "left",
                          }}>
                          <span>
                            <span style={{ color: "var(--ink-3)", marginRight: 6, display: "inline-block", width: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>›</span>
                            {m.name}
                            {due ? <span style={{ color: "var(--ink-3)" }}>{" · "}{due}</span> : null}
                          </span>
                          <span className={"pill pill-" + cls}><span className="pill-dot" />{label}</span>
                        </button>
                        {open && <DocMemberDetail m={m} />}
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
