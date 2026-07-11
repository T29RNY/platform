// ClubAdminSafeguarding.jsx — Club-admin track, secondary "Safeguarding" screen,
// opened from the More hub (Club Console PR #6b). The phone port of the desktop
// club lens's welfare-officer board (apps/venue/src/views/SafeguardingBoard.jsx),
// scoped to the ONE club whose shell venue the caller owns.
//
// Read-only. A DBS red/amber/green board for the coaching team + a Lead-only
// safeguarding-incidents surface. Every safeguarding boundary is enforced
// server-side; this screen only renders their safe output:
//  · DBS clearance R/A/G — venue_list_club_staff (the certificate NUMBER is never
//    returned, only status + expiry).
//  · Open concerns — Lead-ONLY, COUNT-ONLY. venue_list_safeguarding_incidents
//    throws not_a_safeguarding_lead for anyone but the Designated Safeguarding
//    Lead; loaded on TAP (each Lead read is server-audited, so we don't fire it
//    on mount) and isolated in its own try/catch so a non-Lead caller NEVER
//    breaks the DBS board. NO writes — this is a board, not a triage surface.
//
// AUTH: a club admin passes their shell venue_id (role.entityId) as the venue
// token; resolve_venue_caller authenticates them via auth.uid() against
// venue_admins. clubId (role.clubId) scopes the club-staff + cohort reads.
//
// Wrappers — verified against packages/core/storage/supabase.js (exact args + return):
//  · venueListClubStaff(venueToken, clubId)
//      → rpc venue_list_club_staff(p_token, p_club_id) → jsonb ARRAY (mig 305),
//        one row per (coach, team): { team_id, team_name, cohort_id, manager_id,
//        member_profile_id, first_name, last_name, role, is_active, dbs_id,
//        dbs_status, dbs_check_type, dbs_expiry_date }. DBS is UNIQUE per
//        (member_profile_id, club_id), so a coach's status is identical across
//        their teams — dedupe by member_profile_id is lossless.
//  · clubListCohorts(venueToken, clubId, true)
//      → rpc club_list_cohorts(p_venue_token, p_club_id, p_include_inactive) → jsonb
//        array of { cohort_id, name, category, min_age, max_age, ... }. Used only
//        to flag which cohorts are youth (category='youth' or an under-18 max_age).
//  · venueListSafeguardingIncidents(venueToken)
//      → rpc venue_list_safeguarding_incidents(p_venue_token) → jsonb
//        { ok:true, incidents:[…], count } for the Designated Safeguarding Lead;
//        THROWS 'not_a_safeguarding_lead' (P0001) for any other caller (mig 468).

import { useState, useEffect, useCallback, useRef } from "react";
import { venueListClubStaff, clubListCohorts, venueListSafeguardingIncidents, venueListClubs, venueGetClubDocStatus } from "@platform/core";
import MIcon from "../icons.jsx";
import CoachDbsSheet from "./CoachDbsSheet.jsx";

// DBS severity — a verbatim port of ClubAdminToday.dbsSeverity (the canonical
// classifier, itself the desktop board's dbsChip): 60-day expiring window,
// missing / invalid → crit. Kept identical so the phone and console agree.
function dbsSeverity(row) {
  if (!row.dbs_id || !row.dbs_status) return { tone: "crit", label: "No DBS" };
  const s = String(row.dbs_status).toLowerCase();
  if (s === "valid" || s === "verified" || s === "clear") {
    if (row.dbs_expiry_date) {
      const days = (new Date(row.dbs_expiry_date + "T00:00:00").getTime() - Date.now()) / 86400000;
      if (Number.isNaN(days)) return { tone: "warn", label: "Check" };
      if (days < 0) return { tone: "crit", label: "Expired" };
      if (days <= 60) return { tone: "warn", label: "Expiring" };
    }
    return { tone: "ok", label: "Valid" };
  }
  return { tone: "crit", label: "Not valid" };
}

const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Unnamed";

