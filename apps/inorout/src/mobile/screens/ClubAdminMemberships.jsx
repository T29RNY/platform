// ClubAdminMemberships.jsx — Club-admin track, SECONDARY /hub screen ("Memberships"),
// opened from the club-admin "More" hub (not a primary bottom-nav tab), Club Console PR #6b.
// The phone twin of the desktop club lens's Memberships view
// (apps/venue/src/views/MembershipsView.jsx), scoped to the ONE club whose shell
// venue the caller owns.
//
// A read-only glance: a subscriptions stat strip (active members, monthly recurring
// revenue, renewals due soon, memberships ending) + the club's cohorts list (name +
// age band + active/inactive). Deep membership setup (tiers, cohorts editing, Stripe,
// partner offers) stays on the desktop console — NO writes here.
//
// AUTH: a club admin passes their shell venue_id as the credential (role.entityId).
// resolve_venue_caller authenticates them via auth.uid() against venue_admins — the
// same venue-token path the operator track and desktop console use. clubId scopes the
// cohorts read. No token, no new RPC.
//
// Reuses existing venue-token wrappers only (no new backend), verified against
// packages/core/storage/supabase.js + desktop call sites:
//   • venueMembershipSummary(venueToken)  [supabase.js:4371, MembershipsView.jsx:209]
//       — wrapper unwraps to `data?.summary ?? {}` →
//         { active, paused, ending, due_soon, mrr_pence } (counts; mrr in pence). mig 273.
//   • clubListCohorts(venueToken, clubId, includeInactive=false)  [supabase.js:6104,
//       MembershipsView.jsx:2289] — wrapper returns the raw JSONB ARRAY (not `.cohorts`) →
//       [{ cohort_id, name, description, category, min_age, max_age, active, created_at }]. mig 389.
// NOTE: per-cohort member counts are intentionally NOT shown — venue_list_members
// (mig 410) rows carry club_id/tier_id but NO cohort_id, so the shape can't join a
// member to a cohort. Counts skipped as instructed.

import { useState, useEffect, useCallback, useRef } from "react";
import { venueMembershipSummary, clubListCohorts, clubListTeams, venueListMembers, clubCreateCohort } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";
import MemberListSheet from "./MemberListSheet.jsx";

// pence → £ (verbatim port of OperationsTonight.gbp / OperatorPayments.gbp).
function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2,
  });
}

const CATEGORY_LABEL = { youth: "Youth", adult: "Adult", mixed: "Mixed" };

// Human age band from min/max (both nullable ints on club_cohorts).
function ageBand(c) {
  const lo = c.min_age, hi = c.max_age;
  if (lo != null && hi != null) return `Ages ${lo}–${hi}`;
  if (lo != null) return `Ages ${lo}+`;
  if (hi != null) return `Up to ${hi}`;
  return "All ages";
}

// Combined sub-line: "Youth · Ages 7–11" (category dropped when absent).
function cohortSub(c) {
  const cat = c.category ? CATEGORY_LABEL[c.category] || c.category : null;
  return [cat, ageBand(c)].filter(Boolean).join(" · ");
}