export default function ClubAdminSafeguarding({ venueToken, clubId, clubName, toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, coaches: [], publicPolicy: null, docStatus: null });
  const [concerns, setConcerns] = useState({ status: "idle", count: 0 });
  const [detail, setDetail] = useState(null); // tapped coach → CoachDbsSheet
  const rosterRef = useRef(null);
  const scrollToRoster = () => rosterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setState({ loading: false, error: false, coaches: [], publicPolicy: null }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // Cohorts are advisory (youth-flagging) + clubs is advisory (public-page policy)
      // — never let either secondary read sink the DBS board.
      const [staff, cohorts, clubs, docs] = await Promise.all([
        venueListClubStaff(venueToken, clubId),
        clubListCohorts(venueToken, clubId, true).catch(() => []),
        venueListClubs(venueToken).catch(() => []),
        // Player-document compliance — advisory: a failure must not sink the DBS board.
        venueGetClubDocStatus(venueToken, clubId).catch(() => null),
      ]);
      // Public-page protection — read-only mirror of the desktop SafeguardingBoard
      // (venue_list_clubs.safeguarding_config → min_public_age / hide_public_rosters).
      // Only surface the card when we actually READ this club — a silent
      // venue_list_clubs failure (caught → []) must not show possibly-wrong
      // "18+ / Shown" defaults and misinform the admin about roster visibility.
      const club = (Array.isArray(clubs) ? clubs : []).find((c) => c.id === clubId);
      const cfg = club?.safeguarding_config || {};
      const publicPolicy = club
        ? {
            minPublicAge: cfg.min_public_age != null ? Number(cfg.min_public_age) : 18,
            hideRosters: cfg.hide_public_rosters === true,
          }
        : null;
      const youth = new Set(
        (Array.isArray(cohorts) ? cohorts : [])
          .filter((c) => String(c.category || "").toLowerCase() === "youth" || (c.max_age != null && Number(c.max_age) < 18))
          .map((c) => c.cohort_id),
      );
      // One row per (coach, team) → collapse to one card per PERSON. Their DBS is
      // identical across teams; gather every team name and whether ANY team sits
      // in a youth cohort (so a red-DBS coach working with under-18s is flagged).
      const byPerson = new Map();
      (Array.isArray(staff) ? staff : []).forEach((row) => {
        if (row.is_active === false) return; // active coaching staff only
        const key = row.member_profile_id || row.dbs_id || fullName(row);
        let e = byPerson.get(key);
        if (!e) { e = { key, name: fullName(row), sev: dbsSeverity(row), teams: [], youth: false,
          memberProfileId: row.member_profile_id || null, status: row.dbs_status || null,
          expiry: row.dbs_expiry_date || null, checkType: row.dbs_check_type || null, role: row.role || null, active: row.is_active !== false }; byPerson.set(key, e); }
        if (row.team_name && !e.teams.includes(row.team_name)) e.teams.push(row.team_name);
        if (youth.has(row.cohort_id)) e.youth = true;
      });
      const rank = (t) => (t === "crit" ? 0 : t === "warn" ? 1 : 2);
      const coaches = [...byPerson.values()].sort((a, b) => rank(a.sev.tone) - rank(b.sev.tone) || a.name.localeCompare(b.name));
      setState({ loading: false, error: false, coaches, publicPolicy, docStatus: docs || null });
    } catch (err) {
      console.error("[safeguarding] board load failed", err);
      setState({ loading: false, error: true, coaches: [], publicPolicy: null });
    }
  }, [venueToken, clubId]);
  useEffect(() => { load(); }, [load]);

  // Lead-only, server-audited read — fired on TAP, not on mount, and fully ISOLATED
  // from the DBS load above: a non-Lead's not_a_safeguarding_lead throw only sets a
  // calm note here, so the R/A/G board always renders regardless of Lead status.
  const showConcerns = useCallback(async () => {
    setConcerns({ status: "loading", count: 0 });
    try {
      const res = await venueListSafeguardingIncidents(venueToken); // audited Lead read
      setConcerns({ status: "lead", count: res?.count ?? (Array.isArray(res?.incidents) ? res.incidents.length : 0) });
    } catch (err) {
      if (String(err?.message || "").includes("not_a_safeguarding_lead")) {
        setConcerns({ status: "notlead", count: 0 });
      } else {
        console.error("[safeguarding] incidents failed", err);
        setConcerns({ status: "error", count: 0 });
        toast?.({ icon: "alert", text: "Couldn't load concerns — try again" });
      }
    }
  }, [venueToken, toast]);

  const { loading, error, coaches, publicPolicy, docStatus } = state;
  const docMembers = docStatus?.members || [];
  const docSummary = docStatus?.summary || {};
  const docReqs = docStatus?.requirements || {};

  if (loading) {
    return <Frame onBack={onBack}><Note>Loading safeguarding for {clubName || "your club"}…</Note></Frame>;
  }
  if (error) {
    return (
      <Frame onBack={onBack}>
        <Note>
          Couldn't load the safeguarding board right now.
          <div><button onClick={load} style={pillBtn}>Try again</button></div>
        </Note>
      </Frame>
    );
  }

  const green = coaches.filter((c) => c.sev.tone === "ok").length;
  const amber = coaches.filter((c) => c.sev.tone === "warn").length;
  const red = coaches.filter((c) => c.sev.tone === "crit").length;
  const youthWarn = coaches.filter((c) => c.sev.tone === "crit" && c.youth);

  return (
    <Frame onBack={onBack}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "2px 2px 12px" }}>
        <MIcon name="shield" size={22} color="var(--ink)" />
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Safeguarding</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{clubName || "Your club"} · read-only overview</div>
        </div>
      </div>

      {/* ── DBS clearance R/A/G — tap a tile to jump to the roster (#399 idiom) ── */}
      <div style={{ display: "flex", gap: 10, padding: "2px 0 4px" }}>
        <StatTile tone="ok" label="Cleared" value={green} sub="valid DBS" onClick={coaches.length ? scrollToRoster : undefined} />
        <StatTile tone="amber" label="Attention" value={amber} sub="expiring / to check" onClick={coaches.length ? scrollToRoster : undefined} />
        <StatTile tone="live" label="At risk" value={red} sub="expired / missing" onClick={coaches.length ? scrollToRoster : undefined} />
      </div>

      {/* ── Youth-cohort DBS warnings ── */}
      {youthWarn.length > 0 && (
        <div className="m-card" style={{ padding: "13px 14px", marginTop: 12, borderLeft: "3px solid var(--live)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MIcon name="alert" size={17} color="var(--live)" />
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Youth-cohort DBS warnings</div>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink3)", margin: "6px 0 8px", lineHeight: 1.4 }}>
            Review before these coaches work with under-18s — a recommendation, not an automatic block.
          </p>
          {youthWarn.map((c) => (
            <div key={`yw-${c.key}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13 }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.name}<span style={{ color: "var(--ink3)" }}>{c.teams.length ? " · " + c.teams.join(", ") : ""}</span>
              </span>
              <Chip tone={c.sev.tone} text={c.sev.label} />
            </div>
          ))}
        </div>
      )}

      {/* ── Public-page protection (read-only welfare policy) — mirrors the desktop
             SafeguardingBoard. Changing it is a desktop decision. ── */}
      {publicPolicy && (
        <>
          <SecHead title="Public-page protection" />
          <div className="m-card" style={{ padding: "13px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, paddingBottom: 11, borderBottom: "1px solid var(--hair)" }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MIcon name="globe" size={17} color="var(--ink2)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>Minimum public age</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>Players under this age are hidden from your public page</div>
              </div>
              <span style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", flex: "none", fontVariantNumeric: "tabular-nums" }}>{publicPolicy.minPublicAge}+</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, paddingTop: 11 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MIcon name="users" size={17} color="var(--ink2)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>Public team rosters</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>Whether squad lists show on your public page</div>
              </div>
              <Chip tone={publicPolicy.hideRosters ? "warn" : "ok"} text={publicPolicy.hideRosters ? "Hidden" : "Shown"} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 11, color: "var(--ink4)", fontSize: 12 }}>
              <MIcon name="key" size={13} color="var(--ink4)" /> Change these on the desktop console.
            </div>
          </div>
        </>
      )}

      {/* ── Coach & staff DBS roster ── */}
      <div ref={rosterRef} style={{ scrollMarginTop: 12 }}>
      <SecHead title="Coach & staff DBS" meta={coaches.length ? `${coaches.length}` : ""} />
      {coaches.length === 0 ? (
        <div className="m-card" style={{ padding: "22px 18px", textAlign: "center" }}>
          <MIcon name="users" size={24} color="var(--ink3)" />
          <div style={{ fontSize: 13.5, color: "var(--ink2)", fontWeight: 600, marginTop: 8 }}>No coaches or staff recorded yet</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3 }}>Coaches added on the desktop console will show their DBS status here.</div>
        </div>
      ) : (
        coaches.map((c) => (
          <button key={`row-${c.key}`} onClick={() => setDetail(c)} type="button" className="m-card" style={{
            width: "100%", textAlign: "left", fontFamily: "var(--m-font)", color: "inherit", cursor: "pointer",
            padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
              background: c.sev.tone === "crit" ? "var(--live-soft)" : c.sev.tone === "warn" ? "var(--amber-soft)" : "var(--ok-soft)",
            }}>
              <MIcon name="shield" size={18} color={c.sev.tone === "crit" ? "var(--live)" : c.sev.tone === "warn" ? "var(--amber)" : "var(--ok)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {(c.teams.length ? c.teams.join(", ") : "Coach") + (c.youth ? " · youth" : "")}
              </div>
            </div>
            <Chip tone={c.sev.tone} text={c.sev.label} />
            <MIcon name="chevron" size={16} color="var(--ink4)" />
          </button>
        ))
      )}
      </div>

      {/* ── Player documents — club-wide compliance (venue_get_club_doc_status, status flags only) ── */}
      {docStatus && (
        <>
          <SecHead title="Player documents" meta={docSummary.members ? `${docSummary.members}` : ""} />
          <div className="m-card" style={{ padding: "13px 15px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
              background: (docSummary.with_outstanding || 0) === 0 ? "var(--ok-soft)" : "var(--amber-soft)",
            }}>
              <MIcon name={(docSummary.with_outstanding || 0) === 0 ? "check" : "alert"} size={19}
                color={(docSummary.with_outstanding || 0) === 0 ? "var(--ok-ink)" : "var(--amber)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>
                {(docSummary.with_outstanding || 0) === 0
                  ? "Everyone's cleared"
                  : `${docSummary.with_outstanding} of ${docSummary.members} need attention`}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>
                {docReqs.id_mandate ? "Consents · proof of age · yearly medical check" : "Consents · yearly medical check"}
              </div>
            </div>
          </div>
          {docMembers.length === 0 && (
            <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>No members with a club membership yet.</div>
          )}
          {docMembers.map((m) => (
            <div key={`doc-${m.member_profile_id}`} className="m-card" style={{ padding: "11px 13px", marginBottom: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                {m.all_clear
                  ? <span style={docBadgeOk}><MIcon name="check" size={12} color="var(--ok-ink)" />Cleared</span>
                  : (m.outstanding || 0) > 0
                    ? <span style={docBadgeWarn}>{m.outstanding} to chase</span>
                    : <span style={docBadgeMuted}>In review</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                <DocChip label={`Consents ${m.consents?.signed ?? 0}/${m.consents?.required ?? 0}`} status={m.consents?.status} />
                <DocChip label="ID" status={m.id?.status} />
                <DocChip label="Medical" status={m.medical?.status} />
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--ink4)", lineHeight: 1.45, margin: "2px 2px 4px" }}>
            Status only — the documents themselves stay with the family. Chips: <strong style={{ color: "var(--ok-ink)" }}>✓</strong> done · <strong style={{ color: "var(--amber)" }}>!</strong> outstanding · <strong style={{ color: "var(--ink3)" }}>…</strong> in review.
          </div>
        </>
      )}

      {/* ── Open safeguarding concerns — Lead only, count only ── */}
      <SecHead title="Open concerns" />
      <div className="m-card" style={{ padding: "14px 15px" }}>
        {concerns.status === "idle" && (
          <>
            <p style={{ fontSize: 12.5, color: "var(--ink3)", margin: "0 0 10px", lineHeight: 1.45 }}>
              Open concerns are visible only to the Designated Safeguarding Lead. Each check is recorded.
            </p>
            <button onClick={showConcerns} style={pillBtn}>Show open concerns (Lead only)</button>
          </>
        )}
        {concerns.status === "loading" && <p style={{ fontSize: 13.5, color: "var(--ink3)", margin: 0 }}>Checking…</p>}
        {concerns.status === "lead" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MIcon name={concerns.count === 0 ? "check" : "alert"} size={20} color={concerns.count === 0 ? "var(--ok)" : "var(--amber)"} />
            <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.4 }}>
              {concerns.count === 0
                ? "No open safeguarding concerns."
                : `${concerns.count} open safeguarding concern${concerns.count === 1 ? "" : "s"} — review each in the incident tool.`}
            </p>
          </div>
        )}
        {concerns.status === "notlead" && (
          <p style={{ fontSize: 13.5, color: "var(--ink3)", margin: 0, lineHeight: 1.45 }}>
            Safeguarding incidents are visible to your designated lead only.
          </p>
        )}
        {concerns.status === "error" && (
          <p style={{ fontSize: 13.5, color: "var(--live)", margin: 0 }}>
            Couldn't load safeguarding concerns. <button onClick={showConcerns} style={{ ...pillBtn, marginTop: 8 }}>Try again</button>
          </p>
        )}
      </div>

      {detail && (
        <CoachDbsSheet coach={detail} venueToken={venueToken} clubId={clubId} toast={toast}
          onClose={() => setDetail(null)} onSaved={() => { setDetail(null); load(); }} />
      )}
    </Frame>
  );
}

// ── Shared bits (match GuardianDocs Frame / ClubAdminToday tiles) ──
function Frame({ children, onBack }) {
  return (
    <div className="m-view-enter">
      {onBack && (
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 10, cursor: "pointer",
          background: "transparent", border: "none", color: "var(--ink3)", fontFamily: "var(--m-font)",
          fontWeight: 600, fontSize: 13.5, padding: "2px 0",
        }}>
          <MIcon name="chevleft" size={16} /> More
        </button>
      )}
      {children}
    </div>
  );
}

function Note({ children }) {
  return <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5, lineHeight: 1.5 }}>{children}</div>;
}

function StatTile({ tone, label, value, sub, onClick }) {
  const col = tone === "live" ? "var(--live)" : tone === "amber" ? "var(--amber)" : "var(--ok)";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} type={onClick ? "button" : undefined} className="m-card" style={{
      flex: 1, minWidth: 0, padding: "12px 12px", display: "flex", flexDirection: "column", gap: 5,
      textAlign: "left", cursor: onClick ? "pointer" : "default", fontFamily: "var(--m-font)", color: "inherit",
    }}>
      <span className="m-eyebrow" style={{ fontSize: 10.5 }}>{label}</span>
      <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.03em", color: col, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </Tag>
  );
}

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}

function Chip({ tone, text }) {
  const bg = tone === "crit" ? "var(--live-soft)" : tone === "warn" ? "var(--amber-soft)" : "var(--ok-soft)";
  const ink = tone === "crit" ? "var(--live)" : tone === "warn" ? "var(--amber)" : "var(--ok)";
  return (
    <span style={{
      height: 21, fontSize: 11, padding: "0 8px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", fontWeight: 700, flex: "none",
      background: bg, color: ink,
    }}>{text}</span>
  );
}

const pillBtn = {
  marginTop: 2, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontWeight: 700, fontSize: 13.5, fontFamily: "var(--m-font)",
};

// Player-document status chips (mirror the coach board TeamManagerDocs): done=green, due=amber, else neutral.
const DOC_LABEL = { done: "✓", due: "!", submitted: "…" };
function docTone(status) {
  if (status === "done") return { soft: "var(--ok-soft)", ink: "var(--ok-ink)" };
  if (status === "due") return { soft: "var(--amber-soft)", ink: "var(--amber)" };
  return { soft: "var(--s3)", ink: "var(--ink3)" };
}
function DocChip({ label, status }) {
  if (status === "na") return null;
  const t = docTone(status);
  return (
    <span style={{
      height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none",
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
      background: t.soft, color: t.ink,
    }}>{label} {DOC_LABEL[status] || ""}</span>
  );
}
const docBadgeBase = { height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700 };
const docBadgeOk = { ...docBadgeBase, background: "var(--ok-soft)", color: "var(--ok-ink)" };
const docBadgeWarn = { ...docBadgeBase, background: "var(--amber-soft)", color: "var(--amber)" };
const docBadgeMuted = { ...docBadgeBase, background: "var(--s3)", color: "var(--ink3)" };