export default function ClubAdminMemberships({ venueToken, clubId, clubName, toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, summary: {}, cohorts: [], teams: [], members: [] });
  const [drill, setDrill] = useState(null);       // { title, members, dateField, dateLabel }
  const [expanded, setExpanded] = useState({});   // cohort_id → bool (teams-in-cohort expander)
  const [addOpen, setAddOpen] = useState(false);  // New-cohort sheet

  const load = useCallback(async () => {
    if (!venueToken) { setState({ loading: false, error: false, summary: {}, cohorts: [], teams: [], members: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      // Summary is the primary read (drives the error triad); cohorts / teams / members
      // are secondary — a failure there must not blank the whole glance. teams keys by
      // cohort_id (with member_count) so a cohort expands to its teams, exactly like the
      // desktop MembershipsView cohort row. members = the SAME venue_list_members the
      // desktop uses, scoped client-side to this club for the tile drill-downs.
      const [summary, cohorts, teams, members] = await Promise.all([
        venueMembershipSummary(venueToken),
        clubId ? clubListCohorts(venueToken, clubId, false).catch(() => []) : Promise.resolve([]),
        clubId ? clubListTeams(venueToken, clubId, false).catch(() => []) : Promise.resolve([]),
        venueListMembers(venueToken).catch(() => []),
      ]);
      setState({
        loading: false, error: false,
        summary: summary || {},
        cohorts: Array.isArray(cohorts) ? cohorts : [],
        teams: Array.isArray(teams) ? teams : [],
        members: Array.isArray(members) ? members : [],
      });
    } catch {
      setState({ loading: false, error: true, summary: {}, cohorts: [], teams: [], members: [] });
    }
  }, [venueToken, clubId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, summary, cohorts, teams, members } = state;

  if (loading) {
    return (
      <div>
        <BackHead onBack={onBack} />
        <div className="m-card" style={{ marginTop: 8 }}>
          <div className="m-eyebrow">Memberships</div>
          <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading {clubName || "your club"}…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <BackHead onBack={onBack} />
        <div className="m-card" style={{ marginTop: 8 }}>
          <div className="m-eyebrow">Memberships</div>
          <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load memberships right now.</p>
          <button onClick={load} style={{
            marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
            background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
          }}>Try again</button>
        </div>
      </div>
    );
  }

  const active = summary?.active ?? 0;
  const dueSoon = summary?.due_soon ?? 0;
  const ending = summary?.ending ?? 0;
  const paused = summary?.paused ?? 0;
  const mrrPence = summary?.mrr_pence ?? 0;

  // Tile drill-downs. venue_list_members is venue-wide (every club at the shell
  // venue), so scope to THIS club (club_id) first — a club admin should only see
  // their own club's members. Tile numbers stay the desktop's summary counts
  // (venue-scoped), so a multi-venue club's tile and drill can differ slightly.
  const st = (m) => String(m.status || "").toLowerCase();
  const clubMembers = members.filter((m) => m.club_id === clubId);
  const activeMembers = clubMembers.filter((m) => st(m) === "active");
  const dueSoonMembers = clubMembers.filter((m) => m.due_soon === true);
  const endingMembers = clubMembers.filter((m) => st(m) === "ending");
  const frozenMembers = clubMembers.filter((m) => st(m) === "paused");
  const openActive = activeMembers.length ? () => setDrill({ title: "Active members", members: activeMembers }) : undefined;

  return (
    <div>
      <BackHead onBack={onBack} />

      {/* ── subscriptions stat strip (tap → member list) ── */}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "8px 0 2px", scrollbarWidth: "none" }}>
        <StatTile tone="ink" label="Active" value={active} sub="members" onClick={openActive} />
        <StatTile tone="ink" label="MRR" value={gbp(mrrPence)} sub="per month" onClick={openActive} />
        <StatTile tone={dueSoon ? "amber" : "ink"} label="Due soon" value={dueSoon} sub="renew ≤ 7d"
          onClick={dueSoonMembers.length ? () => setDrill({ title: "Due soon", members: dueSoonMembers, dateField: "renews_at", dateLabel: "renews" }) : undefined} />
        <StatTile tone={ending ? "amber" : "ink"} label="Ending" value={ending} sub="not renewing"
          onClick={endingMembers.length ? () => setDrill({ title: "Ending", members: endingMembers, dateField: "cancel_at", dateLabel: "ends" }) : undefined} />
        <StatTile tone={paused ? "amber" : "ink"} label="Frozen" value={paused} sub="paused"
          onClick={frozenMembers.length ? () => setDrill({ title: "Frozen", members: frozenMembers, dateField: "frozen_until", dateLabel: "until" }) : undefined} />
      </div>

      {/* ── cohorts (tap a row to expand its teams; + New to add one) ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "22px 2px 11px" }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>
          Cohorts{cohorts.length ? <span style={{ fontSize: 13, color: "var(--ink3)", fontWeight: 600 }}> · {cohorts.length}</span> : null}
        </h2>
        <button onClick={() => setAddOpen(true)} style={{
          display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--m-font)",
        }}><MIcon name="plus" size={14} color="var(--amber)" /> New</button>
      </div>
      {cohorts.length === 0 ? (
        <div className="m-card" style={{ padding: "26px 18px", textAlign: "center" }}>
          <MIcon name="users" size={24} color="var(--ink4)" />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "var(--ink2)" }}>
            No cohorts yet — tap New to add one
          </div>
        </div>
      ) : cohorts.map((c) => {
        const cohortTeams = teams.filter((t) => t.cohort_id === c.cohort_id);
        const open = !!expanded[c.cohort_id];
        return (
          <div key={c.cohort_id} className="m-card" style={{ marginBottom: 10, overflow: "hidden", opacity: c.active === false ? 0.62 : 1 }}>
            <button onClick={() => setExpanded((e) => ({ ...e, [c.cohort_id]: !e[c.cohort_id] }))} style={{
              width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
              padding: "13px 14px", display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)", color: "inherit",
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--s3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}><MIcon name="users" size={19} color="var(--ink2)" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name || "Cohort"}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {cohortSub(c)}{cohortTeams.length ? ` · ${cohortTeams.length} team${cohortTeams.length === 1 ? "" : "s"}` : ""}
                </div>
                {c.description && (
                  <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.description}
                  </div>
                )}
              </div>
              <ActiveChip active={c.active !== false} />
              <MIcon name={open ? "chevdown" : "chevron"} size={16} color="var(--ink4)" />
            </button>
            {open && (
              <div style={{ padding: "2px 14px 12px", borderTop: "1px solid var(--hair)" }}>
                {cohortTeams.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "10px 0 2px" }}>No teams in this cohort yet.</div>
                ) : cohortTeams.map((t) => (
                  <div key={t.team_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--hair)" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.name || "Team"}{t.gender ? ` · ${CATEGORY_LABEL[t.gender] || t.gender}` : ""}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--ink3)", flex: "none", fontVariantNumeric: "tabular-nums" }}>
                      {Number(t.member_count) || 0} player{(Number(t.member_count) || 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {drill && (
        <MemberListSheet title={drill.title} members={drill.members}
          dateField={drill.dateField} dateLabel={drill.dateLabel}
          emptyText="No members here" onClose={() => setDrill(null)} />
      )}
      {addOpen && (
        <AddCohortSheet venueToken={venueToken} clubId={clubId} toast={toast}
          onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load(); }} />
      )}
    </div>
  );
}

function BackHead({ onBack }) {
  return (
    <button onClick={onBack} style={{
      display: "flex", alignItems: "center", gap: 6, background: "none", border: 0,
      color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, cursor: "pointer", marginBottom: 4, padding: 0,
    }}>
      <MIcon name="chevleft" size={16} color="var(--ink3)" /> Back
    </button>
  );
}

function StatTile({ tone, label, value, sub, onClick }) {
  const col = tone === "live" ? "var(--live)" : tone === "amber" ? "var(--amber)" : "var(--ink)";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} type={onClick ? "button" : undefined} className="m-card" style={{
      flex: "none", width: 122, padding: "13px 13px", display: "flex", flexDirection: "column", gap: 6,
      textAlign: "left", cursor: onClick ? "pointer" : "default", fontFamily: "var(--m-font)", color: "inherit",
    }}>
      <span className="m-eyebrow" style={{ fontSize: 10.5 }}>{label}</span>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: col, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </Tag>
  );
}

// New-cohort form — a pinned-footer MobileSheet mirroring the desktop CohortModal's
// field set (name / category youth·adult·mixed / min age / max age). Writes via the
// existing venue-token clubCreateCohort (manage_memberships-gated, audited); no new
// backend. description is omitted to match the desktop create form exactly.
function AddCohortSheet({ venueToken, clubId, toast, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("youth");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  const field = {
    width: "100%", padding: "10px 12px", borderRadius: "var(--r-sm)", border: "1px solid var(--hair)",
    background: "var(--s3)", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 14, marginTop: 4,
  };

  const save = async () => {
    if (savingRef.current) return;
    if (!name.trim()) { toast?.({ icon: "alert", text: "Give the cohort a name" }); return; }
    savingRef.current = true; setBusy(true);
    try {
      await clubCreateCohort(venueToken, clubId, {
        name: name.trim(),
        category,
        minAge: minAge === "" ? null : Number(minAge),
        maxAge: maxAge === "" ? null : Number(maxAge),
      });
      toast?.({ icon: "check", text: "Cohort created" });
      onCreated();
    } catch (err) {
      console.error("[memberships] create cohort failed", err);
      toast?.({ icon: "alert", text: "Couldn't create — try again" });
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <MobileSheet
      title="New cohort"
      onClose={onClose}
      footer={
        <button onClick={save} disabled={busy} style={{
          width: "100%", padding: "13px", borderRadius: "var(--r-sm)", background: "var(--amber)", color: "var(--amber-ink)",
          border: "none", fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}>{busy ? "Creating…" : "Create cohort"}</button>
      }
    >
      <label style={{ display: "block", fontSize: 12, color: "var(--ink3)" }}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Under-9s" style={field} />
      </label>

      <div style={{ fontSize: 12, color: "var(--ink3)", margin: "16px 0 0" }}>Age group</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        {["youth", "adult", "mixed"].map((k) => {
          const on = category === k;
          return (
            <button key={k} onClick={() => setCategory(k)} style={{
              flex: 1, padding: "10px 8px", borderRadius: "var(--r-pill)", cursor: "pointer",
              fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
              border: on ? "1px solid var(--amber)" : "1px solid var(--hair)",
              background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--ink)" : "var(--ink3)",
            }}>{CATEGORY_LABEL[k]}</button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <label style={{ flex: 1, display: "block", fontSize: 12, color: "var(--ink3)" }}>
          Min age
          <input value={minAge} onChange={(e) => setMinAge(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="—" style={field} />
        </label>
        <label style={{ flex: 1, display: "block", fontSize: 12, color: "var(--ink3)" }}>
          Max age
          <input value={maxAge} onChange={(e) => setMaxAge(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="—" style={field} />
        </label>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "14px 2px 0", lineHeight: 1.4 }}>
        Leave ages blank for an all-ages cohort. Tiers and deeper setup stay on the desktop console.
      </div>
    </MobileSheet>
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

function ActiveChip({ active }) {
  const bg = active ? "var(--ok-soft)" : "var(--s3)";
  const ink = active ? "var(--ok-ink)" : "var(--ink3)";
  return (
    <span style={{
      height: 21, fontSize: 11, padding: "0 8px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", fontWeight: 700, flex: "none",
      background: bg, color: ink,
    }}>{active ? "Active" : "Inactive"}</span>
  );
}
